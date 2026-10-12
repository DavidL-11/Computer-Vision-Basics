import { Pane } from 'tweakpane';
import { random } from '../../src/shared/noise';
import { initPage } from '../../src/shared/page';
import { perFrame } from '../../src/shared/pixelView';
import { Plot, ticks } from '../../src/shared/plot';
import { eq, fmt, renderTex, texMatrix, texVector } from '../../src/shared/tex';
import { onThemeChange } from '../../src/shared/theme';
import { type Preset, type TotalFit, type Vec2, type VerticalFit, centroid, lineAngle, presetPoints, rotateAbout, totalLS, verticalLS } from './fit';
import { FitView } from './fitView';
import '../../src/shared/styles/demo.css';
import './line-fitting.css';

initPage({ title: 'Line fitting', chapterId: 'calibration' });

const PRESETS: Preset[] = ['noisy line', 'steep line', 'vertical line', 'one outlier', 'two clusters'];
const DEG = Math.PI / 180;

const defaults = () => ({ preset: 'noisy line' as Preset, noise: 0.35, seed: 1, rotation: 0, showVLS: true, showTLS: true, showResiduals: true });
const state = defaults();
let points: Vec2[] = [];
/** The rotation already applied to `points`, so the slider can turn them by the difference. */
let applied = 0;

function generate(): void {
  const base = presetPoints(state.preset, state.noise, random(state.seed));
  points = rotateAbout(base, centroid(base), state.rotation * DEG);
  applied = state.rotation;
}
generate();

const pane = new Pane({ container: document.getElementById('controls')!, title: 'Line fitting' });
const presets = pane.addFolder({ title: 'Points' });
for (const name of PRESETS)
  presets.addButton({ title: name[0].toUpperCase() + name.slice(1) }).on('click', () => {
    state.preset = name;
    generate();
    schedule();
  });
presets.addBinding(state, 'noise', { label: 'noise σ', min: 0, max: 1, step: 0.01, format: (v: number) => fmt(v, 2) }).on('change', () => {
  generate();
  schedule();
});
presets.addButton({ title: 'New noise' }).on('click', () => {
  state.seed++;
  generate();
  schedule();
});
presets
  .addBinding(state, 'rotation', { label: 'rotate (°)', min: -90, max: 90, step: 1, format: (v: number) => fmt(v, 0) })
  .on('change', () => {
    points = rotateAbout(points, centroid(points), (state.rotation - applied) * DEG);
    applied = state.rotation;
    schedule();
  });
const display = pane.addFolder({ title: 'Display' });
display.addBinding(state, 'showVLS', { label: 'vertical LS' });
display.addBinding(state, 'showTLS', { label: 'total LS' });
display.addBinding(state, 'showResiduals', { label: 'residuals' });
display.on('change', () => schedule());
pane.addButton({ title: 'Reset' }).on('click', () => {
  Object.assign(state, defaults());
  pane.refresh();
  generate();
  schedule();
});

const fitView = new FitView(document.getElementById('fit-view')!, {
  add(p) {
    points.push(p);
    schedule();
    return points.length - 1;
  },
  move(i, p) {
    points[i] = p;
    schedule();
  },
  remove(i) {
    // Two points always define a line.
    if (points.length <= 2) return;
    points.splice(i, 1);
    schedule();
  },
});
const residualPlot = new Plot(document.getElementById('residual-plot')!, 220);
const values = document.getElementById('values')!;

function update(): void {
  const vls = verticalLS(points);
  const tls = totalLS(points);
  fitView.render({ points, vls, tls, showVLS: state.showVLS, showTLS: state.showTLS, showResiduals: state.showResiduals });
  drawResiduals(vls, tls);
  renderValues(vls, tls);
}
const schedule = perFrame(update);

function drawResiduals(vls: VerticalFit, tls: TotalFit): void {
  const n = points.length;
  const v = vls.p && state.showVLS ? vls.residuals.map((r) => r * r) : [];
  const t = state.showTLS ? tls.residuals.map((r) => r * r) : [];
  const max = Math.max(0.05, ...v, ...t);
  const yTicks = ticks(0, max * 1.05, 4);
  const step = n > 24 ? 5 : n > 12 ? 2 : 1;
  residualPlot.render({ x: [0.3, n + 0.7], y: [0, max * 1.08] }, (f) => {
    f.grid(
      Array.from({ length: n }, (_, i) => i + 1).filter((i) => i % step === 0 || i === 1),
      yTicks,
      { y: (y) => fmt(y, yTicks[1] < 0.1 ? 2 : 1) },
    );
    f.bars(
      v.map((r, i) => [i + 1 - 0.19, r] as const),
      0.36,
      '--vls',
    );
    f.bars(
      t.map((r, i) => [i + 1 + 0.19, r] as const),
      0.36,
      '--tls',
    );
  });
}

