import { Pane } from 'tweakpane';
import { type CameraSnapshot, project, snapshot } from '../../src/shared/camera';
import { type Vec3, dot, norm } from '../../src/shared/linalg';
import { initPage } from '../../src/shared/page';
import { perFrame } from '../../src/shared/pixelView';
import { eq, fmt, renderTex, texTuple, texVector } from '../../src/shared/tex';
import { ImageView } from './imageView';
import { EDGES, FAMILIES, type FamilyKey, IMAGE_HEIGHT, IMAGE_WIDTH } from './scene';
import { horizon, intersect, lineThrough, normalizeLine, toCartesian, vanishingLine, vanishingPoint } from './vanishing';
import { WorldView } from './worldView';
import '../../src/shared/styles/demo.css';
import './vanishing-points.css';

initPage({ title: 'Vanishing points & horizon', chapterId: 'cameras-optics-perspective' });

function defaults() {
  return {
    height: 1.6,
    yaw: 20,
    pitch: -8,
    roll: 0,
    f: 500,
    families: { x: true, y: true, z: true, ramp: true } as Record<FamilyKey, boolean>,
    showHorizon: true,
    showExtensions: true,
    directionRays: true,
    zoomOut: 2,
    check: 'y' as FamilyKey,
  };
}
const state = defaults();

const pane = new Pane({ container: document.getElementById('controls')!, title: 'Camera' });
const presets = pane.addFolder({ title: 'Presets' });
const preset = (pose: { yaw: number; pitch: number; roll?: number; height?: number }) => () => {
  Object.assign(state, { roll: 0, height: 1.6 }, pose);
  pane.refresh();
  schedule();
};
presets.addButton({ title: 'One-point perspective' }).on('click', preset({ yaw: 0, pitch: 0 }));
presets.addButton({ title: 'Two-point perspective' }).on('click', preset({ yaw: 35, pitch: 0 }));
presets.addButton({ title: 'Three-point perspective' }).on('click', preset({ yaw: 35, pitch: 25, height: 0.5 }));

const pose = pane.addFolder({ title: 'Pose' });
pose.addBinding(state, 'height', { label: 'height [m]', min: 0.2, max: 8, step: 0.05 });
pose.addBinding(state, 'yaw', { label: 'yaw [°]', min: -60, max: 60, step: 0.5 });
pose.addBinding(state, 'pitch', { label: 'pitch [°]', min: -60, max: 60, step: 0.5 });
pose.addBinding(state, 'roll', { label: 'roll [°]', min: -45, max: 45, step: 0.5 });
pane.addFolder({ title: 'Intrinsics' }).addBinding(state, 'f', { label: 'f [px]', min: 150, max: 1200, step: 1 });

const display = pane.addFolder({ title: 'Display' });
for (const f of FAMILIES) display.addBinding(state.families, f.key, { label: f.name });
display.addBinding(state, 'showHorizon', { label: 'horizon' });
display.addBinding(state, 'showExtensions', { label: 'extend lines' });
display.addBinding(state, 'directionRays', { label: 'rays from C (3D)' });
display.addBinding(state, 'zoomOut', { label: 'zoom out', min: 1, max: 6, step: 0.1 });
display.addBinding(state, 'check', {
  label: 'check family',
  options: Object.fromEntries(FAMILIES.map((f) => [f.name, f.key])),
});

pane.addButton({ title: 'Reset' }).on('click', () => {
  Object.assign(state, defaults());
  pane.refresh();
  schedule();
});

const worldView = new WorldView(document.getElementById('world-view')!);
const imageView = new ImageView(document.getElementById('image-view')!);
const values = document.getElementById('values')!;

function update(): void {
  const cam = snapshot(
    { fx: state.f, fy: state.f, u0: IMAGE_WIDTH / 2, v0: IMAGE_HEIGHT / 2, skew: 0 },
    { C: [0, 0, state.height], yaw: state.yaw, pitch: state.pitch, roll: state.roll },
  );
  const vps = Object.fromEntries(FAMILIES.map((f) => [f.key, vanishingPoint(cam.K, cam.R, f.d)])) as Record<FamilyKey, Vec3>;
  const h = horizon(cam.K, cam.R);
  const rampLine = vanishingLine(cam.K, cam.R, [1, 0, 0], FAMILIES[3].d);

  worldView.update(cam, { families: state.families, directionRays: state.directionRays });
  imageView.render(
    { cam, vps, horizon: h, rampLine },
    {
      zoomOut: state.zoomOut,
      families: state.families,
      showHorizon: state.showHorizon,
      showExtensions: state.showExtensions,
    },
  );
  renderValues(cam, vps, h);
}
const schedule = perFrame(update);

