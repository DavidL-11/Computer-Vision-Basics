// The scanline of both images, one cell per pixel, aligned so that equal x lie above each other: the horizontal
// offset between a point's pixels in the two rows is its disparity.

import { cssColor, onThemeChange } from '../../src/shared/theme';

export interface RowMark {
  /** True position, before noise and rounding, and the measured pixel; in pixels from the principal point. */
  xL: number;
  xR: number;
  mL: number;
  mR: number;
  color: string;
  label: string;
}

const ROW = 26;
const TOP = 26;
const GAP = 46;

export class RowsView {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private last: { W: number; marks: RowMark[] } | null = null;

  constructor(container: HTMLElement) {
    this.canvas.className = 'diagram-canvas';
    this.canvas.style.height = `${TOP + 2 * ROW + GAP + 34}px`;
    container.append(this.canvas);
    new ResizeObserver(() => this.draw()).observe(this.canvas);
    onThemeChange(() => this.draw());
  }

  render(W: number, marks: RowMark[]): void {
    this.last = { W, marks };
    this.draw();
  }

  private draw(): void {
    const s = this.last;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (!s || width === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    const { ctx } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = cssColor('--bg-elev');
    ctx.fillRect(0, 0, width, height);

    const left = 92, right = 12;
    const cell = (width - left - right) / (s.W + 1);
    // Pixel x (integer at the center) → canvas x of its left edge.
    const X = (x: number) => left + (x + s.W / 2) * cell;
    const rows = [TOP, TOP + ROW + GAP];
    ctx.font = '12px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = cssColor('--fg-muted');
    ctx.fillText('left image', 8, rows[0] + ROW / 2);
    ctx.fillText('right image', 8, rows[1] + ROW / 2);

    ctx.strokeStyle = cssColor('--viz-grid');
    ctx.lineWidth = 1;
    for (const y of rows) {
      ctx.beginPath();
      for (let i = 0; i <= s.W + 1; i++) {
        const x = left + i * cell;
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + ROW);
      }
      ctx.moveTo(left, y);
      ctx.lineTo(left + (s.W + 1) * cell, y);
      ctx.moveTo(left, y + ROW);
      ctx.lineTo(left + (s.W + 1) * cell, y + ROW);
      ctx.stroke();
    }
    // The principal point.
    ctx.strokeStyle = cssColor('--fg-faint');
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(X(0) + cell / 2, rows[0] - 8);
    ctx.lineTo(X(0) + cell / 2, rows[1] + ROW + 8);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = cssColor('--fg-faint');
    ctx.textAlign = 'center';
    ctx.fillText('x = 0', X(0) + cell / 2, rows[0] - 14);

    s.marks.forEach((m, i) => {
      const color = cssColor(m.color);
      const inside = (x: number) => Math.abs(x) <= s.W / 2;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.75;
      if (inside(m.mL)) ctx.fillRect(X(m.mL), rows[0], cell, ROW);
      if (inside(m.mR)) ctx.fillRect(X(m.mR), rows[1], cell, ROW);
      ctx.globalAlpha = 1;
      // The true positions as thin ticks.
      ctx.strokeStyle = cssColor('--fg');
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (const [x, y] of [
        [m.xL, rows[0]],
        [m.xR, rows[1]],
      ])
        if (inside(x)) {
          ctx.moveTo(X(x) + cell / 2, y - 4);
          ctx.lineTo(X(x) + cell / 2, y + ROW + 4);
        }
      ctx.stroke();
      // The disparity between the measured pixels.
      const y = rows[0] + ROW + 10 + i * 16;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(X(m.mL) + cell / 2, y);
      ctx.lineTo(X(m.mR) + cell / 2, y);
      ctx.stroke();
      ctx.fillStyle = color;
      for (const x of [m.mL, m.mR]) {
        ctx.beginPath();
        ctx.arc(X(x) + cell / 2, y, 3, 0, 2 * Math.PI);
        ctx.fill();
      }
      ctx.textAlign = 'left';
      ctx.fillText(`d = ${m.mL - m.mR} px (${m.label})`, Math.max(X(m.mL), X(m.mR)) + cell + 6, y);
    });
  }
}
