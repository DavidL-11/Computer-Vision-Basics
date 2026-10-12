// The unit circle through the three steps of A = U Σ Vᵀ, one panel per step, all at the same scale.

import { cssColor, onThemeChange } from '../../src/shared/theme';
import { type SVD2, type Vec2, stages } from './svd2';

const PANEL = 250;
const TITLE = 30;
const WIDTH = 4 * PANEL;
const HEIGHT = PANEL + TITLE;
const CIRCLE: Vec2[] = Array.from({ length: 121 }, (_, i) => [Math.cos((i * Math.PI) / 60), Math.sin((i * Math.PI) / 60)]);
/** A quarter arc from e₁ to e₂ with an arrow: it runs counterclockwise unless a step mirrors the plane. */
const ARC: Vec2[] = Array.from({ length: 31 }, (_, i) => [0.72 * Math.cos((i * Math.PI) / 60), 0.72 * Math.sin((i * Math.PI) / 60)]);

export interface StagesScene {
  s: SVD2;
  b: Vec2;
  x: Vec2;
}

export class StagesView {
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private last: StagesScene | null = null;
  /** Data units from the center to the panel border. */
  range = 1.5;

  constructor(container: HTMLElement, onPick: (b: Vec2) => void) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = WIDTH * dpr;
    this.canvas.height = HEIGHT * dpr;
    this.canvas.className = 'stages-canvas';
    this.canvas.style.aspectRatio = `${WIDTH} / ${HEIGHT}`;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(dpr, dpr);
    container.append(this.canvas);

