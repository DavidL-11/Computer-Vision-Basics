import { Pane } from 'tweakpane';
import { type RGBImage, getPixel, psnr } from '../../src/shared/image';
import { addImagePicker } from '../../src/shared/imagePicker';
import { initPage } from '../../src/shared/page';
import { PixelView, type ViewTransform, perFrame } from '../../src/shared/pixelView';
import { eq, fmt } from '../../src/shared/tex';
import { cssColor } from '../../src/shared/theme';
import { type Channel, type Method, type Sample, demosaic, errorImage, filterColor, interpolate, mosaic, mosaicToImage } from './bayer';
import '../../src/shared/styles/demo.css';
import './bayer.css';

initPage({ title: 'Bayer pattern & demosaicing', chapterId: 'images-color' });

const W = 192;
const H = 144;
const ERROR_GAIN = 4;

function defaults() {
  return {
    method: 'bilinear' as Method,
    tinted: true,
    right: 'result' as 'result' | 'original' | 'error',
    zoom: 2,
    x: 96,
    y: 72,
  };
}
const state = defaults();

const pane = new Pane({ container: document.getElementById('controls')!, title: 'Bayer pattern' });
let source: RGBImage = addImagePicker(pane, { names: ['chart', 'zone-plate', 'text', 'scene'], value: 'chart', width: W, height: H }, (img) => {
  source = img;
  schedule();
});
pane.addBinding(state, 'method', { label: 'demosaicing', options: { 'nearest neighbor': 'nearest', bilinear: 'bilinear' } });
const display = pane.addFolder({ title: 'Display' });
display.addBinding(state, 'tinted', { label: 'raw in color' });
display.addBinding(state, 'right', { label: 'right view', options: { demosaiced: 'result', original: 'original', [`error × ${ERROR_GAIN}`]: 'error' } });
display.addBinding(state, 'zoom', { label: 'zoom', options: { '1×': 1, '2×': 2, '4×': 4, '8×': 8 } });
pane.addButton({ title: 'Reset' }).on('click', () => {
  Object.assign(state, defaults());
  Object.assign(center, { x: state.x, y: state.y });
  pane.refresh();
});

const center = { x: state.x, y: state.y };
const pick = (x: number, y: number, e: PointerEvent) => {
  state.x = x;
  state.y = y;
  // Recentering while dragging would move the image under the pointer.
  if (e.type === 'pointerdown') Object.assign(center, { x, y });
  schedule();
};
const rawView = new PixelView(document.getElementById('raw-view')!, pick);
const resultView = new PixelView(document.getElementById('result-view')!, pick);
const values = document.getElementById('values')!;

function marker(ctx: CanvasRenderingContext2D, t: ViewTransform): void {
  ctx.strokeStyle = cssColor('--viz-highlight');
  const [x, y] = t.toView(state.x, state.y);
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.strokeRect(x - t.scale, y - t.scale, 3 * t.scale, 3 * t.scale);
  ctx.setLineDash([]);
  ctx.lineWidth = 2;
  const size = Math.max(t.scale, 6);
  ctx.strokeRect(x + (t.scale - size) / 2, y + (t.scale - size) / 2, size, size);
}
rawView.overlay = marker;
resultView.overlay = marker;

const CHANNELS = ['R', 'G', 'B'];
const CLASS = ['ch-r', 'ch-g', 'ch-b'];
const colored = (c: Channel, tex: string) => `\\htmlClass{${CLASS[c]}}{${tex}}`;

function neighborhood(raw: ReturnType<typeof mosaic>): string {
  const rows: string[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    const cells: string[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      const x = state.x + dx;
      const y = state.y + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) cells.push('\\cdot');
      else cells.push(colored(filterColor(x, y), fmt(raw.data[y * W + x], 2)));
    }
    rows.push(cells.join(' & '));
  }
  return `\\begin{bmatrix} ${rows.join(' \\\\ ')} \\end{bmatrix}`;
}

function formula(c: Channel, samples: Sample[], value: number, truth: number): string {
  const name = colored(c, CHANNELS[c]);
  const tail = `= \\htmlClass{result}{${fmt(value, 3)}} \\quad \\text{(true: ${fmt(truth, 3)})}`;
  if (samples.length === 1 && samples[0].x === state.x && samples[0].y === state.y) {
    return `${name} = ${fmt(value, 3)} \\quad \\text{measured}`;
  }
  if (samples.length === 1) return `${name} = ${name}_{(${samples[0].x},\\,${samples[0].y})} ${tail}`;
  const sum = samples.map((s) => (s.weight === 1 ? '' : `${s.weight} \\cdot `) + fmt(s.value, 2)).join(' + ');
  const total = samples.reduce((a, s) => a + s.weight, 0);
  return `${name} = \\frac{${sum}}{${total}} ${tail}`;
}

let cache: { source: RGBImage; nearest: number; bilinear: number } | null = null;

function update(): void {
  const raw = mosaic(source);
  const result = demosaic(raw, state.method);
  if (cache?.source !== source) {
    cache = { source, nearest: psnr(source, demosaic(raw, 'nearest')), bilinear: psnr(source, demosaic(raw, 'bilinear')) };
  }
  rawView.show(mosaicToImage(raw, state.tinted));
  resultView.show(state.right === 'original' ? source : state.right === 'error' ? errorImage(result, source, ERROR_GAIN) : result);
  for (const view of [rawView, resultView]) view.setZoom(state.zoom, center.x + 0.5, center.y + 0.5);
  document.getElementById('right-title')!.textContent =
    state.right === 'original' ? 'Original' : state.right === 'error' ? `Error |demosaiced − original| × ${ERROR_GAIN}` : 'Demosaiced';

  const truth = getPixel(source, state.x, state.y);
  const lines = ([0, 1, 2] as const).map((c) => {
    const samples: Sample[] = [];
    const value = interpolate(raw, state.x, state.y, c, state.method, samples);
    return eq(formula(c, samples, value, truth[c]));
  });
  const n = W * H;
  const best = (m: Method) => (m === state.method ? 'result' : 'normal');
  values.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <h3>Raw values around ${`(${state.x}, ${state.y})`}</h3>
        ${eq(neighborhood(raw))}
        <p class="muted small">The pixel under a ${CHANNELS[filterColor(state.x, state.y)]} filter.</p>
      </div>
      <div class="value-block">
        <h3>${state.method === 'nearest' ? 'Nearest neighbor' : 'Bilinear'} interpolation</h3>
        ${lines.join('')}
      </div>
      <div class="value-block">
        <h3>Samples and error</h3>
        ${eq(`${colored(0, 'R')}: ${n / 4}, \\quad ${colored(1, 'G')}: ${n / 2}, \\quad ${colored(2, 'B')}: ${n / 4} \\quad \\text{of } ${n} \\text{ pixels}`)}
        ${eq(`\\mathrm{PSNR}_\\text{nearest} = \\htmlClass{${best('nearest')}}{${fmt(cache.nearest, 1)} \\text{ dB}}, \\quad \\mathrm{PSNR}_\\text{bilinear} = \\htmlClass{${best('bilinear')}}{${fmt(cache.bilinear, 1)} \\text{ dB}}`)}
      </div>
    </div>`;
}
const schedule = perFrame(update);

pane.on('change', schedule);
update();
