// The camera image of frame 0 with the flow of every visible point drawn as an arrow from x₀ towards x₁.

import { clipSegmentNear } from '../../src/shared/camera';
import { type Mat3, type Vec3, mulMat3Vec } from '../../src/shared/linalg';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import { type Pose, type Vec2, toCamera, toPixel } from './egomotion';
import { GROUND, IMAGE_HEIGHT, IMAGE_WIDTH, type Kind, POST_SEGMENTS, RIDGE_SEGMENTS } from './scene';

const NEAR = 0.05;

export const KIND_COLORS: Record<Kind, string> = { ground: '--accent', post: '--viz-object', far: '--viz-points' };

export interface Arrow {
  kind: Kind;
  from: Vec2;
  /** The displacement shown, in pixels, before scaling. */
  d: Vec2;
}

export interface ImageScene {
  K: Mat3;
  pose: Pose;
  arrows: Arrow[];
  /** Arrow lengths are multiplied by this. */
  scale: number;
  /** The focus of expansion and whether it is one (true) or a focus of contraction; null if there is none to show. */
  foe: { at: Vec2; expansion: boolean } | null;
  selected: Vec2 | null;
}

export class ImageView {
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private last: ImageScene | null = null;

  constructor(container: HTMLElement, onPick: (x: number, y: number) => void) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = IMAGE_WIDTH * dpr;
    this.canvas.height = IMAGE_HEIGHT * dpr;
    this.canvas.style.aspectRatio = `${IMAGE_WIDTH} / ${IMAGE_HEIGHT}`;
    this.canvas.className = 'image-canvas pickable';
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(dpr, dpr);
    container.append(this.canvas);
    this.canvas.addEventListener('pointerdown', (e) => {
      const r = this.canvas.getBoundingClientRect();
      onPick(((e.clientX - r.left) / r.width) * IMAGE_WIDTH, ((e.clientY - r.top) / r.height) * IMAGE_HEIGHT);
    });
    onThemeChange(() => this.last && this.render(this.last));
  }

  render(s: ImageScene): void {
    this.last = s;
    const { ctx } = this;
    ctx.fillStyle = cssColor('--bg-elev');
    ctx.fillRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);

    const segment = (a: Vec3, b: Vec3) => {
      const c = clipSegmentNear(toCamera(s.pose, a), toCamera(s.pose, b), NEAR);
      if (!c) return;
      const p = toPixel(s.K, c[0]), q = toPixel(s.K, c[1]);
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(q[0], q[1]);
    };

    this.horizon(s);

    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = cssColor('--fg-faint');
    ctx.beginPath();
    for (let x = GROUND.x[0]; x <= GROUND.x[1]; x += GROUND.step) segment([x, GROUND.y[0], 0], [x, GROUND.y[1], 0]);
    for (let y = GROUND.y[0]; y <= GROUND.y[1]; y += GROUND.step) segment([GROUND.x[0], y, 0], [GROUND.x[1], y, 0]);
    ctx.stroke();
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = cssColor('--viz-object');
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (const [a, b] of POST_SEGMENTS) segment(a, b);
    ctx.stroke();
    ctx.strokeStyle = cssColor('--viz-points');
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const [a, b] of RIDGE_SEGMENTS) segment(a, b);
    ctx.stroke();
    ctx.globalAlpha = 1;

    for (const a of s.arrows) this.arrow(a, s.scale);

    if (s.selected) {
      ctx.strokeStyle = cssColor('--viz-highlight');
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.selected[0], s.selected[1], 8, 0, 2 * Math.PI);
      ctx.stroke();
    }
    if (s.foe) this.foe(s.foe.at, s.foe.expansion);
  }

  /** The horizon: the vanishing line of the ground plane. */
  private horizon(s: ImageScene): void {
    const { ctx } = this;
    const r = s.pose.R;
    // Image line l = K⁻ᵀ n_c with the ground normal n_c in camera coordinates: points x with lᵀx = 0.
    const n = mulMat3Vec(r, [0, 0, 1]);
    const { K } = s;
    const fx = K[0], fy = K[4], u0 = K[2], v0 = K[5];
    // lᵀ (u, v, 1) = n·K⁻¹(u, v, 1) = n₀ (u − u₀)/fx + n₁ (v − v₀)/fy + n₂ (no skew).
    const a = n[0] / fx, b = n[1] / fy, c = n[2] - (n[0] * u0) / fx - (n[1] * v0) / fy;
    if (Math.abs(b) < 1e-12) return;
    const v = (u: number) => -(a * u + c) / b;
    ctx.strokeStyle = cssColor('--fg-faint');
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(0, v(0));
    ctx.lineTo(IMAGE_WIDTH, v(IMAGE_WIDTH));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private arrow(a: Arrow, k: number): void {
    const { ctx } = this;
    const [x, y] = a.from;
    const dx = a.d[0] * k, dy = a.d[1] * k;
    const len = Math.hypot(dx, dy);
    ctx.strokeStyle = ctx.fillStyle = cssColor(KIND_COLORS[a.kind]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, 2 * Math.PI);
    ctx.fill();
    if (len < 1.5) return;
    const head = Math.min(6, len / 2);
    const ux = dx / len, uy = dy / len;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + dx, y + dy);
    ctx.moveTo(x + dx - head * (ux - 0.5 * uy), y + dy - head * (uy + 0.5 * ux));
    ctx.lineTo(x + dx, y + dy);
    ctx.lineTo(x + dx - head * (ux + 0.5 * uy), y + dy - head * (uy - 0.5 * ux));
    ctx.stroke();
  }

  /** A target marker; outside the image it is drawn at the border, dashed. */
  private foe(at: Vec2, expansion: boolean): void {
    const { ctx } = this;
    const inside = at[0] >= 0 && at[1] >= 0 && at[0] <= IMAGE_WIDTH && at[1] <= IMAGE_HEIGHT;
    const x = Math.min(IMAGE_WIDTH - 14, Math.max(14, at[0])), y = Math.min(IMAGE_HEIGHT - 14, Math.max(14, at[1]));
    ctx.strokeStyle = ctx.fillStyle = cssColor('--viz-highlight');
    ctx.lineWidth = 2;
    ctx.setLineDash(inside ? [] : [3, 3]);
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, 2 * Math.PI);
    ctx.moveTo(x - 15, y);
    ctx.lineTo(x + 15, y);
    ctx.moveTo(x, y - 15);
    ctx.lineTo(x, y + 15);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.textAlign = x > IMAGE_WIDTH - 120 ? 'right' : 'left';
    ctx.textBaseline = 'bottom';
    const text = `${expansion ? 'focus of expansion' : 'focus of contraction'}${inside ? '' : ' (outside)'}`;
    const tx = x + (ctx.textAlign === 'right' ? -14 : 14);
    ctx.strokeStyle = cssColor('--bg-elev');
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.strokeText(text, tx, y - 12);
    ctx.fillText(text, tx, y - 12);
  }
}
