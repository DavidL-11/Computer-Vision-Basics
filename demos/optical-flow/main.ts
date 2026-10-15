import { type Plane, createPlane, planeToImage } from '../../src/shared/image';
import { Controls } from '../../src/shared/controls';
import { initPage } from '../../src/shared/page';
import { PixelView, type ViewTransform, perFrame } from '../../src/shared/pixelView';
import { eq, fmt, renderTex, sci, texSciMatrix, texTuple } from '../../src/shared/tex';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import {
  type Flow,
  type Frames,
  type Kind,
  Regularized,
  eigen2,
  endpointError,
  energy,
  errorSurface,
  flowColor,
  flowImage,
  neighborMean,
  patchAt,
  patchFlow,
  prepare,
} from './flow';
import { CARD, CARD_CENTERS, HEIGHT, REGIONS, type Scene, WIDTH, counted, scene } from './scene';
import '../../src/shared/styles/demo.css';
import './optical-flow.css';

initPage({ title: 'Patch-based vs regularized flow', chapterId: 'dense-motion' });

/** Flow of this length in pixels is shown fully saturated. */
const MAX = 3;
/** The error surface covers [−R, R]² pixels in steps of H. */
const R = 4;
const H = 0.25;
const ARROW_STEP = 10;
const ARROW_SCALE = 3;
/** Sweeps of the regularized flow per animation frame, normally and while playing. */
const CHUNK = 50;
const SLOW_CHUNK = 4;
const PATCH = { iterations: 10, epsilon: 0.01 };

const defaults = () => ({
  noise: 0.01,
  sigma: 1,
  show: 'flow',
  arrows: true,
  card: { x: 2, y: 1.2 },
  bg: { x: -0.6, y: 0.3 },
  r: 4,
  logTau: -5,
  logAlpha: -1,
  iterations: 1000,
  x: 120,
  y: 32,
});
const state = defaults();

const ui = new Controls();
const toolbar = ui.toolbar();
toolbar.addBinding(state, 'noise', { label: 'noise σₙ', min: 0, max: 0.05, step: 0.002 });
toolbar.addBinding(state, 'sigma', { label: 'smoothing σ', min: 0, max: 3, step: 0.1 });
toolbar.addBinding(state, 'show', { label: 'show', options: { flow: 'flow', 'error (black ≥ 2 px)': 'error' }, view: 'segmented' });
toolbar.addBinding(state, 'arrows', { label: 'arrows (3× longer)' });
const playButton = toolbar.addButton({ title: 'Play', primary: true, icon: 'play' });
playButton.on('click', () => (playing ? stop() : play()));
toolbar.addResetButton(() => {
  stop();
  Object.assign(state, defaults());
  ui.refresh();
  schedule();
});

const motion = { min: -3, max: 3, step: 0.1 };
const second = ui.panel('i1-view');
second.addBinding(state, 'card', { label: 'motion of the cards (px)', x: motion, y: motion });
second.addBinding(state, 'bg', { label: 'motion of the background (px)', x: motion, y: motion });

const patchPanel = ui.panel('patch-view');
patchPanel.addBinding(state, 'r', { label: 'window radius r', min: 1, max: 10, step: 1 });
patchPanel.addBinding(state, 'logTau', { label: 'threshold τ', min: -8, max: -2, step: 0.1, format: (v) => (10 ** v).toExponential(1) });

const regPanel = ui.panel('reg-view');
regPanel.addBinding(state, 'logAlpha', { label: 'smoothness α', min: -2.5, max: 0, step: 0.05, format: (v) => `${+(10 ** v).toPrecision(2)}` });
regPanel.addBinding(state, 'iterations', { label: 'iterations', min: 0, max: 2000, step: 10 });

let playing = false;
function play(): void {
  playing = true;
  solver = null;
  ui.playing(true, 'reg-view');
  playButton.title = 'Stop';
  playButton.icon = 'stop';
  schedule();
}
function stop(): void {
  playing = false;
  ui.playing(false);
  playButton.title = 'Play';
  playButton.icon = 'play';
  schedule();
}

