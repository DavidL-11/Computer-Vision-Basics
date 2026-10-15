import { Controls } from '../../src/shared/controls';
import { random } from '../../src/shared/noise';
import { initPage } from '../../src/shared/page';
import { perFrame } from '../../src/shared/pixelView';
import { Plot, ticks } from '../../src/shared/plot';
import { eq, fmt, renderTex } from '../../src/shared/tex';
import { onThemeChange } from '../../src/shared/theme';
import { RowsView } from './rowsView';
import { type Reconstruction, TopView, Z_MAX } from './topView';
import { type Point, depthResolution, project, triangulate, visibleInBoth } from './triangulation';
import '../../src/shared/styles/demo.css';
import './stereo-depth.css';

initPage({ title: 'Disparity, depth & triangulation', chapterId: 'stereo' });

/** Image width in pixels. */
const W = 160;
const COLORS = ['--accent', '--viz-object'];
const LABELS = ['P', 'Q'];

const defaults = () => ({
  T: 0.3,
  f: 100,
  match: 'correct',
  noise: 0,
  seed: 1,
  P: { X: -0.6, Z: 4 },
  Q: { X: 1.1, Z: 7.3 },
});
const state = defaults();

const ui = new Controls();
ui.toolbar().addResetButton(() => {
  Object.assign(state, defaults());
  ui.refresh();
  schedule();
});

const top = ui.panel('top-view');
top.addBinding(state, 'T', { label: 'baseline T (m)', min: 0.05, max: 2, step: 0.01 });
top.addBinding(state, 'f', { label: 'focal length f (px)', min: 20, max: 400, step: 1 });
top.addBinding(state, 'match', { label: 'correspondence', options: { correct: 'correct', 'P ↔ Q swapped': 'swapped' } });

const rows = ui.panel('rows-view');
rows.addBinding(state, 'noise', { label: 'noise σ (px)', min: 0, max: 2, step: 0.05 });
rows.addButton({ title: 'New noise' }).on('click', () => {
  state.seed++;
  schedule();
});

const points = (): Point[] => [state.P, state.Q];
const topView = new TopView(document.getElementById('top-view')!, (i, p) => {
  const target = i === 0 ? state.P : state.Q;
  target.X = Math.max(-6, Math.min(6 + state.T, p.X));
  target.Z = Math.max(0.5, Math.min(Z_MAX - 0.3, p.Z));
  ui.refresh();
  schedule();
});
const rowsView = new RowsView(document.getElementById('rows-view')!);
const plot = new Plot(document.getElementById('resolution-plot')!, 240);
const values = document.getElementById('values')!;

/** Measured pixel: the true position plus Gaussian noise, rounded to the nearest pixel center. */
function measure(): { xL: number; xR: number; mL: number; mR: number }[] {
  const rand = random(state.seed * 7919);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  return points().map((p) => {
    const { xL, xR } = project(state.T, state.f, p);
    return { xL, xR, mL: Math.round(xL + state.noise * gauss()), mR: Math.round(xR + state.noise * gauss()) };
  });
}

function update(): void {
  const m = measure();
  const swapped = state.match === 'swapped';
  const recon: Reconstruction[] = m.map((a, i) => {
    const b = swapped ? m[1 - i] : a;
    return { xL: a.mL, xR: b.mR, color: COLORS[i], label: swapped ? `${LABELS[i]}_L + ${LABELS[1 - i]}_R` : `${LABELS[i]}̂` };
  });
  topView.render({
    T: state.T,
    f: state.f,
    W,
    points: points().map((p, i) => ({ p, color: COLORS[i], label: LABELS[i] })),
    rays: m.flatMap((a, i) => [
      { camera: 0 as const, x: a.mL, color: COLORS[i] },
      { camera: 1 as const, x: a.mR, color: COLORS[i] },
    ]),
    reconstructions: recon,
  });
  rowsView.render(
    W,
    m.map((a, i) => ({ ...a, color: COLORS[i], label: LABELS[i] })),
  );
  drawPlot();
  renderValues(m, recon);
}
const schedule = perFrame(update);

function drawPlot(): void {
  const res = (Z: number) => depthResolution(state.T, state.f, Z);
  const yMax = Math.min(10, Math.max(1, res(Z_MAX)) * 1.05);
  plot.render({ x: [0, Z_MAX], y: [0, yMax] }, (fr) => {
    fr.grid(ticks(0, Z_MAX, 6), ticks(0, yMax, 5), { y: (v) => fmt(v, yMax < 2 ? 1 : 0) });
    fr.line(res, '--fg-muted');
    points().forEach((p, i) => fr.stems([[p.Z, Math.min(yMax, res(p.Z))]], COLORS[i]));
  });
}

function renderValues(m: ReturnType<typeof measure>, recon: Reconstruction[]): void {
  const { T, f } = state;
  const blocks = points().map((p, i) => {
    const a = m[i];
    const r = recon[i];
    const d = r.xL - r.xR;
    const q = triangulate(T, f, r.xL, r.xR);
    const visible = visibleInBoth(T, f, W, p);
    const result = q
      ? eq(`\\hat Z = \\frac{f\\,T}{d} = \\frac{${fmt(f, 0)} \\cdot ${fmt(T, 2)}}{${d}} = \\htmlClass{result}{${fmt(q.Z, 2)}}\\ \\text{m},\\quad \\hat X = \\frac{x_L \\hat Z}{f} = ${fmt(q.X, 2)}\\ \\text{m}`)
      : `<p class="warn">${renderTex(`d = ${d} \\le 0`)}: the rays do not meet in front of the cameras, the point would lie at or beyond infinity.</p>`;
    return `
      <div class="value-block">
        <h3>${state.match === 'swapped' ? r.label.replace('_L', '<sub>L</sub>').replace('_R', '<sub>R</sub>') : `Point ${LABELS[i]}`}</h3>
        ${eq(`${LABELS[i]} = (X, Z) = (${fmt(p.X, 2)},\\ ${fmt(p.Z, 2)})\\ \\text{m}`)}
        ${eq(`x_L = \\tfrac{f X}{Z} = ${fmt(a.xL, 2)} \\to ${a.mL},\\quad x_R = \\tfrac{f (X - T)}{Z} = ${fmt(a.xR, 2)} \\to ${a.mR}`)}
        ${eq(`d = x_L - x_R = ${r.xL} - (${r.xR}) = ${d}\\ \\text{px}`)}
        ${result}
        ${q && state.match === 'correct' ? eq(`\\text{error } |\\hat Z - Z| = ${fmt(Math.abs(q.Z - p.Z), 2)}\\ \\text{m},\\quad \\tfrac{Z^2}{f\\,T} = ${fmt(depthResolution(T, f, p.Z), 2)}\\ \\text{m per px}`) : ''}
        ${visible ? '' : '<p class="warn">Outside one of the images: this point has no correspondence.</p>'}
      </div>`;
  });
  values.innerHTML = `<div class="value-grid">${blocks.join('')}</div>`;
}

ui.on('change', schedule);
onThemeChange(schedule);
update();
