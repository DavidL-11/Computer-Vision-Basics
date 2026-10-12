// The points and both fitted lines, in math orientation (y up) at equal scale on both axes, so perpendicular
// residuals look perpendicular.

import { PlotFrame } from '../../src/shared/plot';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import { type TotalFit, type Vec2, type VerticalFit, perpendicularFoot, verticalFoot } from './fit';

const WIDTH = 640;
const HEIGHT = 480;
const PAD = { left: 30, right: 12, top: 12, bottom: 24 };
const AREA_W = WIDTH - PAD.left - PAD.right;
const AREA_H = HEIGHT - PAD.top - PAD.bottom;
export const X_RANGE = 6;
export const Y_RANGE = (X_RANGE * AREA_H) / AREA_W;
const HIT = 12;

export interface FitScene {
  points: Vec2[];
  vls: VerticalFit;
  tls: TotalFit;
  showVLS: boolean;
  showTLS: boolean;
  showResiduals: boolean;
}

export interface FitEditing {
  add(p: Vec2): number;
  move(index: number, p: Vec2): void;
  remove(index: number): void;
}

export class FitView {
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private frame: PlotFrame;
  private last: FitScene | null = null;
  private active = -1;

  constructor(container: HTMLElement, edit: FitEditing) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = WIDTH * dpr;
    this.canvas.height = HEIGHT * dpr;
    this.canvas.className = 'fit-canvas';
    this.canvas.style.aspectRatio = `${WIDTH} / ${HEIGHT}`;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(dpr, dpr);
    this.frame = new PlotFrame(this.ctx, { x: [-X_RANGE, X_RANGE], y: [-Y_RANGE, Y_RANGE] }, PAD.left, PAD.top, AREA_W, AREA_H);
    container.append(this.canvas);

    const toCanvas = (e: PointerEvent | MouseEvent): Vec2 => {
      const rect = this.canvas.getBoundingClientRect();
      return [((e.clientX - rect.left) / rect.width) * WIDTH, ((e.clientY - rect.top) / rect.height) * HEIGHT];
    };
    const toData = ([u, v]: Vec2): Vec2 => {
      const clamp = (x: number, r: number) => Math.max(-r, Math.min(r, x));
      return [
        clamp(-X_RANGE + ((u - PAD.left) / AREA_W) * 2 * X_RANGE, X_RANGE),
        clamp(Y_RANGE - ((v - PAD.top) / AREA_H) * 2 * Y_RANGE, Y_RANGE),
      ];
    };
    const hit = (e: PointerEvent | MouseEvent): number => {
      if (!this.last) return -1;
      const [u, v] = toCanvas(e);
      let best = -1;
      let bestD = HIT;
      this.last.points.forEach(([x, y], i) => {
        const d = Math.hypot(this.frame.X(x) - u, this.frame.Y(y) - v);
        if (d < bestD) [best, bestD] = [i, d];
      });
      return best;
    };

    this.canvas.addEventListener('pointerdown', (e) => {
      const i = hit(e);
      if (i >= 0 && e.shiftKey) {
        edit.remove(i);
        return;
      }
      this.canvas.setPointerCapture(e.pointerId);
      this.active = i >= 0 ? i : edit.add(toData(toCanvas(e)));
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.canvas.hasPointerCapture(e.pointerId) && this.active >= 0) edit.move(this.active, toData(toCanvas(e)));
      else this.canvas.style.cursor = hit(e) >= 0 ? 'grab' : 'crosshair';
    });
    this.canvas.addEventListener('pointerup', () => (this.active = -1));
    this.canvas.addEventListener('dblclick', (e) => {
      const i = hit(e);
      if (i >= 0) edit.remove(i);
    });
    onThemeChange(() => this.last && this.render(this.last));
  }

  render(scene: FitScene): void {
    this.last = scene;
    const { ctx, frame: f } = this;
    const { points, vls, tls } = scene;
    ctx.fillStyle = cssColor('--bg-elev');
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    const range = (r: number) => Array.from({ length: 2 * Math.floor(r) + 1 }, (_, i) => i - Math.floor(r));
    f.grid(range(X_RANGE), range(Y_RANGE));

    if (scene.showVLS && vls.p) {
      const p = vls.p;
      if (scene.showResiduals) this.residuals(points.map((q) => [q, verticalFoot(p, q)]), '--vls');
      f.line((x) => p[0] * x + p[1], '--vls', { width: 2.5 });
    }
    if (scene.showTLS) {
      const [a, b] = tls.normal;
      const [mx, my] = tls.mean;
      if (scene.showResiduals) this.residuals(points.map((q) => [q, perpendicularFoot(tls, q)]), '--tls');
      f.line(
        [
          [mx + 30 * b, my - 30 * a],
          [mx - 30 * b, my + 30 * a],
        ],
        '--tls',
        { width: 2.5 },
      );
      this.centroid(tls.mean);
    }

    ctx.fillStyle = cssColor('--fg');
    for (const [x, y] of points) {
      ctx.beginPath();
      ctx.arc(f.X(x), f.Y(y), 5, 0, 2 * Math.PI);
      ctx.fill();
    }

    if (scene.showVLS && !vls.p) {
      ctx.fillStyle = cssColor('--vls');
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('vertical least squares: AᵀA is singular, no line y = mx + b', PAD.left + 8, PAD.top + 8);
    }
  }

  private residuals(segments: [Vec2, Vec2][], color: string): void {
    const { ctx, frame: f } = this;
    ctx.save();
    ctx.strokeStyle = cssColor(color);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    for (const [p, q] of segments) {
      ctx.moveTo(f.X(p[0]), f.Y(p[1]));
      ctx.lineTo(f.X(q[0]), f.Y(q[1]));
    }
    ctx.stroke();
    ctx.restore();
  }

  private centroid([x, y]: Vec2): void {
    const { ctx, frame: f } = this;
    const [u, v] = [f.X(x), f.Y(y)];
    ctx.strokeStyle = cssColor('--tls');
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(u - 6, v - 6);
    ctx.lineTo(u + 6, v + 6);
    ctx.moveTo(u - 6, v + 6);
    ctx.lineTo(u + 6, v - 6);
    ctx.stroke();
  }
}
