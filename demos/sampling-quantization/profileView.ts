import type { RGBImage } from '../../src/shared/image';
import { cssColor, onThemeChange } from '../../src/shared/theme';

export interface Profile {
  original: RGBImage;
  /** Sampled and quantized image, enlarged to the original size. */
  result: RGBImage;
  row: number;
  gray: boolean;
  levels: number;
}

const HEIGHT = 220;
const PAD = { left: 36, right: 12, top: 12, bottom: 26 };

/** Intensity along one image row: the original as a thin line, the sampled values as a staircase. */
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
    const gridLevels = p.levels <= 16 ? p.levels : 5;
    ctx.beginPath();
    for (let i = 0; i < gridLevels; i++) {
      const y = Y(i / (gridLevels - 1));
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(PAD.left + plotW, y);
    }
    ctx.stroke();
    for (const v of [0, 0.5, 1]) ctx.fillText(v.toFixed(1), PAD.left - 6, Y(v));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let x = 0; x <= w; x += 40) ctx.fillText(String(x), X(x), PAD.top + plotH + 6);

    const colors = p.gray ? [cssColor('--fg')] : ['--axis-x', '--axis-y', '--axis-z'].map(cssColor);
    const rowOffset = p.row * w * 3;
    colors.forEach((color, c) => {
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x < w; x++) ctx.lineTo(X(x + 0.5), Y(p.original.data[rowOffset + x * 3 + c]));
      ctx.stroke();

      ctx.globalAlpha = 1;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        const v = Y(p.result.data[rowOffset + x * 3 + c]);
        ctx.lineTo(X(x), v);
        ctx.lineTo(X(x + 1), v);
      }
      ctx.stroke();
    });
  }
}
