// One camera image with the correspondences and epipolar lines of the estimated and the true F, zoomed out so that
// the epipoles can be found. Clicking selects the nearest correspondence.

import { toPixel } from '../../src/shared/epipolar';
import type { Vec3 } from '../../src/shared/linalg';
import { type Vec2, clipLine } from '../../src/shared/lines';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import { IMAGE_HEIGHT, IMAGE_WIDTH } from './scene';

const WIDTH = 800;
const HEIGHT = 600;

export interface ImageScene {
  sub: string;
  points: Vec2[];
  /** Other points, not used for the estimate. */
  test: Vec2[];
  selected: number;
  /** Estimated epipolar lines, one per point, and the true ones. */
  lines: Vec3[];
  trueLines: Vec3[];
  allLines: boolean;
  epipole: Vec3 | null;
  trueEpipole: Vec3;
  zoomOut: number;
}

export class ImageView {
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private last: ImageScene | null = null;

  constructor(container: HTMLElement, onSelect: (index: number) => void) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = WIDTH * dpr;
    this.canvas.height = HEIGHT * dpr;
    this.canvas.style.aspectRatio = `${WIDTH} / ${HEIGHT}`;
    this.canvas.className = 'image-canvas pickable';
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(dpr, dpr);
    container.append(this.canvas);
    onThemeChange(() => this.last && this.render(this.last));

    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.last?.points.length) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * WIDTH;
      const y = ((e.clientY - rect.top) / rect.height) * HEIGHT;
      const { X, Y } = this.mapping(this.last.zoomOut);
      const d = this.last.points.map(([u, v]) => Math.hypot(X(u) - x, Y(v) - y));
      onSelect(d.indexOf(Math.min(...d)));
    });
  }

  private mapping(zoomOut: number) {
    const k = WIDTH / IMAGE_WIDTH / zoomOut;
    return {
      k,
      X: (u: number) => WIDTH / 2 + (u - IMAGE_WIDTH / 2) * k,
      Y: (v: number) => HEIGHT / 2 + (v - IMAGE_HEIGHT / 2) * k,
      vis: [IMAGE_WIDTH / 2 - WIDTH / 2 / k, IMAGE_WIDTH / 2 + WIDTH / 2 / k, IMAGE_HEIGHT / 2 - HEIGHT / 2 / k, IMAGE_HEIGHT / 2 + HEIGHT / 2 / k] as const,
    };
  }

  render(scene: ImageScene): void {
    this.last = scene;
    const { ctx } = this;
    const { k, X, Y, vis } = this.mapping(scene.zoomOut);
    const drawLines = (lines: Vec3[]) => {
      ctx.beginPath();
      for (const l of lines) {
        const s = clipLine(l, ...vis);
        if (!s) continue;
        ctx.moveTo(X(s[0][0]), Y(s[0][1]));
        ctx.lineTo(X(s[1][0]), Y(s[1][1]));
      }
      ctx.stroke();
    };
    const dot = ([u, v]: Vec2, r: number, fill: boolean) => {
      ctx.beginPath();
      ctx.arc(X(u), Y(v), r, 0, 2 * Math.PI);
      if (fill) ctx.fill();
      else ctx.stroke();
    };

    ctx.fillStyle = cssColor('--bg-sunken');
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = cssColor('--bg-elev');
    ctx.fillRect(X(0), Y(0), IMAGE_WIDTH * k, IMAGE_HEIGHT * k);

    const sel = scene.selected;
    const pick = <T>(list: T[]) => (scene.allLines ? list : list.filter((_, i) => i === sel));
    ctx.strokeStyle = cssColor('--fg-faint');
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 5]);
    drawLines(pick(scene.trueLines));
    ctx.setLineDash([]);
    ctx.strokeStyle = cssColor('--accent');
    ctx.globalAlpha = scene.allLines ? 0.55 : 1;
    ctx.lineWidth = scene.allLines ? 1 : 2;
    drawLines(pick(scene.lines));
    ctx.globalAlpha = 1;
    if (scene.allLines && scene.lines[sel]) {
      ctx.lineWidth = 2.5;
      drawLines([scene.lines[sel]]);
    }

    ctx.strokeStyle = cssColor('--fg-muted');
    ctx.lineWidth = 1.5;
    ctx.strokeRect(X(0), Y(0), IMAGE_WIDTH * k, IMAGE_HEIGHT * k);

    ctx.strokeStyle = cssColor('--fg-faint');
    ctx.lineWidth = 1.25;
    for (const p of scene.test) dot(p, 2.5, false);
    ctx.fillStyle = cssColor('--viz-points');
    for (const p of scene.points) dot(p, 3.5, true);
    if (scene.points[sel]) {
      ctx.fillStyle = cssColor('--viz-highlight');
      dot(scene.points[sel], 6, true);
    }

    this.epipole(scene.trueEpipole, false, X, Y);
    if (scene.epipole) this.epipole(scene.epipole, true, X, Y);
    ctx.fillStyle = cssColor('--fg-muted');
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`image ${scene.sub}`, X(0) + 6, Y(0) - 6);
  }

  /** The estimated epipole as a dot, the true one as a ring; nothing if it is off the canvas. */
  private epipole(e: Vec3, estimate: boolean, X: (u: number) => number, Y: (v: number) => number): void {
    const p = toPixel(e);
    if (!p || X(p[0]) < 0 || X(p[0]) > WIDTH || Y(p[1]) < 0 || Y(p[1]) > HEIGHT) return;
    const { ctx } = this;
    const color = cssColor('--viz-object');
    ctx.beginPath();
    ctx.arc(X(p[0]), Y(p[1]), estimate ? 5 : 9, 0, 2 * Math.PI);
    if (estimate) {
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
}
