# Computer Vision Basics

A GitHub Pages site that teaches computer vision fundamentals through small interactive demos, organized by lecture.
Content is in English.

## Commands

```sh
npm run dev       # dev server
npm test          # Vitest unit tests
npm run build     # tsc --noEmit + vite build into dist/
npm run preview   # serve dist/ at http://localhost:4173/Computer-Vision-Basics/
```

## Stack and layout

- Vite multi-page build with TypeScript and no UI framework. `base` is `/Computer-Vision-Basics/`, so build internal links from
  `import.meta.env.BASE_URL`.
- Three.js for 3D, Canvas 2D/WebGL for 2D, our own control kit (`src/shared/controls.ts`), and plain CSS with custom
  properties. IBM Plex Sans/Mono are self-hosted through `@fontsource` (imported in `base.css`).
- `src/data/chapters.ts` is the single source of truth for the site. The landing page is prerendered from it at
  build time (`src/landing/render.ts`): chapters, key concepts and the existing demos.
- Each page's `<title>` and meta description in its `index.html` are what search engines show; canonical and
  social tags are added at build time (`build/seo.ts`).
- `PLANS.md` holds ideas for future demos. It is not part of the website.
- `src/shared/`:
  - `page.ts`: `initPage()` adds the header, breadcrumb, theme toggle and footer.
  - `controls.ts`: the control kit. One `Controls` hub per page; `ui.toolbar()` and `ui.panel(id)` create a group in
    the toolbar or in the side column of the panel containing `#id`. Groups have a Tweakpane-like API
    (`addBinding`, `addButton`, `addFolder`, `addResetButton`); the view follows the value (slider, switch, segments or
    select, color, point). `ui.refresh()` re-reads all values and sends `change` for each one that differs.
  - `theme.ts`: light/dark handling plus `cssColor()`.
  - `linalg.ts`: small row-major Vec3/Mat3 helpers.
  - `camera.ts`: pinhole camera math: `buildK`, `buildR` (yaw/pitch/roll), `buildT`, `snapshot()` → K, R, t, C, P,
    `project`, `backproject`, `lookAtAngles`, `fieldOfView`, `clipSegmentNear`.
  - `opencv.ts`: lazy `loadOpenCV()`.
  - `image.ts`: `RGBImage`/`Plane` as plain Float32Arrays in [0, 1], `mapPixels()`, `toGray()`,
    `splitChannels()`/`mergeChannels()`, `centerCrop()`, `psnr()`.
  - `filter.ts`: linear filtering of a `Plane`: `correlate`/`convolve` with border modes, separable passes,
    `gaussianKernel`, `boxKernel1D`, `diskKernel` (area-weighted, for defocus and pinhole blur) with the fast
    `correlateDisk`, `padPlane`.
  - `color.ts`: sRGB decode/encode, BT.601 luma, YCbCr, hex helpers.
  - `noise.ts`: seeded `random()` and `gaussianNoise()` for a `Plane`.
  - `pixelView.ts`: `PixelView` shows an `RGBImage` with visible pixels, zoom, picking and overlays; `perFrame()`.
  - `testImages.ts` / `imagePicker.ts`: procedural test images and an image list with a button to open
    your own image.
  - `fft.ts`: radix-2 FFT, `fft2`/`ifft2` of a `Plane` (power-of-2 sizes, DC at index 0), `fftShift()` for display.
  - `harris.ts`: image `derivatives()`, Gaussian-windowed `secondMoment()`, 2×2 `eigen()`, Harris `cornerness()` /
    `harris()` and `localMaxima()` (non-maximum suppression).
  - `warp.ts`: a known similarity `Transform` plus gain/bias, `mapPoint`/`unmapPoint`, bilinear `warp()` and
    `commonRegion()`, for comparing an image with a transformed copy.
  - `dog.ts`: Gaussian scale space in octaves, DoG images, `detectKeypoints()` with interpolation and contrast/edge
    rejection, `locate()` for a σ, `dogSignature()` and `normalizedLoG()`.
  - `sift.ts`: orientation histogram, `dominantOrientations()`, the 4 × 4 × 8 `describe()`, `siftFeatures()` and
    descriptor `distance()`.
  - `matrix.ts`: dense `Matrix` (row arrays) of any size: `transpose`, `multiply`, `matVec`, `solve` (Gaussian
    elimination with partial pivoting) and `leastSquares` via the normal equations AᵀA x = Aᵀb.
  - `svd.ts`: one-sided Jacobi `svd()` (V always full n × n), `nullVector()` for Ax = 0, `pseudoInverseSolve()`
    (VΣ⁻¹Uᵀb) and `rankApprox()`.
  - `lines.ts`: homogeneous 2D lines: `normalizeLine`, `clipLine` to a rectangle, signed `pointLineDistance`.
  - `epipolar.ts`: two-view geometry from P₀, P₁: `skew` ([v]×), `pseudoInverseP` (P⁺), `centerFromP` (null space),
    `twoView()` → C₀, C₁, e₀, e₁ and F = [e₁]× P₁ P₀⁺, `epipoles(F)`, `epipolarLine`/`epipolarLineT`, `unitF`, `toPixel`.
  - `plot.ts`: `Plot` canvas for function graphs, stems and bars with axes; colors given as CSS tokens.
  - `tex.ts`: TeX helpers (`renderTex`, `eq`, `fmt`, `sci`, `texMatrix`, `texSciMatrix`, `texVector`, `texTuple`) for panels
    with live values.
  - `styles/base.css`: design tokens, fonts, header and footer. `styles/controls.css`: the control kit.
  - `styles/demo.css`: shared demo layout (intro, toolbar, panels with their controls, `.values` card, explanation,
    `.demo-section` for pages with independent parts). Import it in
    each demo's `main.ts` before the demo's own CSS.
