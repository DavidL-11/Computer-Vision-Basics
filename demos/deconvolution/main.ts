import { Pane } from 'tweakpane';
import { type Spectrum, fft2 } from '../../src/shared/fft';
import { type Plane, type RGBImage, centerCrop, planeToImage, psnr, toGray } from '../../src/shared/image';
import { addImagePicker } from '../../src/shared/imagePicker';
import { initPage } from '../../src/shared/page';
import { PixelView, perFrame } from '../../src/shared/pixelView';
import { Plot } from '../../src/shared/plot';
import { eq, fmt } from '../../src/shared/tex';
import { onThemeChange } from '../../src/shared/theme';
import {
  type Blur,
  type Degraded,
  type Filter,
  type Method,
  alongU,
  degrade,
  gaussianTransfer,
  motionTransfer,
  restorationFilter,
  restore,
} from './deconvolution';
import '../../src/shared/styles/demo.css';

initPage({ title: 'Deconvolution', chapterId: 'frequency' });

const N = 256;

function defaults() {
  return {
    blur: 'gaussian' as Blur,
    sigma: 2,
    length: 9,
    noise: 0,
    round8: false,
    seed: 1,
    method: 'inverse' as Method,
    logEps: -3,
    logK: -3,
  };
}
const state = defaults();

const pane = new Pane({ container: document.getElementById('controls')!, title: 'Deconvolution' });
const crop = (img: RGBImage): Plane => centerCrop(toGray(img), N, N);
let original = crop(
  addImagePicker(pane, { names: ['scene', 'chart', 'text', 'zone-plate'], value: 'scene', width: 342, height: N }, (img) => {
    original = crop(img);
    schedule();
  }),
);

const blurFolder = pane.addFolder({ title: 'Blur h (known)' });
blurFolder.addBinding(state, 'blur', { label: 'kernel', options: { Gaussian: 'gaussian', 'horizontal motion': 'motion' } });
const sigmaBinding = blurFolder.addBinding(state, 'sigma', { label: 'σ (px)', min: 0.5, max: 4, step: 0.1 });
const lengthBinding = blurFolder.addBinding(state, 'length', { label: 'length L (px)', min: 3, max: 25, step: 2 });

const noiseFolder = pane.addFolder({ title: 'Noise n' });
noiseFolder.addBinding(state, 'noise', {
  label: 'σₙ',
  options: { none: 0, '0.00001': 1e-5, '0.0001': 1e-4, '0.001': 1e-3, '0.003': 3e-3, '0.01': 0.01, '0.03': 0.03 },
});
noiseFolder.addBinding(state, 'round8', { label: 'round to 8 bits' });
noiseFolder.addButton({ title: 'New noise' }).on('click', () => {
  state.seed++;
  schedule();
});

const restoreFolder = pane.addFolder({ title: 'Restoration filter R' });
restoreFolder.addBinding(state, 'method', {
  label: 'method',
  options: { 'inverse 1/H': 'inverse', 'truncated inverse': 'truncated', 'Wiener (regularized)': 'wiener' },
});
const epsBinding = restoreFolder.addBinding(state, 'logEps', { label: 'log₁₀ ε', min: -10, max: 0, step: 0.1 });
const kBinding = restoreFolder.addBinding(state, 'logK', { label: 'log₁₀ K', min: -10, max: 0, step: 0.1 });

pane.addButton({ title: 'Reset' }).on('click', () => {
  Object.assign(state, defaults());
  pane.refresh();
});

const views = {
  original: new PixelView(document.getElementById('original-view')!),
  degraded: new PixelView(document.getElementById('degraded-view')!),
  restored: new PixelView(document.getElementById('restored-view')!),
  error: new PixelView(document.getElementById('error-view')!),
};
const plot = new Plot(document.getElementById('transfer-plot')!, 240);
const values = document.getElementById('values')!;

const param = () => 10 ** (state.method === 'truncated' ? state.logEps : state.logK);

interface Cache {
  source?: { original: Plane; F: Spectrum };
  degraded?: { key: string; source: Cache['source']; H: Filter; result: Degraded };
}
const cache: Cache = {};

function update(): void {
  sigmaBinding.hidden = state.blur !== 'gaussian';
  lengthBinding.hidden = state.blur !== 'motion';
  epsBinding.hidden = state.method !== 'truncated';
  kBinding.hidden = state.method !== 'wiener';

  if (cache.source?.original !== original) {
    cache.source = { original, F: fft2(original) };
    views.original.show(planeToImage(original));
  }
  const key = JSON.stringify([state.blur, state.sigma, state.length, state.noise, state.round8, state.seed]);
  if (cache.degraded?.key !== key || cache.degraded.source !== cache.source) {
    const H = state.blur === 'gaussian' ? gaussianTransfer(N, state.sigma) : motionTransfer(N, state.length);
    const result = degrade(cache.source.F, H, state.noise, state.seed, state.round8);
    cache.degraded = { key, source: cache.source, H, result };
    views.degraded.show(planeToImage(result.g));
  }
  const { H, result } = cache.degraded;
  const R = restorationFilter(H, state.method, param());
  const restored = restore(result.G, R);
  views.restored.show(planeToImage(restored));
  views.error.show(planeToImage({ ...restored, data: restored.data.map((v, i) => 0.5 + 4 * (v - original.data[i])) }));
  renderPlot(H, R);
  renderValues(H, R, result.g, restored);
}
const schedule = perFrame(update);

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const power = (k: number) => `10${k < 0 ? '⁻' : ''}${[...String(Math.abs(k))].map((d) => SUPERSCRIPT[+d]).join('')}`;

