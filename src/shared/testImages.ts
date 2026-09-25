// Procedural test images (all 4:3) and loading of the user's own image.
// Pixel-exact patterns are computed directly; illustrations are drawn in a 640 × 480 design space.

import { type RGBImage, createImage } from './image';

export type TestImage = 'scene' | 'chart' | 'text' | 'zone-plate' | 'gradients' | 'lights';

export const TEST_IMAGE_LABELS: Record<TestImage, string> = {
  scene: 'Landscape',
  chart: 'Test chart',
  text: 'Colored text',
  'zone-plate': 'Zone plate',
  gradients: 'Gradients',
  lights: 'Colored lights',
};

/** Tweakpane list options for a subset of the test images. */
export const imageOptions = (names: TestImage[]) => Object.fromEntries(names.map((n) => [TEST_IMAGE_LABELS[n], n]));

export function testImage(name: TestImage, width: number, height: number): RGBImage {
  switch (name) {
    case 'zone-plate':
      return zonePlate(width, height);
    case 'gradients':
      return gradients(width, height);
    case 'lights':
      return lights(width, height);
    case 'scene':
      return drawn(width, height, drawScene);
    case 'chart':
      return drawn(width, height, drawChart);
    case 'text':
      return drawn(width, height, drawText);
  }
}

function fromImageData(d: ImageData): RGBImage {
  const img = createImage(d.width, d.height);
  for (let i = 0, j = 0; j < d.data.length; i += 3, j += 4) {
    img.data[i] = d.data[j] / 255;
    img.data[i + 1] = d.data[j + 1] / 255;
    img.data[i + 2] = d.data[j + 2] / 255;
  }
  return img;
}

function drawn(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): RGBImage {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.scale(width / 640, height / 480);
  draw(ctx);
  return fromImageData(ctx.getImageData(0, 0, width, height));
}

/** cos(k·r²): the local frequency grows linearly with r and reaches Nyquist at the corners. */
function zonePlate(width: number, height: number): RGBImage {
  const img = createImage(width, height);
  const rMax = Math.hypot(width, height) / 2;
  const k = Math.PI / (2 * rMax);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const r2 = (x + 0.5 - width / 2) ** 2 + (y + 0.5 - height / 2) ** 2;
      img.data.fill(0.5 + 0.5 * Math.cos(k * r2), (y * width + x) * 3, (y * width + x) * 3 + 3);
    }
  return img;
}

function gradients(width: number, height: number): RGBImage {
  const img = createImage(width, height);
  const dusk = [0.06, 0.12, 0.3];
  const glow = [1, 0.6, 0.25];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const t = x / (width - 1);
      const band = Math.floor((3 * y) / height);
      const rgb = band === 0 ? [t, t, t] : band === 1 ? dusk.map((d, i) => d + (glow[i] - d) * t) : [t / 4, t / 4, t / 4];
      img.data.set(rgb, (y * width + x) * 3);
    }
  return img;
}

function lights(width: number, height: number): RGBImage {
  const img = createImage(width, height);
  const s = width / 64;
  const set = (x: number, y: number, rgb: number[]) => img.data.set(rgb, (y * width + x) * 3);
  const dots = [
    [1, 0.1, 0.1],
    [0.1, 1, 0.2],
    [0.2, 0.3, 1],
    [1, 1, 1],
    [1, 0.85, 0.1],
    [0.1, 0.9, 1],
  ];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const left = x < width / 2;
      const top = y < height / 2;
      if (left && top) set(x, y, Math.floor(x / s) % 2 ? [0, 1, 0] : [1, 0, 0]);
      else if (left) set(x, y, (Math.floor(x / s) + Math.floor(y / s)) % 2 ? [1, 1, 0] : [0, 0, 1]);
      else if (top) set(x, y, x % Math.round(2 * s) === 0 ? [1, 1, 1] : [0, 0, 0]);
      else {
        const gx = Math.floor((x - width / 2) / (3 * s));
        const gy = Math.floor((y - height / 2) / (3 * s));
        const on = (x - width / 2) % (3 * s) < s && (y - height / 2) % (3 * s) < s;
        set(x, y, on ? dots[(gx + gy * 3) % dots.length] : [0, 0, 0]);
      }
    }
  return img;
}

