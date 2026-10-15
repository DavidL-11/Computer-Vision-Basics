import { Controls } from '../../src/shared/controls';
import { type Plane, createImage, planeToImage } from '../../src/shared/image';
import { gaussianNoise } from '../../src/shared/noise';
import { initPage } from '../../src/shared/page';
import { PixelView, type ViewTransform, perFrame } from '../../src/shared/pixelView';
import { type CostVolume, type Metric, type ScanlineResult, costVolume, scanlineStereo, winnerTakeAll } from '../../src/shared/stereo';
import { type LayerKind, SCENE_D_MAX, SCENE_HEIGHT, SCENE_WIDTH, stereoScene } from '../../src/shared/stereoScene';
import { eq, fmt } from '../../src/shared/tex';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import '../../src/shared/styles/demo.css';
import './disparity-map.css';

initPage({ title: 'Disparity map', chapterId: 'stereo' });

const W = SCENE_WIDTH, H = SCENE_HEIGHT, D_MAX = SCENE_D_MAX;

const defaults = () => ({
  noise: 0.02,
  metric: 'ssd' as Metric,
  r: 3,
  kappa: 0.02,
  dpR: 1,
  y: 120,
});
const state = defaults();

const ui = new Controls();
const toolbar = ui.toolbar();
toolbar.addBinding(state, 'noise', { label: 'noise σₙ', min: 0, max: 0.1, step: 0.005 });
toolbar.addResetButton(() => {
  Object.assign(state, defaults());
  ui.refresh();
  schedule();
});
const wta = ui.panel('wta-view');
wta.addBinding(state, 'metric', { label: 'cost', options: { SSD: 'ssd', NCC: 'ncc' } });
wta.addBinding(state, 'r', { label: 'window radius', min: 0, max: 10, step: 1 });
const dp = ui.panel('dp-view');
dp.addBinding(state, 'kappa', { label: 'occlusion cost κ', min: 0.001, max: 0.1, step: 0.001 });
dp.addBinding(state, 'dpR', { label: 'window radius', min: 0, max: 5, step: 1 });

const pickRow = (_x: number, y: number) => {
  state.y = y;
  schedule();
};
const views = {
  left: new PixelView(document.getElementById('left-view')!, pickRow),
  truth: new PixelView(document.getElementById('truth-view')!, pickRow),
  wta: new PixelView(document.getElementById('wta-view')!, pickRow),
  dp: new PixelView(document.getElementById('dp-view')!, pickRow),
  dsi: new PixelView(document.getElementById('dsi-view')!),
};
const rowCaption = document.getElementById('row-caption')!;
const values = document.getElementById('values')!;

/** Recomputes a value only when its key changes. */
function cached<T>(compute: () => T): (key: string) => T {
  let last: { key: string; value: T } | null = null;
  return (key) => {
    if (last?.key !== key) last = { key, value: compute() };
    return last.value;
  };
}

const imagesKey = () => String(state.noise);
const getImages = cached((): { L: Plane; R: Plane } => {
  const s = stereoScene();
  return state.noise > 0 ? { L: gaussianNoise(s.left, state.noise, 1), R: gaussianNoise(s.right, state.noise, 2) } : { L: s.left, R: s.right };
});
const wtaKey = () => [imagesKey(), state.metric, state.r].join();
const getWta = cached(() => {
  const { L, R } = getImages(imagesKey());
  return winnerTakeAll(costVolume(L, R, D_MAX, state.r, state.metric));
});
const dpCostKey = () => [imagesKey(), state.dpR].join();
const getDpCost = cached((): CostVolume => {
  const { L, R } = getImages(imagesKey());
  return costVolume(L, R, D_MAX, state.dpR, 'ssd');
});
const dpKey = () => [dpCostKey(), state.kappa].join();
const getDp = cached(() => {
  const cv = getDpCost(dpCostKey());
  const rows: ScanlineResult[] = [];
  const map = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const r = scanlineStereo(cv, y, state.kappa);
    rows.push(r);
    map.set(r.disparity, y * W);
  }
  return { rows, map };
});

/** Gray from black (d = 0, far) to white (d = D_MAX, near); NaN mid gray, hatched in the overlay. */
function disparityImage(d: Float32Array): Plane {
  return { width: W, height: H, data: d.map((v) => (Number.isNaN(v) ? 0.5 : v / D_MAX)) };
}

function hatch(ctx: CanvasRenderingContext2D, t: ViewTransform, mask: (i: number) => boolean, color: string): void {
  const tile = document.createElement('canvas');
  tile.width = tile.height = 6;
  const g = tile.getContext('2d')!;
  g.strokeStyle = cssColor(color);
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(0, 6);
  g.lineTo(6, 0);
  g.moveTo(-1, 1);
  g.lineTo(1, -1);
  g.moveTo(5, 7);
  g.lineTo(7, 5);
  g.stroke();
  ctx.fillStyle = ctx.createPattern(tile, 'repeat')!;
  ctx.beginPath();
  for (let i = 0; i < W * H; i++) {
    if (!mask(i)) continue;
    const [x, y] = t.toView(i % W, Math.floor(i / W));
    ctx.rect(x, y, t.scale, t.scale);
  }
  ctx.fill();
}

function row(ctx: CanvasRenderingContext2D, t: ViewTransform): void {
  const [x0, y0] = t.toView(0, state.y);
  const [x1, y1] = t.toView(W, state.y + 1);
  ctx.strokeStyle = cssColor('--viz-highlight');
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
}