/** Scales a homogeneous point for display so that its largest entry is 1 in magnitude. */
const unit = (p: Vec3): Vec3 => {
  const m = Math.max(...p.map(Math.abs));
  return m === 0 ? p : (p.map((x) => x / m) as Vec3);
};

/** The image direction (x, y) of a point at infinity, as a unit vector. */
const direction = (p: Vec3): Vec3 => [p[0] / Math.hypot(p[0], p[1]), p[1] / Math.hypot(p[0], p[1]), 0];

function pointText(p: Vec3): string {
  const c = toCartesian(p);
  return c ? `(u, v) = ${texTuple(c, 1)}` : `w = 0: \\text{at infinity in direction } ${texTuple(direction(p).slice(0, 2), 3)}`;
}

function checkBlock(cam: CameraSnapshot, v: Vec3): string {
  const family = FAMILIES.find((f) => f.key === state.check)!;
  const imagePoint = (X: Vec3): Vec3 | null => {
    const p = project(cam.K, cam.R, cam.t, X);
    return p.inFront ? [p.uv[0], p.uv[1], 1] : null;
  };
  const lines = EDGES.filter((e) => e.family === family.key)
    .map((e) => [imagePoint(e.a), imagePoint(e.b)])
    .filter((pq): pq is [Vec3, Vec3] => pq[0] !== null && pq[1] !== null)
    .slice(0, 2)
    .map(([p, q]) => normalizeLine(lineThrough(p, q)));
  if (lines.length < 2) return '<p class="muted small">Fewer than two edges of this family are in front of the camera.</p>';
  const q = intersect(lines[0], lines[1]);
  const cosine = Math.abs(dot(q, v)) / (norm(q) * norm(v));
  return `
    ${eq(`l_1 = p_1 \\times q_1 = ${texVector(lines[0], 3)}, \\quad l_2 = p_2 \\times q_2 = ${texVector(lines[1], 3)}`)}
    ${eq(`l_1 \\times l_2 \\propto ${texVector(unit(q), 4)}, \\qquad K R d_{${family.tex}} \\propto ${texVector(unit(v), 4)}`)}
    <p class="muted small">
      Two edges of the family, projected to the image. Their lines meet at the vanishing point
      (${renderTex(`\\cos\\angle = ${fmt(cosine, 6)}`)} between the two vectors: equal up to scale).
    </p>`;
}

function renderValues(cam: CameraSnapshot, vps: Record<FamilyKey, Vec3>, h: Vec3): void {
  const l = normalizeLine(h);
  const vpRows = FAMILIES.map(
    (f) =>
      eq(
        `\\htmlClass{family-${f.key}}{v_{${f.tex}}} = K R ${texVector(f.d, 0)} = ${texVector(vps[f.key], 1)} \\;\\Rightarrow\\; ${pointText(vps[f.key])}`,
      ),
  ).join('');
  const onHorizon = FAMILIES.map((f) => {
    const p = toCartesian(vps[f.key]);
    const residual = dot(l, p ? [p[0], p[1], 1] : direction(vps[f.key]));
    return `\\htmlClass{family-${f.key}}{v_{${f.tex}}} \\cdot l = ${fmt(residual, 2)}`;
  }).join(', \\quad ');
  values.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <h3>Vanishing points v = K R d</h3>
        ${vpRows}
      </div>
      <div class="value-block">
        <h3>Horizon: the vanishing line of the ground</h3>
        ${eq(`l = v_X \\times v_Y \\propto ${texVector(l, 3)}`)}
        ${eq(onHorizon)}
        <p class="muted small">
          ${renderTex('v \\cdot l')} is the distance of a vanishing point from the horizon in pixels (for a point at
          infinity: the dot product with its unit direction). Every horizontal direction gives 0.
        </p>
      </div>
      <div class="value-block">
        <h3>Check: intersection of two image lines</h3>
        ${checkBlock(cam, vps[state.check])}
      </div>
    </div>`;
}

pane.on('change', schedule);
update();
