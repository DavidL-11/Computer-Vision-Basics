import { srgbToLinear } from '../../src/shared/color';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import { decodeGamma } from './gamma';

const PAD = { left: 44, right: 14, top: 14, bottom: 34 };

/** Pixel value (x) → linear light intensity (y) for sRGB and a pure 2.2 power law. */
export class CurveView {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private value = 128;

  constructor(container: HTMLElement) {
    this.canvas.className = 'curve-canvas';
    container.append(this.canvas);
    new ResizeObserver(() => this.draw()).observe(this.canvas);
    onThemeChange(() => this.draw());
  }

  render(value: number): void {
    this.value = value;
    this.draw();
  }

  private draw(): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    const { ctx } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = cssColor('--bg-elev');
    ctx.fillRect(0, 0, width, height);

    const plotW = width - PAD.left - PAD.right;
    const plotH = height - PAD.top - PAD.bottom;
    const X = (v: number) => PAD.left + (v / 255) * plotW;
    const Y = (i: number) => PAD.top + (1 - i) * plotH;

    ctx.strokeStyle = cssColor('--viz-grid');
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 4; i++) {
      ctx.moveTo(X(0), Y(i / 4));
      ctx.lineTo(X(255), Y(i / 4));
      ctx.moveTo(X((i * 255) / 4), Y(0));
      ctx.lineTo(X((i * 255) / 4), Y(1));
    }
    ctx.stroke();

    ctx.fillStyle = cssColor('--fg-muted');
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) ctx.fillText((i / 4).toFixed(2), X(0) - 6, Y(i / 4));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const v of [0, 64, 128, 192, 255]) ctx.fillText(String(v), X(v), Y(0) + 5);
    ctx.fillText('pixel value v', X(127.5), Y(0) + 19);
    ctx.save();
    ctx.translate(11, Y(0.5));
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('light intensity', 0, -6);
    ctx.restore();

    const curve = (f: (v: number) => number, color: string, dash: number[], lineWidth: number) => {
      ctx.strokeStyle = color;
      ctx.setLineDash(dash);
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      for (let v = 0; v <= 255; v++) ctx.lineTo(X(v), Y(f(v / 255)));
      ctx.stroke();
      ctx.setLineDash([]);
    };
    curve((v) => v, cssColor('--fg-faint'), [2, 4], 1);
    curve((v) => decodeGamma(v, 2.2), cssColor('--fg-muted'), [6, 4], 1.5);
    curve(srgbToLinear, cssColor('--accent'), [], 2.5);

    const v = this.value;
    const i = srgbToLinear(v / 255);
    ctx.strokeStyle = cssColor('--viz-highlight');
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(X(v), Y(0));
    ctx.lineTo(X(v), Y(i));
    ctx.lineTo(X(0), Y(i));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = cssColor('--viz-highlight');
    ctx.beginPath();
    ctx.arc(X(v), Y(i), 4.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const legend: [string, string, number[]][] = [
      ['sRGB', cssColor('--accent'), []],
      ['v^2.2', cssColor('--fg-muted'), [6, 4]],
      ['linear', cssColor('--fg-faint'), [2, 4]],
    ];
    legend.forEach(([label, color, dash], k) => {
      const y = PAD.top + 10 + k * 18;
      ctx.strokeStyle = color;
      ctx.setLineDash(dash);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(X(8), y);
      ctx.lineTo(X(30), y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = cssColor('--fg');
      ctx.fillText(label, X(34), y);
    });
  }
}
