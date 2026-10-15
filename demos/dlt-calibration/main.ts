import { buildK, buildP, buildR, buildT, lookAtAngles, project } from '../../src/shared/camera';
import { Controls } from '../../src/shared/controls';
import { DEG, type Mat3, type Mat34, type Vec3 } from '../../src/shared/linalg';
import { random } from '../../src/shared/noise';
import { initPage } from '../../src/shared/page';
import { perFrame } from '../../src/shared/pixelView';
import { Plot } from '../../src/shared/plot';
import { eq, fmt, renderTex, texMatrix, texVector } from '../../src/shared/tex';
import { onThemeChange } from '../../src/shared/theme';
import { type Calibration, type Factors, type Method, type Vec2, calibrate, factorize, normalizeM, projectM, reprojectionErrors, rotationError } from './dlt';
import { ImageView } from './imageView';
import { IMAGE_HEIGHT, IMAGE_WIDTH, RIG_CENTER, selectPoints, xzPoints, yzPoints } from './scene';
import { type CameraPose, WorldView } from './worldView';
import '../../src/shared/styles/demo.css';
import './dlt-calibration.css';

initPage({ title: 'DLT calibration', chapterId: 'calibration' });

const ALL_POINTS = [...xzPoints, ...yzPoints];

const defaults = () => ({
  alpha: 800,
  beta: 800,
  skew: 0,
  u0: 320,
  v0: 240,
  distance: 1.1,
  azimuth: 45,
  elevation: 25,
  noise: 0.5,
  count: ALL_POINTS.length,
  method: 'Ax=0' as Method,
  onePlane: false,
  seed: 1,
  magnify: 20,
});
const state = defaults();

const ui = new Controls();
const toolbar = ui.toolbar();
const px = (min: number, max: number, step = 1) => ({ min, max, step, format: (v: number) => fmt(v, step < 1 ? 1 : 0) });
const intr = toolbar.addFolder({ title: 'True intrinsics K' });
intr.addBinding(state, 'alpha', { label: 'α (px)', ...px(400, 1600) });
intr.addBinding(state, 'beta', { label: 'β (px)', ...px(400, 1600) });
intr.addBinding(state, 'skew', { label: 's', ...px(-50, 50) });
intr.addBinding(state, 'u0', { label: 'u₀ (px)', ...px(220, 420) });
intr.addBinding(state, 'v0', { label: 'v₀ (px)', ...px(160, 320) });
toolbar.addBinding(state, 'method', { label: 'method', options: { 'Method 1: Ax = b': 'Ax=b', 'Method 2: Ax = 0': 'Ax=0' } });
toolbar.addResetButton(() => {
  Object.assign(state, defaults());
  ui.refresh();
  schedule();
});

const pose = ui.panel('world-view').addFolder({ title: 'True pose' });
pose.addBinding(state, 'distance', { label: 'distance (m)', ...px(0.6, 3, 0.05), format: (v: number) => fmt(v, 2) });
pose.addBinding(state, 'azimuth', { label: 'azimuth (°)', ...px(20, 70) });
pose.addBinding(state, 'elevation', { label: 'elevation (°)', ...px(-10, 60) });

const imageControls = ui.panel('image-view');
const data = imageControls.addFolder({ title: 'Measurements' });
data.addBinding(state, 'noise', { label: 'noise σ (px)', min: 0, max: 3, step: 0.05, format: (v: number) => fmt(v, 2) });
data.addBinding(state, 'count', { label: 'points', min: 6, max: ALL_POINTS.length, step: 1 });
data.addBinding(state, 'onePlane', { label: 'one plane only' });
data.addButton({ title: 'New noise' }).on('click', () => {
  state.seed++;
  schedule();
});
imageControls.addFolder({ title: 'Display' }).addBinding(state, 'magnify', { label: 'error ×', min: 1, max: 100, step: 1 });

const imageView = new ImageView(document.getElementById('image-view')!);
const worldView = new WorldView(document.getElementById('world-view')!);
const sigmaPlot = new Plot(document.getElementById('sigma-plot')!, 200);
const imageCaption = document.getElementById('image-caption')!;
const values = document.getElementById('values')!;

function trueCamera(): CameraPose & { P: Mat34 } {
  const K = buildK({ fx: state.alpha, fy: state.beta, u0: state.u0, v0: state.v0, skew: state.skew });
  const az = state.azimuth * DEG, el = state.elevation * DEG, d = state.distance;
  const C: Vec3 = [RIG_CENTER[0] + d * Math.cos(el) * Math.cos(az), RIG_CENTER[1] + d * Math.cos(el) * Math.sin(az), RIG_CENTER[2] + d * Math.sin(el)];
  const { yaw, pitch } = lookAtAngles(C, RIG_CENTER);
  const R = buildR(yaw, pitch, 0);
  const t = buildT(R, C);
  return { K, R, t, C, P: buildP(K, R, t) };
}

