import { Pane } from 'tweakpane';
import { buildScaleSpace, detectKeypoints } from '../../src/shared/dog';
import { type Plane, createImage, toGray } from '../../src/shared/image';
import { addImagePicker } from '../../src/shared/imagePicker';
import { DEG } from '../../src/shared/linalg';
import { gaussianNoise } from '../../src/shared/noise';
import { initPage } from '../../src/shared/page';
import { PixelView, perFrame } from '../../src/shared/pixelView';
import { Plot, ticks } from '../../src/shared/plot';
import { type Feature, siftFeatures } from '../../src/shared/sift';
import { eq, fmt } from '../../src/shared/tex';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import { type Transform, warp } from '../../src/shared/warp';
import { type Counts, type Criterion, type Match, type Matching, count, histogram, matchFeatures, tradeoff } from './matching';
import '../../src/shared/styles/demo.css';

initPage({ title: 'Matching & ratio test', chapterId: 'features' });

const W = 240;
const H = 180;
const GAP = 8;
const SPACE = { sigma0: 1.6, intervals: 3, octaves: 4 };
/** Features closer to a border than this are left out: their descriptor windows would reach outside the image. */
const MARGIN = 6;

function defaults() {
  return {
    angle: 25,
    scale: 0.8,
    noise: 0.02,
    gain: 1,
    threshold: 0.01,
    criterion: 'ratio' as Criterion,
    maxDistance: 0.4,
    maxRatio: 0.8,
    show: 'accepted',
    eps: 3,
  };
}
const state = defaults();

const pane = new Pane({ container: document.getElementById('controls')!, title: 'Matching' });
let original: Plane = toGray(
  addImagePicker(pane, { names: ['scene', 'shapes', 'chart', 'text', 'blobs'], value: 'scene', width: W, height: H }, (img) => {
    original = toGray(img);
    schedule();
  }),
);
const transformFolder = pane.addFolder({ title: 'Image B' });
transformFolder.addBinding(state, 'angle', { label: 'rotation θ (°)', min: -180, max: 180, step: 1 });
transformFolder.addBinding(state, 'scale', { label: 'scale s', min: 0.5, max: 2, step: 0.01 });
transformFolder.addBinding(state, 'gain', { label: 'contrast α', min: 0.5, max: 1.5, step: 0.01 });
transformFolder.addBinding(state, 'noise', { label: 'noise σₙ', min: 0, max: 0.1, step: 0.005 });
const matchFolder = pane.addFolder({ title: 'Matching' });
matchFolder.addBinding(state, 'criterion', { label: 'accept by', options: { 'distance d₁': 'distance', 'ratio d₁/d₂': 'ratio' } });
matchFolder.addBinding(state, 'maxDistance', { label: 'max distance', min: 0, max: 1.2, step: 0.01 });
matchFolder.addBinding(state, 'maxRatio', { label: 'max ratio τ', min: 0.1, max: 1, step: 0.01 });
matchFolder.addBinding(state, 'show', { label: 'show', options: { accepted: 'accepted', rejected: 'rejected', all: 'all' } });
pane.addBinding(state, 'eps', { label: 'correct within ε', min: 1, max: 6, step: 0.5 });
pane.addBinding(state, 'threshold', { label: 'keypoint contrast t', min: 0.005, max: 0.08, step: 0.001 });
pane.addButton({ title: 'Reset' }).on('click', () => {
  Object.assign(state, defaults());
  pane.refresh();
});

const pairView = new PixelView(document.getElementById('pair-view')!);
const distancePlot = new Plot(document.getElementById('distance-plot')!, 220);
const ratioPlot = new Plot(document.getElementById('ratio-plot')!, 220);
const tradeoffPlot = new Plot(document.getElementById('tradeoff-plot')!, 260, { left: 50, right: 14, top: 14, bottom: 34 });
const values = document.getElementById('values')!;

const transform = (): Transform => ({ angle: state.angle * DEG, scale: state.scale, tx: 0, ty: 0, gain: state.gain, bias: 0 });

