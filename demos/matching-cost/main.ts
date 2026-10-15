import { Controls } from '../../src/shared/controls';
import { type Plane, planeToImage, toGray } from '../../src/shared/image';
import { addImagePicker } from '../../src/shared/imagePicker';
import { gaussianNoise } from '../../src/shared/noise';
import { initPage } from '../../src/shared/page';
import { PixelView, type ViewTransform, perFrame } from '../../src/shared/pixelView';
import { Plot, ticks } from '../../src/shared/plot';
import { eq, fmt, renderTex } from '../../src/shared/tex';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import { IDENTITY, warp } from '../../src/shared/warp';
import { type Border, type CostParams, type Metric, best, cost, costSurface, fitGainBias, isSimilarity, rho, samples } from './cost';
import '../../src/shared/styles/demo.css';
import './matching-cost.css';

initPage({ title: 'Matching cost surface', chapterId: 'dense-motion' });

const W = 160;
const H = 120;

const METRICS: Record<Metric, { label: string; name: string }> = {
  ssd: { label: 'SSD', name: 'SSD' },
  sad: { label: 'SAD', name: 'SAD' },
  lp: { label: 'Lp norm', name: 'L_p' },
  gm: { label: 'Geman–McClure (SRD)', name: '\\text{GM}' },
  'gain-bias': { label: 'SSD with bias & gain', name: 'SSD_{\\alpha\\beta}' },
  cc: { label: 'cross-correlation (CC)', name: 'CC' },
  ncc: { label: 'normalized CC (NCC)', name: 'NCC' },
};

const defaults = () => ({
  metric: 'ssd' as Metric,
  p: 0.5,
  a: 0.1,
  border: 'clamp' as Border,
  radius: 4,
  range: 6,
  tu: 3,
  tv: -2,
  gain: 1,
  bias: 0,
  noise: 0.01,
  occluder: false,
  x: 57,
  y: 77,
  u: 3,
  v: -2,
});
const state = defaults();

const ui = new Controls();
const toolbar = ui.toolbar();
let original: Plane = toGray(
  addImagePicker(toolbar, { names: ['scene', 'shapes', 'text', 'chart', 'zone-plate'], value: 'scene', width: W, height: H }, (img) => {
    original = toGray(img);
    schedule();
  }),
);
toolbar.addBinding(state, 'radius', { label: 'window radius r', min: 1, max: 10, step: 1 });
toolbar.addResetButton(() => {
  Object.assign(state, defaults());
  ui.refresh();
  schedule();
});

const surfaceControls = ui.panel('surface-view');
const metricFolder = surfaceControls.addFolder({ title: 'Error metric E(u)' });
metricFolder.addBinding(state, 'metric', { label: 'metric', options: Object.fromEntries(Object.entries(METRICS).map(([k, m]) => [m.label, k])) });
const pBinding = metricFolder.addBinding(state, 'p', { label: 'p', min: 0.25, max: 3, step: 0.05 });
const aBinding = metricFolder.addBinding(state, 'a', { label: 'a', min: 0.01, max: 0.5, step: 0.01 });
metricFolder.addBinding(state, 'border', {
  label: 'outside & masked',
  options: { 'count all (clamp)': 'clamp', 'masks (WSRD)': 'wsrd', 'masks, normalized (NWSRD)': 'nwsrd' },
});
surfaceControls.addFolder({ title: 'Search' }).addBinding(state, 'range', { label: 'search radius R', min: 2, max: 12, step: 1 });

const second = ui.panel('i1-view');
const shift = (label: string) => ({ label, min: -8, max: 8, step: 0.1, format: (v: number) => fmt(v, 1) });
second.addBinding(state, 'tu', shift('true u (px)'));
second.addBinding(state, 'tv', shift('true v (px)'));
second.addBinding(state, 'gain', { label: 'gain α', min: 0.3, max: 2, step: 0.05 });
second.addBinding(state, 'bias', { label: 'bias β', min: -0.4, max: 0.4, step: 0.01 });
second.addBinding(state, 'noise', { label: 'noise σₙ', min: 0, max: 0.1, step: 0.005 });
second.addBinding(state, 'occluder', { label: 'occluder' });