const Y_MIN = -8;
const Y_MAX = 8;
/** log₁₀|x|, limited to just outside the plot so that 0 and ∞ still draw as lines leaving the plot. */
const log = (x: number) => Math.min(Y_MAX + 1, Math.max(Y_MIN - 1, Math.log10(Math.abs(x))));

function renderPlot(H: Filter, R: Filter): void {
  const h = alongU(H);
  const r = alongU(R);
  plot.render({ x: [0, N / 2], y: [Y_MIN, Y_MAX] }, (f) => {
    // Frequencies that the filter drops completely.
    r.forEach((v, u) => {
      if (v === 0) f.band(u - 0.5, u + 0.5, '--fg-faint', 0.25);
    });
    f.grid([0, 16, 32, 48, 64, 80, 96, 112, 128], [-8, -4, 0, 4, 8], { y: (k) => power(k) });
    f.line(
      h.map((v, u) => [u, log(v)]),
      '--fg-muted',
    );
    f.line(
      r.map((v, u) => [u, log(v)]),
      '--accent',
    );
    f.line(
      r.map((v, u) => [u, log(v * h[u])]),
      '--viz-highlight',
      { dash: [5, 4] },
    );
  });
}

function sci(x: number): string {
  if (!Number.isFinite(x)) return '\\infty';
  if (x === 0) return '0';
  if (Math.abs(x) >= 1e4 || Math.abs(x) < 1e-3) {
    const [m, e] = x.toExponential(1).split('e');
    return `${m} \\cdot 10^{${Number(e)}}`;
  }
  return fmt(x, 3);
}

function dB(v: number): string {
  if (v === Infinity) return '\\infty';
  return Number.isFinite(v) ? `${fmt(v, 1)} \\text{ dB}` : '-\\infty';
}

function blurFormula(H: Filter): string {
  const minH = alongU(H).reduce((m, v) => Math.min(m, Math.abs(v)), Infinity);
  if (state.blur === 'gaussian')
    return `${eq(`H(u, v) = e^{-2\\pi^2 \\sigma^2 (u^2 + v^2) / N^2}, \\quad \\sigma = ${fmt(state.sigma, 1)} \\text{ px}`)}
      ${eq(`H(\\tfrac{N}{2}, 0) = ${sci(minH)}`)}`;
  return `${eq(`H(u, v) = \\frac{1}{L} \\sum_{k = -${(state.length - 1) / 2}}^{${(state.length - 1) / 2}} \\cos\\!\\big(2\\pi u k / N\\big), \\quad L = ${state.length}`)}
    ${eq(`\\min_u |H(u, 0)| = ${sci(minH)}`)}`;
}

function restorationFormula(): string {
  switch (state.method) {
    case 'inverse':
      return 'R = \\frac{1}{H}';
    case 'truncated':
      return `R = \\begin{cases} 1 / H & |H| \\ge \\varepsilon \\\\ 0 & \\text{otherwise} \\end{cases}, \\quad \\varepsilon = ${sci(param())}`;
    case 'wiener':
      return `R = \\frac{H}{H^2 + K}, \\quad K = ${sci(param())}`;
  }
}

function renderValues(H: Filter, R: Filter, g: Plane, restored: Plane): void {
  const gain = R.data.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const noise = state.noise > 0 || state.round8;
  values.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <h3>Degradation</h3>
        ${eq('g = h \\ast f + n \\quad \\Longleftrightarrow \\quad G = H \\cdot F + N')}
        ${blurFormula(H)}
        ${eq(`\\sigma_n = ${sci(state.noise)}${state.round8 ? ', \\text{ then rounded to 8 bits}' : ''}`)}
      </div>
      <div class="value-block">
        <h3>Restoration</h3>
        ${eq(`\\hat F = R \\cdot G = R H \\cdot F + R \\cdot N`)}
        ${eq(restorationFormula())}
        ${eq(`\\max |R| = \\htmlClass{result}{${sci(gain)}} \\text{ (largest noise gain)}`)}
        ${noise ? '' : '<p class="muted small">Without noise, R · H = 1 is all that matters.</p>'}
      </div>
      <div class="value-block">
        <h3>PSNR against the original</h3>
        ${eq(`\\text{degraded } g: ${dB(psnr(original, g))}`)}
        ${eq(`\\text{restored } \\hat f: \\htmlClass{result}{${dB(psnr(original, restored))}}`)}
      </div>
    </div>`;
}

pane.on('change', schedule);
onThemeChange(schedule);
update();
