import { Controls } from '../../src/shared/controls';
import { type Plane, planeToImage, toGray } from '../../src/shared/image';
import { addImagePicker } from '../../src/shared/imagePicker';
import { DEG, type Mat3 } from '../../src/shared/linalg';
import { gaussianNoise } from '../../src/shared/noise';
import { initPage } from '../../src/shared/page';
import { PixelView, type ViewTransform, perFrame } from '../../src/shared/pixelView';
import { Plot } from '../../src/shared/plot';
import { eq, fmt, renderTex, sci, texSciMatrix } from '../../src/shared/tex';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import { type Frames, type Model, type Outcome, PARAMETERS, type Step, align, apply, cornerError, corners, homography, linearize, prepare, warpImage } from './parametric';
import '../../src/shared/styles/demo.css';
import './parametric-alignment.css';

initPage({ title: 'Parametric alignment', chapterId: 'dense-motion' });

const W = 160;
const H = 120;
/** The test image is larger than the frames, so that I₁ has content where it moves past the border of I₀. */
const SOURCE_W = 200;
const SOURCE_H = 150;
const EPSILON = 0.001;
const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

const MODEL_NAMES: Record<Model, string> = {
  translation: 'translation (2)',
  euclidean: 'Euclidean (3)',
  affine: 'affine (6)',
  projective: 'projective (8)',
};
const MODEL_ORDER: Model[] = ['translation', 'euclidean', 'affine', 'projective'];

const defaults = () => ({
  model: 'affine' as Model,
  sigma: 1.5,
  maxIterations: 30,
  tx: 10,
  ty: -7,
  angle: 15,
  scale: 1.12,
  /** Perspective tilt in units of 10⁻³ per pixel. */
  g: 0,
  h: 0,
  noise: 0,
  gain: 4,
  k: 0,
});
const state = defaults();

const ui = new Controls();
const toolbar = ui.toolbar();
let imageVersion = 0;
let source: Plane = toGray(
  addImagePicker(
    toolbar,
    { names: ['scene', 'shapes', 'text', 'chart', 'blobs', 'gradients'], value: 'scene', width: SOURCE_W, height: SOURCE_H },
    (img) => {
      source = toGray(img);
      imageVersion++;
      schedule();
    },
  ),
);
toolbar.addBinding(state, 'model', { label: 'motion model', options: Object.fromEntries(MODEL_ORDER.map((m) => [MODEL_NAMES[m], m])) });
toolbar.addBinding(state, 'sigma', { label: 'pre-smoothing σ', min: 0, max: 5, step: 0.1 });
toolbar.addBinding(state, 'k', { label: 'shown step k', min: 0, max: 100, step: 1 });
const playButton = toolbar.addButton({ title: 'Play', primary: true, icon: 'play' });
playButton.on('click', () => (timer ? stop() : play(true)));
toolbar.addButton({ title: 'Next step', icon: 'next' }).on('click', () => {
  stop();
  state.k++;
  ui.refresh();
});
toolbar.addResetButton(() => {
  stop();
  Object.assign(state, defaults());
  ui.refresh();
  schedule();
});

const truth = ui.panel('i1-view').addFolder({ title: 'True motion' });
truth.addBinding(state, 'tx', { label: 'shift x (px)', min: -15, max: 15, step: 0.1 });
truth.addBinding(state, 'ty', { label: 'shift y (px)', min: -15, max: 15, step: 0.1 });
truth.addBinding(state, 'angle', { label: 'rotation (°)', min: -25, max: 25, step: 0.5 });
truth.addBinding(state, 'scale', { label: 'scale', min: 0.8, max: 1.25, step: 0.01 });
truth.addBinding(state, 'g', { label: 'tilt g (× 10⁻³ / px)', min: -2, max: 2, step: 0.1 });
truth.addBinding(state, 'h', { label: 'tilt h (× 10⁻³ / px)', min: -2, max: 2, step: 0.1 });
ui.panel('i1-view').addBinding(state, 'noise', { label: 'noise σₙ', min: 0, max: 0.1, step: 0.005 });
ui.panel('warped-view').addBinding(state, 'gain', { label: 'error contrast', options: { '1×': 1, '2×': 2, '4×': 4, '8×': 8 } });
ui.panel('corner-plot').addBinding(state, 'maxIterations', { label: 'max. iterations', min: 1, max: 100, step: 1 });

