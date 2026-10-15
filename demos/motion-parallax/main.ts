import { buildK, buildR } from '../../src/shared/camera';
import { Controls } from '../../src/shared/controls';
import type { Vec3 } from '../../src/shared/linalg';
import { initPage } from '../../src/shared/page';
import { perFrame } from '../../src/shared/pixelView';
import { Plot, ticks } from '../../src/shared/plot';
import { eq, fmt, renderTex, texTuple } from '../../src/shared/tex';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import { type Motion, type Pose, type Vec2, deltaRotation, depthFromFlow, focusOfExpansion, nextPose, pointFlow, toCamera } from './egomotion';
import { type Arrow, ImageView, KIND_COLORS } from './imageView';
import { IMAGE_HEIGHT, IMAGE_WIDTH, INTRINSICS, type Kind, POINTS } from './scene';
import { WorldView } from './worldView';
import '../../src/shared/styles/demo.css';
import './motion-parallax.css';

initPage({ title: 'Motion parallax & focus of expansion', chapterId: 'dense-motion' });

const K = buildK(INTRINSICS);
const f = INTRINSICS.fx;
/** Points closer than this (in m, along the optical axis) are left out. */
const NEAR = 0.5;
/** The animation starts over after this many frames. */
const LOOP = 40;
/** Frames of the camera path drawn in the 3D view. */
const PATH = 30;

type Show = 'total' | 'translation' | 'rotation';

interface Preset {
  height: number;
  pitch: number;
  T: { x: number; y: number; z: number };
  pan: number;
  tilt: number;
  roll: number;
}
const level = (T: Preset['T'], pan = 0): Preset => ({ height: 1.6, pitch: 0, T, pan, tilt: 0, roll: 0 });
/** The translation is given in the camera frame, so with pitch 0 these move parallel to the ground. */
const PRESETS: Record<string, Preset> = {
  forward: level({ x: 0, y: 0, z: 0.4 }),
  landing: { height: 6, pitch: -14, T: { x: 0, y: 0, z: 0.5 }, pan: 0, tilt: 0, roll: 0 },
  sideways: level({ x: 0.3, y: 0, z: 0 }),
  diagonal: level({ x: 0.25, y: 0, z: 0.3 }),
  'pan only': level({ x: 0, y: 0, z: 0 }, 1),
  'forward + pan': level({ x: 0, y: 0, z: 0.4 }, 1),
};
const PRESET_LABELS: Record<string, string> = {
  'walking forward': 'forward',
  'landing approach': 'landing',
  'sideways (train window)': 'sideways',
  'forward and sideways': 'diagonal',
  'pan only': 'pan only',
  'forward + pan': 'forward + pan',
};

/** The first point of the second post, about 1.2 m above the ground. */
const DEFAULT_POINT = POINTS.findIndex((p) => p.kind === 'post' && p.X[1] === 8 && Math.abs(p.X[2] - 1.2) < 1e-6);

const defaults = () => ({
  preset: 'forward',
  yaw: 0,
  ...structuredClone(PRESETS.forward),
  show: 'total' as Show,
  scale: 3,
  selected: DEFAULT_POINT,
});
const state = defaults();
let frame = 0;

const ui = new Controls();
const toolbar = ui.toolbar();
toolbar.addBinding(state, 'preset', { label: 'motion', options: PRESET_LABELS, view: 'select' }).on('change', ({ value }) => {
  stop();
  frame = 0;
  Object.assign(state, structuredClone(PRESETS[value]));
  ui.refresh();
});
const playButton = toolbar.addButton({ title: 'Play', primary: true, icon: 'play' });
playButton.on('click', () => (timer ? stop() : play()));
toolbar.addResetButton(() => {
  stop();
  frame = 0;
  Object.assign(state, defaults());
  ui.refresh();
  schedule();
});

const world = ui.panel('world-view');
world.addBinding(state, 'height', { label: 'camera height (m)', min: 0.5, max: 10, step: 0.1 });
world.addBinding(state, 'yaw', { label: 'heading (°)', min: -60, max: 60, step: 1 });
world.addBinding(state, 'pitch', { label: 'pitch (°)', min: -40, max: 20, step: 1 });
const motion = world.addFolder({ title: 'Motion per frame' });
const meters = { min: -0.6, max: 0.6, step: 0.01 };
motion.addBinding(state, 'T', { label: 'translation T (m)', x: meters, y: meters, z: meters });
const degrees = { min: -2, max: 2, step: 0.05 };
motion.addBinding(state, 'pan', { label: 'pan (°)', ...degrees });
motion.addBinding(state, 'tilt', { label: 'tilt (°)', ...degrees });
motion.addBinding(state, 'roll', { label: 'roll (°)', ...degrees });

