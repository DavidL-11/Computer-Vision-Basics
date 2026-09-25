import { Pane } from 'tweakpane';
import { type Plane, planeToImage, psnr, toGray } from '../../src/shared/image';
import { addImagePicker } from '../../src/shared/imagePicker';
import { initPage } from '../../src/shared/page';
import { PixelView, type ViewTransform, perFrame } from '../../src/shared/pixelView';
import { eq, fmt, renderTex } from '../../src/shared/tex';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import {
  B,
  type Compressed,
  FLAT_TABLE,
  LUMINANCE_TABLE,
  basisBlock,
  coefficientMosaic,
  compress,
  entropy,
  scaleTable,
  zigzagRun,
} from './jpeg';
import '../../src/shared/styles/demo.css';
import './jpeg-dct.css';

initPage({ title: 'JPEG & the DCT', chapterId: 'frequency' });

const W = 320;
const H = 240;

type Table = 'luminance' | 'flat';

function defaults() {
  return { quality: 50, table: 'luminance' as Table, zoom: 1, bx: 24, by: 21 };
}
const state = defaults();

const pane = new Pane({ container: document.getElementById('controls')!, title: 'JPEG' });
let original: Plane = toGray(
  addImagePicker(pane, { names: ['scene', 'chart', 'text', 'gradients', 'zone-plate'], value: 'scene', width: W, height: H }, (img) => {
    original = toGray(img);
    schedule();
  }),
);
pane.addBinding(state, 'quality', { label: 'quality', min: 1, max: 100, step: 1 });
pane.addBinding(state, 'table', { label: 'table', options: { 'JPEG luminance': 'luminance', 'flat (same step)': 'flat' } });
pane.addBinding(state, 'zoom', { label: 'zoom', options: { '1×': 1, '2×': 2, '4×': 4, '8×': 8 } });
pane.addButton({ title: 'Reset' }).on('click', () => {
  Object.assign(state, defaults());
  Object.assign(center, blockCenter());
  pane.refresh();
});

const blockCenter = () => ({ x: (state.bx + 0.5) * B, y: (state.by + 0.5) * B });
const center = blockCenter();
const pick = (x: number, y: number, e: PointerEvent) => {
  state.bx = Math.floor(x / B);
  state.by = Math.floor(y / B);
  if (e.type === 'pointerdown') Object.assign(center, blockCenter());
  schedule();
};
const views = ['original-view', 'decoded-view', 'error-view', 'coef-view'].map((id) => new PixelView(document.getElementById(id)!, pick));
const values = document.getElementById('values')!;

function blockMarker(ctx: CanvasRenderingContext2D, t: ViewTransform): void {
  const [x, y] = t.toView(state.bx * B, state.by * B);
  ctx.strokeStyle = cssColor('--viz-highlight');
  ctx.lineWidth = 2;
  ctx.strokeRect(x - 1, y - 1, B * t.scale + 2, B * t.scale + 2);
}
for (const view of views) view.overlay = blockMarker;

// The 64 basis images, each scaled to the full gray range, in an 8 × 8 grid ordered like the coefficients.
const basisView = new PixelView(document.getElementById('basis-view')!);
const basis: Plane = { width: B * B, height: B * B, data: new Float32Array(B ** 4) };
for (let v = 0; v < B; v++)
  for (let u = 0; u < B; u++) {
    const b = basisBlock(u, v);
    const max = b.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
    b.forEach((x, i) => (basis.data[(v * B + Math.floor(i / B)) * B * B + u * B + (i % B)] = 0.5 + x / (2 * max)));
  }
basisView.overlay = (ctx, t) => {
  ctx.strokeStyle = cssColor('--bg-elev');
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let k = 1; k < B; k++) {
    const [x] = t.toView(k * B, 0);
    ctx.moveTo(x, 0);
    ctx.lineTo(x, B * B * t.scale);
    ctx.moveTo(0, x);
    ctx.lineTo(B * B * t.scale, x);
  }
  ctx.stroke();
};
basisView.show(planeToImage(basis));

let cache: { key: string; original: Plane; table: number[]; result: Compressed } | null = null;

