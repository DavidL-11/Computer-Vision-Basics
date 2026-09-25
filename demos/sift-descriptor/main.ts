import { Pane } from 'tweakpane';
import { type Keypoint, type Octave, buildScaleSpace, detectKeypoints } from '../../src/shared/dog';
import { type Plane, createPlane, planeToImage, toGray } from '../../src/shared/image';
import { addImagePicker } from '../../src/shared/imagePicker';
import { DEG } from '../../src/shared/linalg';
import { initPage } from '../../src/shared/page';
import { PixelView, perFrame } from '../../src/shared/pixelView';
import { Plot } from '../../src/shared/plot';
import { BINS, CELL_WIDTH, CELLS, ORIENTATION_BINS, ORIENTATION_SIGMA, PEAK_RATIO, SAMPLES, distance } from '../../src/shared/sift';
import { eq, fmt } from '../../src/shared/tex';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import { type Transform, mapPoint, unmapPoint, warp } from '../../src/shared/warp';
import { type PointDescription, applyGamma, describePoint } from './descriptor';
import '../../src/shared/styles/demo.css';
import './sift-descriptor.css';

initPage({ title: 'SIFT descriptor', chapterId: 'features' });

const W = 240;
const H = 180;
const SPACE = { sigma0: 1.6, intervals: 3, octaves: 4 };

function defaults() {
  return { angle: 0, scale: 1, gain: 1, bias: 0, gamma: 1, orient: true, clamp: 0.2, threshold: 0.03 };
}
const state = defaults();
/** The selected keypoint, as a position in the original image. */
const selected = { x: 0, y: 0, auto: true };

const pane = new Pane({ container: document.getElementById('controls')!, title: 'SIFT descriptor' });
let original: Plane = toGray(
  addImagePicker(pane, { names: ['scene', 'shapes', 'blobs', 'text'], value: 'scene', width: W, height: H }, (img) => {
    original = toGray(img);
    selected.auto = true;
    schedule();
  }),
);
const geometry = pane.addFolder({ title: 'Geometry' });
geometry.addBinding(state, 'angle', { label: 'rotation θ (°)', min: -180, max: 180, step: 1 });
geometry.addBinding(state, 'scale', { label: 'scale s', min: 0.5, max: 2, step: 0.01 });
const intensity = pane.addFolder({ title: 'Intensity' });
intensity.addBinding(state, 'gain', { label: 'contrast α', min: 0.25, max: 2, step: 0.01 });
intensity.addBinding(state, 'bias', { label: 'brightness b', min: -0.5, max: 0.5, step: 0.01 });
intensity.addBinding(state, 'gamma', { label: 'gamma γ', min: 0.3, max: 3, step: 0.05 });
const descriptorFolder = pane.addFolder({ title: 'Descriptor' });
descriptorFolder.addBinding(state, 'orient', { label: 'assign orientation' });
descriptorFolder.addBinding(state, 'clamp', { label: 'clamp limit', min: 0.05, max: 1, step: 0.01 });
pane.addBinding(state, 'threshold', { label: 'keypoint contrast t', min: 0.005, max: 0.1, step: 0.001 });
pane.addButton({ title: 'Reset' }).on('click', () => {
  Object.assign(state, defaults());
  pane.refresh();
});

const transform = (): Transform => ({ angle: state.angle * DEG, scale: state.scale, tx: 0, ty: 0, gain: state.gain, bias: state.bias });

const imageView = new PixelView(document.getElementById('image-view')!, (x, y) => {
  const [u, v] = unmapPoint(transform(), W, H, x, y);
  const best = closestKeypoint(u, v);
  if (best) Object.assign(selected, { x: best.x, y: best.y, auto: false });
  schedule();
});
const patchView = new PixelView(document.getElementById('patch-view')!);
const orientationPlot = new Plot(document.getElementById('orientation-plot')!, 240);
const cellsPlot = new Plot(document.getElementById('cells-plot')!, 300, { left: 14, right: 14, top: 14, bottom: 14 });
const vectorPlot = new Plot(document.getElementById('vector-plot')!, 200, { left: 44, right: 14, top: 12, bottom: 24 });
const values = document.getElementById('values')!;

