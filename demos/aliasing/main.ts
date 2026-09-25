import { Pane } from 'tweakpane';
import { correlateSeparable, gaussianKernel } from '../../src/shared/filter';
import { type Plane, planeToImage, toGray } from '../../src/shared/image';
import { addImagePicker } from '../../src/shared/imagePicker';
import { initPage } from '../../src/shared/page';
import { PixelView, perFrame } from '../../src/shared/pixelView';
import { Plot, ticks } from '../../src/shared/plot';
import { eq, fmt } from '../../src/shared/tex';
import { alias, enlarge, gaussianResponse, nyquist, replicas, sampleTimes, signal, subsample } from './aliasing';
import '../../src/shared/styles/demo.css';

initPage({ title: 'Aliasing & Moiré', chapterId: 'frequency' });

const W = 320;
const H = 240;
const DURATION = 1;

function defaults() {
  return { f: 8, fs: 10, phase: 0, k: 4, sigma: 2 };
}
const state = defaults();

const pane = new Pane({ container: document.getElementById('controls')!, title: 'Aliasing' });
const signalFolder = pane.addFolder({ title: '1D signal' });
signalFolder.addBinding(state, 'f', { label: 'frequency f (Hz)', min: 0.5, max: 20, step: 0.1 });
signalFolder.addBinding(state, 'fs', { label: 'sampling rate fₛ (Hz)', min: 2, max: 40, step: 0.5 });
signalFolder.addBinding(state, 'phase', { label: 'phase φ (°)', min: -180, max: 180, step: 5 });
const imageFolder = pane.addFolder({ title: 'Image' });
let gray: Plane = toGray(
  addImagePicker(imageFolder, { names: ['zone-plate', 'chart', 'scene', 'text'], value: 'zone-plate', width: W, height: H }, (img) => {
    gray = toGray(img);
    schedule();
  }),
);
imageFolder.addBinding(state, 'k', { label: 'subsample by k', options: Object.fromEntries([2, 3, 4, 6, 8].map((k) => [`${k}`, k])) });
imageFolder.addBinding(state, 'sigma', { label: 'pre-filter σ (px)', min: 0, max: 4, step: 0.1 });
pane.addButton({ title: 'Reset' }).on('click', () => {
  Object.assign(state, defaults());
  pane.refresh();
});

const signalPlot = new Plot(document.getElementById('signal-plot')!, 240);
const spectrumPlot = new Plot(document.getElementById('spectrum-plot')!, 170, { left: 20, right: 20, top: 22, bottom: 26 });
const imageViews = ['original-view', 'naive-view', 'filtered-view'].map((id) => new PixelView(document.getElementById(id)!));
const values = document.getElementById('values')!;

const radians = (deg: number) => (deg * Math.PI) / 180;

function renderSignal(): void {
  const { f, fs } = state;
  const phase = radians(state.phase);
  const a = alias(f, fs, phase);
  const x = signal(f, phase);
  signalPlot.render({ x: [0, DURATION], y: [-1.3, 1.3] }, (p) => {
    p.grid(ticks(0, DURATION, 10), [-1, 0, 1], { x: (t) => `${fmt(t, 1)} s` });
    p.line(x, '--fg-muted', { width: 1.25, alpha: 0.7 });
    p.line(signal(a.f, a.phase), '--viz-highlight', { width: 2, dash: [6, 4] });
    p.stems(
      sampleTimes(fs, DURATION).map((t) => [t, x(t)] as const),
      '--accent',
    );
  });

  const maxF = Math.max(fs, 1.2 * (f + fs / 2));
  spectrumPlot.render({ x: [-maxF, maxF], y: [0, 1.25] }, (p) => {
    p.band(-nyquist(fs), nyquist(fs), '--accent', 0.12);
    p.grid(ticks(-maxF, maxF, 10), []);
    p.vline(-nyquist(fs), '--accent', { dash: [3, 3] });
    p.vline(nyquist(fs), '--accent', { dash: [3, 3] });
    p.label('fₛ/2', nyquist(fs), 1.25, '--accent', 'center');
    p.label('−fₛ/2', -nyquist(fs), 1.25, '--accent', 'center');
    const lines = replicas(f, fs, maxF);
    const isAlias = (v: number) => Math.abs(Math.abs(v) - a.f) < 1e-9;
    const isOriginal = (v: number) => Math.abs(Math.abs(v) - f) < 1e-9;
    p.stems(
      lines.filter((v) => !isAlias(v) && !isOriginal(v)).map((v) => [v, 1] as const),
      '--accent',
    );
    p.stems(
      lines.filter((v) => isOriginal(v) && !isAlias(v)).map((v) => [v, 1] as const),
      '--fg-muted',
    );
    p.stems(
      lines.filter(isAlias).map((v) => [v, 1] as const),
      '--viz-highlight',
      4.5,
    );
    if (!isAlias(f)) p.label('f', f, 1.1, '--fg-muted', 'center');
    p.label(a.f === f ? 'f' : 'alias', a.f, 1.1, '--viz-highlight', 'center');
  });
}

