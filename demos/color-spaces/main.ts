import { Pane } from 'tweakpane';
import { cssRgb, hexToRgb, rgbToHex } from '../../src/shared/color';
import { type RGB, type RGBImage, clamp01, createImage, getPixel } from '../../src/shared/image';
import { addImagePicker } from '../../src/shared/imagePicker';
import { initPage } from '../../src/shared/page';
import { PixelView, type ViewTransform, perFrame, toImageData } from '../../src/shared/pixelView';
import { fmt, renderTex, texTuple } from '../../src/shared/tex';
import { CHANNEL_NAMES, SPACE_NAMES, type Space, channelsForDisplay, inGamut, interpolate, rgbToLab, toSpace } from './colorSpaces';
import '../../src/shared/styles/demo.css';
import './color-spaces.css';

initPage({ title: 'Color space explorer', chapterId: 'images-color' });

const W = 320;
const H = 240;
const SPACES: Space[] = ['rgb', 'hsv', 'ycbcr', 'lab'];
const STRIP_WIDTH = 256;

function defaults() {
  return { space: 'hsv' as Space, a: '#e8283c', b: '#3f7fff', target: 'a' as 'a' | 'b' };
}
const state = defaults();
const picked: Record<'a' | 'b', { x: number; y: number; hex: string } | null> = { a: null, b: null };

const pane = new Pane({ container: document.getElementById('controls')!, title: 'Color spaces' });
let source: RGBImage = addImagePicker(pane, { names: ['chart', 'scene', 'text'], value: 'chart', width: W, height: H }, (img) => {
  source = img;
  picked.a = picked.b = null;
  schedule();
});
pane.addBinding(state, 'space', { label: 'channels of', options: Object.fromEntries(SPACES.map((s) => [SPACE_NAMES[s], s])) });
const colors = pane.addFolder({ title: 'Two colors' });
colors.addBinding(state, 'target', { label: 'click picks', options: { 'color A': 'a', 'color B': 'b' } });
for (const key of ['a', 'b'] as const) {
  colors.addBinding(state, key, { label: `color ${key.toUpperCase()}` }).on('change', () => {
    if (picked[key]?.hex !== state[key]) picked[key] = null;
  });
}
pane.addButton({ title: 'Reset' }).on('click', () => {
  Object.assign(state, defaults());
  picked.a = picked.b = null;
  pane.refresh();
});

const pick = (x: number, y: number) => {
  const hex = rgbToHex(getPixel(source, x, y));
  picked[state.target] = { x, y, hex };
  state[state.target] = hex;
  pane.refresh();
  schedule();
};

