// Schematic side view of a thin lens. The object side uses a logarithmic distance scale, and the distance between each
// image point and the sensor is magnified, since the true defocus is a tiny fraction of the focal length. Within the
// drawing the cones are consistent: the blur on the sensor is where each cone meets it.

import { fmt } from '../../src/shared/tex';
import { cssColor, onThemeChange } from '../../src/shared/theme';
import { type DofLimits, imageDistance } from './thinLens';

const HEIGHT = 330;
const AXIS_Y = 150;
const RULER_Y = HEIGHT - 34;
/** Object distances on the ruler, in mm; farther points are drawn at its left end (∞). */
const D_MIN = 250;
const D_MAX = 100_000;
/** Heights of the scene points and the (schematic) magnification of their images. */
const IMAGE_SCALE = 0.45;

export interface DiagramPoint {
  distance: number;
  height: number;
  /** CSS color token. */
  color: string;
  coc: number;
}

export interface LensState {
  f: number;
  A: number;
  S: number;
  limits: DofLimits;
  points: DiagramPoint[];
}

export class LensDiagram {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private last: LensState | null = null;

  constructor(container: HTMLElement) {
    this.canvas.className = 'diagram-canvas';
    this.canvas.style.height = `${HEIGHT}px`;
    container.append(this.canvas);
    new ResizeObserver(() => this.draw()).observe(this.canvas);
    onThemeChange(() => this.draw());
  }

  render(s: LensState): void {
    this.last = s;
    this.draw();
  }

