// Side view in camera coordinates: depth Z_c to the right, −Y_c (up in the image) upwards, at a true 1:1 scale so that
// the field-of-view wedge has its real angle. Projection rays show how each model maps a few points onto the image.

import type { Vec3 } from '../../src/shared/linalg';
import { fmt } from '../../src/shared/tex';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import { GRID, PILLARS, PROBES, SUBJECT, type Segment } from './scene';

/** Depth shown behind the subject, in m. */
const BEHIND = 30;

export type Model = 'perspective' | 'weak' | 'orthographic';

export interface SideState {
  toCamera: (X: Vec3) => Vec3;
  D: number;
  afov: number;
  model: Model;
}

export class SideView {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private last: SideState | null = null;

  constructor(container: HTMLElement) {
    this.canvas.className = 'diagram-canvas';
    this.canvas.style.aspectRatio = '4 / 3';
    container.append(this.canvas);
    new ResizeObserver(() => this.draw()).observe(this.canvas);
    onThemeChange(() => this.draw());
  }

  render(s: SideState): void {
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

    // Camera coordinates → canvas, with the camera center at the left and the optical axis in the middle.
    const scale = (width - 70) / (s.D + BEHIND);
    const cx = 40;
    const cy = height / 2;
    const px = ([, y, z]: Vec3): [number, number] => [cx + z * scale, cy + y * scale];
    const muted = cssColor('--fg-muted');
    const accent = cssColor('--accent');
    const highlight = cssColor('--viz-highlight');
    ctx.font = '12px system-ui, sans-serif';

    const half = (s.afov / 2) * (Math.PI / 180);
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.1;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + width, cy - width * Math.tan(half));
    ctx.lineTo(cx + width, cy + width * Math.tan(half));
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx + width, cy - width * Math.tan(half));
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + width, cy + width * Math.tan(half));
    ctx.stroke();
    ctx.globalAlpha = 1;

    const segments = (list: Segment[], color: string, lineWidth: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      for (const [a, b] of list) {
        const p = px(s.toCamera(a));
        const q = px(s.toCamera(b));
        ctx.moveTo(p[0], p[1]);
        ctx.lineTo(q[0], q[1]);
      }
      ctx.stroke();
    };
    segments(GRID, cssColor('--viz-grid'), 1);
    segments(PILLARS, cssColor('--fg-faint'), 1.2);
    segments(SUBJECT, cssColor('--viz-object'), 2);

    ctx.strokeStyle = cssColor('--fg-faint');
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(width, cy);
    ctx.stroke();

    // Reference depth Z₀ = D of weak perspective.
    const z0 = cx + s.D * scale;
    ctx.strokeStyle = muted;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(z0, 16);
    ctx.lineTo(z0, height - 16);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = muted;
    ctx.textAlign = 'left';
    ctx.fillText('Z₀ = D', z0 + 4, 26);

    // Projection rays: to C (perspective), parallel to the axis (orthographic), or parallel to the axis up to the
    // depth Z₀ and then to C (weak perspective).
    ctx.strokeStyle = highlight;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    const probes = PROBES.map(({ X }) => px(s.toCamera(X)));
    for (const [x, y] of probes) {
      ctx.moveTo(x, y);
      if (s.model === 'perspective') ctx.lineTo(cx, cy);
      else if (s.model === 'orthographic') ctx.lineTo(cx, y);
      else {
        ctx.lineTo(z0, y);
        ctx.lineTo(cx, cy);
      }
    }
    ctx.stroke();
    ctx.fillStyle = highlight;
    for (const [x, y] of probes) {
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, 2 * Math.PI);
      ctx.fill();
    }

    ctx.fillStyle = cssColor('--fg');
    ctx.beginPath();
    ctx.roundRect(cx - 16, cy - 8, 16, 16, 2);
    ctx.fill();
    ctx.fillStyle = accent;
    ctx.fillText(`AFOV = ${fmt(s.afov, 1)}°`, cx + 12, 26);
    ctx.fillStyle = muted;
    ctx.fillText('C', cx - 12, cy - 14);
    ctx.textAlign = 'right';
    ctx.fillText('depth →', width - 8, cy - 8);
  }
}
