// The frustum is built by back-projecting the image corners with our own K, R, t,
// so skew and principal-point offsets show up exactly as in the math.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { type Vec3, add, scale, transpose3 } from '../../src/shared/linalg';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import { type CameraSnapshot, backproject, project } from '../../src/shared/camera';
import { IMAGE_HEIGHT, IMAGE_WIDTH, boardSquares, cubeEdges, cubePoints, sceneCenter, worldAxes } from './scene';

/** Scale for drawing the image plane at distance f: fixed sensor size, f moves the plane. */
export const PIXELS_PER_UNIT = 500;
const FRUSTUM_FAR = 5;
const CAMERA_AXIS_LENGTH = 0.5;

export interface DisplayOptions {
  showFrustum: boolean;
  showImagePlane: boolean;
  showRays: boolean;
}

function lineSegments(material: THREE.LineBasicMaterial): THREE.LineSegments {
  return new THREE.LineSegments(new THREE.BufferGeometry(), material);
}

function setSegments(lines: THREE.LineSegments, points: Vec3[]): void {
  lines.geometry.dispose();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
  lines.geometry = geometry;
}

function label(text: string, className: string): CSS2DObject {
  const div = document.createElement('div');
  div.className = `scene-label ${className}`;
  div.textContent = text;
  return new CSS2DObject(div);
}

