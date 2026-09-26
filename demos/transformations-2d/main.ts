import { Pane } from 'tweakpane';
import { type Plane, type RGBImage, mergeChannels, splitChannels } from '../../src/shared/image';
import { addImagePicker } from '../../src/shared/imagePicker';
import { DEG, type Mat3, det3, identity3 } from '../../src/shared/linalg';
import { initPage } from '../../src/shared/page';
import { PixelView, perFrame } from '../../src/shared/pixelView';
import { eq, fmt, renderTex, texMatrix, texTuple, texVector } from '../../src/shared/tex';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import { GRID_LINES, PARALLEL, PlaneView, VIEW } from './planeView';
import {
  type Family,
  IDENTITY,
  type Mirror,
  type Params,
  type Vec2,
  applyH,
  bend,
  classify,
  compose,
  factors,
  frameFor,
  mapPoint,
  mapSegment,
  meetingPoint,
  originFixed,
  parallelAngle,
  ratioAlong,
  toPixel,
  warpPlane,
} from './transform';
import '../../src/shared/styles/demo.css';
import './transformations.css';

initPage({ title: '2D transformations', chapterId: 'calibration' });

const SIZE = 256;
const FRAME = frameFor(SIZE, SIZE);
/** The transformed image shows the same part of the plane as the plane view, at the resolution of the source. */
const OUT_SIZE = Math.round(2 * VIEW * FRAME.scale);
const OUT = { width: OUT_SIZE, height: OUT_SIZE, frame: frameFor(OUT_SIZE, OUT_SIZE, VIEW) };
/** Gray for pixels that show no part of the source image. */
const FILL = 0.18;

/** Like `Params`, with θ in degrees for the slider. */
type Settings = Omit<Params, 'theta'> & { theta: number };

const PRESETS: Record<string, Partial<Settings>> = {
  identity: {},
  translation: { tx: 0.4, ty: -0.25 },
  rotation: { theta: 30 },
  scaling: { sx: 1.4, sy: 0.7 },
  mirror: { mirror: 'y-axis' },
  shear: { ax: 0.5 },
  affine: { tx: 0.25, ty: 0.1, theta: 20, sx: 1.2, sy: 0.8, ax: 0.3 },
  projective: { tx: 0.1, theta: 10, g: 0.3, h: 0.2 },
};

function preset(name: string): Settings {
  return { ...IDENTITY, ...PRESETS[name] };
}

function defaults() {
  return { ...preset('affine'), grid: true, shape: true, original: true, picked: [0.75, -0.5] as Vec2 };
}
const state = defaults();
const params = (): Params => ({ ...state, theta: state.theta * DEG });

const pane = new Pane({ container: document.getElementById('controls')!, title: 'Transformation' });
let image: RGBImage = addImagePicker(
  pane,
  { names: ['chart', 'scene', 'shapes', 'text'], value: 'chart', width: SIZE, height: SIZE },
  (img) => {
    image = img;
    schedule();
  },
);
const presets = pane.addFolder({ title: 'Presets' });
for (const name of Object.keys(PRESETS))
  presets.addButton({ title: name[0].toUpperCase() + name.slice(1) }).on('click', () => {
    Object.assign(state, preset(name));
    pane.refresh();
    schedule();
  });
const folder = (title: string) => pane.addFolder({ title });
const number = (min: number, max: number, step = 0.01) => ({ min, max, step, format: (v: number) => fmt(v, step < 1 ? 2 : 0) });
const t = folder('Translation');
t.addBinding(state, 'tx', { label: 'tₓ', ...number(-1, 1) });
t.addBinding(state, 'ty', { label: 't_y', ...number(-1, 1) });
folder('Rotation').addBinding(state, 'theta', { label: 'θ (°)', ...number(-180, 180, 1) });
const s = folder('Scaling');
s.addBinding(state, 'sx', { label: 'sₓ', ...number(0.2, 2) });
s.addBinding(state, 'sy', { label: 's_y', ...number(0.2, 2) });
folder('Mirror').addBinding(state, 'mirror', {
  label: 'mirror',
  options: { none: 'none', 'at the y-axis': 'y-axis', 'over the origin': 'origin' } satisfies Record<string, Mirror>,
});
const sh = folder('Shear');
// |aₓ a_y| < 1 keeps det = 1 − aₓ a_y > 0, so the shear stays invertible.
sh.addBinding(state, 'ax', { label: 'aₓ', ...number(-0.9, 0.9) });
sh.addBinding(state, 'ay', { label: 'a_y', ...number(-0.9, 0.9) });
const p = folder('Perspective');
// |g| + |h| ≤ 0.9 keeps w' = g x + h y + 1 > 0 on the grid [−1, 1]².
p.addBinding(state, 'g', { label: 'g', ...number(-0.45, 0.45) });
p.addBinding(state, 'h', { label: 'h', ...number(-0.45, 0.45) });
const display = folder('Display');
display.addBinding(state, 'grid', { label: 'grid' });
display.addBinding(state, 'shape', { label: 'shape' });
display.addBinding(state, 'original', { label: 'original' });
pane.addButton({ title: 'Reset' }).on('click', () => {
  Object.assign(state, defaults());
  pane.refresh();
  schedule();
});

const planeView = new PlaneView(document.getElementById('plane-view')!, (q) => {
  state.picked = q;
  schedule();
});
const imageView = new PixelView(document.getElementById('image-view')!);
const values = document.getElementById('values')!;

function mapChannels(img: RGBImage, f: (p: Plane) => Plane): RGBImage {
  return mergeChannels(splitChannels(img).map(f) as [Plane, Plane, Plane]);
}