const clampShift = (s: number) => Math.max(-state.range, Math.min(state.range, s));
const view0 = new PixelView(document.getElementById('i0-view')!, (x, y) => {
  state.x = x;
  state.y = y;
  schedule();
});
const view1 = new PixelView(document.getElementById('i1-view')!, (x, y) => {
  state.u = clampShift(x - state.x);
  state.v = clampShift(y - state.y);
  schedule();
});
const surfaceView = new PixelView(document.getElementById('surface-view')!, (u, v) => {
  state.u = u - state.range;
  state.v = v - state.range;
  schedule();
});
const residualView = new PixelView(document.getElementById('residual-view')!);
const kernelPlot = new Plot(document.getElementById('kernel-plot')!, 220);
const values = document.getElementById('values')!;

/** The occluder is a bright disk that covers part of the window's true position in I₁. */
function occluder(): { cx: number; cy: number; radius: number } {
  const r = state.radius;
  return { cx: state.x + state.tu + r / 2, cy: state.y + state.tv - r / 2, radius: Math.max(1.5, 0.6 * r) };
}

function secondImage(): { I1: Plane; masked1?: (x: number, y: number) => boolean } {
  let I1 = warp(original, { ...IDENTITY, tx: state.tu, ty: state.tv, gain: state.gain, bias: state.bias });
  if (state.noise > 0) I1 = gaussianNoise(I1, state.noise, 1);
  if (!state.occluder) return { I1 };
  const { cx, cy, radius } = occluder();
  const masked1 = (x: number, y: number) => Math.hypot(x - cx, y - cy) <= radius;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (masked1(x, y)) I1.data[y * W + x] = 1;
  return { I1, masked1 };
}

function square(ctx: CanvasRenderingContext2D, t: ViewTransform, cx: number, cy: number, r: number, color: string, dash: number[] = []): void {
  const [x, y] = t.toView(cx - r, cy - r);
  ctx.strokeStyle = cssColor(color);
  ctx.lineWidth = 2;
  ctx.setLineDash(dash);
  ctx.strokeRect(x, y, (2 * r + 1) * t.scale, (2 * r + 1) * t.scale);
  ctx.setLineDash([]);
}

/** A cross at a real-valued pixel position (pixel centers at integer coordinates). */
function cross(ctx: CanvasRenderingContext2D, t: ViewTransform, x: number, y: number, color: string): void {
  const [cx, cy] = t.toView(x + 0.5, y + 0.5);
  const s = Math.max(5, t.scale * 0.45);
  ctx.strokeStyle = cssColor(color);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - s, cy - s);
  ctx.lineTo(cx + s, cy + s);
  ctx.moveTo(cx - s, cy + s);
  ctx.lineTo(cx + s, cy - s);
  ctx.stroke();
}

function update(): void {
  state.u = clampShift(state.u);
  state.v = clampShift(state.v);
  const { x, y, radius: r, range: R, u, v } = state;
  const { I1, masked1 } = secondImage();
  const params: CostParams = { p: state.p, a: state.a, border: state.border, masked1 };
  pBinding.hidden = state.metric !== 'lp';
  aBinding.hidden = state.metric !== 'gm';

  const surfaces = Object.fromEntries((Object.keys(METRICS) as Metric[]).map((m) => [m, costSurface(original, I1, x, y, r, R, m, params)])) as Record<Metric, Float64Array>;
  const E = surfaces[state.metric];
  const found = best(E, R, state.metric);
  const s = samples(original, I1, x, y, r, u, v, params);

  view0.overlay = (ctx, t) => square(ctx, t, x, y, r, '--viz-highlight');
  view0.show(planeToImage(original));
  view1.overlay = (ctx, t) => {
    square(ctx, t, x, y, r + R, '--fg-faint', [4, 4]);
    square(ctx, t, x + found.u, y + found.v, r, '--viz-highlight');
    square(ctx, t, x + u, y + v, r, '--accent', [6, 4]);
    cross(ctx, t, x + state.tu, y + state.tv, '--viz-points');
  };
  view1.show(planeToImage(I1));

  surfaceView.overlay = (ctx, t) => {
    const [bx, by] = t.toView(found.u + R, found.v + R);
    ctx.strokeStyle = cssColor('--viz-highlight');
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(bx + t.scale / 2, by + t.scale / 2, t.scale * 0.45, 0, 2 * Math.PI);
    ctx.stroke();
    const [sx, sy] = t.toView(u + R, v + R);
    ctx.strokeStyle = cssColor('--accent');
    ctx.lineWidth = 2;
    ctx.strokeRect(sx + 1, sy + 1, t.scale - 2, t.scale - 2);
    cross(ctx, t, state.tu + R, state.tv + R, '--viz-points');
  };
  surfaceView.show(planeToImage(heatmap(E, R, state.metric)));

  const n = 2 * r + 1;
  const residual = { width: n, height: n, data: new Float32Array(n * n) };
  let k = 0;
  s.counted.forEach((c, i) => {
    residual.data[i] = c ? 0.5 + (s.i1[k] - s.i0[k]) : 0.5;
    if (c) k++;
  });
  residualView.overlay = (ctx, t) => {
    ctx.fillStyle = cssColor('--viz-object');
    ctx.globalAlpha = 0.6;
    s.counted.forEach((c, i) => {
      if (c) return;
      const [px, py] = t.toView(i % n, Math.floor(i / n));
      ctx.fillRect(px, py, t.scale, t.scale);
    });
    ctx.globalAlpha = 1;
  };
  residualView.show(planeToImage(residual));

  drawKernels(s.i0.map((v0, i) => s.i1[i] - v0));
  renderValues(surfaces, s, params);
}
const schedule = perFrame(update);

