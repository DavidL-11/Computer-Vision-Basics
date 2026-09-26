// The three depth layers of the simulated photo: grass and leaves in front, a card with a test image as the subject,
// and a landscape behind. Colors are sRGB and are decoded to linear light before blurring.

import { srgbToLinear } from '../../src/shared/color';
import { type Plane, type RGBImage, createImage, createPlane, getPixel, mapPixels, splitChannels } from '../../src/shared/image';
import { random } from '../../src/shared/noise';
import { testImage } from '../../src/shared/testImages';

export const IMAGE_W = 240;
export const IMAGE_H = 180;
/** The subject card, in image pixels. */
export const CARD = { x: 64, y: 34, w: 112, h: 84 };

export interface LayerImage {
  rgb: [Plane, Plane, Plane];
  alpha: Plane;
}

function linear(img: RGBImage): [Plane, Plane, Plane] {
  return splitChannels(mapPixels(img, (rgb) => rgb.map(srgbToLinear) as typeof rgb));
}

function opaque(): Plane {
  const p = createPlane(IMAGE_W, IMAGE_H);
  p.data.fill(1);
  return p;
}

export function background(): LayerImage {
  return { rgb: linear(testImage('scene', IMAGE_W, IMAGE_H)), alpha: opaque() };
}

/** The card image must be CARD.w × CARD.h; it gets a dark frame. */
export function subject(card: RGBImage): LayerImage {
  const img = createImage(IMAGE_W, IMAGE_H);
  const alpha = createPlane(IMAGE_W, IMAGE_H);
  const frame = 3;
  for (let y = CARD.y - frame; y < CARD.y + CARD.h + frame; y++)
    for (let x = CARD.x - frame; x < CARD.x + CARD.w + frame; x++) {
      const i = y * IMAGE_W + x;
      alpha.data[i] = 1;
      const [cx, cy] = [x - CARD.x, y - CARD.y];
      const inside = cx >= 0 && cx < CARD.w && cy >= 0 && cy < CARD.h;
      img.data.set(inside ? getPixel(card, cx, cy) : [0.12, 0.12, 0.14], i * 3);
    }
  return { rgb: linear(img), alpha };
}

export function foreground(): LayerImage {
  const canvas = document.createElement('canvas');
  canvas.width = IMAGE_W;
  canvas.height = IMAGE_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.scale(IMAGE_W / 640, IMAGE_H / 480);
  const rand = random(11);
  const green = () => `hsl(${95 + rand() * 40} ${40 + rand() * 25}% ${18 + rand() * 20}%)`;

  for (let i = 0; i < 90; i++) {
    const x = rand() * 680 - 20;
    const h = 50 + rand() * rand() * 170;
    const lean = (rand() - 0.5) * 90;
    const w = 5 + rand() * 7;
    ctx.fillStyle = green();
    ctx.beginPath();
    ctx.moveTo(x - w, 480);
    ctx.quadraticCurveTo(x + lean * 0.2, 480 - h * 0.6, x + lean, 480 - h);
    ctx.quadraticCurveTo(x + lean * 0.2 + w * 0.6, 480 - h * 0.6, x + w, 480);
    ctx.fill();
  }

  // A branch with leaves reaching in from the top right.
  ctx.strokeStyle = '#4a3322';
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(660, 30);
  ctx.quadraticCurveTo(560, 60, 470, 40);
  ctx.stroke();
  for (let i = 0; i < 14; i++) {
    const t = i / 13;
    const x = 660 - t * 190;
    const y = 30 + Math.sin(t * Math.PI) * 22 - t * 10;
    const angle = (i % 2 ? 1 : -1) * (0.6 + rand() * 0.5) + Math.PI / 2 + 0.3;
    ctx.fillStyle = green();
    ctx.beginPath();
    ctx.ellipse(x + Math.cos(angle) * 26, y + Math.sin(angle) * 26, 30, 12, angle, 0, 2 * Math.PI);
    ctx.fill();
  }

  const data = ctx.getImageData(0, 0, IMAGE_W, IMAGE_H).data;
  const img = createImage(IMAGE_W, IMAGE_H);
  const alpha = createPlane(IMAGE_W, IMAGE_H);
  for (let i = 0; i < IMAGE_W * IMAGE_H; i++) {
    const a = data[i * 4 + 3] / 255;
    alpha.data[i] = a;
    // Canvas pixels are not premultiplied when read back, so the color is valid wherever a > 0.
    for (let c = 0; c < 3; c++) img.data[i * 3 + c] = data[i * 4 + c] / 255;
  }
  return { rgb: linear(img), alpha };
}