  private draw(): void {
    const s = this.last;
    const width = this.canvas.clientWidth;
    if (!s || width === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(HEIGHT * dpr);
    const { ctx } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const fg = cssColor('--fg');
    const muted = cssColor('--fg-muted');
    const faint = cssColor('--fg-faint');
    ctx.fillStyle = cssColor('--bg-elev');
    ctx.fillRect(0, 0, width, HEIGHT);
    ctx.font = '12px system-ui, sans-serif';

    const sensorX = width - 100;
    const L = Math.min(260, width * 0.3);
    const lensX = sensorX - L;
    const objLeft = 24;
    const objRight = lensX - 40;
    const objX = (D: number) => {
      const t = (Math.log(Math.min(Math.max(D, D_MIN), D_MAX)) - Math.log(D_MIN)) / Math.log(D_MAX / D_MIN);
      return D === Infinity ? objLeft - 10 : objRight - t * (objRight - objLeft);
    };
    // The aperture in the drawing grows with the square root of A, so both phone and large lenses fit.
    const half = Math.min(115, Math.max(10, 16 * Math.sqrt(s.A)));

    // Image distances relative to the sensor, z_D / z_S, magnified by g around the sensor.
    const zS = imageDistance(s.f, s.S);
    const ratios = s.points.map((p) => imageDistance(s.f, p.distance) / zS);
    // Image points in front of the sensor stay in the last 35 % before it, so that their cones, which cross and
    // spread again, meet the sensor in a disk no larger than the lens.
    const maxBefore = Math.max(1e-9, ...ratios.map((r) => 1 - r));
    const g = Math.max(1, Math.min(40, 0.35 / maxBefore));
    const apexX = (r: number) => lensX + L * (1 + g * (r - 1));

    ctx.strokeStyle = faint;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(0, AXIS_Y);
    ctx.lineTo(width, AXIS_Y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Depth of field on the distance ruler, and the focus plane.
    const nearX = objX(s.limits.near);
    const farX = objX(s.limits.far);
    ctx.fillStyle = cssColor('--accent');
    ctx.globalAlpha = 0.14;
    ctx.fillRect(farX, 16, nearX - farX, RULER_Y - 16);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = cssColor('--accent');
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(objX(s.S), 16);
    ctx.lineTo(objX(s.S), RULER_Y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = cssColor('--accent');
    ctx.textAlign = 'left';
    ctx.fillText('focus S', objX(s.S) + 5, 32);
    ctx.textAlign = 'center';
    if (nearX - farX > 90) ctx.fillText('depth of field', (nearX + farX) / 2, RULER_Y - 8);

    ctx.strokeStyle = muted;
    ctx.fillStyle = muted;
    ctx.beginPath();
    ctx.moveTo(objLeft - 10, RULER_Y);
    ctx.lineTo(objRight, RULER_Y);
    for (const m of [0.5, 1, 2, 5, 10, 20, 50]) {
      ctx.moveTo(objX(m * 1000), RULER_Y - 4);
      ctx.lineTo(objX(m * 1000), RULER_Y + 4);
    }
    ctx.stroke();
    ctx.textBaseline = 'top';
    for (const m of [0.5, 1, 2, 5, 10, 20, 50]) ctx.fillText(`${m} m`, objX(m * 1000), RULER_Y + 7);
    ctx.fillText('∞', objX(Infinity), RULER_Y + 7);
    ctx.textBaseline = 'alphabetic';

    // One cone of light per scene point: from the point to the lens, then converging to its image point.
    const labels: { y: number; text: string; color: string }[] = [];
    s.points.forEach((p, i) => {
      if (p.distance <= s.f) return;
      const px = objX(p.distance);
      const py = AXIS_Y - p.height;
      const qx = apexX(ratios[i]);
      const qy = AXIS_Y + p.height * IMAGE_SCALE;
      const top = AXIS_Y - half;
      const bottom = AXIS_Y + half;
      const atSensor = (y: number) => y + ((qy - y) * (sensorX - lensX)) / (qx - lensX);
      const ts = atSensor(top);
      const bs = atSensor(bottom);
      const color = cssColor(p.color);

      ctx.fillStyle = color;
      ctx.globalAlpha = 0.12;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(lensX, top);
      ctx.lineTo(lensX, bottom);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(lensX, top);
      ctx.lineTo(sensorX, ts);
      ctx.lineTo(sensorX, bs);
      ctx.lineTo(lensX, bottom);
      ctx.fill();
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(lensX, top);
      ctx.lineTo(sensorX, ts);
      ctx.moveTo(px, py);
      ctx.lineTo(lensX, bottom);
      ctx.lineTo(sensorX, bs);
      ctx.stroke();
      if (qx > sensorX) {
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(sensorX, ts);
        ctx.lineTo(qx, qy);
        ctx.lineTo(sensorX, bs);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, 2 * Math.PI);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(qx, qy, 3, 0, 2 * Math.PI);
      ctx.fill();

      // The circle of confusion: the cross-section of the cone at the sensor.
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(sensorX + 5 + i * 7, Math.min(ts, bs));
      ctx.lineTo(sensorX + 5 + i * 7, Math.max(ts, bs));
      ctx.stroke();
      ctx.lineCap = 'butt';
      labels.push({ y: (ts + bs) / 2, text: `${fmt(p.coc, 3)} mm`, color });
    });

    // Circle of confusion values next to the sensor, pushed apart so that they don't overlap.
    labels.sort((a, b) => a.y - b.y);
    labels.forEach((l, i) => {
      if (i > 0) l.y = Math.max(l.y, labels[i - 1].y + 16);
      ctx.fillStyle = l.color;
      ctx.textAlign = 'left';
      ctx.fillText(l.text, sensorX + 30, l.y + 4);
    });

    ctx.beginPath();
    ctx.ellipse(lensX, AXIS_Y, Math.max(4, half * 0.12), half, 0, 0, 2 * Math.PI);
    ctx.fillStyle = cssColor('--accent-soft');
    ctx.globalAlpha = 0.7;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = cssColor('--accent');
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.strokeStyle = fg;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(sensorX, 24);
    ctx.lineTo(sensorX, RULER_Y - 10);
    ctx.stroke();

    ctx.fillStyle = muted;
    ctx.textAlign = 'center';
    ctx.fillText(`lens, A = ${fmt(s.A, 1)} mm`, lensX, 16);
    ctx.fillText('sensor', sensorX, 16);
    ctx.textAlign = 'right';
    ctx.fillStyle = faint;
    ctx.fillText(`defocus magnified ${fmt(g, 0)}×`, width - 8, HEIGHT - 8);
  }
}
