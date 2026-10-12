import { describe, expect, it } from 'vitest';
import { random } from '../../src/shared/noise';
import { nullVector } from '../../src/shared/svd';
import { type Vec2, perpendicularFoot, presetPoints, rotateAbout, totalLS, verticalLS } from './fit';

const noisy = presetPoints('noisy line', 0.4, random(1));

describe('verticalLS', () => {
  it('recovers an exact line with E = 0', () => {
    const pts: Vec2[] = [-2, -1, 0, 1.5, 3].map((x) => [x, 0.5 * x - 1]);
    const fit = verticalLS(pts);
    expect(fit.p![0]).toBeCloseTo(0.5, 12);
    expect(fit.p![1]).toBeCloseTo(-1, 12);
    expect(fit.E).toBeCloseTo(0, 20);
  });

  it('solves the normal equations AᵀA p = Aᵀy', () => {
    const fit = verticalLS(noisy);
    const [m, b] = fit.p!;
    fit.AtA.forEach((row, i) => expect(row[0] * m + row[1] * b).toBeCloseTo(fit.Aty[i], 10));
    // At the minimum the residuals are orthogonal to both columns of A.
    expect(fit.residuals.reduce((s, r) => s + r, 0)).toBeCloseTo(0, 10);
    expect(fit.residuals.reduce((s, r, i) => s + r * noisy[i][0], 0)).toBeCloseTo(0, 10);
  });

  it('fails for a vertical line, because AᵀA is singular', () => {
    const fit = verticalLS(presetPoints('vertical line', 0, random(1)));
    expect(fit.p).toBeNull();
    expect(Number.isNaN(fit.E)).toBe(true);
  });
});

describe('totalLS', () => {
  it('recovers an exact line, including a vertical one', () => {
    for (const pts of [
      [-2, -1, 0, 1.5, 3].map((x): Vec2 => [x, 0.5 * x - 1]),
      presetPoints('vertical line', 0, random(1)),
    ]) {
      const fit = totalLS(pts);
      expect(fit.E).toBeCloseTo(0, 12);
      expect(fit.lambda[1]).toBeCloseTo(0, 12);
      fit.residuals.forEach((r) => expect(r).toBeCloseTo(0, 12));
    }
    const vertical = totalLS(presetPoints('vertical line', 0, random(1)));
    expect(vertical.normal[0]).toBeCloseTo(1, 12);
    expect(vertical.c).toBeCloseTo(-1.5, 12);
  });

  it('has a unit normal, E = λ₂, and matches the smallest right singular vector of A', () => {
    const fit = totalLS(noisy);
    expect(Math.hypot(...fit.normal)).toBeCloseTo(1, 12);
    expect(fit.E).toBeCloseTo(fit.lambda[1], 10);
    const { x } = nullVector(fit.A);
    expect(Math.abs(x[0] * fit.normal[0] + x[1] * fit.normal[1])).toBeCloseTo(1, 10);
  });

  it('gives a smaller perpendicular error than the VLS line', () => {
    const tls = totalLS(noisy);
    const [m, b] = verticalLS(noisy).p!;
    // The VLS line m x − y + b = 0, normalized.
    const k = Math.hypot(m, 1);
    const perpendicular = noisy.reduce((s, [x, y]) => s + ((m * x - y + b) / k) ** 2, 0);
    expect(tls.E).toBeLessThanOrEqual(perpendicular + 1e-12);
  });

  it('is rotation invariant, while VLS is not', () => {
    const center = totalLS(noisy).mean;
    const angle = 0.9;
    const rotated = rotateAbout(noisy, center, angle);
    const before = totalLS(noisy);
    const after = totalLS(rotated);
    expect(after.E).toBeCloseTo(before.E, 10);
    // The rotated normal is the new normal (up to sign).
    const [a, b] = before.normal;
    const turned = [Math.cos(angle) * a - Math.sin(angle) * b, Math.sin(angle) * a + Math.cos(angle) * b];
    expect(Math.abs(turned[0] * after.normal[0] + turned[1] * after.normal[1])).toBeCloseTo(1, 10);
    expect(Math.abs(verticalLS(rotated).E - verticalLS(noisy).E)).toBeGreaterThan(0.1);
  });

  it('puts the perpendicular foot on the line', () => {
    const fit = totalLS(noisy);
    const [x, y] = perpendicularFoot(fit, noisy[3]);
    expect(fit.normal[0] * x + fit.normal[1] * y + fit.c).toBeCloseTo(0, 12);
  });
});
