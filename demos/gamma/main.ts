import { Pane } from 'tweakpane';
import { cssRgb, linearToSrgb, srgbToLinear } from '../../src/shared/color';
import type { RGB, RGBImage } from '../../src/shared/image';
import { addImagePicker } from '../../src/shared/imagePicker';
import { initPage } from '../../src/shared/page';
import { PixelView, perFrame } from '../../src/shared/pixelView';
import { eq, fmt } from '../../src/shared/tex';
import { CurveView } from './curveView';
import { adjustChannels, adjustLuma, blur, decodeGamma } from './gamma';
import { GrayView } from './grayView';
import '../../src/shared/styles/demo.css';
import './gamma.css';

initPage({ title: 'Gamma', chapterId: 'images-color' });

const W = 240;
const H = 180;

function defaults() {
  return { v: 128, sigma: 3, gamma: 0.5 };
}
const state = defaults();

const pane = new Pane({ container: document.getElementById('controls')!, title: 'Gamma' });
pane.addBinding(state, 'v', { label: 'pixel value v', min: 0, max: 255, step: 1 });

const blurFolder = pane.addFolder({ title: 'Blur' });
let blurSource: RGBImage = addImagePicker(blurFolder, { names: ['lights', 'scene', 'text', 'chart'], value: 'lights', width: W, height: H }, (img) => {
  blurSource = img;
  blurDirty = true;
  schedule();
});
blurFolder.addBinding(state, 'sigma', { label: 'σ (px)', min: 0, max: 8, step: 0.1 });

const adjustFolder = pane.addFolder({ title: 'Gamma adjustment' });
let adjustSource: RGBImage = addImagePicker(adjustFolder, { names: ['scene', 'chart', 'gradients'], value: 'scene', width: W, height: H }, (img) => {
  adjustSource = img;
  adjustDirty = true;
  schedule();
});
adjustFolder.addBinding(state, 'gamma', { label: 'γ', min: 0.2, max: 3, step: 0.05 });

pane.addButton({ title: 'Reset' }).on('click', () => {
  Object.assign(state, defaults());
  pane.refresh();
});

const curveView = new CurveView(document.getElementById('curve-view')!);
const grayView = new GrayView(document.getElementById('gray-view')!);
const view = (id: string) => new PixelView(document.getElementById(id)!);
const blurViews = [view('blur-original'), view('blur-encoded'), view('blur-linear')];
const adjustViews = [view('adjust-original'), view('adjust-channels'), view('adjust-luma')];
const values = document.getElementById('values')!;

let blurDirty = true;
let adjustDirty = true;
let last = { sigma: NaN, gamma: NaN };

function update(): void {
  curveView.render(state.v);
  grayView.render([128, 186, state.v]);
  if (blurDirty || state.sigma !== last.sigma) {
    blurViews[0].show(blurSource);
    blurViews[1].show(blur(blurSource, state.sigma, 'encoded'));
    blurViews[2].show(blur(blurSource, state.sigma, 'linear'));
  }
  if (adjustDirty || state.gamma !== last.gamma) {
    adjustViews[0].show(adjustSource);
    adjustViews[1].show(adjustChannels(adjustSource, state.gamma));
    adjustViews[2].show(adjustLuma(adjustSource, state.gamma));
  }
  blurDirty = adjustDirty = false;
  last = { sigma: state.sigma, gamma: state.gamma };
  renderValues();
}
const schedule = perFrame(update);

const swatch = (rgb: RGB) => `<span class="swatch" style="background:${cssRgb(rgb)}"></span>`;

function mix(a: RGB, b: RGB): string {
  const encoded = a.map((v, i) => (v + b[i]) / 2) as RGB;
  const linear = a.map((v, i) => linearToSrgb((srgbToLinear(v) + srgbToLinear(b[i])) / 2)) as RGB;
  const show = (rgb: RGB) => `(${rgb.map((v) => Math.round(v * 255)).join(', ')})`;
  return `<tr><td>${swatch(a)} + ${swatch(b)}</td><td>${swatch(encoded)} ${show(encoded)}</td><td>${swatch(linear)} ${show(linear)}</td></tr>`;
}

function renderValues(): void {
  const x = state.v / 255;
  const lin = srgbToLinear(x);
  const srgb = x <= 0.04045 ? `\\frac{${fmt(x, 3)}}{12.92}` : `\\left(\\frac{${fmt(x, 3)} + 0.055}{1.055}\\right)^{2.4}`;
  const g = state.gamma;
  values.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <h3>Pixel value → light intensity</h3>
        ${eq(`v = ${state.v} \\;\\to\\; \\tfrac{v}{255} = ${fmt(x, 3)}`)}
        ${eq(`\\text{sRGB: } ${srgb} = \\htmlClass{result}{${fmt(lin, 3)}}`)}
        ${eq(`\\text{power law: } ${fmt(x, 3)}^{2.2} = ${fmt(decodeGamma(x, 2.2), 3)}`)}
        <p class="muted small">${fmt(100 * lin, 1)} % of the light of white (255).</p>
      </div>
      <div class="value-block">
        <h3>Averaging two pixels</h3>
        <table class="mix-table">
          <thead><tr><th></th><th>encoded values</th><th>linear light</th></tr></thead>
          <tbody>
            ${mix([0, 0, 0], [1, 1, 1])}
            ${mix([1, 0, 0], [0, 1, 0])}
            ${mix([0, 0, 1], [1, 1, 0])}
          </tbody>
        </table>
      </div>
      <div class="value-block">
        <h3>Gamma adjustment</h3>
        ${eq(`\\text{per channel: } (R, G, B) \\to (R^{${fmt(g, 2)}},\\ G^{${fmt(g, 2)}},\\ B^{${fmt(g, 2)}})`)}
        ${eq(`\\text{luma only: } (R, G, B) \\to \\frac{Y'^{\\,${fmt(g, 2)}}}{Y'} \\, (R, G, B)`)}
      </div>
    </div>`;
}

pane.on('change', schedule);
update();
