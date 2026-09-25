import { Pane } from 'tweakpane';
import { derivatives, eigen } from '../../src/shared/harris';
import { type Plane, createPlane, planeToImage, toGray } from '../../src/shared/image';
import { pixelAt } from '../../src/shared/filter';
import { addImagePicker } from '../../src/shared/imagePicker';
import { gaussianNoise } from '../../src/shared/noise';
import { initPage } from '../../src/shared/page';
import { PixelView, type ViewTransform, perFrame } from '../../src/shared/pixelView';
import { Plot, ticks } from '../../src/shared/plot';
import { eq, fmt, texMatrix } from '../../src/shared/tex';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import { type Structure, type WindowType, autocorrelation, classify, quadratic, secondMomentAt, windowWeights } from './autocorrelation';
import '../../src/shared/styles/demo.css';
import './autocorrelation.css';

initPage({ title: 'Autocorrelation surface', chapterId: 'corners' });

const W = 160;
const H = 120;

function defaults() {
  return { noise: 0, window: 'gaussian' as WindowType, radius: 4, range: 5, white: 0.05, large: 0.002, x: 62, y: 50, u: 2, v: 1 };
}
const state = defaults();

const pane = new Pane({ container: document.getElementById('controls')!, title: 'Autocorrelation' });
let original: Plane = toGray(
  addImagePicker(pane, { names: ['shapes', 'scene', 'chart', 'text'], value: 'shapes', width: W, height: H }, (img) => {
    original = toGray(img);
    schedule();
  }),
);
pane.addBinding(state, 'noise', { label: 'noise σₙ', min: 0, max: 0.1, step: 0.005 });
const windowFolder = pane.addFolder({ title: 'Window w' });
windowFolder.addBinding(state, 'window', { label: 'type', options: { Gaussian: 'gaussian', box: 'box' } });
windowFolder.addBinding(state, 'radius', { label: 'radius r', min: 1, max: 10, step: 1 });
pane.addBinding(state, 'range', { label: 'shifts |u|, |v| ≤', min: 2, max: 12, step: 1 });
pane.addBinding(state, 'white', {
  label: 'white at E =',
  options: { '0.005': 0.005, '0.01': 0.01, '0.02': 0.02, '0.05': 0.05, '0.1': 0.1, '0.2': 0.2 },
});
pane.addBinding(state, 'large', { label: 'λ large if ≥', min: 0.0005, max: 0.02, step: 0.0005 });
pane.addButton({ title: 'Reset' }).on('click', () => {
  Object.assign(state, defaults());
  pane.refresh();
});

const clampShift = (s: number) => Math.max(-state.range, Math.min(state.range, s));
const setShift = (u: number, v: number) => {
  state.u = clampShift(u);
  state.v = clampShift(v);
  schedule();
};
const imageView = new PixelView(document.getElementById('image-view')!, (x, y) => {
  state.x = x;
  state.y = y;
  schedule();
});
const half = () => state.radius + state.range;
const patchView = new PixelView(document.getElementById('patch-view')!, (x, y) => setShift(x - half(), y - half()));
const eView = new PixelView(document.getElementById('e-view')!, (u, v) => setShift(u - state.range, v - state.range));
const qView = new PixelView(document.getElementById('q-view')!, (u, v) => setShift(u - state.range, v - state.range));
const sectionPlot = new Plot(document.getElementById('section-plot')!, 220);
const values = document.getElementById('values')!;

/** The (2h + 1)² neighborhood of (x0, y0), with edge pixels copied outside the image. */
function crop(I: Plane, x0: number, y0: number, h: number): Plane {
  const n = 2 * h + 1;
  const out = createPlane(n, n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out.data[y * n + x] = pixelAt(I, x0 + x - h, y0 + y - h, 'clamp');
  return out;
}

function square(ctx: CanvasRenderingContext2D, t: ViewTransform, x0: number, y0: number, r: number, color: string, dash: number[] = []): void {
  const [x, y] = t.toView(x0 - r, y0 - r);
  ctx.strokeStyle = cssColor(color);
  ctx.lineWidth = 2;
  ctx.setLineDash(dash);
  ctx.strokeRect(x, y, (2 * r + 1) * t.scale, (2 * r + 1) * t.scale);
  ctx.setLineDash([]);
}

/** The window around (cx, cy) and the window shifted by (u, v). */
function windows(cx: number, cy: number) {
  return (ctx: CanvasRenderingContext2D, t: ViewTransform) => {
    square(ctx, t, cx + state.u, cy + state.v, state.radius, '--viz-points', [5, 4]);
    square(ctx, t, cx, cy, state.radius, '--viz-highlight');
  };
}

let M: [number, number, number] = [0, 0, 0];

/** The ellipse [u v] M [u v]ᵀ = k, the zero shift and the selected shift. */
function surfaceOverlay(ctx: CanvasRenderingContext2D, t: ViewTransform): void {
  const R = state.range;
  const [cx, cy] = t.toView(R + 0.5, R + 0.5);
  const { l1, l2, angle } = eigen(...M);
  const k = state.white / 2;
  const maxAxis = 50 * R * t.scale;
  const axis = (l: number) => Math.min(maxAxis, Math.sqrt(k / Math.max(l, 1e-12)) * t.scale);
  ctx.strokeStyle = cssColor('--accent');
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(cx, cy, axis(l1), axis(l2), angle, 0, 2 * Math.PI);
  ctx.stroke();

  ctx.strokeStyle = cssColor('--fg-faint');
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - t.scale / 3, cy);
  ctx.lineTo(cx + t.scale / 3, cy);
  ctx.moveTo(cx, cy - t.scale / 3);
  ctx.lineTo(cx, cy + t.scale / 3);
  ctx.stroke();

  const [sx, sy] = t.toView(R + state.u, R + state.v);
  ctx.strokeStyle = cssColor('--viz-points');
  ctx.lineWidth = 2;
  ctx.strokeRect(sx + 1, sy + 1, t.scale - 2, t.scale - 2);
}

