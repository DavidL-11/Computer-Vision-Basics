import { buildP, buildT } from '../../src/shared/camera';
import { Controls } from '../../src/shared/controls';
import { epipolarLine, epipolarLineT, twoView } from '../../src/shared/epipolar';
import type { Mat3, Vec3 } from '../../src/shared/linalg';
import { initPage } from '../../src/shared/page';
import { perFrame } from '../../src/shared/pixelView';
import { eq, fmt, texMatrix, texTuple } from '../../src/shared/tex';
import { onThemeChange } from '../../src/shared/theme';
import { type PairImage, PairView } from './pairView';
import { type Vec2, applyH, cameras, fixationDistance, projectTo, rectifyingHomography, rectifyingRotation } from './rectify';
import { EDGES, EYE_HEIGHT, GROUND, IMAGE_HEIGHT, IMAGE_WIDTH, INTRINSICS, POINTS } from './scene';
import { TopView } from './topView';
import '../../src/shared/styles/demo.css';
import './rectification.css';

initPage({ title: 'Rectification', chapterId: 'stereo' });

const COLORS = { nearer: '--viz-points', farther: '--accent', zero: '--viz-highlight' };

const defaults = () => ({
  c: 0.4,
  theta: 10,
  lines: 'selected',
  selected: POINTS.findIndex((p) => p[0] === -3 && p[2] === 3),
});
const state = defaults();

const ui = new Controls();
ui.toolbar().addResetButton(() => {
  Object.assign(state, defaults());
  ui.refresh();
  schedule();
});
const top = ui.panel('top-view');
top.addBinding(state, 'c', { label: 'baseline c (m)', min: 0.1, max: 1, step: 0.01 });
top.addBinding(state, 'theta', { label: 'vergence angle θ (°)', min: 0, max: 30, step: 0.5 });
ui.panel('original-view').addBinding(state, 'lines', { label: 'epipolar lines', options: { 'selected point': 'selected', 'all points': 'all' } });

const topView = new TopView(document.getElementById('top-view')!);
const pick = (rectified: boolean) => (image: 0 | 1, uv: Vec2) => {
  const g = geometry();
  let best = -1, bestD = 20;
  POINTS.forEach((X, i) => {
    const p = rectified ? applyH(g.H[image], projectTo(g.cams[image], X).uv) : projectTo(g.cams[image], X).uv;
    const d = Math.hypot(p[0] - uv[0], p[1] - uv[1]);
    if (d < bestD) (bestD = d), (best = i);
  });
  if (best >= 0) {
    state.selected = best;
    schedule();
  }
};
const originalView = new PairView(document.getElementById('original-view')!, pick(false));
const rectifiedView = new PairView(document.getElementById('rectified-view')!, pick(true));
const values = document.getElementById('values')!;

function geometry() {
  const cams = cameras(INTRINSICS, state.c, state.theta, EYE_HEIGHT);
  const Rrect = rectifyingRotation(cams[0], cams[1]);
  const H = cams.map((c) => rectifyingHomography(c, Rrect)) as [Mat3, Mat3];
  // The rectified cameras: same centers and intrinsics, common orientation.
  const rect = cams.map((c) => ({ K: c.K, R: Rrect, C: c.C, P: buildP(c.K, Rrect, buildT(Rrect, c.C)) }));
  return { cams, Rrect, H, rect, F: twoView(cams[0].P, cams[1].P).F, Frect: twoView(rect[0].P, rect[1].P).F };
}

const corners: Vec2[] = [
  [0, 0],
  [IMAGE_WIDTH, 0],
  [IMAGE_WIDTH, IMAGE_HEIGHT],
  [0, IMAGE_HEIGHT],
];