function markers(ctx: CanvasRenderingContext2D, t: ViewTransform): void {
  ctx.font = '600 12px system-ui, sans-serif';
  for (const key of ['a', 'b'] as const) {
    const p = picked[key];
    if (!p) continue;
    const [u, v] = t.toView(p.x + 0.5, p.y + 0.5);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000';
    ctx.beginPath();
    ctx.arc(u, v, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.strokeText(key.toUpperCase(), u + 8, v - 8);
    ctx.fillText(key.toUpperCase(), u + 8, v - 8);
  }
}

const imageView = new PixelView(document.getElementById('image-view')!, pick);
imageView.overlay = markers;
const channelViews = [0, 1, 2].map((c) => {
  const view = new PixelView(document.getElementById(`channel-${c}`)!, pick);
  view.overlay = markers;
  return view;
});

const strips = SPACES.map((space) => {
  const row = document.createElement('div');
  row.className = 'strip-row';
  const label = document.createElement('div');
  label.className = 'strip-label';
  const canvas = document.createElement('canvas');
  canvas.width = STRIP_WIDTH;
  canvas.height = 1;
  canvas.className = 'strip';
  row.append(label, canvas);
  document.getElementById('strips')!.append(row);
  return { space, label, ctx: canvas.getContext('2d')! };
});
const values = document.getElementById('values')!;

let channelCache: { source: RGBImage; space: Space } | null = null;

function update(): void {
  imageView.show(source);
  if (channelCache?.source !== source || channelCache.space !== state.space) {
    channelCache = { source, space: state.space };
    const planes = [0, 1, 2].map(() => createImage(W, H));
    for (let i = 0; i < W * H; i++) {
      const c = channelsForDisplay(state.space, toSpace(state.space, [source.data[i * 3], source.data[i * 3 + 1], source.data[i * 3 + 2]]));
      planes.forEach((p, k) => p.data.fill(c[k], i * 3, i * 3 + 3));
    }
    planes.forEach((p, k) => channelViews[k].show(p));
    CHANNEL_NAMES[state.space].forEach((name, k) => (document.getElementById(`channel-${k}-name`)!.textContent = name));
  } else {
    channelViews.forEach((v) => v.draw());
  }

  const a = hexToRgb(state.a);
  const b = hexToRgb(state.b);
  for (const strip of strips) {
    const img = createImage(STRIP_WIDTH, 1);
    let clipped = 0;
    for (let x = 0; x < STRIP_WIDTH; x++) {
      const rgb = interpolate(strip.space, a, b, x / (STRIP_WIDTH - 1));
      if (!inGamut(rgb)) clipped++;
      img.data.set(rgb.map(clamp01), x * 3);
    }
    strip.ctx.putImageData(toImageData(img), 0, 0);
    strip.label.innerHTML = `${SPACE_NAMES[strip.space]}${clipped ? `<span class="muted small">${Math.round((100 * clipped) / STRIP_WIDTH)} % clipped</span>` : ''}`;
  }
  renderValues(a, b);
}
const schedule = perFrame(update);

function describe(space: Space, rgb: RGB): string {
  const c = toSpace(space, rgb);
  switch (space) {
    case 'rgb':
      return texTuple(c.map((v) => v * 255), 0);
    case 'hsv':
      return `(${fmt(c[0], 0)}^\\circ,\\ ${fmt(c[1], 2)},\\ ${fmt(c[2], 2)})`;
    case 'ycbcr':
      return texTuple(c.map((v) => v * 255), 1);
    case 'lab':
      return texTuple(c, 1);
  }
}

function renderValues(a: RGB, b: RGB): void {
  const unit: Record<Space, string> = { rgb: '0–255', hsv: 'H in degrees', ycbcr: '0–255', lab: '' };
  const rows = SPACES.map(
    (s) => `<tr><th>${SPACE_NAMES[s]} <span class="muted small">${unit[s]}</span></th><td>${renderTex(describe(s, a))}</td><td>${renderTex(describe(s, b))}</td></tr>`,
  ).join('');
  const la = rgbToLab(a);
  const lb = rgbToLab(b);
  const dE = Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
  const dRgb = Math.hypot(...a.map((v, i) => 255 * (v - b[i])));
  values.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <table class="color-table">
          <thead><tr><th></th><th><span class="swatch" style="background:${cssRgb(a)}"></span> A</th><th><span class="swatch" style="background:${cssRgb(b)}"></span> B</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="value-block">
        <h3>Distance between A and B</h3>
        <div class="eq">${renderTex(`\\Delta E^*_{ab} = \\lVert \\mathrm{Lab}_A - \\mathrm{Lab}_B \\rVert = \\htmlClass{result}{${fmt(dE, 1)}}`)}</div>
        <div class="eq">${renderTex(`\\lVert \\mathrm{RGB}_A - \\mathrm{RGB}_B \\rVert = ${fmt(dRgb, 1)} \\ \\text{(0–255)}`)}</div>
        <p class="muted small">A ${renderTex('\\Delta E^*_{ab}')} of about 2.3 is just noticeable.</p>
      </div>
    </div>`;
}

pane.on('change', schedule);
update();
