import { Controls } from '../../src/shared/controls';
import { type Plane, planeToImage } from '../../src/shared/image';
import { initPage } from '../../src/shared/page';
import { PixelView, perFrame } from '../../src/shared/pixelView';
import { costVolume, winnerTakeAll } from '../../src/shared/stereo';
import { eq, fmt } from '../../src/shared/tex';
import { onThemeChange } from '../../src/shared/theme';
import { type Shape, type Stereogram, stereogram } from './rds';
import '../../src/shared/styles/demo.css';
import './random-dot-stereogram.css';

initPage({ title: 'Random-dot stereogram', chapterId: 'stereo' });

const W = 160, H = 120;
const D_BACKGROUND = 2;
const D_MAX = 24;

const defaults = () => ({
  shape: 'square' as Shape,
  seed: 1,
  arrangement: 'parallel',
  dShape: 8,
  density: 0.5,
  dot: 2,
  test: 0,
  r: 3,
  show: 'estimate',
});
const state = defaults();

const ui = new Controls();
const toolbar = ui.toolbar();
toolbar.addBinding(state, 'shape', { label: 'hidden shape', options: { square: 'square', disk: 'disk', ring: 'ring', 'two steps': 'steps' } });
toolbar.addButton({ title: 'New dots' }).on('click', () => {
  state.seed++;
  schedule();
});
toolbar.addResetButton(() => {
  Object.assign(state, defaults());
  ui.refresh();
  schedule();
});
const pairPanel = ui.panel('pair-left');
pairPanel.addBinding(state, 'arrangement', { label: 'order', options: { 'left | right': 'parallel', 'right | left': 'cross' } });
pairPanel.addBinding(state, 'dShape', { label: 'disparity of the shape', min: D_BACKGROUND + 1, max: 12, step: 1 });
pairPanel.addBinding(state, 'density', { label: 'share of black dots', min: 0.05, max: 0.95, step: 0.05 });
pairPanel.addBinding(state, 'dot', { label: 'dot size (px)', min: 1, max: 4, step: 1 });
ui.panel('compare-view').addBinding(state, 'test', { label: 'disparity d', min: 0, max: 14, step: 1 });
const matchPanel = ui.panel('match-view');
matchPanel.addBinding(state, 'show', { label: 'show', options: { estimate: 'estimate', 'true disparity': 'true' } });
matchPanel.addBinding(state, 'r', { label: 'window radius', min: 0, max: 8, step: 1 });

const pairViews = [new PixelView(document.getElementById('pair-left')!), new PixelView(document.getElementById('pair-right')!)];
const pairCaptions = [document.getElementById('pair-left-caption')!, document.getElementById('pair-right-caption')!];
const compareView = new PixelView(document.getElementById('compare-view')!);
const matchView = new PixelView(document.getElementById('match-view')!);
const values = document.getElementById('values')!;

/** Recomputes a value only when its key changes. */
function cached<T>(compute: () => T): (key: string) => T {
  let last: { key: string; value: T } | null = null;
  return (key) => {
    if (last?.key !== key) last = { key, value: compute() };
    return last.value;
  };
}

const rdsKey = () => [state.shape, state.seed, state.dShape, state.density, state.dot].join();
const getRds = cached(
  (): Stereogram =>
    stereogram({ width: W, height: H, shape: state.shape, dBackground: D_BACKGROUND, dShape: state.dShape, density: state.density, dot: state.dot, seed: state.seed }),
);
const matchKey = () => [rdsKey(), state.r].join();
const getMatch = cached(() => {
  const s = getRds(rdsKey());
  return winnerTakeAll(costVolume(s.left, s.right, D_MAX, state.r, 'ssd'));
});

/** |I_L(x, y) − I_R(x − d, y)|, inverted: white where the two images agree at this disparity. */
function compareAt(s: Stereogram, d: number): Plane {
  const out: Plane = { width: W, height: H, data: new Float32Array(W * H) };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) out.data[y * W + x] = x - d < 0 ? 0.5 : 1 - Math.abs(s.left.data[y * W + x] - s.right.data[y * W + x - d]);
  return out;
}

/** Gray up to the largest possible disparity, 22 for the top step of "two steps". */
const disparityImage = (d: Float32Array): Plane => ({ width: W, height: H, data: d.map((v) => (Number.isNaN(v) ? 0.5 : v / 22)) });

function update(): void {
  const s = getRds(rdsKey());
  const est = getMatch(matchKey());
  const order = state.arrangement === 'parallel' ? [s.left, s.right] : [s.right, s.left];
  const names = state.arrangement === 'parallel' ? ['left image', 'right image'] : ['right image', 'left image'];
  order.forEach((p, i) => {
    pairViews[i].show(planeToImage(p));
    pairCaptions[i].textContent = names[i];
  });
  compareView.show(planeToImage(compareAt(s, state.test)));
  matchView.show(planeToImage(disparityImage(state.show === 'true' ? s.disparity : est)));
  renderValues(s, est);
}
const schedule = perFrame(update);

function renderValues(s: Stereogram, est: Float32Array): void {
  let correct = 0, visible = 0, inShape = 0, shapeSum = 0, outside = 0, outsideSum = 0;
  for (let i = 0; i < W * H; i++) {
    if (s.occluded[i]) continue;
    visible++;
    if (est[i] === s.disparity[i]) correct++;
    if (s.disparity[i] > D_BACKGROUND) (inShape++, (shapeSum += est[i]));
    else (outside++, (outsideSum += est[i]));
  }
  values.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <h3>Disparities</h3>
        ${eq(`d_\\text{background} = ${D_BACKGROUND},\\quad d_\\text{shape} = ${state.dShape}${state.shape === 'steps' ? `,\\quad d_\\text{top step} = ${2 * state.dShape - D_BACKGROUND}` : ''}`)}
        <p class="small">Nearer surfaces have larger disparities. Each image alone is a uniform field of random dots.</p>
      </div>
      <div class="value-block">
        <h3>Window matching, ${2 * state.r + 1}² window</h3>
        ${eq(`\\text{exactly right: } \\htmlClass{result}{${fmt((100 * correct) / visible, 0)}\\,\\%}\\ \\text{of the visible pixels}`)}
        ${eq(`\\text{mean } \\hat d \\text{ inside the shape: } ${fmt(shapeSum / inShape, 2)},\\quad \\text{outside: } ${fmt(outsideSum / outside, 2)}`)}
      </div>
    </div>`;
}

ui.on('change', schedule);
onThemeChange(schedule);
update();