/** Deterministic pseudo-random numbers, so the landscape is the same on every load. */
function random(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

function polygon(ctx: CanvasRenderingContext2D, points: number[], fill: string | CanvasGradient): void {
  ctx.beginPath();
  ctx.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function drawScene(ctx: CanvasRenderingContext2D): void {
  const sky = ctx.createLinearGradient(0, 0, 0, 290);
  sky.addColorStop(0, '#2c5da6');
  sky.addColorStop(0.7, '#8fb3d9');
  sky.addColorStop(1, '#f1cf9c');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 640, 300);

  const sun = ctx.createRadialGradient(480, 110, 0, 480, 110, 140);
  sun.addColorStop(0, '#fffbe8');
  sun.addColorStop(0.2, '#ffe39a');
  sun.addColorStop(1, 'rgb(255 214 150 / 0)');
  ctx.fillStyle = sun;
  ctx.fillRect(300, 0, 340, 300);

  polygon(ctx, [0, 260, 90, 170, 170, 230, 260, 140, 380, 250, 470, 190, 560, 240, 640, 200, 640, 300, 0, 300], '#7d88b3');
  const hills = ctx.createLinearGradient(0, 220, 0, 480);
  hills.addColorStop(0, '#6fae4c');
  hills.addColorStop(1, '#2f6b2a');
  polygon(ctx, [0, 290, 150, 240, 330, 280, 470, 245, 640, 275, 640, 480, 0, 480], hills);

  // House with a tiled roof and a window grid.
  ctx.fillStyle = '#eadcc0';
  ctx.fillRect(90, 270, 170, 120);
  polygon(ctx, [75, 275, 175, 200, 275, 275], '#b3322a');
  ctx.strokeStyle = '#7e1f19';
  ctx.lineWidth = 1.5;
  for (let y = 215; y < 275; y += 8) {
    const half = ((y - 200) / 75) * 100;
    ctx.beginPath();
    ctx.moveTo(175 - half, y);
    ctx.lineTo(175 + half, y);
    ctx.stroke();
  }
  ctx.fillStyle = '#5b3a22';
  ctx.fillRect(155, 320, 36, 70);
  for (const x of [110, 210]) {
    ctx.fillStyle = '#3d6fae';
    ctx.fillRect(x, 295, 34, 34);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + 16, 295, 2, 34);
    ctx.fillRect(x, 311, 34, 2);
  }

  // Picket fence: fine repetitive detail.
  ctx.fillStyle = '#f7f4ec';
  for (let x = 290; x < 640; x += 9) ctx.fillRect(x, 330, 4, 60);
  ctx.fillRect(290, 342, 350, 4);
  ctx.fillRect(290, 372, 350, 4);

  // Tree
  ctx.fillStyle = '#5a3d25';
  ctx.fillRect(38, 300, 16, 90);
  const crown = ctx.createRadialGradient(40, 265, 5, 46, 280, 55);
  crown.addColorStop(0, '#5fae3e');
  crown.addColorStop(1, '#1f5a22');
  ctx.fillStyle = crown;
  ctx.beginPath();
  ctx.arc(46, 280, 50, 0, Math.PI * 2);
  ctx.fill();

  const rand = random(7);
  const flowers = ['#e8283c', '#ffd21f', '#ffffff', '#d14fd6', '#ff8a1f', '#3f7fff'];
  for (let i = 0; i < 160; i++) {
    const y = 400 + rand() * 80;
    ctx.fillStyle = flowers[Math.floor(rand() * flowers.length)];
    ctx.beginPath();
    ctx.arc(rand() * 640, y, 2 + ((y - 400) / 80) * 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Approximate sRGB values of the classic 24-patch color checker.
const CHECKER = [
  '#735244', '#c29682', '#627a9d', '#576c43', '#8580b1', '#67bdaa',
  '#d67e2c', '#505ba6', '#c15a63', '#5e3c6c', '#9dbc40', '#e0a32e',
  '#383d96', '#469449', '#af363c', '#e7c71f', '#bb5695', '#0885a1',
  '#f3f3f2', '#c8c8c8', '#a0a0a0', '#7a7a79', '#555555', '#343434',
];

function drawChart(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 640, 480);

  const hue = ctx.createLinearGradient(20, 0, 620, 0);
  for (let i = 0; i <= 12; i++) hue.addColorStop(i / 12, `hsl(${i * 30} 100% 50%)`);
  ctx.fillStyle = hue;
  ctx.fillRect(20, 16, 600, 50);
  const fade = ctx.createLinearGradient(0, 66, 0, 96);
  fade.addColorStop(0, 'rgb(255 255 255 / 0)');
  fade.addColorStop(1, 'rgb(255 255 255 / 1)');
  ctx.fillStyle = hue;
  ctx.fillRect(20, 66, 600, 30);
  ctx.fillStyle = fade;
  ctx.fillRect(20, 66, 600, 30);

  for (let i = 0; i < 16; i++) {
    const v = Math.round((i / 15) * 255);
    ctx.fillStyle = `rgb(${v} ${v} ${v})`;
    ctx.fillRect(20 + i * 37.5, 106, 37.5, 34);
  }

  CHECKER.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(20 + (i % 6) * 100, 152 + Math.floor(i / 6) * 50, 92, 42);
  });

  // Line groups with decreasing period.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(20, 358, 600, 106);
  ctx.fillStyle = '#000000';
  [16, 12, 8, 6, 4].forEach((period, i) => {
    const x0 = 24 + i * 120;
    for (let x = x0; x < x0 + 110; x += period) ctx.fillRect(x, 364, period / 2, 44);
    for (let y = 414; y < 458; y += period) ctx.fillRect(x0, y, 110, period / 2);
  });
}

