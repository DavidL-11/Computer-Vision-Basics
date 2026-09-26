import { Pane } from 'tweakpane';
import { cameraToWorldRotation, snapshot } from '../../src/shared/camera';
import { type Mat34, type Vec3, add, mulMat3Vec, scale, sub } from '../../src/shared/linalg';
import { initPage } from '../../src/shared/page';
import { perFrame } from '../../src/shared/pixelView';
import { eq, fmt, texMatrix, texTuple, texVector } from '../../src/shared/tex';
import { ImageView, type Projector } from './imageView';
import { afov, applyP, dollyFocal, orthographicP, perspectiveP, weakPerspectiveP } from './projection';
import { IMAGE_HEIGHT, IMAGE_WIDTH, PROBES, SUBJECT_CENTER, VIEW } from './scene';
import { type Model, SideView } from './sideView';
import '../../src/shared/styles/demo.css';
import './field-of-view.css';

initPage({ title: 'Focal length, FOV & orthographic projection', chapterId: 'cameras-optics-perspective' });

/** The orthographic image maps 1 m to this many pixels, independent of f and D. */
const ORTHO_SCALE = 125;
const MODEL_NAMES: Record<Model, string> = {
  perspective: 'perspective',
  weak: 'weak perspective',
  orthographic: 'orthographic',
};

function defaults() {
  return {
    H: 24,
    f: 50,
    D: 8,
    dolly: false,
    model: 'perspective' as Model,
    ghost: 'none' as Model | 'none',
    probe: 2,
  };
}
const state = defaults();
/** The setting captured when the dolly zoom is switched on. */
let dollyRef = { f: state.f, D: state.D };

const pane = new Pane({ container: document.getElementById('controls')!, title: 'Camera' });
const lens = pane.addFolder({ title: 'Lens and sensor' });
lens.addBinding(state, 'H', { label: 'sensor H [mm]', min: 4, max: 36, step: 0.1 });
const fBinding = lens.addBinding(state, 'f', { label: 'f [mm]', min: 8, max: 800, step: 0.5 });

const position = pane.addFolder({ title: 'Distance' });
const dBinding = position.addBinding(state, 'D', { label: 'subject D [m]', min: 3, max: 40, step: 0.1 });
position.addBinding(state, 'dolly', { label: 'dolly zoom' }).on('change', ({ value }) => {
  fBinding.disabled = value;
  dollyRef = { f: state.f, D: state.D };
});
dBinding.on('change', () => {
  if (!state.dolly) return;
  state.f = Math.round(dollyFocal(dollyRef.f, dollyRef.D, state.D) * 10) / 10;
  fBinding.refresh();
});

const modelFolder = pane.addFolder({ title: 'Projection model' });
const modelOptions = Object.fromEntries(Object.entries(MODEL_NAMES).map(([k, v]) => [v, k]));
modelFolder.addBinding(state, 'model', { label: 'model', options: modelOptions });
modelFolder.addBinding(state, 'ghost', { label: 'compare with', options: { none: 'none', ...modelOptions } });
modelFolder.addBinding(state, 'probe', {
  label: 'point',
  options: Object.fromEntries(PROBES.map((p, i) => [p.name, i])),
});

pane.addButton({ title: 'Reset' }).on('click', () => {
  Object.assign(state, defaults());
  fBinding.disabled = false;
  pane.refresh();
  schedule();
});

const sideView = new SideView(document.getElementById('side-view')!);
const imageView = new ImageView(document.getElementById('image-view')!);
const values = document.getElementById('values')!;

/** f in pixels: the sensor height H is spread over the image height. */
const focalPx = () => (state.f * IMAGE_HEIGHT) / state.H;

function matrix(model: Model): Mat34 {
  if (model === 'perspective') return perspectiveP(focalPx());
  if (model === 'weak') return weakPerspectiveP(focalPx(), state.D);
  return orthographicP();
}

/** The model's (u, v) with the principal point at the image center; orthographic (u, v) in m is scaled to pixels. */
function projector(model: Model): Projector {
  const P = matrix(model);
  const k = model === 'orthographic' ? ORTHO_SCALE : 1;
  return (Xc) => {
    const { uv, w } = applyP(P, Xc);
    if (w <= 0) return null;
    return [IMAGE_WIDTH / 2 + k * uv[0], IMAGE_HEIGHT / 2 + k * uv[1]];
  };
}

