import { Pane } from 'tweakpane';
import { type Plane, planeToImage, toGray } from '../../src/shared/image';
import { addImagePicker } from '../../src/shared/imagePicker';
import { initPage } from '../../src/shared/page';
import { PixelView, type ViewTransform, perFrame } from '../../src/shared/pixelView';
import { eq, fmt } from '../../src/shared/tex';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import { type Method, type Peak, type Template, extractPatch, findPeaks, prepareTemplate, scoreAt, scoreMap } from './matching';
import '../../src/shared/styles/demo.css';
import './template-matching.css';

initPage({ title: 'Template matching', chapterId: 'filtering' });

const W = 240;
const H = 180;

// The black ring on white in the colored-text image.
function defaults() {
  return { method: 'ncc' as Method, size: 25, count: 6, tx: 210, ty: 165, px: 210, py: 165 };
}
const state = defaults();

const pane = new Pane({ container: document.getElementById('controls')!, title: 'Template matching' });
let gray: Plane = toGray(
  addImagePicker(pane, { names: ['text', 'chart', 'scene'], value: 'text', width: W, height: H }, (img) => {
    gray = toGray(img);
    schedule();
  }),
);
pane.addBinding(state, 'size', { label: 'template size', min: 5, max: 41, step: 2 });
pane.addBinding(state, 'method', {
  label: 'score',
  options: { correlation: 'correlation', 'zero-mean correlation': 'zero-mean', 'SSD (shown as −SSD)': 'ssd', NCC: 'ncc' },
});
pane.addBinding(state, 'count', { label: 'matches', min: 1, max: 12, step: 1 });
pane.addButton({ title: 'Reset' }).on('click', () => {
  Object.assign(state, defaults());
  pane.refresh();
});

const radius = () => (state.size - 1) / 2;
const clampCenter = (v: number, n: number) => Math.min(n - 1 - radius(), Math.max(radius(), v));

const imageView = new PixelView(document.getElementById('image-view')!, (x, y) => {
  state.tx = state.px = clampCenter(x, W);
  state.ty = state.py = clampCenter(y, H);
  schedule();
});
const scoreView = new PixelView(document.getElementById('score-view')!, (x, y) => {
  state.px = x;
  state.py = y;
  schedule();
});
const templateView = new PixelView(document.getElementById('template-view')!);
const values = document.getElementById('values')!;

let peaks: Peak[] = [];

function box(ctx: CanvasRenderingContext2D, t: ViewTransform, x: number, y: number): [number, number, number] {
  const [vx, vy] = t.toView(x - radius(), y - radius());
  const s = state.size * t.scale;
  ctx.strokeRect(vx, vy, s, s);
  return [vx, vy, s];
}

function drawMatches(ctx: CanvasRenderingContext2D, t: ViewTransform): void {
  ctx.strokeStyle = ctx.fillStyle = cssColor('--viz-points');
  ctx.lineWidth = 1.5;
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.textBaseline = 'bottom';
  peaks.forEach((p, i) => {
    const [vx, vy] = box(ctx, t, p.x, p.y);
    ctx.fillText(String(i + 1), vx + 2, vy - 1);
  });
}

imageView.overlay = (ctx, t) => {
  drawMatches(ctx, t);
  ctx.strokeStyle = cssColor('--viz-highlight');
  ctx.lineWidth = 2.5;
  box(ctx, t, state.tx, state.ty);
};
scoreView.overlay = (ctx, t) => {
  drawMatches(ctx, t);
  const [x, y] = t.toView(state.px, state.py);
  const size = Math.max(t.scale, 6);
  ctx.strokeStyle = cssColor('--viz-highlight');
  ctx.lineWidth = 2;
  ctx.strokeRect(x + (t.scale - size) / 2, y + (t.scale - size) / 2, size, size);
};