export class WorldView {
  private renderer: THREE.WebGLRenderer;
  private labelRenderer = new CSS2DRenderer();
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.05, 200);
  private controls: OrbitControls;

  private boardDark = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  private boardLight = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  private axisMaterials = worldAxes.map(() => new THREE.LineBasicMaterial());
  private cubeMaterial = new THREE.LineBasicMaterial();
  private pointMaterial = new THREE.MeshBasicMaterial();
  private highlightMaterial = new THREE.MeshBasicMaterial();
  private pointMeshes: THREE.Mesh[] = [];
  private pointLabels: CSS2DObject[] = [];

  private frustumMaterial = new THREE.LineBasicMaterial();
  private frustumFarMaterial = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.25 });
  private rayMaterial = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.55 });
  private selectedRayMaterial = new THREE.LineBasicMaterial();
  private frustum = lineSegments(this.frustumMaterial);
  private frustumFar = lineSegments(this.frustumFarMaterial);
  private rays = lineSegments(this.rayMaterial);
  private selectedRay = lineSegments(this.selectedRayMaterial);
  private camAxes = worldAxes.map((_, i) => lineSegments(this.axisMaterials[i]));
  private center = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), this.highlightMaterial);
  private centerLabel = label('camera C', 'camera-label');
  private imagePlane: THREE.Mesh;
  private imageTexture: THREE.CanvasTexture;

  private last: { cam: CameraSnapshot; selected: number; display: DisplayOptions } | null = null;

  constructor(
    private container: HTMLElement,
    sensorCanvas: HTMLCanvasElement,
    onSelect: (index: number) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.append(this.renderer.domElement);
    this.labelRenderer.domElement.className = 'label-layer';
    container.append(this.labelRenderer.domElement);

    this.camera.up.set(0, 0, 1);
    this.camera.position.set(-5.2, -5.8, 5.2);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(sceneCenter[0] - 0.7, sceneCenter[1] - 1, 0.8);
    this.controls.enableDamping = false;
    this.controls.addEventListener('change', () => this.draw());

    this.imageTexture = new THREE.CanvasTexture(sensorCanvas);
    this.imageTexture.colorSpace = THREE.SRGBColorSpace;
    this.imagePlane = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ map: this.imageTexture, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }),
    );

    this.buildStaticScene();
    this.scene.add(
      this.frustum,
      this.frustumFar,
      this.rays,
      this.selectedRay,
      this.imagePlane,
      this.center,
      ...this.camAxes,
    );
    this.center.add(this.centerLabel);
    this.centerLabel.position.set(0, 0, 0.18);

    this.setupPicking(onSelect);
    this.applyTheme();
    onThemeChange(() => {
      this.applyTheme();
      this.draw();
    });

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  private buildStaticScene(): void {
    for (const dark of [true, false]) {
      const positions: number[] = [];
      for (const sq of boardSquares.filter((s) => s.dark === dark)) {
        const [a, b, c, d] = sq.corners;
        positions.push(...a, ...b, ...c, ...a, ...c, ...d);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const mesh = new THREE.Mesh(geometry, dark ? this.boardDark : this.boardLight);
      mesh.renderOrder = -1;
      this.scene.add(mesh);
    }

    const axisNames = ['X', 'Y', 'Z'];
    worldAxes.forEach(([end], i) => {
      const line = lineSegments(this.axisMaterials[i]);
      setSegments(line, [[0, 0, 0], end]);
      // Avoids z-fighting with the board.
      line.position.z = 0.003;
      const l = label(axisNames[i], 'axis-label');
      l.position.set(...scale(end, 1.12));
      line.add(l);
      this.scene.add(line);
    });

    const cube = lineSegments(this.cubeMaterial);
    setSegments(
      cube,
      cubeEdges.flatMap(([a, b]) => [cubePoints[a].X, cubePoints[b].X]),
    );
    this.scene.add(cube);

    const sphere = new THREE.SphereGeometry(0.045, 16, 12);
    cubePoints.forEach(({ X, label: text }, i) => {
      const mesh = new THREE.Mesh(sphere, this.pointMaterial);
      mesh.position.set(...X);
      mesh.userData.index = i;
      const l = label(text, 'point-label');
      l.position.set(0.09, 0.09, 0.09);
      mesh.add(l);
      this.pointMeshes.push(mesh);
      this.pointLabels.push(l);
      this.scene.add(mesh);
    });
  }

  /** Only a click without dragging selects, so orbiting doesn't change the selection. */
  private setupPicking(onSelect: (index: number) => void): void {
    const raycaster = new THREE.Raycaster();
    const el = this.renderer.domElement;
    let down: { x: number; y: number } | null = null;
    el.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
    el.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      const rect = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, this.camera);
      // Ray-to-center distance with a threshold well above the sphere radius, so vertices are easy to hit.
      const hit = this.pointMeshes
        .map((m) => ({ m, d: raycaster.ray.distanceToPoint(m.position) }))
        .filter(({ d }) => d < 0.12)
        .sort((a, b) => a.d - b.d)[0];
      if (hit) onSelect(hit.m.userData.index as number);
    });
  }

  private applyTheme(): void {
    this.boardDark.color.setStyle(cssColor('--board-dark'));
    this.boardLight.color.setStyle(cssColor('--board-light'));
    worldAxes.forEach(([, color], i) => this.axisMaterials[i].color.setStyle(cssColor(color)));
    this.cubeMaterial.color.setStyle(cssColor('--viz-object'));
    this.pointMaterial.color.setStyle(cssColor('--viz-points'));
    this.highlightMaterial.color.setStyle(cssColor('--viz-highlight'));
    this.frustumMaterial.color.setStyle(cssColor('--viz-frustum'));
    this.frustumFarMaterial.color.setStyle(cssColor('--viz-frustum'));
    this.rayMaterial.color.setStyle(cssColor('--viz-ray'));
    this.selectedRayMaterial.color.setStyle(cssColor('--viz-highlight'));
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

  update(cam: CameraSnapshot, selected: number, display: DisplayOptions): void {
    this.last = { cam, selected, display };
    const { K, R, t, C, intrinsics } = cam;

    const planeDepth = intrinsics.fx / PIXELS_PER_UNIT;
    const pixelCorners: [number, number][] = [
      [0, 0],
      [IMAGE_WIDTH, 0],
      [IMAGE_WIDTH, IMAGE_HEIGHT],
      [0, IMAGE_HEIGHT],
    ];
    const near = pixelCorners.map(([u, v]) => backproject(K, R, t, u, v, planeDepth));
    const far = pixelCorners.map(([u, v]) => backproject(K, R, t, u, v, FRUSTUM_FAR));

    setSegments(this.frustum, [
      ...near.flatMap((p) => [C, p]),
      ...near.flatMap((p, i) => [p, near[(i + 1) % 4]]),
    ]);
    setSegments(this.frustumFar, near.flatMap((p, i) => [p, far[i]]));
    this.frustum.visible = display.showFrustum;
    this.frustumFar.visible = display.showFrustum;

    // The virtual (upright) image plane in front of C, not the inverted sensor behind it.
    const planeGeometry = new THREE.BufferGeometry();
    planeGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([...near[0], ...near[1], ...near[2], ...near[0], ...near[2], ...near[3]], 3),
    );
    // CanvasTexture has flipY = true: v = 1 is the top row of the canvas.
    planeGeometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0], 2));
    this.imagePlane.geometry.dispose();
    this.imagePlane.geometry = planeGeometry;
    this.imagePlane.visible = display.showImagePlane;
    this.imageTexture.needsUpdate = true;

    // Rows of R are the camera axes expressed in world coordinates.
    const Rt = transpose3(R);
    this.camAxes.forEach((line, i) => {
      const axis: Vec3 = [Rt[i], Rt[3 + i], Rt[6 + i]];
      setSegments(line, [C, add(C, scale(axis, CAMERA_AXIS_LENGTH))]);
    });
    this.center.position.set(...C);

    const visible = cubePoints.map(({ X }) => project(K, R, t, X).inFront);
    setSegments(
      this.rays,
      cubePoints.flatMap(({ X }, i) => (visible[i] && i !== selected ? [X, C] : [])),
    );
    this.rays.visible = display.showRays;
    setSegments(this.selectedRay, visible[selected] ? [cubePoints[selected].X, C] : []);

    this.pointMeshes.forEach((m, i) => {
      m.material = i === selected ? this.highlightMaterial : this.pointMaterial;
      m.scale.setScalar(i === selected ? 1.6 : 1);
      this.pointLabels[i].element.classList.toggle('selected', i === selected);
    });

    this.draw();
  }

  private draw(): void {
    if (!this.last) return;
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }
}
