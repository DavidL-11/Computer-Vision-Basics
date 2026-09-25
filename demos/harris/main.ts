import { Pane } from 'tweakpane';
import { type Corner, type Harris, cornerness, eigen, harris, harrisResponse, localMaxima, maxOf } from '../../src/shared/harris';
import { type Plane, type RGB, createImage, planeToImage, toGray } from '../../src/shared/image';
import { addImagePicker } from '../../src/shared/imagePicker';
import { gaussianNoise } from '../../src/shared/noise';
import { initPage } from '../../src/shared/page';
import { PixelView, type ViewTransform, perFrame } from '../../src/shared/pixelView';
import { Plot, type PlotFrame, ticks } from '../../src/shared/plot';
import { eq, fmt, texMatrix } from '../../src/shared/tex';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import '../../src/shared/styles/demo.css';
import './harris.css';

initPage({ title: 'Harris corner detector', chapterId: 'corners' });

const W = 240;
const H = 180;

function defaults() {
  return { noise: 0, seed: 1, sigmaD: 1, sigmaI: 2, alpha: 0.05, threshold: 0.01, radius: 3, grid: false, zoom: 1, x: 92, y: 73 };
}
const state = defaults();

const pane = new Pane({ container: document.getElementById('controls')!, title: 'Harris' });
let original: Plane = toGray(
  addImagePicker(pane, { names: ['shapes', 'scene', 'chart', 'text'], value: 'shapes', width: W, height: H }, (img) => {
    original = toGray(img);
    schedule();
  }),
);
const noiseFolder = pane.addFolder({ title: 'Noise' });
noiseFolder.addBinding(state, 'noise', { label: 'σₙ', min: 0, max: 0.2, step: 0.005 });
noiseFolder.addButton({ title: 'New noise' }).on('click', () => {
  state.seed++;
  schedule();
});
pane.addBinding(state, 'sigmaD', { label: 'blur σ_D', min: 0, max: 3, step: 0.1 });
pane.addBinding(state, 'sigmaI', { label: 'window σ', min: 0.5, max: 5, step: 0.1 });
pane.addBinding(state, 'alpha', { label: 'α', min: 0, max: 0.25, step: 0.005 });
pane.addBinding(state, 'threshold', { label: 't (× max C)', min: 0, max: 0.5, step: 0.001 });
pane.addBinding(state, 'radius', { label: 'NMS radius', min: 1, max: 10, step: 1 });
pane.addBinding(state, 'grid', { label: 'ellipses on a grid' });
pane.addBinding(state, 'zoom', { label: 'zoom', options: { '1×': 1, '2×': 2, '4×': 4, '8×': 8 } });
pane.addButton({ title: 'Reset' }).on('click', () => {
  Object.assign(state, defaults());
  Object.assign(center, { x: state.x, y: state.y });
  pane.refresh();
});

const center = { x: state.x, y: state.y };
const pick = (x: number, y: number, e: PointerEvent) => {
  state.x = x;
  state.y = y;
  if (e.type === 'pointerdown') Object.assign(center, { x, y });
  schedule();
};
const view = (id: string) => new PixelView(document.getElementById(id)!, pick);
const imageView = view('image-view');
const ixView = view('ix-view');
const iyView = view('iy-view');
const sxxView = view('sxx-view');
const syyView = view('syy-view');
const sxyView = view('sxy-view');
const responseView = view('response-view');
const peaksView = view('peaks-view');
const views = [imageView, ixView, iyView, sxxView, syyView, sxyView, responseView, peaksView];
const lambdaPlot = new Plot(document.getElementById('lambda-plot')!, 290, { left: 46, right: 12, top: 12, bottom: 26 });
const values = document.getElementById('values')!;

interface Detector {
  key: string;
  original: Plane;
  noisy: Plane;
  h: Harris;
  l1: Float32Array;
  l2: Float32Array;
  /** Axis range of the λ plane: a high percentile of λ₁, so that single outliers don't squeeze the plot. */
  range: number;
}
let detector: Detector | null = null;
let response: Plane | null = null;
let corners: Corner[] = [];
let t = 0;

function selection(ctx: CanvasRenderingContext2D, v: ViewTransform): void {
  const [px, py] = v.toView(state.x, state.y);
  const size = Math.max(v.scale, 6);
  ctx.strokeStyle = cssColor('--viz-highlight');
  ctx.lineWidth = 2;
  ctx.strokeRect(px + (v.scale - size) / 2, py + (v.scale - size) / 2, size, size);
}

/** The ellipse [u v] M [u v]ᵀ = k at pixel (x, y); a pixel with λ = the plot range gets semi-axes of 1.5σ. */
function ellipse(ctx: CanvasRenderingContext2D, v: ViewTransform, x: number, y: number): void {
  const { m } = detector!.h;
  const i = y * W + x;
  const { l1, l2, angle } = eigen(m.sxx.data[i], m.sxy.data[i], m.syy.data[i]);
  const r = 1.5 * state.sigmaI;
  const axis = (l: number) => Math.min(3 * r, r * Math.sqrt(detector!.range / Math.max(l, 1e-12))) * v.scale;
  const [cx, cy] = v.toView(x + 0.5, y + 0.5);
  ctx.beginPath();
  ctx.ellipse(cx, cy, axis(l1), axis(l2), angle, 0, 2 * Math.PI);
  ctx.stroke();
}

