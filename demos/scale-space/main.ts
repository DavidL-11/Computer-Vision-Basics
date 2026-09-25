import { Pane } from 'tweakpane';
import { type Keypoint, type KeypointStatus, type Octave, buildScaleSpace, detectKeypoints, dogSignature, edgeLimit, normalizedLoG } from '../../src/shared/dog';
import { type Plane, planeToImage, toGray } from '../../src/shared/image';
import { addImagePicker } from '../../src/shared/imagePicker';
import { gaussianNoise } from '../../src/shared/noise';
import { initPage } from '../../src/shared/page';
import { PixelView, type ViewTransform, perFrame } from '../../src/shared/pixelView';
import { Plot } from '../../src/shared/plot';
import { eq, fmt, renderTex } from '../../src/shared/tex';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import { IDENTITY, warp } from '../../src/shared/warp';
import '../../src/shared/styles/demo.css';
import './scale-space.css';

initPage({ title: 'Scale space & DoG', chapterId: 'features' });

const W = 240;
const H = 180;

function defaults() {
  return {
    scale: 1,
    noise: 0,
    sigma0: 1.6,
    intervals: 3,
    octaves: 4,
    threshold: 0.03,
    edgeRatio: 10,
    interpolate: true,
    rejected: false,
    octave: 0,
    x: 71,
    y: 22,
  };
}
const state = defaults();

const pane = new Pane({ container: document.getElementById('controls')!, title: 'Scale space' });
let original: Plane = toGray(
  addImagePicker(pane, { names: ['blobs', 'shapes', 'scene', 'text'], value: 'blobs', width: W, height: H }, (img) => {
    original = toGray(img);
    schedule();
  }),
);
let previousScale = state.scale;
pane.addBinding(state, 'scale', { label: 'image scale', min: 0.5, max: 2, step: 0.01 }).on('change', () => {
  // Keep the selection on the same scene point, scaled around the image center.
  const f = state.scale / previousScale;
  state.x = Math.round(Math.min(W - 1, Math.max(0, (W - 1) / 2 + f * (state.x - (W - 1) / 2))));
  state.y = Math.round(Math.min(H - 1, Math.max(0, (H - 1) / 2 + f * (state.y - (H - 1) / 2))));
  previousScale = state.scale;
});
pane.addBinding(state, 'noise', { label: 'noise σₙ', min: 0, max: 0.1, step: 0.005 });
const spaceFolder = pane.addFolder({ title: 'Scale space' });
spaceFolder.addBinding(state, 'sigma0', { label: 'σ₀', min: 1, max: 2.5, step: 0.1 });
spaceFolder.addBinding(state, 'intervals', { label: 'intervals s', min: 1, max: 5, step: 1 });
spaceFolder.addBinding(state, 'octaves', { label: 'octaves', min: 1, max: 5, step: 1 });
const keyFolder = pane.addFolder({ title: 'Keypoints' });
keyFolder.addBinding(state, 'threshold', { label: 'contrast t', min: 0, max: 0.1, step: 0.001 });
keyFolder.addBinding(state, 'edgeRatio', { label: 'edge ratio r', min: 1, max: 40, step: 0.5 });
keyFolder.addBinding(state, 'interpolate', { label: 'interpolate' });
keyFolder.addBinding(state, 'rejected', { label: 'show rejected' });
const octaveBinding = pane.addBinding(state, 'octave', { label: 'show octave', min: 0, max: 4, step: 1 });
pane.addButton({ title: 'Reset' }).on('click', () => {
  Object.assign(state, defaults());
  previousScale = state.scale;
  pane.refresh();
});

const select = (x: number, y: number) => {
  state.x = x;
  state.y = y;
  schedule();
};
const imageView = new PixelView(document.getElementById('image-view')!, select);
const signaturePlot = new Plot(document.getElementById('signature-plot')!, 300, { left: 50, right: 14, top: 14, bottom: 30 });
const gaussRow = document.getElementById('gauss-row')!;
const dogRow = document.getElementById('dog-row')!;
const values = document.getElementById('values')!;

interface Space {
  key: string;
  original: Plane;
  image: Plane;
  octaves: Octave[];
  /** Largest |D| over all DoG images, for a common gray scale. */
  maxAbs: number;
}
let space: Space | null = null;
let keypoints: Keypoint[] = [];
let rows: { gauss: PixelView[]; dogs: PixelView[]; key: string } | null = null;

const k = () => 2 ** (1 / state.intervals);
const visible = (kp: Keypoint) => kp.status === 'kept' || state.rejected;

