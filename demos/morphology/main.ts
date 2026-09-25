import { Pane } from 'tweakpane';
import { type RGB, type RGBImage, createImage } from '../../src/shared/image';
import { initPage } from '../../src/shared/page';
import { PixelView, type ViewTransform, perFrame } from '../../src/shared/pixelView';
import { eq } from '../../src/shared/tex';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import {
  type Binary,
  type Connectivity,
  type Operation,
  type Shape,
  applyOperation,
  createBinary,
  initialImage,
  labelComponents,
  structuringElement,
} from './morphology';
import '../../src/shared/styles/demo.css';
import './morphology.css';

initPage({ title: 'Morphology & connected components', chapterId: 'filtering' });

function defaults() {
  return { op: 'opening' as Operation, shape: 'square' as Shape, radius: 1, connectivity: 8 as Connectivity, mode: 'draw', brush: 0 };
}
const state = defaults();
let image = initialImage();
const W = image.width;
const H = image.height;

const OPERATIONS: Record<Operation, string> = {
  erosion: 'Erosion A ⊖ B',
  dilation: 'Dilation A ⊕ B',
  opening: 'Opening A ∘ B',
  closing: 'Closing A • B',
  boundary: 'Boundary A − (A ⊖ B)',
};

const pane = new Pane({ container: document.getElementById('controls')!, title: 'Morphology' });
const paint = pane.addFolder({ title: 'Paint' });
paint.addBinding(state, 'mode', { label: 'brush', options: { draw: 'draw', erase: 'erase' } });
paint.addBinding(state, 'brush', { label: 'brush size', options: { '1 px': 0, '3 px': 1, '5 px': 2 } });
paint.addButton({ title: 'Reset image' }).on('click', () => {
  image = initialImage();
  schedule();
});
paint.addButton({ title: 'Clear' }).on('click', () => {
  image = createBinary(W, H);
  schedule();
});
pane.addBinding(state, 'op', { label: 'operation', options: Object.fromEntries(Object.entries(OPERATIONS).map(([k, v]) => [v, k])) });
pane.addBinding(state, 'shape', { label: 'element B', options: { square: 'square', cross: 'cross', disk: 'disk' } });
pane.addBinding(state, 'radius', { label: 'radius', min: 0, max: 4, step: 1 });
pane.addBinding(state, 'connectivity', { label: 'connectivity', options: { '4-neighbors': 4, '8-neighbors': 8 } });
pane.addButton({ title: 'Reset' }).on('click', () => {
  Object.assign(state, defaults());
  image = initialImage();
  pane.refresh();
});

let last: [number, number] | null = null;
function paintAt(x: number, y: number, e: PointerEvent): void {
  const value = state.mode === 'erase' || e.shiftKey ? 0 : 1;
  // Fill in the pixels between two pointer events, so fast strokes stay connected.
  const [x0, y0] = e.type === 'pointerdown' || !last ? [x, y] : last;
  const steps = Math.max(Math.abs(x - x0), Math.abs(y - y0), 1);
  const r = state.brush;
  for (let s = 0; s <= steps; s++) {
    const cx = Math.round(x0 + ((x - x0) * s) / steps);
    const cy = Math.round(y0 + ((y - y0) * s) / steps);
    for (let v = -r; v <= r; v++)
      for (let u = -r; u <= r; u++) {
        const px = cx + u;
        const py = cy + v;
        if (px >= 0 && py >= 0 && px < W && py < H) image.data[py * W + px] = value;
      }
  }
  last = [x, y];
  schedule();
}

const inputView = new PixelView(document.getElementById('input-view')!, paintAt);
const resultView = new PixelView(document.getElementById('result-view')!);
const componentsView = new PixelView(document.getElementById('components-view')!);
const seView = new PixelView(document.getElementById('se-view')!);
const values = document.getElementById('values')!;

function grid(ctx: CanvasRenderingContext2D, t: ViewTransform, w: number, h: number): void {
  if (t.scale < 5) return;
  const [x0, y0] = t.toView(0, 0);
  ctx.strokeStyle = cssColor('--viz-grid');
  ctx.globalAlpha = 0.25;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 1; x < w; x++) {
    ctx.moveTo(x0 + x * t.scale, y0);
    ctx.lineTo(x0 + x * t.scale, y0 + h * t.scale);
  }
  for (let y = 1; y < h; y++) {
    ctx.moveTo(x0, y0 + y * t.scale);
    ctx.lineTo(x0 + w * t.scale, y0 + y * t.scale);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}
