// 3D coordinates are (x, y, w), with the same axes as a camera frame: x right, y down,
// w forward. The image plane is w = 1; points become rays and lines become planes through O.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { type Vec3, normalize, scale } from '../../src/shared/linalg';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import { clipLine, toHomogeneous } from './homogeneous';
import { PLANE, POINT_NAMES, type PlaneScene } from './planeView';

/** Rays are drawn for w ∈ [0, W_MAX]; the scaled point may also go below 0. */
const W_MAX = 2;
const Q_RAY_LENGTH = 3.2;
const AXIS_LENGTH = 0.6;

export interface RayScene extends PlaneScene {
  /** The homogeneous vector k·p that is shown on its ray. */
  scaled: Vec3;
  showPlanes: boolean;
  showRays: boolean;
}

function lineSegments(material: THREE.LineBasicMaterial): THREE.LineSegments {
  return new THREE.LineSegments(new THREE.BufferGeometry(), material);
}

function setPositions(obj: THREE.Mesh | THREE.LineSegments, points: Vec3[]): void {
  obj.geometry.dispose();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
  obj.geometry = geometry;
}

function label(text: string, className = ''): CSS2DObject {
  const div = document.createElement('div');
  div.className = `scene-label ${className}`;
  div.textContent = text;
  return new CSS2DObject(div);
}

const PLANE_CORNERS: Vec3[] = [
  [PLANE.xMin, PLANE.yMin, 1],
  [PLANE.xMax, PLANE.yMin, 1],
  [PLANE.xMax, PLANE.yMax, 1],
  [PLANE.xMin, PLANE.yMax, 1],
];