let cache: { gray: Plane; k: number; sigma: number } | null = null;

function renderImages(): void {
  const { k, sigma } = state;
  if (cache?.gray === gray && cache.k === k && cache.sigma === sigma) return;
  cache = { gray, k, sigma };
  const g = gaussianKernel(Math.max(sigma, 0.01));
  const blurred = sigma > 0 ? correlateSeparable(gray, g, g, 'reflect') : gray;
  imageViews[0].show(planeToImage(gray));
  imageViews[1].show(planeToImage(enlarge(subsample(gray, k), k, W, H)));
  imageViews[2].show(planeToImage(enlarge(subsample(blurred, k), k, W, H)));
  const every = `every ${k}${k === 2 ? 'nd' : k === 3 ? 'rd' : 'th'} pixel`;
  document.getElementById('naive-caption')!.textContent = every;
  document.getElementById('filtered-caption')!.textContent = sigma > 0 ? `Gaussian σ = ${fmt(sigma, 1)} px, then ${every}` : 'σ = 0: no pre-filter';
}

function update(): void {
  renderSignal();
  renderImages();
  renderValues();
}
const schedule = perFrame(update);

function renderValues(): void {
  const { f, fs, k, sigma } = state;
  const a = alias(f, fs, radians(state.phase));
  const below = f < nyquist(fs);
  const fold =
    a.k === 0
      ? `f_a = f = ${fmt(f, 1)} \\text{ Hz}`
      : `f_a = |f - ${a.k} f_s| = |${fmt(f, 1)} - ${fmt(a.k * fs, 1)}| = \\htmlClass{result}{${fmt(a.f, 2)} \\text{ Hz}}`;
  const fNew = 1 / (2 * k);
  const P = 2 * Math.ceil(3 * sigma) + 1;

  values.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <h3>Sampling the sinusoid</h3>
        ${eq(`\\tfrac{f_s}{2} = ${fmt(nyquist(fs), 2)} \\text{ Hz}, \\qquad \\tfrac{f_s}{f} = ${fmt(fs / f, 2)} \\text{ samples per period}`)}
        ${eq(fold)}
        ${eq(`\\varphi_a = ${a.folded ? '-\\varphi' : '\\varphi'} = ${fmt(a.phase * (180 / Math.PI), 0)}^\\circ`)}
        <p class="muted small">${
          below
            ? 'f is below the Nyquist frequency: the samples determine the sinusoid uniquely.'
            : f === nyquist(fs)
              ? 'f is exactly at the Nyquist frequency: two samples per period, and the amplitude depends on the phase.'
              : `f is above the Nyquist frequency: the samples look like a ${fmt(a.f, 2)} Hz sinusoid.`
        }</p>
      </div>
      <div class="value-block">
        <h3>Subsampling the image by k = ${k}</h3>
        ${eq(`\\text{new Nyquist frequency } \\tfrac{1}{2k} = ${fmt(fNew, 3)} \\text{ cycles/px (period } ${2 * k} \\text{ px)}`)}
        ${
          sigma > 0
            ? `${eq(`|G(f)| = e^{-2\\pi^2 \\sigma^2 f^2}: \\quad |G(\\tfrac{1}{2k})| = \\htmlClass{result}{${fmt(gaussianResponse(sigma, fNew), 3)}}, \\quad |G(\\tfrac{1}{4k})| = ${fmt(gaussianResponse(sigma, fNew / 2), 3)}`)}
               ${eq(`\\text{kernel } ${P} \\times ${P} \\text{ px}`)}`
            : '<p class="muted small">No pre-filter: everything above the new Nyquist frequency aliases.</p>'
        }
      </div>
    </div>`;
}

pane.on('change', schedule);
update();
