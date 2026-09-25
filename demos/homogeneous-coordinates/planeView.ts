import type { Vec3 } from '../../src/shared/linalg';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import { type Intersection, type Vec2, clipLine } from './homogeneous';

/** Visible part of the plane w = 1 (x right, y down). */
export const PLANE = { xMin: -2, xMax: 2, yMin: -1.5, yMax: 1.5 };

const PX_PER_UNIT = 160;
const WIDTH = (PLANE.xMax - PLANE.xMin) * PX_PER_UNIT;
const HEIGHT = (PLANE.yMax - PLANE.yMin) * PX_PER_UNIT;
const PICK_RADIUS = 18;

export const POINT_NAMES = ['p₁', 'p₂', 'p₃', 'p₄'];

export interface PlaneScene {
  points: Vec2[];
  l1: Vec3;
  l2: Vec3;
  hit: Intersection;
}

type Palette = Record<'bg' | 'grid' | 'axis' | 'fg' | 'muted' | 'line1' | 'line2' | 'points' | 'highlight', string>;

function readPalette(): Palette {
  return {
    bg: cssColor('--bg-elev'),
    grid: cssColor('--viz-grid'),
    axis: cssColor('--fg-faint'),
    fg: cssColor('--fg'),
    muted: cssColor('--fg-muted'),
    line1: cssColor('--line-1'),
    line2: cssColor('--line-2'),
    points: cssColor('--viz-points'),
    highlight: cssColor('--viz-highlight'),
  };
}

const toPx = ([x, y]: Vec2): Vec2 => [(x - PLANE.xMin) * PX_PER_UNIT, (y - PLANE.yMin) * PX_PER_UNIT];

export class PlaneView {
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private palette = readPalette();
  private last: PlaneScene | null = null;
  private dragging = -1;

  constructor(container: HTMLElement, onDrag: (index: number, p: Vec2) => void) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = WIDTH * dpr;
    this.canvas.height = HEIGHT * dpr;
    this.canvas.style.aspectRatio = `${WIDTH} / ${HEIGHT}`;
    this.canvas.className = 'plane-canvas';
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(dpr, dpr);
    container.append(this.canvas);

