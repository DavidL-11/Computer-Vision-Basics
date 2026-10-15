// Top view of the rectified stereo rig: X to the right, depth Z upwards, both at the same scale. The cameras sit at
// the bottom, their rays go through the measured pixels, and each pair of rays meets in a reconstructed point.

import { cssColor, onThemeChange } from '../../src/shared/theme';
import { type Point, pixelCell, triangulate } from './triangulation';

/** Depth shown, in m. */
export const Z_MAX = 12;
/** Image planes are drawn this many canvas pixels in front of the cameras. */
const PLANE = 30;

export interface Ray {
  /** 0: left camera, 1: right camera. */
  camera: 0 | 1;
  x: number;
  color: string;
}

export interface Reconstruction {
  xL: number;
  xR: number;
  color: string;
  label: string;
}

export interface TopState {
  T: number;
  f: number;
  W: number;
  points: { p: Point; color: string; label: string }[];
  rays: Ray[];
  reconstructions: Reconstruction[];
}

export class TopView {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private last: TopState | null = null;
  private toWorld: ((x: number, y: number) => Point) | null = null;
  private toCanvas: ((p: Point) => [number, number]) | null = null;

  constructor(container: HTMLElement, onDrag: (index: number, p: Point) => void) {
    this.canvas.className = 'diagram-canvas';
    container.append(this.canvas);
    new ResizeObserver(() => this.draw()).observe(this.canvas);
    onThemeChange(() => this.draw());

    let dragging = -1;
    const at = (e: PointerEvent): [number, number] => {
      const r = this.canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.last || !this.toCanvas) return;
      const [x, y] = at(e);
      let best = 18;
      this.last.points.forEach(({ p }, i) => {
        const [px, py] = this.toCanvas!(p);
        const dist = Math.hypot(px - x, py - y);
        if (dist < best) (best = dist), (dragging = i);
      });
      if (dragging >= 0) this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (dragging < 0 || !this.toWorld) {
        this.canvas.style.cursor = this.near(at(e)) ? 'grab' : '';
        return;
      }
      onDrag(dragging, this.toWorld(...at(e)));
    });
    const end = () => (dragging = -1);
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
  }

  private near([x, y]: [number, number]): boolean {
    return !!this.last?.points.some(({ p }) => {
      const [px, py] = this.toCanvas!(p);
      return Math.hypot(px - x, py - y) < 18;
    });
  }

  render(s: TopState): void {
    this.last = s;
    this.draw();
  }

  private draw(): void {
    const s = this.last;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (!s || width === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    const { ctx } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = cssColor('--bg-elev');
    ctx.fillRect(0, 0, width, height);

    const bottom = height - 34;
    const k = (bottom - 14) / Z_MAX;
    const x0 = width / 2 - (s.T / 2) * k;
    const C = (p: Point): [number, number] => [x0 + p.X * k, bottom - p.Z * k];
    this.toCanvas = C;
    this.toWorld = (x, y) => ({ X: (x - x0) / k, Z: (bottom - y) / k });
    const far = Z_MAX * 1.2;
    const camX = [0, s.T];
    const along = (cam: 0 | 1, x: number, Z: number): Point => ({ X: camX[cam] + (x / s.f) * Z, Z });
    ctx.font = '12px system-ui, sans-serif';

    // The fields of view; where they overlap, points are visible in both images.
    const half = s.W / 2;
    ctx.fillStyle = cssColor('--accent');
    ctx.globalAlpha = 0.07;
    const overlapStart = (s.T * s.f) / (2 * half);
    ctx.beginPath();
    ctx.moveTo(...C({ X: s.T / 2, Z: overlapStart }));
    ctx.lineTo(...C(along(1, -half, far)));
    ctx.lineTo(...C(along(0, half, far)));
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = cssColor('--fg-faint');
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    for (const cam of [0, 1] as const)
      for (const x of [-half, half]) {
        ctx.moveTo(...C({ X: camX[cam], Z: 0 }));
        ctx.lineTo(...C(along(cam, x, far)));
      }
    ctx.stroke();
    ctx.setLineDash([]);

    // Pixel cells: all points that project to the same pair of pixels.
    for (const r of s.reconstructions) {
      const corners = pixelCell(s.T, s.f, r.xL, r.xR, far);
      // Far away the cell is a thin sliver along the rays, so it gets a wide outline as well.
      ctx.fillStyle = ctx.strokeStyle = cssColor(r.color);
      ctx.lineWidth = 5;
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      corners.forEach((c, i) => (i ? ctx.lineTo(...C(c)) : ctx.moveTo(...C(c))));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Rays through the measured pixels.
    ctx.lineWidth = 1.3;
    for (const r of s.rays) {
      ctx.strokeStyle = cssColor(r.color);
      ctx.beginPath();
      ctx.moveTo(...C({ X: camX[r.camera], Z: 0 }));
      ctx.lineTo(...C(along(r.camera, r.x, far)));
      ctx.stroke();
    }

    // Cameras, image planes and baseline.
    ctx.strokeStyle = cssColor('--fg');
    ctx.lineWidth = 2;
    for (const cam of [0, 1] as const) {
      const [cx, cy] = C({ X: camX[cam], Z: 0 });
      const w = (PLANE * half) / s.f;
      ctx.beginPath();
      ctx.moveTo(cx - w, cy - PLANE);
      ctx.lineTo(cx + w, cy - PLANE);
      ctx.stroke();
      ctx.fillStyle = cssColor('--fg');
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, 2 * Math.PI);
      ctx.fill();
    }
    const [lx, ly] = C({ X: 0, Z: 0 });
    const [rx] = C({ X: s.T, Z: 0 });
    ctx.strokeStyle = cssColor('--fg-muted');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(lx, ly + 12);
    ctx.lineTo(rx, ly + 12);
    ctx.moveTo(lx, ly + 8);
    ctx.lineTo(lx, ly + 16);
    ctx.moveTo(rx, ly + 8);
    ctx.lineTo(rx, ly + 16);
    ctx.stroke();
    ctx.fillStyle = cssColor('--fg-muted');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`baseline T = ${s.T.toFixed(2)} m`, (lx + rx) / 2, ly + 17);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('left', lx - 9, ly);
    ctx.textAlign = 'left';
    ctx.fillText('right', rx + 9, ly);

    // Depth scale on the left.
    ctx.textAlign = 'left';
    ctx.fillStyle = cssColor('--fg-faint');
    ctx.strokeStyle = cssColor('--viz-grid');
    for (let z = 2; z <= Z_MAX; z += 2) {
      const y = bottom - z * k;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(10, y);
      ctx.stroke();
      ctx.fillText(`${z} m`, 13, y);
    }

    // True points (draggable) and reconstructions.
    for (const { p, color, label } of s.points) {
      const [x, y] = C(p);
      ctx.fillStyle = cssColor(color);
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = cssColor('--fg');
      ctx.textAlign = 'left';
      ctx.fillText(label, x + 10, y - 2);
    }
    for (const r of s.reconstructions) {
      const q = triangulate(s.T, s.f, r.xL, r.xR);
      if (!q || q.Z > far) continue;
      const [x, y] = C(q);
      ctx.strokeStyle = cssColor(r.color);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y - 7);
      ctx.lineTo(x + 7, y);
      ctx.lineTo(x, y + 7);
      ctx.lineTo(x - 7, y);
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = cssColor(r.color);
      ctx.textAlign = 'right';
      ctx.fillText(r.label, x - 10, y - 2);
    }
  }
}
