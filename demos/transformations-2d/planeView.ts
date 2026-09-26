import type { Mat3 } from '../../src/shared/linalg';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import { type Vec2, applyH, mapPoint, mapSegment, meetingPoint, toPoint } from './transform';

/** Visible part of the plane (x right, y down). */
export const VIEW = 2.5;
const PX_PER_UNIT = 120;
const SIZE = 2 * VIEW * PX_PER_UNIT;

/** Grid lines over [−1, 1]², i.e. the image. */
export const GRID_LINES: [Vec2, Vec2][] = Array.from({ length: 9 }, (_, i) => -1 + i * 0.25).flatMap(
  (c): [Vec2, Vec2][] => [
    [
      [c, -1],
      [c, 1],
    ],
    [
      [-1, c],
      [1, c],
    ],
  ],
);

/** An "F": asymmetric under every mirror and rotation, so flips and turns are easy to see. */
export const F_SHAPE: Vec2[] = [
  [-0.35, -0.65],
  [0.4, -0.65],
  [0.4, -0.45],
  [-0.15, -0.45],
  [-0.15, -0.1],
  [0.25, -0.1],
  [0.25, 0.1],
  [-0.15, 0.1],
  [-0.15, 0.65],
  [-0.35, 0.65],
];

/** Two parallel segments a → a + d and b → b + d; the midpoint of the second one tests ratios. */
export const PARALLEL = { a: [-1, -1] as Vec2, b: [-1, 0] as Vec2, d: [2, 1] as Vec2 };

export interface PlaneScene {
  H: Mat3;
  grid: boolean;
  shape: boolean;
  original: boolean;
  picked: Vec2;
}

type Palette = Record<'bg' | 'grid' | 'axis' | 'fg' | 'muted' | 'faint' | 'accent' | 'line1' | 'line2' | 'highlight', string>;

function readPalette(): Palette {
  return {
    bg: cssColor('--bg-elev'),
    grid: cssColor('--viz-grid'),
    axis: cssColor('--fg-faint'),
    fg: cssColor('--fg'),
    muted: cssColor('--fg-muted'),
    faint: cssColor('--fg-faint'),
    accent: cssColor('--accent'),
    line1: cssColor('--line-1'),
    line2: cssColor('--line-2'),
    highlight: cssColor('--viz-highlight'),
  };
}

const toPx = ([x, y]: Vec2): Vec2 => [(x + VIEW) * PX_PER_UNIT, (y + VIEW) * PX_PER_UNIT];
const inView = ([x, y]: Vec2) => Math.abs(x) <= VIEW && Math.abs(y) <= VIEW;
const add = (p: Vec2, d: Vec2): Vec2 => [p[0] + d[0], p[1] + d[1]];

export class PlaneView {
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private palette = readPalette();
  private last: PlaneScene | null = null;

  constructor(container: HTMLElement, onPick: (p: Vec2) => void) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = SIZE * dpr;
    this.canvas.height = SIZE * dpr;
    this.canvas.className = 'plane-canvas';
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(dpr, dpr);
    container.append(this.canvas);

