/**
 * The lossy core of baseline JPEG for one gray channel: 8 × 8 blocks, DCT, quantization and back.
 *
 * Conventions:
 *  - Pixels are 8-bit values 0 … 255, shifted by −128 before the transform so that they are centered on 0.
 *  - Blocks and coefficient arrays have 64 entries in row-major order: pixel (x, y) at y·8 + x, coefficient F(u, v) at
 *    v·8 + u, with u the horizontal and v the vertical frequency. F(0, 0) is the DC coefficient.
 *  - The 2D DCT-II is orthonormal (the JPEG definition):
 *      F(u, v) = ¼ C(u) C(v) Σ_x Σ_y f(x, y) cos((2x + 1)uπ / 16) cos((2y + 1)vπ / 16),  C(0) = 1/√2, else 1.
 *  - Image width and height are multiples of 8.
 */

import { type Plane, createPlane } from '../../src/shared/image';

export const B = 8;

/** The example luminance quantization table from the JPEG standard (Annex K), for quality 50. */
export const LUMINANCE_TABLE: readonly number[] = [
  16, 11, 10, 16, 24, 40, 51, 61,
  12, 12, 14, 19, 26, 58, 60, 55,
  14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77,
  24, 35, 55, 64, 81, 104, 113, 92,
  49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103, 99,
];

/** A table with the same step for every frequency, equal to the mean step of the luminance table. */
export const FLAT_TABLE: readonly number[] = new Array(64).fill(Math.round(LUMINANCE_TABLE.reduce((s, q) => s + q, 0) / 64));

/**
 * Scales a quality-50 table to quality 1 … 100 as the IJG libjpeg encoder does: factor 5000/q below 50, 200 − 2q
 * above, then rounded and limited to 1 … 255. Quality 100 gives step 1 everywhere.
 */
export function scaleTable(table: readonly number[], quality: number): number[] {
  const s = quality < 50 ? 5000 / quality : 200 - 2 * quality;
  return table.map((q) => Math.min(255, Math.max(1, Math.floor((q * s + 50) / 100))));
}

/** T[u·8 + x] = ½ C(u) cos((2x + 1)uπ / 16): row u is the u-th 1D DCT basis vector; T is orthogonal. */
export const DCT_MATRIX: Float64Array = Float64Array.from({ length: 64 }, (_, i) => {
  const u = Math.floor(i / B);
  const x = i % B;
  return 0.5 * (u === 0 ? Math.SQRT1_2 : 1) * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
});

/** Returns T · M · Tᵀ, or Tᵀ · M · T if `transpose`. */
function sandwich(m: ArrayLike<number>, transpose: boolean): Float64Array {
  const t = (a: number, b: number) => (transpose ? DCT_MATRIX[b * B + a] : DCT_MATRIX[a * B + b]);
  const tmp = new Float64Array(64);
  const out = new Float64Array(64);
  for (let r = 0; r < B; r++) for (let c = 0; c < B; c++) for (let k = 0; k < B; k++) tmp[r * B + c] += t(r, k) * m[k * B + c];
  for (let r = 0; r < B; r++) for (let c = 0; c < B; c++) for (let k = 0; k < B; k++) out[r * B + c] += tmp[r * B + k] * t(c, k);
  return out;
}

/** 2D DCT of an 8 × 8 block, F = T f Tᵀ: rows and columns are transformed separately. */
export const dct = (block: ArrayLike<number>): Float64Array => sandwich(block, false);

/** Inverse 2D DCT, f = Tᵀ F T. */
export const idct = (coef: ArrayLike<number>): Float64Array => sandwich(coef, true);

/** The basis image of coefficient (u, v): the block whose DCT is 1 at (u, v) and 0 elsewhere. */
export function basisBlock(u: number, v: number): Float64Array {
  const coef = new Float64Array(64);
  coef[v * B + u] = 1;
  return idct(coef);
}

/**
 * Zigzag order: ZIGZAG[k] is the index v·8 + u of the k-th coefficient, running along the anti-diagonals u + v = s
 * from low to high frequencies, alternating direction.
 */