function update(): void {
  // The camera moves along its viewing direction, so the subject center stays on the optical axis at depth D.
  const Rt = cameraToWorldRotation(VIEW.yaw, VIEW.pitch, 0);
  const forward: Vec3 = [Rt[2], Rt[5], Rt[8]];
  const cam = snapshot(
    { fx: focalPx(), fy: focalPx(), u0: IMAGE_WIDTH / 2, v0: IMAGE_HEIGHT / 2, skew: 0 },
    { C: sub(SUBJECT_CENTER, scale(forward, state.D)), yaw: VIEW.yaw, pitch: VIEW.pitch, roll: 0 },
  );
  const toCamera = (X: Vec3) => add(mulMat3Vec(cam.R, X), cam.t);
  const ghost = state.ghost === 'none' || state.ghost === state.model ? null : state.ghost;

  sideView.render({ toCamera, D: state.D, afov: afov(state.H, state.f), model: state.model });
  imageView.render({
    toCamera,
    main: projector(state.model),
    mainClips: state.model === 'perspective',
    ghost: ghost && projector(ghost),
    ghostClips: ghost === 'perspective',
  });
  renderValues(toCamera);
}
const schedule = perFrame(update);

function renderValues(toCamera: (X: Vec3) => Vec3): void {
  const fpx = focalPx();
  const W = (state.H * IMAGE_WIDTH) / IMAGE_HEIGHT;
  const P = matrix(state.model);
  const rows = [P.slice(0, 4), P.slice(4, 8), P.slice(8, 12)];
  const digits = state.model === 'weak' ? 1 : 0;
  const probe = PROBES[state.probe];
  const Xc = toCamera(probe.X);
  const line = (model: Model, wTex: string) => {
    const { uv, w } = applyP(matrix(model), Xc);
    const pixel = model === 'orthographic' ? `\\text{ m}` : '';
    const active = model === state.model;
    const body = `\\text{${MODEL_NAMES[model]}}: \\; w = ${wTex} = ${fmt(w, 2)}, \\quad (u, v) = ${texTuple(uv, model === 'orthographic' ? 3 : 1)}${pixel}`;
    return eq(active ? `\\htmlClass{result}{${body}}` : body);
  };
  const subjectPx = (model: Model) => (model === 'orthographic' ? ORTHO_SCALE : fpx / state.D);

  values.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <h3>Field of view</h3>
        ${eq(`\\mathrm{AFOV} = 2 \\arctan\\frac{H}{2f} = 2 \\arctan\\frac{${fmt(state.H, 1)}}{2 \\cdot ${fmt(state.f, 1)}} = \\htmlClass{result}{${fmt(afov(state.H, state.f), 1)}^\\circ}`)}
        ${eq(`\\text{horizontal } (W = ${fmt(W, 1)} \\text{ mm}): \\; ${fmt(afov(W, state.f), 1)}^\\circ`)}
        ${eq(`f = ${fmt(state.f, 1)} \\text{ mm} \\cdot \\frac{${IMAGE_HEIGHT} \\text{ px}}{${fmt(state.H, 1)} \\text{ mm}} = ${fmt(fpx, 0)} \\text{ px}`)}
      </div>
      <div class="value-block">
        <h3>Projection matrix: ${MODEL_NAMES[state.model]}</h3>
        ${eq(`w \\begin{bmatrix} u \\\\ v \\\\ 1 \\end{bmatrix} = ${texMatrix(rows, digits)} \\begin{bmatrix} X_c \\\\ Y_c \\\\ Z_c \\\\ 1 \\end{bmatrix}`)}
        <p class="muted small">
          ${state.model === 'weak' ? `Z₀ = D = ${fmt(state.D, 1)} m. ` : ''}${state.model === 'orthographic' ? `(u, v) are in meters and drawn at ${ORTHO_SCALE} px per m. ` : ''}Principal point at the image center.
        </p>
        <p class="muted small">At the depth of the subject center, 1 m appears as ${fmt(subjectPx(state.model), 0)} px.</p>
      </div>
      <div class="value-block">
        <h3>Point: ${probe.name}</h3>
        ${eq(`\\mathbf{X}_c = ${texVector(Xc, 2)}`)}
        ${line('perspective', 'Z_c')}
        ${line('weak', 'Z_0')}
        ${line('orthographic', '1')}
      </div>
    </div>`;
}

pane.on('change', schedule);
update();
