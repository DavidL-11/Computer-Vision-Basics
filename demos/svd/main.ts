import { Controls } from '../../src/shared/controls';
import { eigen } from '../../src/shared/harris';
import { type Plane, type RGBImage, planeToImage, psnr, toGray } from '../../src/shared/image';
import { addImagePicker } from '../../src/shared/imagePicker';
import { initPage } from '../../src/shared/page';
import { PixelView, perFrame } from '../../src/shared/pixelView';
import { Plot } from '../../src/shared/plot';
import { type SVD, svd } from '../../src/shared/svd';
import { eq, fmt, renderTex, texMatrix, texVector } from '../../src/shared/tex';
import { onThemeChange } from '../../src/shared/theme';
import { StagesView } from './stagesView';
import { type Mat2, type SVD2, type Solution, type Vec2, approximate, det2, energy, planeToMatrix, solve2, storage, svd2 } from './svd2';
import '../../src/shared/styles/demo.css';
import './svd.css';

initPage({ title: 'SVD visualized', chapterId: 'calibration' });

const IMG_W = 160;
const IMG_H = 120;

const PRESETS: Record<string, Mat2> = {
  general: [1.2, 0.8, -0.4, 0.9],
  rotation: [Math.cos(Math.PI / 6), -Math.sin(Math.PI / 6), Math.sin(Math.PI / 6), Math.cos(Math.PI / 6)],
  scaling: [1.6, 0, 0, 0.5],
  shear: [1, 1, 0, 1],
  mirror: [-1, 0, 0, 1],
  'nearly singular': [1, 2, 0.5, 1.05],
  singular: [1, 2, 0.5, 1],
};

const defaults = () => {
  const [a, b, c, d] = PRESETS.general;
  return { a, b, c, d, bx: 1, by: 0.6, tau: 0.05, p: 8 };
};
const state = defaults();
const matrix = (): Mat2 => [state.a, state.b, state.c, state.d];

const ui = new Controls();
const matrixControls = ui.panel('stages-view');
const entries = matrixControls.addFolder({ title: 'Matrix A = [a b; c d]' });
const entry = { min: -2, max: 2, step: 0.01, format: (v: number) => fmt(v, 2) };
for (const key of ['a', 'b', 'c', 'd'] as const) entries.addBinding(state, key, { label: key, ...entry });
const presets = matrixControls.addFolder({ title: 'Presets' });
for (const [name, M] of Object.entries(PRESETS))
  presets.addButton({ title: name[0].toUpperCase() + name.slice(1) }).on('click', () => {
    // Rounded like the sliders, so a preset and the same values set by hand give the same result.
    [state.a, state.b, state.c, state.d] = M.map((v) => Math.round(v * 100) / 100);
    ui.refresh();
    schedule();
  });
const solveFolder = matrixControls.addFolder({ title: 'Solve Ax = b' });
solveFolder.addBinding(state, 'tau', { label: 'τ (keep σ > τ)', min: 0, max: 0.5, step: 0.01, format: (v: number) => fmt(v, 2) });
matrixControls.addResetButton(() => {
  const { a, b, c, d, bx, by, tau } = defaults();
  Object.assign(state, { a, b, c, d, bx, by, tau });
  ui.refresh();
  schedule();
});

const imageControls = ui.panel('original-view');
let image: RGBImage = addImagePicker(
  imageControls,
  { names: ['scene', 'text', 'chart', 'shapes', 'zone-plate'], value: 'scene', width: IMG_W, height: IMG_H },
  (img) => {
    setImage(img);
    schedule();
  },
);
imageControls.addBinding(state, 'p', { label: 'rank p', min: 1, max: Math.min(IMG_W, IMG_H), step: 1 });
imageControls.addResetButton(() => {
  state.p = defaults().p;
  ui.refresh();
});

const stagesView = new StagesView(document.getElementById('stages-view')!, ([x, y]) => {
  state.bx = x;
  state.by = y;
  schedule();
});
const originalView = new PixelView(document.getElementById('original-view')!);
const approxView = new PixelView(document.getElementById('approx-view')!);
const sigmaPlot = new Plot(document.getElementById('sigma-plot')!, 240);
const approxCaption = document.getElementById('approx-caption')!;
const matrixValues = document.getElementById('matrix-values')!;
const imageValues = document.getElementById('image-values')!;

let gray: Plane;
let imageSvd: SVD;
function setImage(img: RGBImage): void {
  image = img;
  gray = toGray(image);
  imageSvd = svd(planeToMatrix(gray));
  originalView.show(planeToImage(gray));
}
setImage(image);

function update(): void {
  const A = matrix();
  const s = svd2(A);
  const b: Vec2 = [state.bx, state.by];
  const sol = solve2(A, s, b, state.tau);
  stagesView.render({ s, b, x: sol.x });

  const p = state.p;
  const approx = approximate(imageSvd, p);
  approxView.show(planeToImage(approx));
  approxCaption.textContent = `rank ${p}`;
  drawSigma(imageSvd.sigma, p);
  renderValues(A, s, b, sol, approx);
}
const schedule = perFrame(update);

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const power = (e: number) => `10${e < 0 ? '⁻' : ''}${[...String(Math.abs(e))].map((d) => SUPERSCRIPT[+d]).join('')}`;

