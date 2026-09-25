import { Pane } from 'tweakpane';
import { fft2, fftShift, ifft2 } from '../../src/shared/fft';
import { type Plane, type RGBImage, centerCrop, planeToImage, toGray } from '../../src/shared/image';
import { addImagePicker } from '../../src/shared/imagePicker';
import { initPage } from '../../src/shared/page';
import { PixelView, perFrame } from '../../src/shared/pixelView';
import type { TestImage } from '../../src/shared/testImages';
import { eq, fmt } from '../../src/shared/tex';
import { correlation, fromPolar, magnitude, phase, radialAverage, randomPhase, stretch } from './swap';
import '../../src/shared/styles/demo.css';

initPage({ title: 'Magnitude vs phase', chapterId: 'frequency' });

const N = 256;
const names: TestImage[] = ['scene', 'chart', 'text', 'zone-plate', 'gradients'];
const state = { seed: 1 };

const crop = (img: RGBImage): Plane => centerCrop(toGray(img), N, N);
const pane = new Pane({ container: document.getElementById('controls')!, title: 'Magnitude vs phase' });
let a = crop(
  addImagePicker(pane.addFolder({ title: 'Image A' }), { names, value: 'scene', width: 342, height: N, label: 'image A' }, (img) => {
    a = crop(img);
    schedule();
  }),
);
let b = crop(
  addImagePicker(pane.addFolder({ title: 'Image B' }), { names, value: 'text', width: 342, height: N, label: 'image B' }, (img) => {
    b = crop(img);
    schedule();
  }),
);
pane.addButton({ title: 'New random phase' }).on('click', () => {
  state.seed++;
  schedule();
});

const view = (id: string) => new PixelView(document.getElementById(id)!);
const views = {
  a: view('a-view'),
  b: view('b-view'),
  magAphaseB: view('mag-a-phase-b-view'),
  magBphaseA: view('mag-b-phase-a-view'),
  radial: view('radial-view'),
  flat: view('flat-view'),
  random: view('random-view'),
  zero: view('zero-view'),
};
const values = document.getElementById('values')!;

let cache: { a: Plane; b: Plane; seed: number } | null = null;

function update(): void {
  if (cache?.a === a && cache.b === b && cache.seed === state.seed) return;
  cache = { a, b, seed: state.seed };
  const A = fft2(a);
  const B = fft2(b);
  const magA = magnitude(A);
  const phaseA = phase(A);
  const combine = (mag: Float64Array, phi: Float64Array) => ifft2(fromPolar(N, N, mag, phi));

  const magAphaseB = combine(magA, phase(B));
  const magBphaseA = combine(magnitude(B), phaseA);
  const radial = combine(radialAverage(magA, N, N), phaseA);
  const flat = combine(new Float64Array(N * N).fill(1), phaseA);
  const random = combine(magA, randomPhase(N, N, state.seed));
  const zero = combine(magA, new Float64Array(N * N));

  views.a.show(planeToImage(a));
  views.b.show(planeToImage(b));
  views.magAphaseB.show(planeToImage(magAphaseB));
  views.magBphaseA.show(planeToImage(magBphaseA));
  views.radial.show(planeToImage(radial));
  views.flat.show(planeToImage(stretch(flat)));
  views.random.show(planeToImage(random));
  views.zero.show(planeToImage(stretch(fftShift(zero))));

  renderValues({ magAphaseB, magBphaseA, radial, flat, random });
}
const schedule = perFrame(update);

function r(p: Plane, q: Plane, highlight: boolean): string {
  const v = fmt(correlation(p, q), 2);
  return highlight ? `\\htmlClass{result}{${v}}` : v;
}

function hybridLine(label: string, p: Plane): string {
  const ra = correlation(p, a);
  const rb = correlation(p, b);
  return eq(`${label}: \\quad r(\\cdot, A) = ${r(p, a, ra > rb)}, \\quad r(\\cdot, B) = ${r(p, b, rb >= ra)}`);
}

function renderValues(p: Record<'magAphaseB' | 'magBphaseA' | 'radial' | 'flat' | 'random', Plane>): void {
  values.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <h3>Swapped: which image does the result resemble?</h3>
        ${hybridLine('|A| \\, e^{i \\angle B}', p.magAphaseB)}
        ${hybridLine('|B| \\, e^{i \\angle A}', p.magBphaseA)}
        ${eq(`r(A, B) = ${fmt(correlation(a, b), 2)}`)}
        <p class="muted small">Correlation coefficient r: 1 for the same image up to brightness and contrast, 0 for unrelated images.</p>
      </div>
      <div class="value-block">
        <h3>Keeping only one part of A</h3>
        ${eq(`\\angle A \\text{ with the radial average of } |A|: \\quad r(\\cdot, A) = ${r(p.radial, a, true)}`)}
        ${eq(`\\angle A \\text{ with } |F| = 1: \\quad r(\\cdot, A) = ${r(p.flat, a, false)}`)}
        ${eq(`|A| \\text{ with random phase}: \\quad r(\\cdot, A) = ${r(p.random, a, false)}`)}
      </div>
    </div>`;
}

update();