const image = ui.panel('image-view');
image.addBinding(state, 'show', { label: 'flow', options: { total: 'total', 'translation only': 'translation', 'rotation only': 'rotation' }, view: 'select' });
image.addBinding(state, 'scale', { label: 'arrow length ×', min: 1, max: 10, step: 0.5 });

let timer = 0;
function play(): void {
  stop();
  ui.playing(true, 'image-view');
  playButton.title = 'Stop';
  playButton.icon = 'stop';
  timer = window.setInterval(() => {
    frame = (frame + 1) % LOOP;
    schedule();
  }, 100);
}
function stop(): void {
  if (!timer) return;
  window.clearInterval(timer);
  timer = 0;
  ui.playing(false);
  playButton.title = 'Play';
  playButton.icon = 'play';
}

const worldView = new WorldView(document.getElementById('world-view')!);
const imageView = new ImageView(document.getElementById('image-view')!, (x, y) => {
  let best = -1, bestD = 20;
  for (const v of visible) {
    const d = Math.hypot(v.flow.x0[0] - x, v.flow.x0[1] - y);
    if (d < bestD) (bestD = d), (best = v.index);
  }
  if (best >= 0) {
    state.selected = best;
    schedule();
  }
});
const plot = new Plot(document.getElementById('parallax-plot')!, 260);
const values = document.getElementById('values')!;

const motionOf = (): Motion => ({ T: [state.T.x, state.T.y, state.T.z], pan: state.pan, tilt: state.tilt, roll: state.roll });
const startPose = (): Pose => ({ R: buildR(state.yaw, state.pitch, 0), C: [0, 0, state.height] });

interface Visible {
  index: number;
  kind: Kind;
  flow: ReturnType<typeof pointFlow>;
  d: Vec2;
}
let visible: Visible[] = [];

const inImage = ([u, v]: Vec2) => u >= 0 && v >= 0 && u <= IMAGE_WIDTH && v <= IMAGE_HEIGHT;

function shown(fl: ReturnType<typeof pointFlow>): Vec2 {
  const to = state.show === 'total' ? fl.x1 : state.show === 'translation' ? fl.xT : fl.xR;
  return [to[0] - fl.x0[0], to[1] - fl.x0[1]];
}

function update(): void {
  const m = motionOf();
  let pose = startPose();
  for (let k = 0; k < frame; k++) pose = nextPose(pose, m);

  visible = [];
  POINTS.forEach((p, index) => {
    const Xc = toCamera(pose, p.X);
    if (Xc[2] < NEAR) return;
    const fl = pointFlow(K, Xc, m);
    if (fl.Z1 < NEAR || !inImage(fl.x0)) return;
    visible.push({ index, kind: p.kind, flow: fl, d: shown(fl) });
  });
  const sel = visible.find((v) => v.index === state.selected) ?? null;

  const e = state.show === 'rotation' ? null : focusOfExpansion(K, m.T);
  const arrows: Arrow[] = visible.map((v) => ({ kind: v.kind, from: v.flow.x0, d: v.d }));
  imageView.render({ K, pose, arrows, scale: state.scale, foe: e && { at: e, expansion: m.T[2] > 0 }, selected: sel?.flow.x0 ?? null });

  const path: Vec3[] = [pose.C];
  for (let k = 0, p = pose; k < PATH; k++) path.push((p = nextPose(p, m)).C);
  worldView.update(K, pose, path, POINTS[state.selected]?.X ?? null);

  drawPlot(m, sel);
  renderValues(m, sel, e);
}
const schedule = perFrame(update);

