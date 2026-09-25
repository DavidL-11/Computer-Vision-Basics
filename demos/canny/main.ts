import { Pane } from 'tweakpane';
import { type Plane, type RGB, type RGBImage, createImage, planeToImage, toGray } from '../../src/shared/image';
import { addImagePicker } from '../../src/shared/imagePicker';
import { gaussianNoise } from '../../src/shared/noise';
import { initPage } from '../../src/shared/page';
import { PixelView, type ViewTransform, perFrame } from '../../src/shared/pixelView';
import { eq, fmt } from '../../src/shared/tex';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import { type Gradient, STRONG, WEAK, WEAK_EDGE, gradient, hysteresis, nonMaximumSuppression, suppressionAt } from './canny';
import '../../src/shared/styles/demo.css';
import './canny.css';

initPage({ title: 'Canny edge detector', chapterId: 'edges' });

const W = 240;
const H = 180;

function defaults() {
  return { noise: 0, seed: 1, sigma: 1.4, high: 0.3, low: 0.12, zoom: 1, x: 41, y: 116 };
}
const state = defaults();

const pane = new Pane({ container: document.getElementById('controls')!, title: 'Canny' });
let original: Plane = toGray(
  addImagePicker(pane, { names: ['scene', 'chart', 'text'], value: 'scene', width: W, height: H }, (img) => {
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
pane.addBinding(state, 'sigma', { label: 'Gaussian σ', min: 0.5, max: 5, step: 0.1 });
const thresholds = pane.addFolder({ title: 'Hysteresis (× max magnitude)' });
thresholds.addBinding(state, 'high', { label: 'high', min: 0, max: 1, step: 0.01 });
thresholds.addBinding(state, 'low', { label: 'low', min: 0, max: 1, step: 0.01 });
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
const inputView = view('input-view');
const ixView = view('ix-view');
const iyView = view('iy-view');
const magnitudeView = view('magnitude-view');
const angleView = view('angle-view');
const nmsView = view('nms-view');
const classesView = view('classes-view');
const edgesView = view('edges-view');
const views = [inputView, ixView, iyView, magnitudeView, angleView, nmsView, classesView, edgesView];
const values = document.getElementById('values')!;

/** 'rgb(r, g, b)' → [r, g, b] in [0, 1] */
const tokenRgb = (name: string) => (cssColor(name).match(/[\d.]+/g) ?? ['0', '0', '0']).slice(0, 3).map((v) => Number(v) / 255) as RGB;

/** Fully saturated color of hue h in turns, as on an HSV color wheel. */
function hue(h: number): RGB {
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    return 1 - Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
}

function orientationImage(g: Gradient, max: number): RGBImage {
  const img = createImage(g.angle.width, g.angle.height);
  for (let i = 0; i < g.angle.data.length; i++) {
    const turns = (g.angle.data[i] / (2 * Math.PI) + 1) % 1;
    const brightness = Math.min(1, (2 * g.magnitude.data[i]) / max);
    img.data.set(
      hue(turns).map((c) => c * brightness),
      i * 3,
    );
  }
  return img;
}

function classesImage(classes: Uint8Array): RGBImage {
  const img = createImage(W, H);
  const kept = tokenRgb('--accent');
  const dropped = tokenRgb('--viz-highlight').map((c) => 0.7 * c) as RGB;
  classes.forEach((c, i) => {
    if (c === STRONG) img.data.fill(1, i * 3, i * 3 + 3);
    else if (c === WEAK_EDGE) img.data.set(kept, i * 3);
    else if (c === WEAK) img.data.set(dropped, i * 3);
  });
  return img;
}

const maxAbs = (...planes: Plane[]) => planes.reduce((m, p) => p.data.reduce((a, v) => Math.max(a, Math.abs(v)), m), 1e-6);
const scaled = (p: Plane, max: number) => planeToImage({ ...p, data: p.data.map((v) => v / max) });
const signed = (p: Plane, max: number) => planeToImage({ ...p, data: p.data.map((v) => 0.5 + v / max) });

function selection(ctx: CanvasRenderingContext2D, t: ViewTransform): void {
  const [px, py] = t.toView(state.x, state.y);
  const size = Math.max(t.scale, 6);
  ctx.strokeStyle = cssColor('--viz-highlight');
  ctx.lineWidth = 2;
  ctx.strokeRect(px + (t.scale - size) / 2, py + (t.scale - size) / 2, size, size);
}

/** The gradient direction through q, with the interpolation points p (ahead) and r (behind). */
function direction(ctx: CanvasRenderingContext2D, t: ViewTransform): void {
  selection(ctx, t);
  if (!gradients) return;
  const s = suppressionAt(gradients.g, state.x, state.y);
  if (s.dx === 0 && s.dy === 0) return;
  const at = (k: number) => t.toView(state.x + 0.5 + k * s.dx, state.y + 0.5 + k * s.dy);
  const reach = Math.max(1.5, 14 / t.scale);
  ctx.strokeStyle = cssColor('--viz-points');
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(...at(-reach));
  ctx.lineTo(...at(reach));
  ctx.stroke();
  ctx.fillStyle = cssColor('--viz-points');
  for (const k of [1, -1]) {
    ctx.beginPath();
    ctx.arc(...at(k), Math.min(4, Math.max(2.5, t.scale / 5)), 0, 2 * Math.PI);
    ctx.fill();
  }
}

/** A small color wheel as the key for θ; canvas angles also turn clockwise from +x. */
function wheel(ctx: CanvasRenderingContext2D, t: ViewTransform): void {
  selection(ctx, t);
  const r = 13;
  const cx = ctx.canvas.clientWidth - r - 6;
  const cy = r + 6;
  const conic = ctx.createConicGradient(0, cx, cy);
  for (let k = 0; k <= 12; k++) conic.addColorStop(k / 12, `hsl(${k * 30} 100% 50%)`);
  ctx.fillStyle = conic;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, 2 * Math.PI);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.stroke();
}

for (const v of views) v.overlay = selection;
magnitudeView.overlay = direction;
nmsView.overlay = direction;
angleView.overlay = wheel;

let gradients: { key: string; original: Plane; noisy: Plane; g: Gradient; thin: Plane; max: number } | null = null;

function update(): void {
  const key = JSON.stringify([state.noise, state.seed, state.sigma]);
  if (gradients?.key !== key || gradients.original !== original) {
    const noisy = gaussianNoise(original, state.noise, state.seed);
    const g = gradient(noisy, state.sigma);
    const max = maxAbs(g.magnitude);
    gradients = { key, original, noisy, g, thin: nonMaximumSuppression(g), max };
  }
  const { noisy, g, thin, max } = gradients;
  const high = state.high * max;
  const low = Math.min(state.low, state.high) * max;
  const classes = hysteresis(thin, low, high);
  const edges = classes.map((c) => (c === STRONG || c === WEAK_EDGE ? 1 : 0));

  inputView.show(planeToImage(noisy));
  const dMax = maxAbs(g.ix, g.iy);
  ixView.show(signed(g.ix, 2 * dMax));
  iyView.show(signed(g.iy, 2 * dMax));
  magnitudeView.show(scaled(g.magnitude, max));
  angleView.show(orientationImage(g, max));
  nmsView.show(scaled(thin, max));
  classesView.show(classesImage(classes));
  edgesView.show(planeToImage({ width: W, height: H, data: Float32Array.from(edges) }));
  for (const v of views) v.setZoom(state.zoom, center.x + 0.5, center.y + 0.5);

  renderValues(g, thin, classes, low, high, max);
}
const schedule = perFrame(update);

const CLASS_TEXT: Record<number, string> = {
  [STRONG]: 'strong edge pixel',
  [WEAK_EDGE]: 'weak, connected to a strong pixel: edge',
  [WEAK]: 'weak, not connected to a strong pixel: dropped',
};

function renderValues(g: Gradient, thin: Plane, classes: Uint8Array, low: number, high: number, max: number): void {
  const { x, y } = state;
  const i = y * W + x;
  const m = g.magnitude.data[i];
  const s = suppressionAt(g, x, y);
  const count = (f: (c: number) => boolean) => classes.reduce((n, c) => n + (f(c) ? 1 : 0), 0);
  const aboveLow = g.magnitude.data.reduce((n, v) => n + (v > 0 && v >= low ? 1 : 0), 0);
  const thinAboveLow = count((c) => c !== 0);
  const cls = thin.data[i] === 0 ? (m === 0 ? 'no gradient' : 'suppressed in step 3') : thin.data[i] < low ? 'below the low threshold: noise' : CLASS_TEXT[classes[i]];

  values.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <h3>1 · Derivatives at q = (${x}, ${y})</h3>
        ${eq(`I_x = ${fmt(g.ix.data[i], 4)}, \\qquad I_y = ${fmt(g.iy.data[i], 4)}`)}
        <h3>2 · Gradient</h3>
        ${eq(`\\|\\nabla I\\| = \\sqrt{I_x^2 + I_y^2} = \\htmlClass{result}{${fmt(m, 4)}}`)}
        ${eq(`\\theta = \\operatorname{atan2}(I_y, I_x) = ${fmt((g.angle.data[i] * 180) / Math.PI, 1)}^\\circ`)}
      </div>
      <div class="value-block">
        <h3>3 · Non-maximum suppression</h3>
        ${eq(`\\|\\nabla I\\|(q) = ${fmt(m, 4)}`)}
        ${eq(`\\|\\nabla I\\|(p) = ${fmt(s.p, 4)} \\quad \\text{at } q + (${fmt(s.dx, 2)},\\ ${fmt(s.dy, 2)})`)}
        ${eq(`\\|\\nabla I\\|(r) = ${fmt(s.r, 4)} \\quad \\text{at } q - (${fmt(s.dx, 2)},\\ ${fmt(s.dy, 2)})`)}
        <p class="small">${m === 0 ? 'No gradient here.' : s.keep ? '<strong>Kept:</strong> q is a maximum along the gradient.' : '<strong>Suppressed:</strong> a neighbor along the gradient is larger.'}</p>
      </div>
      <div class="value-block">
        <h3>4 · Hysteresis</h3>
        ${eq(`t_\\text{high} = ${fmt(state.high, 2)} \\cdot ${fmt(max, 4)} = ${fmt(high, 4)}`)}
        ${eq(`t_\\text{low} = ${fmt(Math.min(state.low, state.high), 2)} \\cdot ${fmt(max, 4)} = ${fmt(low, 4)}`)}
        <p class="small">q: <strong>${cls}</strong>.</p>
        ${state.low > state.high ? '<p class="warn">The low threshold is above the high one and is used as equal to it.</p>' : ''}
      </div>
      <div class="value-block">
        <h3>Pixel counts</h3>
        ${eq(`\\|\\nabla I\\| \\ge t_\\text{low} \\text{ before step 3: } ${aboveLow}`)}
        ${eq(`\\text{after step 3: } ${thinAboveLow}`)}
        ${eq(`\\text{strong: } ${count((c) => c === STRONG)}, \\quad \\text{weak kept: } ${count((c) => c === WEAK_EDGE)}, \\quad \\text{weak dropped: } ${count((c) => c === WEAK)}`)}
        ${eq(`\\text{edge pixels: } \\htmlClass{result}{${count((c) => c === STRONG || c === WEAK_EDGE)}}`)}
      </div>
    </div>`;
}

pane.on('change', schedule);
onThemeChange(schedule);
update();
