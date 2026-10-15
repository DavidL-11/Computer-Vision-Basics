import { type CameraSnapshot, backproject, lookAtAngles, project, snapshot } from '../../src/shared/camera';
import { Controls } from '../../src/shared/controls';
import { type Vec4, epipolarLine, mulP, toPixel, twoView, unitF } from '../../src/shared/epipolar';
import { type Mat3, type Vec3, add, det3, mulMat3Vec, transpose3 } from '../../src/shared/linalg';
import { type Vec2, normalizeLine, pointLineDistance } from '../../src/shared/lines';
import { matVec } from '../../src/shared/matrix';
import { initPage } from '../../src/shared/page';
import { perFrame } from '../../src/shared/pixelView';
import { eq, fmt, renderTex, sci, texSciMatrix, texVector } from '../../src/shared/tex';
import { onThemeChange } from '../../src/shared/theme';
import { ImageView } from './imageView';
import { C0, CORNERS, IMAGE_HEIGHT, IMAGE_WIDTH, SCENE_CENTER, START_CORNER } from './scene';
import { WorldView } from './worldView';
import '../../src/shared/styles/demo.css';
import './epipolar-geometry.css';

initPage({ title: 'Two-view geometry', chapterId: 'epipolar-geometry' });

const intrinsics = (f: number) => ({ fx: f, fy: f, u0: IMAGE_WIDTH / 2, v0: IMAGE_HEIGHT / 2, skew: 0 });
const look0 = lookAtAngles(C0, SCENE_CENTER);
const camera0 = (f: number) => snapshot(intrinsics(f), { C: C0, yaw: look0.yaw, pitch: look0.pitch, roll: 0 });

/** Camera 1 is offset from camera 0 in camera 0's axes (x right, y down, z forward) and turned about the vertical. */
function center1(right: number, up: number, forward: number): Vec3 {
  return add(C0, mulMat3Vec(transpose3(camera0(1).R), [right, -up, forward]));
}

type Setup = { right: number; up: number; forward: number; turn: number };
const PRESETS: Record<string, () => Setup> = {
  Converging: () => {
    const [right, forward] = [1.6, 1];
    const turn = Math.round(lookAtAngles(center1(right, 0, forward), SCENE_CENTER).yaw - look0.yaw);
    return { right, up: 0, forward, turn };
  },
  Parallel: () => ({ right: 1.2, up: 0, forward: 0, turn: 0 }),
  'Forward motion': () => ({ right: 0, up: 0, forward: 1.5, turn: 0 }),
};

const startDepth = project(camera0(1).K, camera0(1).R, camera0(1).t, START_CORNER).depth;
const startPixel = project(camera0(800).K, camera0(800).R, camera0(800).t, START_CORNER).uv;

const defaults = () => ({
  ...PRESETS.Converging(),
  f0: 800,
  f1: 800,
  u: startPixel[0],
  v: startPixel[1],
  depth: startDepth,
  pencil: false,
  zoomOut: 1.3,
});
const state = defaults();

const ui = new Controls();
const toolbar = ui.toolbar();
const presets = toolbar.addFolder({ title: 'Setup' });
for (const [name, preset] of Object.entries(PRESETS))
  presets.addButton({ title: name }).on('click', () => {
    Object.assign(state, preset());
    ui.refresh();
    schedule();
  });
toolbar.addBinding(state, 'pencil', { label: 'lines of all corners' });
toolbar.addBinding(state, 'zoomOut', { label: 'zoom out', min: 1, max: 4, step: 0.05 });
toolbar.addResetButton(() => {
  Object.assign(state, defaults());
  ui.refresh();
  schedule();
});

const worldControls = ui.panel('world-view');
const cam1Folder = worldControls.addFolder({ title: 'Camera 1, relative to camera 0' });
const meters = (min: number, max: number) => ({ min, max, step: 0.05, format: (v: number) => fmt(v, 2) });
cam1Folder.addBinding(state, 'right', { label: 'right (m)', ...meters(-3, 3) });
cam1Folder.addBinding(state, 'up', { label: 'up (m)', ...meters(-1, 1.5) });
cam1Folder.addBinding(state, 'forward', { label: 'forward (m)', ...meters(-2, 2.5) });
cam1Folder.addBinding(state, 'turn', { label: 'turn left (°)', min: -60, max: 60, step: 1 });
const focal = worldControls.addFolder({ title: 'Focal lengths' });
focal.addBinding(state, 'f0', { label: 'f₀ (px)', min: 400, max: 1400, step: 10 });
focal.addBinding(state, 'f1', { label: 'f₁ (px)', min: 400, max: 1400, step: 10 });
const pointFolder = ui.panel('image0-view').addFolder({ title: 'Point X on the ray of x₀' });
pointFolder.addBinding(state, 'depth', { label: 'depth (m)', min: 0.5, max: 12, step: 0.05, format: (v: number) => fmt(v, 2) });

/** Clicking near a corner of the scene selects it together with its depth, so that X is the corner itself. */
const SNAP = 12;
const imageView0 = new ImageView(document.getElementById('image0-view')!, (u, v) => {
  const cam = cameras()[0];
  let best = SNAP;
  state.u = u;
  state.v = v;
  for (const p of CORNERS) {
    const pr = project(cam.K, cam.R, cam.t, p);
    const d = Math.hypot(pr.uv[0] - u, pr.uv[1] - v);
    if (!pr.inFront || d >= best) continue;
    best = d;
    [state.u, state.v] = pr.uv;
    state.depth = pr.depth;
  }
  ui.refresh();
  schedule();
});
const imageView1 = new ImageView(document.getElementById('image1-view')!);
const worldView = new WorldView(document.getElementById('world-view')!);
const captions = [0, 1].map((i) => document.getElementById(`image${i}-caption`)!);
const values = document.getElementById('values')!;

