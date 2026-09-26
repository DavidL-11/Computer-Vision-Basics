// The camera image, zoomed out so that vanishing points outside the image stay visible. Everything is projected
// with our own K, R, t.

import { type CameraSnapshot, clipSegmentNear } from '../../src/shared/camera';
import { type Vec3, add, mulMat3Vec } from '../../src/shared/linalg';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import { EDGES, FAMILIES, type FamilyKey, GRID, IMAGE_HEIGHT, IMAGE_WIDTH } from './scene';
import { type Vec2, clipLine, toCartesian } from './vanishing';

const WIDTH = 800;
const HEIGHT = 600;
const NEAR = 0.05;
/** Markers for vanishing points outside the canvas are drawn this far inside its border. */
const INSET = 22;

export interface ImageOptions {
  zoomOut: number;
  families: Record<FamilyKey, boolean>;
  showHorizon: boolean;
  showExtensions: boolean;
}

export interface ImageScene {
  cam: CameraSnapshot;
  /** Homogeneous vanishing points per family. */
  vps: Record<FamilyKey, Vec3>;
  horizon: Vec3;
  rampLine: Vec3;
}

export class ImageView {
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private last: { scene: ImageScene; options: ImageOptions } | null = null;

  constructor(container: HTMLElement) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = WIDTH * dpr;
    this.canvas.height = HEIGHT * dpr;
    this.canvas.style.aspectRatio = `${WIDTH} / ${HEIGHT}`;
    this.canvas.className = 'image-canvas';
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(dpr, dpr);
    container.append(this.canvas);
    onThemeChange(() => this.last && this.render(this.last.scene, this.last.options));
  }

  render(scene: ImageScene, options: ImageOptions): void {
    this.last = { scene, options };
    const { ctx } = this;
    const { K, R, t } = scene.cam;
    // Image pixel (u, v) → canvas position, with the image centered.
    const k = WIDTH / IMAGE_WIDTH / options.zoomOut;
    const X = (u: number) => WIDTH / 2 + (u - IMAGE_WIDTH / 2) * k;
    const Y = (v: number) => HEIGHT / 2 + (v - IMAGE_HEIGHT / 2) * k;
    const vis = {
      u0: IMAGE_WIDTH / 2 - WIDTH / 2 / k,
      u1: IMAGE_WIDTH / 2 + WIDTH / 2 / k,
      v0: IMAGE_HEIGHT / 2 - HEIGHT / 2 / k,
      v1: IMAGE_HEIGHT / 2 + HEIGHT / 2 / k,
    };

    const toPixel = (Xc: Vec3): Vec2 => {
      const p = mulMat3Vec(K, Xc);
      return [p[0] / p[2], p[1] / p[2]];
    };
    const project = (a: Vec3, b: Vec3): [Vec2, Vec2] | null => {
      const clipped = clipSegmentNear(add(mulMat3Vec(R, a), t), add(mulMat3Vec(R, b), t), NEAR);
      return clipped && [toPixel(clipped[0]), toPixel(clipped[1])];
    };
    const segment = ([p, q]: [Vec2, Vec2]) => {
      ctx.moveTo(X(p[0]), Y(p[1]));
      ctx.lineTo(X(q[0]), Y(q[1]));
    };
    const infiniteLine = (l: Vec3) => {
      const s = clipLine(l, vis.u0, vis.u1, vis.v0, vis.v1);
      if (s) segment(s);
      return s;
    };

    ctx.fillStyle = cssColor('--bg-sunken');
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = cssColor('--bg-elev');
    ctx.fillRect(X(0), Y(0), IMAGE_WIDTH * k, IMAGE_HEIGHT * k);

    ctx.strokeStyle = cssColor('--fg-faint');
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const [a, b] of GRID) {
      const s = project(a, b);
      if (s) segment(s);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    const highlight = cssColor('--viz-highlight');
    if (options.showHorizon) {
      ctx.strokeStyle = highlight;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      const s = infiniteLine(scene.horizon);
      ctx.stroke();
      if (s) {
        // A quarter of the way along the visible part, away from the markers at the border.
        const [p, q] = [...s].sort((a, b) => a[0] - b[0]);
        ctx.fillStyle = highlight;
        ctx.font = '600 13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('horizon', X(0.75 * p[0] + 0.25 * q[0]), Y(0.75 * p[1] + 0.25 * q[1]) - 8);
      }
    }
    if (options.families.ramp) {
      ctx.strokeStyle = cssColor('--viz-object');
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      infiniteLine(scene.rampLine);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    for (const f of FAMILIES) {
      if (!options.families[f.key]) continue;
      const color = cssColor(f.color);
      const vp = toCartesian(scene.vps[f.key]);
      const segments = EDGES.filter((e) => e.family === f.key)
        .map((e) => project(e.a, e.b))
        .filter((s) => s !== null);

      if (vp && options.showExtensions) {
        // Each image line continues to the vanishing point, starting from the end of the segment nearer to it.
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.45;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 5]);
        ctx.beginPath();
        for (const [p, q] of segments) {
          const near = Math.hypot(p[0] - vp[0], p[1] - vp[1]) < Math.hypot(q[0] - vp[0], q[1] - vp[1]) ? p : q;
          segment([near, vp]);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }

      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      segments.forEach(segment);
      ctx.stroke();
    }

    ctx.strokeStyle = cssColor('--fg-muted');
    ctx.lineWidth = 1.5;
    ctx.strokeRect(X(0), Y(0), IMAGE_WIDTH * k, IMAGE_HEIGHT * k);
    ctx.fillStyle = cssColor('--fg-muted');
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`image ${IMAGE_WIDTH} × ${IMAGE_HEIGHT}`, X(0) + 6, Y(0) - 6);

    for (const f of FAMILIES) if (options.families[f.key]) this.marker(scene.vps[f.key], f.sub, cssColor(f.color), X, Y);
  }

  /** A dot at the vanishing point, or an arrow at the border pointing to it if it is outside the canvas or at infinity. */
  private marker(v: Vec3, sub: string, color: string, X: (u: number) => number, Y: (v: number) => number): void {
    const { ctx } = this;
    const p = toCartesian(v);
    ctx.fillStyle = color;
    const inside = p && X(p[0]) >= 0 && X(p[0]) <= WIDTH && Y(p[1]) >= 0 && Y(p[1]) <= HEIGHT;
    if (p && inside) {
      ctx.beginPath();
      ctx.arc(X(p[0]), Y(p[1]), 6, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = cssColor('--bg-elev');
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = color;
      this.label(sub, '', X(p[0]) + 10, Y(p[1]) - 10, 'left');
      return;
    }
    // Direction from the canvas center towards the point; for a point at infinity, the direction (x, y) of v.
    const cx = WIDTH / 2;
    const cy = HEIGHT / 2;
    let dx = p ? X(p[0]) - cx : v[0];
    let dy = p ? Y(p[1]) - cy : v[1];
    const len = Math.hypot(dx, dy);
    if (len === 0) return;
    dx /= len;
    dy /= len;
    const reach = Math.min(dx ? (cx - INSET) / Math.abs(dx) : Infinity, dy ? (cy - INSET) / Math.abs(dy) : Infinity);
    const ax = cx + dx * reach;
    const ay = cy + dy * reach;
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(Math.atan2(dy, dx));
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.lineTo(-4, -7);
    ctx.lineTo(-4, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    const align = dx > 0.3 ? 'right' : dx < -0.3 ? 'left' : 'center';
    this.label(sub, p ? '' : ' at ∞', ax - dx * 18, ay - dy * 18 + 5, align);
  }

  /** "v" with a subscript, then an optional suffix, aligned like fillText. */
  private label(sub: string, suffix: string, x: number, y: number, align: 'left' | 'right' | 'center'): void {
    const { ctx } = this;
    const main = '600 14px system-ui, sans-serif';
    const small = '600 10px system-ui, sans-serif';
    const width = (text: string, font: string) => ((ctx.font = font), ctx.measureText(text).width);
    const total = width('v', main) + width(sub, small) + width(suffix, main);
    let cx = align === 'left' ? x : align === 'right' ? x - total : x - total / 2;
    ctx.textAlign = 'left';
    for (const [text, font, dy] of [
      ['v', main, 0],
      [sub, small, 4],
      [suffix, main, 0],
    ] as const) {
      ctx.font = font;
      ctx.fillText(text, cx, y + dy);
      cx += ctx.measureText(text).width;
    }
  }
}