function drawText(ctx: CanvasRenderingContext2D): void {
  const rows: [string, string, string][] = [
    ['#1f3fd0', '#ff2a2a', 'Red on blue'],
    ['#000000', '#ff3030', 'Red on black'],
    ['#1a9a3a', '#e62ee6', 'Magenta on green'],
    ['#ffffff', '#f0c000', 'Yellow on white'],
    ['#ffe100', '#1050ff', 'Blue on yellow'],
    ['#ffffff', '#000000', 'Black on white'],
  ];
  rows.forEach(([bg, fg, label], i) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, i * 80, 640, 80);
    ctx.fillStyle = fg;
    ctx.font = `bold 46px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 24, i * 80 + 42);
    ctx.fillRect(470, i * 80 + 14, 3, 52);
    ctx.fillRect(482, i * 80 + 14, 1.5, 52);
    ctx.beginPath();
    ctx.arc(560, i * 80 + 40, 26, 0, Math.PI * 2);
    ctx.lineWidth = 4;
    ctx.strokeStyle = fg;
    ctx.stroke();
  });
}

/** Lets the user pick an image file and scales it to fit into width × height (cropped to 4:3). */
export function openImageFile(width: number, height: number): Promise<RGBImage | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('cancel', () => resolve(null));
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        const bitmap = await createImageBitmap(file);
        const s = Math.max(width / bitmap.width, height / bitmap.height);
        resolve(
          drawn(width, height, (ctx) => {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.imageSmoothingQuality = 'high';
            const w = bitmap.width * s;
            const h = bitmap.height * s;
            ctx.drawImage(bitmap, (width - w) / 2, (height - h) / 2, w, h);
          }),
        );
      } catch {
        resolve(null);
      }
    });
    input.click();
  });
}
