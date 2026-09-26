import { clipSegmentNear } from '../../src/shared/camera';
import type { Vec3 } from '../../src/shared/linalg';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import { GRID, IMAGE_HEIGHT, IMAGE_WIDTH, PILLARS, SUBJECT, type Segment } from './scene';

/** Camera coordinates → image pixel, or null if the point cannot be imaged. */
export type Projector = (Xc: Vec3) => [number, number] | null;

export interface ImageLayers {
  toCamera: (X: Vec3) => Vec3;
  main: Projector;
  /** Needs near-plane clipping (perspective only). */
  mainClips: boolean;
  ghost: Projector | null;
  ghostClips: boolean;
}

const NEAR = 0.05;

export class ImageView {
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private last: ImageLayers | null = null;

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

  render(layers: ImageLayers): void {
    this.last = layers;
    const { ctx } = this;
    ctx.fillStyle = cssColor('--bg-elev');
    ctx.fillRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);

    const draw = (project: Projector, clips: boolean, segments: Segment[]) => {
      ctx.beginPath();
      for (const [a, b] of segments) {
        let ends: [Vec3, Vec3] | null = [layers.toCamera(a), layers.toCamera(b)];
        if (clips) ends = clipSegmentNear(ends[0], ends[1], NEAR);
        if (!ends) continue;
        const p = project(ends[0]);
        const q = project(ends[1]);
        if (!p || !q) continue;
        ctx.moveTo(p[0], p[1]);
        ctx.lineTo(q[0], q[1]);
      }
      ctx.stroke();
    };
    const scene = (project: Projector, clips: boolean, ghost: boolean) => {
      ctx.globalAlpha = ghost ? 0.5 : 1;
      ctx.setLineDash(ghost ? [5, 4] : []);
      ctx.lineWidth = 1;
      ctx.strokeStyle = ghost ? cssColor('--accent') : cssColor('--viz-grid');
      if (!ghost) draw(project, clips, GRID);
      ctx.lineWidth = ghost ? 1.2 : 1.8;
      ctx.strokeStyle = ghost ? cssColor('--accent') : cssColor('--fg-muted');
      draw(project, clips, PILLARS);
      ctx.lineWidth = ghost ? 1.5 : 2.5;
      ctx.strokeStyle = ghost ? cssColor('--accent') : cssColor('--viz-object');
      draw(project, clips, SUBJECT);
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
    };

    scene(layers.main, layers.mainClips, false);
    if (layers.ghost) scene(layers.ghost, layers.ghostClips, true);

    ctx.strokeStyle = cssColor('--fg-faint');
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(IMAGE_WIDTH / 2, 0);
    ctx.lineTo(IMAGE_WIDTH / 2, IMAGE_HEIGHT);
    ctx.moveTo(0, IMAGE_HEIGHT / 2);
    ctx.lineTo(IMAGE_WIDTH, IMAGE_HEIGHT / 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
