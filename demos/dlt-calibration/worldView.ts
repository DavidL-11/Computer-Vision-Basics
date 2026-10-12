// The calibration target in 3D with the true camera and the camera recovered from M̂. Both frustums are built by
// back-projecting the image corners with their own K, R, t.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { backproject } from '../../src/shared/camera';
import type { Mat3, Vec3 } from '../../src/shared/linalg';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import { IMAGE_HEIGHT, IMAGE_WIDTH, RIG_SIZE, squares } from './scene';

const FRUSTUM_DEPTH = 0.12;
const AXIS_LENGTH = RIG_SIZE * 1.25;

export interface CameraPose {
  K: Mat3;
  R: Mat3;
  t: Vec3;
  C: Vec3;
}

function lines(material: THREE.LineBasicMaterial): THREE.LineSegments {
  return new THREE.LineSegments(new THREE.BufferGeometry(), material);
}

function setPositions(object: THREE.LineSegments | THREE.Points, points: Vec3[]): void {
  object.geometry.dispose();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
  object.geometry = geometry;
}

function label(text: string, className = ''): CSS2DObject {
  const div = document.createElement('div');
  div.className = `scene-label ${className}`;
  div.textContent = text;
  return new CSS2DObject(div);
}

/** Center to image corners, and the image rectangle, at depth FRUSTUM_DEPTH in front of the camera. */
function frustum({ K, R, t, C }: CameraPose): Vec3[] {
  const corners = [
    [0, 0],
    [IMAGE_WIDTH, 0],
    [IMAGE_WIDTH, IMAGE_HEIGHT],
    [0, IMAGE_HEIGHT],
  ].map(([u, v]) => backproject(K, R, t, u, v, FRUSTUM_DEPTH));
  return [...corners.flatMap((p) => [C, p]), ...corners.flatMap((p, i) => [p, corners[(i + 1) % 4]])];
}

export class WorldView {
  private renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  private labelRenderer = new CSS2DRenderer();
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.01, 50);

  // Pushed back in depth, so the corner points on the boards are not hidden by them.
  private boardDark = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  private boardLight = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  private axisMaterials = [0, 1, 2].map(() => new THREE.LineBasicMaterial());
  private usedMaterial = new THREE.PointsMaterial({ size: 6, sizeAttenuation: false });
  private unusedMaterial = new THREE.PointsMaterial({ size: 3.5, sizeAttenuation: false });
  private trueMaterial = new THREE.LineBasicMaterial();
  private estMaterial = new THREE.LineBasicMaterial();
  private estCenterMaterial = new THREE.MeshBasicMaterial();
  private trueCenterMaterial = new THREE.MeshBasicMaterial();

  private used = new THREE.Points(new THREE.BufferGeometry(), this.usedMaterial);
  private unused = new THREE.Points(new THREE.BufferGeometry(), this.unusedMaterial);
  private trueFrustum = lines(this.trueMaterial);
  private estFrustum = lines(this.estMaterial);
  private trueCenter = new THREE.Mesh(new THREE.SphereGeometry(0.012, 16, 12), this.trueCenterMaterial);
  private estCenter = new THREE.Mesh(new THREE.SphereGeometry(0.012, 16, 12), this.estCenterMaterial);

  constructor(private container: HTMLElement) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.append(this.renderer.domElement);
    this.labelRenderer.domElement.className = 'label-layer';
    container.append(this.labelRenderer.domElement);

    this.camera.up.set(0, 0, 1);
    this.camera.position.set(1.95, 0.8, 1.15);
    const controls = new OrbitControls(this.camera, this.renderer.domElement);
    controls.target.set(0.45, 0.45, 0.3);
    controls.addEventListener('change', () => this.draw());

    this.buildTarget();
    const trueLabel = label('C');
    trueLabel.position.set(0, 0, 0.04);
    this.trueCenter.add(trueLabel);
    const estLabel = label('Ĉ', 'estimate-label');
    estLabel.position.set(0, 0, -0.04);
    this.estCenter.add(estLabel);
    this.scene.add(this.used, this.unused, this.trueFrustum, this.estFrustum, this.trueCenter, this.estCenter);

    this.applyTheme();
    onThemeChange(() => {
      this.applyTheme();
      this.draw();
    });
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  private buildTarget(): void {
    for (const dark of [true, false]) {
      const positions = squares.filter((s) => s.dark === dark).flatMap(({ corners: [a, b, c, d] }) => [...a, ...b, ...c, ...a, ...c, ...d]);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      this.scene.add(new THREE.Mesh(geometry, dark ? this.boardDark : this.boardLight));
    }
    const ends: Vec3[] = [
      [AXIS_LENGTH, 0, 0],
      [0, AXIS_LENGTH, 0],
      [0, 0, AXIS_LENGTH],
    ];
    ends.forEach((end, i) => {
      const axis = lines(this.axisMaterials[i]);
      setPositions(axis, [[0, 0, 0], end]);
      const l = label('XYZ'[i], 'axis-label');
      l.position.set(end[0] * 1.08, end[1] * 1.08, end[2] * 1.08);
      axis.add(l);
      this.scene.add(axis);
    });
  }

  private applyTheme(): void {
    this.boardDark.color.setStyle(cssColor('--board-dark'));
    this.boardLight.color.setStyle(cssColor('--board-light'));
    ['--axis-x', '--axis-y', '--axis-z'].forEach((c, i) => this.axisMaterials[i].color.setStyle(cssColor(c)));
    this.usedMaterial.color.setStyle(cssColor('--viz-points'));
    this.unusedMaterial.color.setStyle(cssColor('--fg-faint'));
    this.trueMaterial.color.setStyle(cssColor('--viz-frustum'));
    this.trueCenterMaterial.color.setStyle(cssColor('--viz-frustum'));
    this.estMaterial.color.setStyle(cssColor('--viz-highlight'));
    this.estCenterMaterial.color.setStyle(cssColor('--viz-highlight'));
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.draw();
  }

  update(truth: CameraPose, estimate: CameraPose | null, used: Vec3[], unused: Vec3[]): void {
    setPositions(this.used, used);
    setPositions(this.unused, unused);
    setPositions(this.trueFrustum, frustum(truth));
    this.trueCenter.position.set(...truth.C);
    this.estFrustum.visible = this.estCenter.visible = estimate !== null;
    if (estimate) {
      setPositions(this.estFrustum, frustum(estimate));
      this.estCenter.position.set(...estimate.C);
    }
    this.draw();
  }

  private draw(): void {
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }
}
