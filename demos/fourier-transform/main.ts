import { Pane } from 'tweakpane';
import { type Spectrum, fft2, fftShift, ifft2 } from '../../src/shared/fft';
import { boxKernel1D, correlateSeparable, gaussianKernel, outerProduct } from '../../src/shared/filter';
import { type Plane, type RGBImage, planeToImage, toGray } from '../../src/shared/image';
import { addImagePicker } from '../../src/shared/imagePicker';
import { initPage } from '../../src/shared/page';
import { PixelView, type ViewTransform, perFrame } from '../../src/shared/pixelView';
import { eq, fmt } from '../../src/shared/tex';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import {
  type Profile,
  type RadialKind,
  addPeriodicNoise,
  allPass,
  applyFilter,
  basisImage,
  centerCrop,
  component,
  energyFraction,
  kernelTransfer,
  logMagnitude,
  paintDisc,
  phaseImage,
  radialFilter,
} from './spectrum';
import '../../src/shared/styles/demo.css';
import './fourier-transform.css';

initPage({ title: '2D Fourier transform', chapterId: 'frequency' });

const N = 256;

type FilterKind = 'none' | RadialKind | 'paint' | 'gaussian-kernel' | 'box-kernel';
type Tool = 'inspect' | 'block' | 'restore';

function defaults() {
  return {
    noise: 0,
    nu: 24,
    nv: -16,
    filter: 'none' as FilterKind,
    profile: 'ideal' as Profile,
    d0: 30,
    d1: 60,
    sigma: 2,
    box: 5,
    tool: 'inspect' as Tool,
    brush: 2,
    u: 8,
    v: 0,
  };
}
const state = defaults();
let painted = allPass(N);
let paintVersion = 0;

const pane = new Pane({ container: document.getElementById('controls')!, title: '2D Fourier transform' });
let gray: Plane = crop(
  addImagePicker(pane, { names: ['scene', 'chart', 'text', 'zone-plate', 'gradients'], value: 'scene', width: 342, height: N }, (img) => {
    gray = crop(img);
    schedule();
  }),
);
function crop(img: RGBImage): Plane {
  return centerCrop(toGray(img), N, N);
}

const noiseFolder = pane.addFolder({ title: 'Periodic noise', expanded: false });
noiseFolder.addBinding(state, 'noise', { label: 'amplitude', min: 0, max: 0.5, step: 0.01 });
noiseFolder.addBinding(state, 'nu', { label: 'frequency u', min: -64, max: 64, step: 1 });
noiseFolder.addBinding(state, 'nv', { label: 'frequency v', min: -64, max: 64, step: 1 });

const filterFolder = pane.addFolder({ title: 'Filter H(u, v)' });
filterFolder.addBinding(state, 'filter', {
  label: 'filter',
  options: {
    none: 'none',
    'low-pass': 'low-pass',
    'high-pass': 'high-pass',
    'band-pass': 'band-pass',
    'painted mask': 'paint',
    'Gaussian kernel': 'gaussian-kernel',
    'box kernel': 'box-kernel',
  },
});
const profileBinding = filterFolder.addBinding(state, 'profile', { label: 'profile', options: { ideal: 'ideal', Gaussian: 'gaussian' } });
const d0Binding = filterFolder.addBinding(state, 'd0', { label: 'radius D₀', min: 1, max: 128, step: 1 });
const d1Binding = filterFolder.addBinding(state, 'd1', { label: 'radius D₁', min: 1, max: 128, step: 1 });
const sigmaBinding = filterFolder.addBinding(state, 'sigma', { label: 'kernel σ (px)', min: 0.5, max: 6, step: 0.1 });
const boxBinding = filterFolder.addBinding(state, 'box', { label: 'box width (px)', options: Object.fromEntries([3, 5, 7, 9, 11, 15].map((w) => [`${w}`, w])) });

const toolFolder = pane.addFolder({ title: 'Click on the spectrum' });
toolFolder
  .addBinding(state, 'tool', { label: 'tool', options: { 'inspect frequency': 'inspect', 'block (paint 0)': 'block', 'restore (paint 1)': 'restore' } })
  .on('change', ({ value }) => {
    if (value !== 'inspect') state.filter = 'paint';
    pane.refresh();
  });
const brushBinding = toolFolder.addBinding(state, 'brush', { label: 'brush radius', min: 0, max: 16, step: 1 });
const clearButton = toolFolder.addButton({ title: 'Clear painted mask' });
clearButton.on('click', () => {
  painted = allPass(N);
  paintVersion++;
  schedule();
});

pane.addButton({ title: 'Reset' }).on('click', () => {
  Object.assign(state, defaults());
  painted = allPass(N);
  paintVersion++;
  pane.refresh();
});

function syncControls(): void {
  const radial = state.filter === 'low-pass' || state.filter === 'high-pass' || state.filter === 'band-pass';
  profileBinding.hidden = d0Binding.hidden = !radial;
  d1Binding.hidden = state.filter !== 'band-pass';
  sigmaBinding.hidden = state.filter !== 'gaussian-kernel';
  boxBinding.hidden = state.filter !== 'box-kernel';
  brushBinding.hidden = state.tool === 'inspect';
}