const pick = (x: number, y: number) => {
  state.x = x;
  state.y = y;
  schedule();
};
const views = {
  i0: new PixelView(document.getElementById('i0-view')!, pick),
  i1: new PixelView(document.getElementById('i1-view')!),
  patch: new PixelView(document.getElementById('patch-view')!, pick),
  reg: new PixelView(document.getElementById('reg-view')!, pick),
  truth: new PixelView(document.getElementById('truth-view')!, pick),
  wheel: new PixelView(document.getElementById('wheel-view')!),
  window: new PixelView(document.getElementById('patch-i0')!),
  surface: new PixelView(document.getElementById('surface-view')!),
};
const sweepCaption = document.getElementById('sweep-caption')!;
const windowCaption = document.getElementById('window-caption')!;
document.getElementById('max-caption')!.textContent = String(MAX);
const values = document.getElementById('values')!;

/** Recomputes a value only when its key changes. */
function cached<T>(compute: () => T): (key: string) => T {
  let last: { key: string; value: T } | null = null;
  return (key) => {
    if (last?.key !== key) last = { key, value: compute() };
    return last.value;
  };
}

const tau = () => 10 ** state.logTau;
const alpha = () => 10 ** state.logAlpha;
const sceneKey = () => [state.card.x, state.card.y, state.bg.x, state.bg.y, state.noise].join();
const framesKey = () => [sceneKey(), state.sigma].join();
const getScene = cached((): Scene => scene([state.card.x, state.card.y], [state.bg.x, state.bg.y], state.noise));
const getFrames = cached((): Frames => {
  const s = getScene(sceneKey());
  return prepare(s.I0, s.I1, state.sigma);
});
const patchKey = () => [framesKey(), state.r, state.logTau].join();
const getPatch = cached(() => {
  const p = patchFlow(getFrames(framesKey()), { r: state.r, tau: tau(), ...PATCH });
  return { ...p, epe: endpointError(p.flow, getScene(sceneKey()).truth) };
});
const surfaceKey = () => [framesKey(), state.x, state.y, state.r].join();
const getSurface = cached(() => errorSurface(getFrames(framesKey()), state.x, state.y, state.r, R, H));

let solver: Regularized | null = null;
let solverKey = '';
/** Advances the regularized flow towards the set number of iterations; true if there is more to do. */
function advance(): boolean {
  const key = [framesKey(), state.logAlpha].join();
  if (!solver || solverKey !== key || solver.k > state.iterations) {
    solver = new Regularized(getFrames(framesKey()), alpha());
    solverKey = key;
  }
  solver.run(Math.min(playing ? SLOW_CHUNK : CHUNK, state.iterations - solver.k));
  return solver.k < state.iterations;
}

const wheel = (() => {
  const n = 61;
  const p = createPlane(n, n);
  const img = planeToImage(p);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const s = (1.2 * MAX) / ((n - 1) / 2);
      img.data.set(flowColor((x - (n - 1) / 2) * s, (y - (n - 1) / 2) * s, MAX), 3 * (y * n + x));
    }
  return img;
})();

function errorImage(epe: Float32Array): Plane {
  return { width: WIDTH, height: HEIGHT, data: epe.map((e) => (Number.isNaN(e) ? 0.5 : 1 - Math.min(1, e / 2))) };
}

/** Diagonal hatching over the pixels where `mask` is true. */
function hatch(ctx: CanvasRenderingContext2D, t: ViewTransform, mask: (i: number) => boolean, color: string): void {
  const tile = document.createElement('canvas');
  tile.width = tile.height = 6;
  const g = tile.getContext('2d')!;
  g.strokeStyle = cssColor(color);
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(0, 6);
  g.lineTo(6, 0);
  g.moveTo(-1, 1);
  g.lineTo(1, -1);
  g.moveTo(5, 7);
  g.lineTo(7, 5);
  g.stroke();
  ctx.fillStyle = ctx.createPattern(tile, 'repeat')!;
  ctx.beginPath();
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    if (!mask(i)) continue;
    const [x, y] = t.toView(i % WIDTH, Math.floor(i / WIDTH));
    ctx.rect(x, y, t.scale, t.scale);
  }
  ctx.fill();
}

