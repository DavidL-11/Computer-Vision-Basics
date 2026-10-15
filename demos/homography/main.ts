import { Controls } from '../../src/shared/controls';
import { type Plane, type RGBImage, mergeChannels, splitChannels } from '../../src/shared/image';
import { addImagePicker } from '../../src/shared/imagePicker';
import { det3, inverse3 } from '../../src/shared/linalg';
import { initPage } from '../../src/shared/page';
import { PixelView, type ViewTransform, perFrame } from '../../src/shared/pixelView';
import { eq, fmt, renderTex, texVector } from '../../src/shared/tex';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import { type Estimate, type Vec2, applyH, estimateHomography, inverseWarp, mapPoint, rectangle } from './homography';
import '../../src/shared/styles/demo.css';
import './homography.css';

initPage({ title: 'Homography & rectification', chapterId: 'calibration' });

const PHOTO_W = 480;
const PHOTO_H = 360;
/** Where the corners of the test image land in the synthetic photo: a sheet lying on a table, seen at an angle. */
const TRUE_CORNERS: Vec2[] = [
  [111, 63],
  [393, 96],
  [438, 309],
  [57, 282],
];
/** Default corners for the user's own photo. */
const INSET_CORNERS: Vec2[] = [
  [60, 45],
  [420, 45],
  [420, 315],
  [60, 315],
];
const OUT_MAX = 300;
const FILL = 0.18;
const HANDLE_RADIUS = 14;

const RATIOS: Record<string, number> = {
  '4 : 3': 4 / 3,
  '1 : 1': 1,
  '3 : 4': 3 / 4,
  '16 : 9': 16 / 9,
  'A4 portrait (1 : √2)': Math.SQRT1_2,
  'A4 landscape (√2 : 1)': Math.SQRT2,
};

const state = { ratio: 4 / 3, grid: true, picked: [240, 180] as Vec2 };
let corners: Vec2[] = TRUE_CORNERS.map((p) => [...p] as Vec2);
let defaultCorners = TRUE_CORNERS;

const ui = new Controls();
const toolbar = ui.toolbar();
let photo = synthesize(
  addImagePicker(toolbar, { names: ['text', 'chart', 'scene'], value: 'text', width: PHOTO_W, height: PHOTO_H }, (img, source) => {
    photo = source === 'file' ? img : synthesize(img);
    defaultCorners = source === 'file' ? INSET_CORNERS : TRUE_CORNERS;
    resetCorners();
  }),
);
toolbar.addBinding(state, 'grid', { label: 'grid' });
toolbar.addResetButton(resetCorners, 'Reset corners');
ui.panel('front-view').addBinding(state, 'ratio', { label: 'width : height', options: RATIOS });

function resetCorners(): void {
  corners = defaultCorners.map((p) => [...p] as Vec2);
  schedule();
}

const photoView = new PixelView(document.getElementById('photo-view')!);
const frontContainer = document.getElementById('front-view')!;
const frontView = new PixelView(frontContainer);
const frontCaption = document.getElementById('front-caption')!;
const values = document.getElementById('values')!;

/** The test image as a flat sheet in a photo: the pixels of the photo look up the sheet through H_true⁻¹. */
function synthesize(sheet: RGBImage): RGBImage {
  const H = estimateHomography(rectangle(PHOTO_W, PHOTO_H), TRUE_CORNERS).H;
  const Hinv = inverse3(H);
  return mergeChannels(
    splitChannels(sheet).map((plane, c) => {
      const out = inverseWarp(plane, Hinv, PHOTO_W, PHOTO_H, NaN);
      // A dim, slightly warm table where the sheet is not.
      for (let j = 0; j < PHOTO_H; j++)
        for (let i = 0; i < PHOTO_W; i++) {
          const k = j * PHOTO_W + i;
          if (Number.isNaN(out.data[k])) out.data[k] = 0.22 + 0.16 * (j / PHOTO_H) + [0.03, 0.01, 0][c];
        }
      return out;
    }) as [Plane, Plane, Plane],
  );
}