/**
 * Gray levels from the best (black) to the worst value of the surface, on a square-root scale so that the region
 * around the minimum is not all black. NaN (no pixel counted) is mid gray.
 */
function heatmap(E: Float64Array, R: number, metric: Metric): Plane {
  const finite = [...E].filter((e) => !Number.isNaN(e));
  const n = 2 * R + 1;
  if (!finite.length) return { width: n, height: n, data: new Float32Array(n * n).fill(0.5) };
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  const span = hi - lo || 1;
  return { width: n, height: n, data: Float32Array.from(E, (e) => (Number.isNaN(e) ? 0.5 : Math.sqrt(isSimilarity(metric) ? (hi - e) / span : (e - lo) / span))) };
}

/**
 * The kernels ρ(e) over a range of errors that suits the current one: Geman–McClure levels off at a², far below the
 * others, so for it the plot zooms in to |e| ≤ 6a.
 */
function drawKernels(errors: number[]): void {
  const lim = state.metric === 'gm' ? Math.min(1, 6 * state.a) : 1;
  const kernels = ['ssd', 'sad', 'lp', 'gm'] as const;
  const active = kernels.find((m) => m === state.metric) ?? 'ssd';
  const top = 1.1 * Math.max(rho(active, lim, state), rho(active, -lim, state));
  const bins = 40;
  const counts = new Array(bins).fill(0);
  for (const e of errors) counts[Math.min(bins - 1, Math.max(0, Math.floor(((e + lim) / (2 * lim)) * bins)))]++;
  const maxCount = Math.max(1, ...counts);
  kernelPlot.render({ x: [-lim, lim], y: [0, top] }, (fr) => {
    fr.grid(ticks(-lim, lim, 8), ticks(0, top, 4), { y: (v) => String(+v.toPrecision(2)) });
    fr.bars(
      counts.map((c, i) => [-lim + ((i + 0.5) * 2 * lim) / bins, (0.9 * top * c) / maxCount] as const),
      (2 * lim) / bins,
      '--viz-points',
      0.35,
    );
    for (const m of kernels) {
      const current = m === state.metric;
      fr.line((e) => rho(m, e, state), current ? '--accent' : '--fg-faint', { width: current ? 2.5 : 1.25 });
    }
  });
}

const sub = (m: Metric) => METRICS[m].name;

