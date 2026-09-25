import type { Plane } from '../../src/shared/image';
import { cssColor, onThemeChange } from '../../src/shared/theme';

export interface Profile {
  original: Plane;
  noisy: Plane;
  mean: Plane;
  median: Plane;
  row: number;
  /** Selected column, marked with a vertical line. */
  column: number;
}

const HEIGHT = 220;
const PAD = { left: 36, right: 12, top: 12, bottom: 26 };

/** Intensities along one image row: original, noisy, and both filter results. */
export class ProfileView {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private last: Profile | null = null;

  constructor(container: HTMLElement) {
    this.canvas.className = 'profile-canvas';
    container.append(this.canvas);
    new ResizeObserver(() => this.draw()).observe(this.canvas);
    onThemeChange(() => this.draw());
  }

  render(p: Profile): void {
    this.last = p;
    this.draw();
  }

  private draw(): void {
    const p = this.last;
    const cssWidth = this.canvas.clientWidth;
    if (!p || cssWidth === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = HEIGHT * dpr;
    const { ctx } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = cssColor('--bg-elev');
    ctx.fillRect(0, 0, cssWidth, HEIGHT);

    const w = p.original.width;
    const plotW = cssWidth - PAD.left - PAD.right;
    const plotH = HEIGHT - PAD.top - PAD.bottom;
    const X = (x: number) => PAD.left + (x / w) * plotW;
    const Y = (v: number) => PAD.top + (1 - v) * plotH;

    ctx.lineWidth = 1;
    ctx.strokeStyle = cssColor('--viz-grid');
    ctx.fillStyle = cssColor('--fg-muted');
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.beginPath();
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
      ctx.moveTo(PAD.left, Y(v));
      ctx.lineTo(PAD.left + plotW, Y(v));
    }
    ctx.stroke();
    for (const v of [0, 0.5, 1]) ctx.fillText(v.toFixed(1), PAD.left - 6, Y(v));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let x = 0; x <= w; x += 20) ctx.fillText(String(x), X(x), PAD.top + plotH + 6);

    ctx.strokeStyle = cssColor('--viz-highlight');
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(X(p.column + 0.5), PAD.top);
    ctx.lineTo(X(p.column + 0.5), PAD.top + plotH);
    ctx.stroke();
    ctx.setLineDash([]);

    const offset = p.row * w;
    const line = (plane: Plane, color: string, width: number, alpha = 1, dash: number[] = []) => {
      ctx.strokeStyle = color;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      ctx.beginPath();
      for (let x = 0; x < w; x++) ctx.lineTo(X(x + 0.5), Y(plane.data[offset + x]));
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
    };
    const series: [string, Plane, string, number, number, number[]][] = [
      ['noisy', p.noisy, cssColor('--fg-faint'), 1, 0.7, []],
      ['original', p.original, cssColor('--fg'), 1.5, 1, [5, 3]],
      ['mean', p.mean, cssColor('--viz-points'), 2, 1, []],
      ['median', p.median, cssColor('--accent'), 2, 1, []],
    ];
    for (const [, plane, color, width, alpha, dash] of series) line(plane, color, width, alpha, dash);

    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    let lx = PAD.left + 8;
    for (const [label, , color, , , dash] of series) {
      ctx.fillStyle = cssColor('--bg-elev');
      ctx.globalAlpha = 0.85;
      ctx.fillRect(lx - 4, PAD.top + 2, ctx.measureText(label).width + 36, 16);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(lx, PAD.top + 10);
      ctx.lineTo(lx + 22, PAD.top + 10);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = cssColor('--fg');
      ctx.fillText(label, lx + 26, PAD.top + 10);
      lx += ctx.measureText(label).width + 44;
    }
  }
}