let timer = 0;
let lastStep = 0;
/** `reveal`: scroll the animated panel into view (when started with the Play button). */
function play(reveal = false): void {
  stop();
  ui.playing(true, reveal ? 'warped-view' : undefined);
  state.k = 0;
  ui.refresh();
  playButton.title = 'Stop';
  playButton.icon = 'stop';
  timer = window.setInterval(() => {
    if (state.k >= lastStep) return stop();
    state.k++;
    ui.refresh();
  }, 450);
}
function stop(): void {
  window.clearInterval(timer);
  timer = 0;
  ui.playing(false);
  playButton.title = 'Play';
  playButton.icon = 'play';
}

const view0 = new PixelView(document.getElementById('i0-view')!);
const view1 = new PixelView(document.getElementById('i1-view')!);
const warpedView = new PixelView(document.getElementById('warped-view')!);
const errorView = new PixelView(document.getElementById('error-view')!);
const error0View = new PixelView(document.getElementById('error0-view')!);
const cornerPlot = new Plot(document.getElementById('corner-plot')!, 200);
const errorPlot = new Plot(document.getElementById('error-plot')!, 200);
const values = document.getElementById('values')!;
const stepCaption = document.getElementById('step-caption')!;
const jacobianCaption = document.getElementById('jacobian-caption')!;

/** One small view per parameter, rebuilt when the model changes. */
const jacobianRow = document.getElementById('jacobian-row')!;
let jacobianViews: { model: Model; views: PixelView[] } | null = null;
function jacobianViewsFor(model: Model): PixelView[] {
  if (jacobianViews?.model === model) return jacobianViews.views;
  jacobianRow.replaceChildren();
  const views = PARAMETERS[model].map((name) => {
    const fig = document.createElement('figure');
    const box = document.createElement('div');
    const caption = document.createElement('figcaption');
    caption.innerHTML = renderTex(`\\partial e / \\partial ${name}`);
    fig.append(box, caption);
    jacobianRow.append(fig);
    return new PixelView(box);
  });
  jacobianRow.style.setProperty('--count', String(views.length));
  jacobianViews = { model, views };
  return views;
}

/** The true motion as a matrix acting on coordinates relative to the image center. */
function trueMotion(): Mat3 {
  const c = state.scale * Math.cos(state.angle * DEG);
  const s = state.scale * Math.sin(state.angle * DEG);
  return [c, -s, state.tx, s, c, state.ty, state.g * 1e-3, state.h * 1e-3, 1];
}

/** The simplest model that can express the true motion. */
function neededModel(): Model {
  if (state.g !== 0 || state.h !== 0) return 'projective';
  if (state.scale !== 1) return 'affine';
  if (state.angle !== 0) return 'euclidean';
  return 'translation';
}

/** Recomputes a value only when its key changes. */
function cached<T>(compute: () => T): (key: string) => T {
  let last: { key: string; value: T } | null = null;
  return (key) => {
    if (last?.key !== key) last = { key, value: compute() };
    return last.value;
  };
}

const framesKey = () => [imageVersion, state.tx, state.ty, state.angle, state.scale, state.g, state.h, state.noise, state.sigma].join();
const getFrames = cached((): Frames => {
  let I1 = warpImage(source, trueMotion(), W, H);
  if (state.noise > 0) I1 = gaussianNoise(I1, state.noise, 1);
  return prepare(warpImage(source, IDENTITY, W, H), I1, state.sigma);
});
const getAlignment = cached(() => align(getFrames(framesKey()), state.model, { maxIterations: state.maxIterations, epsilon: EPSILON }));
const getInitial = cached(() => linearize(getFrames(framesKey()), state.model, PARAMETERS[state.model].map(() => 0), true));

/** The border of I₀ moved by H, as a closed quadrilateral (pixel centers at integer coordinates). */
function quad(ctx: CanvasRenderingContext2D, t: ViewTransform, Hm: Mat3, color: string, dash: number[] = []): void {
  const cx = (W - 1) / 2;
  const cy = (H - 1) / 2;
  ctx.strokeStyle = cssColor(color);
  ctx.lineWidth = 2;
  ctx.setLineDash(dash);
  ctx.beginPath();
  for (const [x, y] of corners(W, H)) {
    const [u, v] = apply(Hm, x, y);
    ctx.lineTo(...t.toView(u + cx + 0.5, v + cy + 0.5));
  }
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
}