export class RayView {
  private renderer: THREE.WebGLRenderer;
  private labelRenderer = new CSS2DRenderer();
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.05, 100);

  private planeFill = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, opacity: 0.5, depthWrite: false });
  private gridMaterial = new THREE.LineBasicMaterial();
  private borderMaterial = new THREE.LineBasicMaterial();
  private infinityMaterial = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.45 });
  private axisMaterials = ['--axis-x', '--axis-y', '--axis-z'].map(() => new THREE.LineBasicMaterial());
  private lineMaterials = [new THREE.LineBasicMaterial(), new THREE.LineBasicMaterial()];
  private wedgeMaterials = [0, 1].map(
    () => new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, opacity: 0.16, depthWrite: false }),
  );
  private pointMaterials = [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()];
  private rayMaterial = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.6 });
  private highlightLine = new THREE.LineBasicMaterial();
  private highlightMesh = new THREE.MeshBasicMaterial();
  private scaledMaterial = new THREE.MeshBasicMaterial();

  private imageLines = this.lineMaterials.map((m) => lineSegments(m));
  private wedges = this.wedgeMaterials.map((m) => new THREE.Mesh(new THREE.BufferGeometry(), m));
  private rays = lineSegments(this.rayMaterial);
  private qRay = lineSegments(this.highlightLine);
  private scaledRay = lineSegments(this.highlightLine);
  private pointMeshes: THREE.Mesh[] = [];
  private qMesh = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), this.highlightMesh);
  private qLabel = label('q', 'highlight');
  private scaledMesh = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), this.scaledMaterial);
  private scaledLabel = label('k·p', 'highlight');

  private last: RayScene | null = null;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.append(this.renderer.domElement);
    this.labelRenderer.domElement.className = 'label-layer';
    container.append(this.labelRenderer.domElement);

    // y points down, so "up" on screen is −y.
    this.camera.up.set(0, -1, 0);
    this.camera.position.set(-4.5, -3, -2.9);
    const controls = new OrbitControls(this.camera, this.renderer.domElement);
    controls.target.set(0, 0, 0.9);
    controls.update();
    controls.addEventListener('change', () => this.draw());

    this.buildStaticScene();
    this.scene.add(...this.wedges, ...this.imageLines, this.rays, this.qRay, this.scaledRay, this.qMesh, this.scaledMesh);
    this.qMesh.add(this.qLabel);
    this.qLabel.position.set(0.08, -0.08, 0);
    this.scaledMesh.add(this.scaledLabel);
    this.scaledLabel.position.set(0.08, -0.1, 0);

    const sphere = new THREE.SphereGeometry(0.04, 16, 12);
    POINT_NAMES.forEach((name, i) => {
      const mesh = new THREE.Mesh(sphere, this.pointMaterials[i < 2 ? 0 : 1]);
      const l = label(name);
      l.position.set(0.07, -0.07, 0);
      mesh.add(l);
      this.pointMeshes.push(mesh);
      this.scene.add(mesh);
    });

    this.applyTheme();
    onThemeChange(() => {
      this.applyTheme();
      this.draw();
    });

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  private buildStaticScene(): void {
    const plane = PLANE_CORNERS;
    const fill = new THREE.Mesh(new THREE.BufferGeometry(), this.planeFill);
    setPositions(fill, [plane[0], plane[1], plane[2], plane[0], plane[2], plane[3]]);
    fill.renderOrder = -1;

    const grid = lineSegments(this.gridMaterial);
    const gridPoints: Vec3[] = [];
    for (let x = PLANE.xMin; x <= PLANE.xMax; x += 0.5) gridPoints.push([x, PLANE.yMin, 1], [x, PLANE.yMax, 1]);
    for (let y = PLANE.yMin; y <= PLANE.yMax; y += 0.5) gridPoints.push([PLANE.xMin, y, 1], [PLANE.xMax, y, 1]);
    setPositions(grid, gridPoints);

    const border = lineSegments(this.borderMaterial);
    setPositions(border, plane.flatMap((p, i) => [p, plane[(i + 1) % 4]]));
    const planeLabel = label('w = 1', 'axis-label');
    planeLabel.position.set(PLANE.xMax + 0.1, PLANE.yMin, 1);
    border.add(planeLabel);

    // The plane w = 0 through O, where the points at infinity live (drawn at the same size).
    const zero = plane.map(([x, y]): Vec3 => [x, y, 0]);
    const infinity = lineSegments(this.infinityMaterial);
    setPositions(infinity, zero.flatMap((p, i) => [p, zero[(i + 1) % 4]]));
    const infinityLabel = label('w = 0', 'axis-label');
    infinityLabel.position.set(PLANE.xMax + 0.1, PLANE.yMin, 0);
    infinity.add(infinityLabel);

    const origin = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), this.highlightMesh);
    const originLabel = label('O', 'axis-label');
    originLabel.position.set(-0.1, -0.1, 0);
    origin.add(originLabel);

    const axisNames = ['x', 'y', 'w'];
    const axes = this.axisMaterials.map((m, i) => {
      const line = lineSegments(m);
      const end: Vec3 = [0, 0, 0];
      end[i] = AXIS_LENGTH;
      setPositions(line, [[0, 0, 0], end]);
      const l = label(axisNames[i], 'axis-label');
      l.position.set(...scale(end, 1.18));
      line.add(l);
      return line;
    });

    this.scene.add(fill, grid, border, infinity, origin, ...axes);
  }

  private applyTheme(): void {
    this.planeFill.color.setStyle(cssColor('--bg-sunken'));
    this.gridMaterial.color.setStyle(cssColor('--viz-grid'));
    this.borderMaterial.color.setStyle(cssColor('--fg-muted'));
    this.infinityMaterial.color.setStyle(cssColor('--fg-muted'));
    ['--axis-x', '--axis-y', '--axis-z'].forEach((token, i) => this.axisMaterials[i].color.setStyle(cssColor(token)));
    ['--line-1', '--line-2'].forEach((token, i) => {
      const color = cssColor(token);
      this.lineMaterials[i].color.setStyle(color);
      this.wedgeMaterials[i].color.setStyle(color);
      this.pointMaterials[i].color.setStyle(color);
    });
    this.rayMaterial.color.setStyle(cssColor('--viz-ray'));
    this.highlightLine.color.setStyle(cssColor('--viz-highlight'));
    this.highlightMesh.color.setStyle(cssColor('--viz-highlight'));
    this.scaledMaterial.color.setStyle(cssColor('--viz-highlight'));
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

  update(scene: RayScene): void {
    this.last = scene;
    const { points, hit } = scene;

    [scene.l1, scene.l2].forEach((l, i) => {
      const seg = clipLine(l, PLANE.xMin, PLANE.xMax, PLANE.yMin, PLANE.yMax);
      const [a, b] = seg ? seg.map(toHomogeneous) : [null, null];
      setPositions(this.imageLines[i], a && b ? [a, b] : []);
      // The line's plane through O: every ray through a point of the line lies in it.
      setPositions(this.wedges[i], a && b ? [[0, 0, 0], scale(a, W_MAX), scale(b, W_MAX)] : []);
      this.wedges[i].visible = scene.showPlanes;
    });

    const homogeneous = points.map(toHomogeneous);
    homogeneous.forEach((p, i) => this.pointMeshes[i].position.set(...p));
    setPositions(this.rays, homogeneous.flatMap((p) => [[0, 0, 0], scale(p, W_MAX)]));
    this.rays.visible = scene.showRays;

    if (hit.kind === 'point') {
      const q = hit.q[2] < 0 ? scale(hit.q, -1) : hit.q;
      setPositions(this.qRay, [[0, 0, 0], scale(normalize(q), Q_RAY_LENGTH)]);
      const onPlane = toHomogeneous(hit.p);
      const visible = Math.abs(onPlane[0]) < 8 && Math.abs(onPlane[1]) < 8;
      this.qMesh.visible = visible;
      this.qMesh.position.set(...onPlane);
    } else if (hit.kind === 'infinity') {
      // The intersection of two planes through O is a ray; for parallel lines it lies in w = 0.
      const d: Vec3 = [hit.direction[0], hit.direction[1], 0];
      setPositions(this.qRay, [scale(d, -Q_RAY_LENGTH), scale(d, Q_RAY_LENGTH)]);
      this.qMesh.visible = true;
      this.qMesh.position.set(...scale(d, Q_RAY_LENGTH));
    } else {
      setPositions(this.qRay, []);
      this.qMesh.visible = false;
    }

    const s = scene.scaled;
    const dir: Vec3 = s[2] === 0 ? normalize(s) : scale(s, 1 / s[2]);
    const reach = s[2] === 0 ? Q_RAY_LENGTH : W_MAX;
    setPositions(this.scaledRay, [scale(dir, -reach), scale(dir, reach)]);
    this.scaledMesh.position.set(...s);
    this.scaledMesh.visible = Math.hypot(...s) > 1e-9;

    this.draw();
  }

  private draw(): void {
    if (!this.last) return;
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }
}
