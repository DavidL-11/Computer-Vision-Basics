import { Controls } from '../../src/shared/controls';
import { type Plane, planeToImage } from '../../src/shared/image';
import { gaussianNoise } from '../../src/shared/noise';
import { initPage } from '../../src/shared/page';
import { PixelView, type ViewTransform, perFrame } from '../../src/shared/pixelView';
import { Plot, ticks } from '../../src/shared/plot';
import { type LevelSearch, type Metric, hierarchicalSearch, pyramid, windowCost } from '../../src/shared/stereo';
import { SCENE_D_MAX, SCENE_WIDTH, stereoScene } from '../../src/shared/stereoScene';
import { eq, fmt } from '../../src/shared/tex';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import '../../src/shared/styles/demo.css';
import './scanline-matching.css';

initPage({ title: 'Scanline matching cost', chapterId: 'stereo' });

const D_MAX = SCENE_D_MAX;
const W = SCENE_WIDTH;

const defaults = () => ({
  noise: 0.02,
  gain: 1,
  metric: 'ssd' as Metric,
  small: 1,
  large: 6,
  shift: 16,
  levels: 3,
  hr: 2,
  x: 52,
  y: 50,
});
const state = defaults();

const ui = new Controls();
const toolbar = ui.toolbar();
toolbar.addBinding(state, 'noise', { label: 'noise σₙ', min: 0, max: 0.1, step: 0.005 });
toolbar.addBinding(state, 'gain', { label: 'brightness of the right image ×', min: 0.5, max: 1.5, step: 0.05 });
toolbar.addResetButton(() => {
  Object.assign(state, defaults());
  ui.refresh();
  schedule();
});

const costPanel = ui.panel('cost-plot');
costPanel.addBinding(state, 'metric', { label: 'cost', options: { SSD: 'ssd', NCC: 'ncc' } });
costPanel.addBinding(state, 'small', { label: 'small window radius', min: 0, max: 4, step: 1 });
costPanel.addBinding(state, 'large', { label: 'large window radius', min: 3, max: 12, step: 1 });
ui.panel('profile-plot').addBinding(state, 'shift', { label: 'shift the right row by d', min: 0, max: D_MAX, step: 1 });
const pyrPanel = ui.panel('pyramid');
pyrPanel.addBinding(state, 'levels', { label: 'pyramid levels', min: 1, max: 4, step: 1 });
pyrPanel.addBinding(state, 'hr', { label: 'window radius per level', min: 0, max: 6, step: 1 });

const pick = (x: number, y: number) => {
  state.x = x;
  state.y = y;
  const d = stereoScene().disparity[y * W + x];
  state.shift = d;
  ui.refresh();
  schedule();
};
const leftView = new PixelView(document.getElementById('left-view')!, pick);
const rightView = new PixelView(document.getElementById('right-view')!);
const costPlot = new Plot(document.getElementById('cost-plot')!, 260);
const profilePlot = new Plot(document.getElementById('profile-plot')!, 200);
const pyramidEl = document.getElementById('pyramid')!;
const values = document.getElementById('values')!;

/** Recomputes a value only when its key changes. */
function cached<T>(compute: () => T): (key: string) => T {
  let last: { key: string; value: T } | null = null;
  return (key) => {
    if (last?.key !== key) last = { key, value: compute() };
    return last.value;
  };
}

const imagesKey = () => [state.noise, state.gain].join();
const getImages = cached((): { L: Plane; R: Plane } => {
  const s = stereoScene();
  let L = s.left, R: Plane = { ...s.right, data: s.right.data.map((v) => v * state.gain) };
  if (state.noise > 0) {
    L = gaussianNoise(L, state.noise, 1);
    R = gaussianNoise(R, state.noise, 2);
  }
  return { L, R };
});
const pyramidKey = () => [imagesKey(), state.levels].join();
const getPyramids = cached(() => {
  const { L, R } = getImages(imagesKey());
  return { Ls: pyramid(L, state.levels - 1), Rs: pyramid(R, state.levels - 1) };
});

/** Displayed cost: SSD as it is (smaller is better), NCC itself (larger is better). */
const shown = (c: number) => (state.metric === 'ncc' ? 1 - c : c);
const bestOf = (costs: number[]) => costs.indexOf(Math.min(...costs));

