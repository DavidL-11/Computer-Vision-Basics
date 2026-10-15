import { type Plane, planeToImage, toGray } from '../../src/shared/image';
import { Controls } from '../../src/shared/controls';
import { addImagePicker } from '../../src/shared/imagePicker';
import { gaussianNoise } from '../../src/shared/noise';
import { initPage } from '../../src/shared/page';
import { PixelView, type ViewTransform, perFrame } from '../../src/shared/pixelView';
import { Plot } from '../../src/shared/plot';
import { eq, fmt, renderTex, sci, texTuple } from '../../src/shared/tex';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import { IDENTITY, warp } from '../../src/shared/warp';
import { type Level, type Step, type Window, coarseToFine, errorSurface, levels, windowAt, windowSamples } from './coarseToFine';
import '../../src/shared/styles/demo.css';
import './coarse-to-fine.css';

initPage({ title: 'Coarse-to-fine alignment', chapterId: 'dense-motion' });

const W = 160;
const H = 120;
/** The true shift and the error surfaces cover [−R, R]² pixels of level 0. */
const R = 16;
const MAX_LEVEL = 4;
const EPSILON = 0.01;

const defaults = () => ({
  top: 3,
  prefilter: true,
  sigma: 1,
  iterations: 10,
  tu: 11.3,
  tv: -7.6,
  noise: 0,
  x: 57,
  y: 77,
  radius: 7,
  k: 0,
});
const state = defaults();

const ui = new Controls();
const toolbar = ui.toolbar();
let imageVersion = 0;
let original: Plane = toGray(
  addImagePicker(toolbar, { names: ['scene', 'shapes', 'text', 'chart', 'blobs', 'zone-plate'], value: 'scene', width: W, height: H }, (img) => {
    original = toGray(img);
    imageVersion++;
    schedule();
  }),
);
toolbar.addBinding(state, 'k', { label: 'shown step k', min: 0, max: 150, step: 1 });
const playButton = toolbar.addButton({ title: 'Play', primary: true });
playButton.on('click', () => (timer ? stop() : play()));
toolbar.addButton({ title: 'Next step' }).on('click', () => {
  stop();
  state.k++;
  ui.refresh();
});
toolbar.addResetButton(() => {
  stop();
  Object.assign(state, defaults());
  ui.refresh();
  schedule();
});

ui.panel('i0-view').addBinding(state, 'radius', { label: 'window radius r', min: 3, max: 12, step: 1 });

const second = ui.panel('i1-view');
const shift = (label: string) => ({ label, min: -R, max: R, step: 0.1, format: (v: number) => fmt(v, 1) });
second.addBinding(state, 'tu', shift('true shift u* (px)'));
second.addBinding(state, 'tv', shift('true shift v* (px)'));
second.addBinding(state, 'noise', { label: 'noise σₙ', min: 0, max: 0.1, step: 0.005 });

const pyramid = ui.panel('pyramid');
pyramid.addBinding(state, 'top', { label: 'coarsest level L', min: 0, max: MAX_LEVEL, step: 1 });
pyramid.addBinding(state, 'prefilter', { label: 'low-pass first' });
pyramid.addBinding(state, 'sigma', { label: 'smoothing σ per level', min: 0, max: 3, step: 0.1 });
pyramid.addBinding(state, 'iterations', { label: 'updates per level', min: 1, max: 30, step: 1 });

let timer = 0;
let lastStep = 0;
function play(): void {
  stop();
  state.k = 0;
  ui.refresh();
  playButton.title = 'Stop';
  timer = window.setInterval(() => {
    if (state.k >= lastStep) return stop();
    state.k++;
    ui.refresh();
  }, 400);
}
function stop(): void {
  window.clearInterval(timer);
  timer = 0;
  playButton.title = 'Play';
}

const view0 = new PixelView(document.getElementById('i0-view')!, (x, y) => {
  state.x = x;
  state.y = y;
  schedule();
});
const view1 = new PixelView(document.getElementById('i1-view')!);
const patchViews = ['patch-i0', 'patch-i1', 'patch-e'].map((id) => new PixelView(document.getElementById(id)!));
const patchCaption = document.getElementById('patch-caption')!;
const plot = new Plot(document.getElementById('convergence-plot')!, 240);
const values = document.getElementById('values')!;

/** One column per level, coarsest first: the level of I₀ and its error surface. */
interface Column {
  el: HTMLElement;
  image: PixelView;
  surface: PixelView;
  caption: HTMLElement;
}
const pyramidEl = document.getElementById('pyramid')!;
let columns: Column[] = [];
function buildColumns(top: number): void {
  if (columns.length === top + 1) return;
  pyramidEl.replaceChildren();
  pyramidEl.style.setProperty('--levels', String(top + 1));
  columns = Array.from({ length: top + 1 }, () => {
    const el = document.createElement('figure');
    el.className = 'level';
    const image = document.createElement('div');
    const surface = document.createElement('div');
    const caption = document.createElement('figcaption');
    el.append(image, surface, caption);
    pyramidEl.append(el);
    return { el, image: new PixelView(image), surface: new PixelView(surface), caption };
  });
}