function arrows(ctx: CanvasRenderingContext2D, t: ViewTransform, flow: Flow): void {
  ctx.strokeStyle = ctx.fillStyle = cssColor('--flow-arrow');
  ctx.lineWidth = 1.3;
  for (let y = ARROW_STEP / 2; y < HEIGHT; y += ARROW_STEP)
    for (let x = ARROW_STEP / 2; x < WIDTH; x += ARROW_STEP) {
      const i = y * WIDTH + x;
      const u = flow.u[i], v = flow.v[i];
      if (Number.isNaN(u)) continue;
      const [x0, y0] = t.toView(x + 0.5, y + 0.5);
      const dx = u * ARROW_SCALE * t.scale, dy = v * ARROW_SCALE * t.scale;
      const len = Math.hypot(dx, dy);
      ctx.beginPath();
      ctx.arc(x0, y0, 1.2, 0, 2 * Math.PI);
      ctx.fill();
      if (len < 2) continue;
      const head = Math.min(5, len / 2);
      const ux = dx / len, uy = dy / len;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 + dx, y0 + dy);
      ctx.moveTo(x0 + dx - head * (ux - 0.5 * uy), y0 + dy - head * (uy + 0.5 * ux));
      ctx.lineTo(x0 + dx, y0 + dy);
      ctx.lineTo(x0 + dx - head * (ux + 0.5 * uy), y0 + dy - head * (uy - 0.5 * ux));
      ctx.stroke();
    }
}

function windowSquare(ctx: CanvasRenderingContext2D, t: ViewTransform, cx: number, cy: number, r: number, color: string, dash: number[] = []): void {
  const [x, y] = t.toView(cx - r, cy - r);
  ctx.strokeStyle = cssColor(color);
  ctx.lineWidth = 2;
  ctx.setLineDash(dash);
  ctx.strokeRect(x, y, (2 * r + 1) * t.scale, (2 * r + 1) * t.scale);
  ctx.setLineDash([]);
}

function marker(ctx: CanvasRenderingContext2D, t: ViewTransform, u: number, v: number, kind: 'cross' | 'dot' | 'ring', color: string): void {
  if (Number.isNaN(u)) return;
  const [cx, cy] = t.toView((u + R) / H + 0.5, (v + R) / H + 0.5);
  ctx.strokeStyle = ctx.fillStyle = cssColor(color);
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (kind === 'cross') {
    ctx.moveTo(cx - 6, cy - 6);
    ctx.lineTo(cx + 6, cy + 6);
    ctx.moveTo(cx - 6, cy + 6);
    ctx.lineTo(cx + 6, cy - 6);
    ctx.stroke();
  } else if (kind === 'dot') {
    ctx.arc(cx, cy, 4.5, 0, 2 * Math.PI);
    ctx.fill();
  } else {
    ctx.arc(cx, cy, 7, 0, 2 * Math.PI);
    ctx.stroke();
  }
}

/**
 * Gray levels from the smallest error (black) up, on a square-root scale. The scale spans at least SPAN, so the tiny
 * differences of a flat window stay dark instead of being stretched into an optimum.
 */
const SPAN = 0.01;
function heatmap(n: number, E: Float64Array): Plane {
  let lo = Infinity, hi = -Infinity;
  for (const e of E) (lo = Math.min(lo, e)), (hi = Math.max(hi, e));
  const span = Math.max(hi - lo, SPAN);
  return { width: n, height: n, data: Float32Array.from(E, (e) => Math.sqrt((e - lo) / span)) };
}