/** A row of small views for the images of one octave; clicking selects the corresponding image point. */
function buildRows(octave: Octave): void {
  const key = `${octave.gaussians.length}`;
  if (rows?.key === key) return;
  const make = (container: HTMLElement, n: number, label: (i: number) => string) =>
    Array.from({ length: n }, (_, i) => {
      const figure = document.createElement('figure');
      const frame = document.createElement('div');
      const caption = document.createElement('figcaption');
      caption.innerHTML = label(i);
      figure.append(frame, caption);
      container.append(figure);
      return new PixelView(frame, (x, y) => select(Math.min(W - 1, x * rowStep()), Math.min(H - 1, y * rowStep())));
    });
  gaussRow.replaceChildren();
  dogRow.replaceChildren();
  const s = octave.gaussians.length - 3;
  rows = {
    key,
    gauss: make(gaussRow, s + 3, (i) => renderTex(`L_{${i}}`)),
    dogs: make(dogRow, s + 2, (i) => renderTex(`D_{${i}}`) + (i >= 1 && i <= s ? ' <span class="searched">searched</span>' : '')),
  };
}
const rowStep = () => space!.octaves[Math.min(state.octave, space!.octaves.length - 1)].step;

const STATUS_COLOR: Record<KeypointStatus, string> = { kept: '', 'low contrast': '--fg-faint', edge: '--fg-faint', unstable: '--fg-faint' };
const keyColor = (kp: Keypoint) => (kp.status === 'kept' ? (kp.value > 0 ? '--viz-points' : '--accent') : STATUS_COLOR[kp.status]);

/** A circle of radius √2σ, the radius of a disk whose LoG response peaks at σ. */
function circle(ctx: CanvasRenderingContext2D, v: ViewTransform, x: number, y: number, sigma: number, color: string, dashed: boolean, width = 1.5): void {
  const [cx, cy] = v.toView(x + 0.5, y + 0.5);
  ctx.strokeStyle = cssColor(color);
  ctx.lineWidth = width;
  ctx.setLineDash(dashed ? [3, 3] : []);
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(2, Math.SQRT2 * sigma * v.scale), 0, 2 * Math.PI);
  ctx.stroke();
  ctx.setLineDash([]);
}

function marker(ctx: CanvasRenderingContext2D, v: ViewTransform, x: number, y: number): void {
  const [px, py] = v.toView(x, y);
  const size = Math.max(v.scale, 6);
  ctx.strokeStyle = cssColor('--viz-highlight');
  ctx.lineWidth = 2;
  ctx.strokeRect(px + (v.scale - size) / 2, py + (v.scale - size) / 2, size, size);
}

imageView.overlay = (ctx, v) => {
  for (const kp of keypoints) if (visible(kp)) circle(ctx, v, kp.x, kp.y, kp.sigma, keyColor(kp), kp.status !== 'kept');
  const near = nearest();
  if (near) circle(ctx, v, near.x, near.y, near.sigma, '--viz-highlight', false, 2.5);
  marker(ctx, v, state.x, state.y);
};

/** The candidate whose circle contains the selected point, closest to it relative to its size. */
function nearest(): Keypoint | null {
  let best: Keypoint | null = null;
  let bestD = Infinity;
  for (const kp of keypoints) {
    if (!visible(kp)) continue;
    const d = Math.hypot(kp.x - state.x, kp.y - state.y) / (Math.SQRT2 * kp.sigma);
    if (d <= 1 && d < bestD) [best, bestD] = [kp, d];
  }
  return best;
}