    // Only the last panel (the range of A) takes clicks.
    const pick = (e: PointerEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * WIDTH - 3 * PANEL;
      const py = ((e.clientY - rect.top) / rect.height) * HEIGHT - TITLE;
      const k = PANEL / 2 / this.range;
      const clamp = (v: number) => Math.max(-this.range, Math.min(this.range, v));
      onPick([clamp((px - PANEL / 2) / k), clamp(-(py - PANEL / 2) / k)]);
    };
    const inLast = (e: PointerEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      return (e.clientX - rect.left) / rect.width >= 0.75;
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!inLast(e)) return;
      this.canvas.setPointerCapture(e.pointerId);
      pick(e);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      this.canvas.style.cursor = inLast(e) ? 'crosshair' : 'default';
      if (this.canvas.hasPointerCapture(e.pointerId)) pick(e);
    });
    onThemeChange(() => this.last && this.render(this.last));
  }

  render(scene: StagesScene): void {
    this.last = scene;
    const { ctx } = this;
    const { s } = scene;
    this.range = Math.max(1.6, 1.25 * s.sigma[0]);
    ctx.fillStyle = cssColor('--bg-elev');
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const titles = ['x on the unit circle', 'Vᵀx: rotate', 'ΣVᵀx: scale by σ₁, σ₂', s.mirrored ? 'UΣVᵀx = Ax: rotate + mirror' : 'UΣVᵀx = Ax: rotate'];
    const circle = CIRCLE.map((p) => stages(s, p));
    const arc = ARC.map((p) => stages(s, p));
    const v1: Vec2 = [s.V[0], s.V[2]];
    const v2: Vec2 = [s.V[1], s.V[3]];
    const vectors = [v1, v2].map((v) => stages(s, v));
    const x = stages(s, scene.x);

    for (let k = 0; k < 4; k++) {
      const P = this.panel(k);
      if (k > 0) {
        ctx.strokeStyle = cssColor('--border');
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(k * PANEL, 8);
        ctx.lineTo(k * PANEL, HEIGHT - 8);
        ctx.stroke();
      }
      ctx.fillStyle = cssColor('--fg');
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(titles[k], k * PANEL + PANEL / 2, TITLE / 2 + 2);
      ctx.textAlign = 'left';

      this.axes(P);
      const shape = circle.map((st) => st[k]);
      ctx.fillStyle = cssColor('--accent');
      ctx.globalAlpha = 0.12;
      this.path(P, shape, true);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = cssColor('--accent');
      ctx.lineWidth = 2;
      this.path(P, shape, true);
      ctx.stroke();
      this.arcArrow(P, arc.map((st) => st[k]));

      const names = [
        ['v₁', 'v₂'],
        ['e₁', 'e₂'],
        ['σ₁e₁', 'σ₂e₂'],
        ['σ₁u₁', 'σ₂u₂'],
      ][k];
      vectors.forEach((st, i) => this.arrow(P, st[k], cssColor(i === 0 ? '--sv-1' : '--sv-2'), names[i]));
      // Ax only gets its own label when it differs from b.
      const apart = Math.hypot(x[3][0] - scene.b[0], x[3][1] - scene.b[1]) > 0.08 * this.range;
      this.point(P, x[k], k === 0 ? 'x' : k === 3 && apart ? 'Ax' : '', k === 3 ? 'ring' : 'dot');
    }
    const P = this.panel(3);
    this.point(P, scene.b, 'b', 'dot');
  }

  /** Data → canvas coordinates of panel k (y up). */
  private panel(k: number) {
    const cx = k * PANEL + PANEL / 2;
    const cy = TITLE + PANEL / 2;
    const scale = PANEL / 2 / this.range;
    return { X: (x: number) => cx + x * scale, Y: (y: number) => cy - y * scale, cx, cy };
  }

  private axes(P: ReturnType<StagesView['panel']>): void {
    const { ctx } = this;
    const r = PANEL / 2 - 10;
    ctx.strokeStyle = cssColor('--viz-grid');
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let v = -Math.floor(this.range); v <= this.range; v++) {
      if (v === 0) continue;
      ctx.moveTo(P.X(v), P.cy - r);
      ctx.lineTo(P.X(v), P.cy + r);
      ctx.moveTo(P.cx - r, P.Y(v));
      ctx.lineTo(P.cx + r, P.Y(v));
    }
    ctx.stroke();
    ctx.strokeStyle = cssColor('--fg-faint');
    ctx.beginPath();
    ctx.moveTo(P.cx - r, P.cy);
    ctx.lineTo(P.cx + r, P.cy);
    ctx.moveTo(P.cx, P.cy - r);
    ctx.lineTo(P.cx, P.cy + r);
    ctx.stroke();
  }

  private path(P: ReturnType<StagesView['panel']>, points: Vec2[], close = false): void {
    const { ctx } = this;
    ctx.beginPath();
    points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(P.X(x), P.Y(y)) : ctx.lineTo(P.X(x), P.Y(y))));
    if (close) ctx.closePath();
  }

  private arcArrow(P: ReturnType<StagesView['panel']>, points: Vec2[]): void {
    const { ctx } = this;
    const color = cssColor('--fg-muted');
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    this.path(P, points);
    ctx.stroke();
    const [a, b] = points.slice(-2);
    const dx = P.X(b[0]) - P.X(a[0]);
    const dy = P.Y(b[1]) - P.Y(a[1]);
    if (Math.hypot(dx, dy) < 1e-6) return;
    this.head(P.X(b[0]), P.Y(b[1]), Math.atan2(dy, dx), color, 8);
  }

  private arrow(P: ReturnType<StagesView['panel']>, [x, y]: Vec2, color: string, name: string): void {
    const { ctx } = this;
    const [u, v] = [P.X(x), P.Y(y)];
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(P.cx, P.cy);
    ctx.lineTo(u, v);
    ctx.stroke();
    const len = Math.hypot(u - P.cx, v - P.cy);
    if (len > 4) this.head(u, v, Math.atan2(v - P.cy, u - P.cx), color, 10);
    ctx.fillStyle = color;
    ctx.font = '600 13px system-ui, sans-serif';
    // The label sits beyond the arrow tip, or next to the origin when the vector has (almost) vanished.
    const d = len > 4 ? [(u - P.cx) / len, (v - P.cy) / len] : [0.7, 0.7];
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(name).width;
    const x0 = d[0] >= 0 ? u + 12 * d[0] : u + 12 * d[0] - w;
    // Kept inside the panel, so long vectors don't push their label into the next one.
    const left = P.cx - PANEL / 2 + 4;
    const lx = Math.max(left, Math.min(left + PANEL - 8 - w, x0));
    // A label pushed back from the panel border moves above the tip instead of covering it.
    ctx.fillText(name, lx, Math.abs(lx - x0) > 2 ? v - 14 : v + 12 * d[1]);
  }

  private point(P: ReturnType<StagesView['panel']>, [x, y]: Vec2, name: string, style: 'dot' | 'ring'): void {
    const { ctx } = this;
    const lim = PANEL / 2 - 8;
    let u = P.X(x) - P.cx;
    let v = P.Y(y) - P.cy;
    const outside = Math.abs(u) > lim || Math.abs(v) > lim;
    if (outside) {
      const f = lim / Math.max(Math.abs(u), Math.abs(v));
      u *= f;
      v *= f;
    }
    const color = cssColor('--viz-highlight');
    ctx.fillStyle = ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (outside) {
      this.head(P.cx + u, P.cy + v, Math.atan2(v, u), color, 12);
    } else {
      ctx.arc(P.cx + u, P.cy + v, style === 'ring' ? 7.5 : 5, 0, 2 * Math.PI);
      if (style === 'ring') ctx.stroke();
      else ctx.fill();
    }
    if (!name) return;
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.textBaseline = 'bottom';
    ctx.textAlign = u > PANEL / 2 - 50 ? 'right' : 'left';
    ctx.fillText(outside ? `${name} (outside)` : name, P.cx + u + (ctx.textAlign === 'right' ? -9 : 9), P.cy + v - 7);
    ctx.textAlign = 'left';
  }

  private head(x: number, y: number, angle: number, color: string, size: number): void {
    const { ctx } = this;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - size * Math.cos(angle - 0.4), y - size * Math.sin(angle - 0.4));
    ctx.lineTo(x - size * Math.cos(angle + 0.4), y - size * Math.sin(angle + 0.4));
    ctx.closePath();
    ctx.fill();
  }
}