/** Bright = good match. NCC keeps its fixed range [−1, 1]; the others are stretched to their range. */
function scoreImage(map: Plane): Plane {
  const r = radius();
  let lo = -1;
  let hi = 1;
  if (state.method !== 'ncc') {
    lo = Infinity;
    hi = -Infinity;
    for (let y = r; y < H - r; y++)
      for (let x = r; x < W - r; x++) {
        lo = Math.min(lo, map.data[y * W + x]);
        hi = Math.max(hi, map.data[y * W + x]);
      }
  }
  const out = { ...map, data: new Float32Array(map.data.length) };
  for (let y = r; y < H - r; y++) for (let x = r; x < W - r; x++) out.data[y * W + x] = hi > lo ? (map.data[y * W + x] - lo) / (hi - lo) : 0.5;
  return out;
}

let cache: { key: string; gray: Plane; template: Template; map: Plane } | null = null;

function update(): void {
  state.tx = clampCenter(state.tx, W);
  state.ty = clampCenter(state.ty, H);
  const key = JSON.stringify([state.tx, state.ty, state.size, state.method]);
  if (cache?.key !== key || cache.gray !== gray) {
    const patch = extractPatch(gray, state.tx, state.ty, state.size);
    const template = prepareTemplate(patch);
    cache = { key, gray, template, map: scoreMap(gray, template, state.method) };
    templateView.show(planeToImage(patch));
    scoreView.show(planeToImage(scoreImage(cache.map)));
  }
  peaks = findPeaks(cache.map, state.count, radius(), state.size);
  imageView.show(planeToImage(gray));
  scoreView.draw();
  document.getElementById('template-size')!.textContent = `${state.size} × ${state.size} px`;
  document.getElementById('score-caption')!.textContent =
    state.method === 'ncc' ? 'black −1, gray 0, white +1; click to inspect' : 'bright = good match; click to inspect';
  renderValues(cache.template);
}
const schedule = perFrame(update);

const FORMULAS: Record<Method, string> = {
  correlation: 'h[m, n] = \\sum_{k, l} f[k, l] \\, I[m + k, n + l]',
  'zero-mean': 'h[m, n] = \\sum_{k, l} \\big( f[k, l] - \\bar f \\big) \\, I[m + k, n + l]',
  ssd: 'h[m, n] = \\sum_{k, l} \\big( I[m + k, n + l] - f[k, l] \\big)^2',
  ncc: 'h[m, n] = \\frac{\\sum \\big[ f - \\bar f \\big] \\big[ I - \\bar I_{m, n} \\big]}{\\sqrt{\\sum \\big[ f - \\bar f \\big]^2} \\sqrt{\\sum \\big[ I - \\bar I_{m, n} \\big]^2}}',
};

/** The number the formula gives: for SSD the stored score is negated. */
const formulaValue = (score: number) => (state.method === 'ssd' ? -score : score);
const digits = () => (state.method === 'ncc' ? 3 : 2);

function renderValues(t: Template): void {
  const r = radius();
  const { px, py } = state;
  const inside = px >= r && py >= r && px < W - r && py < H - r;
  const picked = inside
    ? eq(`h[${px}, ${py}] = \\htmlClass{result}{${fmt(formulaValue(scoreAt(gray, t, px, py, state.method)), digits())}}`)
    : `<p class="muted small">At [${px}, ${py}] the template does not fit into the image, so there is no score.</p>`;
  const rows = peaks
    .map((p, i) => `<tr><td>${i + 1}</td><td>[${p.x}, ${p.y}]</td><td>${fmt(formulaValue(p.score), digits())}</td></tr>`)
    .join('');
  const better = state.method === 'ssd' ? 'lowest' : 'highest';

  values.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <h3>Score</h3>
        ${eq(FORMULAS[state.method])}
        ${eq(`\\bar f = ${fmt(t.mean, 3)}, \\qquad \\sqrt{\\textstyle\\sum (f - \\bar f)^2} = ${fmt(t.norm, 3)}, \\qquad N = ${state.size}^2 = ${state.size ** 2}`)}
        ${picked}
        <p class="muted small">Template centered on [${state.tx}, ${state.ty}]; the ${better} ${state.method === 'ssd' ? 'SSD' : 'score'} is best.</p>
      </div>
      <div class="value-block">
        <h3>Best matches</h3>
        <table class="match-table">
          <thead><tr><th>#</th><th>[m, n]</th><th>${state.method === 'ssd' ? 'SSD' : 'h'}</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

pane.on('change', schedule);
onThemeChange(schedule);
update();
