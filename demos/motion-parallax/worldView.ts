import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { type Mat3, type Vec3, add, inverse3, mulMat3Vec, scale, transpose3 } from '../../src/shared/linalg';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import type { Pose } from './egomotion';
import { GROUND, IMAGE_HEIGHT, IMAGE_WIDTH, type Kind, POINTS, POST_SEGMENTS } from './scene';

/** The image plane is drawn at this depth Z_c (in m) in front of the camera. */
const PLANE_DEPTH = 1.2;
const FRUSTUM_FAR = 6;
/** Points farther away than this (the ridge) are left out of the 3D view. */
const SHOWN_DISTANCE = 100;

function lineSegments(material: THREE.LineBasicMaterial, points: Vec3[] = []): THREE.LineSegments {
  const lines = new THREE.LineSegments(new THREE.BufferGeometry(), material);
  setSegments(lines, points);
  return lines;
}

function setSegments(lines: THREE.Line, points: Vec3[]): void {
  lines.geometry.dispose();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
  lines.geometry = geometry;
}

const KIND_COLORS: Record<Kind, string> = { ground: '--accent', post: '--viz-object', far: '--viz-points' };

function groundGrid(): Vec3[] {
  const out: Vec3[] = [];
  for (let x = GROUND.x[0]; x <= GROUND.x[1]; x += GROUND.step) out.push([x, GROUND.y[0], 0], [x, GROUND.y[1], 0]);
  for (let y = GROUND.y[0]; y <= GROUND.y[1]; y += GROUND.step) out.push([GROUND.x[0], y, 0], [GROUND.x[1], y, 0]);
  return out;
}

export class WorldView {
  private renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);

  private gridMaterial = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.5 });
  private postMaterial = new THREE.LineBasicMaterial();
  private pointMaterials = Object.fromEntries((Object.keys(KIND_COLORS) as Kind[]).map((k) => [k, new THREE.PointsMaterial({ size: 4, sizeAttenuation: false })])) as Record<
    Kind,
    THREE.PointsMaterial
  >;
  private frustumMaterial = new THREE.LineBasicMaterial();
  private frustumFarMaterial = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.25 });
  private pathMaterial = new THREE.LineBasicMaterial();
  private centerMaterial = new THREE.MeshBasicMaterial();
  private selectedMaterial = new THREE.MeshBasicMaterial();

  private frustum = lineSegments(this.frustumMaterial);
  private frustumFar = lineSegments(this.frustumFarMaterial);
  private path = new THREE.Line(new THREE.BufferGeometry(), this.pathMaterial);
  private center = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), this.centerMaterial);
  private selected = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 12), this.selectedMaterial);

  constructor(private container: HTMLElement) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.append(this.renderer.domElement);

    this.camera.up.set(0, 0, 1);
    this.camera.position.set(-16, -14, 16);
    const controls = new OrbitControls(this.camera, this.renderer.domElement);
    controls.target.set(0, 14, 0);
    controls.update();
    controls.addEventListener('change', () => this.draw());

    this.scene.add(lineSegments(this.gridMaterial, groundGrid()), lineSegments(this.postMaterial, POST_SEGMENTS.flat()));
    for (const kind of Object.keys(KIND_COLORS) as Kind[]) {
      const pts = POINTS.filter((p) => p.kind === kind && Math.hypot(p.X[0], p.X[1]) < SHOWN_DISTANCE).map((p) => p.X);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
      this.scene.add(new THREE.Points(geometry, this.pointMaterials[kind]));
    }
    this.scene.add(this.frustum, this.frustumFar, this.path, this.center, this.selected);

    this.applyTheme();
    onThemeChange(() => {
      this.applyTheme();
      this.draw();
    });
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  private applyTheme(): void {
    this.gridMaterial.color.setStyle(cssColor('--fg-faint'));
    this.postMaterial.color.setStyle(cssColor('--viz-object'));
    for (const [kind, token] of Object.entries(KIND_COLORS)) this.pointMaterials[kind as Kind].color.setStyle(cssColor(token));
    this.frustumMaterial.color.setStyle(cssColor('--viz-frustum'));
    this.frustumFarMaterial.color.setStyle(cssColor('--viz-frustum'));
    this.pathMaterial.color.setStyle(cssColor('--viz-highlight'));
    this.centerMaterial.color.setStyle(cssColor('--viz-highlight'));
    this.selectedMaterial.color.setStyle(cssColor('--viz-highlight'));
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.draw();
  }

  /** The camera at `pose`, the path of its center over the coming frames, and the selected point. */
  update(K: Mat3, pose: Pose, path: Vec3[], selected: Vec3 | null): void {
    const Ki = inverse3(K);
    const Rt = transpose3(pose.R);
    const toWorld = (u: number, v: number, depth: number) => add(mulMat3Vec(Rt, scale(mulMat3Vec(Ki, [u, v, 1]), depth)), pose.C);
    const corners: [number, number][] = [
      [0, 0],
      [IMAGE_WIDTH, 0],
      [IMAGE_WIDTH, IMAGE_HEIGHT],
      [0, IMAGE_HEIGHT],
    ];
    const near = corners.map(([u, v]) => toWorld(u, v, PLANE_DEPTH));
    const far = corners.map(([u, v]) => toWorld(u, v, FRUSTUM_FAR));
    setSegments(this.frustum, [...near.flatMap((p) => [pose.C, p]), ...near.flatMap((p, i) => [p, near[(i + 1) % 4]])]);
    setSegments(this.frustumFar, near.flatMap((p, i) => [p, far[i]]));
    setSegments(this.path, path);
    this.center.position.set(...pose.C);
    this.selected.visible = selected !== null && Math.hypot(selected[0], selected[1]) < SHOWN_DISTANCE;
    if (selected) this.selected.position.set(...selected);
    this.draw();
  }

  private draw(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
