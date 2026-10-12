// The scene in 3D with both cameras, the baseline, the viewing ray of x₀, the point X on it and the epipolar plane
// through C₀, C₁ and X. The image planes are drawn at FRUSTUM_DEPTH in front of each camera, with the epipolar lines
// on them: back-projected at that depth, they lie in the epipolar plane.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { type CameraSnapshot, backproject } from '../../src/shared/camera';
import { type Vec3, add, scale, sub } from '../../src/shared/linalg';
import { type Vec2, clipLine } from '../../src/shared/lines';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import { EDGES, GRID, IMAGE_HEIGHT, IMAGE_WIDTH } from './scene';

export const FRUSTUM_DEPTH = 0.6;
/** The viewing ray of x₀ is drawn up to this depth. */
const RAY_DEPTH = 9;

export interface WorldScene {
  cams: [CameraSnapshot, CameraSnapshot];
  x0: Vec2;
  X: Vec3;
  /** Epipolar lines l₀, l₁ in the two images. */
  lines: [Vec3, Vec3];
}

function lines(material: THREE.LineBasicMaterial): THREE.LineSegments {
  return new THREE.LineSegments(new THREE.BufferGeometry(), material);
}

function setPositions(object: THREE.LineSegments | THREE.Mesh, points: Vec3[]): void {
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

/** Center to image corners and the image rectangle, at FRUSTUM_DEPTH. */
function frustum({ K, R, t, C }: CameraSnapshot): Vec3[] {
  const corners = [
    [0, 0],
    [IMAGE_WIDTH, 0],
    [IMAGE_WIDTH, IMAGE_HEIGHT],
    [0, IMAGE_HEIGHT],
  ].map(([u, v]) => backproject(K, R, t, u, v, FRUSTUM_DEPTH));
  return [...corners.flatMap((p) => [C, p]), ...corners.flatMap((p, i) => [p, corners[(i + 1) % 4]])];
}

/** The part of an image line inside the image, on the image plane in 3D. */
function lineOnImagePlane(cam: CameraSnapshot, l: Vec3): Vec3[] {
  const s = clipLine(l, 0, IMAGE_WIDTH, 0, IMAGE_HEIGHT);
  return s ? s.map(([u, v]) => backproject(cam.K, cam.R, cam.t, u, v, FRUSTUM_DEPTH)) : [];
}

export class WorldView {
  private renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  private labelRenderer = new CSS2DRenderer();
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.05, 100);

  private gridMaterial = new THREE.LineBasicMaterial();
  private boxMaterial = new THREE.LineBasicMaterial();
  private frustumMaterial = new THREE.LineBasicMaterial();
  private baselineMaterial = new THREE.LineBasicMaterial();
  private rayMaterial = new THREE.LineBasicMaterial();
  private epipolarMaterial = new THREE.LineBasicMaterial();
  private planeMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, opacity: 0.18, depthWrite: false });
  private centerMaterial = new THREE.MeshBasicMaterial();
  private pointMaterial = new THREE.MeshBasicMaterial();

  private frustums = lines(this.frustumMaterial);
  private baseline = lines(this.baselineMaterial);
  private rays = lines(this.rayMaterial);
  private epipolarLines = lines(this.epipolarMaterial);
  private plane = new THREE.Mesh(new THREE.BufferGeometry(), this.planeMaterial);
  private centers = [0, 1].map(() => new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), this.centerMaterial));
  private point = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), this.pointMaterial);
  private imagePoints = [0, 1].map(() => new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 8), this.pointMaterial));

  constructor(private container: HTMLElement) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.append(this.renderer.domElement);
    this.labelRenderer.domElement.className = 'label-layer';
    container.append(this.labelRenderer.domElement);

    this.camera.up.set(0, 0, 1);
    this.camera.position.set(4.2, -7.2, 3.6);
    const controls = new OrbitControls(this.camera, this.renderer.domElement);
    controls.target.set(-0.1, -1.9, 1.1);
    controls.addEventListener('change', () => this.draw());

    const grid = lines(this.gridMaterial);
    setPositions(grid, GRID.flat());
    const boxes = lines(this.boxMaterial);
    setPositions(boxes, EDGES.flat());
    this.centers.forEach((c, i) => {
      const l = label(`C${'₀₁'[i]}`);
      l.position.set(0, 0, 0.18);
      c.add(l);
    });
    const Xlabel = label('X', 'point-label');
    Xlabel.position.set(0, 0, 0.16);
    this.point.add(Xlabel);
    this.scene.add(grid, boxes, this.frustums, this.plane, this.baseline, this.rays, this.epipolarLines, this.point, ...this.centers, ...this.imagePoints);

    this.applyTheme();
    onThemeChange(() => {
      this.applyTheme();
      this.draw();
    });
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  private applyTheme(): void {
    this.gridMaterial.color.setStyle(cssColor('--viz-grid'));
    this.boxMaterial.color.setStyle(cssColor('--fg-muted'));
    this.frustumMaterial.color.setStyle(cssColor('--viz-frustum'));
    this.centerMaterial.color.setStyle(cssColor('--viz-frustum'));
    this.baselineMaterial.color.setStyle(cssColor('--viz-object'));
    this.rayMaterial.color.setStyle(cssColor('--viz-ray'));
    this.epipolarMaterial.color.setStyle(cssColor('--accent'));
    this.planeMaterial.color.setStyle(cssColor('--accent'));
    this.pointMaterial.color.setStyle(cssColor('--viz-highlight'));
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

  update({ cams, x0, X, lines: [l0, l1] }: WorldScene): void {
    const [cam0, cam1] = cams;
    setPositions(this.frustums, [...frustum(cam0), ...frustum(cam1)]);
    setPositions(this.baseline, [cam0.C, cam1.C]);
    const rayEnd = backproject(cam0.K, cam0.R, cam0.t, x0[0], x0[1], RAY_DEPTH);
    // The ray from C₁ towards X, continued a little beyond X.
    const beyond = add(X, scale(sub(X, cam1.C), 0.15));
    setPositions(this.rays, [cam0.C, rayEnd, cam1.C, beyond]);
    setPositions(this.epipolarLines, [...lineOnImagePlane(cam0, l0), ...lineOnImagePlane(cam1, l1)]);
    setPositions(this.plane, [cam0.C, cam1.C, X]);
    this.centers.forEach((c, i) => c.position.set(...cams[i].C));
    this.point.position.set(...X);
    // Where the rays pierce the image planes: x₀ and x₁ in 3D.
    this.imagePoints[0].position.set(...backproject(cam0.K, cam0.R, cam0.t, x0[0], x0[1], FRUSTUM_DEPTH));
    const d1 = sub(X, cam1.C);
    const depth1 = cam1.R[6] * d1[0] + cam1.R[7] * d1[1] + cam1.R[8] * d1[2];
    this.imagePoints[1].visible = depth1 > 0;
    if (depth1 > 0) this.imagePoints[1].position.set(...add(cam1.C, scale(d1, FRUSTUM_DEPTH / depth1)));
    this.draw();
  }

  private draw(): void {
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }
}
