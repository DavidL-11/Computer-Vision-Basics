// Points are projected with our own K, R, t (not Three.js), so the image is exactly the math.
// A margin around the sensor shows projections that fall outside the image, dimmed.

import { type Vec3, mulMat3Vec } from '../../src/shared/linalg';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import { type CameraSnapshot, clipSegmentNear, project } from './camera';
import { IMAGE_HEIGHT, IMAGE_WIDTH, boardSquares, cubeEdges, cubePoints, worldAxes } from './scene';

const MARGIN = 80;
const NEAR = 0.05;
const PICK_RADIUS = 14;

type Palette = Record<
  'bg' | 'sensor' | 'border' | 'fg' | 'muted' | 'boardDark' | 'boardLight' | 'object' | 'points' | 'highlight' | 'accent',
  string
> & { axes: string[] };

function readPalette(): Palette {
  return {
    bg: cssColor('--bg-sunken'),
    sensor: cssColor('--bg-elev'),
    border: cssColor('--fg-muted'),
    fg: cssColor('--fg'),
    muted: cssColor('--fg-faint'),
    boardDark: cssColor('--board-dark'),
    boardLight: cssColor('--board-light'),
    object: cssColor('--viz-object'),
    points: cssColor('--viz-points'),
    highlight: cssColor('--viz-highlight'),
    accent: cssColor('--accent'),
    axes: worldAxes.map(([, color]) => cssColor(color)),
  };
}

export class ImageView {
  readonly canvas = document.createElement('canvas');
  /** Just the sensor area, used as a texture on the 3D image plane. */
  readonly sensorCanvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private palette = readPalette();
  private last: { cam: CameraSnapshot; selected: number } | null = null;
  private projected: ({ u: number; v: number } | null)[] = [];

  constructor(container: HTMLElement, onSelect: (index: number) => void) {
    const fullW = IMAGE_WIDTH + 2 * MARGIN;
    const fullH = IMAGE_HEIGHT + 2 * MARGIN;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = fullW * dpr;
    this.canvas.height = fullH * dpr;
    this.canvas.style.aspectRatio = `${fullW} / ${fullH}`;
    this.canvas.className = 'image-canvas';
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(dpr, dpr);
    this.sensorCanvas.width = IMAGE_WIDTH;
    this.sensorCanvas.height = IMAGE_HEIGHT;
    container.append(this.canvas);

    this.canvas.addEventListener('click', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const u = ((e.clientX - rect.left) / rect.width) * fullW - MARGIN;
      const v = ((e.clientY - rect.top) / rect.height) * fullH - MARGIN;
      let best = -1;
      let bestDist = PICK_RADIUS;
      this.projected.forEach((p, i) => {
        if (!p) return;
        const d = Math.hypot(p.u - u, p.v - v);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      });
      if (best >= 0) onSelect(best);
    });