function update(): void {
  const s = stereoScene();
  const { L } = getImages(imagesKey());
  const wtaMap = getWta(wtaKey());
  const { rows, map } = getDp(dpKey());

  views.left.overlay = row;
  views.left.show(planeToImage(L));
  views.truth.overlay = (ctx, t) => {
    hatch(ctx, t, (i) => s.occluded[i] === 1, '--viz-highlight');
    row(ctx, t);
  };
  views.truth.show(planeToImage(disparityImage(s.disparity)));
  views.wta.overlay = row;
  views.wta.show(planeToImage(disparityImage(wtaMap)));
  views.dp.overlay = (ctx, t) => {
    hatch(ctx, t, (i) => Number.isNaN(map[i]), '--fg-faint');
    row(ctx, t);
  };
  views.dp.show(planeToImage(disparityImage(map)));

  drawDsi(rows[state.y]);
  rowCaption.textContent = String(state.y);
  renderValues(wtaMap, map, rows[state.y]);
}
const schedule = perFrame(update);

/**
 * The costs of the selected row as an image: one column per left pixel x, one row per disparity d (largest at the
 * top), dark for a good match. The path of scanline stereo runs from left to right through it.
 */
function drawDsi(r: ScanlineResult): void {
  const cv = getDpCost(dpCostKey());
  const n = W * H;
  const img = createImage(W, D_MAX + 1);
  let hi = 0;
  for (let d = 0; d <= D_MAX; d++) for (let x = d; x < W; x++) hi = Math.max(hi, cv.cost[d * n + state.y * W + x]);
  for (let d = 0; d <= D_MAX; d++)
    for (let x = 0; x < W; x++) {
      const c = cv.cost[d * n + state.y * W + x];
      const g = Number.isFinite(c) ? Math.sqrt(c / (hi || 1)) : 1;
      img.data.fill(g, 3 * ((D_MAX - d) * W + x), 3 * ((D_MAX - d) * W + x) + 3);
    }
  const s = stereoScene();
  views.dsi.overlay = (ctx, t) => {
    const at = (x: number, d: number) => t.toView(x, D_MAX - d + 0.5);
    ctx.fillStyle = cssColor('--viz-points');
    for (let x = 0; x < W; x++) {
      const i = state.y * W + x;
      if (s.occluded[i]) continue;
      const [px, py] = at(x + 0.5, s.disparity[i]);
      ctx.beginPath();
      ctx.arc(px, py, Math.max(1.5, t.scale * 0.3), 0, 2 * Math.PI);
      ctx.fill();
    }
    // Path nodes (i, j) at (x = i, d = i − j): a match is a step right, an occlusion a step up-right or down.
    ctx.strokeStyle = cssColor('--accent');
    ctx.lineWidth = 2;
    ctx.beginPath();
    r.path.forEach(([i, j], k) => {
      const [px, py] = at(i, i - j);
      if (k) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    });
    ctx.stroke();
  };
  views.dsi.show(img);
}

const REGION_LABELS: Record<LayerKind, string> = { textured: 'textured box', disk: 'disk', stripes: 'stripes', flat: 'flat panel', background: 'background' };

function renderValues(wtaMap: Float32Array, dpMap: Float32Array, r: ScanlineResult): void {
  const s = stereoScene();
  const cv = getDpCost(dpCostKey());
  const n = W * H;
  // Energy of the true correspondences on this row, with the same costs and κ.
  let trueCost = 0, trueMatches = 0;
  for (let x = 0; x < W; x++) {
    const i = state.y * W + x;
    if (s.occluded[i]) continue;
    trueCost += cv.cost[s.disparity[i] * n + i];
    trueMatches++;
  }
  const trueEnergy = trueCost + state.kappa * 2 * (W - trueMatches);
  const matchCost = r.energy - state.kappa * r.occlusions;

  const kinds: LayerKind[] = ['textured', 'disk', 'stripes', 'flat', 'background'];
  const bad = (m: Float32Array, kind: LayerKind | null) => {
    let wrong = 0, count = 0;
    for (let i = 0; i < n; i++) {
      if (s.occluded[i] || (kind && s.kind[i] !== kind)) continue;
      count++;
      if (!(Math.abs(m[i] - s.disparity[i]) <= 1)) wrong++;
    }
    return `${Math.round((100 * wrong) / count)} %`;
  };
  const rows = [...kinds.map((k) => [REGION_LABELS[k], k] as const), ['all visible pixels', null] as const]
    .map(([label, k]) => `<tr><td>${label}</td><td>${bad(wtaMap, k)}</td><td>${bad(dpMap, k)}</td></tr>`)
    .join('');

  values.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <h3>Wrong disparities, more than 1 px off</h3>
        <table class="stats-table">
          <thead><tr><th>region</th><th>window matching</th><th>scanline stereo</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p class="small">Pixels hidden in the right image are left out; scanline stereo's unmatched pixels count as wrong.</p>
      </div>
      <div class="value-block">
        <h3>Energy of row ${state.y}</h3>
        ${eq(`E = \\sum_\\text{matches} C(x, d) + \\kappa \\cdot \\#\\text{occlusions}`)}
        ${eq(`\\text{scanline stereo: } ${fmt(matchCost, 3)} + ${fmt(state.kappa, 3)} \\cdot ${r.occlusions} = \\htmlClass{result}{${fmt(r.energy, 3)}}`)}
        ${eq(`\\text{true correspondences: } ${fmt(trueCost, 3)} + ${fmt(state.kappa, 3)} \\cdot ${2 * (W - trueMatches)} = ${fmt(trueEnergy, 3)}`)}
        <p class="small">${r.matches} matches. The found path has the lowest energy of all paths${trueEnergy > r.energy + 1e-9 ? ', lower than the true one: where they differ, the energy, not the search, is to blame' : ''}.</p>
      </div>
    </div>`;
}

ui.on('change', schedule);
onThemeChange(schedule);
update();
