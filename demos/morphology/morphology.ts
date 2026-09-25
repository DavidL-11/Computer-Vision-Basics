/**
 * Binary morphology and connected components.
 *
 * Conventions:
 *  - A binary image stores 1 for foreground (the set A) and 0 for background.
 *  - A structuring element B is a binary image of odd size with its origin in the center.
 *  - Pixels outside the image are background for dilation and do not constrain erosion, so objects touching the
 *    border are not eaten away from outside.
 */

export interface Binary {
  width: number;
  height: number;
  data: Uint8Array;
}

export type Shape = 'square' | 'cross' | 'disk';
export type Operation = 'erosion' | 'dilation' | 'opening' | 'closing' | 'boundary';
export type Connectivity = 4 | 8;

export function createBinary(width: number, height: number): Binary {
  return { width, height, data: new Uint8Array(width * height) };
}

export function structuringElement(shape: Shape, radius: number): Binary {
  const size = 2 * radius + 1;
  const b = createBinary(size, size);
  for (let v = -radius; v <= radius; v++)
    for (let u = -radius; u <= radius; u++) {
      const inside = shape === 'square' || (shape === 'cross' ? u === 0 || v === 0 : u * u + v * v <= (radius + 0.5) ** 2);
      b.data[(v + radius) * size + u + radius] = inside ? 1 : 0;
    }
  return b;
}

/** Offsets (u, v) of the elements of B. */
function offsets(b: Binary): [number, number][] {
  const r = (b.width - 1) / 2;
  const out: [number, number][] = [];
  for (let v = 0; v < b.height; v++) for (let u = 0; u < b.width; u++) if (b.data[v * b.width + u]) out.push([u - r, v - r]);
  return out;
}

/** A ⊕ B = { z | (B̂)_z ∩ A ≠ ∅ }: z is set if A contains z − b for some b ∈ B. */
export function dilate(a: Binary, b: Binary): Binary {
  const out = createBinary(a.width, a.height);
  const bs = offsets(b);
  for (let y = 0; y < a.height; y++)
    for (let x = 0; x < a.width; x++)
      out.data[y * a.width + x] = bs.some(([u, v]) => {
        const sx = x - u;
        const sy = y - v;
        return sx >= 0 && sy >= 0 && sx < a.width && sy < a.height && a.data[sy * a.width + sx] === 1;
      })
        ? 1
        : 0;
  return out;
}

/** A ⊖ B = { z | B_z ⊆ A }: z is set if A contains z + b for every b ∈ B. */
export function erode(a: Binary, b: Binary): Binary {
  const out = createBinary(a.width, a.height);
  const bs = offsets(b);
  for (let y = 0; y < a.height; y++)
    for (let x = 0; x < a.width; x++)
      out.data[y * a.width + x] = bs.every(([u, v]) => {
        const sx = x + u;
        const sy = y + v;
        return sx < 0 || sy < 0 || sx >= a.width || sy >= a.height || a.data[sy * a.width + sx] === 1;
      })
        ? 1
        : 0;
  return out;
}

/** A ∘ B = (A ⊖ B) ⊕ B */
export const open = (a: Binary, b: Binary) => dilate(erode(a, b), b);

/** A • B = (A ⊕ B) ⊖ B */
export const close = (a: Binary, b: Binary) => erode(dilate(a, b), b);

/** A − (A ⊖ B) */
export function boundary(a: Binary, b: Binary): Binary {
  const eroded = erode(a, b);
  return { ...a, data: a.data.map((v, i) => v & (1 - eroded.data[i])) };
}

export function complement(a: Binary): Binary {
  return { ...a, data: a.data.map((v) => 1 - v) };
}

export function applyOperation(a: Binary, b: Binary, op: Operation): Binary {
  switch (op) {
    case 'erosion':
      return erode(a, b);
    case 'dilation':
      return dilate(a, b);
    case 'opening':
      return open(a, b);
    case 'closing':
      return close(a, b);
    case 'boundary':
      return boundary(a, b);
  }
}