export const ZIGZAG: readonly number[] = Array.from({ length: 64 }, (_, i) => i).sort((a, b) => {
  const [ua, va, ub, vb] = [a % B, Math.floor(a / B), b % B, Math.floor(b / B)];
  const s = ua + va - (ub + vb);
  if (s !== 0) return s;
  // On even diagonals move up and to the right, on odd ones down and to the left.
  return (ua + va) % 2 === 0 ? ua - ub : va - vb;
});

export interface EncodedBlock {
  /** Level-shifted pixels f(x, y) − 128. */
  pixels: Float64Array;
  /** DCT coefficients F(u, v). */
  coef: Float64Array;
  /** Quantized coefficients round(F / Q): what is actually stored. */
  quantized: Int32Array;
  /** Decoded pixels 0 … 255: the inverse DCT of the dequantized coefficients + 128, rounded and clipped. */
  decoded: Float64Array;
}

/** Encodes and decodes the block with top-left pixel (8·bx, 8·by) of an image with values in [0, 1]. */
export function encodeBlock(p: Plane, bx: number, by: number, table: readonly number[]): EncodedBlock {
  const pixels = new Float64Array(64);
  for (let y = 0; y < B; y++)
    for (let x = 0; x < B; x++) pixels[y * B + x] = Math.round(p.data[(by * B + y) * p.width + bx * B + x] * 255) - 128;
  const coef = dct(pixels);
  const quantized = Int32Array.from(coef, (c, i) => Math.round(c / table[i]));
  const decoded = idct(Float64Array.from(quantized, (q, i) => q * table[i])).map((v) => Math.min(255, Math.max(0, Math.round(v + 128))));
  return { pixels, coef, quantized, decoded };
}

export interface Compressed {
  image: Plane;
  blocksX: number;
  blocksY: number;
  /** Row-major by block. */
  blocks: EncodedBlock[];
}

export function compress(p: Plane, table: readonly number[]): Compressed {
  const blocksX = p.width / B;
  const blocksY = p.height / B;
  const image = createPlane(p.width, p.height);
  const blocks: EncodedBlock[] = [];
  for (let by = 0; by < blocksY; by++)
    for (let bx = 0; bx < blocksX; bx++) {
      const block = encodeBlock(p, bx, by, table);
      blocks.push(block);
      for (let y = 0; y < B; y++)
        for (let x = 0; x < B; x++) image.data[(by * B + y) * p.width + bx * B + x] = block.decoded[y * B + x] / 255;
    }
  return { image, blocksX, blocksY, blocks };
}

/** The quantized coefficients in zigzag order, without the trailing zeros that JPEG replaces by an end-of-block code. */
export function zigzagRun(quantized: Int32Array): number[] {
  const seq = ZIGZAG.map((i) => quantized[i]);
  let end = seq.length;
  while (end > 0 && seq[end - 1] === 0) end--;
  return seq.slice(0, end);
}

/**
 * Zero-order entropy −Σ p log₂ p of the quantized coefficient values in bits per coefficient, i.e. bits per pixel.
 * A rough estimate of what an entropy coder needs; real JPEG also exploits runs of zeros and neighboring DC values.
 */
export function entropy(blocks: EncodedBlock[]): number {
  const counts = new Map<number, number>();
  let total = 0;
  for (const b of blocks)
    for (const q of b.quantized) {
      counts.set(q, (counts.get(q) ?? 0) + 1);
      total++;
    }
  let h = 0;
  for (const c of counts.values()) h -= (c / total) * Math.log2(c / total);
  return h;
}

/** Each block's quantized coefficients as an image: log(1 + |q|) scaled to [0, 1], so zeros are black. */
export function coefficientMosaic(c: Compressed): Plane {
  const out = createPlane(c.blocksX * B, c.blocksY * B);
  let max = 0;
  for (const b of c.blocks) for (const q of b.quantized) max = Math.max(max, Math.log1p(Math.abs(q)));
  c.blocks.forEach((b, k) => {
    const bx = k % c.blocksX;
    const by = Math.floor(k / c.blocksX);
    for (let v = 0; v < B; v++)
      for (let u = 0; u < B; u++) out.data[(by * B + v) * out.width + bx * B + u] = max > 0 ? Math.log1p(Math.abs(b.quantized[v * B + u])) / max : 0;
  });
  return out;
}
