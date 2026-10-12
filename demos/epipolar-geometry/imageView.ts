// The image of one camera, zoomed out a little so that epipoles just outside the image stay visible. The scene is
// projected with the camera's own K, R, t; epipolar lines are drawn across the whole visible area.

import { type CameraSnapshot, clipSegmentNear } from '../../src/shared/camera';
import { toPixel } from '../../src/shared/epipolar';
import { type Vec3, add, mulMat3Vec } from '../../src/shared/linalg';
import { type Vec2, clipLine } from '../../src/shared/lines';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import { CORNERS, EDGES, GRID, IMAGE_HEIGHT, IMAGE_WIDTH, type Segment } from './scene';

const WIDTH = 800;
const HEIGHT = 600;
const NEAR = 0.05;
/** Markers for epipoles outside the canvas are drawn this far inside its border. */
const INSET = 22;

export interface ImageScene {
  cam: CameraSnapshot;
  /** '₀' or '₁', the subscript of this image's x, l and e. */
  sub: string;
  /** The selected point in this image, or null if it is behind the camera. */
  point: Vec2 | null;
  /** The epipolar line through the point, homogeneous. */
  line: Vec3;
  epipole: Vec3;
  /** Epipolar lines of all scene corners, when the pencil is shown. */
  pencil: Vec3[];
  zoomOut: number;
}

export class ImageView {
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private last: ImageScene | null = null;

  constructor(container: HTMLElement, onPick?: (u: number, v: number) => void) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = WIDTH * dpr;
    this.canvas.height = HEIGHT * dpr;
    this.canvas.style.aspectRatio = `${WIDTH} / ${HEIGHT}`;
    this.canvas.className = 'image-canvas';
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(dpr, dpr);
    container.append(this.canvas);
    onThemeChange(() => this.last && this.render(this.last));
    if (!onPick) return;