function formula(metric: Metric, border: Border): string {
  const w = border === 'clamp' ? '' : 'w_0(\\mathbf{x}_i)\\, w_1(\\mathbf{x}_i + \\mathbf{u})\\,';
  const pre = border === 'nwsrd' ? '\\frac{1}{A(\\mathbf{u})}' : '';
  const e = 'e_i';
  switch (metric) {
    case 'ssd':
      return `${pre}\\sum_i ${w} ${e}^2`;
    case 'sad':
      return `${pre}\\sum_i ${w} |${e}|`;
    case 'lp':
      return `\\left( ${pre}\\sum_i ${w} |${e}|^{${fmt(state.p, 2)}} \\right)^{1/${fmt(state.p, 2)}}`;
    case 'gm':
      return `${pre}\\sum_i ${w} \\frac{${e}^2}{1 + ${e}^2 / ${fmt(state.a, 2)}^2}`;
    case 'gain-bias':
      return `${pre}\\sum_i ${w} \\left[ I_1(\\mathbf{x}_i + \\mathbf{u}) - (\\hat\\alpha I_0(\\mathbf{x}_i) + \\hat\\beta) \\right]^2`;
    case 'cc':
      return `${pre}\\sum_i ${w} I_0(\\mathbf{x}_i)\\, I_1(\\mathbf{x}_i + \\mathbf{u})`;
    case 'ncc':
      return `\\frac{\\sum_i [I_0(\\mathbf{x}_i) - \\bar I_0][I_1(\\mathbf{x}_i + \\mathbf{u}) - \\bar I_1]}{\\sqrt{\\sum_i [I_0(\\mathbf{x}_i) - \\bar I_0]^2} \\sqrt{\\sum_i [I_1(\\mathbf{x}_i + \\mathbf{u}) - \\bar I_1]^2}}`;
  }
}

function renderValues(surfaces: Record<Metric, Float64Array>, s: ReturnType<typeof samples>, params: CostParams): void {
  const { u, v, range: R, radius: r } = state;
  const value = cost(state.metric, s, params);
  const nearest = [Math.round(state.tu), Math.round(state.tv)];
  const inRange = Math.abs(nearest[0]) <= R && Math.abs(nearest[1]) <= R;
  const extra =
    state.metric === 'gain-bias'
      ? (() => {
          const { alpha, beta } = fitGainBias(s.i0, s.i1);
          return eq(`\\hat\\alpha = ${fmt(alpha, 3)},\\quad \\hat\\beta = ${fmt(beta, 3)}\\qquad (\\text{true: } \\alpha = ${fmt(state.gain, 2)},\\ \\beta = ${fmt(state.bias, 2)})`);
        })()
      : '';
  const rows = (Object.keys(METRICS) as Metric[])
    .map((m) => {
      const b = best(surfaces[m], R, m);
      const ok = b.u === nearest[0] && b.v === nearest[1];
      return `<tr${m === state.metric ? ' class="current"' : ''}><td>${METRICS[m].label}</td><td>(${b.u}, ${b.v})</td><td class="${ok ? 'ok' : 'bad'}">${ok ? '✓' : `off by ${fmt(Math.hypot(b.u - state.tu, b.v - state.tv), 1)} px`}</td></tr>`;
    })
    .join('');
  const found = best(surfaces[state.metric], R, state.metric);
  const shifts = (2 * R + 1) ** 2;

  values.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <h3>${METRICS[state.metric].label} at ${renderTex(`\\mathbf{u} = (${u}, ${v})`)}</h3>
        ${eq(`E_{${sub(state.metric)}}(\\mathbf{u}) = ${formula(state.metric, state.border)} = \\htmlClass{result}{${Number.isNaN(value) ? '\\text{undefined}' : fmt(value, 4)}}`)}
        ${eq(`e_i = I_1(\\mathbf{x}_i + \\mathbf{u}) - I_0(\\mathbf{x}_i),\\qquad ${state.border === 'clamp' ? 'N' : 'A(\\mathbf{u})'} = ${s.i0.length}\\ \\text{of}\\ ${s.total}\\ \\text{pixels}`)}
        ${extra}
      </div>
      <div class="value-block">
        <h3>Full search</h3>
        ${eq(`\\hat{\\mathbf{u}} = (${found.u}, ${found.v}),\\qquad \\mathbf{u}^* = (${fmt(state.tu, 1)}, ${fmt(state.tv, 1)})`)}
        <p class="small">${(2 * R + 1)}² = ${shifts} shifts × ${(2 * r + 1)}² = ${(2 * r + 1) ** 2} pixels = ${(shifts * (2 * r + 1) ** 2).toLocaleString('en')} differences, and only integer shifts.${
          inRange ? '' : ' The true shift lies outside the search range.'
        }</p>
      </div>
      <div class="value-block">
        <h3>Best shift of every metric</h3>
        <table class="metric-table">
          <thead><tr><th>metric</th><th>${renderTex('\\hat{\\mathbf{u}}')}</th><th>vs ${renderTex(`(${nearest[0]}, ${nearest[1]})`)}</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

ui.on('change', schedule);
onThemeChange(schedule);
update();