/** σₖ on a log scale; the band marks the ones that are kept. */
function drawSigma(sigma: number[], p: number): void {
  // Tiny values (e.g. rounding noise of an image with few distinct rows) are clipped at σ₁ · 10⁻⁸.
  const floor = sigma[0] * 1e-8;
  const logs = sigma.map((v) => Math.log10(Math.max(v, floor)));
  const y: [number, number] = [Math.floor(Math.min(...logs)), Math.ceil(Math.max(...logs))];
  const yTicks = Array.from({ length: y[1] - y[0] + 1 }, (_, i) => y[0] + i);
  const n = sigma.length;
  sigmaPlot.render({ x: [0, n + 1], y }, (f) => {
    f.grid(
      [1, ...Array.from({ length: Math.floor(n / 20) }, (_, i) => (i + 1) * 20)],
      yTicks.length > 7 ? yTicks.filter((t) => t % 2 === 0) : yTicks,
      { y: power },
    );
    f.band(0.5, p + 0.5, '--accent', 0.14);
    f.line(
      logs.map((v, i) => [i + 1, v] as const),
      '--fg-muted',
      { width: 1.5 },
    );
    const kept = logs.slice(0, p).map((v, i) => [i + 1, v] as const);
    f.line(kept, '--accent', { width: 2.5 });
    f.label(`p = ${p}`, p + 1.5, y[1] - 0.1 * (y[1] - y[0]), '--accent', 'left', 'top');
  });
}

const rows2 = ([a, b, c, d]: Mat2) => [
  [a, b],
  [c, d],
];

function renderValues(A: Mat2, s: SVD2, b: Vec2, sol: Solution, approx: Plane): void {
  const [a, bb, c, d] = A;
  const AtA: Mat2 = [a * a + c * c, a * bb + c * d, a * bb + c * d, bb * bb + d * d];
  const { l1, l2 } = eigen(AtA[0], AtA[1], AtA[3]);
  const Vt: Mat2 = [s.V[0], s.V[2], s.V[1], s.V[3]];
  const deg = (r: number) => fmt((r * 180) / Math.PI, 1);
  const inv = sol.inverted.map((ok, i) => (ok ? fmt(1 / s.sigma[i], 3) : '\\htmlClass{result}{0}'));
  const residual = Math.hypot(sol.Ax[0] - b[0], sol.Ax[1] - b[1]);
  const { rankP, full } = storage(IMG_H, IMG_W, state.p);
  const quality = psnr(gray, approx);

  matrixValues.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <h3>${renderTex('A = U \\Sigma V^\\top')}</h3>
        ${eq(`${texMatrix(rows2(A), 2)} = ${texMatrix(rows2(s.U), 3)} ${texMatrix(
          [
            [s.sigma[0], 0],
            [0, s.sigma[1]],
          ],
          3,
        )} ${texMatrix(rows2(Vt), 3)}`)}
        <p class="muted small">
          ${renderTex('V^\\top')}: rotation by ${renderTex(`${deg(-s.angleV)}^\\circ`)};
          ${renderTex('U')}: ${s.mirrored ? 'mirror, then rotation' : 'rotation'}, ${renderTex(`u_1`)} at ${renderTex(`${deg(s.angleU)}^\\circ`)};
          ${renderTex(`\\det A = ${fmt(det2(A), 3)} = ${s.mirrored ? '-' : ''}\\sigma_1 \\sigma_2`)}
        </p>
      </div>
      <div class="value-block">
        <h3>${renderTex('\\sigma_i^2 = \\lambda_i(A^\\top A)')}</h3>
        ${eq(`A^\\top A = ${texMatrix(rows2(AtA), 3)}`)}
        ${eq(`\\lambda_1 = ${fmt(l1, 4)},\\; \\sigma_1^2 = ${fmt(s.sigma[0] ** 2, 4)}`)}
        ${eq(`\\lambda_2 = ${fmt(l2, 4)},\\; \\sigma_2^2 = ${fmt(s.sigma[1] ** 2, 4)}`)}
      </div>
      <div class="value-block">
        <h3>Solve ${renderTex('Ax = b')} (click the last panel)</h3>
        ${eq(`x = V \\Sigma^{-1} U^\\top b,\\quad \\Sigma^{-1} = \\begin{bmatrix} ${inv[0]} & 0 \\\\ 0 & ${inv[1]} \\end{bmatrix}`)}
        ${eq(`b = ${texVector(b, 3)} \\;\\to\\; x = \\htmlClass{result}{${texVector(sol.x, 3)}}, \\; Ax = ${texVector(sol.Ax, 3)}`)}
        <p class="muted small">
          ${renderTex(`|Ax - b| = ${fmt(residual, 3)}`)}, ${renderTex(`|x| = ${fmt(Math.hypot(...sol.x), 3)}`)}
          ${sol.inverted[1] ? '' : `<br><span class="warn">σ₂ ≤ τ: 1/σ₂ is dropped, x is the least-squares solution of minimum norm.</span>`}
        </p>
      </div>
    </div>`;
  imageValues.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <h3>Rank-${state.p} image ${renderTex(`a_{ij} \\approx \\sum_{k=1}^{${state.p}} u_{ik} \\sigma_k v_{jk}`)}</h3>
        ${eq(`p\\,(m + n + 1) = ${state.p} \\cdot (${IMG_H} + ${IMG_W} + 1) = ${rankP}`)}
        ${eq(`m n = ${IMG_H} \\cdot ${IMG_W} = ${full} \\quad (${fmt((100 * rankP) / full, 1)}\\,\\%)`)}
        <p class="muted small">
          PSNR ${Number.isFinite(quality) && quality < 200 ? `${fmt(quality, 1)} dB` : '∞ (exact)'},
          kept ${renderTex('\\textstyle\\sum_{k \\le p} \\sigma_k^2 / \\sum_k \\sigma_k^2')} = ${fmt(100 * energy(imageSvd.sigma, state.p), 2)} %
        </p>
      </div>
    </div>`;
}

ui.on('change', schedule);
onThemeChange(schedule);
update();