eView.overlay = surfaceOverlay;
qView.overlay = surfaceOverlay;

let cache: { key: string; original: Plane; noisy: Plane; d: ReturnType<typeof derivatives> } | null = null;

const STRUCTURE_TEXT: Record<Structure, string> = {
  flat: 'a flat region: both eigenvalues small',
  edge: 'an edge: one large eigenvalue',
  corner: 'a corner: both eigenvalues large',
};

function update(): void {
  if (cache?.key !== String(state.noise) || cache.original !== original) {
    const noisy = gaussianNoise(original, state.noise, 1);
    cache = { key: String(state.noise), original, noisy, d: derivatives(noisy, 0) };
  }
  const { noisy, d } = cache;
  const R = state.range;
  state.u = clampShift(state.u);
  state.v = clampShift(state.v);
  const w = windowWeights(state.radius, state.window);
  const E = autocorrelation(noisy, state.x, state.y, w, R);
  M = secondMomentAt(d, state.x, state.y, w);
  const n = 2 * R + 1;
  const Q = createPlane(n, n);
  for (let v = -R; v <= R; v++) for (let u = -R; u <= R; u++) Q.data[(v + R) * n + u + R] = quadratic(M, u, v);

  const heat = (p: Plane) => planeToImage({ ...p, data: p.data.map((e) => e / state.white) });
  imageView.overlay = windows(state.x, state.y);
  imageView.show(planeToImage(noisy));
  patchView.overlay = windows(half(), half());
  patchView.show(planeToImage(crop(noisy, state.x, state.y, half())));
  eView.show(heat(E));
  qView.show(heat(Q));

  const shifts = Array.from({ length: n }, (_, i) => i - R);
  const alongU = shifts.map((u) => [u, E.data[R * n + u + R]] as const);
  const alongV = shifts.map((v) => [v, E.data[(v + R) * n + R]] as const);
  const yMax = 1.15 * Math.max(1e-4, ...alongU.map((p) => p[1]), ...alongV.map((p) => p[1]));
  sectionPlot.render({ x: [-R - 0.5, R + 0.5], y: [0, yMax] }, (p) => {
    p.grid(ticks(-R, R, 10), ticks(0, yMax, 4), { y: (v) => String(+v.toPrecision(2)) });
    p.line((u) => M[0] * u * u, '--accent', { width: 1.5, dash: [6, 4] });
    p.line((v) => M[2] * v * v, '--viz-points', { width: 1.5, dash: [6, 4] });
    p.line(alongU, '--accent', { width: 2 });
    p.line(alongV, '--viz-points', { width: 2 });
  });

  renderValues(E, noisy);
}
const schedule = perFrame(update);

function renderValues(E: Plane, I: Plane): void {
  const { x, y, u, v, range: R, radius: r } = state;
  const e = E.data[(v + R) * (2 * R + 1) + u + R];
  const q = quadratic(M, u, v);
  const { l1, l2 } = eigen(...M);
  const structure = classify(l1, l2, state.large);
  const size = 2 * r + 1;

  values.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <h3>Shift (u, v) = (${u}, ${v}) of the ${size} × ${size} window at (${x}, ${y})</h3>
        ${eq(`I(${x}, ${y}) = ${fmt(pixelAt(I, x, y, 'clamp'), 3)}, \\qquad I(${x + u}, ${y + v}) = ${fmt(pixelAt(I, x + u, y + v, 'clamp'), 3)}`)}
        ${eq(`E(u, v) = \\sum_{x, y} w(x, y) \\left[ I(x + u, y + v) - I(x, y) \\right]^2 = \\htmlClass{result}{${fmt(e, 5)}}`)}
        ${eq(`\\begin{bmatrix} u & v \\end{bmatrix} M \\begin{bmatrix} u \\\\ v \\end{bmatrix} = ${fmt(M[0], 5)} \\cdot ${u * u} + 2 \\cdot ${fmt(M[1], 5)} \\cdot ${u * v} + ${fmt(M[2], 5)} \\cdot ${v * v} = \\htmlClass{result}{${fmt(q, 5)}}`)}
      </div>
      <div class="value-block">
        <h3>Second moment matrix</h3>
        ${eq(`M = \\sum_{x, y} w(x, y) \\begin{bmatrix} I_x^2 & I_x I_y \\\\ I_x I_y & I_y^2 \\end{bmatrix} = ${texMatrix(
          [
            [M[0], M[1]],
            [M[1], M[2]],
          ],
          5,
        )}`)}
      </div>
      <div class="value-block">
        <h3>Eigenvalues</h3>
        ${eq(`\\lambda_1 = ${fmt(l1, 5)}, \\qquad \\lambda_2 = ${fmt(l2, 5)}`)}
        ${eq(`\\text{large: } \\lambda \\ge ${fmt(state.large, 4)}`)}
        <p class="small">This window is <strong>${STRUCTURE_TEXT[structure]}</strong>.</p>
      </div>
    </div>`;
}

pane.on('change', schedule);
onThemeChange(schedule);
update();