/** An n × k matrix with only the first and last rows when it is long. */
function texTall(rows: readonly (readonly number[])[], digits: number): string {
  const row = (r: readonly number[]) => r.map((v) => fmt(v, digits)).join(' & ');
  const cols = rows[0].length;
  const body =
    rows.length <= 5
      ? rows.map(row)
      : [...rows.slice(0, 3).map(row), Array(cols).fill('\\vdots').join(' & '), row(rows[rows.length - 1])];
  return `\\begin{bmatrix*}[r] ${body.join(' \\\\ ')} \\end{bmatrix*}`;
}

function renderValues(vls: VerticalFit, tls: TotalFit): void {
  const n = points.length;
  const vlsBlock = vls.p
    ? `${eq(`p = \\begin{bmatrix} m \\\\ b \\end{bmatrix} = (A^\\top A)^{-1} A^\\top y = \\htmlClass{result}{${texVector(vls.p, 3)}}`)}
       ${eq(`E = \\textstyle\\sum_i \\big(y_i - (m x_i + b)\\big)^2 = ${fmt(vls.E, 3)}`)}
       <p class="muted small">direction ${renderTex(`${fmt(lineAngle([1, vls.p[0]]), 1)}^\\circ`)}</p>`
    : `<p class="warn">${renderTex(`\\det(A^\\top A) = n \\textstyle\\sum x_i^2 - (\\sum x_i)^2 = 0`)}: all ${renderTex('x_i')} are equal, the line is vertical and ${renderTex('m \\to \\infty')}. There is no solution.</p>`;
  const [a, b] = tls.normal;
  values.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <h3><span class="swatch" style="background: var(--vls)"></span> Vertical least squares ${renderTex('Ap = y')}</h3>
        ${eq(`A = ${texTall(vls.A, 2)},\\; y = ${texTall(
          vls.y.map((v) => [v]),
          2,
        )},\\; A^\\top A = ${texMatrix(vls.AtA, 2)},\\; A^\\top y = ${texVector(vls.Aty, 2)}`)}
        ${vlsBlock}
      </div>
      <div class="value-block">
        <h3><span class="swatch" style="background: var(--tls)"></span> Total least squares ${renderTex('Ap = 0')}</h3>
        ${eq(`(\\bar x, \\bar y) = (${fmt(tls.mean[0], 3)},\\ ${fmt(tls.mean[1], 3)}),\\; A = ${texTall(tls.A, 2)},\\; A^\\top A = ${texMatrix(tls.AtA, 2)}`)}
        ${eq(`\\lambda_1 = ${fmt(tls.lambda[0], 3)} \\ge \\lambda_2 = ${fmt(tls.lambda[1], 3)},\\quad p = \\begin{bmatrix} a \\\\ b \\end{bmatrix} = \\htmlClass{result}{${texVector(tls.normal, 3)}}`)}
        ${eq(`c = -a \\bar x - b \\bar y = ${fmt(tls.c, 3)},\\quad E = \\textstyle\\sum_i (a x_i + b y_i + c)^2 = \\lambda_2 = ${fmt(tls.E, 3)}`)}
        <p class="muted small">direction ${renderTex(`${fmt(lineAngle([-b, a]), 1)}^\\circ`)}, ${n} points</p>
      </div>
      <div class="value-block">
        <h3>Recap: two optimization problems</h3>
        ${eq(`\\min_x |Ax - b|^2 \\;\\Rightarrow\\; x = (A^\\top A)^{-1} A^\\top b`)}
        ${eq(`\\min_x x^\\top A^\\top A\\, x \\text{ s.t. } x^\\top x = 1 \\;\\Rightarrow\\; x = \\text{eigenvector of the smallest } \\lambda`)}
        <p class="muted small">
          The first is vertical least squares with ${renderTex('x = (m, b)')}, the second total least squares with
          ${renderTex('x = (a, b)')}.
        </p>
      </div>
    </div>`;
}

onThemeChange(schedule);
update();