function cornerMarks(ctx: CanvasRenderingContext2D, v: ViewTransform, radius: number): void {
  ctx.strokeStyle = cssColor('--viz-points');
  ctx.lineWidth = 2;
  for (const c of corners) {
    const [cx, cy] = v.toView(c.x + 0.5, c.y + 0.5);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
    ctx.stroke();
  }
}

function imageOverlay(ctx: CanvasRenderingContext2D, v: ViewTransform): void {
  if (!detector) return;
  if (state.grid) {
    ctx.strokeStyle = cssColor('--accent');
    ctx.lineWidth = 1;
    const step = 12;
    for (let y = step / 2; y < H; y += step)
      for (let x = step / 2; x < W; x += step) {
        // Only where the short axis is at most twice its minimum: weak structure would give a clutter of circles.
        if (detector.l1[y * W + x] >= detector.range / 4) ellipse(ctx, v, x, y);
      }
  }
  cornerMarks(ctx, v, Math.max(4, v.scale * 1.5));
  ctx.strokeStyle = cssColor('--viz-highlight');
  ctx.lineWidth = 2;
  ellipse(ctx, v, state.x, state.y);
  selection(ctx, v);
}

for (const v of views) v.overlay = selection;
imageView.overlay = imageOverlay;
peaksView.overlay = (ctx, v) => {
  cornerMarks(ctx, v, Math.max(3, v.scale));
  selection(ctx, v);
};

/** 'rgb(r, g, b)' → [r, g, b] in [0, 1] */
const tokenRgb = (name: string) => (cssColor(name).match(/[\d.]+/g) ?? ['0', '0', '0']).slice(0, 3).map((c) => Number(c) / 255) as RGB;
const maxAbs = (...planes: Plane[]) => planes.reduce((m, p) => p.data.reduce((a, v) => Math.max(a, Math.abs(v)), m), 1e-12);
const scaled = (p: Plane, max: number) => planeToImage({ ...p, data: p.data.map((v) => v / max) });
const signed = (p: Plane, max: number) => planeToImage({ ...p, data: p.data.map((v) => 0.5 + v / (2 * max)) });
/** Signed square root, so that the weak negative response of edges stays visible next to strong corners. */
const signedSqrt = (p: Plane, max: number) =>
  planeToImage({ ...p, data: p.data.map((v) => 0.5 + 0.5 * Math.sign(v) * Math.sqrt(Math.abs(v) / max)) });

function update(): void {
  const key = JSON.stringify([state.noise, state.seed, state.sigmaD, state.sigmaI]);
  if (detector?.key !== key || detector.original !== original) {
    const noisy = gaussianNoise(original, state.noise, state.seed);
    const h = harris(noisy, state);
    const l1 = new Float32Array(W * H);
    const l2 = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const e = eigen(h.m.sxx.data[i], h.m.sxy.data[i], h.m.syy.data[i]);
      l1[i] = e.l1;
      l2[i] = e.l2;
    }
    const sorted = Float32Array.from(l1).sort();
    const range = Math.max(1e-6, 1.1 * sorted[Math.floor(0.995 * (sorted.length - 1))]);
    detector = { key, original, noisy, h, l1, l2, range };
  }
  const { noisy, h } = detector;
  response = harrisResponse(h.m, state.alpha);
  const maxC = Math.max(0, maxOf(response));
  t = state.threshold * maxC;
  corners = localMaxima(response, t, state.radius);

  imageView.show(planeToImage(noisy));
  const dMax = maxAbs(h.d.ix, h.d.iy);
  ixView.show(signed(h.d.ix, dMax));
  iyView.show(signed(h.d.iy, dMax));
  const sMax = maxAbs(h.m.sxx, h.m.syy);
  sxxView.show(scaled(h.m.sxx, sMax));
  syyView.show(scaled(h.m.syy, sMax));
  sxyView.show(signed(h.m.sxy, sMax));
  responseView.show(signedSqrt(response, maxAbs(response)));
  const above = createImage(W, H);
  const accent = tokenRgb('--accent');
  response.data.forEach((c, i) => {
    if (c > 0 && c >= t) above.data.set(accent, i * 3);
  });
  peaksView.show(above);
  for (const v of views) v.setZoom(state.zoom, center.x + 0.5, center.y + 0.5);

  renderPlane();
  renderValues(maxC);
}
const schedule = perFrame(update);

