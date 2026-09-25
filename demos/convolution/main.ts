import { Pane } from 'tweakpane';
import { type Border, padPlane, pixelAt } from '../../src/shared/filter';
import { type Plane, type RGBImage, planeToImage, toGray } from '../../src/shared/image';
import { addImagePicker } from '../../src/shared/imagePicker';
import { initPage } from '../../src/shared/page';
import { PixelView, type ViewTransform, perFrame } from '../../src/shared/pixelView';
import { eq, fmt, texMatrix } from '../../src/shared/tex';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import {
  type Display,
  type Operation,
  PRESETS,
  type PresetName,
  displayValue,
  effectiveKernel,
  filterRepeated,
  isCustom,
  kernelFromCells,
  parseWeight,
  resizeCells,
} from './kernels';
import '../../src/shared/styles/demo.css';
import './convolution.css';

initPage({ title: 'Convolution & correlation', chapterId: 'filtering' });

const W = 160;
const H = 120;
const PAD = 12;

function defaults() {
  return {
    preset: 'box5' as PresetName,
    op: 'correlation' as Operation,
    border: 'zero' as Border,
    times: 1,
    display: 'clip' as Display,
    zoom: 1,
    x: 20,
    y: 60,
  };
}
const state = defaults();
let cells = PRESETS[state.preset].rows.map((r) => [...r]);

const pane = new Pane({ container: document.getElementById('controls')!, title: 'Linear filter' });
let gray: Plane = toGray(
  addImagePicker(pane, { names: ['scene', 'chart', 'text', 'zone-plate', 'gradients'], value: 'scene', width: W, height: H }, (img: RGBImage) => {
    gray = toGray(img);
    schedule();
  }),
);
const presetBinding = pane.addBinding(state, 'preset', {
  label: 'filter',
  options: Object.fromEntries(Object.entries(PRESETS).map(([name, p]) => [p.label, name])),
});
pane.addBinding(state, 'op', { label: 'operation', options: { correlation: 'correlation', convolution: 'convolution' } });
pane.addBinding(state, 'border', { label: 'border', options: { 'clip filter (black)': 'zero', 'wrap around': 'wrap', 'copy edge': 'clamp', reflect: 'reflect' } });
pane.addBinding(state, 'times', { label: 'apply n times', min: 1, max: 20, step: 1 });
const display = pane.addFolder({ title: 'Display' });
display.addBinding(state, 'display', { label: 'result', options: { clipped: 'clip', 'signed, 0 = gray': 'signed', absolute: 'abs' } });
display.addBinding(state, 'zoom', { label: 'zoom', options: { '1×': 1, '2×': 2, '4×': 4, '8×': 8 } });
pane.addButton({ title: 'Reset' }).on('click', () => {
  Object.assign(state, defaults());
  Object.assign(center, { x: state.x, y: state.y });
  cells = PRESETS[state.preset].rows.map((r) => [...r]);
  renderKernelGrid();
  pane.refresh();
});

presetBinding.on('change', ({ value }) => {
  if (isCustom(value)) {
    cells = resizeCells(cells, PRESETS[value].rows.length);
  } else {
    cells = PRESETS[value].rows.map((r) => [...r]);
    state.display = 'signed' in PRESETS[value] ? 'signed' : 'clip';
    pane.refresh();
  }
  renderKernelGrid();
});

const grid = document.getElementById('kernel-grid')!;
const kernelSum = document.getElementById('kernel-sum')!;

function renderKernelGrid(): void {
  grid.style.setProperty('--size', String(cells.length));
  grid.replaceChildren(
    ...cells.flatMap((row, v) =>
      row.map((text, u) => {
        const input = document.createElement('input');
        input.type = 'text';
        input.inputMode = 'decimal';
        input.value = text;
        input.setAttribute('aria-label', `f[${u - (row.length - 1) / 2}, ${v - (cells.length - 1) / 2}]`);
        input.classList.toggle('invalid', parseWeight(text) === null);
        input.addEventListener('input', () => {
          cells[v][u] = input.value;
          input.classList.toggle('invalid', parseWeight(input.value) === null);
          if (!isCustom(state.preset)) {
            state.preset = cells.length === 3 ? 'custom3' : 'custom5';
            presetBinding.refresh();
          }
          schedule();
        });
        return input;
      }),
    ),
  );
}
renderKernelGrid();

const center = { x: state.x, y: state.y };
const pick = (x: number, y: number, e: PointerEvent) => {
  state.x = x;
  state.y = y;
  if (e.type === 'pointerdown') Object.assign(center, { x, y });
  schedule();
};
const inputView = new PixelView(document.getElementById('input-view')!, (x, y, e) =>
  pick(Math.min(W - 1, Math.max(0, x - PAD)), Math.min(H - 1, Math.max(0, y - PAD)), e),
);
const resultView = new PixelView(document.getElementById('result-view')!, pick);
const values = document.getElementById('values')!;