/** Recomputes a value only when its key changes. */
function cached<T>(compute: () => T): (key: string) => T {
  let last: { key: string; value: T } | null = null;
  return (key) => {
    if (last?.key !== key) last = { key, value: compute() };
    return last.value;
  };
}

const framesKey = () => [imageVersion, state.tu, state.tv, state.noise, state.prefilter, state.sigma].join();
const getLevels = cached((): { I1: Plane; pyr: Level[] } => {
  let I1 = warp(original, { ...IDENTITY, tx: state.tu, ty: state.tv });
  if (state.noise > 0) I1 = gaussianNoise(I1, state.noise, 1);
  return { I1, pyr: levels(original, I1, MAX_LEVEL, state.prefilter, state.sigma) };
});
const windowKey = () => [framesKey(), state.x, state.y, state.radius].join();
const getSurfaces = cached(() => getLevels(framesKey()).pyr.map((L, l) => errorSurface(L, windowAt(windowOf(), l, L), l, R)));
const windowOf = (): Window => ({ x: state.x, y: state.y, r: state.radius });

function square(ctx: CanvasRenderingContext2D, t: ViewTransform, cx: number, cy: number, r: number, color: string, dash: number[] = []): void {
  const [x, y] = t.toView(cx - r, cy - r);
  ctx.strokeStyle = cssColor(color);
  ctx.lineWidth = 2;
  ctx.setLineDash(dash);
  ctx.strokeRect(x, y, (2 * r + 1) * t.scale, (2 * r + 1) * t.scale);
  ctx.setLineDash([]);
}

/** A cross at a real-valued pixel position (pixel centers at integer coordinates). */
function cross(ctx: CanvasRenderingContext2D, t: ViewTransform, x: number, y: number, color: string): void {
  const [cx, cy] = t.toView(x + 0.5, y + 0.5);
  const s = Math.max(4, Math.min(8, t.scale * 0.45));
  ctx.strokeStyle = cssColor(color);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - s, cy - s);
  ctx.lineTo(cx + s, cy + s);
  ctx.moveTo(cx - s, cy + s);
  ctx.lineTo(cx + s, cy - s);
  ctx.stroke();
}

/**
 * The estimates with the given indices as a polyline with dots, the ones after step k faint. `offset` is where u = 0
 * lies in the view, in pixels of the view's image.
 */