/** Gaussian pixel noise per point of the whole target, so changing the subset keeps each point's noise. */
function noiseVectors(seed: number): Vec2[] {
  const rand = random(seed * 7919);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  return ALL_POINTS.map(() => [gauss(), gauss()]);
}

const inImage = ([u, v]: Vec2) => u >= 0 && v >= 0 && u <= IMAGE_WIDTH && v <= IMAGE_HEIGHT;
const key = (p: Vec3) => p.join(',');

function update(): void {
  const cam = trueCamera();
  const noise = noiseVectors(state.seed);
  const index = new Map(ALL_POINTS.map((p, i) => [key(p), i]));
  const observe = (p: Vec3): Vec2 => {
    const [u, v] = project(cam.K, cam.R, cam.t, p).uv;
    const [nu, nv] = noise[index.get(key(p))!];
    return [u + state.noise * nu, v + state.noise * nv];
  };
  // Only corners that are visible in the image can be measured.
  const X = selectPoints(state.count, state.onePlane, random(state.seed))
    .filter((p) => project(cam.K, cam.R, cam.t, p).inFront)
    .filter((p) => inImage(observe(p)));
  const uv = X.map(observe);
  const usedKeys = new Set(X.map(key));
  const unused = ALL_POINTS.filter((p) => !usedKeys.has(key(p)));

  const cal = X.length >= 6 ? calibrate(X, uv, state.method) : null;
  const f = cal?.M ? factorize(cal.M) : null;
  const projected = cal?.M ? X.map((p) => projectM(cal.M!, p)) : null;
  // A degenerate M̂ can send points to w = 0, i.e. to no pixel at all.
  const reprojected = projected?.every(([u, v]) => Number.isFinite(u) && Number.isFinite(v)) ? projected : null;

  imageView.render({
    M: cam.P,
    unused: unused.map((p) => project(cam.K, cam.R, cam.t, p)).filter((p) => p.inFront).map((p) => p.uv),
    observed: uv,
    reprojected,
    magnify: state.magnify,
  });
  imageCaption.textContent = `${IMAGE_WIDTH} × ${IMAGE_HEIGHT} px, ${X.length} points used, errors × ${state.magnify}`;
  worldView.update(cam, f, X, unused);
  drawSigma(cal);
  renderValues(cam, X, uv, cal, f);
}
const schedule = perFrame(update);

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const power = (e: number) => `10${e < 0 ? '⁻' : ''}${[...String(Math.abs(e))].map((d) => SUPERSCRIPT[+d]).join('')}`;

/** Bars of log₁₀ σₖ, measured from the bottom of the plot; the last one belongs to the solution of Ax = 0. */
function drawSigma(cal: Calibration | null): void {
  if (!cal) {
    sigmaPlot.render({ x: [0, 1], y: [0, 1] }, () => {});
    return;
  }
  const sigma = cal.svd.sigma;
  const floor = sigma[0] * 1e-16;
  const logs = sigma.map((s) => Math.log10(Math.max(s, floor)));
  const lo = Math.floor(Math.min(...logs)) - 1;
  const hi = Math.ceil(Math.max(...logs));
  const yTicks = Array.from({ length: hi - lo + 1 }, (_, i) => i).filter((v, _, all) => all.length <= 10 || v % 2 === 0);
  const n = sigma.length;
  sigmaPlot.render({ x: [0.4, n + 0.6], y: [0, hi - lo] }, (fr) => {
    fr.grid(
      Array.from({ length: n }, (_, i) => i + 1),
      yTicks,
      { y: (v) => power(v + lo) },
    );
    fr.bars(
      logs.slice(0, n - 1).map((v, i) => [i + 1, v - lo] as const),
      0.6,
      '--accent',
    );
    fr.bars([[n, logs[n - 1] - lo]], 0.6, state.method === 'Ax=0' ? '--viz-highlight' : '--accent');
  });
}

const sig = (v: number) => (Math.abs(v) < 1e-12 ? '0' : String(Number(v.toPrecision(4))));
const texSig = (rows: number[][]) => `\\begin{bmatrix*}[r] ${rows.map((r) => r.map(sig).join(' & ')).join(' \\\\ ')} \\end{bmatrix*}`;
const rows3 = (M: Mat3) => [M.slice(0, 3), M.slice(3, 6), M.slice(6)];
const rows34 = (M: Mat34) => [M.slice(0, 4), M.slice(4, 8), M.slice(8)];