function features(I: Plane): Feature[] {
  const octaves = buildScaleSpace(I, SPACE);
  const keypoints = detectKeypoints(octaves, { ...SPACE, threshold: state.threshold, edgeRatio: 10, interpolate: true });
  const inside = keypoints.filter((k) => k.x >= MARGIN && k.y >= MARGIN && k.x <= W - 1 - MARGIN && k.y <= H - 1 - MARGIN);
  return siftFeatures(octaves, inside);
}

let cacheA: { key: string; original: Plane; features: Feature[] } | null = null;
let cacheB: { key: string; original: Plane; image: Plane; features: Feature[] } | null = null;
let result: Matching = { matches: [], possible: 0 };

const threshold = (c: Criterion) => (c === 'distance' ? state.maxDistance : state.maxRatio);
const accepted = (m: Match) => (state.criterion === 'distance' ? m.d1 : m.ratio) <= threshold(state.criterion);

pairView.overlay = (ctx, v) => {
  if (!cacheA || !cacheB) return;
  const A = cacheA.features;
  const B = cacheB.features;
  const dot = (x: number, y: number, color: string) => {
    const [cx, cy] = v.toView(x + 0.5, y + 0.5);
    ctx.fillStyle = cssColor(color);
    ctx.fillRect(cx - 1.5, cy - 1.5, 3, 3);
  };
  for (const f of A) dot(f.keypoint.x, f.keypoint.y, '--viz-points');
  for (const f of B) dot(f.keypoint.x + W + GAP, f.keypoint.y, '--viz-points');
  ctx.lineWidth = 1.25;
  // Incorrect matches on top, so they don't hide behind the many correct ones.
  const shown = result.matches.filter((m) => state.show === 'all' || accepted(m) === (state.show === 'accepted'));
  for (const correct of [true, false])
    for (const m of shown) {
      if (m.correct !== correct) continue;
      const a = A[m.a].keypoint;
      const b = B[m.b].keypoint;
      ctx.strokeStyle = cssColor(correct ? '--axis-y' : '--viz-highlight');
      ctx.globalAlpha = accepted(m) ? 0.9 : 0.45;
      ctx.beginPath();
      ctx.moveTo(...v.toView(a.x + 0.5, a.y + 0.5));
      ctx.lineTo(...v.toView(b.x + W + GAP + 0.5, b.y + 0.5));
      ctx.stroke();
    }
  ctx.globalAlpha = 1;
};

function update(): void {
  const keyA = JSON.stringify([state.threshold]);
  if (cacheA?.key !== keyA || cacheA.original !== original) cacheA = { key: keyA, original, features: features(original) };
  const T = transform();
  const keyB = JSON.stringify([keyA, T, state.noise]);
  if (cacheB?.key !== keyB || cacheB.original !== original) {
    const image = gaussianNoise(warp(original, T), state.noise, 1);
    cacheB = { key: keyB, original, image, features: features(image) };
  }
  result = matchFeatures(cacheA.features, cacheB.features, T, W, H, MARGIN, state.eps);

  const pair = createImage(2 * W + GAP, H);
  const background = (cssColor('--bg-elev').match(/[\d.]+/g) ?? ['255']).slice(0, 3).map((c) => Number(c) / 255);
  for (let i = 0; i < pair.data.length; i += 3) pair.data.set(background, i);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      pair.data.fill(original.data[y * W + x], (y * pair.width + x) * 3, (y * pair.width + x) * 3 + 3);
      const j = (y * pair.width + x + W + GAP) * 3;
      pair.data.fill(cacheB.image.data[y * W + x], j, j + 3);
    }
  pairView.show(pair);

  renderHistograms();
  renderTradeoff();
  renderValues();
}
const schedule = perFrame(update);

function renderHistogram(plot: Plot, c: Criterion, hi: number): void {
  const bins = 25;
  const width = hi / bins;
  const correct = histogram(result.matches.filter((m) => m.correct).map((m) => (c === 'distance' ? m.d1 : m.ratio)), 0, hi, bins);
  const incorrect = histogram(result.matches.filter((m) => !m.correct).map((m) => (c === 'distance' ? m.d1 : m.ratio)), 0, hi, bins);
  const yMax = Math.max(0.1, ...correct, ...incorrect) * 1.1;
  plot.render({ x: [0, hi], y: [0, yMax] }, (p) => {
    p.grid(ticks(0, hi, 5), ticks(0, yMax, 4), { x: (v) => fmt(v, 1), y: (v) => `${Math.round(v * 100)}%` });
    const t = threshold(c);
    p.band(0, Math.min(t, hi), c === state.criterion ? '--accent' : '--fg-faint', 0.1);
    const steps = (h: number[]) => h.flatMap((v, i) => [[i * width, v], [(i + 1) * width, v]] as const);
    p.line(steps(correct), '--axis-y', { width: 2 });
    p.line(steps(incorrect), '--viz-highlight', { width: 2 });
    p.vline(t, c === state.criterion ? '--accent' : '--fg-muted', { width: 2, dash: c === state.criterion ? [] : [5, 4] });
    p.label('share of the matches', 0.01 * hi, yMax, '--fg-muted', 'left', 'top');
  });
}