let spaceA: { key: string; original: Plane; octaves: Octave[] } | null = null;
let keypoints: Keypoint[] = [];
let spaceB: { key: string; original: Plane; image: Plane; octaves: Octave[] } | null = null;

function closestKeypoint(x: number, y: number): Keypoint | null {
  let best: Keypoint | null = null;
  for (const k of keypoints) if (!best || Math.hypot(k.x - x, k.y - y) < Math.hypot(best.x - x, best.y - y)) best = k;
  return best;
}

/** The keypoint in the original image and its description in both images. */
interface Current {
  kp: Keypoint;
  a: PointDescription;
  b: PointDescription;
  /** Position and scale of the keypoint in the transformed image. */
  x: number;
  y: number;
  sigma: number;
}
let current: Current | null = null;

function arrow(ctx: CanvasRenderingContext2D, x0: number, y0: number, dx: number, dy: number, head: number): void {
  const len = Math.hypot(dx, dy);
  if (len < 0.5) return;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x0 + dx, y0 + dy);
  if (head > 0 && len > 2 * head) {
    const a = Math.atan2(dy, dx);
    ctx.moveTo(x0 + dx - head * Math.cos(a - 0.45), y0 + dy - head * Math.sin(a - 0.45));
    ctx.lineTo(x0 + dx, y0 + dy);
    ctx.lineTo(x0 + dx - head * Math.cos(a + 0.45), y0 + dy - head * Math.sin(a + 0.45));
  }
  ctx.stroke();
}

imageView.overlay = (ctx, v) => {
  const T = transform();
  ctx.lineWidth = 1.5;
  for (const k of keypoints) {
    const [x, y] = mapPoint(T, W, H, k.x, k.y);
    const [cx, cy] = v.toView(x + 0.5, y + 0.5);
    ctx.strokeStyle = cssColor('--viz-points');
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(2, Math.SQRT2 * k.sigma * T.scale * v.scale), 0, 2 * Math.PI);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  if (!current) return;
  const { b } = current;
  const [cx, cy] = v.toView(current.x + 0.5, current.y + 0.5);
  const r = Math.max(3, Math.SQRT2 * current.sigma * v.scale);
  ctx.strokeStyle = cssColor('--viz-highlight');
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, 2 * Math.PI);
  ctx.stroke();
  arrow(ctx, cx, cy, r * Math.cos(b.theta), r * Math.sin(b.theta), 0);
};

/** Crop of the Gaussian image around the keypoint that holds the whole descriptor window. */
interface Patch {
  x0: number;
  y0: number;
  plane: Plane;
}
let patch: Patch | null = null;

function cropPatch(d: PointDescription, octaves: Octave[]): Patch {
  const L = octaves[d.location.octave].gaussians[d.location.level];
  const half = Math.ceil((Math.SQRT2 * CELL_WIDTH * CELLS * d.location.sigmaOctave) / 2 + 1);
  const x0 = Math.round(d.location.u) - half;
  const y0 = Math.round(d.location.v) - half;
  const n = 2 * half + 1;
  const plane = createPlane(n, n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const u = Math.min(L.width - 1, Math.max(0, x0 + x));
      const v = Math.min(L.height - 1, Math.max(0, y0 + y));
      plane.data[y * n + x] = L.data[v * L.width + u];
    }
  return { x0, y0, plane };
}