    const pick = (e: PointerEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      const clamp = (v: number) => Math.min(VIEW, Math.max(-VIEW, v));
      onPick([
        clamp(-VIEW + ((e.clientX - rect.left) / rect.width) * 2 * VIEW),
        clamp(-VIEW + ((e.clientY - rect.top) / rect.height) * 2 * VIEW),
      ]);
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      this.canvas.setPointerCapture(e.pointerId);
      pick(e);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.canvas.hasPointerCapture(e.pointerId)) pick(e);
    });

    onThemeChange(() => {
      this.palette = readPalette();
      if (this.last) this.render(this.last);
    });
  }

  render(scene: PlaneScene): void {
    this.last = scene;
    const { ctx, palette: pal } = this;
    const { H } = scene;
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, SIZE, SIZE);
    this.drawAxes();

    const { a, b, d } = PARALLEL;
    if (scene.original) {
      ctx.globalAlpha = 0.55;
      if (scene.grid) this.segments(GRID_LINES, pal.faint, 1);
      if (scene.shape) {
        ctx.setLineDash([4, 3]);
        this.polygon(F_SHAPE, pal.faint, 'stroke');
        ctx.setLineDash([]);
      }
      this.segments([[a, add(a, d)]], pal.line1, 1.5);
      this.segments([[b, add(b, d)]], pal.line2, 1.5);
      ctx.globalAlpha = 1;
    }

    const mapped = (segs: [Vec2, Vec2][]) => segs.map(([p, q]) => mapSegment(H, p, q)).filter((s) => s !== null);
    if (scene.grid) {
      const border = GRID_LINES.filter(([p, q]) => [...p, ...q].every((c) => Math.abs(c) === 1));
      this.segments(mapped(GRID_LINES), pal.accent, 1.2);
      this.segments(mapped(border), pal.accent, 2.2);
    }
    if (scene.shape && F_SHAPE.every((p) => applyH(H, p)[2] > 1e-3)) {
      const shape = F_SHAPE.map((p) => mapPoint(H, p));
      ctx.globalAlpha = 0.3;
      this.polygon(shape, pal.accent, 'fill');
      ctx.globalAlpha = 1;
      this.polygon(shape, pal.accent, 'stroke');
    }

    const images = [a, b].map((p) => mapSegment(H, p, add(p, d)));
    this.drawMeetingPoint(meetingPoint(H, d), images);
    this.segments(images[0] ? [images[0]] : [], pal.line1, 3);
    this.segments(images[1] ? [images[1]] : [], pal.line2, 3);
    if (images[1]) this.drawMidpoints(images[1], mapPoint(H, add(b, [d[0] / 2, d[1] / 2])));

    this.drawOrigin(mapPoint(H, [0, 0]));
    this.drawPicked(scene.picked, mapPoint(H, scene.picked));
  }

  private drawAxes(): void {
    const { ctx, palette: pal } = this;
    ctx.strokeStyle = pal.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = -VIEW; c <= VIEW; c += 0.5) {
      const [u, v] = toPx([c, c]);
      ctx.moveTo(u, 0);
      ctx.lineTo(u, SIZE);
      ctx.moveTo(0, v);
      ctx.lineTo(SIZE, v);
    }
    ctx.stroke();

    const [ox, oy] = toPx([0, 0]);
    ctx.strokeStyle = pal.axis;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, oy);
    ctx.lineTo(SIZE, oy);
    ctx.moveTo(ox, 0);
    ctx.lineTo(ox, SIZE);
    ctx.stroke();
    ctx.fillStyle = pal.muted;
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText('x →', SIZE - 30, oy - 6);
    ctx.fillText('y ↓', ox + 6, SIZE - 8);
    ctx.fillText('1', toPx([1, 0])[0] + 3, oy + 15);
    ctx.fillText('1', ox + 5, toPx([0, 1])[1] - 3);
  }

  private segments(segs: [Vec2, Vec2][], color: string, width: number): void {
    const { ctx } = this;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (const [p, q] of segs) {
      ctx.moveTo(...toPx(p));
      ctx.lineTo(...toPx(q));
    }
    ctx.stroke();
  }

  private polygon(points: Vec2[], color: string, mode: 'fill' | 'stroke'): void {
    const { ctx } = this;
    ctx.beginPath();
    points.forEach((p, i) => (i === 0 ? ctx.moveTo(...toPx(p)) : ctx.lineTo(...toPx(p))));
    ctx.closePath();
    if (mode === 'fill') {
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  /** Where the images of the parallel segments meet, if that is a finite point: dashed extensions towards it. */
  private drawMeetingPoint(q: [number, number, number], images: ([Vec2, Vec2] | null)[]): void {
    if (Math.abs(q[2]) < 1e-9) return;
    const { ctx, palette: pal } = this;
    const point = toPoint(q);
    ctx.setLineDash([5, 5]);
    [pal.line1, pal.line2].forEach((color, i) => {
      const seg = images[i];
      if (!seg) return;
      const near = seg.reduce((m, p) => (Math.hypot(p[0] - point[0], p[1] - point[1]) < Math.hypot(m[0] - point[0], m[1] - point[1]) ? p : m));
      this.segments([[near, point]], color, 1.5);
    });
    ctx.setLineDash([]);

    ctx.fillStyle = pal.highlight;
    ctx.strokeStyle = pal.highlight;
    ctx.font = '600 13px system-ui, sans-serif';
    if (inView(point)) {
      const [u, v] = toPx(point);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(u, v, 8, 0, 2 * Math.PI);
      ctx.stroke();
      const right = u < SIZE - 60;
      ctx.textAlign = right ? 'left' : 'right';
      ctx.fillText('meet', right ? u + 10 : u - 10, v + 18);
      ctx.textAlign = 'left';
      return;
    }
    // Outside the view: an arrow at the border, pointing towards it.
    const c = SIZE / 2;
    const angle = Math.atan2(point[1], point[0]);
    const s = Math.min(Math.abs((c - 14) / Math.cos(angle)), Math.abs((c - 14) / Math.sin(angle)));
    this.arrow(c + s * Math.cos(angle), c + s * Math.sin(angle), angle);
    ctx.fillText('the colored lines meet outside the view', 10, 20);
  }

  /** The image of the midpoint (dot) and the midpoint of the image segment (ring); they differ under projective maps. */
  private drawMidpoints([p, q]: [Vec2, Vec2], image: Vec2): void {
    const { ctx, palette: pal } = this;
    const [mu, mv] = toPx([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]);
    ctx.strokeStyle = pal.fg;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(mu, mv, 7, 0, 2 * Math.PI);
    ctx.stroke();
    const [u, v] = toPx(image);
    ctx.fillStyle = pal.line2;
    ctx.beginPath();
    ctx.arc(u, v, 4.5, 0, 2 * Math.PI);
    ctx.fill();
  }

  private drawOrigin(image: Vec2): void {
    const { ctx, palette: pal } = this;
    const [u, v] = toPx(image);
    ctx.fillStyle = pal.accent;
    ctx.beginPath();
    ctx.arc(u, v, 4, 0, 2 * Math.PI);
    ctx.fill();
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillText('0′', u + 6, v + 15);
  }

  private drawPicked(p: Vec2, image: Vec2): void {
    const { ctx, palette: pal } = this;
    const [pu, pv] = toPx(p);
    const [u, v] = toPx(image);
    ctx.strokeStyle = pal.highlight;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(pu, pv);
    ctx.lineTo(u, v);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(pu, pv, 5, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.fillStyle = pal.highlight;
    ctx.beginPath();
    ctx.arc(u, v, 6, 0, 2 * Math.PI);
    ctx.fill();
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillText('p', pu + 8, pv - 8);
    ctx.fillText('p′', u + 9, v - 9);
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
