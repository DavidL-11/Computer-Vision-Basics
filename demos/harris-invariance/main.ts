import { Pane } from 'tweakpane';
import type { Corner } from '../../src/shared/harris';
import { type Plane, planeToImage, toGray } from '../../src/shared/image';
import { addImagePicker } from '../../src/shared/imagePicker';
import { DEG } from '../../src/shared/linalg';
import { initPage } from '../../src/shared/page';
import { PixelView, type ViewTransform, perFrame } from '../../src/shared/pixelView';
import { Plot } from '../../src/shared/plot';
import { eq, fmt, texMatrix, texVector } from '../../src/shared/tex';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import { type Comparison, type DetectorParams, IDENTITY, type Transform, commonRegion, compareCorners, detectCorners, mapPoint, unmapPoint, warp } from './invariance';
import '../../src/shared/styles/demo.css';

initPage({ title: 'Harris invariance', chapterId: 'corners' });

const W = 200;
const H = 150;

function defaults() {
  return {
    angle: 0,
    scale: 1,
    tx: 0,
    ty: 0,
    gain: 1,
    bias: 0,
    sigmaD: 1,
    sigmaI: 2,
    alpha: 0.05,
    radius: 3,
    relative: false,
    logT: -5.5,
    fraction: 0.02,
    eps: 2,
  };
}
const state = defaults();

const pane = new Pane({ container: document.getElementById('controls')!, title: 'Harris invariance' });
let original: Plane = toGray(
  addImagePicker(pane, { names: ['shapes', 'scene', 'chart', 'text'], value: 'shapes', width: W, height: H }, (img) => {
    original = toGray(img);
    schedule();
  }),
);
const geometry = pane.addFolder({ title: 'Geometry' });
geometry.addBinding(state, 'angle', { label: 'rotation θ (°)', min: -180, max: 180, step: 1 });
geometry.addBinding(state, 'scale', { label: 'scale s', min: 0.5, max: 2, step: 0.01 });
geometry.addBinding(state, 'tx', { label: 'shift x', min: -30, max: 30, step: 0.5 });
geometry.addBinding(state, 'ty', { label: 'shift y', min: -30, max: 30, step: 0.5 });
const intensity = pane.addFolder({ title: 'Intensity' });
intensity.addBinding(state, 'gain', { label: 'contrast a', min: 0.25, max: 2, step: 0.01 });
intensity.addBinding(state, 'bias', { label: 'brightness b', min: -0.5, max: 0.5, step: 0.01 });
const detector = pane.addFolder({ title: 'Detector' });
detector.addBinding(state, 'sigmaD', { label: 'blur σ_D', min: 0, max: 3, step: 0.1 });
detector.addBinding(state, 'sigmaI', { label: 'window σ', min: 0.5, max: 5, step: 0.1 });
detector.addBinding(state, 'alpha', { label: 'α', min: 0, max: 0.2, step: 0.005 });
detector.addBinding(state, 'radius', { label: 'NMS radius', min: 1, max: 10, step: 1 });
detector.addBinding(state, 'relative', { label: 'relative threshold' });
const logT = detector.addBinding(state, 'logT', { label: 'log₁₀ t', min: -8, max: -3, step: 0.1 });
const fraction = detector.addBinding(state, 'fraction', { label: 't (× max C)', min: 0, max: 0.3, step: 0.001 });
pane.addBinding(state, 'eps', { label: 'match distance ε', min: 0.5, max: 5, step: 0.5 });
pane.addButton({ title: 'Reset' }).on('click', () => {
  Object.assign(state, defaults());
  pane.refresh();
});

const aView = new PixelView(document.getElementById('a-view')!);
const bView = new PixelView(document.getElementById('b-view')!);
const values = document.getElementById('values')!;

const transform = (): Transform => ({ ...state, angle: state.angle * DEG });
const params = (): DetectorParams => ({
  ...state,
  threshold: state.relative ? state.fraction : 10 ** state.logT,
});
/** Corners closer than this to a border are influenced by it: derivative filter plus window. */
const margin = () => Math.ceil(3 * state.sigmaI) + Math.ceil(3 * state.sigmaD) + 1;

interface Sweep {
  id: string;
  /** Parameter values; the others stay at the identity. */
  values: number[];
  apply: (v: number) => Partial<Transform>;
  current: () => number;
  format: (v: number) => string;
  ticks: number[];
  plot: Plot;
  results: ({ found: number; share: number } | null)[];
}

