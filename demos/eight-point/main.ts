import { Pane } from 'tweakpane';
import { epipolarLine, epipolarLineT, epipoles, toPixel, twoView, unitF } from '../../src/shared/epipolar';
import { type Mat3, type Vec3, det3 } from '../../src/shared/linalg';
import { random } from '../../src/shared/noise';
import { initPage } from '../../src/shared/page';
import { perFrame } from '../../src/shared/pixelView';
import { Plot } from '../../src/shared/plot';
import { eq, fmt, renderTex, sci, texSciMatrix } from '../../src/shared/tex';
import { onThemeChange } from '../../src/shared/theme';
import { type FEstimate, columnMagnitudes, epipolarDistances, estimateF } from './eightPoint';
import { ImageView } from './imageView';
import { CAMERAS, observe, randomPoints } from './scene';
import '../../src/shared/styles/demo.css';
import './eight-point.css';

initPage({ title: '8-point algorithm', chapterId: 'epipolar-geometry' });

const MAX_POINTS = 100;
const TEST_POINTS = 50;
const truth = twoView(CAMERAS[0].P, CAMERAS[1].P);
const trueF = unitF(truth.F);

const defaults = () => ({
  count: 12,
  noise: 1,
  normalize: true,
  rank2: true,
  allLines: true,
  zoomOut: 1.2,
  pointSeed: 1,
  noiseSeed: 1,
  selected: 0,
});
const state = defaults();

const pane = new Pane({ container: document.getElementById('controls')!, title: '8-point algorithm' });
const data = pane.addFolder({ title: 'Correspondences' });
data.addBinding(state, 'count', { label: 'points n', min: 8, max: MAX_POINTS, step: 1 });
data.addBinding(state, 'noise', { label: 'noise σ (px)', min: 0, max: 3, step: 0.05, format: (v: number) => fmt(v, 2) });
data.addButton({ title: 'New points' }).on('click', () => {
  state.pointSeed++;
  schedule();
});
data.addButton({ title: 'New noise' }).on('click', () => {
  state.noiseSeed++;
  schedule();
});
const algo = pane.addFolder({ title: 'Algorithm' });
algo.addBinding(state, 'normalize', { label: 'normalize' });
algo.addBinding(state, 'rank2', { label: 'enforce rank 2' });
const display = pane.addFolder({ title: 'Display' });
display.addBinding(state, 'allLines', { label: 'lines of all points' });
display.addBinding(state, 'zoomOut', { label: 'zoom out', min: 1, max: 8, step: 0.1 });
pane.addButton({ title: 'Reset' }).on('click', () => {
  Object.assign(state, defaults());
  pane.refresh();
  schedule();
});

const select = (i: number) => {
  state.selected = i;
  schedule();
};
const views = [0, 1].map((i) => new ImageView(document.getElementById(`image${i}-view`)!, select));
const sigmaPlot = new Plot(document.getElementById('sigma-plot')!, 180);
const values = document.getElementById('values')!;

/** An epipole as a pixel, or its direction if it is at infinity. */
function texEpipole(e: Vec3): string {
  const p = toPixel(e);
  return p ? `(${fmt(p[0], 0)},\ ${fmt(p[1], 0)})` : '\text{at infinity}';
}

function update(): void {
  // Noise is drawn for all points at once, so changing n keeps the noise of each point.
  const all = observe(randomPoints(MAX_POINTS, random(state.pointSeed * 7919)), state.noise, random(state.noiseSeed * 104729));
  const x0 = all.x0.slice(0, state.count);
  const x1 = all.x1.slice(0, state.count);
  const test = observe(randomPoints(TEST_POINTS, random(state.pointSeed * 31 + 7)), 0, random(1));
  state.selected = Math.min(state.selected, state.count - 1);

  const est = estimateF(x0, x1, { normalize: state.normalize, rank2: state.rank2 });
  const F = unitF(est.F, trueF);
  const { e0, e1 } = epipoles(F);

  const common = { selected: state.selected, allLines: state.allLines, zoomOut: state.zoomOut };
  views[0].render({
    ...common,
    sub: '0',
    points: x0,
    test: test.x0,
    lines: x1.map((p) => epipolarLineT(F, p)),
    trueLines: x1.map((p) => epipolarLineT(trueF, p)),
    epipole: e0,
    trueEpipole: truth.e0,
  });
  views[1].render({
    ...common,
    sub: '1',
    points: x1,
    test: test.x1,
    lines: x0.map((p) => epipolarLine(F, p)),
    trueLines: x0.map((p) => epipolarLine(trueF, p)),
    epipole: e1,
    trueEpipole: truth.e1,
  });

  drawSigma(est);
  renderValues(est, F, x0, x1, test, e0, e1);
}
const schedule = perFrame(update);

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const power = (e: number) => `10${e < 0 ? '⁻' : ''}${[...String(Math.abs(e))].map((d) => SUPERSCRIPT[+d]).join('')}`;