function drawWindow(ctx: CanvasRenderingContext2D, t: ViewTransform, x: number, y: number): void {
  const r = (cells.length - 1) / 2;
  const [vx, vy] = t.toView(x - r, y - r);
  ctx.strokeStyle = cssColor('--viz-highlight');
  ctx.lineWidth = 1.5;
  ctx.strokeRect(vx, vy, cells.length * t.scale, cells.length * t.scale);
  const [px, py] = t.toView(x, y);
  const size = Math.max(t.scale, 6);
  ctx.lineWidth = 2;
  ctx.strokeRect(px + (t.scale - size) / 2, py + (t.scale - size) / 2, size, size);
}
inputView.overlay = (ctx, t) => {
  const [x0, y0] = t.toView(PAD, PAD);
  ctx.strokeStyle = cssColor('--viz-points');
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(x0, y0, W * t.scale, H * t.scale);
  ctx.setLineDash([]);
  drawWindow(ctx, t, state.x + PAD, state.y + PAD);
};
resultView.overlay = (ctx, t) => drawWindow(ctx, t, state.x, state.y);

let cache: { key: string; gray: Plane; input: Plane; result: Plane } | null = null;

function update(): void {
  const key = JSON.stringify([cells, state.op, state.border, state.times]);
  if (cache?.key !== key || cache.gray !== gray) {
    cache = { key, gray, ...filterRepeated(gray, kernelFromCells(cells), state.op, state.border, state.times) };
  }
  const { input, result } = cache;
  inputView.show(planeToImage(padPlane(gray, PAD, state.border)));
  resultView.show(planeToImage({ ...result, data: result.data.map((v) => displayValue(v, state.display)) }));
  inputView.setZoom(state.zoom, center.x + PAD + 0.5, center.y + PAD + 0.5);
  resultView.setZoom(state.zoom, center.x + 0.5, center.y + 0.5);

  const k = kernelFromCells(cells);
  const sum = k.data.reduce((a, b) => a + b, 0);
  kernelSum.textContent = `Sum of weights: ${fmt(sum, 3)}`;
  document.getElementById('result-caption')!.textContent =
    `${state.op === 'correlation' ? 'correlation with f' : 'convolution I ∗ f'}${state.times > 1 ? `, applied ${state.times} times` : ''}`;
  renderValues(input, result, k);
}
const schedule = perFrame(update);

function renderValues(input: Plane, result: Plane, f: Plane): void {
  const { x: m, y: n } = state;
  const r = (f.width - 1) / 2;
  const used = effectiveKernel(f, state.op);
  const hood: string[] = [];
  const terms: string[] = [];
  let anyOutside = false;
  for (let l = -r; l <= r; l++) {
    const row: string[] = [];
    for (let k = -r; k <= r; k++) {
      const value = pixelAt(input, m + k, n + l, state.border);
      const outside = m + k < 0 || n + l < 0 || m + k >= W || n + l >= H;
      anyOutside ||= outside;
      row.push(outside ? `\\htmlClass{pad}{${fmt(value, 2)}}` : fmt(value, 2));
      const weight = used.data[(l + r) * f.width + k + r];
      if (weight !== 0) terms.push(`${weight < 0 ? `(${fmt(weight, 3)})` : fmt(weight, 3)} \\cdot ${fmt(value, 2)}`);
    }
    hood.push(row.join(' & '));
  }
  const h = result.data[n * W + m];
  const rows = (p: Plane) => Array.from({ length: p.height }, (_, j) => Array.from(p.data.slice(j * p.width, (j + 1) * p.width)));
  const conv = state.op === 'convolution';
  const pass = state.times > 1 ? ` (input of pass ${state.times})` : '';
  const mapped = state.display === 'signed' ? 0.5 + h / 2 : state.display === 'abs' ? Math.abs(h) : h;
  const clipped = mapped < 0 || mapped > 1;
  const sumTex = terms.length > 0 && terms.length <= 9 ? `${terms.join(' + ')} = ` : '';

  values.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <h3>Neighborhood of I around [${m}, ${n}]${pass}</h3>
        ${eq(`\\begin{bmatrix*}[r] ${hood.join(' \\\\ ')} \\end{bmatrix*}`)}
        ${anyOutside ? '<p class="muted small">Colored values lie outside the image and come from the border rule.</p>' : ''}
      </div>
      <div class="value-block">
        <h3>${conv ? 'Flipped filter f[−k, −l]' : 'Filter f[k, l]'}</h3>
        ${eq(texMatrix(rows(used), 3))}
      </div>
      <div class="value-block">
        <h3>Output pixel</h3>
        ${eq(
          conv
            ? `h[${m}, ${n}] = \\sum_{k,l} f[k, l] \\, I[${m} - k, ${n} - l] = \\sum_{k,l} f[-k, -l] \\, I[${m} + k, ${n} + l]`
            : `h[${m}, ${n}] = \\sum_{k,l} f[k, l] \\, I[${m} + k, ${n} + l]`,
        )}
        ${eq(`= ${sumTex}\\htmlClass{result}{${fmt(h, 3)}}`)}
        <p class="muted small">Shown as gray value ${fmt(displayValue(h, state.display), 3)}${state.display === 'signed' ? ', from 0.5 + h / 2' : state.display === 'abs' ? ', from |h|' : ''}${clipped ? ' (clipped to [0, 1])' : ''}.</p>
      </div>
    </div>`;
}

pane.on('change', schedule);
onThemeChange(schedule);
update();