    onThemeChange(() => {
      this.palette = readPalette();
      if (this.last) this.render(this.last.cam, this.last.selected);
    });
  }

  render(cam: CameraSnapshot, selected: number): void {
    this.last = { cam, selected };
    const { ctx, palette: pal } = this;
    const { K, R, t, intrinsics } = cam;
    const fullW = IMAGE_WIDTH + 2 * MARGIN;
    const fullH = IMAGE_HEIGHT + 2 * MARGIN;

    const toCam = (X: Vec3) => project(K, R, t, X).Xc;
    const camToPixel = (Xc: Vec3): [number, number] => {
      const wuv = mulMat3Vec(K, Xc);
      return [wuv[0] / wuv[2], wuv[1] / wuv[2]];
    };
    const segment = (a: Vec3, b: Vec3) => {
      const clipped = clipSegmentNear(toCam(a), toCam(b), NEAR);
      if (!clipped) return;
      const [p, q] = clipped.map(camToPixel);
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(q[0], q[1]);
    };

    ctx.save();
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, fullW, fullH);
    ctx.translate(MARGIN, MARGIN);
    ctx.fillStyle = pal.sensor;
    ctx.fillRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);

    // Squares crossing the near plane are skipped rather than clipped.
    for (const sq of boardSquares) {
      const cs = sq.corners.map(toCam);
      if (cs.some((c) => c[2] < NEAR)) continue;
      const px = cs.map(camToPixel);
      ctx.beginPath();
      px.forEach(([u, v], i) => (i === 0 ? ctx.moveTo(u, v) : ctx.lineTo(u, v)));
      ctx.closePath();
      ctx.fillStyle = sq.dark ? pal.boardDark : pal.boardLight;
      ctx.fill();
    }

    ctx.lineWidth = 2.5;
    worldAxes.forEach(([end], i) => {
      ctx.beginPath();
      segment([0, 0, 0], end);
      ctx.strokeStyle = pal.axes[i];
      ctx.stroke();
    });

    ctx.beginPath();
    for (const [a, b] of cubeEdges) segment(cubePoints[a].X, cubePoints[b].X);
    ctx.strokeStyle = pal.object;
    ctx.lineWidth = 2;
    ctx.stroke();

    this.projected = cubePoints.map(({ X }) => {
      const p = project(K, R, t, X);
      return p.inFront ? { u: p.uv[0], v: p.uv[1] } : null;
    });
    ctx.font = '600 13px system-ui, sans-serif';
    this.projected.forEach((p, i) => {
      if (!p) return;
      const isSel = i === selected;
      ctx.beginPath();
      ctx.arc(p.u, p.v, isSel ? 6.5 : 4.5, 0, Math.PI * 2);
      ctx.fillStyle = isSel ? pal.highlight : pal.points;
      ctx.fill();
      if (isSel) {
        ctx.beginPath();
        ctx.arc(p.u, p.v, 11, 0, Math.PI * 2);
        ctx.strokeStyle = pal.highlight;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.fillStyle = isSel ? pal.highlight : pal.fg;
      ctx.fillText(cubePoints[i].label, p.u + 8, p.v - 8);
    });

    // Grab the texture for the 3D image plane before the margin and overlays are drawn.
    const sctx = this.sensorCanvas.getContext('2d')!;
    const dpr = this.canvas.width / fullW;
    sctx.drawImage(this.canvas, MARGIN * dpr, MARGIN * dpr, IMAGE_WIDTH * dpr, IMAGE_HEIGHT * dpr, 0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);

    ctx.fillStyle = pal.bg;
    ctx.globalAlpha = 0.72;
    ctx.fillRect(-MARGIN, -MARGIN, fullW, MARGIN);
    ctx.fillRect(-MARGIN, IMAGE_HEIGHT, fullW, MARGIN);
    ctx.fillRect(-MARGIN, 0, MARGIN, IMAGE_HEIGHT);
    ctx.fillRect(IMAGE_WIDTH, 0, MARGIN, IMAGE_HEIGHT);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = pal.border;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);
    ctx.fillStyle = pal.muted;
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText('(0, 0)', -38, -8);
    ctx.fillText('u →', 40, -8);
    ctx.save();
    ctx.translate(-10, 44);
    ctx.rotate(Math.PI / 2);
    ctx.fillText('v →', 0, 0);
    ctx.restore();
    ctx.fillText(`(${IMAGE_WIDTH}, ${IMAGE_HEIGHT})`, IMAGE_WIDTH - 30, IMAGE_HEIGHT + 18);

    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = pal.muted;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(IMAGE_WIDTH / 2, 0);
    ctx.lineTo(IMAGE_WIDTH / 2, IMAGE_HEIGHT);
    ctx.moveTo(0, IMAGE_HEIGHT / 2);
    ctx.lineTo(IMAGE_WIDTH, IMAGE_HEIGHT / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    const { u0, v0 } = intrinsics;
    ctx.strokeStyle = pal.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(u0 - 9, v0);
    ctx.lineTo(u0 + 9, v0);
    ctx.moveTo(u0, v0 - 9);
    ctx.lineTo(u0, v0 + 9);
    ctx.stroke();
    ctx.fillStyle = pal.accent;
    ctx.fillText('(u₀, v₀)', u0 + 8, v0 + 18);

    ctx.restore();
  }
}