patchView.overlay = (ctx, v) => {
  if (!current || !patch) return;
  const { b } = current;
  const { u, v: vv, sigmaOctave: sigma } = b.location;
  const P = (x: number, y: number) => v.toView(x - patch!.x0 + 0.5, y - patch!.y0 + 0.5);
  const cos = Math.cos(b.theta);
  const sin = Math.sin(b.theta);
  const frame = (a: number, c: number) => P(u + a * cos - c * sin, vv + a * sin + c * cos);

  ctx.strokeStyle = cssColor('--fg-muted');
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  const [cx, cy] = P(u, vv);
  ctx.beginPath();
  ctx.arc(cx, cy, Math.round(3 * ORIENTATION_SIGMA * sigma) * v.scale, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.setLineDash([]);

  const halfWidth = (CELL_WIDTH * CELLS * sigma) / 2;
  ctx.strokeStyle = cssColor('--accent');
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i <= CELLS; i++) {
    const t = -halfWidth + (i * 2 * halfWidth) / CELLS;
    for (const [p, q] of [
      [frame(t, -halfWidth), frame(t, halfWidth)],
      [frame(-halfWidth, t), frame(halfWidth, t)],
    ]) {
      ctx.moveTo(...p);
      ctx.lineTo(...q);
    }
  }
  ctx.stroke();

  const spacing = (2 * halfWidth) / SAMPLES;
  const maxM = Math.max(1e-9, ...b.samples.map((s) => s.weight * Math.hypot(s.gx, s.gy)));
  ctx.strokeStyle = cssColor('--viz-points');
  ctx.lineWidth = 1.5;
  for (const s of b.samples) {
    const [sx, sy] = P(s.x, s.y);
    const m = Math.hypot(s.gx, s.gy);
    const len = ((s.weight * m) / maxM) * spacing * 1.4 * v.scale;
    if (m > 0) arrow(ctx, sx, sy, (len * s.gx) / m, (len * s.gy) / m, Math.min(5, len / 3));
  }

  ctx.strokeStyle = cssColor('--viz-highlight');
  ctx.lineWidth = 3;
  const [ex, ey] = frame(halfWidth, 0);
  arrow(ctx, cx, cy, ex - cx, ey - cy, 9);
};

function update(): void {
  const keyA = JSON.stringify([state.threshold]);
  if (spaceA?.original !== original) spaceA = { key: '', original, octaves: buildScaleSpace(original, SPACE) };
  if (spaceA.key !== keyA) {
    spaceA.key = keyA;
    keypoints = detectKeypoints(spaceA.octaves, { ...SPACE, threshold: state.threshold, edgeRatio: 10, interpolate: true }).filter(
      (k) => k.status === 'kept',
    );
  }
  if (selected.auto) {
    // Start with a keypoint of medium size near the center, whose window stays inside the image when it is scaled.
    const medium = keypoints.filter((k) => k.sigma > 2.5 && k.sigma < 6);
    const toCenter = (k: Keypoint) => Math.hypot(k.x - W / 2, k.y - H / 2);
    const best = (medium.length ? medium : keypoints).reduce<Keypoint | null>((a, k) => (!a || toCenter(k) < toCenter(a) ? k : a), null);
    if (best) Object.assign(selected, { x: best.x, y: best.y });
  }

  const T = transform();
  const keyB = JSON.stringify([T, state.gamma]);
  if (spaceB?.key !== keyB || spaceB.original !== original) {
    const image = warp(applyGamma(original, state.gamma), T);
    spaceB = { key: keyB, original, image, octaves: buildScaleSpace(image, SPACE) };
  }
  imageView.show(planeToImage(spaceB.image));

  const kp = closestKeypoint(selected.x, selected.y);
  if (!kp) {
    current = null;
    values.innerHTML = '<p class="warn">No keypoints: lower the keypoint contrast threshold.</p>';
    return;
  }
  Object.assign(selected, { x: kp.x, y: kp.y });
  const options = { orient: state.orient, clamp: state.clamp };
  const a = describePoint(spaceA.octaves, kp.x, kp.y, kp.sigma, options);
  const [x, y] = mapPoint(T, W, H, kp.x, kp.y);
  const sigma = kp.sigma * T.scale;
  // Every orientation peak gives its own keypoint; the one that corresponds to θ of the original is compared.
  const b = describePoint(spaceB.octaves, x, y, sigma, { ...options, near: a.theta + T.angle });
  current = { kp, a, b, x, y, sigma };

  patch = cropPatch(b, spaceB.octaves);
  patchView.show(planeToImage(patch.plane));
  renderOrientation(b);
  renderCells(a, b);
  renderVector(a, b);
  renderValues();
}
const schedule = perFrame(update);