    const toPlane = (e: PointerEvent): Vec2 => {
      const rect = this.canvas.getBoundingClientRect();
      const x = PLANE.xMin + ((e.clientX - rect.left) / rect.width) * (PLANE.xMax - PLANE.xMin);
      const y = PLANE.yMin + ((e.clientY - rect.top) / rect.height) * (PLANE.yMax - PLANE.yMin);
      return [
        Math.min(PLANE.xMax, Math.max(PLANE.xMin, x)),
        Math.min(PLANE.yMax, Math.max(PLANE.yMin, y)),
      ];
    };

    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.last) return;
      const rect = this.canvas.getBoundingClientRect();
      const px: Vec2 = [((e.clientX - rect.left) / rect.width) * WIDTH, ((e.clientY - rect.top) / rect.height) * HEIGHT];
      let best = -1;
      let bestDist = PICK_RADIUS;
      this.last.points.forEach((p, i) => {
        const [u, v] = toPx(p);
        const d = Math.hypot(u - px[0], v - px[1]);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      });
      if (best < 0) return;
      this.dragging = best;
      this.canvas.setPointerCapture(e.pointerId);
      this.canvas.classList.add('dragging');
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.dragging >= 0) onDrag(this.dragging, toPlane(e));
    });
    const stop = () => {
      this.dragging = -1;
      this.canvas.classList.remove('dragging');
    };
    this.canvas.addEventListener('pointerup', stop);
    this.canvas.addEventListener('pointercancel', stop);

    onThemeChange(() => {
      this.palette = readPalette();
      if (this.last) this.render(this.last);
    });
  }

  render(scene: PlaneScene): void {
    this.last = scene;
    const { ctx, palette: pal } = this;
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.strokeStyle = pal.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = PLANE.xMin; x <= PLANE.xMax; x += 0.5) {
      const [u] = toPx([x, 0]);
      ctx.moveTo(u, 0);
      ctx.lineTo(u, HEIGHT);
    }
    for (let y = PLANE.yMin; y <= PLANE.yMax; y += 0.5) {
      const [, v] = toPx([0, y]);
      ctx.moveTo(0, v);
      ctx.lineTo(WIDTH, v);
    }
    ctx.stroke();

    const [ox, oy] = toPx([0, 0]);
    ctx.strokeStyle = pal.axis;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, oy);
    ctx.lineTo(WIDTH, oy);
    ctx.moveTo(ox, 0);
    ctx.lineTo(ox, HEIGHT);
    ctx.stroke();
    ctx.fillStyle = pal.muted;
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText('x →', WIDTH - 30, oy - 6);
    ctx.fillText('y ↓', ox + 6, HEIGHT - 8);
    ctx.fillText('(0, 0)', ox + 5, oy + 15);
    ctx.fillText('1', toPx([1, 0])[0] + 3, oy + 15);
    ctx.fillText('1', ox + 5, toPx([0, 1])[1] - 3);

    const endpoints = [scene.l1, scene.l2].map((l) =>
      clipLine(l, PLANE.xMin, PLANE.xMax, PLANE.yMin, PLANE.yMax),
    );
    [pal.line1, pal.line2].forEach((color, i) => {
      const seg = endpoints[i];
      if (!seg) return;
      const [a, b] = seg.map(toPx);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    });

    this.drawIntersection(scene.hit, endpoints);

    ctx.font = '600 13px system-ui, sans-serif';
    scene.points.forEach((p, i) => {
      const [u, v] = toPx(p);
      ctx.beginPath();
      ctx.arc(u, v, 6, 0, Math.PI * 2);
      ctx.fillStyle = i < 2 ? pal.line1 : pal.line2;
      ctx.fill();
      ctx.strokeStyle = pal.bg;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = pal.fg;
      ctx.fillText(POINT_NAMES[i], u + 9, v - 9);
    });
  }

  private drawIntersection(hit: Intersection, endpoints: ([Vec2, Vec2] | null)[]): void {
    const { ctx, palette: pal } = this;
    ctx.fillStyle = pal.highlight;
    ctx.strokeStyle = pal.highlight;
    ctx.font = '600 13px system-ui, sans-serif';

    if (hit.kind === 'point') {
      const [x, y] = hit.p;
      const inside = x >= PLANE.xMin && x <= PLANE.xMax && y >= PLANE.yMin && y <= PLANE.yMax;
      if (inside) {
        const [u, v] = toPx(hit.p);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(u, v, 9, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillText('q', u + 11, v + 16);
        return;
      }
      // Point outside the view: an arrow at the border, pointing towards it.
      const [cx, cy] = toPx([0, 0]);
      const [qu, qv] = toPx(hit.p);
      const angle = Math.atan2(qv - cy, qu - cx);
      const s = Math.min(
        Math.abs((WIDTH / 2 - 14) / Math.cos(angle)),
        Math.abs((HEIGHT / 2 - 14) / Math.sin(angle)),
      );
      this.arrow(cx + s * Math.cos(angle), cy + s * Math.sin(angle), angle);
      ctx.fillText('q is outside the view', 10, 20);
      return;
    }

    if (hit.kind === 'infinity') {
      // Parallel lines: both ends of each line point towards the same point at infinity.
      for (const seg of endpoints) {
        if (!seg) continue;
        const [a, b] = seg.map(toPx);
        const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
        this.arrow(b[0], b[1], angle);
        this.arrow(a[0], a[1], angle + Math.PI);
      }
      ctx.fillText('q is a point at infinity (w = 0)', 10, 20);
      return;
    }

    ctx.fillText('l₁ and l₂ are the same line (or undefined)', 10, 20);
  }

  private arrow(x: number, y: number, angle: number): void {
    const { ctx } = this;
    const size = 11;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - size * Math.cos(angle - 0.45), y - size * Math.sin(angle - 0.45));
    ctx.lineTo(x - size * Math.cos(angle + 0.45), y - size * Math.sin(angle + 0.45));
    ctx.closePath();
    ctx.fill();
  }
}
