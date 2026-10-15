/**
 * The simple binocular stereo setup, seen from above: two cameras with parallel optical axes, the left one at the
 * origin and the right one at a baseline T along the X axis, both with focal length f (in pixels).
 *
 * Conventions:
 *  - Top view in meters: X to the right, Z forward (the viewing direction); Y does not matter here.
 *  - Image coordinates x in pixels, measured from the principal point; pixel centers lie at integer x, so a measured
 *    position is rounded to the nearest integer.
 *  - x_L / f = X / Z and x_R / f = (X − T) / Z, so the disparity d = x_L − x_R = f T / Z.
 */

export interface Point {
  X: number;
  Z: number;
}

export interface Projections {
  xL: number;
  xR: number;
}

export function project(T: number, f: number, p: Point): Projections {
  return { xL: (f * p.X) / p.Z, xR: (f * (p.X - T)) / p.Z };
}

/**
 * The intersection of the rays through x_L and x_R: Z = f T / d and X = x_L Z / f. Null if d ≤ 0, where the rays
 * are parallel or meet behind the cameras.
 */
export function triangulate(T: number, f: number, xL: number, xR: number): Point | null {
  const d = xL - xR;
  if (d <= 1e-12) return null;
  const Z = (f * T) / d;
  return { X: (xL * Z) / f, Z };
}

/** How much the depth changes when the disparity changes by one pixel: ∂Z/∂d = f T / d² = Z² / (f T). */
export const depthResolution = (T: number, f: number, Z: number) => (Z * Z) / (f * T);

/**
 * All points with Z ≤ zMax that project to the same pair of pixels: the left camera's pixel-wide wedge
 * x_L − ½ ≤ f X / Z ≤ x_L + ½, clipped to the right camera's wedge x_R − ½ ≤ f (X − T) / Z ≤ x_R + ½. A polygon; when
 * d ≤ 1 its far side reaches zMax.
 */
export function pixelCell(T: number, f: number, xL: number, xR: number, zMax: number): Point[] {
  let poly: Point[] = [
    { X: 0, Z: 0 },
    { X: ((xL + 0.5) / f) * zMax, Z: zMax },
    { X: ((xL - 0.5) / f) * zMax, Z: zMax },
  ];
  // Keep the side where g(p) ≥ 0, for the two edges of the right wedge.
  const halfPlanes = [(p: Point) => p.X - T - ((xR - 0.5) / f) * p.Z, (p: Point) => ((xR + 0.5) / f) * p.Z - (p.X - T)];
  for (const g of halfPlanes) {
    const out: Point[] = [];
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length];
      const ga = g(a), gb = g(b);
      if (ga >= 0) out.push(a);
      if (ga >= 0 !== gb >= 0) {
        const t = ga / (ga - gb);
        out.push({ X: a.X + t * (b.X - a.X), Z: a.Z + t * (b.Z - a.Z) });
      }
    });
    poly = out;
  }
  return poly;
}

/** Whether a point is in front of both cameras and inside both images of width W pixels. */
export function visibleInBoth(T: number, f: number, W: number, p: Point): boolean {
  if (p.Z <= 0) return false;
  const { xL, xR } = project(T, f, p);
  return Math.abs(xL) <= W / 2 && Math.abs(xR) <= W / 2;
}
