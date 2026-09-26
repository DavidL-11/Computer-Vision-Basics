import { Pane } from 'tweakpane';
import { linearToSrgb } from '../../src/shared/color';
import { type RGBImage, mapPixels, mergeChannels } from '../../src/shared/image';
import { addImagePicker } from '../../src/shared/imagePicker';
import { initPage } from '../../src/shared/page';
import { PixelView, perFrame } from '../../src/shared/pixelView';
import { Plot } from '../../src/shared/plot';
import { eq, fmt } from '../../src/shared/tex';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import { LensDiagram } from './lensDiagram';
import { CARD, IMAGE_W, type LayerImage, background, foreground, subject } from './scene';
import { type DofLimits, type Layer, circleOfConfusion, dofLimits, hyperfocal, imageDistance, renderLayers } from './thinLens';
import '../../src/shared/styles/demo.css';
import './depth-of-field.css';

initPage({ title: 'Thin lens & depth of field', chapterId: 'cameras-optics-perspective' });

const SENSORS = [
  { name: 'Full frame (36 × 24 mm)', w: 36, h: 24 },
  { name: 'APS-C (23.6 × 15.6 mm)', w: 23.6, h: 15.6 },
  { name: '1 inch (13.2 × 8.8 mm)', w: 13.2, h: 8.8 },
  { name: 'Smartphone (5.6 × 4.2 mm)', w: 5.6, h: 4.2 },
];
const S_MAX = 30;
/** Blur diameters beyond this many pixels look the same and only cost time. */
const MAX_BLUR_PX = 80;

function defaults() {
  return { f: 50, N: 2, S: 2, sensor: 0, cAuto: true, c: 0.029, near: 1, subject: 2, far: 10 };
}
const state = defaults();

const LAYERS = [
  { key: 'near', name: 'foreground', color: '--layer-near', height: -55 },
  { key: 'subject', name: 'subject', color: '--layer-subject', height: 30 },
  { key: 'far', name: 'background', color: '--layer-far', height: 95 },
] as const;

const pane = new Pane({ container: document.getElementById('controls')!, title: 'Camera' });

const presets = pane.addFolder({ title: 'Presets' });
const applyPreset = (p: Partial<ReturnType<typeof defaults>>) => {
  Object.assign(state, { S: 2, cAuto: true }, p);
  cBinding.disabled = true;
  pane.refresh();
  schedule();
};
presets.addButton({ title: 'Smartphone: 4.3 mm, f/1.8' }).on('click', () => applyPreset({ f: 4.3, N: 1.8, sensor: 3 }));
presets.addButton({ title: 'Full frame portrait: 85 mm, f/1.8' }).on('click', () => applyPreset({ f: 85, N: 1.8, sensor: 0 }));

const lens = pane.addFolder({ title: 'Lens' });
lens.addBinding(state, 'f', { label: 'f [mm]', min: 2, max: 200, step: 0.1 });
lens.addBinding(state, 'N', { label: 'f-number N', min: 1.4, max: 22, step: 0.1 });
lens.addBinding(state, 'S', { label: 'focus S [m]', min: 0.3, max: S_MAX, step: 0.01 });
lens.addButton({ title: 'Focus on the subject' }).on('click', () => {
  state.S = state.subject;
  pane.refresh();
  schedule();
});
const hyperfocalButton = lens.addButton({ title: 'Focus at the hyperfocal distance' });
hyperfocalButton.on('click', () => {
  state.S = Math.round(hyperfocal(state.f / state.N, state.f, acceptableC()) / 10) / 100;
  pane.refresh();
  schedule();
});

const sensorFolder = pane.addFolder({ title: 'Sensor' });
sensorFolder.addBinding(state, 'sensor', {
  label: 'size',
  options: Object.fromEntries(SENSORS.map((s, i) => [s.name, i])),
});
sensorFolder.addBinding(state, 'cAuto', { label: 'c = diagonal / 1500' }).on('change', ({ value }) => {
  cBinding.disabled = value;
});
const cBinding = sensorFolder.addBinding(state, 'c', { label: 'c [mm]', min: 0.002, max: 0.1, step: 0.0001, disabled: true });

