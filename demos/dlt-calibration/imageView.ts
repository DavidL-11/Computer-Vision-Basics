// The camera image of the calibration target: observed (noisy) corners, their reprojections with the estimated M̂,
// and the reprojection errors magnified so that sub-pixel differences become visible.

import { type Mat34, type Vec3 } from '../../src/shared/linalg';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import { type Vec2, projectM } from './dlt';
import { IMAGE_HEIGHT, IMAGE_WIDTH, squares } from './scene';

export interface ImageScene {
  /** True projection, for drawing the target. */
  M: Mat34;
  /** Points not used for the calibration. */
  unused: Vec2[];
  observed: Vec2[];
  /** M̂ Xᵢ for the used points, or null if there is no estimate. */
  reprojected: Vec2[] | null;
  magnify: number;
}

export class ImageView {
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private last: ImageScene | null = null;

  constructor(container: HTMLElement) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = IMAGE_WIDTH * dpr;
    this.canvas.height = IMAGE_HEIGHT * dpr;
    this.canvas.style.aspectRatio = `${IMAGE_WIDTH} / ${IMAGE_HEIGHT}`;
    this.canvas.className = 'image-canvas';
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(dpr, dpr);
    container.append(this.canvas);
    onThemeChange(() => this.last && this.render(this.last));
  }

  render(scene: ImageScene): void {
    this.last = scene;
    const { ctx } = this;
    ctx.fillStyle = cssColor('--bg-elev');
    ctx.fillRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);

    const project = (X: Vec3) => projectM(scene.M, X);
    ctx.fillStyle = cssColor('--board-dark');
    for (const sq of squares.filter((s) => s.dark)) {
      ctx.beginPath();
      sq.corners.map(project).forEach(([u, v], i) => (i === 0 ? ctx.moveTo(u, v) : ctx.lineTo(u, v)));
      ctx.closePath();
      ctx.fill();
    }

    this.dots(scene.unused, cssColor('--fg-faint'), 2.5);
    this.dots(scene.observed, cssColor('--viz-points'), 3.5);

    if (scene.reprojected) {
      const k = scene.magnify;
      ctx.strokeStyle = cssColor('--viz-highlight');
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      scene.observed.forEach(([u, v], i) => {
        const [ru, rv] = scene.reprojected![i];
        ctx.moveTo(u, v);
        ctx.lineTo(u + k * (ru - u), v + k * (rv - v));
      });
      ctx.stroke();
      ctx.strokeStyle = cssColor('--accent');
      ctx.lineWidth = 1.5;
      for (const [u, v] of scene.reprojected) {
        ctx.beginPath();
        ctx.arc(u, v, 6, 0, 2 * Math.PI);
        ctx.stroke();
      }
    }
  }

  private dots(points: Vec2[], color: string, radius: number): void {
    const { ctx } = this;
    ctx.fillStyle = color;
    for (const [u, v] of points) {
      ctx.beginPath();
      ctx.arc(u, v, radius, 0, 2 * Math.PI);
      ctx.fill();
    }
  }
}
