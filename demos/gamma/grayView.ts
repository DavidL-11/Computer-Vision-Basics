import { cssColor, onThemeChange } from '../../src/shared/theme';

const HEIGHT = 200;

/**
 * Solid gray squares inside a surround of alternating black and white lines, which emits exactly half the light.
 * The lines must be one device pixel each, so the canvas is sized in device pixels and drawn without scaling.
 */
export class GrayView {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private grays: number[] = [];

  constructor(private container: HTMLElement) {
    this.canvas.className = 'gray-canvas';
    container.append(this.canvas);
    new ResizeObserver(() => this.draw()).observe(container);
    onThemeChange(() => this.draw());
  }

  render(grays: number[]): void {
    this.grays = grays;
    this.draw();
  }

  private draw(): void {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.floor(this.container.clientWidth * dpr);
    const height = Math.round(HEIGHT * dpr);
    if (width === 0 || this.grays.length === 0) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.canvas.style.width = `${width / dpr}px`;
    this.canvas.style.height = `${height / dpr}px`;

    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = cssColor('--bg-sunken');
    ctx.fillRect(0, 0, width, height);

    const n = this.grays.length;
    const gap = Math.round(12 * dpr);
    const labelH = Math.round(26 * dpr);
    const tile = Math.min(Math.floor((width - gap * (n + 1)) / n), height - labelH - gap);
    const x0 = Math.round((width - n * tile - (n - 1) * gap) / 2);
    const y0 = gap;
    const inner = Math.round(tile * 0.5);
    const offset = Math.round((tile - inner) / 2);

    this.grays.forEach((g, k) => {
      const x = x0 + k * (tile + gap);
      const lines = ctx.createImageData(tile, tile);
      for (let row = 0; row < tile; row++) {
        const v = row % 2 ? 0 : 255;
        for (let col = 0; col < tile; col++) {
          const i = (row * tile + col) * 4;
          lines.data[i] = lines.data[i + 1] = lines.data[i + 2] = v;
          lines.data[i + 3] = 255;
        }
      }
      ctx.putImageData(lines, x, y0);
      ctx.fillStyle = `rgb(${g} ${g} ${g})`;
      ctx.fillRect(x + offset, y0 + offset, inner, inner);
      ctx.fillStyle = cssColor('--fg');
      ctx.font = `${13 * dpr}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(k === n - 1 ? `v = ${g}` : String(g), x + tile / 2, y0 + tile + 6 * dpr);
    });
  }
}