export interface Components {
  /** 0 for background, 1 … count for the components, numbered in the order they are first met row by row. */
  labels: Int32Array;
  count: number;
  /** Number of pixels of component k at index k − 1. */
  sizes: number[];
}

/**
 * Two-pass labeling. Pass 1 gives each pixel the smallest label among its already visited neighbors and records
 * that the neighbors' labels belong together (union-find). Pass 2 replaces every label by its set's final number.
 */
export function labelComponents(a: Binary, connectivity: Connectivity): Components {
  const { width: w, height: h } = a;
  const labels = new Int32Array(w * h);
  const parent = [0];
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const union = (i: number, j: number) => {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[Math.max(ri, rj)] = Math.min(ri, rj);
  };
  // Neighbors that come before (x, y) in raster order: left and up, plus both upper diagonals for 8-connectivity.
  const previous: [number, number][] = connectivity === 4 ? [[-1, 0], [0, -1]] : [[-1, 0], [-1, -1], [0, -1], [1, -1]];

  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!a.data[y * w + x]) continue;
      const found: number[] = [];
      for (const [dx, dy] of previous) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && labels[ny * w + nx]) found.push(labels[ny * w + nx]);
      }
      if (found.length === 0) {
        parent.push(parent.length);
        labels[y * w + x] = parent.length - 1;
      } else {
        const min = Math.min(...found);
        labels[y * w + x] = min;
        for (const l of found) union(min, l);
      }
    }

  const number = new Map<number, number>();
  const sizes: number[] = [];
  for (let i = 0; i < labels.length; i++) {
    if (!labels[i]) continue;
    const root = find(labels[i]);
    if (!number.has(root)) {
      number.set(root, number.size + 1);
      sizes.push(0);
    }
    labels[i] = number.get(root)!;
    sizes[labels[i] - 1]++;
  }
  return { labels, count: number.size, sizes };
}

/** Deterministic pseudo-random numbers, so the initial image is the same on every load. */
function random(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

/**
 * A 96 × 72 test image: two disks joined by a thin bridge, a rectangle with small and larger holes, a ring with a
 * narrow gap, a one-pixel diagonal line, a disk with a thin spike and a narrow notch, and isolated specks of noise.
 */
export function initialImage(): Binary {
  const w = 96;
  const h = 72;
  const img = createBinary(w, h);
  const set = (x: number, y: number, v: number) => {
    if (x >= 0 && y >= 0 && x < w && y < h) img.data[y * w + x] = v;
  };
  const fill = (inside: (x: number, y: number) => boolean, v = 1) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inside(x, y)) set(x, y, v);
  };
  const disk = (cx: number, cy: number, r: number) => (x: number, y: number) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  const rect = (x0: number, y0: number, x1: number, y1: number) => (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

  fill(disk(13, 16, 8));
  fill(disk(36, 16, 8));
  fill(rect(20, 15, 29, 16));

  fill(rect(54, 5, 88, 27));
  for (const [x, y] of [
    [60, 10],
    [71, 21],
    [82, 9],
  ])
    set(x, y, 0);
  fill(rect(63, 15, 64, 16), 0);
  fill(rect(77, 18, 81, 22), 0);

  fill((x, y) => disk(16, 52, 12)(x, y) && !disk(16, 52, 8)(x, y));
  fill(rect(16, 60, 17, 65), 0);

  for (let i = 0; i <= 16; i++) set(36 + i, 40 + i, 1);

  fill(disk(76, 54, 11));
  fill(rect(76, 34, 76, 43));
  fill(rect(83, 53, 88, 54), 0);

  const rand = random(3);
  const isolated = (x: number, y: number) => {
    for (let v = -2; v <= 2; v++) for (let u = -2; u <= 2; u++) if (img.data[(y + v) * w + x + u]) return false;
    return true;
  };
  for (let placed = 0; placed < 36; ) {
    const x = 2 + Math.floor(rand() * (w - 4));
    const y = 2 + Math.floor(rand() * (h - 4));
    if (!isolated(x, y)) continue;
    set(x, y, 1);
    if (rand() < 0.3) set(x + 1, y, 1);
    placed++;
  }
  return img;
}