/** Marks the pixels that do not count, given as NaN. */
function outsideOverlay(data: Float32Array): (ctx: CanvasRenderingContext2D, t: ViewTransform) => void {
  return (ctx, t) => {
    ctx.fillStyle = cssColor('--viz-object');
    ctx.globalAlpha = 0.55;
    data.forEach((v, i) => {
      if (!Number.isNaN(v)) return;
      const [x, y] = t.toView(i % W, Math.floor(i / W));
      ctx.fillRect(x, y, t.scale + 0.5, t.scale + 0.5);
    });
    ctx.globalAlpha = 1;
  };
}

const errorPlane = (e: Float32Array): Plane => ({ width: W, height: H, data: e.map((v) => (Number.isNaN(v) ? 0.5 : 0.5 + state.gain * v)) });

function update(): void {
  const model = state.model;
  const frames = getFrames(framesKey());
  const alignKey = [framesKey(), model, state.maxIterations].join();
  const { steps, outcome } = getAlignment(alignKey);
  const initial = getInitial([framesKey(), model].join());
  lastStep = steps.length - 1;
  if (state.k > lastStep) {
    state.k = lastStep;
    ui.refresh();
  }
  const k = state.k;
  const s = steps[k];
  const Hk = homography(model, s.p);
  const Hstar = trueMotion();
  const images = linearize(frames, model, s.p, true);

  view0.show(planeToImage(frames.I0));
  view1.overlay = (ctx, t) => {
    quad(ctx, t, Hstar, '--viz-points', [6, 4]);
    quad(ctx, t, Hk, '--accent');
  };
  view1.show(planeToImage(frames.I1));

  stepCaption.textContent = String(k);
  jacobianCaption.textContent = String(k);
  warpedView.overlay = outsideOverlay(images.warped);
  warpedView.show(planeToImage({ width: W, height: H, data: images.warped.map((v) => (Number.isNaN(v) ? 0.5 : v)) }));
  errorView.overlay = outsideOverlay(images.e);
  errorView.show(planeToImage(errorPlane(images.e)));
  error0View.overlay = outsideOverlay(initial.e);
  error0View.show(planeToImage(errorPlane(initial.e)));

  jacobianViewsFor(model).forEach((view, j) => {
    const J = images.J[j];
    let max = 0;
    for (const v of J) if (!Number.isNaN(v)) max = Math.max(max, Math.abs(v));
    view.overlay = outsideOverlay(J);
    view.show(planeToImage({ width: W, height: H, data: J.map((v) => (Number.isNaN(v) ? 0.5 : 0.5 + (0.5 * v) / (max || 1))) }));
  });

  drawPlots(steps, k, model, Hstar);
  renderValues(steps, k, outcome, model, Hstar);
}
const schedule = perFrame(update);

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const pow10 = (e: number) => (e === 0 ? '1' : `10${e < 0 ? '⁻' : ''}${[...String(Math.abs(e))].map((d) => SUPERSCRIPT[+d]).join('')}`);

function logPlot(plot: Plot, series: number[], k: number, floor: number, top: number): void {
  const log = (x: number) => Math.max(floor, Math.log10(Math.max(x, 1e-12)));
  const last = Math.max(series.length - 1, 5);
  const points = series.map((v, i) => [i, log(v)] as const);
  plot.render({ x: [0, last], y: [floor, top] }, (fr) => {
    const xTicks = Array.from({ length: last + 1 }, (_, i) => i).filter((i) => i % Math.ceil(last / 10) === 0);
    const yTicks = Array.from({ length: top - floor + 1 }, (_, i) => floor + i);
    fr.grid(xTicks, yTicks, { y: pow10 });
    fr.vline(k, '--fg-faint', { dash: [4, 4] });
    fr.line(points, '--accent');
    fr.stems([points[k]], '--accent');
  });
}

