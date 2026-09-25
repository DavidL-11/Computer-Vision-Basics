import { Pane } from 'tweakpane';
import { type Plane, planeToImage, psnr, toGray } from '../../src/shared/image';
import { addImagePicker } from '../../src/shared/imagePicker';
import { initPage } from '../../src/shared/page';
import { PixelView, type ViewTransform, perFrame } from '../../src/shared/pixelView';
import { eq, fmt } from '../../src/shared/tex';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import { type Noise, gaussianNoise, meanFilter, median, medianFilter, neighborhood, saltAndPepper } from './denoise';
import { ProfileView } from './profileView';
import '../../src/shared/styles/demo.css';
import './median-filter.css';

initPage({ title: 'Median vs mean filter', chapterId: 'filtering' });

const W = 160;
const H = 120;

function defaults() {
  return { noise: 'salt-pepper' as Noise, density: 0.1, sigma: 0.08, size: 3, zoom: 1, seed: 1, x: 60, y: 70 };
}
const state = defaults();

const pane = new Pane({ container: document.getElementById('controls')!, title: 'Median vs mean' });
let original: Plane = toGray(
  addImagePicker(pane, { names: ['scene', 'chart', 'text', 'gradients'], value: 'scene', width: W, height: H }, (img) => {
    original = toGray(img);
    schedule();
  }),
);
const noiseFolder = pane.addFolder({ title: 'Noise' });
noiseFolder.addBinding(state, 'noise', { label: 'type', options: { 'salt & pepper': 'salt-pepper', Gaussian: 'gaussian' } });
const densityBinding = noiseFolder.addBinding(state, 'density', { label: 'density', min: 0, max: 0.5, step: 0.01 });
const sigmaBinding = noiseFolder.addBinding(state, 'sigma', { label: 'σ', min: 0, max: 0.3, step: 0.01 });
noiseFolder.addButton({ title: 'New noise' }).on('click', () => {
  state.seed++;
  schedule();
});
pane.addBinding(state, 'size', { label: 'filter size', options: { '3 × 3': 3, '5 × 5': 5, '7 × 7': 7, '9 × 9': 9 } });
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
const views = ['noisy-view', 'original-view', 'mean-view', 'median-view'].map((id) => new PixelView(document.getElementById(id)!, pick));
const profileView = new ProfileView(document.getElementById('profile-view')!);
const values = document.getElementById('values')!;

function marker(ctx: CanvasRenderingContext2D, t: ViewTransform): void {
  const r = (state.size - 1) / 2;
  const [, rowY] = t.toView(0, state.y + 0.5);
  ctx.strokeStyle = cssColor('--viz-highlight');
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, rowY);
  ctx.lineTo(ctx.canvas.width, rowY);
  ctx.stroke();
  ctx.setLineDash([]);
  const [x, y] = t.toView(state.x - r, state.y - r);
  const size = Math.max(state.size * t.scale, 6);
  ctx.lineWidth = 2;
  ctx.strokeRect(x - (size - state.size * t.scale) / 2, y - (size - state.size * t.scale) / 2, size, size);
}
for (const view of views) view.overlay = marker;

let cache: { key: string; original: Plane; noisy: Plane; mean: Plane; median: Plane } | null = null;

function update(): void {
  densityBinding.hidden = state.noise !== 'salt-pepper';
  sigmaBinding.hidden = state.noise !== 'gaussian';
  const key = JSON.stringify([state.noise, state.density, state.sigma, state.size, state.seed]);
  if (cache?.key !== key || cache.original !== original) {
    const noisy = state.noise === 'salt-pepper' ? saltAndPepper(original, state.density, state.seed) : gaussianNoise(original, state.sigma, state.seed);
    cache = { key, original, noisy, mean: meanFilter(noisy, state.size), median: medianFilter(noisy, state.size) };
  }
  const { noisy, mean, median: med } = cache;
  [noisy, original, mean, med].forEach((p, i) => views[i].show(planeToImage(p)));
  for (const view of views) view.setZoom(state.zoom, center.x + 0.5, center.y + 0.5);
  profileView.render({ original, noisy, mean, median: med, row: state.y, column: state.x });
  const caption = `${state.size} × ${state.size}`;
  document.getElementById('mean-caption')!.textContent = caption;
  document.getElementById('median-caption')!.textContent = caption;
  renderValues(noisy, mean, med);
}
const schedule = perFrame(update);

function chip(v: number, cls = ''): string {
  const c = Math.round(v * 255);
  return `<span class="chip ${cls}" style="background: rgb(${c} ${c} ${c}); color: ${v > 0.55 ? '#000' : '#fff'}">${fmt(v, 2)}</span>`;
}

function renderValues(noisy: Plane, mean: Plane, med: Plane): void {
  const { x, y, size } = state;
  const hood = neighborhood(noisy, x, y, size);
  const sorted = [...hood].sort((a, b) => a - b);
  const mid = (sorted.length - 1) / 2;
  const i = y * W + x;
  const best = psnr(original, mean) > psnr(original, med) ? 'mean' : 'median';
  const dB = (p: Plane) => {
    const v = psnr(original, p);
    return Number.isFinite(v) ? `${fmt(v, 1)} \\text{ dB}` : '\\infty';
  };
  const db = (p: Plane, name: string) => `\\htmlClass{${name === best ? 'result' : 'normal'}}{${dB(p)}}`;

  values.innerHTML = `
    <div class="value-grid">
      <div class="value-block sorted-block">
        <h3>${size} × ${size} window around (${x}, ${y}), sorted</h3>
        <div class="chips">${sorted.map((v, k) => chip(v, k === mid ? 'median' : '')).join('')}</div>
        <p class="muted small">The median is the value in the middle, number ${mid + 1} of ${sorted.length}.</p>
      </div>
      <div class="value-block">
        <h3>Output at (${x}, ${y})</h3>
        ${eq(`B = \\frac{1}{${size * size}} \\sum_{i=1}^{${size * size}} I_i = \\htmlClass{result}{${fmt(mean.data[i], 3)}}`)}
        ${eq(`M = \\operatorname{median} \\{ I_1, \\dots, I_{${size * size}} \\} = \\htmlClass{result}{${fmt(median(hood), 3)}}`)}
        ${eq(`\\text{noisy} = ${fmt(noisy.data[i], 3)}, \\qquad \\text{original} = ${fmt(original.data[i], 3)}`)}
      </div>
      <div class="value-block">
        <h3>PSNR against the original</h3>
        ${eq(`\\text{noisy: } ${dB(noisy)}`)}
        ${eq(`\\text{mean: } ${db(mean, 'mean')}, \\qquad \\text{median: } ${db(med, 'median')}`)}
      </div>
    </div>`;
}

pane.on('change', schedule);
onThemeChange(schedule);
update();
