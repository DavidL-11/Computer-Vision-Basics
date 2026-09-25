import { Pane } from 'tweakpane';
import { type RGBImage, planeToImage, psnr } from '../../src/shared/image';
import { addImagePicker } from '../../src/shared/imagePicker';
import { initPage } from '../../src/shared/page';
import { PixelView, perFrame } from '../../src/shared/pixelView';
import { eq, fmt } from '../../src/shared/tex';
import { type Target, type Upsampling, applySubsampling, samplesPerPixel } from './chroma';
import '../../src/shared/styles/demo.css';

initPage({ title: 'Chroma subsampling', chapterId: 'images-color' });

const W = 320;
const H = 240;
const SCHEMES: Record<string, [number, number]> = {
  '4:4:4': [1, 1],
  '4:2:2': [2, 1],
  '4:2:0': [2, 2],
  '4:1:1': [4, 1],
  '4 × 4 blocks': [4, 4],
  '8 × 8 blocks': [8, 8],
};

function defaults() {
  return { scheme: '4:2:0', target: 'chroma' as Target, upsampling: 'bilinear' as Upsampling, zoom: 1 };
}
const state = defaults();
const center = { x: W / 2, y: H / 2 };

const pane = new Pane({ container: document.getElementById('controls')!, title: 'Chroma subsampling' });
let source: RGBImage = addImagePicker(pane, { names: ['scene', 'text', 'chart', 'zone-plate'], value: 'scene', width: W, height: H }, (img) => {
  source = img;
  schedule();
});
pane.addBinding(state, 'scheme', { label: 'scheme', options: Object.fromEntries(Object.keys(SCHEMES).map((k) => [k, k])) });
pane.addBinding(state, 'target', { label: 'reduce', options: { 'chroma Cb, Cr': 'chroma', 'luma Y': 'luma' } });
pane.addBinding(state, 'upsampling', { label: 'upsampling', options: { 'nearest neighbor': 'nearest', bilinear: 'bilinear' } });
pane.addBinding(state, 'zoom', { label: 'zoom', options: { '1×': 1, '2×': 2, '4×': 4, '8×': 8 } });
pane.addButton({ title: 'Reset' }).on('click', () => {
  Object.assign(state, defaults());
  Object.assign(center, { x: W / 2, y: H / 2 });
  pane.refresh();
});

const recenter = (x: number, y: number, e: PointerEvent) => {
  if (e.type !== 'pointerdown') return;
  Object.assign(center, { x, y });
  schedule();
};
const views = ['original-view', 'result-view', 'plane-0', 'plane-1', 'plane-2'].map((id) => new PixelView(document.getElementById(id)!, recenter));
const values = document.getElementById('values')!;

let cache: { source: RGBImage; scheme: string; upsampling: Upsampling; psnr: Record<Target, number> } | null = null;

function update(): void {
  const [fx, fy] = SCHEMES[state.scheme];
  const result = applySubsampling(source, fx, fy, state.target, state.upsampling);
  views[0].show(source);
  views[1].show(result.image);
  result.planes.forEach((p, k) => views[k + 2].show(planeToImage(p)));
  for (const view of views) view.setZoom(state.zoom, center.x, center.y);

  if (cache?.source !== source || cache.scheme !== state.scheme || cache.upsampling !== state.upsampling) {
    const other: Target = state.target === 'chroma' ? 'luma' : 'chroma';
    cache = {
      source,
      scheme: state.scheme,
      upsampling: state.upsampling,
      psnr: {
        [state.target]: psnr(source, result.image),
        [other]: psnr(source, applySubsampling(source, fx, fy, other, state.upsampling).image),
      } as Record<Target, number>,
    };
  }
  renderValues(fx, fy);
}
const schedule = perFrame(update);

const db = (v: number) => (Number.isFinite(v) ? `${fmt(v, 1)} \\text{ dB}` : '\\infty');

function renderValues(fx: number, fy: number): void {
  const sw = Math.ceil(W / fx);
  const sh = Math.ceil(H / fy);
  const reduced = state.target === 'chroma' ? ['C_b', 'C_r'] : ['Y'];
  const full = state.target === 'chroma' ? ['Y'] : ['C_b', 'C_r'];
  const spp = (t: Target) => samplesPerPixel(fx, fy, t);
  const pct = (t: Target) => fmt((100 * spp(t)) / 3, 0);
  const hl = (t: Target, tex: string) => (t === state.target ? `\\htmlClass{result}{${tex}}` : tex);
  values.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <h3>Stored samples</h3>
        ${eq(`${full.join(', ')}: ${W} \\times ${H}, \\qquad ${reduced.join(', ')}: \\left\\lceil \\tfrac{${W}}{${fx}} \\right\\rceil \\times \\left\\lceil \\tfrac{${H}}{${fy}} \\right\\rceil = ${sw} \\times ${sh}`)}
        ${eq(`\\text{per pixel: } ${state.target === 'chroma' ? `1 + \\tfrac{2}{${fx * fy}}` : `\\tfrac{1}{${fx * fy}} + 2`} = ${fmt(spp(state.target), 3)} \\text{ of } 3 \\;\\; (${pct(state.target)}\\,\\%)`)}
      </div>
      <div class="value-block">
        <h3>Same scheme on chroma vs luma</h3>
        ${eq(`\\text{chroma: } ${hl('chroma', `${db(cache!.psnr.chroma)},\\ ${pct('chroma')}\\,\\% \\text{ of the data}`)}`)}
        ${eq(`\\text{luma: } ${hl('luma', `${db(cache!.psnr.luma)},\\ ${pct('luma')}\\,\\% \\text{ of the data}`)}`)}
      </div>
    </div>`;
}

pane.on('change', schedule);
update();