function update(): void {
  const s = getScene(sceneKey());
  const f = getFrames(framesKey());
  const patch = getPatch(patchKey());
  const more = advance();
  const reg = solver!.flow;
  const regEpe = endpointError(reg, s.truth);
  const showError = state.show === 'error';
  const i = state.y * WIDTH + state.x;
  const sel = (ctx: CanvasRenderingContext2D, t: ViewTransform) => windowSquare(ctx, t, state.x, state.y, state.r, '--viz-highlight');

  views.i0.overlay = sel;
  views.i0.show(planeToImage(s.I0));
  views.i1.overlay = (ctx, t) => CARD_CENTERS.forEach(([cx, cy]) => windowSquare(ctx, t, cx, cy, CARD, '--viz-highlight', [5, 4]));
  views.i1.show(planeToImage(s.I1));

  views.patch.overlay = (ctx, t) => {
    hatch(ctx, t, (j) => Number.isNaN(patch.flow.u[j]), '--fg-faint');
    if (state.arrows) arrows(ctx, t, patch.flow);
    sel(ctx, t);
  };
  views.patch.show(showError ? planeToImage(errorImage(patch.epe)) : flowImage(patch.flow, MAX));
  views.reg.overlay = (ctx, t) => {
    if (state.arrows) arrows(ctx, t, reg);
    sel(ctx, t);
  };
  views.reg.show(showError ? planeToImage(errorImage(regEpe)) : flowImage(reg, MAX));
  sweepCaption.textContent = `${solver!.k} of ${state.iterations} iterations`;
  views.truth.overlay = (ctx, t) => {
    hatch(ctx, t, (j) => s.occluded[j] === 1, '--viz-highlight');
    if (state.arrows) arrows(ctx, t, s.truth);
    sel(ctx, t);
  };
  views.truth.show(flowImage(s.truth, MAX));
  views.wheel.show(wheel);

  const p = patchAt(f, state.x, state.y, { r: state.r, tau: tau(), ...PATCH });
  const n = 2 * state.r + 1;
  const crop = createPlane(n, n);
  for (let b = 0; b < n; b++)
    for (let a = 0; a < n; a++) {
      const x = Math.min(WIDTH - 1, Math.max(0, state.x - state.r + a)), y = Math.min(HEIGHT - 1, Math.max(0, state.y - state.r + b));
      crop.data[b * n + a] = s.I0.data[y * WIDTH + x];
    }
  views.window.show(planeToImage(crop));
  const surface = getSurface(surfaceKey());
  views.surface.overlay = (ctx, t) => {
    marker(ctx, t, s.truth.u[i], s.truth.v[i], 'cross', '--viz-points');
    marker(ctx, t, reg.u[i], reg.v[i], 'ring', '--viz-object');
    marker(ctx, t, p.u, p.v, 'dot', '--accent');
  };
  views.surface.show(planeToImage(heatmap(surface.n, surface.E)));
  windowCaption.textContent = `(${state.x}, ${state.y}), ${n} × ${n} px`;

  renderValues(s, f, p, patch.epe, reg, regEpe);
  if (more) schedule();
  else if (playing) stop();
}
const schedule = perFrame(update);

const VERDICT: Record<Kind, string> = {
  corner: 'both eigenvalues reach τ: a clear optimum, both components are found',
  edge: 'only λ₁ reaches τ: a valley, only the normal flow along the gradient is found (aperture problem)',
  flat: 'no eigenvalue reaches τ: no optimum, no estimate',
};