const sceneFolder = pane.addFolder({ title: 'Scene distances' });
sceneFolder.addBinding(state, 'near', { label: 'foreground [m]', min: 0.3, max: 5, step: 0.05 });
sceneFolder.addBinding(state, 'subject', { label: 'subject [m]', min: 0.5, max: 20, step: 0.05 });
sceneFolder.addBinding(state, 'far', { label: 'background [m]', min: 2, max: 100, step: 0.5 });

let subjectLayer = subject(
  addImagePicker(
    sceneFolder,
    { names: ['chart', 'text', 'shapes', 'scene'], value: 'chart', width: CARD.w, height: CARD.h, label: 'subject image' },
    (img: RGBImage) => {
      subjectLayer = subject(img);
      schedule();
    },
  ),
);
const foregroundLayer = foreground();
const backgroundLayer = background();

pane.addButton({ title: 'Reset' }).on('click', () => {
  Object.assign(state, defaults());
  cBinding.disabled = true;
  pane.refresh();
  schedule();
});

const diagram = new LensDiagram(document.getElementById('lens-diagram')!);
const imageView = new PixelView(document.getElementById('image-view')!);
const plot = new Plot(document.getElementById('coc-plot')!, 400);
const values = document.getElementById('values')!;

const sensorDiagonal = () => Math.hypot(SENSORS[state.sensor].w, SENSORS[state.sensor].h);
const acceptableC = () => (state.cAuto ? sensorDiagonal() / 1500 : state.c);

function update(): void {
  const auto = Math.round((sensorDiagonal() / 1500) * 1e4) / 1e4;
  if (state.cAuto && state.c !== auto) {
    state.c = auto;
    cBinding.refresh();
  }
  const f = state.f;
  const A = f / state.N;
  const S = Math.max(state.S * 1000, 1.01 * f);
  const c = acceptableC();
  const pitch = SENSORS[state.sensor].w / IMAGE_W;
  const limits = dofLimits(A, f, S, c);
  const H = hyperfocal(A, f, c);
  hyperfocalButton.disabled = H / 1000 > S_MAX;
  const layers = LAYERS.map((l) => {
    const distance = state[l.key] * 1000;
    return { ...l, distance, coc: circleOfConfusion(A, f, S, distance) };
  });

  diagram.render({
    f,
    A,
    S,
    limits,
    points: layers.map((l) => ({ distance: l.distance, height: l.height, color: l.color, coc: l.coc })),
  });

  const images: Record<string, LayerImage> = { near: foregroundLayer, subject: subjectLayer, far: backgroundLayer };
  const photo = renderLayers(
    layers.map((l): Layer => ({ ...images[l.key], distance: l.distance })),
    (D) => Math.min(MAX_BLUR_PX, circleOfConfusion(A, f, S, D) / pitch),
  );
  imageView.show(mapPixels(mergeChannels(photo), (rgb) => rgb.map(linearToSrgb) as typeof rgb));

  const optics = { A, f, S, c, pitch, H, limits, layers };
  renderPlot(optics);
  renderValues(optics);
}
const schedule = perFrame(update);

const log = Math.log10;
const X_RANGE: [number, number] = [log(200), log(100_000)];
const DISTANCE_TICKS = [0.5, 1, 2, 5, 10, 20, 50];

interface Optics {
  A: number;
  f: number;
  S: number;
  c: number;
  pitch: number;
  H: number;
  limits: DofLimits;
  layers: { name: string; color: string; distance: number; coc: number }[];
}