const steps = (n: number, a: number, b: number) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
const sweeps: Sweep[] = [
  {
    id: 'rotation',
    values: steps(13, 0, 90),
    apply: (v) => ({ angle: v * DEG }),
    current: () => state.angle,
    format: (v) => `${v}°`,
    ticks: [0, 15, 30, 45, 60, 75, 90],
    plot: null!,
    results: [],
  },
  {
    id: 'scale',
    values: steps(13, -1, 1),
    apply: (v) => ({ scale: 2 ** v }),
    current: () => Math.log2(state.scale),
    format: (v) => `${+(2 ** v).toFixed(2)}`,
    ticks: [-1, -0.5, 0, 0.5, 1],
    plot: null!,
    results: [],
  },
  {
    id: 'contrast',
    values: steps(13, -2, 1),
    apply: (v) => ({ gain: 2 ** v }),
    current: () => Math.log2(state.gain),
    format: (v) => `${+(2 ** v).toFixed(2)}`,
    ticks: [-2, -1.5, -1, -0.5, 0, 0.5, 1],
    plot: null!,
    results: [],
  },
  {
    id: 'brightness',
    values: steps(11, -0.5, 0.5),
    apply: (v) => ({ bias: v }),
    current: () => state.bias,
    format: (v) => fmt(v, 1),
    ticks: [-0.5, -0.25, 0, 0.25, 0.5],
    plot: null!,
    results: [],
  },
];
for (const s of sweeps) s.plot = new Plot(document.getElementById(`${s.id}-plot`)!, 170);

let base: { key: string; original: Plane; corners: Corner[] } | null = null;
let cmp: Comparison | null = null;
let cornersB: Corner[] = [];
let queue: [Sweep, number][] = [];
let running = false;

function detectorKey(): string {
  return JSON.stringify([state.sigmaD, state.sigmaI, state.alpha, state.radius, state.relative, state.logT, state.fraction, state.eps]);
}

function evaluate(T: Transform) {
  const B = warp(original, T);
  const b = detectCorners(B, params());
  const c = compareCorners(base!.corners, b, T, W, H, margin(), state.eps);
  return { B, b, c };
}

/** Sweeps take many detector runs, so they are computed a few per frame. */
function runSweeps(): void {
  const start = performance.now();
  while (queue.length > 0 && performance.now() - start < 12) {
    const [s, i] = queue.shift()!;
    const { c } = evaluate({ ...IDENTITY, ...s.apply(s.values[i]) });
    s.results[i] = { found: c.nA ? c.matches / c.nA : 0, share: c.nB ? c.matches / c.nB : 0 };
  }
  renderSweeps();
  if (queue.length > 0) requestAnimationFrame(runSweeps);
  else running = false;
}

function dimmed(I: Plane, common: (x: number, y: number) => boolean): Plane {
  const out = { ...I, data: I.data.slice() };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!common(x, y)) out.data[y * W + x] *= 0.35;
  return out;
}

