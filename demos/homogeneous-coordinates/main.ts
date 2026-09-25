import { Pane } from 'tweakpane';
import { type Vec3, dot, norm } from '../../src/shared/linalg';
import { eq, fmt, renderTex, texTuple, texVector } from '../../src/shared/tex';
import { initPage } from '../../src/shared/page';
import { type Intersection, type Vec2, intersect, lineThrough, parallelThrough, scaleH, toHomogeneous } from './homogeneous';
import { PLANE, POINT_NAMES, PlaneView } from './planeView';
import { RayView } from './rayView';
import '../../src/shared/styles/demo.css';
import './homogeneous.css';

initPage({ title: 'Homogeneous coordinates', chapterId: 'cameras-optics-perspective' });

const Q_INDEX = 4;

function defaults() {
  return {
    p1: { x: -1.6, y: 0.9 },
    p2: { x: 0.6, y: -0.2 },
    p3: { x: -1.2, y: -1.1 },
    p4: { x: 1.4, y: 0.6 },
    k: 1.6,
    scaled: 1,
    showPlanes: true,
    showRays: true,
  };
}

const state = defaults();
type PointKey = 'p1' | 'p2' | 'p3' | 'p4';
const pointKeys: PointKey[] = ['p1', 'p2', 'p3', 'p4'];

const planeView = new PlaneView(document.getElementById('plane-view')!, (i, [x, y]) => {
  state[pointKeys[i]] = { x, y };
  pane.refresh();
  update();
});
const rayView = new RayView(document.getElementById('ray-view')!);
const values = document.getElementById('values')!;

function points(): Vec2[] {
  return pointKeys.map((key) => [state[key].x, state[key].y]);
}

function update(): void {
  const pts = points();
  const l1 = lineThrough(pts[0], pts[1]);
  const l2 = lineThrough(pts[2], pts[3]);
  const hit = intersect(l1, l2);
  const base = state.scaled === Q_INDEX ? hit.q : toHomogeneous(pts[state.scaled]);
  const scaled = scaleH(base, state.k);

  planeView.render({ points: pts, l1, l2, hit });
  rayView.update({ points: pts, l1, l2, hit, scaled, showPlanes: state.showPlanes, showRays: state.showRays });
  renderValues(pts, l1, l2, hit, base, scaled);
}

const TEX_POINTS = ['p_1', 'p_2', 'p_3', 'p_4'];

function lineEquation([a, b, c]: Vec3): string {
  const term = (v: number, s: string) => `${v < 0 ? '-' : '+'} ${fmt(Math.abs(v), 2)}${s}`;
  return `${fmt(a, 2)}\\,x ${term(b, '\\,y')} ${term(c, '')} = 0`;
}

function describeLine(index: 1 | 2, l: Vec3, p: Vec2): string {
  const [from, to] = index === 1 ? ['p_1', 'p_2'] : ['p_3', 'p_4'];
  const name = `\\htmlClass{line-${index}}{l_${index}}`;
  if (norm(l) === 0) {
    return `<p class="warn">${renderTex(`${from} = ${to}`)}: two equal points do not define a line.</p>`;
  }
  return [
    eq(`${name} = ${from} \\times ${to} = ${texVector(l, 2)}`),
    eq(`${lineEquation(l)}, \\qquad ${from} \\cdot ${name} = ${fmt(dot(toHomogeneous(p), l), 3)}`),
  ].join('');
}

function describeIntersection(hit: Intersection): string {
  const head = `q = l_1 \\times l_2 = ${texVector(hit.q, 2)}`;
  if (hit.kind === 'point') {
    return eq(`${head} \;\\to\; \\left(\\frac{x}{w}, \\frac{y}{w}\\right) = \\htmlClass{result}{${texTuple(hit.p, 3)}}`);
  }
  if (hit.kind === 'infinity') {
    return [
      eq(head),
      `<p class="warn">${renderTex('w = 0')}: the lines are parallel and meet at the point at infinity in direction ${renderTex(texTuple(hit.direction, 3))}.</p>`,
    ].join('');
  }
  return [eq(head), `<p class="warn">${renderTex('q = (0, 0, 0)')} is not a point: the two lines are the same.</p>`].join('');
}

function describeScaling(base: Vec3, scaled: Vec3): string {
  const name = state.scaled === Q_INDEX ? 'q' : TEX_POINTS[state.scaled];
  const head = `k \\, ${name} = ${fmt(state.k, 2)} \\cdot ${texVector(base, 2)} = ${texVector(scaled, 2)}`;
  if (state.k === 0) {
    return [eq(head), `<p class="warn">${renderTex('k = 0')} gives ${renderTex('(0, 0, 0)')}, which is not a point. ${renderTex('k')} must be non-zero.</p>`].join('');
  }
  if (Math.abs(base[2]) < 1e-12) {
    return [eq(head), `<p class="muted small">${renderTex('w')} stays 0: the scaled vector is the same point at infinity.</p>`].join('');
  }
  return eq(
    `${head} \;\\to\; \\left(\\frac{kx}{kw}, \\frac{ky}{kw}\\right) = \\htmlClass{result}{${texTuple([scaled[0] / scaled[2], scaled[1] / scaled[2]], 3)}}`,
  );
}

function renderValues(pts: Vec2[], l1: Vec3, l2: Vec3, hit: Intersection, base: Vec3, scaled: Vec3): void {
  values.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <h3>Points ${renderTex('p = (x, y, 1)')}</h3>
        ${eq(pts.map((p, i) => `${TEX_POINTS[i]} = ${texVector(toHomogeneous(p), 2)}`).join(',\\quad '))}
      </div>
      <div class="value-block">
        <h3>Lines ${renderTex('l = (a, b, c)')} with ${renderTex('ax + by + c = 0')}</h3>
        ${describeLine(1, l1, pts[0])}
        ${describeLine(2, l2, pts[2])}
      </div>
      <div class="value-block">
        <h3>Intersection</h3>
        ${describeIntersection(hit)}
      </div>
      <div class="value-block">
        <h3>Scale invariance</h3>
        ${describeScaling(base, scaled)}
      </div>
    </div>`;
}

const pane = new Pane({ container: document.getElementById('controls')!, title: 'Homogeneous coordinates' });

const pointsFolder = pane.addFolder({ title: 'Points on the plane w = 1' });
pointKeys.forEach((key, i) => {
  pointsFolder.addBinding(state, key, {
    label: POINT_NAMES[i],
    x: { min: PLANE.xMin, max: PLANE.xMax, step: 0.01 },
    y: { min: PLANE.yMin, max: PLANE.yMax, step: 0.01 },
  });
});
pointsFolder.addButton({ title: 'Make l₂ parallel to l₁' }).on('click', () => {
  const pts = points();
  const [x, y] = parallelThrough(pts[0], pts[1], pts[2], pts[3], PLANE);
  state.p4 = { x, y };
  pane.refresh();
  update();
});

const scaleFolder = pane.addFolder({ title: 'Scale invariance' });
scaleFolder.addBinding(state, 'scaled', {
  label: 'vector',
  options: { ...Object.fromEntries(POINT_NAMES.map((name, i) => [name, i])), q: Q_INDEX },
});
scaleFolder.addBinding(state, 'k', { label: 'k', min: -1, max: 2, step: 0.05 });

const display = pane.addFolder({ title: 'Display' });
display.addBinding(state, 'showPlanes', { label: 'line planes' });
display.addBinding(state, 'showRays', { label: 'point rays' });

pane.addButton({ title: 'Reset' }).on('click', () => {
  Object.assign(state, defaults());
  pane.refresh();
  update();
});

pane.on('change', update);
update();