// Dragging works in continuous image coordinates, finer than the pixel grid that PixelView reports.
{
  const canvas = photoView.canvas;
  canvas.classList.add('pickable');
  let dragging = -1;
  const position = (e: PointerEvent): Vec2 => {
    const rect = canvas.getBoundingClientRect();
    const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
    return [clamp(((e.clientX - rect.left) / rect.width) * PHOTO_W, PHOTO_W), clamp(((e.clientY - rect.top) / rect.height) * PHOTO_H, PHOTO_H)];
  };
  const handleAt = (e: PointerEvent): number => {
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width / PHOTO_W;
    const [x, y] = position(e);
    const d = corners.map(([u, v]) => Math.hypot(u - x, v - y) * scale);
    const i = d.indexOf(Math.min(...d));
    return d[i] < HANDLE_RADIUS ? i : -1;
  };
  const move = (e: PointerEvent) => {
    if (dragging >= 0) corners[dragging] = position(e);
    else state.picked = position(e);
    schedule();
  };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    dragging = handleAt(e);
    move(e);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (canvas.hasPointerCapture(e.pointerId)) move(e);
    else canvas.style.cursor = handleAt(e) >= 0 ? 'grab' : 'crosshair';
  });
}

function outputSize(): [number, number] {
  const r = state.ratio;
  return r >= 1 ? [OUT_MAX, Math.round(OUT_MAX / r)] : [Math.round(OUT_MAX * r), OUT_MAX];
}

/** Lines of an 8 × 8 grid over the front view. */
function gridLines(w: number, h: number): [Vec2, Vec2][] {
  return Array.from({ length: 9 }, (_, k): [Vec2, Vec2][] => [
    [
      [(k * w) / 8, 0],
      [(k * w) / 8, h],
    ],
    [
      [0, (k * h) / 8],
      [w, (k * h) / 8],
    ],
  ]).flat();
}

/** A homography maps lines to lines, so mapping the end points is enough. */
function drawSegment(ctx: CanvasRenderingContext2D, t: ViewTransform, map: (p: Vec2) => Vec2, [a, b]: [Vec2, Vec2]): void {
  ctx.moveTo(...t.toView(...map(a)));
  ctx.lineTo(...t.toView(...map(b)));
}

function update(): void {
  const [w, h] = outputSize();
  const est = estimateHomography(corners, rectangle(w, h));
  const det = det3(est.H);
  const invertible = Math.abs(det) > 1e-10 * Math.hypot(...est.H) ** 3;
  const Hinv = invertible ? inverse3(est.H) : null;

  const pickedFront = mapPoint(est.H, state.picked);
  const grid = gridLines(w, h);
  photoView.overlay = (ctx, t) => {
    if (state.grid && Hinv) {
      ctx.strokeStyle = cssColor('--accent');
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const line of grid) drawSegment(ctx, t, (p) => mapPoint(Hinv, p), line);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = cssColor('--viz-highlight');
    ctx.lineWidth = 2;
    ctx.beginPath();
    corners.forEach((p, i) => (i === 0 ? ctx.moveTo(...t.toView(...p)) : ctx.lineTo(...t.toView(...p))));
    ctx.closePath();
    ctx.stroke();
    corners.forEach((p, i) => handle(ctx, t.toView(...p), String(i + 1)));
    marker(ctx, t.toView(...state.picked));
  };
  photoView.show(photo);

  const channels = splitChannels(photo);
  const front = Hinv
    ? mergeChannels(channels.map((c) => inverseWarp(c, Hinv, w, h, FILL)) as [Plane, Plane, Plane])
    : mergeChannels(channels.map(() => ({ width: w, height: h, data: new Float32Array(w * h).fill(FILL) })) as [Plane, Plane, Plane]);
  frontView.overlay = (ctx, t) => {
    if (state.grid) {
      ctx.strokeStyle = cssColor('--accent');
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const line of grid) drawSegment(ctx, t, (p) => p, line);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    corners.forEach((_, i) => handle(ctx, t.toView(...rectangle(w, h)[i]), String(i + 1), true));
    if (invertible && applyH(est.H, state.picked)[2] > 0) marker(ctx, t.toView(...pickedFront));
  };
  // Outputs taller than 4 : 3 are kept as tall as the photo instead of filling the whole width.
  frontContainer.style.maxWidth = `${Math.round((75 * w) / h)}%`;
  frontView.show(front);
  frontCaption.textContent = `${w} × ${h} px`;
  renderValues(est, w, h, invertible);
}
const schedule = perFrame(update);

