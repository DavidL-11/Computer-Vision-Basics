import { Pane } from 'tweakpane';
import { eigen } from '../../src/shared/harris';
import { type Plane, planeToImage, toGray } from '../../src/shared/image';
import { addImagePicker } from '../../src/shared/imagePicker';
import { gaussianNoise } from '../../src/shared/noise';
import { initPage } from '../../src/shared/page';
import { PixelView, type ViewTransform, perFrame } from '../../src/shared/pixelView';
import { Plot } from '../../src/shared/plot';
import { eq, fmt, renderTex, sci, texSciMatrix, texTuple } from '../../src/shared/tex';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import { IDENTITY, warp } from '../../src/shared/warp';
import { type Frames, type Jacobian, type Outcome, type Step, errorSurface, lucasKanade, prepare } from './lucasKanade';
import '../../src/shared/styles/demo.css';
import './lucas-kanade.css';

initPage({ title: 'Lucas–Kanade step by step', chapterId: 'dense-motion' });

const W = 160;
const H = 120;
/** The error surface covers shifts in [−R, R]² on a grid of STEP pixels. */
const R = 8;
const STEP = 0.25;
const EPSILON = 0.001;

const defaults = () => ({
  sigma: 1,
  radius: 6,
  alpha: 1,
  maxIterations: 30,
  jacobian: 'i1' as Jacobian,
  u0: 0,
  v0: 0,
  tu: 2.6,
  tv: -1.8,
  noise: 0,
  x: 57,
  y: 77,
  k: 0,
});
const state = defaults();

const pane = new Pane({ container: document.getElementById('controls')!, title: 'Lucas–Kanade' });
let imageVersion = 0;
let original: Plane = toGray(
  addImagePicker(pane, { names: ['scene', 'shapes', 'text', 'chart', 'blobs', 'zone-plate'], value: 'scene', width: W, height: H }, (img) => {
    original = toGray(img);
    imageVersion++;
    schedule();
  }),
);
pane.addBinding(state, 'sigma', { label: 'pre-smoothing σ', min: 0, max: 4, step: 0.1 });
pane.addBinding(state, 'radius', { label: 'window radius r', min: 2, max: 12, step: 1 });

const iteration = pane.addFolder({ title: 'Iteration' });
iteration.addBinding(state, 'k', { label: 'shown step k', min: 0, max: 100, step: 1 });
iteration.addButton({ title: 'Next step' }).on('click', () => {
  stop();
  state.k++;
  pane.refresh();
});
const playButton = iteration.addButton({ title: 'Play from u₀' });
playButton.on('click', () => (timer ? stop() : play()));
const shift = (label: string) => ({ label, min: -R, max: R, step: 0.1, format: (v: number) => fmt(v, 1) });
iteration.addBinding(state, 'u0', shift('start u₀ (px)'));
iteration.addBinding(state, 'v0', shift('start v₀ (px)'));
iteration.addBinding(state, 'alpha', { label: 'step size α', min: 0.05, max: 2, step: 0.05 });
iteration.addBinding(state, 'maxIterations', { label: 'max. iterations', min: 1, max: 100, step: 1 });
iteration.addBinding(state, 'jacobian', { label: 'gradient J', options: { '∇I₁(xᵢ + u), every step': 'i1', '∇I₀(xᵢ), once': 'i0' } });

const second = pane.addFolder({ title: 'Second image I₁' });
second.addBinding(state, 'tu', shift('true u* (px)'));
second.addBinding(state, 'tv', shift('true v* (px)'));
second.addBinding(state, 'noise', { label: 'noise σₙ', min: 0, max: 0.1, step: 0.005 });
pane.addButton({ title: 'Reset' }).on('click', () => {
  stop();
  Object.assign(state, defaults());
  pane.refresh();
});

let timer = 0;
let lastStep = 0;
function play(): void {
  stop();
  state.k = 0;
  pane.refresh();
  playButton.title = 'Stop';
  timer = window.setInterval(() => {
    if (state.k >= lastStep) return stop();
    state.k++;
    pane.refresh();
  }, 450);
}
function stop(): void {
  window.clearInterval(timer);
  timer = 0;
  playButton.title = 'Play from u₀';
}