function renderValues(cam: CameraPose & { P: Mat34 }, X: Vec3[], uv: Vec2[], cal: Calibration | null, f: Factors | null): void {
  const n = X.length;
  const cols = state.method === 'Ax=0' ? 12 : 11;
  const system = `<div class="value-block">
      <h3>${state.method === 'Ax=0' ? 'Method 2: ' + renderTex('Ax = 0') : 'Method 1: ' + renderTex('Ax = b')}</h3>
      ${eq(`A:\\ 2n \\times ${cols} = ${2 * n} \\times ${cols}\\quad (n = ${n})`)}
      <p class="muted small">${
        state.method === 'Ax=0'
          ? `${renderTex('x')} = last column of ${renderTex('V')}, the right singular vector of ${renderTex('\\sigma_{12}')}`
          : `${renderTex('m_{34} = 1')}, ${renderTex('x = (A^\\top A)^{-1} A^\\top b')}`
      }</p>
    </div>`;
  const warn = (text: string) => `<div class="value-block"><p class="warn">${text}</p></div>`;
  if (!cal) {
    values.innerHTML = `<div class="value-grid">${system}${warn(`Only ${n} corners are visible: at least 6 are needed for 11 unknowns.`)}</div>`;
    return;
  }
  if (!cal.M) {
    values.innerHTML = `<div class="value-grid">${system}${warn(`${renderTex('A^\\top A')} is singular: the points do not determine ${renderTex('M')}, so there is no solution.`)}</div>`;
    return;
  }
  const Mhat = normalizeM(cal.M);
  // The true M, scaled the same way and with the same sign, for comparison.
  const Mtrue = normalizeM(cam.P);
  const s = Math.sign(Mhat[11]) === Math.sign(Mtrue[11]) ? 1 : -1;
  const errors = reprojectionErrors(cal.M, X, uv).map(([du, dv]) => Math.hypot(du, dv));
  const mean = errors.reduce((a, b) => a + b, 0) / n;
  const reprojection = !errors.every(Number.isFinite)
    ? warn(`${renderTex('\\hat M')} solves ${renderTex('Ax = 0')}, but sends the points to ${renderTex('w = 0')}: it projects them to no pixel at all.`)
    : `<div class="value-block">
      <h3>Reprojection error</h3>
      ${eq(`\\tfrac{1}{n} \\textstyle\\sum_i |\\hat M X_i - (u_i, v_i)| = \\htmlClass{result}{${fmt(mean, 3)}}\\ \\text{px}`)}
      <p class="muted small">largest: ${fmt(Math.max(...errors), 3)} px</p>
    </div>`;
  const matrix = `<div class="value-block">
      <h3>${renderTex('\\hat M')}, scaled to ${renderTex('|(m_{31}, m_{32}, m_{33})| = 1')}</h3>
      ${eq(`\\hat M = ${texSig(rows34(Mhat))},\\quad M = ${texSig(rows34(Mtrue.map((v) => s * v) as Mat34))}`)}
      ${f && f.sign < 0 ? `<p class="muted small">${renderTex('\\hat M')} came out as ${renderTex('-K[R \\mid t]')}; it was negated so that ${renderTex('\\det R = +1')}.</p>` : ''}
    </div>`;
  if (!f) {
    values.innerHTML = `<div class="value-grid">${system}${matrix}${reprojection}${warn(
      `The left 3 × 3 block ${renderTex('Q')} of ${renderTex('\\hat M')} is singular: ${renderTex('\\hat M')} is not ${renderTex('K[R \\mid t]')} of any camera, and ${renderTex('K')}, ${renderTex('R')}, ${renderTex('C')} cannot be recovered.`,
    )}</div>`;
    return;
  }
  const Cerr = Math.hypot(f.C[0] - cam.C[0], f.C[1] - cam.C[1], f.C[2] - cam.C[2]);

  values.innerHTML = `
    <div class="value-grid">
      ${system}
      ${matrix}
      <div class="value-block">
        <h3>Intrinsics from the RQ decomposition</h3>
        ${eq(`\\hat K = \\htmlClass{result}{${texMatrix(rows3(f.K), 1)}},\\quad K = ${texMatrix(rows3(cam.K), 1)}`)}
      </div>
      <div class="value-block">
        <h3>Extrinsics</h3>
        ${eq(`\\hat R = ${texMatrix(rows3(f.R), 3)},\\quad R = ${texMatrix(rows3(cam.R), 3)}`)}
        <p class="muted small">rotation between ${renderTex('\\hat R')} and ${renderTex('R')}: ${fmt(rotationError(f.R, cam.R), 3)}°</p>
        ${eq(`\\hat t = \\hat K^{-1} m_4 = ${texVector(f.t, 3)},\\quad t = ${texVector(cam.t, 3)}`)}
      </div>
      <div class="value-block">
        <h3>Camera center</h3>
        ${eq(`\\hat C = -Q^{-1} m_4 = \\htmlClass{result}{${texVector(f.C, 3)}},\\quad C = ${texVector(cam.C, 3)}`)}
        <p class="muted small">${renderTex('|\\hat C - C|')} = ${fmt(Cerr * 1000, 1)} mm</p>
      </div>
      ${reprojection}
    </div>`;
}

ui.on('change', schedule);
onThemeChange(schedule);
update();