function dot(ctx: CanvasRenderingContext2D, v: ViewTransform, x: number, y: number, r: number, color: string, fill: boolean): void {
  const [cx, cy] = v.toView(x + 0.5, y + 0.5);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, 2 * Math.PI);
  if (fill) {
    ctx.fillStyle = cssColor(color);
    ctx.fill();
  } else {
    ctx.strokeStyle = cssColor(color);
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

aView.overlay = (ctx, v) => {
  if (!base || !cmp) return;
  base.corners.forEach((c, i) => {
    const color = !cmp!.commonA[i] ? '--fg-faint' : cmp!.matchOfA[i] >= 0 ? '--axis-y' : '--viz-highlight';
    dot(ctx, v, c.x, c.y, 3.5, color, true);
  });
};

bView.overlay = (ctx, v) => {
  if (!base || !cmp) return;
  cornersB.forEach((c, j) => dot(ctx, v, c.x, c.y, 3, cmp!.commonB[j] ? '--viz-points' : '--fg-faint', true));
  const T = transform();
  base.corners.forEach((c, i) => {
    if (!cmp!.commonA[i]) return;
    const [x, y] = mapPoint(T, W, H, c.x, c.y);
    dot(ctx, v, x, y, 6.5, cmp!.matchOfA[i] >= 0 ? '--axis-y' : '--viz-highlight', false);
  });
};

function update(): void {
  logT.disabled = state.relative;
  fraction.disabled = !state.relative;
  const key = detectorKey();
  if (base?.key !== key || base.original !== original) {
    base = { key, original, corners: detectCorners(original, params()) };
    for (const s of sweeps) s.results = s.values.map(() => null);
    queue = sweeps.flatMap((s) => s.values.map((_, i) => [s, i] as [Sweep, number]));
    if (!running) {
      running = true;
      requestAnimationFrame(runSweeps);
    }
  }
  const T = transform();
  const { B, b, c } = evaluate(T);
  cornersB = b;
  cmp = c;

  const common = commonRegion(T, W, H, margin());
  aView.show(planeToImage(dimmed(original, common)));
  bView.show(planeToImage(dimmed(B, (x, y) => common(...unmapPoint(T, W, H, x, y)))));

  renderSweeps();
  renderValues(T);
}
const schedule = perFrame(update);

function renderSweeps(): void {
  for (const s of sweeps) {
    const x0 = s.values[0];
    const x1 = s.values[s.values.length - 1];
    const pad = (x1 - x0) * 0.02;
    const points = (k: 'found' | 'share') =>
      s.results.flatMap((r, i) => (r ? [[s.values[i], r[k]] as const] : []));
    s.plot.render({ x: [x0 - pad, x1 + pad], y: [0, 1.05] }, (p) => {
      p.grid(s.ticks, [0, 0.25, 0.5, 0.75, 1], { x: s.format, y: (v) => `${Math.round(v * 100)}%` });
      const current = s.current();
      if (current >= x0 - pad && current <= x1 + pad) p.vline(current, '--viz-highlight', { dash: [4, 4] });
      p.line(points('share'), '--viz-points', { width: 1.5, dash: [6, 4] });
      p.line(points('found'), '--accent', { width: 2.5 });
    });
  }
}

function renderValues(T: Transform): void {
  const c = cmp!;
  const cs = T.scale * Math.cos(T.angle);
  const sn = T.scale * Math.sin(T.angle);
  const percent = (a: number, b: number) => (b ? `${fmt((100 * a) / b, 0)}\\%` : '\\text{–}');
  const t = params().threshold;
  const tTex = state.relative ? `${fmt(state.fraction, 3)} \\cdot \\max C` : `10^{${fmt(state.logT, 1)}}`;

  values.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <h3>Transformation</h3>
        ${eq(`p' = s R(\\theta) (p - c) + c + t = ${texMatrix(
          [
            [cs, -sn],
            [sn, cs],
          ],
          3,
        )} (p - c) + c + ${texVector([T.tx, T.ty], 1)}`)}
        ${eq(`I_B = a \\, I_A + b = ${fmt(T.gain, 2)} \\, I_A ${T.bias < 0 ? '-' : '+'} ${fmt(Math.abs(T.bias), 2)}`)}
        ${eq(`M_B = a^2 M_A = ${fmt(T.gain ** 2, 3)} \\, M_A, \\qquad C_B = a^4 C_A = ${fmt(T.gain ** 4, 3)} \\, C_A`)}
        <p class="muted small">The last line holds only where no values are clipped to 0 or 1.</p>
      </div>
      <div class="value-block">
        <h3>Corners in the common region</h3>
        ${eq(`t = ${tTex}${state.relative ? '' : ` = ${t.toExponential(1).replace(/e(.*)/, ' \\cdot 10^{$1}')}`}, \\qquad \\varepsilon = ${fmt(state.eps, 1)} \\text{ px}`)}
        ${eq(`\\text{in } A\\text{: } ${c.nA}, \\qquad \\text{in } B\\text{: } ${c.nB}, \\qquad \\text{matched: } ${c.matches}`)}
        ${eq(`\\text{found again: } \\frac{${c.matches}}{${c.nA}} = \\htmlClass{result}{${percent(c.matches, c.nA)}}`)}
        ${eq(`\\text{corners of } B \\text{ with a partner in } A\\text{: } \\frac{${c.matches}}{${c.nB}} = ${percent(c.matches, c.nB)}`)}
      </div>
    </div>`;
}

pane.on('change', schedule);
onThemeChange(schedule);
update();