function onSpectrumPick(x: number, y: number): void {
  const u = x - N / 2;
  const v = y - N / 2;
  if (state.tool === 'inspect') {
    state.u = u;
    state.v = v;
  } else {
    paintDisc(painted, u, v, state.brush, state.tool === 'block' ? 0 : 1);
    paintVersion++;
    if (state.filter !== 'paint') {
      state.filter = 'paint';
      pane.refresh();
    }
  }
  schedule();
}

const imageView = new PixelView(document.getElementById('image-view')!);
const magnitudeView = new PixelView(document.getElementById('magnitude-view')!, onSpectrumPick);
const phaseView = new PixelView(document.getElementById('phase-view')!, onSpectrumPick);
const resultView = new PixelView(document.getElementById('result-view')!);
const basisView = new PixelView(document.getElementById('basis-view')!);
const values = document.getElementById('values')!;

/** The filter drawn over the spectrum: transparent where H = 1, tinted where frequencies are removed. */
const maskCanvas = document.createElement('canvas');
maskCanvas.width = maskCanvas.height = N;

function renderMask(H: Plane | null): void {
  const ctx = maskCanvas.getContext('2d')!;
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, N, N);
  if (!H) return;
  const shifted = fftShift(H);
  const data = new ImageData(N, N);
  shifted.data.forEach((h, i) => (data.data[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, 1 - Math.abs(h))) * 0.6 * 255)));
  ctx.putImageData(data, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = cssColor('--viz-highlight');
  ctx.fillRect(0, 0, N, N);
}

function marker(ctx: CanvasRenderingContext2D, t: ViewTransform, u: number, v: number, dashed: boolean): void {
  const [x, y] = t.toView(u + N / 2 + 0.5, v + N / 2 + 0.5);
  ctx.setLineDash(dashed ? [3, 3] : []);
  ctx.beginPath();
  ctx.arc(x, y, Math.max(6, 2 * t.scale), 0, 2 * Math.PI);
  ctx.stroke();
  ctx.setLineDash([]);
}

function spectrumOverlay(withMask: boolean) {
  return (ctx: CanvasRenderingContext2D, t: ViewTransform) => {
    if (withMask && state.filter !== 'none') {
      ctx.imageSmoothingEnabled = false;
      const [x0, y0] = t.toView(0, 0);
      ctx.drawImage(maskCanvas, x0, y0, N * t.scale, N * t.scale);
    }
    ctx.strokeStyle = cssColor('--viz-points');
    ctx.lineWidth = 2;
    marker(ctx, t, state.u, state.v, false);
    if (state.u !== 0 || state.v !== 0) marker(ctx, t, -state.u, -state.v, true);
  };
}
magnitudeView.overlay = spectrumOverlay(true);
phaseView.overlay = spectrumOverlay(false);

function kernel(): Float32Array | null {
  if (state.filter === 'gaussian-kernel') return gaussianKernel(state.sigma);
  if (state.filter === 'box-kernel') return boxKernel1D(state.box);
  return null;
}

function transfer(): Plane | null {
  const { filter, profile, d0, d1 } = state;
  if (filter === 'none') return null;
  if (filter === 'paint') return painted;
  const k = kernel();
  if (k) return kernelTransfer(outerProduct(k, k), N);
  return radialFilter(N, filter as RadialKind, profile, d0, d1);
}

interface Cache {
  source?: { key: string; gray: Plane; image: Plane; S: Spectrum };
  filter?: { key: string; H: Plane | null };
  result?: { source: Cache['source']; filter: Cache['filter']; image: Plane; mean: number };
  check?: { source: Cache['source']; key: string; error: number };
}
const cache: Cache = {};

function update(): void {
  syncControls();
  const sourceKey = JSON.stringify([state.noise, state.nu, state.nv]);
  if (cache.source?.key !== sourceKey || cache.source.gray !== gray) {
    const image = state.noise > 0 ? addPeriodicNoise(gray, state.nu, state.nv, state.noise) : gray;
    const S = fft2(image);
    cache.source = { key: sourceKey, gray, image, S };
    imageView.show(planeToImage(image));
    magnitudeView.show(planeToImage(logMagnitude(S)));
    phaseView.show(planeToImage(phaseImage(S)));
  }
  const { image, S } = cache.source;

  const filterKey = JSON.stringify([state.filter, state.profile, state.d0, state.d1, state.sigma, state.box, state.filter === 'paint' ? paintVersion : 0]);
  if (cache.filter?.key !== filterKey) {
    cache.filter = { key: filterKey, H: transfer() };
    renderMask(cache.filter.H);
  }
  const { H } = cache.filter;

  if (cache.result?.source !== cache.source || cache.result.filter !== cache.filter) {
    const filtered = H ? ifft2(applyFilter(S, H)) : image;
    const mean = image.data.reduce((a, b) => a + b, 0) / image.data.length;
    cache.result = { source: cache.source, filter: cache.filter, image: filtered, mean };
    // Filters that remove DC leave an image around 0; show it around the original mean instead.
    const offset = H ? (1 - H.data[0]) * mean : 0;
    resultView.show(planeToImage(offset ? { ...filtered, data: filtered.data.map((v) => v + offset) } : filtered));
    document.getElementById('result-caption')!.textContent =
      offset > 1e-3 ? `the filter removes the mean; ${fmt(offset, 2)} added for display` : '';
  }

  const k = kernel();
  if (k && (cache.check?.source !== cache.source || cache.check.key !== filterKey)) {
    const direct = correlateSeparable(image, k, k, 'wrap');
    const error = cache.result.image.data.reduce((m, v, i) => Math.max(m, Math.abs(v - direct.data[i])), 0);
    cache.check = { source: cache.source, key: filterKey, error };
  }

  basisView.show(planeToImage(basisImage(state.u, state.v, N)));
  magnitudeView.draw();
  phaseView.draw();
  renderValues(S, H);
}
const schedule = perFrame(update);

