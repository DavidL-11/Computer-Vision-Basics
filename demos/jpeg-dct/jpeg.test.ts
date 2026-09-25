import { describe, expect, it } from 'vitest';
import { createPlane, psnr } from '../../src/shared/image';
import {
  B,
  DCT_MATRIX,
  FLAT_TABLE,
  LUMINANCE_TABLE,
  ZIGZAG,
  basisBlock,
  coefficientMosaic,
  compress,
  dct,
  entropy,
  idct,
  scaleTable,
  zigzagRun,
} from './jpeg';

const block = () => Float64Array.from({ length: 64 }, (_, i) => ((i * 37) % 255) - 128);
const maxDiff = (a: ArrayLike<number>, b: ArrayLike<number>) => Array.from(a).reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);

function testImage(w: number, h: number) {
  const p = createPlane(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) p.data[y * w + x] = (x > 5 && x < 19 && y > 3 && y < 12 ? 0.8 : 0.2) + 0.1 * Math.sin(x / 3);
  return p;
}

describe('DCT', () => {
  it('the DCT matrix is orthogonal: T Tᵀ = I', () => {
    for (let a = 0; a < B; a++)
      for (let b = 0; b < B; b++) {
        let dot = 0;
        for (let k = 0; k < B; k++) dot += DCT_MATRIX[a * B + k] * DCT_MATRIX[b * B + k];
        expect(dot).toBeCloseTo(a === b ? 1 : 0, 12);
      }
  });

  it('the inverse DCT undoes the DCT', () => {
    expect(maxDiff(idct(dct(block())), block())).toBeLessThan(1e-9);
  });

  it('a constant block has only a DC coefficient, 8 times the value', () => {
    const F = dct(new Float64Array(64).fill(10));
    expect(F[0]).toBeCloseTo(80, 9);
    for (let i = 1; i < 64; i++) expect(F[i]).toBeCloseTo(0, 9);
  });

  it('matches the definition with cosines', () => {
    const f = block();
    const [u, v] = [3, 1];
    let sum = 0;
    for (let y = 0; y < B; y++)
      for (let x = 0; x < B; x++) sum += f[y * B + x] * Math.cos(((2 * x + 1) * u * Math.PI) / 16) * Math.cos(((2 * y + 1) * v * Math.PI) / 16);
    expect(dct(f)[v * B + u]).toBeCloseTo(sum / 4, 9);
  });

  it('a basis block varies along x for u and along y for v', () => {
    const b = basisBlock(1, 0);
    expect(b[0]).toBeCloseTo(b[B], 12);
    expect(b[0]).toBeGreaterThan(b[7]);
  });

  it('energy is preserved (Parseval)', () => {
    const f = block();
    const energy = (a: Float64Array) => a.reduce((s, v) => s + v * v, 0);
    expect(energy(dct(f))).toBeCloseTo(energy(f), 6);
  });
});

describe('quantization tables', () => {
  it('quality 50 is the table itself, 100 is all ones', () => {
    expect(scaleTable(LUMINANCE_TABLE, 50)).toEqual(LUMINANCE_TABLE);
    expect(scaleTable(LUMINANCE_TABLE, 100)).toEqual(new Array(64).fill(1));
    expect(Math.max(...scaleTable(LUMINANCE_TABLE, 1))).toBe(255);
  });

  it('the flat table has the mean step of the luminance table', () => {
    expect(FLAT_TABLE[0]).toBe(58);
    expect(new Set(FLAT_TABLE).size).toBe(1);
  });
});

describe('zigzag', () => {
  it('starts like the JPEG order and visits every coefficient once', () => {
    expect(ZIGZAG.slice(0, 10)).toEqual([0, 1, 8, 16, 9, 2, 3, 10, 17, 24]);
    expect(ZIGZAG.at(-1)).toBe(63);
    expect([...ZIGZAG].sort((a, b) => a - b)).toEqual(Array.from({ length: 64 }, (_, i) => i));
  });

  it('drops the trailing zeros', () => {
    const q = new Int32Array(64);
    q[0] = 5;
    q[8] = -2;
    expect(zigzagRun(q)).toEqual([5, 0, -2]);
    expect(zigzagRun(new Int32Array(64))).toEqual([]);
  });
});

describe('compression', () => {
  const p = testImage(32, 16);

  it('quality 100 is nearly lossless, lower quality loses more', () => {
    const best = compress(p, scaleTable(LUMINANCE_TABLE, 100));
    const low = compress(p, scaleTable(LUMINANCE_TABLE, 10));
    expect(psnr(p, best.image)).toBeGreaterThan(45);
    expect(psnr(p, low.image)).toBeLessThan(psnr(p, best.image));
    const zeros = (c: typeof best) => c.blocks.reduce((n, b) => n + b.quantized.filter((q) => q === 0).length, 0);
    expect(zeros(low)).toBeGreaterThan(zeros(best));
    expect(entropy(low.blocks)).toBeLessThan(entropy(best.blocks));
  });

  it('stores round(F / Q) and decodes it block by block', () => {
    const table = scaleTable(LUMINANCE_TABLE, 50);
    const c = compress(p, table);
    expect(c.blocksX).toBe(4);
    expect(c.blocksY).toBe(2);
    const b = c.blocks[5];
    b.quantized.forEach((q, i) => expect(q).toBe(Math.round(b.coef[i] / table[i]) + 0));
    expect(c.image.data[(8 + 2) * 32 + 8 + 3]).toBeCloseTo(b.decoded[2 * B + 3] / 255, 6);
  });

  it('entropy is 0 for constant data and 1 bit for two equally likely values', () => {
    const q = (v: number[]) => ({ pixels: new Float64Array(), coef: new Float64Array(), decoded: new Float64Array(), quantized: Int32Array.from(v) });
    expect(entropy([q([3, 3, 3, 3])])).toBe(0);
    expect(entropy([q([0, 1]), q([1, 0])])).toBeCloseTo(1, 12);
  });

  it('the coefficient mosaic is black where coefficients are 0', () => {
    const c = compress(p, scaleTable(LUMINANCE_TABLE, 20));
    const m = coefficientMosaic(c);
    c.blocks[0].quantized.forEach((q, i) => expect(m.data[Math.floor(i / B) * m.width + (i % B)] === 0).toBe(q === 0));
  });
});