- `demos/<slug>/`: one self-contained demo per folder, each with its own `index.html`. `vite.config.ts` picks up
  every `demos/*/index.html` automatically.

## Adding a demo

1. Create `demos/<slug>/index.html` (copy the structure of `demos/coarse-to-fine/index.html`, or
   `demos/aliasing/index.html` for a page with sections) and `main.ts`.
2. In `main.ts`, call `initPage({ title, chapterId })` first. `chapterId` is the chapter's `id` in `chapters.ts`.
3. Add the demo to its chapter in `src/data/chapters.ts` (`title`, `description`, `slug`).
4. Remove its entry from `PLANS.md`, if it was there.
5. Add the demo to the list in `README.md`.

Conventions for demos:
- Keep the math in pure functions in their own module, with a `*.test.ts` next to it (see `camera.ts` and
  `camera.test.ts`). Implement the math visibly rather than hiding it behind library calls, since showing it is the
  point of the site.
- If a library function (e.g. from OpenCV.js) would give a real performance gain over the hand-written math, say so
  explicitly and ask the user before using it; never switch on your own.
- Colors come from CSS tokens in `base.css` (`--viz-*`, `--axis-*`, etc.). Demo-specific tokens use `light-dark()`
  in the demo's CSS. Canvas/WebGL code reads colors with `cssColor('--token')` and redraws in `onThemeChange()`.
- Controls sit next to what they change. A control goes into the side column of the panel where its quantity is
  defined or drawn (window radius on I₀, filter settings on the filtered result). The toolbar above the panels only
  holds inputs to the whole demo (input image, global noise, presets), display options that apply equally to several
  panels (zoom), playback, and Reset. A page with independent parts gets one `.demo-section` per part, each with its
  own panels, values card and Reset; never one set of controls for several parts.
- Panel markup: `<figure class="view card">` with `<figcaption><span class="view-title">…</span> <span
  class="view-hint">…</span></figcaption>` (or `view-hint legend` with `.key` items), then `<div class="view-body"><div
  class="view-main">…</div></div>`. The values card is `<section class="card values"><div class="view-body"><div
  id="values" class="view-main values-body"></div></div></section>`. Every Reset calls `ui.refresh()` and `schedule()`.
- Only load OpenCV.js through `loadOpenCV()`, and only in demos that need it; never bundle it.
- Each demo page has a short intro, the interactive part, then an explanation section with "Try this" prompts.
- Formulas and notation follow the lecture, e.g. x = K[R | t]X with w·(u, v, 1)ᵀ, principal point (u₀, v₀),
  C = −R⁻¹t, AFOV = 2·arctan(H / 2f). Keep each demo focused on one topic and link related demos instead of
  repeating their material.
- Camera/geometry demos use the usual computer vision camera convention (x right, y down, z forward, as in
  OpenCV) and a right-handed world frame with Z up.

## Website content

User-facing text (pages, explanations, chapter data) is about computer vision, never about how the site is built.
Don't mention libraries, frameworks or rendering technology. High-level facts that matter for understanding the
material, such as coordinate conventions, are fine. Don't show planned or upcoming demos on the site; they belong
in `PLANS.md`.

## Adding a chapter or demo idea

Add chapters in `src/data/chapters.ts`; they are ordered by `number`, and `demos` can be empty. Demo ideas go into
`PLANS.md` under their chapter.

## Code style

Comments only where they add knowledge the code doesn't show: conventions, non-obvious math, workarounds. No
comments on trivial code.