function renderOrientation(b: PointDescription): void {
  const h = b.histogram;
  const max = Math.max(1e-9, ...h);
  const bin = 360 / ORIENTATION_BINS;
  orientationPlot.render({ x: [-bin / 2, 360 - bin / 2], y: [0, 1.1] }, (p) => {
    p.grid([0, 90, 180, 270], [0, 0.5, 1], { x: (v) => `${v}°`, y: (v) => (v === 1 ? 'max' : fmt(v, 1)) });
    p.bars(Array.from(h, (v, i) => [i * bin, v / max] as const), bin * 0.85, '--accent', 0.8);
    p.line([[-bin / 2, PEAK_RATIO], [360 - bin / 2, PEAK_RATIO]], '--fg-muted', { width: 1.5, dash: [5, 4] });
    for (const peak of b.peaks) p.vline(peak / DEG, '--viz-points', { width: 1.5, dash: [3, 3] });
    if (state.orient) p.vline(b.theta / DEG, '--viz-highlight', { width: 2.5 });
  });
}

function renderCells(a: PointDescription, b: PointDescription): void {
  const maxValue = Math.max(1e-9, ...a.descriptor, ...b.descriptor);
  cellsPlot.render({ x: [0, 1], y: [0, 1] }, (p) => {
    const { ctx } = p;
    // Square cells in the middle of the plot area, row 0 at the top as in the keypoint's frame.
    const side = Math.min(p.width, p.height);
    const cell = side / CELLS;
    const left = p.left + (p.width - side) / 2;
    const top = p.top + (p.height - side) / 2;
    ctx.strokeStyle = cssColor('--viz-grid');
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= CELLS; i++) {
      ctx.moveTo(left + i * cell, top);
      ctx.lineTo(left + i * cell, top + side);
      ctx.moveTo(left, top + i * cell);
      ctx.lineTo(left + side, top + i * cell);
    }
    ctx.stroke();
    const scale = (0.46 * cell) / maxValue;
    const draw = (d: Float32Array, color: string, width: number) => {
      ctx.strokeStyle = cssColor(color);
      ctx.lineWidth = width;
      for (let r = 0; r < CELLS; r++)
        for (let c = 0; c < CELLS; c++)
          for (let o = 0; o < BINS; o++) {
            const value = d[(r * CELLS + c) * BINS + o] * scale;
            const angle = (o * 2 * Math.PI) / BINS;
            arrow(ctx, left + (c + 0.5) * cell, top + (r + 0.5) * cell, value * Math.cos(angle), value * Math.sin(angle), Math.min(4, value / 3));
          }
    };
    draw(a.descriptor, '--fg-faint', 4);
    draw(b.descriptor, '--accent', 1.75);
  });
}

function renderVector(a: PointDescription, b: PointDescription): void {
  const yMax = Math.max(0.3, 1.1 * Math.max(...b.normalized, ...a.descriptor, ...b.descriptor));
  const n = CELLS * CELLS * BINS;
  vectorPlot.render({ x: [-1, n], y: [0, yMax] }, (p) => {
    p.grid(
      Array.from({ length: CELLS * CELLS + 1 }, (_, i) => i * BINS - 0.5),
      [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6].filter((v) => v <= yMax),
      { x: () => '', y: (v) => fmt(v, 1) },
    );
    p.bars(Array.from(b.normalized, (v, i) => [i, v] as const), 0.8, '--fg-faint', 0.9);
    p.bars(Array.from(b.descriptor, (v, i) => [i, v] as const), 0.5, '--accent');
    p.line([[-1, state.clamp], [n, state.clamp]], '--viz-highlight', { width: 1.5, dash: [6, 4] });
    const { ctx } = p;
    ctx.fillStyle = cssColor('--viz-points');
    a.descriptor.forEach((v, i) => ctx.fillRect(p.X(i) - 1.5, p.Y(v) - 1.5, 3, 3));
    for (let cell = 0; cell < CELLS * CELLS; cell += CELLS) p.label(`row ${cell / CELLS}`, cell * BINS, 0, '--fg-muted', 'left', 'top');
  });
}