function renderValues(s: Scene, f: Frames, p: ReturnType<typeof patchAt>, patchEpe: Float32Array, reg: Flow, regEpe: Float32Array): void {
  const i = state.y * WIDTH + state.x;
  const truth = [s.truth.u[i], s.truth.v[i]];
  const { l1, l2 } = eigen2(p.system.sxx, p.system.sxy, p.system.syy);
  const patchResult = Number.isNaN(p.u)
    ? `<p class="warn">No estimate for this pixel.</p>`
    : eq(`\\mathbf{u} = ${texTuple([p.u, p.v], 2)},\\quad \\|\\mathbf{u} - \\mathbf{u}^*\\| = \\htmlClass{result}{${fmt(Math.hypot(p.u - truth[0], p.v - truth[1]), 2)}}\\ \\text{px}`);

  const { mu, mv, n } = neighborMean(reg, i);
  const { ix, iy, c } = solver!.linearization(i);
  const a2 = alpha() ** 2;
  const k = (ix * mu + iy * mv + c) / (a2 * n + ix * ix + iy * iy);
  const e = energy(f, reg);
  const eTrue = energy(f, s.truth);

  const rows = [1, 2, 3, 4, 0].map((l) => stats(REGIONS[l], (j) => s.label[j] === l && !s.boundary[j], patchEpe, regEpe));
  rows.push(stats('near motion boundaries', (j) => s.boundary[j] === 1, patchEpe, regEpe));

  values.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <h3>Patch-based at (${state.x}, ${state.y}), ${2 * state.r + 1}² window</h3>
        ${eq(`\\tfrac{1}{N} A^\\top A = ${texSciMatrix([[p.system.sxx, p.system.sxy], [p.system.sxy, p.system.syy]], 2)}`)}
        ${eq(`\\lambda_1 = ${sci(l1, 2)},\\quad \\lambda_2 = ${sci(l2, 2)},\\quad \\tau = ${sci(tau(), 2)}`)}
        <p class="small">${VERDICT[p.kind]}.</p>
        ${patchResult}
        ${eq(`\\mathbf{u}^* = ${texTuple(truth, 2)}`)}
      </div>
      <div class="value-block">
        <h3>Regularized at (${state.x}, ${state.y})</h3>
        ${eq(`\\bar{\\mathbf{u}}_i = ${texTuple([mu, mv], 3)},\\quad (I_x, I_y) = ${texTuple([ix, iy], 3)},\\quad c_i = ${fmt(c, 3)}`)}
        ${eq(`\\bar{\\mathbf{u}}_i - (I_x, I_y)\\, \\frac{I_x \\bar u_i + I_y \\bar v_i + c_i}{\\alpha^2 n + I_x^2 + I_y^2} = ${texTuple([mu - ix * k, mv - iy * k], 3)}`)}
        ${eq(`\\mathbf{u}_i = ${texTuple([reg.u[i], reg.v[i]], 3)},\\quad \\|\\mathbf{u}_i - \\mathbf{u}^*\\| = \\htmlClass{result}{${fmt(regEpe[i], 2)}}\\ \\text{px}`)}
        <p class="small">After enough iterations, every vector satisfies the update formula with its current neighbors.</p>
        ${eq(`E = ${fmt(e.data, 2)} + ${sci(a2, 2)} \\cdot ${fmt(e.smooth, 0)} = \\htmlClass{result}{${fmt(e.data + a2 * e.smooth, 2)}}`)}
        ${eq(`E(\\mathbf{u}^*) = ${fmt(eTrue.data, 2)} + ${sci(a2, 2)} \\cdot ${fmt(eTrue.smooth, 0)} = ${fmt(eTrue.data + a2 * eTrue.smooth, 2)}`)}
      </div>
      <div class="value-block">
        <h3>Mean error ${renderTex('\\|\\mathbf{u} - \\mathbf{u}^*\\|')} in pixels</h3>
        <table class="flow-table">
          <thead><tr><th>region</th><th>patch-based</th><th>no estimate</th><th>regularized</th></tr></thead>
          <tbody>${rows.join('')}</tbody>
        </table>
        <p class="small">Near motion boundaries: within 3 px of a card's edge. Hatched red in the true flow: background hidden in ${renderTex('I_1')}, without a correspondence. The image border is left out.</p>
      </div>
    </div>`;
}

function stats(name: string, include: (i: number) => boolean, patchEpe: Float32Array, regEpe: Float32Array): string {
  let sp = 0, np = 0, none = 0, sr = 0, n = 0;
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    if (!counted(i % WIDTH, Math.floor(i / WIDTH)) || !include(i)) continue;
    n++;
    sr += regEpe[i];
    if (Number.isNaN(patchEpe[i])) none++;
    else (sp += patchEpe[i]), np++;
  }
  const cell = (v: number) => (Number.isNaN(v) ? '–' : fmt(v, 2));
  return `<tr><td>${name}</td><td>${cell(sp / np)}</td><td>${Math.round((100 * none) / n)} %</td><td>${cell(sr / n)}</td></tr>`;
}

ui.on('change', () => {
  if (playing) stop();
  schedule();
});
onThemeChange(schedule);
update();
