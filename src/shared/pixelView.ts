import { type RGBImage, clamp01 } from './image';

export interface ViewTransform {
  /** Display (CSS) pixels per image pixel. */
  scale: number;
  /** Image coordinates → display coordinates; pixel (x, y) covers [x, x + 1) × [y, y + 1). */
  toView(x: number, y: number): [number, number];
}

export function toImageData(img: RGBImage): ImageData {
  const out = new ImageData(img.width, img.height);
  for (let i = 0, j = 0; i < img.data.length; i += 3, j += 4) {
    out.data[j] = Math.round(clamp01(img.data[i]) * 255);
    out.data[j + 1] = Math.round(clamp01(img.data[i + 1]) * 255);
    out.data[j + 2] = Math.round(clamp01(img.data[i + 2]) * 255);
    out.data[j + 3] = 255;
  }
  return out;
}

/** Coalesces calls into one per animation frame, e.g. while dragging a slider. */
export function perFrame(fn: () => void): () => void {
  let pending = false;
  return () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      fn();
    });
  };
}

/**
 * Shows an image with nearest-neighbor magnification, so individual pixels stay visible.
 * Optionally zooms into a region and reports the pixel under the pointer.
 */
export class PixelView {
  readonly canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private src = document.createElement('canvas');
  private img: RGBImage | null = null;
  private zoom = 1;
  private center: [number, number] = [0, 0];
  overlay: ((ctx: CanvasRenderingContext2D, t: ViewTransform) => void) | null = null;

  constructor(container: HTMLElement, onPick?: (x: number, y: number, e: PointerEvent) => void) {
    this.canvas.className = 'pixel-canvas';
    this.ctx = this.canvas.getContext('2d')!;
    container.append(this.canvas);
    new ResizeObserver(() => this.draw()).observe(this.canvas);

    if (!onPick) return;
    this.canvas.classList.add('pickable');
    const pick = (e: PointerEvent) => {
      if (!this.img) return;
      const rect = this.canvas.getBoundingClientRect();
      const { x0, y0, w, h } = this.region();
      const x = Math.floor(x0 + ((e.clientX - rect.left) / rect.width) * w);
      const y = Math.floor(y0 + ((e.clientY - rect.top) / rect.height) * h);
      onPick(Math.min(this.img.width - 1, Math.max(0, x)), Math.min(this.img.height - 1, Math.max(0, y)), e);
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      this.canvas.setPointerCapture(e.pointerId);
      pick(e);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.canvas.hasPointerCapture(e.pointerId)) pick(e);
    });
  }

  show(img: RGBImage): void {
    if (this.src.width !== img.width || this.src.height !== img.height) {
      this.src.width = img.width;
      this.src.height = img.height;
      this.canvas.style.aspectRatio = `${img.width} / ${img.height}`;
    }
    this.img = img;
    this.src.getContext('2d')!.putImageData(toImageData(img), 0, 0);
    this.draw();
  }

  /** Magnifies by `zoom` around the image point (cx, cy), clamped to the image. */
  setZoom(zoom: number, cx: number, cy: number): void {
    this.zoom = zoom;
    this.center = [cx, cy];
    this.draw();
  }

  private region() {
    const img = this.img!;
    const w = img.width / this.zoom;
    const h = img.height / this.zoom;
    const x0 = Math.min(img.width - w, Math.max(0, Math.round(this.center[0] - w / 2)));
    const y0 = Math.min(img.height - h, Math.max(0, Math.round(this.center[1] - h / 2)));
    return { x0, y0, w, h };
  }

  draw(): void {
    if (!this.img) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssWidth = this.canvas.clientWidth;
    if (cssWidth === 0) return;
    const width = Math.round(cssWidth * dpr);
    const height = Math.round((width * this.img.height) / this.img.width);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const { ctx } = this;
    const { x0, y0, w, h } = this.region();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.src, x0, y0, w, h, 0, 0, width, height);
    if (!this.overlay) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const scale = cssWidth / w;
    this.overlay(ctx, { scale, toView: (x, y) => [(x - x0) * scale, (y - y0) * scale] });
  }
}
