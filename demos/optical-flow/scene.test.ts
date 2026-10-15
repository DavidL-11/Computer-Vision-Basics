import { describe, expect, it } from 'vitest';
import { bilinear } from '../../src/shared/warp';
import { CARD_CENTERS, HEIGHT, WIDTH, regions, render, scene } from './scene';

describe('synthetic scene', () => {
  const obj = [2, 1] as const;
  const bg = [-1, 0] as const;
  const s = scene(obj, bg, 0);

  it('moves the cards and the background by their own translations', () => {
    const [cx, cy] = CARD_CENTERS[0];
    expect(s.I1.data[(cy + 1) * WIDTH + cx + 2]).toBeCloseTo(s.I0.data[cy * WIDTH + cx], 6);
    expect(s.I1.data[60 * WIDTH + 79]).toBeCloseTo(s.I0.data[60 * WIDTH + 80], 6);
  });

  it('is exact for subpixel motion', () => {
    const I1 = render([0.5, 0], [0.5, 0]);
    const [cx, cy] = CARD_CENTERS[0];
    // A smooth texture: half a pixel of motion is close to the mean of the neighbors.
    expect(bilinear(I1, cx + 0.5, cy)).toBeCloseTo(s.I0.data[cy * WIDTH + cx], 2);
  });

  it('labels the regions and the true flow', () => {
    const { label, layer } = regions();
    CARD_CENTERS.forEach(([cx, cy], k) => {
      expect(layer[cy * WIDTH + cx]).toBe(k);
      expect(label[cy * WIDTH + cx]).toBe(k + 1);
      expect(label[(cy - 21) * WIDTH + cx]).toBe(1);
    });
    expect(label[60 * WIDTH + 80]).toBe(0);
    expect(s.truth.u[CARD_CENTERS[2][1] * WIDTH + CARD_CENTERS[2][0]]).toBe(2);
    expect(s.truth.u[60 * WIDTH + 80]).toBe(-1);
  });

  it('marks motion boundaries and occluded background', () => {
    const [cx, cy] = CARD_CENTERS[0];
    expect(s.boundary[cy * WIDTH + cx + 24]).toBe(1);
    expect(s.boundary[cy * WIDTH + cx]).toBe(0);
    // The card moves right and the background left: background just right of the card disappears.
    expect(s.occluded[cy * WIDTH + cx + 26]).toBe(1);
    expect(s.occluded[cy * WIDTH + cx - 27]).toBe(0);
    expect(s.occluded.length).toBe(WIDTH * HEIGHT);
  });
});
