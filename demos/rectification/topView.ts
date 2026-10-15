// Top view of the verged rig: X to the right, Y (forward) upwards, at a 1:1 scale. The optical axes meet at the
// fixation point; the dashed circle through both centers and the fixation point holds all points with zero disparity.

import { cssColor, onThemeChange } from '../../src/shared/theme';
import { FOOTPRINTS } from './scene';

const Y_MAX = 9.5;

export interface TopScene {
  c: number;
  theta: number;
  D: number;
  /** Half the horizontal field of view, in radians. */
  halfFov: number;
  points: { X: [number, number]; color: string }[];
  selected: number;
}

export class TopView {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private last: TopScene | null = null;

  constructor(container: HTMLElement) {
    this.canvas.className = 'diagram-canvas';
    container.append(this.canvas);
    new ResizeObserver(() => this.draw()).observe(this.canvas);
    onThemeChange(() => this.draw());
  }

  render(s: TopScene): void {
    this.last = s;
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

    const bottom = height - 28;
    const k = (bottom - 12) / Y_MAX;
    const P = (x: number, y: number): [number, number] => [width / 2 + x * k, bottom - y * k];
    const cams = [-s.c / 2, s.c / 2];
    const yaw = [s.theta / 2, -s.theta / 2].map((t) => (t * Math.PI) / 180);
    // Viewing direction of each camera in the top view, turned inwards by θ/2.
    const dir = (i: number, a = 0): [number, number] => [Math.sin(yaw[i] + a), Math.cos(yaw[i] + a)];
    const far = 3 * Y_MAX;
    ctx.font = '12px system-ui, sans-serif';

    // Zero disparity: the circle through both centers and the fixation point.
    if (Number.isFinite(s.D)) {
      const cy = (s.D * s.D - (s.c / 2) ** 2) / (2 * s.D);
      const r = s.D - cy;
      ctx.strokeStyle = cssColor('--viz-highlight');
      ctx.globalAlpha = 0.6;
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(...P(0, cy), r * k, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // Fields of view.
    ctx.strokeStyle = cssColor('--fg-faint');
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    cams.forEach((x, i) => {
      for (const a of [-s.halfFov, s.halfFov]) {
        const [dx, dy] = dir(i, a);
        ctx.moveTo(...P(x, 0));
        ctx.lineTo(...P(x + dx * far, dy * far));
      }
    });
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = cssColor('--fg-muted');
    ctx.lineWidth = 1.5;
    for (const f of FOOTPRINTS) {
      ctx.beginPath();
      f.forEach(([x, y], i) => (i ? ctx.lineTo(...P(x, y)) : ctx.moveTo(...P(x, y))));
      if (f.length > 2) ctx.closePath();
      ctx.stroke();
    }

    // Optical axes up to the fixation point, and the common direction after rectification.
    ctx.strokeStyle = cssColor('--fg');
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    cams.forEach((x, i) => {
      const [dx, dy] = dir(i);
      const len = Number.isFinite(s.D) ? Math.hypot(s.c / 2, s.D) : far;
      ctx.moveTo(...P(x, 0));
      ctx.lineTo(...P(x + dx * len, dy * len));
    });
    ctx.stroke();
    ctx.strokeStyle = cssColor('--accent');
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    for (const x of cams) {
      ctx.moveTo(...P(x, 0));
      ctx.lineTo(...P(x, 1.4));
    }
    ctx.stroke();
    ctx.setLineDash([]);

    s.points.forEach((p, i) => {
      ctx.fillStyle = cssColor(p.color);
      ctx.beginPath();
      ctx.arc(...P(...p.X), i === s.selected ? 5 : 3, 0, 2 * Math.PI);
      ctx.fill();
    });

    if (Number.isFinite(s.D)) {
      const [x, y] = P(0, s.D);
      ctx.fillStyle = cssColor('--fg');
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, 2 * Math.PI);
      ctx.fill();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('fixation point', x + 8, y);
    }
    ctx.fillStyle = cssColor('--fg');
    for (const x of cams) {
      ctx.beginPath();
      ctx.arc(...P(x, 0), 4, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.fillStyle = cssColor('--fg-muted');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`c = ${s.c.toFixed(2)} m, θ = ${s.theta.toFixed(1)}°`, width / 2, bottom + 8);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = cssColor('--fg-faint');
    for (let y = 2; y <= Y_MAX; y += 2) ctx.fillText(`${y} m`, 8, bottom - y * k);
  }
}