const clampShift = (s: number) => Math.round(Math.max(-R, Math.min(R, s)) * 10) / 10;
function setStart(u: number, v: number): void {
  state.u0 = clampShift(u);
  state.v0 = clampShift(v);
  play();
}
const view0 = new PixelView(document.getElementById('i0-view')!, (x, y) => {
  state.x = x;
  state.y = y;
  schedule();
});
const view1 = new PixelView(document.getElementById('i1-view')!, (x, y) => setStart(x - state.x, y - state.y));
const surfaceView = new PixelView(document.getElementById('surface-view')!, (a, b) => setStart(-R + a * STEP, -R + b * STEP));
const patchViews = ['patch-i0', 'patch-i1', 'patch-e'].map((id) => new PixelView(document.getElementById(id)!));
const plot = new Plot(document.getElementById('convergence-plot')!, 200);
const values = document.getElementById('values')!;

/** Recomputes a value only when its key changes. */
function cached<T>(compute: () => T): (key: string) => T {
  let last: { key: string; value: T } | null = null;
  return (key) => {
    if (last?.key !== key) last = { key, value: compute() };
    return last.value;
  };
}

const getFrames = cached((): Frames => {
  let I1 = warp(original, { ...IDENTITY, tx: state.tu, ty: state.tv });
  if (state.noise > 0) I1 = gaussianNoise(I1, state.noise, 1);
  return prepare(original, I1, state.sigma);
});
const getSurface = cached(() => errorSurface(getFrames(framesKey()), windowOf(), R, STEP));
const framesKey = () => [imageVersion, state.tu, state.tv, state.noise, state.sigma].join();
const windowKey = () => [framesKey(), state.x, state.y, state.radius].join();

/** The window around the selected pixel, moved inside the image if needed. */
function windowOf() {
  const r = state.radius;
  return { x: Math.max(r, Math.min(W - 1 - r, state.x)), y: Math.max(r, Math.min(H - 1 - r, state.y)), r };
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
  const s = Math.max(5, Math.min(9, t.scale * 0.45));
  ctx.strokeStyle = cssColor(color);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - s, cy - s);
  ctx.lineTo(cx + s, cy + s);
  ctx.moveTo(cx - s, cy + s);
  ctx.lineTo(cx + s, cy - s);
  ctx.stroke();
}

/**
 * The estimates u₀ … u_k as a polyline with dots, the later ones faint. `at` maps a shift to pixel coordinates of
 * the view (pixel centers at integer coordinates).
 */
