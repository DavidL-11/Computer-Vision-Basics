import { eq, fmt, renderTex, texMatrix, texTuple, texVector } from '../../src/shared/tex';
import { type CameraSnapshot, fieldOfView, project } from '../../src/shared/camera';
import { IMAGE_HEIGHT, IMAGE_WIDTH, cubePoints } from './scene';

export class MatrixView {
  constructor(private el: HTMLElement) {}

  render(cam: CameraSnapshot, selected: number): void {
    const { K, R, t, C, P, intrinsics } = cam;
    const fov = fieldOfView(intrinsics, IMAGE_WIDTH, IMAGE_HEIGHT);
    const point = cubePoints[selected];
    const p = project(K, R, t, point.X);

    const Kr = [K.slice(0, 3), K.slice(3, 6), K.slice(6, 9)];
    const Rt = [
      [R[0], R[1], R[2], t[0]],
      [R[3], R[4], R[5], t[1]],
      [R[6], R[7], R[8], t[2]],
    ];
    const Pr = [P.slice(0, 4), P.slice(4, 8), P.slice(8, 12)];

    const toCamera = eq(`\\mathbf{X}_c = R\\,\\mathbf{X}_w + t = ${texVector(p.Xc, 3)}`);
    const chain = p.inFront
      ? [
          toCamera,
          eq(`w \\begin{bmatrix} u \\\\ v \\\\ 1 \\end{bmatrix} = K\\,\\mathbf{X}_c = ${texVector(p.wuv, 1)}`),
          eq(
            `w = Z_c = ${fmt(p.depth, 3)}, \\quad (u, v) = \\left(\\frac{wu}{w}, \\frac{wv}{w}\\right) = \\htmlClass{result}{${texTuple(p.uv, 1)}}`,
          ),
          `<p class="muted small">${
            p.uv[0] >= 0 && p.uv[0] <= IMAGE_WIDTH && p.uv[1] >= 0 && p.uv[1] <= IMAGE_HEIGHT
              ? 'Inside the image.'
              : 'Outside the image bounds: the point is in front of the camera but outside the field of view.'
          }</p>`,
        ].join('')
      : [
          toCamera,
          `<p class="warn">${renderTex(`Z_c = ${fmt(p.Xc[2], 3)} \\le 0`)}: the point is behind the camera and is not imaged.</p>`,
        ].join('');

    this.el.innerHTML = `
      <div class="mat-grid">
        <div class="mat-block">
          <h3>Intrinsics K</h3>
          ${eq(`K = ${texMatrix(Kr, 1)}`)}
          <p class="muted small">
            ${renderTex('\\mathrm{AFOV} = 2 \\arctan\\frac{H}{2f}')}:
            ${fmt(fov.h, 1)}° horizontal (${renderTex('H = 640, f_x')}),
            ${fmt(fov.v, 1)}° vertical (${renderTex('H = 480, f_y')})
          </p>
        </div>
        <div class="mat-block">
          <h3>Extrinsics [R | t]</h3>
          ${eq(`[R \\mid t] = ${texMatrix(Rt, 3, 3)}`)}
          ${eq(`C = -R^{-1} t = -R^\\top t = ${texVector(C, 2)}`)}
        </div>
        <div class="mat-block wide">
          <h3>Projection matrix P = K [R | t]</h3>
          ${eq(`P = ${texMatrix(Pr, 1)}`)}
        </div>
        <div class="mat-block wide chain">
          <h3>Vertex <span class="point-tag">${point.label}</span> step by step</h3>
          ${eq(`\\mathbf{X}_w = ${texVector(point.X, 2)}`)}
          ${chain}
        </div>
      </div>`;
  }
}
