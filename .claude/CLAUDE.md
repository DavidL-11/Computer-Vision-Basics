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
- Three.js for 3D, Canvas 2D/WebGL for 2D, Tweakpane for controls, and plain CSS with custom properties.
- `src/data/chapters.ts` is the single source of truth for the site. The landing page is prerendered from it at
  build time (`src/landing/render.ts`): chapters, key concepts and the existing demos.
- Each page's `<title>` and meta description in its `index.html` are what search engines show; canonical and
  social tags are added at build time (`build/seo.ts`).
- `PLANS.md` holds ideas for future demos. It is not part of the website.
- `src/shared/`:
  - `page.ts`: `initPage()` adds the header, breadcrumb, theme toggle and footer.
  - `theme.ts`: light/dark handling plus `cssColor()`.
  - `linalg.ts`: small row-major Vec3/Mat3 helpers.
  - `opencv.ts`: lazy `loadOpenCV()`.
  - `image.ts`: `RGBImage`/`Plane` as plain Float32Arrays in [0, 1], `mapPixels()`, `psnr()`.
  - `color.ts`: sRGB decode/encode, BT.601 luma, YCbCr, hex helpers.
  - `pixelView.ts`: `PixelView` shows an `RGBImage` with visible pixels, zoom, picking and overlays; `perFrame()`.
  - `testImages.ts` / `imagePicker.ts`: procedural test images and a Tweakpane image list with "Open image…".
  - `tex.ts`: TeX helpers (`renderTex`, `eq`, `fmt`, `texMatrix`, `texVector`, `texTuple`) for panels with live values.
  - `styles/base.css`: design tokens and the Tweakpane theme.
  - `styles/demo.css`: shared demo layout (intro, views + controls, `.values` panel, explanation). Import it in
    each demo's `main.ts` before the demo's own CSS.
- `demos/<slug>/`: one self-contained demo per folder, each with its own `index.html`. `vite.config.ts` picks up
  every `demos/*/index.html` automatically.

## Adding a demo

1. Create `demos/<slug>/index.html` (copy the structure of `demos/camera-model/index.html`) and `main.ts`.
2. In `main.ts`, call `initPage({ title, chapterId })` first. `chapterId` is the chapter's `id` in `chapters.ts`.
3. Add the demo to its chapter in `src/data/chapters.ts` (`title`, `description`, `slug`).
4. Remove its entry from `PLANS.md`, if it was there.
5. Add the demo to the list in `README.md`.

Conventions for demos:
- Keep the math in pure functions in their own module, with a `*.test.ts` next to it (see `camera.ts` and
  `camera.test.ts`). Implement the math visibly rather than hiding it behind library calls, since showing it is the
  point of the site.
- Colors come from CSS tokens in `base.css` (`--viz-*`, `--axis-*`, etc.). Demo-specific tokens use `light-dark()`
  in the demo's CSS. Canvas/WebGL code reads colors with `cssColor('--token')` and redraws in `onThemeChange()`.
- Controls use Tweakpane, which is already themed through `base.css`.
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
