import { Pane } from 'tweakpane';
import { type Plane, planeToImage, toGray } from '../../src/shared/image';
import { addImagePicker } from '../../src/shared/imagePicker';
import { gaussianNoise } from '../../src/shared/noise';
import { initPage } from '../../src/shared/page';
import { PixelView, type ViewTransform, perFrame } from '../../src/shared/pixelView';
import { Plot, type PlotFrame, ticks } from '../../src/shared/plot';
import { eq, fmt } from '../../src/shared/tex';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import {
  type Smoothing,
  derivativeX,
  edgeMap,
  edgePeaks,
  filterWithGaussianDerivative,
  gaussianDerivative,
  gaussianDerivativeAt,
  row,
  smooth,
  zeroCrossings,
} from './derivatives';
import '../../src/shared/styles/demo.css';

initPage({ title: 'Derivatives & noise', chapterId: 'edges' });

const W = 160;
const H = 120;

function defaults() {
  return { noise: 0.02, seed: 1, sigma: 1.5, smoothing: 'row' as Smoothing, threshold: 0.05, allEdges: false, gain: 2, x: 22, y: 78 };
}
const state = defaults();

const pane = new Pane({ container: document.getElementById('controls')!, title: 'Derivatives & noise' });
let original: Plane = toGray(
  addImagePicker(pane, { names: ['scene', 'chart', 'text', 'gradients'], value: 'scene', width: W, height: H }, (img) => {
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
const smoothFolder = pane.addFolder({ title: 'Gaussian g' });
smoothFolder.addBinding(state, 'sigma', { label: 'σ', min: 0.5, max: 6, step: 0.1 });
smoothFolder.addBinding(state, 'smoothing', { label: 'smooth along', options: { 'row only': 'row', 'x and y': 'xy' } });
pane.addBinding(state, 'threshold', { label: 'edge threshold t', min: 0.005, max: 0.3, step: 0.005 });
pane.addBinding(state, 'allEdges', { label: 'edges of all rows' });
pane.addBinding(state, 'gain', { label: 'derivative contrast', options: { '1×': 1, '2×': 2, '4×': 4, '8×': 8 } });
pane.addButton({ title: 'Reset' }).on('click', () => {
  Object.assign(state, defaults());
  pane.refresh();
});

const pick = (x: number, y: number) => {
  state.x = x;
  state.y = y;
  schedule();
};
const noisyView = new PixelView(document.getElementById('noisy-view')!, pick);
const smoothView = new PixelView(document.getElementById('smooth-view')!, pick);
const rawView = new PixelView(document.getElementById('raw-view')!, pick);
const derivView = new PixelView(document.getElementById('deriv-view')!, pick);
const profilePlot = new Plot(document.getElementById('profile-plot')!, 200);
const derivPlot = new Plot(document.getElementById('deriv-plot')!, 220);
const secondPlot = new Plot(document.getElementById('second-plot')!, 170);
const kernelPlot = new Plot(document.getElementById('kernel-plot')!, 170);
const values = document.getElementById('values')!;

interface Result {
  key: string;
  original: Plane;
  noisy: Plane;
  smoothed: Plane;
  raw: Plane;
  /** Derivative of the image without noise, which sets the scale of the derivative plot. */
  clean: Plane;
  derivative: Plane;
  filtered: Plane;
  second: Plane;
}
let cache: Result | null = null;
let peaks: number[] = [];
/** Edge peaks of every row, of d/dx (f ∗ g) and of df/dx; null while the toggle is off. */
let edges: { smoothed: Uint8Array; raw: Uint8Array } | null = null;

function paintEdges(ctx: CanvasRenderingContext2D, t: ViewTransform, map: Uint8Array): void {
  const size = Math.max(t.scale, 1);
  ctx.fillStyle = cssColor('--viz-points');
  ctx.beginPath();
  map.forEach((v, i) => {
    if (!v) return;
    const [x, y] = t.toView(i % W, Math.floor(i / W));
    ctx.rect(x, y, size, size);
  });
  ctx.fill();
}

function marker(ctx: CanvasRenderingContext2D, t: ViewTransform, map?: Uint8Array): void {
  if (map) paintEdges(ctx, t, map);
  const [, rowY] = t.toView(0, state.y + 0.5);
  ctx.strokeStyle = cssColor('--viz-highlight');
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, rowY);
  ctx.lineTo(ctx.canvas.width, rowY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = cssColor('--viz-points');
  ctx.lineWidth = 2;
  for (const m of peaks) {
    const [x] = t.toView(m + 0.5, 0);
    ctx.beginPath();
    ctx.moveTo(x, rowY - 7);
    ctx.lineTo(x, rowY + 7);
    ctx.stroke();
  }
  const [px, py] = t.toView(state.x, state.y);
  const size = Math.max(t.scale, 6);
  ctx.strokeStyle = cssColor('--viz-highlight');
  ctx.strokeRect(px + (t.scale - size) / 2, py + (t.scale - size) / 2, size, size);
}
for (const view of [noisyView, smoothView, derivView]) view.overlay = (ctx, t) => marker(ctx, t, edges?.smoothed);
rawView.overlay = (ctx, t) => marker(ctx, t, edges?.raw);

const signed = (p: Plane) => planeToImage({ ...p, data: p.data.map((v) => 0.5 + state.gain * v) });
const points = (r: ArrayLike<number>) => Array.from(r, (v, m) => [m + 0.5, v] as const);

/** Selected column and detected edges, drawn behind the curves. */
function markers(p: PlotFrame, crossings: number[] = []): void {
  for (const m of peaks) p.vline(m + 0.5, '--viz-object', { alpha: 0.45 });
  for (const x of crossings) p.vline(x + 0.5, '--viz-object', { alpha: 0.2 });
  p.vline(state.x + 0.5, '--viz-highlight', { dash: [4, 4] });
}

function update(): void {
  const key = JSON.stringify([state.noise, state.seed, state.sigma, state.smoothing]);
  if (cache?.key !== key || cache.original !== original) {
    const noisy = gaussianNoise(original, state.noise, state.seed);
    const smoothed = smooth(noisy, state.sigma, state.smoothing);
    const derivative = derivativeX(smoothed);
    cache = {
      key,
      original,
      noisy,
      smoothed,
      raw: derivativeX(noisy),
      clean: derivativeX(original),
      derivative,
      filtered: filterWithGaussianDerivative(noisy, state.sigma, state.smoothing),
      second: derivativeX(derivative),
    };
  }
  const c = cache;
  const y = state.y;
  const d = row(c.derivative, y);
  const s = row(c.second, y);
  peaks = edgePeaks(d, state.threshold);
  const crossings = zeroCrossings(s, d, state.threshold);
  edges = state.allEdges ? { smoothed: edgeMap(c.derivative, state.threshold), raw: edgeMap(c.raw, state.threshold) } : null;

  noisyView.show(planeToImage(c.noisy));
  smoothView.show(planeToImage(c.smoothed));
  rawView.show(signed(c.raw));
  derivView.show(signed(c.derivative));
  document.getElementById('smooth-caption')!.textContent =
    `σ = ${fmt(state.sigma, 1)}, ${state.smoothing === 'row' ? 'along the rows' : 'along x and y'}`;

  const xTicks = ticks(0, W, 8);
  profilePlot.render({ x: [0, W], y: [-0.05, 1.05] }, (p) => {
    p.grid(xTicks, [0, 0.25, 0.5, 0.75, 1], { y: (v) => fmt(v, 2) });
    markers(p);
    p.line(points(row(c.noisy, y)), '--fg-faint', { width: 1 });
    p.line(points(row(c.original, y)), '--fg-muted', { width: 1.5, dash: [5, 3] });
    p.line(points(row(c.smoothed, y)), '--accent', { width: 2.5 });
  });

  const t = state.threshold;
  const dMax = 1.15 * Math.max(0.05, 1.2 * t, ...Array.from(row(c.clean, y), Math.abs), ...Array.from(d, Math.abs));
  derivPlot.render({ x: [0, W], y: [-dMax, dMax] }, (p) => {
    p.grid(xTicks, ticks(-dMax, dMax, 4), { y: (v) => String(+v.toPrecision(2)) });
    markers(p);
    for (const level of [t, -t])
      p.line(
        [
          [0, level],
          [W, level],
        ],
        '--fg-muted',
        { width: 1, dash: [3, 3] },
      );
    p.line(points(row(c.raw, y)), '--fg-faint', { width: 1 });
    p.line(points(d), '--accent', { width: 2.5 });
    p.line(points(row(c.filtered, y)), '--viz-points', { width: 1.5, dash: [6, 4] });
    p.stems(
      peaks.map((m) => [m + 0.5, d[m]] as const),
      '--viz-object',
    );
  });

  const sMax = Math.max(1e-4, ...Array.from(s, Math.abs)) * 1.15;
  secondPlot.render({ x: [0, W], y: [-sMax, sMax] }, (p) => {
    p.grid(xTicks, ticks(-sMax, sMax, 4), { y: (v) => String(+v.toPrecision(2)) });
    markers(p, crossings);
    p.line(points(s), '--accent', { width: 2 });
    p.stems(
      crossings.map((x) => [x + 0.5, 0] as const),
      '--viz-object',
    );
  });

  const dg = gaussianDerivative(state.sigma);
  const r = (dg.length - 1) / 2;
  const g0 = 1 / (Math.sqrt(2 * Math.PI) * state.sigma);
  const kMax = Math.max(...dg);
  kernelPlot.render({ x: [-r - 1.5, r + 1.5], y: [-kMax * 1.25, Math.max(g0, kMax) * 1.15] }, (p) => {
    p.grid(ticks(-r - 1, r + 1, 10), ticks(-kMax, Math.max(g0, kMax), 4), { y: (v) => String(+v.toPrecision(2)) });
    p.line((x) => g0 * Math.exp(-(x * x) / (2 * state.sigma ** 2)), '--fg-faint', { width: 1.5 });
    p.line((x) => gaussianDerivativeAt(x, state.sigma), '--viz-highlight', { width: 1.5, dash: [5, 3] });
    p.stems(
      Array.from(dg, (v, m) => [m - r, v] as const),
      '--accent',
      3,
    );
  });

  renderValues(c, crossings.length);
}
const schedule = perFrame(update);

function renderValues(c: Result, crossings: number): void {
  const { x, y, threshold: t } = state;
  const i = y * W + x;
  // Outside the image, the edge pixel is repeated.
  const [xl, xr] = [Math.max(x - 1, 0), Math.min(x + 1, W - 1)];
  const left = c.noisy.data[y * W + xl];
  const right = c.noisy.data[y * W + xr];
  const rawPeaks = edgePeaks(row(c.raw, y), t).length;
  const shown = peaks.length <= 14 ? peaks.join(', ') : `${peaks.slice(0, 14).join(', ')}, …`;

  values.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <h3>Pixel (${x}, ${y})</h3>
        ${eq(`f = ${fmt(c.noisy.data[i], 3)}, \\qquad \\text{without noise } ${fmt(c.original.data[i], 3)}`)}
        ${eq(`(f * g) = ${fmt(c.smoothed.data[i], 3)}`)}
        ${eq(`\\frac{d f}{dx} \\approx \\frac{f[${xr}] - f[${xl}]}{2} = \\frac{${fmt(right, 3)} - ${fmt(left, 3)}}{2} = ${fmt(c.raw.data[i], 4)}`)}
      </div>
      <div class="value-block">
        <h3>Smoothed derivative at (${x}, ${y})</h3>
        ${eq(`\\frac{d}{dx}(f * g) = \\htmlClass{result}{${fmt(c.derivative.data[i], 4)}}`)}
        ${eq(`f * \\frac{dg}{dx} = \\htmlClass{result}{${fmt(c.filtered.data[i], 4)}}`)}
        ${eq(`\\frac{d^2}{dx^2}(f * g) = ${fmt(c.second.data[i], 5)}`)}
      </div>
      <div class="value-block">
        <h3>Edges along row ${y}, threshold t = ${fmt(t, 3)}</h3>
        ${eq(`\\text{peaks of } \\left|\\frac{d f}{dx}\\right| \\ge t \\text{ without smoothing: } ${rawPeaks}`)}
        ${eq(`\\text{peaks of } \\left|\\frac{d}{dx}(f * g)\\right| \\ge t\\text{: } \\htmlClass{result}{${peaks.length}}`)}
        ${eq(`\\text{zero crossings of } \\frac{d^2}{dx^2}(f * g) \\text{ there: } ${crossings}`)}
        <p class="muted small">${peaks.length ? `Edges at columns ${shown}.` : 'No edges above the threshold.'}</p>
      </div>
      ${edges ? allRows(edges) : ''}
    </div>`;
}

function allRows({ smoothed, raw }: { smoothed: Uint8Array; raw: Uint8Array }): string {
  const sum = (map: Uint8Array) => map.reduce((a, b) => a + b, 0);
  return `
      <div class="value-block">
        <h3>Edge pixels in all ${H} rows</h3>
        ${eq(`\\text{without smoothing: } ${sum(raw)}`)}
        ${eq(`\\text{with smoothing: } \\htmlClass{result}{${sum(smoothed)}}`)}
      </div>`;
}

pane.on('change', schedule);
onThemeChange(schedule);
update();
