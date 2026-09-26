import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { type CameraSnapshot, backproject } from '../../src/shared/camera';
import { type Vec3, add, mulMat3Vec, normalize, scale } from '../../src/shared/linalg';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import { EDGES, FAMILIES, type FamilyKey, GRID, IMAGE_HEIGHT, IMAGE_WIDTH } from './scene';

/** The image plane is drawn at this depth Z_c (in m) in front of the camera. */
const PLANE_DEPTH = 1.5;
const FRUSTUM_FAR = 8;
const MAX_RAY_LENGTH = 60;

function lineSegments(material: THREE.LineBasicMaterial | THREE.LineDashedMaterial, points: Vec3[] = []): THREE.LineSegments {
  const lines = new THREE.LineSegments(new THREE.BufferGeometry(), material);
  setSegments(lines, points);
  return lines;
}

function setSegments(lines: THREE.LineSegments, points: Vec3[]): void {
  lines.geometry.dispose();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
  lines.geometry = geometry;
  if (lines.material instanceof THREE.LineDashedMaterial) lines.computeLineDistances();
}

function label(text: string): CSS2DObject {
  const div = document.createElement('div');
  div.className = 'scene-label';
  div.textContent = text;
  return new CSS2DObject(div);
}

export interface WorldOptions {
  families: Record<FamilyKey, boolean>;
  directionRays: boolean;
}

export class WorldView {
  private renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  private labelRenderer = new CSS2DRenderer();
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
  private controls: OrbitControls;

  private gridMaterial = new THREE.LineBasicMaterial();
  private familyMaterials = FAMILIES.map(() => new THREE.LineBasicMaterial());
  private rayMaterials = FAMILIES.map(() => new THREE.LineDashedMaterial({ dashSize: 0.4, gapSize: 0.3 }));
  private hitMaterials = FAMILIES.map(() => new THREE.MeshBasicMaterial());
  private frustumMaterial = new THREE.LineBasicMaterial();
  private frustumFarMaterial = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.25 });
  private centerMaterial = new THREE.MeshBasicMaterial();

  private familyLines = FAMILIES.map((f, i) =>
    lineSegments(
      this.familyMaterials[i],
      EDGES.filter((e) => e.family === f.key).flatMap((e) => [e.a, e.b]),
    ),
  );
  private rays = FAMILIES.map((_, i) => lineSegments(this.rayMaterials[i]));
  private hits = FAMILIES.map((_, i) => new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), this.hitMaterials[i]));
  private frustum = lineSegments(this.frustumMaterial);
  private frustumFar = lineSegments(this.frustumFarMaterial);
  private center = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), this.centerMaterial);

  constructor(private container: HTMLElement) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.append(this.renderer.domElement);
    this.labelRenderer.domElement.className = 'label-layer';
    container.append(this.labelRenderer.domElement);

    this.camera.up.set(0, 0, 1);
    this.camera.position.set(9, -17, 13);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 8, 0);
    this.controls.addEventListener('change', () => this.draw());

    this.scene.add(lineSegments(this.gridMaterial, GRID.flat()));
    this.scene.add(...this.familyLines, ...this.rays, ...this.hits, this.frustum, this.frustumFar, this.center);
    const centerLabel = label('camera C');
    centerLabel.position.set(0, 0, 0.45);
    this.center.add(centerLabel);

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
    FAMILIES.forEach((f, i) => {
      this.familyMaterials[i].color.setStyle(cssColor(f.color));
      this.rayMaterials[i].color.setStyle(cssColor(f.color));
      this.hitMaterials[i].color.setStyle(cssColor(f.color));
    });
    this.frustumMaterial.color.setStyle(cssColor('--viz-frustum'));
    this.frustumFarMaterial.color.setStyle(cssColor('--viz-frustum'));
    this.centerMaterial.color.setStyle(cssColor('--viz-highlight'));
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

  update(cam: CameraSnapshot, options: WorldOptions): void {
    const { K, R, t, C } = cam;
    const corners: [number, number][] = [
      [0, 0],
      [IMAGE_WIDTH, 0],
      [IMAGE_WIDTH, IMAGE_HEIGHT],
      [0, IMAGE_HEIGHT],
    ];
    const near = corners.map(([u, v]) => backproject(K, R, t, u, v, PLANE_DEPTH));
    const far = corners.map(([u, v]) => backproject(K, R, t, u, v, FRUSTUM_FAR));
    setSegments(this.frustum, [...near.flatMap((p) => [C, p]), ...near.flatMap((p, i) => [p, near[(i + 1) % 4]])]);
    setSegments(this.frustumFar, near.flatMap((p, i) => [p, far[i]]));
    this.center.position.set(...C);

    // A ray from C parallel to a line family meets the image plane in the family's vanishing point.
    FAMILIES.forEach((f, i) => {
      const shown = options.families[f.key];
      this.familyLines[i].visible = shown;
      const d = normalize(f.d);
      const forward = mulMat3Vec(R, d)[2];
      // Of the two opposite directions, the one in front of the camera (if any) leads to the vanishing point.
      const dir = forward < 0 ? scale(d, -1) : d;
      const hit = PLANE_DEPTH / Math.abs(forward);
      setSegments(this.rays[i], [C, add(C, scale(dir, Math.min(MAX_RAY_LENGTH, Math.max(12, 1.3 * hit))))]);
      this.rays[i].visible = shown && options.directionRays;
      this.hits[i].visible = shown && options.directionRays && hit < MAX_RAY_LENGTH;
      this.hits[i].position.set(...add(C, scale(dir, Math.min(hit, MAX_RAY_LENGTH))));
    });

    this.draw();
  }

  private draw(): void {
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }
}
