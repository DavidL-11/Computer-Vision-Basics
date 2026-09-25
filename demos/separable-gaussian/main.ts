import { Pane } from 'tweakpane';
import { correlate, correlateSeparable, gaussianKernel, outerProduct } from '../../src/shared/filter';
import { type Plane, planeToImage, toGray } from '../../src/shared/image';
import { addImagePicker } from '../../src/shared/imagePicker';
import { initPage } from '../../src/shared/page';
import { PixelView, perFrame } from '../../src/shared/pixelView';
import { eq, fmt } from '../../src/shared/tex';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import { KernelPlot } from './kernelPlot';
import { kernelVariance, maxAbsDifference, multiplications, repeatedBox, repeatedBoxVariance, sampledGaussian } from './separable';
import '../../src/shared/styles/demo.css';
import './separable-gaussian.css';

initPage({ title: 'Gaussian & separability', chapterId: 'filtering' });

const W = 200;
const H = 150;
const BORDER = 'reflect';

function defaults() {
  return { sigma: 2, w: 3, n: 3 };
}
const state = defaults();

const pane = new Pane({ container: document.getElementById('controls')!, title: 'Gaussian' });
pane.addBinding(state, 'sigma', { label: 'σ (px)', min: 0.5, max: 5, step: 0.1 });
let gray: Plane = toGray(
  addImagePicker(pane, { names: ['chart', 'scene', 'text', 'zone-plate'], value: 'chart', width: W, height: H }, (img) => {
    gray = toGray(img);
    schedule();
  }),
);
const boxFolder = pane.addFolder({ title: 'Repeated box filter' });
boxFolder.addBinding(state, 'w', { label: 'box width w', options: { '3': 3, '5': 5, '7': 7, '9': 9 } });
boxFolder.addBinding(state, 'n', { label: 'passes n', min: 1, max: 10, step: 1 });
pane.addButton({ title: 'Reset' }).on('click', () => {
  Object.assign(state, defaults());
  pane.refresh();
});

const kernelPlot = new KernelPlot(document.getElementById('kernel-plot')!);
const boxPlot = new KernelPlot(document.getElementById('box-plot')!);
const kernelView = new PixelView(document.getElementById('kernel-view')!);
const imageViews = ['original-view', 'rows-view', 'both-view'].map((id) => new PixelView(document.getElementById(id)!));
const values = document.getElementById('values')!;

kernelView.overlay = (ctx, t) => {
  if (t.scale < 6) return;
  const [x0, y0] = t.toView(0, 0);
  const n = gaussianKernel(state.sigma).length;
  ctx.strokeStyle = cssColor('--viz-grid');
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < n; i++) {
    ctx.moveTo(x0 + i * t.scale, y0);
    ctx.lineTo(x0 + i * t.scale, y0 + n * t.scale);
    ctx.moveTo(x0, y0 + i * t.scale);
    ctx.lineTo(x0 + n * t.scale, y0 + i * t.scale);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
};

let cache: { sigma: number; gray: Plane; rows: Plane; both: Plane; error: number } | null = null;

function update(): void {
  const g = gaussianKernel(state.sigma);
  const P = g.length;
  const g2 = outerProduct(g, g);
  const peak = g2.data[(P * P - 1) / 2];
  kernelView.show(planeToImage({ ...g2, data: g2.data.map((v) => v / peak) }));
  document.getElementById('kernel-size')!.textContent = `${P} × ${P}, scaled so that the center is white`;
  kernelPlot.render({ bars: g });

  if (cache?.sigma !== state.sigma || cache.gray !== gray) {
    const rowKernel: Plane = { width: P, height: 1, data: g };
    const rows = correlate(gray, rowKernel, BORDER);
    const both = correlateSeparable(gray, g, g, BORDER);
    const error = maxAbsDifference(both.data, correlate(gray, g2, BORDER).data);
    cache = { sigma: state.sigma, gray, rows, both, error };
    imageViews[0].show(planeToImage(gray));
    imageViews[1].show(planeToImage(rows));
    imageViews[2].show(planeToImage(both));
  }

  const box = repeatedBox(state.w, state.n);
  const boxSigma = Math.sqrt(repeatedBoxVariance(state.w, state.n));
  const gauss = sampledGaussian(boxSigma, (box.length - 1) / 2);
  boxPlot.render({ bars: box, curve: (x) => Math.exp(-(x * x) / (2 * boxSigma ** 2)) / (Math.sqrt(2 * Math.PI) * boxSigma) });
  renderValues(P, cache.error, box, maxAbsDifference(box, gauss));
}
const schedule = perFrame(update);

/** Thousands separated by thin spaces. */
const count = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\\,');

function scientific(x: number): string {
  if (x === 0) return '0';
  const e = Math.floor(Math.log10(x));
  return `${fmt(x / 10 ** e, 1)} \\cdot 10^{${e}}`;
}

function renderValues(P: number, error: number, box: Float32Array, deviation: number): void {
  const { sigma, w, n } = state;
  const perPixel = multiplications(1, 1, P, P);
  const image = multiplications(W, H, P, P);
  values.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <h3>Kernel size</h3>
        ${eq(`P = Q = 2 \\lceil 3 \\cdot ${fmt(sigma, 1)} \\rceil + 1 = ${P}`)}
        ${eq(`\\text{per pixel: } P Q = ${perPixel.direct} \\quad \\text{vs} \\quad P + Q = \\htmlClass{result}{${perPixel.separable}}`)}
      </div>
      <div class="value-block">
        <h3>Multiplications for the ${W} × ${H} image</h3>
        ${eq(`MNPQ = ${count(image.direct)}`)}
        ${eq(`MN(P + Q) = \\htmlClass{result}{${count(image.separable)}} \\quad (${fmt(image.direct / image.separable, 1)} \\times \\text{ fewer})`)}
        ${eq(`\\max \\left| \\text{two passes} - \\text{direct 2D} \\right| = ${scientific(error)}`)}
      </div>
      <div class="value-block">
        <h3>Box filter of width ${w}, ${n} time${n > 1 ? 's' : ''}: B<sup>(n)</sup></h3>
        ${eq(`\\sigma^2 = n \\, \\frac{w^2 - 1}{12} = ${n} \\cdot \\frac{${w * w - 1}}{12} = ${fmt(repeatedBoxVariance(w, n), 2)}, \\quad \\sigma = \\htmlClass{result}{${fmt(Math.sqrt(repeatedBoxVariance(w, n)), 2)}}`)}
        ${eq(`\\text{width } n(w - 1) + 1 = ${box.length}, \\quad \\text{measured } \\textstyle\\sum_x x^2 B^{(n)}(x) = ${fmt(kernelVariance(box), 2)}`)}
        ${eq(`\\max_x \\left| B^{(n)}(x) - G_\\sigma(x) \\right| = ${fmt(deviation, 4)}`)}
      </div>
    </div>`;
}

pane.on('change', schedule);
onThemeChange(schedule);
update();