function update(): void {
  const key = JSON.stringify([state.quality, state.table]);
  if (cache?.key !== key || cache.original !== original) {
    const table = scaleTable(state.table === 'luminance' ? LUMINANCE_TABLE : FLAT_TABLE, state.quality);
    const result = compress(original, table);
    cache = { key, original, table, result };
    views[0].show(planeToImage(original));
    views[1].show(planeToImage(result.image));
    views[2].show(planeToImage({ ...original, data: result.image.data.map((v, i) => 0.5 + 4 * (v - original.data[i])) }));
    views[3].show(planeToImage(coefficientMosaic(result)));
  }
  for (const view of views) view.setZoom(state.zoom, center.x, center.y);
  renderValues(cache.result, cache.table);
}
const schedule = perFrame(update);

function grayCell(v: number): string {
  const c = Math.round(v);
  return `<span style="background: rgb(${c} ${c} ${c}); color: ${c > 140 ? '#000' : '#fff'}">${c}</span>`;
}

/** Positive values tinted with the accent, negative ones with the highlight color, stronger for larger |v|. */
function signedCell(v: number, max: number): string {
  const r = Math.round(v) + 0;
  if (r === 0) return '<span class="zero">0</span>';
  const pct = Math.round((55 * Math.log1p(Math.abs(v))) / Math.log1p(max));
  const color = v > 0 ? 'var(--accent)' : 'var(--viz-highlight)';
  return `<span style="background: color-mix(in srgb, ${color} ${pct}%, transparent)">${r}</span>`;
}

function grid(title: string, cells: string[]): string {
  return `<div class="block-table"><h4>${title}</h4><div class="grid8">${cells.join('')}</div></div>`;
}

function renderValues(c: Compressed, table: number[]): void {
  const { bx, by } = state;
  const block = c.blocks[by * c.blocksX + bx];
  const coefMax = block.coef.reduce((m, v) => Math.max(m, Math.abs(v)), 1);
  const quantMax = block.quantized.reduce((m, v) => Math.max(m, Math.abs(v)), 1);
  const run = zigzagRun(block.quantized);
  const nonzero = block.quantized.filter((q) => q !== 0).length;

  const total = c.blocks.length * 64;
  const zeros = c.blocks.reduce((n, b) => n + b.quantized.filter((q) => q === 0).length, 0);
  const bits = entropy(c.blocks);

  values.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <h3>Whole image, quality ${state.quality}</h3>
        ${eq(`\\text{zero coefficients: } \\htmlClass{result}{${fmt((100 * zeros) / total, 1)}\\,\\%}, \\quad ${fmt((total - zeros) / c.blocks.length, 1)} \\text{ of 64 per block are kept}`)}
        ${eq(`\\text{entropy} \\approx \\htmlClass{result}{${fmt(bits, 2)}} \\text{ bits/pixel} \\quad (\\approx ${fmt(8 / Math.max(bits, 1e-9), 1)} : 1 \\text{ vs. 8 bits})`)}
        ${eq(`\\mathrm{PSNR} = ${fmt(psnr(original, c.image), 1)} \\text{ dB}`)}
      </div>
      <div class="value-block">
        <h3>Block (${bx}, ${by}), pixels ${bx * B}…${bx * B + 7} × ${by * B}…${by * B + 7}</h3>
        ${eq(`F(u, v) = \\tfrac14 C(u) C(v) \\sum_{x, y} \\big(f(x, y) - 128\\big) \\cos\\tfrac{(2x + 1) u \\pi}{16} \\cos\\tfrac{(2y + 1) v \\pi}{16}`)}
        ${eq(`F_Q(u, v) = \\operatorname{round}\\!\\big(F(u, v) / Q(u, v)\\big), \\quad ${nonzero} \\text{ of 64 non-zero}`)}
        <p class="zigzag"><span class="muted">zigzag:</span> ${run.join(' ')}${run.length < 64 ? ' <strong>EOB</strong>' : ''}</p>
      </div>
      <div class="value-block blocks">
        ${grid(`Pixels ${renderTex('f(x, y)')}`, Array.from(block.pixels, (p) => grayCell(p + 128)))}
        ${grid(`DCT ${renderTex('F(u, v)')} of ${renderTex('f - 128')}`, Array.from(block.coef, (v) => signedCell(v, coefMax)))}
        ${grid(`Quantization table ${renderTex('Q(u, v)')}`, table.map((q) => `<span>${q}</span>`))}
        ${grid(`Stored ${renderTex('F_Q(u, v)')}`, Array.from(block.quantized, (v) => signedCell(v, quantMax)))}
        ${grid(`Decoded ${renderTex('\\hat f(x, y)')}`, Array.from(block.decoded, grayCell))}
      </div>
    </div>`;
}

pane.on('change', schedule);
onThemeChange(() => {
  basisView.draw();
  schedule();
});
update();