function update(): void {
  const key = JSON.stringify([state.scale, state.noise, state.sigma0, state.intervals, state.octaves]);
  if (space?.key !== key || space.original !== original) {
    const image = gaussianNoise(state.scale === 1 ? original : warp(original, { ...IDENTITY, scale: state.scale }), state.noise, 1);
    const octaves = buildScaleSpace(image, state);
    const maxAbs = Math.max(1e-6, ...octaves.flatMap((o) => o.dogs.map((d) => d.data.reduce((m, v) => Math.max(m, Math.abs(v)), 0))));
    space = { key, original, image, octaves, maxAbs };
  }
  const { image, octaves, maxAbs } = space;
  keypoints = detectKeypoints(octaves, state);
  if (state.octave > octaves.length - 1) {
    state.octave = octaves.length - 1;
    octaveBinding.refresh();
  }

  imageView.show(planeToImage(image));
  const octave = octaves[state.octave];
  buildRows(octave);
  const s = state.intervals;
  const [x, y] = [state.x / octave.step, state.y / octave.step];
  const rowOverlay = (level: number | null) => (ctx: CanvasRenderingContext2D, v: ViewTransform) => {
    if (level !== null)
      for (const kp of keypoints)
        if (kp.octave === state.octave && kp.level === level && visible(kp)) circle(ctx, v, kp.u, kp.v, kp.sigmaOctave, keyColor(kp), kp.status !== 'kept', 1.5);
    marker(ctx, v, Math.floor(x), Math.floor(y));
  };
  octave.gaussians.forEach((L, i) => {
    rows!.gauss[i].overlay = rowOverlay(null);
    rows!.gauss[i].show(planeToImage(L));
  });
  octave.dogs.forEach((D, i) => {
    rows!.dogs[i].overlay = rowOverlay(i >= 1 && i <= s ? i : null);
    rows!.dogs[i].show(planeToImage({ ...D, data: D.data.map((d) => 0.5 + d / (2 * maxAbs)) }));
  });
  const size = `${octave.gaussians[0].width} × ${octave.gaussians[0].height}`;
  const sigmaRange = (n: number) =>
    `σ = ${fmt(octave.sigmas[0] * octave.step, 2)} … ${fmt(octave.sigmas[n - 1] * octave.step, 2)} image pixels`;
  document.getElementById('gauss-caption')!.innerHTML =
    `Octave ${state.octave}: Gaussian images ${renderTex('L_i')} <span class="muted">${size} pixels, ${sigmaRange(s + 3)}</span>`;
  document.getElementById('dog-caption')!.innerHTML =
    `Octave ${state.octave}: DoG images ${renderTex('D_i = L_i - L_{i+1}')} <span class="muted">0 = gray, same scale in every octave</span>`;

  renderSignature(image, octaves);
  renderValues(octaves);
}
const schedule = perFrame(update);

let signature: { key: string; log: [number, number][] } | null = null;

function renderSignature(image: Plane, octaves: Octave[]): void {
  const samples = dogSignature(octaves, state.x, state.y);
  const lo = Math.log2(samples[0].sigma) - 0.15;
  const hi = Math.log2(samples[samples.length - 1].sigma) + 0.15;
  const key = JSON.stringify([space!.key, state.x, state.y]);
  if (signature?.key !== key || signature.log.length === 0) {
    const n = 80;
    signature = {
      key,
      log: Array.from({ length: n }, (_, i) => {
        const t = lo + ((hi - lo) * i) / (n - 1);
        return [t, -(k() - 1) * normalizedLoG(image, state.x, state.y, 2 ** t)];
      }),
    };
  }
  const log = signature.log;
  const yMax = 1.15 * Math.max(0.01, ...samples.map((s) => Math.abs(s.value)), ...log.map((p) => Math.abs(p[1])));
  const near = nearest();
  signaturePlot.render({ x: [lo, hi], y: [-yMax, yMax] }, (p) => {
    const xt: number[] = [];
    for (let t = Math.ceil(lo * 2) / 2; t <= hi; t += 0.5) xt.push(t);
    const yStep = yMax > 0.2 ? 0.1 : yMax > 0.1 ? 0.05 : yMax > 0.04 ? 0.02 : 0.01;
    const yt: number[] = [];
    for (let v = -Math.floor(yMax / yStep) * yStep; v <= yMax; v += yStep) yt.push(+v.toFixed(3));
    p.grid(xt, yt, { x: (t) => fmt(2 ** t, 1), y: (v) => fmt(v, yStep < 0.05 ? 2 : 1) });
    // Octave boundaries.
    octaves.forEach((o, i) => {
      if (i > 0) p.vline(Math.log2(o.sigmas[0] * o.step), '--fg-faint', { dash: [2, 4] });
    });
    if (Math.abs(state.threshold) > 0) {
      p.line([[lo, state.threshold], [hi, state.threshold]], '--fg-faint', { width: 1, dash: [6, 4] });
      p.line([[lo, -state.threshold], [hi, -state.threshold]], '--fg-faint', { width: 1, dash: [6, 4] });
    }
    p.line(log, '--viz-points', { width: 2, dash: [6, 4] });
    p.stems(samples.map((s) => [Math.log2(s.sigma), s.value] as const), '--accent', 3);
    if (near) p.vline(Math.log2(near.sigma), '--viz-highlight', { width: 2 });
    p.label('σ (image pixels, log scale)', hi, -yMax, '--fg-muted', 'right', 'bottom');
    p.label('±t', lo + 0.02, state.threshold, '--fg-muted', 'left', 'bottom');
  });
}