function handle(ctx: CanvasRenderingContext2D, [x, y]: [number, number], label: string, inset = false): void {
  // In the front view the corners sit on the border, so their labels move inwards.
  const r = inset ? 9 : 10;
  const [cx, cy] = inset ? [x + Math.sign(ctx.canvas.clientWidth / 2 - x) * r, y + Math.sign(ctx.canvas.clientHeight / 2 - y) * r] : [x, y];
  ctx.fillStyle = cssColor('--viz-highlight');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = '700 12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, cx, cy + 0.5);
  ctx.textAlign = 'left';
}

function marker(ctx: CanvasRenderingContext2D, [x, y]: [number, number]): void {
  ctx.strokeStyle = cssColor('--viz-points');
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(x - 8, y);
  ctx.lineTo(x + 8, y);
  ctx.moveTo(x, y - 8);
  ctx.lineTo(x, y + 8);
  ctx.stroke();
}

/** Four significant digits: H mixes entries around 1, offsets in pixels and tiny perspective terms g, h. */
const sig = (v: number) => (Math.abs(v) < 1e-12 ? '0' : String(Number(v.toPrecision(4))));

function texSig(rows: number[][]): string {
  return `\\begin{bmatrix*}[r] ${rows.map((r) => r.map(sig).join(' & ')).join(' \\\\ ')} \\end{bmatrix*}`;
}

function renderValues(est: Estimate, w: number, h: number, invertible: boolean): void {
  const { A, svd, H } = est;
  const rows3 = [H.slice(0, 3), H.slice(3, 6), H.slice(6)];
  const q = applyH(H, state.picked);
  const pairs = corners
    .map((p, i) => `${i + 1}:\\ ${`(${fmt(p[0], 1)},\\ ${fmt(p[1], 1)})`} \\mapsto (${rectangle(w, h)[i].join(',\\ ')})`)
    .join(' \\\\ ');
  values.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <h3>Correspondences ${renderTex("p_i \\mapsto p'_i")} (photo → front view)</h3>
        ${eq(`\\begin{array}{l} ${pairs} \\end{array}`)}
      </div>
      <div class="value-block">
        <h3>${renderTex('A h = 0')}: two rows per point, ${A.length} × 9</h3>
        ${eq(`A = ${texSig(A.map((r) => r.map((v) => Math.round(v * 10) / 10)))}`)}
      </div>
      <div class="value-block">
        <h3>Singular values of ${renderTex('A')}</h3>
        ${eq(`${svd.sigma.map((s, i) => `\\sigma_${i + 1} = ${sig(s)}`).join(',\\; ')},\\; \\sigma_9 = 0`)}
        <p class="muted small">
          8 equations for 9 unknowns always leave one direction with ${renderTex('Ah = 0')}: ${renderTex('h = v_9')},
          the last column of ${renderTex('V')}, defined up to scale.
        </p>
      </div>
      <div class="value-block">
        <h3>${renderTex('H')}, scaled to ${renderTex('h_{33} = 1')}</h3>
        ${eq(`H = \\htmlClass{result}{${texSig(rows3)}},\\quad \\det H = ${sig(det3(H))}`)}
        ${invertible ? '' : `<p class="warn">${renderTex('H')} is singular: three corners are on one line, and the quadrilateral no longer determines a projective map onto the rectangle.</p>`}
      </div>
      <div class="value-block">
        <h3>Picked point ${renderTex('p')} (click the photo)</h3>
        ${eq(`H ${texVector([state.picked[0], state.picked[1], 1], 1)} = ${texSig(q.map((v) => [v]))} \\;\\to\\; \\left(\\frac{x'}{w'}, \\frac{y'}{w'}\\right) = \\htmlClass{result}{(${fmt(q[0] / q[2], 1)},\\ ${fmt(q[1] / q[2], 1)})}`)}
      </div>
    </div>`;
}

ui.on('change', schedule);
onThemeChange(schedule);
update();