function renderValues(): void {
  const { kp, a, b, x, y, sigma } = current!;
  const T = transform();
  const deg = (r: number) => fmt(r / DEG, 1);
  const turn = ((((b.theta - a.theta) / DEG) % 360) + 540) % 360 - 180;
  const clampedCount = b.normalized.filter((v) => v > state.clamp).length;
  const d = distance(a.descriptor, b.descriptor);
  // The same comparison with one step changed, to see what each step contributes.
  const variant = (o: { orient?: boolean; clamp?: number }) => {
    const options = { orient: o.orient ?? state.orient, clamp: o.clamp ?? state.clamp };
    const da = describePoint(spaceA!.octaves, kp.x, kp.y, kp.sigma, options);
    const db = describePoint(spaceB!.octaves, x, y, sigma, { ...options, near: da.theta + T.angle });
    return distance(da.descriptor, db.descriptor);
  };
  const noOrient = state.orient ? variant({ orient: false }) : d;
  const withOrient = state.orient ? d : variant({ orient: true });
  const noClamp = state.clamp < 1 ? variant({ clamp: 1 }) : d;

  values.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <h3>Keypoint</h3>
        ${eq(`\\text{original: } (${fmt(kp.x, 1)},\\ ${fmt(kp.y, 1)}),\\quad \\sigma = ${fmt(kp.sigma, 2)}`)}
        ${eq(`\\text{transformed: } (${fmt(x, 1)},\\ ${fmt(y, 1)}),\\quad s\\sigma = ${fmt(sigma, 2)}`)}
        ${eq(`\\text{octave } ${b.location.octave}, \\ L_{${b.location.level}}: \\ \\sigma = ${fmt(b.location.sigmaOctave, 2)} \\text{ octave pixels}`)}
        ${eq(`\\text{cell width } ${CELL_WIDTH}\\sigma = ${fmt(CELL_WIDTH * b.location.sigmaOctave, 1)}, \\quad \\text{window } ${fmt(CELL_WIDTH * CELLS * b.location.sigmaOctave, 1)} \\text{ octave pixels}`)}
      </div>
      <div class="value-block">
        <h3>Orientation</h3>
        ${eq(`\\text{peaks} \\ge ${PEAK_RATIO * 100}\\%\\text{: } ${b.peaks.map((p) => `${deg(p)}^\\circ`).join(',\\ ') || '\\text{none}'}`)}
        ${eq(`\\theta_\\text{original} = ${deg(a.theta)}^\\circ, \\quad \\theta = ${deg(b.theta)}^\\circ`)}
        ${state.orient ? eq(`\\theta - \\theta_\\text{original} = ${fmt(turn, 1)}^\\circ \\quad (\\text{rotation: } ${fmt(state.angle, 0)}^\\circ)`) : '<p class="small">Orientation assignment is off: θ = 0.</p>'}
        ${b.peaks.length > 1 ? `<p class="small">Each of the ${b.peaks.length} peaks gives its own keypoint.</p>` : ''}
      </div>
      <div class="value-block">
        <h3>Normalization</h3>
        ${eq(`\\|\\mathbf{h}\\| = ${fmt(Math.hypot(...b.raw), 4)}, \\qquad \\mathbf{d} = \\mathbf{h} / \\|\\mathbf{h}\\|`)}
        ${eq(`\\text{values above } ${fmt(state.clamp, 2)}\\text{: } ${clampedCount} \\text{ of } 128 \\text{, clamped, then renormalized}`)}
        <h3>Distance to the original descriptor</h3>
        ${eq(`\\|\\mathbf{d} - \\mathbf{d}_\\text{original}\\| = \\htmlClass{result}{${fmt(d, 3)}}`)}
        ${eq(`\\text{with orientation: } ${fmt(withOrient, 3)}, \\quad \\text{without: } ${fmt(noOrient, 3)}`)}
        ${eq(`\\text{clamped at } ${fmt(state.clamp, 2)}\\text{: } ${fmt(d, 3)}, \\quad \\text{not clamped: } ${fmt(noClamp, 3)}`)}
      </div>
    </div>`;
}

pane.on('change', schedule);
onThemeChange(schedule);
update();
