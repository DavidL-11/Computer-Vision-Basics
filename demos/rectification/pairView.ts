// Two images side by side with a common vertical scale, so that a row in the left image continues at the same height
// in the right one. Used for the original (verged) and the rectified pair.

import { type CameraSnapshot, clipSegmentNear } from '../../src/shared/camera';
import { type Mat3, type Vec3, mulMat3Vec, sub } from '../../src/shared/linalg';
import { clipLine } from '../../src/shared/lines';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import type { Vec2 } from './rectify';
import type { Segment } from './scene';

const NEAR = 0.05;
const GAP = 16;
const PAD = 10;

/** A camera to draw with: its intrinsics, world → camera rotation and center. */
export type DrawCamera = Pick<CameraSnapshot, 'K' | 'R' | 'C'>;

export interface PairImage {
  cam: DrawCamera;
  /** The outline of the image, in this view's pixel coordinates. */
  frame: Vec2[];
  /** The epipolar line of the selected point, homogeneous, or null. */
  epipolar: Vec3 | null;
}

export interface PairScene {
  images: [PairImage, PairImage];
  /** The region of pixel coordinates shown, the same for both images. */
  box: { u0: number; u1: number; v0: number; v1: number };
  ground: Segment[];
  edges: Segment[];
  points: { X: Vec3; color: string }[];
  selected: number;
  /** The row v of the selected point in the left image, continued across both images. */
  row: number | null;
  /** Extra epipolar lines, e.g. for all points, per image. */
  lines: [Vec3[], Vec3[]];
  fixation: Vec3 | null;
}

export class PairView {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private last: PairScene | null = null;
  private layout: { scale: number; left: number[]; top: number } | null = null;

  constructor(container: HTMLElement, onPick: (image: 0 | 1, uv: Vec2) => void) {
    this.canvas.className = 'diagram-canvas pickable';
    container.append(this.canvas);
    new ResizeObserver(() => this.draw()).observe(this.canvas);
    onThemeChange(() => this.draw());
    this.canvas.addEventListener('pointerdown', (e) => {
      const s = this.last, l = this.layout;
      if (!s || !l) return;
      const r = this.canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const image = x < l.left[1] - GAP / 2 ? 0 : 1;
      onPick(image, [s.box.u0 + (x - l.left[image]) / l.scale, s.box.v0 + (y - l.top) / l.scale]);
    });
  }

  render(s: PairScene): void {
    this.last = s;
    this.draw();
  }

  private draw(): void {
    const s = this.last;
    const width = this.canvas.clientWidth;
    if (!s || width === 0) return;
    const bw = s.box.u1 - s.box.u0, bh = s.box.v1 - s.box.v0;
    const scale = (width - GAP - 2 * PAD) / (2 * bw);
    const height = Math.round(bh * scale + 2 * PAD + 18);
    this.canvas.style.height = `${height}px`;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    const { ctx } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = cssColor('--bg-sunken');
    ctx.fillRect(0, 0, width, height);
    const left = [PAD, PAD + bw * scale + GAP];
    const top = PAD + 18;
    this.layout = { scale, left, top };
    ctx.font = '12px system-ui, sans-serif';

    s.images.forEach((img, i) => {
      const P = ([u, v]: Vec2): [number, number] => [left[i] + (u - s.box.u0) * scale, top + (v - s.box.v0) * scale];
      const toPixel = (X: Vec3): Vec2 | null => {
        const Xc = mulMat3Vec(img.cam.R, sub(X, img.cam.C));
        if (Xc[2] < NEAR) return null;
        const p = mulMat3Vec(img.cam.K as Mat3, Xc);
        return [p[0] / p[2], p[1] / p[2]];
      };
      const segments = (list: Segment[]) => {
        ctx.beginPath();
        for (const [a, b] of list) {
          const c = clipSegmentNear(mulMat3Vec(img.cam.R, sub(a, img.cam.C)), mulMat3Vec(img.cam.R, sub(b, img.cam.C)), NEAR);
          if (!c) continue;
          const p = mulMat3Vec(img.cam.K as Mat3, c[0]), q = mulMat3Vec(img.cam.K as Mat3, c[1]);
          ctx.moveTo(...P([p[0] / p[2], p[1] / p[2]]));
          ctx.lineTo(...P([q[0] / q[2], q[1] / q[2]]));
        }
        ctx.stroke();
      };

      ctx.save();
      ctx.beginPath();
      ctx.rect(left[i], top, bw * scale, bh * scale);
      ctx.clip();
      ctx.fillStyle = cssColor('--bg-elev');
      ctx.strokeStyle = cssColor('--fg-faint');
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      img.frame.forEach((p, k) => (k ? ctx.lineTo(...P(p)) : ctx.moveTo(...P(p))));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.lineWidth = 1;
      ctx.strokeStyle = cssColor('--viz-grid');
      segments(s.ground);
      ctx.strokeStyle = cssColor('--fg-muted');
      ctx.lineWidth = 1.3;
      segments(s.edges);

      const line = (l: Vec3, color: string, width: number, dash: number[] = []) => {
        const seg = clipLine(l, s.box.u0, s.box.u1, s.box.v0, s.box.v1);
        if (!seg) return;
        ctx.strokeStyle = cssColor(color);
        ctx.lineWidth = width;
        ctx.setLineDash(dash);
        ctx.beginPath();
        ctx.moveTo(...P(seg[0]));
        ctx.lineTo(...P(seg[1]));
        ctx.stroke();
        ctx.setLineDash([]);
      };
      ctx.globalAlpha = 0.45;
      for (const l of s.lines[i]) line(l, '--viz-highlight', 1);
      ctx.globalAlpha = 1;

      const sel = toPixel(s.points[s.selected].X);
      if (s.row !== null) line([0, 1, -s.row], '--fg-muted', 1, [5, 4]);
      if (img.epipolar) line(img.epipolar, '--viz-highlight', 2);

      for (const p of s.points) {
        const uv = toPixel(p.X);
        if (!uv) continue;
        ctx.fillStyle = cssColor(p.color);
        ctx.beginPath();
        ctx.arc(...P(uv), 3.5, 0, 2 * Math.PI);
        ctx.fill();
      }
      if (sel) {
        ctx.strokeStyle = cssColor('--viz-highlight');
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(...P(sel), 8, 0, 2 * Math.PI);
        ctx.stroke();
      }
      const fix = s.fixation && toPixel(s.fixation);
      if (fix) {
        const [x, y] = P(fix);
        ctx.strokeStyle = cssColor('--fg');
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x - 7, y);
        ctx.lineTo(x + 7, y);
        ctx.moveTo(x, y - 7);
        ctx.lineTo(x, y + 7);
        ctx.stroke();
      }
      ctx.restore();

      ctx.fillStyle = cssColor('--fg-muted');
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(i === 0 ? 'left image' : 'right image', left[i], top - 4);
    });
  }
}