/** ‖Δx‖ over the inverse depth 1/Z: for sideways motion, a straight line through 0 with slope f ‖(T_x, T_y)‖. */
function drawPlot(m: Motion, sel: Visible | null): void {
  const len = (v: Visible) => Math.hypot(...v.d);
  const yMax = Math.max(4, ...visible.map(len)) * 1.08;
  const xMax = Math.min(1, Math.max(0.1, ...visible.map((v) => 1 / v.flow.Z0)) * 1.05);
  const slope = f * Math.hypot(m.T[0], m.T[1]);
  plot.render({ x: [0, xMax], y: [0, yMax] }, (fr) => {
    fr.grid(ticks(0, xMax, 6), ticks(0, yMax, 5), { x: (v) => fmt(v, 2) });
    if (state.show !== 'rotation' && slope > 0) fr.line((x) => slope * x, '--fg-muted', { dash: [6, 4] });
    const { ctx } = fr;
    for (const kind of ['ground', 'post', 'far'] as Kind[]) {
      ctx.fillStyle = cssColor(KIND_COLORS[kind]);
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      for (const v of visible) {
        if (v.kind !== kind || 1 / v.flow.Z0 > xMax) continue;
        ctx.moveTo(fr.X(1 / v.flow.Z0) + 2.5, fr.Y(len(v)));
        ctx.arc(fr.X(1 / v.flow.Z0), fr.Y(len(v)), 2.5, 0, 2 * Math.PI);
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (sel && 1 / sel.flow.Z0 <= xMax) {
      ctx.strokeStyle = cssColor('--viz-highlight');
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(fr.X(1 / sel.flow.Z0), fr.Y(len(sel)), 6, 0, 2 * Math.PI);
      ctx.stroke();
    }
  });
}

function renderValues(m: Motion, sel: Visible | null, e: Vec2 | null): void {
  const [Tx, Ty, Tz] = m.T;
  let foe: string;
  if (state.show === 'rotation') foe = '<p class="small">A rotation alone has no focus of expansion: its flow does not depend on depth.</p>';
  else if (!e)
    foe =
      Tx || Ty
        ? `<p class="small">${renderTex('T_z = 0')}: the focus of expansion is a point at infinity. All translational flow is parallel to ${renderTex('-(T_x, T_y)')}, with length ${renderTex('f\\,\\|(T_x, T_y)\\| / Z')}.</p>`
        : '<p class="small">No translation: no focus of expansion and no parallax.</p>';
  else
    foe = `${eq(`\\mathbf{e} = \\frac{K\\,\\mathbf{T}}{T_z} = \\htmlClass{result}{${texTuple(e, 1)}}`)}<p class="small">${Tz > 0 ? 'Moving forward: the translational flow points away from e (expansion).' : 'Moving backward: the translational flow points towards e (contraction).'}${
      m.pan || m.tilt || m.roll ? ' With the rotation added, the total flow no longer radiates from e.' : ''
    }</p>`;

  let point = '<p class="small">Click a point in the camera image.</p>';
  if (sel) {
    const fl = sel.flow;
    const total: Vec2 = [fl.x1[0] - fl.x0[0], fl.x1[1] - fl.x0[1]];
    const tr: Vec2 = [fl.xT[0] - fl.x0[0], fl.xT[1] - fl.x0[1]];
    const rot: Vec2 = [fl.xR[0] - fl.x0[0], fl.xR[1] - fl.x0[1]];
    const rotating = m.pan || m.tilt || m.roll;
    const zIgnoring = depthFromFlow(K, fl.x0, fl.x1, m.T);
    const zKnown = depthFromFlow(K, fl.x0, fl.x1, m.T, deltaRotation(m));
    const z = (v: number) => (Number.isFinite(v) ? `${fmt(v, 2)}\\ \\text{m}` : '\\text{no parallax}');
    point = `
      ${eq(`\\mathbf{X} = ${texTuple(POINTS[sel.index].X, 1)},\\quad Z = ${fmt(fl.Z0, 2)}\\ \\text{m}`)}
      ${eq(`\\mathbf{x}_0 = ${texTuple(fl.x0, 1)},\\quad \\mathbf{x}_1 = ${texTuple(fl.x1, 1)}`)}
      ${eq(`\\mathbf{x}_1 - \\mathbf{x}_0 = ${texTuple(total, 2)} \\approx \\underbrace{${texTuple(tr, 2)}}_{\\text{translation}} + \\underbrace{${texTuple(rot, 2)}}_{\\text{rotation}}`)}
      ${eq(`\\text{depth from the flow: } \\hat Z = \\htmlClass{result}{${z(zKnown)}}${rotating ? `,\\quad \\text{ignoring the rotation: } ${z(zIgnoring)}` : ''}`)}`;
  }

  values.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <h3>Camera motion per frame</h3>
        ${eq(`\\mathbf{T} = ${texTuple(m.T, 2)}\\ \\text{m},\\quad (\\text{pan}, \\text{tilt}, \\text{roll}) = ${texTuple([m.pan, m.tilt, m.roll], 2)}^\\circ`)}
        ${foe}
      </div>
      <div class="value-block">
        <h3>Selected point</h3>
        ${point}
      </div>
    </div>`;
}

ui.on('change', schedule);
onThemeChange(schedule);
update();