function update(): void {
  const g = geometry();
  const D = fixationDistance(state.c, state.theta);
  const fixation: Vec3 | null = Number.isFinite(D) ? [0, D, EYE_HEIGHT] : null;
  const disparity = (X: Vec3) => projectTo(g.cams[0], X).uv[0] - projectTo(g.cams[1], X).uv[0];
  const color = (X: Vec3) => {
    const d = disparity(X);
    return Math.abs(d) < 0.5 ? COLORS.zero : d > 0 ? COLORS.nearer : COLORS.farther;
  };
  const points = POINTS.map((X) => ({ X, color: color(X) }));
  const sel = POINTS[state.selected];
  const xL = projectTo(g.cams[0], sel).uv, xR = projectTo(g.cams[1], sel).uv;
  const rL = applyH(g.H[0], xL), rR = applyH(g.H[1], xR);
  const all = state.lines === 'all';

  topView.render({
    c: state.c,
    theta: state.theta,
    D,
    halfFov: Math.atan(IMAGE_WIDTH / (2 * INTRINSICS.fx)),
    points: POINTS.map((X, i) => ({ X: [X[0], X[1]], color: points[i].color })),
    selected: state.selected,
  });

  const originals: [PairImage, PairImage] = [
    { cam: g.cams[0], frame: corners, epipolar: epipolarLineT(g.F, xR) },
    { cam: g.cams[1], frame: corners, epipolar: epipolarLine(g.F, xL) },
  ];
  originalView.render({
    images: originals,
    box: { u0: 0, u1: IMAGE_WIDTH, v0: 0, v1: IMAGE_HEIGHT },
    ground: GROUND,
    edges: EDGES,
    points,
    selected: state.selected,
    row: xL[1],
    lines: all
      ? [POINTS.map((X) => epipolarLineT(g.F, projectTo(g.cams[1], X).uv)), POINTS.map((X) => epipolarLine(g.F, projectTo(g.cams[0], X).uv))]
      : [[], []],
    fixation,
  });

  const frames = g.H.map((H) => corners.map((p) => applyH(H, p)));
  const us = frames.flat().map((p) => p[0]), vs = frames.flat().map((p) => p[1]);
  const margin = 10;
  const rectified: [PairImage, PairImage] = [
    { cam: g.rect[0], frame: frames[0], epipolar: epipolarLineT(g.Frect, rR) },
    { cam: g.rect[1], frame: frames[1], epipolar: epipolarLine(g.Frect, rL) },
  ];
  rectifiedView.render({
    images: rectified,
    box: { u0: Math.min(...us) - margin, u1: Math.max(...us) + margin, v0: Math.min(...vs) - margin, v1: Math.max(...vs) + margin },
    ground: GROUND,
    edges: EDGES,
    points,
    selected: state.selected,
    row: rL[1],
    lines: all ? [POINTS.map((X) => epipolarLineT(g.Frect, applyH(g.H[1], projectTo(g.cams[1], X).uv))), POINTS.map((X) => epipolarLine(g.Frect, applyH(g.H[0], projectTo(g.cams[0], X).uv)))] : [[], []],
    fixation,
  });

  renderValues(g, D, sel, xL, xR, rL, rR);
}
const schedule = perFrame(update);

function renderValues(g: ReturnType<typeof geometry>, D: number, X: Vec3, xL: Vec2, xR: Vec2, rL: Vec2, rR: Vec2): void {
  const d = xL[0] - xR[0];
  const where = Math.abs(d) < 0.5 ? 'at the distance of the fixation point' : d > 0 ? 'nearer than the fixation point' : 'farther than the fixation point';
  const depth = X[1];
  values.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <h3>Vergence</h3>
        ${eq(Number.isFinite(D) ? `D = \\frac{c}{2 \\tan(\\theta / 2)} = \\frac{${fmt(state.c, 2)}}{2 \\tan(${fmt(state.theta / 2, 2)}^\\circ)} = \\htmlClass{result}{${fmt(D, 2)}}\\ \\text{m}` : `\\theta = 0:\\ \\text{parallel axes, fixation at infinity}`)}
        ${eq(`H_L = K R_\\text{rect} R_L^\\top K^{-1} = ${texMatrix(chunk(g.H[0]), 3)}`)}
      </div>
      <div class="value-block">
        <h3>Selected point ${texTupleText(X)}</h3>
        ${eq(`\\text{original: } \\mathbf{x}_L = ${texTuple(xL, 1)},\\ \\mathbf{x}_R = ${texTuple(xR, 1)}`)}
        ${eq(`d = x_L - x_R = \\htmlClass{result}{${fmt(d, 1)}}\\ \\text{px},\\quad y_L - y_R = ${fmt(xL[1] - xR[1], 1)}\\ \\text{px}`)}
        <p class="small">${d > 0.5 ? 'Positive' : d < -0.5 ? 'Negative' : 'Zero'} disparity: the point is ${where}.</p>
        ${eq(`\\text{rectified: } \\mathbf{x}_L = ${texTuple(rL, 1)},\\ \\mathbf{x}_R = ${texTuple(rR, 1)}`)}
        ${eq(`d = ${fmt(rL[0] - rR[0], 1)}\\ \\text{px} = \\frac{f\\,c}{Z} = \\frac{${fmt(INTRINSICS.fx, 0)} \\cdot ${fmt(state.c, 2)}}{${fmt(depth, 2)}},\\quad y_L - y_R = ${fmt(rL[1] - rR[1], 1)}\\ \\text{px}`)}
      </div>
    </div>`;
}

const chunk = (m: Mat3) => [m.slice(0, 3), m.slice(3, 6), m.slice(6, 9)];
const texTupleText = (v: Vec3) => `(${v.map((x) => fmt(x, 1)).join(', ')})`;

ui.on('change', schedule);
onThemeChange(schedule);
update();