/** Bars of log₁₀ σₖ; the last one belongs to the solution f. With 8 points, σ₉ is exactly 0. */
function drawSigma(est: FEstimate): void {
  const sigma = [...est.svd.sigma, ...new Array(9 - est.svd.sigma.length).fill(0)];
  const floor = sigma[0] * 1e-16;
  const logs = sigma.map((s) => Math.log10(Math.max(s, floor)));
  const lo = Math.floor(Math.min(...logs)) - 1;
  const hi = Math.ceil(Math.max(...logs));
  const yTicks = Array.from({ length: hi - lo + 1 }, (_, i) => i).filter((v, _, all) => all.length <= 10 || v % 2 === 0);
  sigmaPlot.render({ x: [0.4, 9.6], y: [0, hi - lo] }, (fr) => {
    fr.grid(
      Array.from({ length: 9 }, (_, i) => i + 1),
      yTicks,
      { y: (v) => power(v + lo) },
    );
    fr.bars(
      logs.slice(0, 8).map((v, i) => [i + 1, v - lo] as const),
      0.6,
      '--accent',
    );
    fr.bars([[9, logs[8] - lo]], 0.6, '--viz-highlight');
  });
}

const rows3 = (M: Mat3) => [M.slice(0, 3), M.slice(3, 6), M.slice(6)];
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;

function renderValues(est: FEstimate, F: Mat3, x0: [number, number][], x1: [number, number][], test: ReturnType<typeof observe>, e0: Vec3, e1: Vec3): void {
  const n = x0.length;
  const sigma = est.svd.sigma;
  const used = epipolarDistances(F, x0, x1);
  const usedTrue = epipolarDistances(trueF, x0, x1);
  const held = epipolarDistances(F, test.x0, test.x1);
  const cols = columnMagnitudes(est.A);
  const [s1, s2, s3] = est.sigmaF;
  const diff = Math.hypot(...F.map((v, i) => v - trueF[i]));

  values.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <h3>The system ${renderTex('A f = 0')}${state.normalize ? ', with normalized points' : ', in pixels'}</h3>
        ${eq(`A:\\ n \\times 9 = ${n} \\times 9`)}
        <p class="muted small">size of each column of ${renderTex('A')} (root mean square):</p>
        ${eq(`\\left(${cols.map((v) => sci(v, 2)).join(',\\ ')}\\right)`)}
        ${eq(
          n > 8
            ? `\\sigma_1 / \\sigma_8 = ${sci(sigma[0] / sigma[7], 3)},\\quad \\sigma_9 / \\sigma_8 = ${sci(sigma[8] / sigma[7], 3)}`
            : `\\sigma_1 / \\sigma_8 = ${sci(sigma[0] / sigma[7], 3)},\\quad \\sigma_9 = 0`,
        )}
        <p class="muted small">${renderTex('f')} = last column of ${renderTex('V')}; a large ${renderTex('\\sigma_1 / \\sigma_8')} means that noise moves the solution a lot</p>
      </div>
      <div class="value-block">
        <h3>Estimate and true ${renderTex('F')}, both scaled to ${renderTex('\\|F\\| = 1')}</h3>
        ${eq(`\\hat F = \\htmlClass{result}{${texSciMatrix(rows3(F))}}`)}
        ${eq(`F = ${texSciMatrix(rows3(trueF))},\\quad \\|\\hat F - F\\| = ${sci(diff, 3)}`)}
      </div>
      <div class="value-block">
        <h3>Rank</h3>
        <p class="muted small">singular values of ${renderTex('\\hat F')} from the SVD of ${renderTex('A')}, before the rank-2 step:</p>
        ${eq(`\\sigma_1 : \\sigma_2 : \\sigma_3 = 1 : ${fmt(s2 / s1, 4)} : ${sci(s3 / s1, 3)}`)}
        <p class="small">${
          state.rank2
            ? `${renderTex('\\sigma_3')} is set to 0, which gives the closest matrix of rank 2: ${renderTex(`\\det \\hat F = ${sci(det3(F), 2)}`)}.`
            : `Not enforced: ${renderTex(`\\det \\hat F = ${sci(det3(F), 2)}`)}, and the epipolar lines do not meet in one point.`
        }</p>
      </div>
      <div class="value-block">
        <h3>Distance of ${renderTex('x_1')} from its epipolar line ${renderTex('\\hat F x_0')}</h3>
        ${eq(`\\text{used points: mean}\\ ${fmt(mean(used), 2)},\\ \\text{max}\\ ${fmt(Math.max(...used), 2)}\\ \\text{px}`)}
        ${eq(`\\text{${TEST_POINTS} other points without noise: mean}\\ \\htmlClass{result}{${fmt(mean(held), 2)}}\\ \\text{px}`)}
        <p class="muted small">with the true ${renderTex('F')}, the used points are ${fmt(mean(usedTrue), 2)} px from their lines on average, because of the noise alone</p>
      </div>
      <div class="value-block">
        <h3>Epipoles</h3>
        ${eq(`\\hat e_0 = ${texEpipole(e0)},\\quad e_0 = ${texEpipole(truth.e0)}`)}
        ${eq(`\\hat e_1 = ${texEpipole(e1)},\\quad e_1 = ${texEpipole(truth.e1)}`)}
        <p class="muted small">null vectors of ${renderTex('\\hat F')} and ${renderTex('\\hat F^\\top')}; both lie outside the image, zoom out to see them</p>
      </div>
    </div>`;
}

pane.on('change', schedule);
onThemeChange(schedule);
update();