for (const view of [inputView, resultView, componentsView]) view.overlay = (ctx, t) => grid(ctx, t, W, H);
seView.overlay = (ctx, t) => {
  const size = 2 * state.radius + 1;
  grid(ctx, t, size, size);
  const [x, y] = t.toView(state.radius + 0.5, state.radius + 0.5);
  ctx.fillStyle = cssColor('--viz-highlight');
  ctx.beginPath();
  ctx.arc(x, y, Math.min(6, t.scale / 4), 0, 2 * Math.PI);
  ctx.fill();
};

/** 'rgb(r, g, b)' → [r, g, b] in [0, 1] */
const tokenRgb = (name: string) => (cssColor(name).match(/[\d.]+/g) ?? ['0', '0', '0']).slice(0, 3).map((v) => Number(v) / 255) as RGB;

function binaryImage(b: Binary): RGBImage {
  const img = createImage(b.width, b.height);
  b.data.forEach((v, i) => img.data.fill(v, i * 3, i * 3 + 3));
  return img;
}

/** White: foreground in both; colored: pixels the operation added or removed. */
function changesImage(a: Binary, result: Binary): RGBImage {
  const img = createImage(a.width, a.height);
  const added = tokenRgb('--accent');
  const removed = tokenRgb('--viz-highlight').map((v) => 0.55 * v) as RGB;
  for (let i = 0; i < a.data.length; i++) {
    const rgb: RGB = result.data[i] ? (a.data[i] ? [1, 1, 1] : added) : a.data[i] ? removed : [0, 0, 0];
    img.data.set(rgb, i * 3);
  }
  return img;
}

/** Well-separated hues via the golden angle; the labels are image content, not UI colors. */
function labelColor(label: number): RGB {
  const h = (label * 137.508) % 360;
  const s = 0.7;
  const l = 0.58;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

function update(): void {
  const b = structuringElement(state.shape, state.radius);
  const result = applyOperation(image, b, state.op);
  const components = labelComponents(result, state.connectivity);

  inputView.show(binaryImage(image));
  resultView.show(changesImage(image, result));
  const labeled = createImage(W, H);
  components.labels.forEach((l, i) => l && labeled.data.set(labelColor(l), i * 3));
  componentsView.show(labeled);
  seView.show(binaryImage(b));

  document.getElementById('result-title')!.textContent = OPERATIONS[state.op];
  document.getElementById('components-caption')!.textContent = `${components.count} with ${state.connectivity}-connectivity`;
  renderValues(b, result, components.sizes);
}
const schedule = perFrame(update);

const DEFINITIONS: [Operation, string][] = [
  ['dilation', 'A \\oplus B = \\{\\, z \\mid (\\hat B)_z \\cap A \\neq \\emptyset \\,\\}'],
  ['erosion', 'A \\ominus B = \\{\\, z \\mid B_z \\subseteq A \\,\\}'],
  ['opening', 'A \\circ B = (A \\ominus B) \\oplus B'],
  ['closing', 'A \\bullet B = (A \\oplus B) \\ominus B'],
  ['boundary', '\\beta(A) = A - (A \\ominus B)'],
];

function renderValues(b: Binary, result: Binary, sizes: number[]): void {
  const r = state.radius;
  const rows = Array.from({ length: b.height }, (_, v) =>
    Array.from({ length: b.width }, (_, u) => {
      const bit = String(b.data[v * b.width + u]);
      return u === r && v === r ? `\\htmlClass{result}{${bit}}` : bit;
    }).join(' & '),
  );
  const count = (x: Binary) => x.data.reduce((a, v) => a + v, 0);
  const sorted = [...sizes].sort((p, q) => q - p);
  const shown = sorted.slice(0, 16).join(', ') + (sorted.length > 16 ? ', …' : '');

  values.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <h3>Structuring element B (${2 * r + 1} × ${2 * r + 1}, ${count(b)} elements)</h3>
        ${eq(`B = \\begin{bmatrix} ${rows.join(' \\\\ ')} \\end{bmatrix}`)}
      </div>
      <div class="value-block">
        <h3>Definitions</h3>
        ${DEFINITIONS.map(([op, tex]) => eq(op === state.op ? `\\htmlClass{result}{${tex}}` : tex)).join('')}
      </div>
      <div class="value-block">
        <h3>Pixels and components</h3>
        ${eq(`|A| = ${count(image)}, \\qquad |\\text{result}| = \\htmlClass{result}{${count(result)}}`)}
        ${eq(`\\text{components (${state.connectivity}-connected): } \\htmlClass{result}{${sizes.length}}`)}
        <p class="muted small">${sizes.length ? `Sizes in pixels, largest first: ${shown}.` : 'The result is empty.'}</p>
      </div>
    </div>`;
}

pane.on('change', schedule);
onThemeChange(schedule);
update();