const STATUS_TEXT: Record<KeypointStatus, string> = {
  kept: 'kept',
  'low contrast': 'rejected: low contrast',
  edge: 'rejected: on an edge',
  unstable: 'rejected: the interpolation did not settle',
};

function renderValues(octaves: Octave[]): void {
  const s = state.intervals;
  const kk = k();
  const samples = dogSignature(octaves, state.x, state.y);
  const peak = samples.reduce((a, b) => (Math.abs(b.value) > Math.abs(a.value) ? b : a));
  const count = (f: (kp: Keypoint) => boolean) => keypoints.filter(f).length;
  const kept = keypoints.filter((kp) => kp.status === 'kept');
  const near = nearest();
  const limit = edgeLimit(state.edgeRatio);

  let keypointBlock = `<p class="small muted">Click inside a circle to inspect its keypoint${state.rejected ? '' : ', or show the rejected points'}.</p>`;
  if (near) {
    const [du, dv, ds] = near.offset;
    keypointBlock = `
      ${eq(`\\text{octave } ${near.octave}, \\quad D_{${near.level}} \\text{ at } (${fmt(near.u - du, 0)}, ${fmt(near.v - dv, 0)}), \\quad D = ${fmt(near.value, 4)}`)}
      ${state.interpolate ? eq(`\\hat{\\mathbf{x}} = -H^{-1} \\nabla D = (${fmt(du, 2)},\\ ${fmt(dv, 2)},\\ ${fmt(ds, 2)})`) : ''}
      ${eq(`|D(\\hat{\\mathbf{x}})| = ${fmt(Math.abs(near.contrast), 4)} ${Math.abs(near.contrast) >= state.threshold ? '\\ge' : '<'} t = ${fmt(state.threshold, 3)}`)}
      ${eq(`\\frac{\\operatorname{trace}(H)^2}{\\det(H)} = ${Number.isFinite(near.edge) ? fmt(near.edge, 2) : '\\infty'} ${near.edge < limit ? '<' : '\\ge'} \\frac{(r + 1)^2}{r} = ${fmt(limit, 2)}`)}
      ${eq(`(x, y) = (${fmt(near.x, 1)},\\ ${fmt(near.y, 1)}), \\quad \\sigma = ${fmt(near.sigma, 2)}, \\quad \\sqrt{2}\\,\\sigma = ${fmt(Math.SQRT2 * near.sigma, 1)}`)}
      <p class="small">This point is <strong>${STATUS_TEXT[near.status]}</strong>.</p>`;
  }

  values.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <h3>Scale space</h3>
        ${eq(`k = 2^{1/s} = 2^{1/${s}} = ${fmt(kk, 4)}, \\qquad \\sigma_i = \\sigma_0 k^i`)}
        ${eq(`\\text{octave ${state.octave}: } \\sigma = ${octaves[state.octave].sigmas.map((v) => fmt(v * octaves[state.octave].step, 2)).join(',\\ ')}`)}
        ${eq(`D(\\sigma) = G_\\sigma * I - G_{k\\sigma} * I \\approx -${fmt(kk - 1, 3)}\\, \\sigma^2 \\nabla^2 L`)}
      </div>
      <div class="value-block">
        <h3>At (${state.x}, ${state.y})</h3>
        ${eq(`\\text{largest } |D| \\text{ at } \\sigma = ${fmt(peak.sigma, 2)}: \\quad D = ${fmt(peak.value, 4)}`)}
        ${eq(`\\text{a disk of radius } \\sqrt{2}\\,\\sigma = ${fmt(Math.SQRT2 * peak.sigma, 1)} \\text{ pixels}`)}
        <h3>Keypoints</h3>
        ${eq(`\\text{extrema: } ${keypoints.length}, \\quad \\text{low contrast: } ${count((kp) => kp.status === 'low contrast')}, \\quad \\text{edge: } ${count((kp) => kp.status === 'edge')}, \\quad \\text{unstable: } ${count((kp) => kp.status === 'unstable')}`)}
        ${eq(`\\text{kept: } \\htmlClass{result}{${kept.length}} \\quad (${kept.filter((kp) => kp.value > 0).length} \\text{ maxima}, ${kept.filter((kp) => kp.value < 0).length} \\text{ minima})`)}
      </div>
      <div class="value-block">
        <h3>Selected keypoint</h3>
        ${keypointBlock}
      </div>
    </div>`;
}

pane.on('change', schedule);
onThemeChange(schedule);
update();