function square(ctx: CanvasRenderingContext2D, t: ViewTransform, cx: number, cy: number, r: number, color: string, dash: number[] = []): void {
  const [x, y] = t.toView(cx - r, cy - r);
  ctx.strokeStyle = cssColor(color);
  ctx.lineWidth = 2;
  ctx.setLineDash(dash);
  ctx.strokeRect(x, y, (2 * r + 1) * t.scale, (2 * r + 1) * t.scale);
  ctx.setLineDash([]);
}

function update(): void {
  const s = stereoScene();
  const { L, R } = getImages(imagesKey());
  const { x, y } = state;
  const trueD = s.disparity[y * W + x];
  const occluded = s.occluded[y * W + x] === 1;
  const curve = (r: number) => Array.from({ length: D_MAX + 1 }, (_, d) => windowCost(L, R, x, y, d, r, state.metric));
  const small = curve(state.small), large = curve(state.large);
  const bs = bestOf(small), bl = bestOf(large);

  leftView.overlay = (ctx, t) => {
    square(ctx, t, x, y, state.large, '--viz-object', [5, 4]);
    square(ctx, t, x, y, state.small, '--accent');
  };
  leftView.show(planeToImage(L));
  rightView.overlay = (ctx, t) => {
    const [x0, y0] = t.toView(Math.max(0, x - D_MAX), y);
    const [x1] = t.toView(x + 1, y);
    ctx.fillStyle = cssColor('--viz-highlight');
    ctx.globalAlpha = 0.25;
    ctx.fillRect(x0, y0, x1 - x0, t.scale);
    ctx.globalAlpha = 1;
    square(ctx, t, x - bl, y, state.large, '--viz-object', [5, 4]);
    square(ctx, t, x - bs, y, state.small, '--accent');
    if (!occluded) {
      const [cx, cy] = t.toView(x - trueD + 0.5, y + 0.5);
      ctx.strokeStyle = cssColor('--viz-points');
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - 6, cy - 6);
      ctx.lineTo(cx + 6, cy + 6);
      ctx.moveTo(cx - 6, cy + 6);
      ctx.lineTo(cx + 6, cy - 6);
      ctx.stroke();
    }
  };
  rightView.show(planeToImage(R));

  drawCosts(small, large, trueD, occluded);
  drawProfile(L, R);
  const levels = hierarchicalSearch(getPyramids(pyramidKey()).Ls, getPyramids(pyramidKey()).Rs, x, y, D_MAX, state.hr, state.metric);
  drawPyramid(levels, trueD);
  renderValues(trueD, occluded, small, large, levels);
}
const schedule = perFrame(update);

function drawCosts(small: number[], large: number[], trueD: number, occluded: boolean): void {
  const ncc = state.metric === 'ncc';
  const finite = [...small, ...large].filter(Number.isFinite).map(shown);
  const y: [number, number] = ncc ? [-1, 1] : [0, Math.max(0.01, ...finite) * 1.08];
  costPlot.render({ x: [0, D_MAX], y }, (fr) => {
    fr.grid(ticks(0, D_MAX, 7), ticks(y[0], y[1], 4), { y: (v) => fmt(v, ncc ? 1 : 3) });
    if (!occluded) fr.vline(trueD, '--viz-points', { width: 2 });
    const pts = (c: number[]) => c.flatMap((v, d) => (Number.isFinite(v) ? [[d, shown(v)] as const] : []));
    fr.line(pts(large), '--viz-object', { dash: [6, 4] });
    fr.line(pts(small), '--accent');
    fr.stems([[bestOf(large), shown(large[bestOf(large)])]], '--viz-object');
    fr.stems([[bestOf(small), shown(small[bestOf(small)])]], '--accent');
  });
}

/** The intensities of row y in both images, the right one moved by the chosen d so that matching parts overlap. */
function drawProfile(L: Plane, R: Plane): void {
  const row = (p: Plane, shift: number) => Array.from({ length: W }, (_, x) => [x + shift, p.data[state.y * W + x]] as const);
  profilePlot.render({ x: [0, W - 1], y: [0, 1.2] }, (fr) => {
    fr.grid(ticks(0, W, 8), [0, 0.5, 1]);
    fr.vline(state.x, '--fg-faint', { dash: [4, 4] });
    fr.line(row(L, 0), '--accent');
    fr.line(row(R, state.shift), '--viz-highlight', { alpha: 0.8 });
  });
}