function angle(u: number, v: number): number {
  return (Math.atan2(-v, u) * 180) / Math.PI;
}

function filterFormula(): string {
  const { filter, profile } = state;
  const D = 'D(u, v) = \\sqrt{u^2 + v^2}';
  const low = (r: string) => (profile === 'ideal' ? `[D \\le ${r}]` : `e^{-D^2 / 2 ${r}^2}`);
  switch (filter) {
    case 'low-pass':
      return `H = ${low('D_0')}, \\quad ${D}`;
    case 'high-pass':
      return `H = 1 - ${low('D_0')}, \\quad ${D}`;
    case 'band-pass':
      return `H = ${low('D_1')} - ${low('D_0')}, \\quad ${D}`;
    case 'paint':
      return 'H(u, v) = H(-u, -v) \\in \\{0, 1\\} \\text{ (painted)}';
    case 'gaussian-kernel':
      return `H = \\mathcal{F}\\{G_\\sigma\\}, \\quad \\sigma = ${fmt(state.sigma, 1)} \\text{ px}`;
    case 'box-kernel':
      return `H = \\mathcal{F}\\{\\text{box}_{${state.box}}\\}`;
    default:
      return 'H = 1';
  }
}

function renderValues(S: Spectrum, H: Plane | null): void {
  const { u, v } = state;
  const c = component(S, u, v);
  const r = Math.hypot(u, v);
  const sign = c.im < 0 ? '-' : '+';
  const frequency =
    r === 0
      ? '<p class="muted small">(0, 0) is the DC term: N² times the mean gray value.</p>'
      : `${eq(`\\text{period } \\frac{N}{\\sqrt{u^2 + v^2}} = \\frac{${N}}{${fmt(r, 2)}} = ${fmt(N / r, 1)} \\text{ px}, \\quad \\text{wave direction } ${fmt(angle(u, v), 0)}^\\circ`)}
         ${eq(`\\text{in the image: } A \\cos\\!\\big(2\\pi \\tfrac{ux + vy}{N} + \\varphi\\big), \\quad A = \\tfrac{2|F|}{N^2} = ${fmt(c.amplitude, 4)}`)}`;
  const check =
    kernel() && cache.check
      ? `<div class="value-block">
          <h3>Convolution theorem</h3>
          ${eq('\\mathcal{F}\\{f \\ast h\\} = F \\cdot H')}
          ${eq(`\\max \\big| \\mathcal{F}^{-1}\\{F \\cdot H\\} - f \\ast h \\big| = \\htmlClass{result}{${cache.check.error.toExponential(1).replace(/e([+-]\d+)/, ' \\cdot 10^{$1}')}}`)}
          <p class="muted small">Direct filtering with a periodic border, as the Fourier transform assumes.</p>
        </div>`
      : '';

  values.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <h3>Frequency (u, v) = (${u}, ${v})</h3>
        ${eq(`F(u, v) = \\sum_{x, y} f(x, y) \\, e^{-i 2\\pi (ux + vy) / N}, \\quad N = ${N}`)}
        ${eq(`F(${u}, ${v}) = ${fmt(c.re, 1)} ${sign} ${fmt(Math.abs(c.im), 1)} i = ${fmt(c.magnitude, 1)} \\, e^{i \\cdot \\htmlClass{result}{${fmt(c.phase, 2)}}}`)}
        ${frequency}
      </div>
      <div class="value-block">
        <h3>Filter</h3>
        ${eq(filterFormula())}
        ${eq(`\\frac{\\sum |F H|^2}{\\sum |F|^2} = \\htmlClass{result}{${fmt(100 * (H ? energyFraction(S, H) : 1), 2)}\\,\\%} \\text{ of the energy kept}`)}
        ${H ? eq(`H(0, 0) = ${fmt(H.data[0], 3)}`) : ''}
      </div>
      ${check}
    </div>`;
}

pane.on('change', schedule);
onThemeChange(() => {
  renderMask(cache.filter?.H ?? null);
  schedule();
});
update();
