import { Controls } from '../../src/shared/controls';
import { initPage } from '../../src/shared/page';
import { lookAtAngles, snapshot } from '../../src/shared/camera';
import { ImageView } from './imageView';
import { MatrixView } from './matrixView';
import { IMAGE_HEIGHT, IMAGE_WIDTH, cubePoints, sceneCenter } from './scene';
import { WorldView } from './worldView';
import '../../src/shared/styles/demo.css';
import './camera-model.css';

initPage({ title: 'Pinhole camera: intrinsics & extrinsics', chapterId: 'cameras-optics-perspective' });

function defaults() {
  const C = { x: -0.6, y: -2.6, z: 2.6 };
  const { yaw, pitch } = lookAtAngles([C.x, C.y, C.z], sceneCenter);
  return {
    fx: 520,
    fy: 520,
    lockAspect: true,
    u0: IMAGE_WIDTH / 2,
    v0: IMAGE_HEIGHT / 2,
    skew: 0,
    C,
    yaw,
    pitch,
    roll: 0,
    showFrustum: true,
    showImagePlane: true,
    showRays: true,
    selected: 6,
  };
}

const state = defaults();

const imageView = new ImageView(document.getElementById('image-view')!, select);
const worldView = new WorldView(document.getElementById('world-view')!, imageView.sensorCanvas, select);
const matrixView = new MatrixView(document.getElementById('matrices')!);

function update(): void {
  if (state.lockAspect) state.fy = state.fx;
  const cam = snapshot(
    { fx: state.fx, fy: state.fy, u0: state.u0, v0: state.v0, skew: state.skew },
    { C: [state.C.x, state.C.y, state.C.z], yaw: state.yaw, pitch: state.pitch, roll: state.roll },
  );
  // The image is rendered first: the 3D view uses it as the image-plane texture.
  imageView.render(cam, state.selected);
  worldView.update(cam, state.selected, state);
  matrixView.render(cam, state.selected);
}

function select(index: number): void {
  state.selected = index;
  ui.refresh();
  update();
}

const ui = new Controls();
const toolbar = ui.toolbar();
toolbar.addBinding(state, 'selected', {
  label: 'selected vertex',
  options: Object.fromEntries(cubePoints.map((p, i) => [p.label, i])),
});
toolbar.addResetButton(() => {
  Object.assign(state, defaults());
  fyBinding.disabled = state.lockAspect;
  ui.refresh();
  update();
});

const intr = ui.panel('image-view').addFolder({ title: 'Intrinsics K' });
const fxBinding = intr.addBinding(state, 'fx', { label: 'fx [px]', min: 150, max: 1500, step: 1 });
const fyBinding = intr.addBinding(state, 'fy', { label: 'fy [px]', min: 150, max: 1500, step: 1, disabled: state.lockAspect });
intr.addBinding(state, 'lockAspect', { label: 'fy = fx' }).on('change', ({ value }) => {
  fyBinding.disabled = value;
  if (value) {
    state.fy = state.fx;
    fyBinding.refresh();
  }
});
fxBinding.on('change', () => {
  if (state.lockAspect) {
    state.fy = state.fx;
    fyBinding.refresh();
  }
});
intr.addBinding(state, 'u0', { label: 'u₀ [px]', min: 0, max: IMAGE_WIDTH, step: 1 });
intr.addBinding(state, 'v0', { label: 'v₀ [px]', min: 0, max: IMAGE_HEIGHT, step: 1 });
intr.addBinding(state, 'skew', { label: 'skew s', min: -300, max: 300, step: 1 });

const worldControls = ui.panel('world-view');
const extr = worldControls.addFolder({ title: 'Extrinsics (camera pose)' });
extr.addBinding(state, 'C', {
  label: 'center C',
  x: { min: -8, max: 8, step: 0.05 },
  y: { min: -8, max: 8, step: 0.05 },
  z: { min: -2, max: 8, step: 0.05 },
});
extr.addBinding(state, 'yaw', { label: 'yaw [°]', min: -180, max: 180, step: 0.5 });
extr.addBinding(state, 'pitch', { label: 'pitch [°]', min: -89, max: 89, step: 0.5 });
extr.addBinding(state, 'roll', { label: 'roll [°]', min: -180, max: 180, step: 0.5 });
extr.addButton({ title: 'Look at the cube' }).on('click', () => {
  const { yaw, pitch } = lookAtAngles([state.C.x, state.C.y, state.C.z], sceneCenter);
  Object.assign(state, { yaw, pitch, roll: 0 });
  ui.refresh();
  update();
});

const display = worldControls.addFolder({ title: 'Show' });
display.addBinding(state, 'showFrustum', { label: 'frustum' });
display.addBinding(state, 'showImagePlane', { label: 'image plane' });
display.addBinding(state, 'showRays', { label: 'rays' });

ui.on('change', update);
update();
