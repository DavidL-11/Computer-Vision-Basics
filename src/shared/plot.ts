// A 2D canvas plot with axes, for function graphs, stems and bars. Colors are given as CSS tokens ('--accent') and
// resolved on every draw, so plots follow the theme.

import { cssColor, onThemeChange } from './theme';

export interface PlotRange {
  x: [number, number];
  y: [number, number];
}

export interface Padding {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

type Point = readonly [number, number];

export interface LineStyle {
  width?: number;
  dash?: number[];
  alpha?: number;
}

/** Drawing helpers in data coordinates. */
export class PlotFrame {
  constructor(
    readonly ctx: CanvasRenderingContext2D,
    readonly range: PlotRange,
    /** Plot area in CSS pixels. */
    readonly left: number,
    readonly top: number,
    readonly width: number,
    readonly height: number,
  ) {}

  X = (x: number) => this.left + ((x - this.range.x[0]) / (this.range.x[1] - this.range.x[0])) * this.width;
  Y = (y: number) => this.top + (1 - (y - this.range.y[0]) / (this.range.y[1] - this.range.y[0])) * this.height;

  /** Grid lines with tick labels; the line at 0 is drawn stronger. */
  grid(xTicks: number[], yTicks: number[], format: { x?: (v: number) => string; y?: (v: number) => string } = {}): void {
    const { ctx } = this;
    const fx = format.x ?? String;
    const fy = format.y ?? String;
    ctx.lineWidth = 1;
    ctx.strokeStyle = cssColor('--viz-grid');
    ctx.beginPath();
    for (const x of xTicks) {
      ctx.moveTo(this.X(x), this.top);
      ctx.lineTo(this.X(x), this.top + this.height);
    }
    for (const y of yTicks) {
      ctx.moveTo(this.left, this.Y(y));
      ctx.lineTo(this.left + this.width, this.Y(y));
    }
    ctx.stroke();
    ctx.strokeStyle = cssColor('--fg-faint');
    ctx.beginPath();
    if (this.range.y[0] < 0 && this.range.y[1] > 0) {
      ctx.moveTo(this.left, this.Y(0));
      ctx.lineTo(this.left + this.width, this.Y(0));
    }
    if (this.range.x[0] < 0 && this.range.x[1] > 0) {
      ctx.moveTo(this.X(0), this.top);
      ctx.lineTo(this.X(0), this.top + this.height);
    }
    ctx.stroke();

    ctx.fillStyle = cssColor('--fg-muted');
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const y of yTicks) ctx.fillText(fy(y), this.left - 6, this.Y(y));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const x of xTicks) ctx.fillText(fx(x), this.X(x), this.top + this.height + 6);
  }

  /** A polyline through the points, or the graph of f sampled at every CSS pixel. */
  line(data: readonly Point[] | ((x: number) => number), color: string, style: LineStyle = {}): void {
    const { ctx } = this;
    const points: readonly Point[] =
      typeof data === 'function'
        ? Array.from({ length: Math.ceil(this.width) + 1 }, (_, i) => {
            const x = this.range.x[0] + ((this.range.x[1] - this.range.x[0]) * Math.min(i, this.width)) / this.width;
            return [x, data(x)] as const;
          })
        : data;
    ctx.save();
    this.clip();
    ctx.strokeStyle = cssColor(color);
    ctx.lineWidth = style.width ?? 2;
    ctx.globalAlpha = style.alpha ?? 1;
    ctx.setLineDash(style.dash ?? []);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    points.forEach(([x, y]) => ctx.lineTo(this.X(x), this.Y(y)));
    ctx.stroke();
    ctx.restore();
  }

  /** Vertical lines from 0 to each value, with a dot at the end. */
  stems(points: readonly Point[], color: string, radius = 3.5): void {
    const { ctx } = this;
    ctx.save();
    this.clip();
    ctx.strokeStyle = ctx.fillStyle = cssColor(color);
    ctx.lineWidth = 1.5;
    for (const [x, y] of points) {
      ctx.beginPath();
      ctx.moveTo(this.X(x), this.Y(0));
      ctx.lineTo(this.X(x), this.Y(y));
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(this.X(x), this.Y(y), radius, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Bars from 0 to each value, `width` in data units. */
  bars(points: readonly Point[], width: number, color: string, alpha = 1): void {
    const { ctx } = this;
    ctx.save();
    this.clip();
    ctx.fillStyle = cssColor(color);
    ctx.globalAlpha = alpha;
    const w = Math.max(1, Math.abs(this.X(width) - this.X(0)));
    for (const [x, y] of points) ctx.fillRect(this.X(x) - w / 2, Math.min(this.Y(0), this.Y(y)), w, Math.abs(this.Y(y) - this.Y(0)));
    ctx.restore();
  }

  /** A shaded vertical band between x0 and x1. */
  band(x0: number, x1: number, color: string, alpha = 0.15): void {
    const { ctx } = this;
    ctx.save();
    this.clip();
    ctx.fillStyle = cssColor(color);
    ctx.globalAlpha = alpha;
    ctx.fillRect(this.X(x0), this.top, this.X(x1) - this.X(x0), this.height);
    ctx.restore();
  }

  vline(x: number, color: string, style: LineStyle = {}): void {
    this.line(
      [
        [x, this.range.y[0]],
        [x, this.range.y[1]],
      ],
      color,
      { width: 1, ...style },
    );
  }

  label(text: string, x: number, y: number, color: string, align: CanvasTextAlign = 'left', baseline: CanvasTextBaseline = 'bottom'): void {
    const { ctx } = this;
    ctx.fillStyle = cssColor(color);
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    ctx.fillText(text, this.X(x), this.Y(y));
  }

  private clip(): void {
    this.ctx.beginPath();
    this.ctx.rect(this.left - 4, this.top - 4, this.width + 8, this.height + 8);
    this.ctx.clip();
  }
}

/** A canvas that redraws on resize and theme changes with the last range and draw function. */
export class Plot {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private last: { range: PlotRange; draw: (f: PlotFrame) => void } | null = null;

  constructor(
    container: HTMLElement,
    private height = 220,
    private pad: Padding = { left: 44, right: 14, top: 14, bottom: 26 },
  ) {
    this.canvas.className = 'plot-canvas';
    this.canvas.style.height = `${height}px`;
    container.append(this.canvas);
    new ResizeObserver(() => this.draw()).observe(this.canvas);
    onThemeChange(() => this.draw());
  }

  render(range: PlotRange, draw: (f: PlotFrame) => void): void {
    this.last = { range, draw };
    this.draw();
  }

  private draw(): void {
    const cssWidth = this.canvas.clientWidth;
    if (!this.last || cssWidth === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    const { ctx, pad } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = cssColor('--bg-elev');
    ctx.fillRect(0, 0, cssWidth, this.height);
    const frame = new PlotFrame(ctx, this.last.range, pad.left, pad.top, cssWidth - pad.left - pad.right, this.height - pad.top - pad.bottom);
    this.last.draw(frame);
  }
}

/** 1, 2 or 5 times a power of ten, at least `min`. */
export function niceStep(min: number): number {
  const p = 10 ** Math.floor(Math.log10(min));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= min * (1 - 1e-9))!;
}

/** Multiples of a nice step in [min, max], about `count` of them. */
export function ticks(min: number, max: number, count = 5): number[] {
  const step = niceStep((max - min) / count);
  const out: number[] = [];
  for (let i = Math.ceil(min / step - 1e-9); i * step <= max + 1e-9 * step; i++) out.push(+(i * step).toPrecision(12));
  return out;
}