function renderHistograms(): void {
  renderHistogram(distancePlot, 'distance', 1.2);
  renderHistogram(ratioPlot, 'ratio', 1);
}

function renderTradeoff(): void {
  const n = result.matches.length;
  const curves: [Criterion, string][] = [
    ['distance', '--viz-points'],
    ['ratio', '--accent'],
  ];
  const incorrectTotal = result.matches.filter((m) => !m.correct).length;
  const xMax = Math.max(5, incorrectTotal) * 1.03;
  const yMax = Math.max(5, result.possible, n - incorrectTotal) * 1.08;
  tradeoffPlot.render({ x: [0, xMax], y: [0, yMax] }, (p) => {
    p.grid(ticks(0, xMax, 8), ticks(0, yMax, 5), { x: (v) => String(v), y: (v) => String(v) });
    p.line([[0, result.possible], [xMax, result.possible]], '--fg-muted', { width: 1.5, dash: [6, 4] });
    for (const [c, color] of curves) {
      p.line(tradeoff(result.matches, c), color, { width: 2.5 });
      const k = count(result.matches, c, threshold(c));
      const { ctx } = p;
      ctx.fillStyle = cssColor(color);
      ctx.strokeStyle = cssColor('--bg-elev');
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.X(k.incorrect), p.Y(k.correct), c === state.criterion ? 7 : 5, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
    }
    p.label('incorrect matches accepted →', xMax, 0, '--fg-muted', 'right', 'bottom');
    p.label('correct matches accepted', xMax * 0.005, yMax, '--fg-muted', 'left', 'top');
  });
}

function renderValues(): void {
  const { matches, possible } = result;
  const correct = matches.filter((m) => m.correct).length;
  const row = (c: Criterion, k: Counts) => {
    const precision = k.accepted ? `${fmt((100 * k.correct) / k.accepted, 0)}\\%` : '\\text{–}';
    const recall = possible ? `${fmt((100 * k.correct) / possible, 0)}\\%` : '\\text{–}';
    const rule = c === 'distance' ? `d_1 \\le ${fmt(state.maxDistance, 2)}` : `d_1 / d_2 \\le ${fmt(state.maxRatio, 2)}`;
    const body = `${rule}\\text{: } ${k.accepted} \\text{ accepted, } ${k.correct} \\text{ correct, } ${k.incorrect} \\text{ incorrect}`;
    return `${eq(c === state.criterion ? `\\htmlClass{result}{${body}}` : body)}
      ${eq(`\\quad \\text{correct among accepted: } ${precision}, \\quad \\text{of all possible: } ${recall}`)}`;
  };
  values.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <h3>Features</h3>
        ${eq(`A\\text{: } ${cacheA!.features.length}, \\qquad B\\text{: } ${cacheB!.features.length}`)}
        ${eq(`\\text{in the common region of } A\\text{: } ${matches.length}`)}
        ${eq(`\\text{with a partner in } B \\text{ within } \\varepsilon = ${fmt(state.eps, 1)}\\text{: } ${possible}`)}
      </div>
      <div class="value-block">
        <h3>Nearest neighbors</h3>
        ${eq(`\\text{correct: } ${correct}, \\qquad \\text{incorrect: } ${matches.length - correct}`)}
        <h3>Accepted</h3>
        ${row('distance', count(matches, 'distance', state.maxDistance))}
        ${row('ratio', count(matches, 'ratio', state.maxRatio))}
      </div>
    </div>`;
}

pane.on('change', schedule);
onThemeChange(schedule);
update();