function renderPlot({ A, f, S, c, pitch, limits, layers }: Optics): void {
  plot.render({ x: X_RANGE, y: [-3, 1.5] }, (p) => {
    p.band(log(limits.near), Math.min(log(limits.far), X_RANGE[1] + 1), '--accent', 0.14);
    p.grid(
      DISTANCE_TICKS.map((m) => log(m * 1000)),
      [-3, -2, -1, 0, 1],
      { x: (x) => `${+(10 ** x / 1000).toPrecision(2)} m`, y: (k) => fmt(10 ** k, Math.max(0, -k)) },
    );
    const hline = (y: number, color: string, text: string) => {
      p.line(
        [
          [X_RANGE[0], log(y)],
          [X_RANGE[1], log(y)],
        ],
        color,
        { width: 1.5, dash: [5, 4] },
      );
      p.label(text, X_RANGE[1] - 0.03, log(y) + 0.06, color, 'right');
    };
    hline(c, '--accent', 'acceptable c');
    hline(pitch, '--fg-faint', '1 pixel');
    p.vline(log(S), '--accent', { dash: [2, 3] });
    p.line((x) => log(circleOfConfusion(A, f, S, 10 ** x)), '--fg', { width: 2.5 });

    const { ctx } = p;
    for (const l of layers) {
      const y = Math.max(p.range.y[0], log(l.coc));
      ctx.beginPath();
      ctx.arc(p.X(log(l.distance)), p.Y(y), 6, 0, 2 * Math.PI);
      ctx.fillStyle = cssColor(l.color);
      ctx.fill();
      ctx.strokeStyle = cssColor('--bg-elev');
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  });
}

const meters = (mm: number) => (mm === Infinity ? '\\infty' : `${fmt(mm / 1000, 2)} \\text{ m}`);

function renderValues({ A, f, S, c, pitch, H, limits, layers }: Optics): void {
  const cocRows = layers
    .map(
      (l) =>
        eq(
          `\\htmlClass{${l.color.slice(2)}}{\\text{${l.name}}}\\ D = ${meters(l.distance)}: \\quad c(D) = ${fmt(l.coc, 3)} \\text{ mm} = ${fmt(l.coc / pitch, 1)} \\text{ px}`,
        ),
    )
    .join('');
  values.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <h3>Thin lens</h3>
        ${eq(`A = \\frac{f}{N} = \\frac{${fmt(f, 1)}}{${fmt(state.N, 1)}} = ${fmt(A, 2)} \\text{ mm}`)}
        ${eq(`\\frac{1}{f} = \\frac{1}{z_o} + \\frac{1}{z_i} \\;\\Rightarrow\\; z_S = \\frac{f S}{S - f} = ${fmt(imageDistance(f, S), 3)} \\text{ mm}`)}
        <p class="muted small">1 px = ${fmt(pitch * 1000, 1)} µm on the sensor</p>
      </div>
      <div class="value-block">
        <h3>Circle of confusion</h3>
        ${eq(`c(D) = \\frac{A f \\, |D - S|}{D \\, (S - f)}`)}
        ${cocRows}
      </div>
      <div class="value-block">
        <h3>Depth of field</h3>
        ${eq(`c = ${fmt(c, 4)} \\text{ mm}${state.cAuto ? ` = \\frac{${fmt(sensorDiagonal(), 1)} \\text{ mm}}{1500}` : ''}`)}
        ${eq(`D_\\text{near} = \\frac{A f S}{A f + c (S - f)} = ${meters(limits.near)}`)}
        ${eq(`D_\\text{far} = \\frac{A f S}{A f - c (S - f)} = ${meters(limits.far)}`)}
        ${eq(`\\text{DoF} = D_\\text{far} - D_\\text{near} = \\htmlClass{result}{${meters(limits.far - limits.near)}}`)}
        ${eq(`\\text{hyperfocal } H = f + \\frac{A f}{c} = ${meters(H)}`)}
      </div>
    </div>`;
}

pane.on('change', schedule);
onThemeChange(schedule);
update();