function drawPlots(steps: Step[], k: number, model: Model, Hstar: Mat3): void {
  logPlot(
    cornerPlot,
    steps.map((st) => cornerError(homography(model, st.p), Hstar, W, H)),
    k,
    -4,
    2,
  );
  logPlot(
    errorPlot,
    steps.map((st) => Math.sqrt(st.system.E)),
    k,
    -4,
    0,
  );
}

const OUTCOMES: Record<Outcome, string> = {
  converged: 'converged',
  singular: 'stopped: A is singular, the image does not determine all parameters',
  diverged: 'stopped: the estimate moved the image out of I₁',
  'max-iterations': 'stopped after the maximum number of iterations',
};

/** A parameter value: small ones (perspective terms) in scientific notation. */
const num = (v: number) => (v !== 0 && Math.abs(v) < 0.01 ? sci(v, 2) : fmt(v, 3));
const texParams = (model: Model, p: readonly number[]) =>
  `\\begin{bmatrix} ${PARAMETERS[model].join(' & ')} \\end{bmatrix} = \\begin{bmatrix} ${p.map(num).join(' & ')} \\end{bmatrix}`;
const rows3 = (m: Mat3) => [m.slice(0, 3), m.slice(3, 6), m.slice(6, 9)];
const texH = (m: Mat3) => `\\begin{bmatrix} ${rows3(m).map((r) => r.map(num).join(' & ')).join(' \\\\ ')} \\end{bmatrix}`;

function capability(model: Model): string {
  const need = neededModel();
  const enough = MODEL_ORDER.indexOf(model) >= MODEL_ORDER.indexOf(need);
  const name = (m: Model) => MODEL_NAMES[m].replace(/ \(\d\)/, '');
  return enough
    ? `The true motion is ${need === model ? '' : 'also '}${need === 'translation' ? 'a translation' : `${name(need)}`}${need === model ? '' : `, which the ${name(model)} model includes`}: the error can reach zero.`
    : `The true motion needs the ${name(need)} model. The ${name(model)} model can only find the best compromise, and some error remains.`;
}

function renderValues(steps: Step[], k: number, outcome: Outcome, model: Model, Hstar: Mat3): void {
  const s = steps[k];
  const n = s.p.length;
  const last = steps[steps.length - 1];
  const updates = steps.length - 1;
  const next = s.dp
    ? eq(`\\Delta\\mathbf{p} = A^{-1} \\mathbf{b} = \\begin{bmatrix} ${s.dp.map(num).join(' & ')} \\end{bmatrix}^\\top`)
    : `<p class="warn">${outcome === 'diverged' ? 'Too few pixels of I₀ land inside I₁.' : `${renderTex('A')} cannot be inverted, so there is no update.`}</p>`;
  const Ehat = homography(model, last.p);

  values.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <h3>Step ${k}: ${n} parameters, ${s.system.count.toLocaleString('en')} pixels</h3>
        ${eq(`\\mathbf{p}_{${k}}: \\; ${texParams(model, s.p)}`)}
        ${eq(`A = \\sum_i \\mathbf{J}_1^\\top \\mathbf{J}_1 = ${texSciMatrix(s.system.A, 2)},\\quad \\mathbf{b} = ${texSciMatrix(s.system.b.map((v) => [v]), 2)}`)}
        ${next}
        ${eq(`E(\\mathbf{p}_{${k}}) = \\tfrac{1}{N} \\sum_i e_i^2 = ${sci(s.system.E, 3)}`)}
      </div>
      <div class="value-block">
        <h3>Result after ${updates} update${updates === 1 ? '' : 's'}</h3>
        ${eq(`H(\\hat{\\mathbf{p}}) = ${texH(Ehat)},\\qquad H^* = ${texH(Hstar)}`)}
        ${eq(`\\text{corner error } = \\htmlClass{result}{${sci(cornerError(Ehat, Hstar, W, H), 2)}}\\ \\text{px},\\qquad E = ${sci(last.system.E, 3)}`)}
        <p class="small">${OUTCOMES[outcome]}${outcome === 'converged' ? `, when the next update moved the corners by less than ${EPSILON} px` : ''}.</p>
        <p class="small">${capability(model)}</p>
        <p class="small muted">Both matrices act on ${renderTex('(x, y, 1)')} with ${renderTex('x, y')} measured from the image center.</p>
      </div>
    </div>`;
}

ui.on('change', schedule);
onThemeChange(schedule);
update();