let pyramidPlots: { plot: Plot; caption: HTMLElement }[] = [];
function drawPyramid(levels: LevelSearch[], trueD: number): void {
  if (pyramidPlots.length !== levels.length) {
    pyramidEl.replaceChildren();
    pyramidEl.style.setProperty('--levels', String(levels.length));
    pyramidPlots = levels.map(() => {
      const fig = document.createElement('figure');
      const box = document.createElement('div');
      const caption = document.createElement('figcaption');
      fig.append(box, caption);
      pyramidEl.append(fig);
      return { plot: new Plot(box, 160, { left: 40, right: 8, top: 10, bottom: 24 }), caption };
    });
  }
  const ncc = state.metric === 'ncc';
  levels.forEach((l, i) => {
    const hi = Math.ceil(D_MAX / 2 ** l.level);
    const vals = l.costs.filter(Number.isFinite).map(shown);
    const y: [number, number] = ncc ? [-1, 1] : [0, Math.max(0.01, ...vals) * 1.1];
    pyramidPlots[i].plot.render({ x: [0, hi], y }, (fr) => {
      fr.grid(ticks(0, hi, 4), ticks(y[0], y[1], 3), { y: (v) => fmt(v, ncc ? 1 : 2) });
      fr.band(l.ds[0] - 0.5, l.ds.at(-1)! + 0.5, '--accent', 0.12);
      fr.vline(trueD / 2 ** l.level, '--viz-points', { width: 2 });
      fr.line(
        l.ds.flatMap((d, k) => (Number.isFinite(l.costs[k]) ? [[d, shown(l.costs[k])] as const] : [])),
        '--accent',
      );
      fr.stems([[l.best, shown(l.costs[l.ds.indexOf(l.best)])]], '--accent');
    });
    pyramidPlots[i].caption.innerHTML = `<strong>level ${l.level}</strong>: d = ${l.ds[0]} … ${l.ds.at(-1)}, best ${l.best}`;
  });
}

function renderValues(trueD: number, occluded: boolean, small: number[], large: number[], levels: LevelSearch[]): void {
  const bs = bestOf(small), bl = bestOf(large);
  const evaluations = levels.reduce((n, l) => n + l.ds.length, 0);
  const verdict = (d: number) => (occluded ? '' : d === trueD ? ', correct' : `, off by ${Math.abs(d - trueD)} px`);
  values.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <h3>Pixel (${state.x}, ${state.y}) of the left image</h3>
        ${occluded ? '<p class="warn">This point is hidden in the right image (occluded): it has no correct match.</p>' : eq(`d^* = ${trueD}\\ \\text{px}`)}
        ${eq(`\\text{small window } ${2 * state.small + 1}^2: \\hat d = \\htmlClass{result}{${bs}}`)}<p class="small">${state.metric === 'ncc' ? 'NCC' : 'SSD'} ${fmt(shown(small[bs]), 3)}${verdict(bs)}</p>
        ${eq(`\\text{large window } ${2 * state.large + 1}^2: \\hat d = \\htmlClass{result}{${bl}}`)}<p class="small">${state.metric === 'ncc' ? 'NCC' : 'SSD'} ${fmt(shown(large[bl]), 3)}${verdict(bl)}</p>
      </div>
      <div class="value-block">
        <h3>Hierarchical search</h3>
        ${eq(`\\hat d = 2^0 \\cdot ${levels.at(-1)!.best} = \\htmlClass{result}{${levels.at(-1)!.best}}`)}
        <p class="small">${occluded ? 'No correct match.' : levels.at(-1)!.best === trueD ? 'Correct.' : `Off by ${Math.abs(levels.at(-1)!.best - trueD)} px.`}</p>
        <p class="small">${evaluations} window comparisons instead of ${D_MAX + 1} for a full search on level 0.</p>
      </div>
    </div>`;
}

ui.on('change', schedule);
onThemeChange(schedule);
update();
