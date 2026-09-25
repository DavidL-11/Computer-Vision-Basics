import { cssColor, onThemeChange } from '../../src/shared/theme';

export interface KernelPlotData {
  /** Kernel weights with the origin in the middle, drawn as bars. */
  bars: Float32Array;
  /** Optional continuous curve over x, drawn on top of the bars. */
  curve?: (x: number) => number;
}

const HEIGHT = 220;
const PAD = { left: 46, right: 12, top: 12, bottom: 26 };

/** A 1D kernel as bars over the offset x. */
export class KernelPlot {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private data: KernelPlotData | null = null;

  constructor(container: HTMLElement) {
    this.canvas.className = 'plot-canvas';
    container.append(this.canvas);
    new ResizeObserver(() => this.draw()).observe(this.canvas);
    onThemeChange(() => this.draw());
  }

  render(data: KernelPlotData): void {
    this.data = data;
    this.draw();
  }

  private draw(): void {
    const d = this.data;
    const cssWidth = this.canvas.clientWidth;
    if (!d || cssWidth === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = HEIGHT * dpr;
    const { ctx } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = cssColor('--bg-elev');
    ctx.fillRect(0, 0, cssWidth, HEIGHT);

    const r = (d.bars.length - 1) / 2;
    const xMax = r + 0.5;
    const yMax = 1.1 * Math.max(...d.bars, ...(d.curve ? [d.curve(0)] : []));
    const plotW = cssWidth - PAD.left - PAD.right;
    const plotH = HEIGHT - PAD.top - PAD.bottom;
    const X = (x: number) => PAD.left + ((x + xMax) / (2 * xMax)) * plotW;
    const Y = (v: number) => PAD.top + (1 - v / yMax) * plotH;

    ctx.lineWidth = 1;
    ctx.strokeStyle = cssColor('--viz-grid');
    ctx.fillStyle = cssColor('--fg-muted');
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const yStep = niceStep(yMax / 4);
    ctx.beginPath();
    for (let v = 0; v <= yMax; v += yStep) {
      ctx.moveTo(PAD.left, Y(v));
      ctx.lineTo(PAD.left + plotW, Y(v));
      ctx.fillText(v.toFixed(yStep < 0.01 ? 3 : 2), PAD.left - 6, Y(v));
    }
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const xStep = Math.max(1, niceStep(r / 5));
    for (let x = 0; x <= r; x += xStep)
      for (const s of x === 0 ? [0] : [-x, x]) ctx.fillText(String(s), X(s), PAD.top + plotH + 6);

    const barWidth = Math.max(1, (plotW / d.bars.length) * 0.8);
    ctx.fillStyle = cssColor('--accent');
    ctx.globalAlpha = 0.75;
    d.bars.forEach((v, i) => ctx.fillRect(X(i - r) - barWidth / 2, Y(v), barWidth, Y(0) - Y(v)));
    ctx.globalAlpha = 1;

    if (d.curve) {
      ctx.strokeStyle = cssColor('--viz-highlight');
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let px = 0; px <= plotW; px += 2) {
        const x = (px / plotW) * 2 * xMax - xMax;
        ctx.lineTo(PAD.left + px, Y(d.curve(x)));
      }
      ctx.stroke();
    }
  }
}

/** 1, 2 or 5 times a power of ten, at least `min`. */
function niceStep(min: number): number {
  const p = 10 ** Math.floor(Math.log10(min));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= min)!;
}