function cameras(): [CameraSnapshot, CameraSnapshot] {
  const cam1 = snapshot(intrinsics(state.f1), {
    C: center1(state.right, state.up, state.forward),
    yaw: look0.yaw + state.turn,
    pitch: look0.pitch,
    roll: 0,
  });
  return [camera0(state.f0), cam1];
}

function epipoleText(e: Vec3, sub: string): string {
  const p = toPixel(e);
  if (!p) return `e${sub} at infinity`;
  return `e${sub} = (${fmt(p[0], 0)}, ${fmt(p[1], 0)})`;
}

function update(): void {
  const cams = cameras();
  const [cam0, cam1] = cams;
  if (Math.hypot(...cam0.C.map((c, i) => c - cam1.C[i])) < 1e-6) {
    values.innerHTML = `<div class="value-grid"><div class="value-block"><p class="warn">Both cameras are at the same place: there is no baseline, and without it no epipolar geometry.</p></div></div>`;
    return;
  }
  const view = twoView(cam0.P, cam1.P);
  const F = unitF(view.F);
  const Ft = transpose3(F);
  const x0: Vec2 = [state.u, state.v];
  const X = backproject(cam0.K, cam0.R, cam0.t, state.u, state.v, state.depth);
  const x1h = mulP(cam1.P, [...X, 1]);
  const x1 = x1h[2] > 0 ? toPixel(x1h) : null;
  const l1 = epipolarLine(F, x0);
  // Fᵀ x₁ with the homogeneous x₁, which also works when X is behind camera 1.
  const l0 = mulMat3Vec(Ft, x1h);

  const pencil = state.pencil ? CORNERS.map((p) => [mulP(cam0.P, [...p, 1]), mulP(cam1.P, [...p, 1])]) : [];
  imageView0.render({ cam: cam0, sub: '₀', point: x0, line: l0, epipole: view.e0, pencil: pencil.map(([, b]) => mulMat3Vec(Ft, b)), zoomOut: state.zoomOut });
  imageView1.render({ cam: cam1, sub: '₁', point: x1, line: l1, epipole: view.e1, pencil: pencil.map(([a]) => mulMat3Vec(F, a)), zoomOut: state.zoomOut });
  captions[0].textContent = epipoleText(view.e0, '₀');
  captions[1].textContent = `${epipoleText(view.e1, '₁')}${x1 ? '' : '; X is behind camera 1'}`;
  worldView.update({ cams, x0, X, lines: [l0, l1] });
  renderValues(view, F, X, x1, l1);
}
const schedule = perFrame(update);

const rows3 = (M: Mat3) => [M.slice(0, 3), M.slice(3, 6), M.slice(6)];

function texPoint(e: Vec3): string {
  const p = toPixel(e);
  const n = Math.hypot(...e);
  const unit = e.map((v) => v / n);
  return p ? `\\cong ${texVector([...p, 1], 1)}` : `\\cong ${texVector(unit, 3)}\\ \\text{(at infinity)}`;
}

function renderValues(view: ReturnType<typeof twoView>, F: Mat3, X: Vec3, x1: Vec2 | null, l1: Vec3): void {
  const x0: Vec2 = [state.u, state.v];
  const Xplus = matVec(view.P0plus, [state.u, state.v, 1]) as Vec4;
  const Fe0 = mulMat3Vec(F, view.e0).map((v) => v / Math.hypot(...view.e0));
  const l1n = normalizeLine(l1);
  const residual = x1 ? pointLineDistance(l1, x1) : null;
  values.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <h3>Camera centers and epipoles</h3>
        ${eq(`C_0 = \\operatorname{null}(P_0) = ${texVector(view.C0, 2)},\\quad C_1 = ${texVector(view.C1, 2)}`)}
        ${eq(`e_0 = P_0 C_1 ${texPoint(view.e0)},\\quad e_1 = P_1 C_0 ${texPoint(view.e1)}`)}
      </div>
      <div class="value-block">
        <h3>Fundamental matrix, scaled to ${renderTex('\\|F\\| = 1')}</h3>
        ${eq(`F = [e_1]_\\times P_1 P_0^+ = \\htmlClass{result}{${texSciMatrix(rows3(F))}}`)}
        ${eq(`\\det F = ${sci(det3(F))},\\qquad F e_0 = ${texSciMatrix(Fe0.map((v) => [v]))}`)}
      </div>
      <div class="value-block">
        <h3>The selected point</h3>
        ${eq(`x_0 = ${texVector([...x0, 1], 1)},\\quad X^+ = P_0^+ x_0 = ${texSciMatrix(Xplus.map((v) => [v]))}`)}
        ${eq(`X = ${texVector(X, 2)}\\ \\text{at depth}\\ ${fmt(state.depth, 2)}\\ \\text{m},\\quad x_1 = P_1 X ${x1 ? `\\cong ${texVector([...x1, 1], 1)}` : '\\ \\text{(behind camera 1)}'}`)}
      </div>
      <div class="value-block">
        <h3>Epipolar line in image 1</h3>
        ${eq(`l_1 = F x_0 \\cong ${texVector(l1n, 4)}`)}
        <p class="muted small">scaled so that ${renderTex('l_{1,0}^2 + l_{1,1}^2 = 1')}; then ${renderTex('x_1^\\top l_1')} is the distance of ${renderTex('x_1')} from the line in pixels</p>
        ${residual === null ? '' : eq(`x_1^\\top F x_0 = x_1^\\top l_1 = \\htmlClass{result}{${fmt(residual, 6)}}\\ \\text{px}`)}
      </div>
    </div>`;
}

ui.on('change', schedule);
onThemeChange(schedule);
update();