    this.canvas.classList.add('pickable');
    const pick = (e: PointerEvent) => {
      if (!this.last) return;
      const rect = this.canvas.getBoundingClientRect();
      const k = this.scale(this.last.zoomOut);
      const u = IMAGE_WIDTH / 2 + (((e.clientX - rect.left) / rect.width) * WIDTH - WIDTH / 2) / k;
      const v = IMAGE_HEIGHT / 2 + (((e.clientY - rect.top) / rect.height) * HEIGHT - HEIGHT / 2) / k;
      onPick(Math.min(IMAGE_WIDTH, Math.max(0, u)), Math.min(IMAGE_HEIGHT, Math.max(0, v)));
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      this.canvas.setPointerCapture(e.pointerId);
      pick(e);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.canvas.hasPointerCapture(e.pointerId)) pick(e);
    });
  }

  /** Canvas pixels per image pixel. */
  private scale(zoomOut: number): number {
    return WIDTH / IMAGE_WIDTH / zoomOut;
  }

  render(scene: ImageScene): void {
    this.last = scene;
    const { ctx } = this;
    const { K, R, t } = scene.cam;
    const k = this.scale(scene.zoomOut);
    const X = (u: number) => WIDTH / 2 + (u - IMAGE_WIDTH / 2) * k;
    const Y = (v: number) => HEIGHT / 2 + (v - IMAGE_HEIGHT / 2) * k;
    const vis = {
      u0: IMAGE_WIDTH / 2 - WIDTH / 2 / k,
      u1: IMAGE_WIDTH / 2 + WIDTH / 2 / k,
      v0: IMAGE_HEIGHT / 2 - HEIGHT / 2 / k,
      v1: IMAGE_HEIGHT / 2 + HEIGHT / 2 / k,
    };
    const toCamera = (p: Vec3) => add(mulMat3Vec(R, p), t);
    const toImage = (Xc: Vec3): Vec2 => {
      const p = mulMat3Vec(K, Xc);
      return [p[0] / p[2], p[1] / p[2]];
    };
    const segments = (list: Segment[]) => {
      ctx.beginPath();
      for (const [a, b] of list) {
        const s = clipSegmentNear(toCamera(a), toCamera(b), NEAR);
        if (!s) continue;
        const [p, q] = s.map(toImage);
        ctx.moveTo(X(p[0]), Y(p[1]));
        ctx.lineTo(X(q[0]), Y(q[1]));
      }
      ctx.stroke();
    };
    const infiniteLine = (l: Vec3) => {
      const s = clipLine(l, vis.u0, vis.u1, vis.v0, vis.v1);
      if (!s) return null;
      ctx.moveTo(X(s[0][0]), Y(s[0][1]));
      ctx.lineTo(X(s[1][0]), Y(s[1][1]));
      return s;
    };

    ctx.fillStyle = cssColor('--bg-sunken');
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = cssColor('--bg-elev');
    ctx.fillRect(X(0), Y(0), IMAGE_WIDTH * k, IMAGE_HEIGHT * k);

    ctx.lineWidth = 1;
    ctx.strokeStyle = cssColor('--viz-grid');
    segments(GRID);
    ctx.lineWidth = 1.75;
    ctx.strokeStyle = cssColor('--fg-muted');
    segments(EDGES);
    ctx.fillStyle = cssColor('--fg-muted');
    for (const p of CORNERS) {
      const Xc = toCamera(p);
      if (Xc[2] < NEAR) continue;
      const [u, v] = toImage(Xc);
      ctx.beginPath();
      ctx.arc(X(u), Y(v), 2.5, 0, 2 * Math.PI);
      ctx.fill();
    }

    const accent = cssColor('--accent');
    ctx.strokeStyle = accent;
    if (scene.pencil.length) {
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = 1;
      ctx.beginPath();
      scene.pencil.forEach(infiniteLine);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    const s = infiniteLine(scene.line);
    ctx.stroke();
    if (s) {
      // Near one end of the visible part, on the side away from the epipole marker.
      const [p, q] = [...s].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const at: Vec2 = [0.9 * p[0] + 0.1 * q[0], 0.9 * p[1] + 0.1 * q[1]];
      ctx.fillStyle = accent;
      this.text(`l${scene.sub}`, X(at[0]) + 8, Y(at[1]) - 8, 'left');
    }

    ctx.strokeStyle = cssColor('--fg-muted');
    ctx.lineWidth = 1.5;
    ctx.strokeRect(X(0), Y(0), IMAGE_WIDTH * k, IMAGE_HEIGHT * k);

    this.epipoleMarker(scene.epipole, `e${scene.sub}`, X, Y);

    if (scene.point) {
      const [u, v] = scene.point;
      ctx.fillStyle = cssColor('--viz-highlight');
      ctx.beginPath();
      ctx.arc(X(u), Y(v), 6, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = cssColor('--bg-elev');
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = cssColor('--viz-highlight');
      this.text(`x${scene.sub}`, X(u) + 10, Y(v) + 18, 'left');
    }
  }

  /** A dot at the epipole, or an arrow at the border pointing to it if it is outside the canvas or at infinity. */
  private epipoleMarker(e: Vec3, name: string, X: (u: number) => number, Y: (v: number) => number): void {
    const { ctx } = this;
    const p = toPixel(e);
    const color = cssColor('--viz-object');
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
      this.text(name, X(p[0]) + 10, Y(p[1]) - 10, 'left');
      return;
    }
    // Direction from the canvas center towards the point; for a point at infinity, the direction (x, y) of e.
    const cx = WIDTH / 2;
    const cy = HEIGHT / 2;
    let dx = p ? X(p[0]) - cx : e[0];
    let dy = p ? Y(p[1]) - cy : e[1];
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
    this.text(p ? name : `${name} at ∞`, ax - dx * 18, ay - dy * 18 + 5, align);
  }

  private text(text: string, x: number, y: number, align: CanvasTextAlign): void {
    const { ctx } = this;
    ctx.font = '600 15px system-ui, sans-serif';
    ctx.textAlign = align;
    ctx.fillText(text, x, y);
  }
}