function update(): void {
  const { H } = compose(params());
  planeView.render({ H, grid: state.grid, shape: state.shape, original: state.original, picked: state.picked });

  imageView.overlay = (ctx, view) => {
    const px = (q: Vec2) => {
      const [u, v] = toPixel(q, OUT.frame);
      return view.toView(u + 0.5, v + 0.5);
    };
    if (state.grid) {
      ctx.strokeStyle = cssColor('--accent');
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (const [a, b] of GRID_LINES) {
        const seg = mapSegment(H, a, b);
        if (!seg) continue;
        ctx.moveTo(...px(seg[0]));
        ctx.lineTo(...px(seg[1]));
      }
      ctx.stroke();
    }
    const [x, y] = px(mapPoint(H, state.picked));
    ctx.fillStyle = cssColor('--viz-highlight');
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, 2 * Math.PI);
    ctx.fill();
  };
  imageView.show(mapChannels(image, (plane) => warpPlane(plane, H, FRAME, OUT, FILL)));
  renderValues(H);
}
const schedule = perFrame(update);

const rows = (M: Mat3) => [M.slice(0, 3), M.slice(3, 6), M.slice(6)];
// Slider steps leave rounding errors like 1e-16 in values that should be 0.
const isIdentity = (M: Mat3) => M.every((v, i) => Math.abs(v - identity3()[i]) < 1e-9);

/** H with its last row highlighted: [0 0 1] for affine transformations, [g h 1] for projective ones. */
function texH(H: Mat3): string {
  const cells = rows(H).map((row, i) => row.map((v) => (i === 2 ? `\\htmlClass{result}{${fmt(v, 2)}}` : fmt(v, 2))));
  return `\\begin{bmatrix*}[r] ${cells.map((row) => row.join(' & ')).join(' \\\\ ')} \\end{bmatrix*}`;
}

const FAMILIES: Record<Family, string> = {
  identity: 'identity: nothing changes',
  translation: 'translation: 2 DOF',
  linear: 'linear: 4 DOF',
  affine: 'affine: 6 DOF',
  projective: 'projective: 8 DOF (9 entries, up to scale)',
};

function describeComposition(H: Mat3): string {
  const f = factors(params());
  const names: [keyof typeof f, string][] = [
    ['T', 'T'],
    ['R', `R(${fmt(state.theta, 0)}^\\circ)`],
    ['Sh', '\\mathit{Sh}'],
    ['S', 'S'],
    ['Mi', '\\mathit{Mi}'],
    ['P', 'P'],
  ];
  const used = names.filter(([key]) => !isIdentity(f[key]));
  const product = used.length ? used.map(([, tex]) => tex).join('\\,') : 'I';
  const matrices = used.map(([key]) => texMatrix(rows(f[key]), 2)).join('');
  return [
    used.length ? eq(`H = ${product} = ${matrices}`) : eq('H = I'),
    eq(`H = ${texH(H)}`),
    `<p class="muted small">Smallest family: ${FAMILIES[classify(H).family]}</p>`,
  ].join('');
}

function property(ok: boolean, text: string, detail: string): string {
  return `<li class="${ok ? 'ok' : 'bad'}"><span class="mark">${ok ? '✓' : '✗'}</span>${text} <span class="muted">${detail}</span></li>`;
}

function describeProperties(H: Mat3): string {
  const { a, b, d } = PARALLEL;
  const end: Vec2 = [b[0] + d[0], b[1] + d[1]];
  const origin = mapPoint(H, [0, 0]);
  const angle = parallelAngle(H, a, b, d);
  const q = meetingPoint(H, d);
  const ratio = ratioAlong(H, b, end, 0.5);
  const det = det3(H);
  const meet =
    Math.abs(q[2]) < 1e-9
      ? `${renderTex(`H\\,(${d[0]}, ${d[1]}, 0)^\\top`)} has ${renderTex("w' = 0")}: they meet only at infinity`
      : `they meet at ${renderTex(texTuple([q[0] / q[2], q[1] / q[2]], 2))}`;
  return `<ul class="props">
    ${property(originFixed(H), 'origin → origin', `(0, 0) → ${renderTex(texTuple(origin, 2))}`)}
    ${property(bend(H, b, end) < 1e-9, 'lines → lines', 'the image of a line is straight again')}
    ${property(angle < 1e-6, 'parallel lines stay parallel', `angle between the colored lines ${fmt(angle / DEG, 1)}°; ${meet}`)}
    ${property(Math.abs(ratio - 0.5) < 1e-6, 'ratios are preserved', `the midpoint lands at ${fmt(ratio, 3)} of the image segment`)}
    ${property(det > 0, 'orientation kept', `${renderTex(`\\det H = ${fmt(det, 2)}`)}`)}
  </ul>`;
}

function describePicked(H: Mat3): string {
  const [x, y] = state.picked;
  const q = applyH(H, state.picked);
  return eq(
    `H ${texVector([x, y, 1], 2)} = ${texVector(q, 2)} \\;\\to\\; \\left(\\frac{x'}{w'}, \\frac{y'}{w'}\\right) = \\htmlClass{result}{${texTuple([q[0] / q[2], q[1] / q[2]], 3)}}`,
  );
}

function renderValues(H: Mat3): void {
  values.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <h3>Composition ${renderTex('H = T\\,R\\,\\mathit{Sh}\\,S\\,\\mathit{Mi} \\cdot P')}</h3>
        ${describeComposition(H)}
      </div>
      <div class="value-block">
        <h3>Properties</h3>
        ${describeProperties(H)}
      </div>
      <div class="value-block">
        <h3>Picked point ${renderTex('p = (x, y)')} (click the plane)</h3>
        ${describePicked(H)}
      </div>
    </div>`;
}

pane.on('change', schedule);
onThemeChange(schedule);
update();