function renderPlane(): void {
  const d = detector!;
  const L = d.range;
  const alpha = state.alpha;
  lambdaPlot.render({ x: [0, L], y: [0, L] }, (p: PlotFrame) => {
    const { ctx } = p;
    const cell = 3;
    const cornerColor = cssColor('--accent');
    const edgeColor = cssColor('--viz-points');
    ctx.save();
    for (let py = 0; py < p.height; py += cell)
      for (let px = 0; px < p.width; px += cell) {
        const l1 = ((px + cell / 2) / p.width) * L;
        const l2 = (1 - (py + cell / 2) / p.height) * L;
        const c = l1 * l2 - alpha * (l1 + l2) ** 2;
        if (c > 0 && c >= t) {
          ctx.fillStyle = cornerColor;
          ctx.globalAlpha = 0.22;
        } else if (c <= -t && c < 0) {
          ctx.fillStyle = edgeColor;
          ctx.globalAlpha = 0.18;
        } else continue;
        ctx.fillRect(p.left + px, p.top + py, cell, cell);
      }
    ctx.restore();
    const tickValues = ticks(0, L, 4);
    p.grid(tickValues, tickValues, { x: (v) => String(+v.toPrecision(2)), y: (v) => String(+v.toPrecision(2)) });

    ctx.save();
    ctx.beginPath();
    ctx.rect(p.left, p.top, p.width, p.height);
    ctx.clip();
    ctx.fillStyle = cssColor('--fg-muted');
    ctx.globalAlpha = 0.3;
    for (let i = 0; i < d.l1.length; i += 2) ctx.fillRect(p.X(d.l1[i]) - 0.75, p.Y(d.l2[i]) - 0.75, 1.5, 1.5);
    ctx.globalAlpha = 1;
    ctx.fillStyle = cssColor('--viz-highlight');
    const i = state.y * W + state.x;
    ctx.beginPath();
    ctx.arc(p.X(Math.min(d.l1[i], L)), p.Y(Math.min(d.l2[i], L)), 5, 0, 2 * Math.PI);
    ctx.fill();
    ctx.restore();

    p.label('corner', 0.62 * L, 0.72 * L, '--accent');
    p.label('edge', 0.55 * L, 0.035 * L, '--viz-points');
    p.label('flat', 0.02 * L, 0.02 * L, '--fg-muted');
    p.label('λ₁', 0.98 * L, 0.035 * L, '--fg-muted', 'right');
    p.label('λ₂', 0.03 * L, 0.98 * L, '--fg-muted', 'left', 'top');
  });
}

function renderValues(maxC: number): void {
  const d = detector!;
  const { x, y } = state;
  const i = y * W + x;
  const { h } = d;
  const [a, b, c] = [h.m.sxx.data[i], h.m.sxy.data[i], h.m.syy.data[i]];
  const det = a * c - b * b;
  const trace = a + c;
  const C = cornerness(a, b, c, state.alpha);
  const { l1, l2 } = eigen(a, b, c);
  const aboveCount = response!.data.reduce((n, v) => n + (v > 0 && v >= t ? 1 : 0), 0);
  const isCorner = corners.some((k) => k.x === x && k.y === y);
  const status = isCorner
    ? 'a corner: above the threshold and a local maximum'
    : C > 0 && C >= t
      ? 'above the threshold, but suppressed by a larger neighbor'
      : C < 0
        ? 'not a corner: C < 0, edge-like'
        : 'not a corner: below the threshold';
  const e = (v: number) => (Math.abs(v) >= 1e-3 || v === 0 ? fmt(v, 5) : v.toExponential(2).replace(/e(.*)/, ' \\cdot 10^{$1}'));

  values.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <h3>1 · Derivatives at (${x}, ${y})</h3>
        ${eq(`I_x = ${fmt(h.d.ix.data[i], 4)}, \\qquad I_y = ${fmt(h.d.iy.data[i], 4)}`)}
        <h3>2–3 · Second moment matrix</h3>
        ${eq(`M = \\begin{bmatrix} g(I_x^2) & g(I_x I_y) \\\\ g(I_x I_y) & g(I_y^2) \\end{bmatrix} = ${texMatrix(
          [
            [a, b],
            [b, c],
          ],
          5,
        )}`)}
      </div>
      <div class="value-block">
        <h3>4 · Cornerness</h3>
        ${eq(`\\det M = ${e(det)}, \\qquad \\operatorname{trace} M = ${e(trace)}`)}
        ${eq(`C = \\det M - \\alpha \\operatorname{trace}(M)^2 = \\htmlClass{result}{${e(C)}}`)}
        ${eq(`\\lambda_1 = ${e(l1)}, \\quad \\lambda_2 = ${e(l2)}`)}
        ${eq(`\\lambda_1 \\lambda_2 - \\alpha (\\lambda_1 + \\lambda_2)^2 = ${e(l1 * l2 - state.alpha * (l1 + l2) ** 2)}`)}
      </div>
      <div class="value-block">
        <h3>5–6 · Threshold and non-maximum suppression</h3>
        ${eq(`t = ${fmt(state.threshold, 3)} \\cdot \\max C = ${fmt(state.threshold, 3)} \\cdot ${e(maxC)} = ${e(t)}`)}
        ${eq(`\\text{pixels with } C \\ge t\\text{: } ${aboveCount}`)}
        ${eq(`\\text{corners after suppression: } \\htmlClass{result}{${corners.length}}`)}
        <p class="small">(${x}, ${y}) is <strong>${status}</strong>.</p>
      </div>
    </div>`;
}

pane.on('change', schedule);
onThemeChange(schedule);
update();