function path(ctx: CanvasRenderingContext2D, t: ViewTransform, steps: Step[], k: number, at: (u: number, v: number) => [number, number]): void {
  const points = steps.map((s) => t.toView(...at(s.u, s.v).map((c) => c + 0.5) as [number, number]));
  const color = cssColor('--accent');
  ctx.lineWidth = 2;
  ctx.strokeStyle = ctx.fillStyle = color;
  for (const [from, to, alpha] of [[0, k, 1], [k, points.length - 1, 0.3]] as const) {
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    points.slice(from, to + 1).forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.stroke();
  }
  points.forEach(([x, y], i) => {
    ctx.globalAlpha = i <= k ? 1 : 0.3;
    ctx.beginPath();
    ctx.arc(x, y, i === k ? 4.5 : 2.5, 0, 2 * Math.PI);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

/**
 * The contour of the linearized error Σ [J(xᵢ) Δ + eᵢ]² through the current estimate: an ellipse
 * (Δ − Δu)ᵀ AᵀA (Δ − Δu) = Δuᵀ AᵀA Δu around the minimum u_k + Δu of the model.
 */
function modelEllipse(ctx: CanvasRenderingContext2D, t: ViewTransform, s: Step): void {
  if (!s.du) return;
  const { sxx, sxy, syy } = s.system;
  const [du, dv] = s.du;
  const level = sxx * du * du + 2 * sxy * du * dv + syy * dv * dv;
  const { l1, l2, angle } = eigen(sxx, sxy, syy);
  const px = t.scale / STEP;
  const axis = (l: number) => Math.min(1e4, Math.sqrt(level / Math.max(l, 1e-12)) * px);
  const [cx, cy] = t.toView((s.u + du + R) / STEP + 0.5, (s.v + dv + R) / STEP + 0.5);
  ctx.strokeStyle = ctx.fillStyle = cssColor('--viz-points');
  ctx.lineWidth = 1.75;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.ellipse(cx, cy, axis(l1), axis(l2), angle, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(cx, cy, 3.5, 0, 2 * Math.PI);
  ctx.fill();
}

function update(): void {
  const win = windowOf();
  const { r } = win;
  const frames = getFrames(framesKey());
  const surface = getSurface(windowKey());
  const { steps, outcome } = lucasKanade(frames, win, [state.u0, state.v0], {
    alpha: state.alpha,
    maxIterations: state.maxIterations,
    epsilon: EPSILON,
    jacobian: state.jacobian,
    limit: 3 * R,
  });
  lastStep = steps.length - 1;
  if (state.k > lastStep) {
    state.k = lastStep;
    pane.refresh();
  }
  const k = state.k;
  const s = steps[k];

  view0.overlay = (ctx, t) => square(ctx, t, win.x, win.y, r, '--viz-highlight');
  view0.show(planeToImage(frames.I0));
  view1.overlay = (ctx, t) => {
    square(ctx, t, win.x + s.u, win.y + s.v, r, '--accent', [6, 4]);
    path(ctx, t, steps, k, (u, v) => [win.x + u, win.y + v]);
    cross(ctx, t, win.x + state.tu, win.y + state.tv, '--viz-points');
  };
  view1.show(planeToImage(frames.I1));

  surfaceView.overlay = (ctx, t) => {
    modelEllipse(ctx, t, s);
    path(ctx, t, steps, k, (u, v) => [(u + R) / STEP, (v + R) / STEP]);
    cross(ctx, t, (state.tu + R) / STEP, (state.tv + R) / STEP, '--viz-highlight');
  };
  surfaceView.show(planeToImage(heatmap(surface.E, surface.n)));

  const n = 2 * r + 1;
  const plane = (data: ArrayLike<number>): Plane => ({ width: n, height: n, data: Float32Array.from(data) });
  const window0 = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) window0[j * n + i] = frames.I0.data[(win.y - r + j) * W + win.x - r + i];
  patchViews[0].show(planeToImage(plane(window0)));
  patchViews[1].show(planeToImage(plane(s.system.warped)));
  patchViews[2].show(planeToImage(plane(s.system.e.map((e) => 0.5 + e))));

  drawConvergence(steps, k);
  renderValues(steps, k, outcome);
}
const schedule = perFrame(update);

/** Gray levels from the smallest (black) to the largest error, on a square-root scale. */
function heatmap(E: Float64Array, n: number): Plane {
  const lo = Math.min(...E);
  const span = Math.max(...E) - lo || 1;
  return { width: n, height: n, data: Float32Array.from(E, (e) => Math.sqrt((e - lo) / span)) };
}

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const pow10 = (e: number) => (e === 0 ? '1' : `10${e < 0 ? '⁻' : ''}${[...String(Math.abs(e))].map((d) => SUPERSCRIPT[+d]).join('')}`);

/** |u_k − u*| and the step length |α Δu_k| per iteration, on a logarithmic axis. */
function drawConvergence(steps: Step[], k: number): void {
  const floor = -4;
  const log = (x: number) => Math.max(floor, Math.log10(Math.max(x, 1e-12)));
  const last = Math.max(steps.length - 1, 5);
  const err = steps.map((s, i) => [i, log(Math.hypot(s.u - state.tu, s.v - state.tv))] as const);
  const len = steps.flatMap((s, i) => (s.du ? [[i, log(state.alpha * Math.hypot(...s.du))] as const] : []));
  plot.render({ x: [0, last], y: [floor, 1.5] }, (fr) => {
    const xTicks = Array.from({ length: last + 1 }, (_, i) => i).filter((i) => i % Math.ceil(last / 15) === 0);
    fr.grid(xTicks, [-4, -3, -2, -1, 0, 1], { y: pow10 });
    fr.vline(k, '--fg-faint', { dash: [4, 4] });
    fr.line(len, '--viz-points', { dash: [6, 4] });
    fr.line(err, '--accent');
    fr.stems(
      err.filter(([i]) => i === k).map(([i, e]) => [i, e] as const),
      '--accent',
    );
  });
}

const OUTCOMES: Record<Outcome, string> = {
  converged: 'converged',
  singular: 'stopped: AᵀA is singular',
  diverged: 'stopped: the estimate left the search area',
  'max-iterations': 'stopped after the maximum number of iterations',
};

function conditioning(l1: number, l2: number, N: number): string {
  if (l1 < 1e-4 * N) return 'Both eigenvalues are tiny: the window is flat, and no shift can be measured.';
  if (l2 < 0.02 * l1) return 'λ₂ ≪ λ₁: an edge. Only the motion across the edge is determined (aperture problem).';
  return 'Both eigenvalues are large: the window has gradients in two directions, and both components of u are determined.';
}

function renderValues(steps: Step[], k: number, outcome: Outcome): void {
  const s = steps[k];
  const { sxx, sxy, syy, bx, by, E } = s.system;
  const N = (2 * state.radius + 1) ** 2;
  const { l1, l2 } = eigen(sxx, sxy, syy);
  const last = steps[steps.length - 1];
  const updates = steps.length - 1;
  const next = s.du
    ? [
        eq(`\\Delta\\mathbf{u} = (A^\\top A)^{-1} A^\\top \\mathbf{b} = ${texTuple(s.du, 3)}`),
        eq(`\\mathbf{u}_{${k + 1}} = \\mathbf{u}_{${k}} + \\alpha\\, \\Delta\\mathbf{u} = ${texTuple([s.u, s.v], 3)} + ${fmt(state.alpha, 2)} \\cdot ${texTuple(s.du, 3)} = \\htmlClass{result}{${texTuple([s.u + state.alpha * s.du[0], s.v + state.alpha * s.du[1]], 3)}}`),
      ].join('')
    : `<p class="warn">${renderTex('A^\\top A')} cannot be inverted, so there is no update.</p>`;
  const fine = (2 * R) / 0.1 + 1;

  values.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <h3>Step ${k} at ${renderTex(`\\mathbf{u}_{${k}} = ${texTuple([s.u, s.v], 3)}`)}</h3>
        ${eq(`A^\\top A = \\sum_i \\begin{bmatrix} J_x^2 & J_x J_y \\\\ J_x J_y & J_y^2 \\end{bmatrix} = ${texSciMatrix([[sxx, sxy], [sxy, syy]])},\\qquad A^\\top \\mathbf{b} = -\\sum_i e_i \\begin{bmatrix} J_x \\\\ J_y \\end{bmatrix} = ${texSciMatrix([[bx], [by]])}`)}
        ${next}
        ${eq(`E(\\mathbf{u}_{${k}}) = \\sum_i e_i^2 = ${sci(E, 3)}\\qquad (E(\\mathbf{u}_0) = ${sci(steps[0].system.E, 3)})`)}
      </div>
      <div class="value-block">
        <h3>Eigenvalues of ${renderTex('A^\\top A')}</h3>
        ${eq(`\\lambda_1 = ${sci(l1, 3)},\\qquad \\lambda_2 = ${sci(l2, 3)}`)}
        <p class="small">${conditioning(l1, l2, N)}</p>
      </div>
      <div class="value-block">
        <h3>Result</h3>
        ${eq(`\\hat{\\mathbf{u}} = ${texTuple([last.u, last.v], 3)},\\qquad \\mathbf{u}^* = ${texTuple([state.tu, state.tv], 1)},\\qquad |\\hat{\\mathbf{u}} - \\mathbf{u}^*| = ${sci(Math.hypot(last.u - state.tu, last.v - state.tv), 2)}\\ \\text{px}`)}
        <p class="small">${OUTCOMES[outcome]}${outcome === 'converged' ? ` after ${updates} update${updates === 1 ? '' : 's'}, when the next step was shorter than ${EPSILON} px` : ''}.
        ${steps.length} linearizations × ${N} pixels = ${(steps.length * N).toLocaleString('en')} samples. A full search over ±${R} px in steps of 0.1 px would need ${fine}² × ${N} = ${(fine * fine * N).toLocaleString('en')}.</p>
      </div>
    </div>`;
}

pane.on('change', schedule);
onThemeChange(schedule);
update();