function path(ctx: CanvasRenderingContext2D, t: ViewTransform, steps: Step[], indices: number[], k: number, offset: [number, number]): void {
  const at = (s: Step) => t.toView(s.u + offset[0] + 0.5, s.v + offset[1] + 0.5);
  ctx.strokeStyle = ctx.fillStyle = cssColor('--accent');
  ctx.lineWidth = 2;
  for (let j = 1; j < indices.length; j++) {
    ctx.globalAlpha = indices[j] <= k ? 1 : 0.3;
    ctx.beginPath();
    ctx.moveTo(...at(steps[indices[j - 1]]));
    ctx.lineTo(...at(steps[indices[j]]));
    ctx.stroke();
  }
  for (const i of indices) {
    ctx.globalAlpha = i <= k ? 1 : 0.3;
    ctx.beginPath();
    ctx.arc(...at(steps[i]), i === k ? 4.5 : 2.5, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Gray levels from the smallest (black) to the largest error, on a square-root scale; NaN is mid gray. */
function heatmap(E: Float64Array): Plane {
  const n = 2 * R + 1;
  const finite = [...E].filter((e) => !Number.isNaN(e));
  const lo = Math.min(...finite);
  const span = Math.max(...finite) - lo || 1;
  return { width: n, height: n, data: Float32Array.from(E, (e) => (Number.isNaN(e) ? 0.5 : Math.sqrt((e - lo) / span))) };
}

const dist = (s: Step) => Math.hypot(s.u - state.tu, s.v - state.tv);

function update(): void {
  const { I1, pyr } = getLevels(framesKey());
  const surfaces = getSurfaces(windowKey());
  const top = state.top;
  const win = windowAt(windowOf(), 0, pyr[0]);
  const steps = coarseToFine(pyr, win, top, { iterations: state.iterations, epsilon: EPSILON });
  const single = coarseToFine(pyr, win, 0, { iterations: state.iterations * (top + 1), epsilon: EPSILON });
  lastStep = steps.length - 1;
  if (state.k > lastStep) {
    state.k = lastStep;
    ui.refresh();
  }
  const k = state.k;
  const s = steps[k];
  const all = steps.map((_, i) => i);

  view0.overlay = (ctx, t) => square(ctx, t, win.x, win.y, win.r, '--viz-highlight');
  view0.show(planeToImage(original));
  view1.overlay = (ctx, t) => {
    if (top > 0) square(ctx, t, win.x + single.at(-1)!.u, win.y + single.at(-1)!.v, win.r, '--fg-faint', [4, 4]);
    square(ctx, t, win.x + s.u, win.y + s.v, win.r, '--accent', [6, 4]);
    path(ctx, t, steps, all, k, [win.x, win.y]);
    cross(ctx, t, win.x + state.tu, win.y + state.tv, '--viz-points');
  };
  view1.show(planeToImage(I1));

  buildColumns(top);
  columns.forEach((c, i) => {
    const l = top - i;
    const L = pyr[l];
    const w = windowAt(win, l, L);
    const indices = steps.flatMap((st, j) => (st.level === l ? [j] : []));
    c.el.classList.toggle('current', l === s.level);
    c.image.overlay = (ctx, t) => square(ctx, t, w.x, w.y, w.r, '--viz-highlight');
    c.image.show(planeToImage(L.P0));
    c.surface.overlay = (ctx, t) => {
      cross(ctx, t, state.tu + R, state.tv + R, '--viz-highlight');
      path(ctx, t, steps, indices, k, [R, R]);
    };
    c.surface.show(planeToImage(heatmap(surfaces[l])));
    c.caption.innerHTML = `<strong>level ${l}</strong>, ${L.I0.width} × ${L.I0.height} px<br>motion ${fmt(Math.hypot(state.tu, state.tv) / 2 ** l, 1)} px`;
  });

  const L = pyr[s.level];
  const scale = 2 ** s.level;
  const w = windowAt(win, s.level, L);
  const n = 2 * w.r + 1;
  const smp = windowSamples(L, w, s.u / scale, s.v / scale);
  const plane = (data: Float32Array): Plane => ({ width: n, height: n, data: data.map((v) => (Number.isNaN(v) ? 0.5 : v)) });
  patchCaption.innerHTML = `level ${s.level}, step ${k}`;
  patchViews[0].show(planeToImage(plane(smp.i0)));
  patchViews[1].show(planeToImage(plane(smp.i1)));
  patchViews[2].overlay = (ctx, t) => {
    ctx.fillStyle = cssColor('--viz-object');
    ctx.globalAlpha = 0.6;
    smp.e.forEach((v, i) => {
      if (!Number.isNaN(v)) return;
      const [px, py] = t.toView(i % n, Math.floor(i / n));
      ctx.fillRect(px, py, t.scale, t.scale);
    });
    ctx.globalAlpha = 1;
  };
  patchViews[2].show(planeToImage(plane(smp.e.map((v) => 0.5 + v))));

  drawConvergence(steps, single, k);
  renderValues(pyr, win, steps, single, k);
}
const schedule = perFrame(update);

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const pow10 = (e: number) => (e === 0 ? '1' : `10${e < 0 ? '⁻' : ''}${[...String(Math.abs(e))].map((d) => SUPERSCRIPT[+d]).join('')}`);

/** |u_k − u*| per step on a logarithmic axis, with the levels as shaded bands. */
function drawConvergence(steps: Step[], single: Step[], k: number): void {
  const floor = -3;
  const log = (x: number) => Math.max(floor, Math.log10(Math.max(x, 1e-12)));
  const last = Math.max(steps.length, single.length) - 1;
  plot.render({ x: [0, Math.max(last, 5)], y: [floor, 1.6] }, (fr) => {
    let start = 0;
    steps.forEach((st, j) => {
      const end = j === steps.length - 1 || steps[j + 1].level !== st.level;
      if (!end) return;
      if (st.level % 2 === 1) fr.band(start - 0.5, j + 0.5, '--fg-faint', 0.12);
      fr.label(`level ${st.level}`, (start + j) / 2, 1.6, '--fg-muted', 'center', 'top');
      start = j + 1;
    });
    const step = Math.ceil(last / 15);
    fr.grid(Array.from({ length: last + 1 }, (_, i) => i).filter((i) => i % step === 0), [-3, -2, -1, 0, 1], { y: pow10 });
    fr.vline(k, '--fg-faint', { dash: [4, 4] });
    if (state.top > 0) fr.line(single.map((st, i) => [i, log(dist(st))] as const), '--fg-faint', { dash: [6, 4] });
    fr.line(steps.map((st, i) => [i, log(dist(st))] as const), '--accent');
    fr.stems([[k, log(dist(steps[k]))]], '--accent');
  });
}

function renderValues(pyr: Level[], win: Window, steps: Step[], single: Step[], k: number): void {
  const s = steps[k];
  const scale = 2 ** s.level;
  const next = steps[k + 1];
  const ul = [s.u / scale, s.v / scale];
  let update: string;
  if (!s.du) update = `<p class="warn">${renderTex('A^\\top A')} cannot be inverted at this level, so there is no update.</p>`;
  else if (next && next.level === s.level)
    update = eq(`\\mathbf{u}^{(${s.level})}_{k+1} = ${texTuple(ul, 3)} + ${texTuple(s.du, 3)} = \\htmlClass{result}{${texTuple([ul[0] + s.du[0], ul[1] + s.du[1]], 3)}}`);
  else if (next)
    update = eq(`\\text{next level: } \\mathbf{u}^{(${next.level})}_0 = 2\\, \\hat{\\mathbf{u}}^{(${s.level})} = 2 \\cdot ${texTuple(ul, 3)} = \\htmlClass{result}{${texTuple([next.u / 2 ** next.level, next.v / 2 ** next.level], 3)}}`);
  else update = `<p class="small">Done: the update ${renderTex(`|\\Delta\\mathbf{u}| = ${sci(Math.hypot(...s.du), 2)}`)} px is below ${EPSILON} px, or the level used all its updates.</p>`;

  const rows = Array.from({ length: state.top + 1 }, (_, i) => {
    const l = state.top - i;
    const own = steps.filter((st) => st.level === l);
    const first = own[0];
    const end = own.at(-1)!;
    return `<tr${l === s.level ? ' class="current"' : ''}><td>${l}</td><td>${pyr[l].I0.width} × ${pyr[l].I0.height}</td><td>${2 * windowAt(win, l, pyr[l]).r + 1}²</td><td>${texTupleText([first.u, first.v])}</td><td>${texTupleText([end.u, end.v])}</td><td>${own.length - 1}</td><td>${fmt(dist(end), 3)} px</td></tr>`;
  }).join('');
  const work = steps.reduce((sum, st) => sum + (2 * windowAt(win, st.level, pyr[st.level]).r + 1) ** 2, 0);
  const pixels = (2 * win.r + 1) ** 2;
  const shifts = (2 * R + 1) ** 2;
  const fin = steps.at(-1)!;
  const one = single.at(-1)!;

  values.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <h3>Step ${k}, level ${s.level} (${pyr[s.level].I0.width} × ${pyr[s.level].I0.height} px)</h3>
        ${eq(`\\mathbf{u}^{(${s.level})} = \\mathbf{u} / 2^{${s.level}} = ${texTuple(ul, 3)},\\qquad \\mathbf{u} = ${texTuple([s.u, s.v], 3)}`)}
        ${s.du ? eq(`A^\\top A\\, \\Delta\\mathbf{u} = A^\\top \\mathbf{b} \\;\\Rightarrow\\; \\Delta\\mathbf{u} = ${texTuple(s.du, 3)}`) : ''}
        ${update}
        ${eq(`E = \\tfrac{1}{A} \\sum_i e_i^2 = ${sci(s.E, 3)}`)}
      </div>
      <div class="value-block">
        <h3>Levels</h3>
        <table class="level-table">
          <thead><tr><th>level</th><th>size</th><th>window</th><th>start ${renderTex('\\mathbf{u}')}</th><th>result ${renderTex('\\mathbf{u}')}</th><th>updates</th><th>${renderTex('|\\mathbf{u} - \\mathbf{u}^*|')}</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p class="small">All displacements in pixels of level 0.</p>
      </div>
      <div class="value-block">
        <h3>Coarse to fine vs a single scale</h3>
        ${eq(`\\mathbf{u}^* = ${texTuple([state.tu, state.tv], 1)}`)}
        ${eq(`\\text{coarse to fine: } \\hat{\\mathbf{u}} = ${texTuple([fin.u, fin.v], 3)},\\ \\text{off by } \\htmlClass{result}{${sci(dist(fin), 2)}}\\ \\text{px}`)}
        ${eq(`\\text{level 0 only: } \\hat{\\mathbf{u}} = ${texTuple([one.u, one.v], 3)},\\ \\text{off by } ${sci(dist(one), 2)}\\ \\text{px}`)}
        <p class="small">Coarse to fine: ${steps.length} linearizations, ${work.toLocaleString('en')} pixel samples. A full search over ±${R} px at level 0 would need ${2 * R + 1}² × ${2 * win.r + 1}² = ${(shifts * pixels).toLocaleString('en')}, for integer shifts only.</p>
      </div>
    </div>`;
}

const texTupleText = (v: number[]) => `(${v.map((x) => fmt(x, 2)).join(', ')})`;

ui.on('change', schedule);
onThemeChange(schedule);
update();
