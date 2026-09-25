import { Pane } from 'tweakpane';
import type { RGBImage } from '../../src/shared/image';
import { getPixel } from '../../src/shared/image';
import { addImagePicker } from '../../src/shared/imagePicker';
import { initPage } from '../../src/shared/page';
import { PixelView, type ViewTransform, perFrame } from '../../src/shared/pixelView';
import { eq, fmt, texTuple } from '../../src/shared/tex';
import { cssColor } from '../../src/shared/theme';
import { ProfileView } from './profileView';
import { type SampleMode, downsample, levels, quantize, storageBits, toGray, upsampleNearest } from './sampling';
import '../../src/shared/styles/demo.css';
import './sampling.css';

initPage({ title: 'Sampling & quantization', chapterId: 'images-color' });

const W = 320;
const H = 240;
const STEPS = [1, 2, 3, 4, 5, 6, 8, 10, 16];

function defaults() {
  return { step: 4, mode: 'point' as SampleMode, bits: 4, gray: false, x: 200, y: 150 };
}
const state = defaults();

const pane = new Pane({ container: document.getElementById('controls')!, title: 'Sampling & quantization' });
const imageFolder = pane.addFolder({ title: 'Image' });
let source: RGBImage = addImagePicker(imageFolder, { names: ['scene', 'zone-plate', 'gradients', 'chart'], value: 'scene', width: W, height: H }, (img) => {
  source = img;
  schedule();
});
imageFolder.addBinding(state, 'gray', { label: 'grayscale' });

const sampling = pane.addFolder({ title: 'Sampling' });
sampling.addBinding(state, 'step', { label: 'cell size s', options: Object.fromEntries(STEPS.map((s) => [`${s} × ${s} px`, s])) });
sampling.addBinding(state, 'mode', { label: 'sample value', options: { 'cell center': 'point', 'cell average': 'area' } });

const quantization = pane.addFolder({ title: 'Quantization' });
quantization.addBinding(state, 'bits', { label: 'bits b', min: 1, max: 8, step: 1 });

pane.addButton({ title: 'Reset' }).on('click', () => {
  Object.assign(state, defaults());
  pane.refresh();
});

const pick = (x: number, y: number) => {
  state.x = x;
  state.y = y;
  schedule();
};
const originalView = new PixelView(document.getElementById('original-view')!, pick);
const resultView = new PixelView(document.getElementById('result-view')!, pick);
const profileView = new ProfileView(document.getElementById('profile-view')!);
const values = document.getElementById('values')!;

function marker(ctx: CanvasRenderingContext2D, t: ViewTransform, cell: number): void {
  const [x0, y0] = t.toView(Math.floor(state.x / cell) * cell, Math.floor(state.y / cell) * cell);
  const [, rowY] = t.toView(0, state.y + 0.5);
  ctx.strokeStyle = cssColor('--viz-highlight');
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, rowY);
  ctx.lineTo(ctx.canvas.width, rowY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineWidth = 2;
  const size = Math.max(cell * t.scale, 6);
  ctx.strokeRect(x0 - (size - cell * t.scale) / 2, y0 - (size - cell * t.scale) / 2, size, size);
}
originalView.overlay = (ctx, t) => marker(ctx, t, 1);
resultView.overlay = (ctx, t) => marker(ctx, t, state.step);

function update(): void {
  const base = state.gray ? toGray(source) : source;
  const small = downsample(base, state.step, state.mode);
  const quantized = quantize(small, state.bits);
  const shown = upsampleNearest(quantized, state.step, W, H);
  originalView.show(base);
  resultView.show(shown);
  profileView.render({ original: base, result: shown, row: state.y, gray: state.gray, levels: levels(state.bits) });
  renderValues(small, quantized);
}
const schedule = perFrame(update);

function renderValues(small: RGBImage, quantized: RGBImage): void {
  const { step: s, bits: b } = state;
  const L = levels(b);
  const i = Math.min(small.width - 1, Math.floor(state.x / s));
  const j = Math.min(small.height - 1, Math.floor(state.y / s));
  const channels = state.gray ? 1 : 3;
  const v = getPixel(small, i, j).slice(0, channels);
  const q = getPixel(quantized, i, j).slice(0, channels);
  const k = v.map((x) => Math.round(x * (L - 1)));
  const bitsUsed = storageBits(small.width, small.height, channels, b);
  const bitsFull = storageBits(W, H, channels, 8);
  const vec = (xs: number[], digits: number) => (xs.length === 1 ? fmt(xs[0], digits) : texTuple(xs, digits));

  values.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <h3>Sampling</h3>
        ${eq(`${W} \\times ${H} \\;\\to\\; \\left\\lfloor \\tfrac{${W}}{${s}} \\right\\rfloor \\times \\left\\lfloor \\tfrac{${H}}{${s}} \\right\\rfloor = ${small.width} \\times ${small.height} = ${small.width * small.height} \\text{ samples}`)}
        ${eq(`(x, y) = (${state.x}, ${state.y}) \\;\\to\\; (i, j) = \\left(\\left\\lfloor \\tfrac{x}{s} \\right\\rfloor, \\left\\lfloor \\tfrac{y}{s} \\right\\rfloor\\right) = (${i}, ${j})`)}
      </div>
      <div class="value-block">
        <h3>Quantization</h3>
        ${eq(`L = 2^{${b}} = ${L}, \\qquad \\Delta = \\tfrac{1}{L - 1} = ${fmt(1 / (L - 1), 4)}, \\qquad |q - v| \\le \\tfrac{\\Delta}{2} = ${fmt(0.5 / (L - 1), 4)}`)}
        ${eq(`v = ${vec(v, 3)} \\;\\to\\; q = \\frac{\\operatorname{round}(v \\cdot ${L - 1})}{${L - 1}} = \\frac{${vec(k, 0)}}{${L - 1}} = \\htmlClass{result}{${vec(q, 3)}}`)}
      </div>
      <div class="value-block">
        <h3>Storage</h3>
        ${eq(`${small.width} \\cdot ${small.height} \\cdot ${channels} \\cdot ${b} \\text{ bit} = ${fmt(bitsUsed / 8 / 1024, 1)} \\text{ KiB}`)}
        <p class="muted small">${fmt((100 * bitsUsed) / bitsFull, 1)} % of the ${W} × ${H} image with 8 bits per channel (${fmt(bitsFull / 8 / 1024, 1)} KiB).</p>
      </div>
    </div>`;
}

pane.on('change', schedule);
update();
