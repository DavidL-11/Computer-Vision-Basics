# Computer Vision Basics

[![Live demos](https://img.shields.io/badge/demos-live-2ea44f?logo=githubpages&logoColor=white)](https://davidl-11.github.io/Computer-Vision-Basics/)
[![Deploy](https://img.shields.io/github/actions/workflow/status/DavidL-11/Computer-Vision-Basics/deploy.yml?branch=main&label=deploy&logo=githubactions&logoColor=white)](https://github.com/DavidL-11/Computer-Vision-Basics/actions/workflows/deploy.yml)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue)](https://github.com/DavidL-11/Computer-Vision-Basics/blob/main/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/DavidL-11/Computer-Vision-Basics?logo=github&color=yellow)](https://github.com/DavidL-11/Computer-Vision-Basics/stargazers)

Interactive computer vision fundamentals: **https://davidl-11.github.io/Computer-Vision-Basics/**

If you found this repository useful, please consider starring it on GitHub.

## Available demos

- [Sampling & quantization](https://davidl-11.github.io/Computer-Vision-Basics/demos/sampling-quantization/) (Images, Color and Gamma)
- [Bayer pattern & demosaicing](https://davidl-11.github.io/Computer-Vision-Basics/demos/bayer-demosaicing/) (Images, Color and Gamma)
- [Color space explorer](https://davidl-11.github.io/Computer-Vision-Basics/demos/color-spaces/) (Images, Color and Gamma)
- [Chroma subsampling](https://davidl-11.github.io/Computer-Vision-Basics/demos/chroma-subsampling/) (Images, Color and Gamma)
- [Gamma](https://davidl-11.github.io/Computer-Vision-Basics/demos/gamma/) (Images, Color and Gamma)
- [Convolution & correlation](https://davidl-11.github.io/Computer-Vision-Basics/demos/convolution/) (Image Filtering)
- [Gaussian & separability](https://davidl-11.github.io/Computer-Vision-Basics/demos/separable-gaussian/) (Image Filtering)
- [Template matching](https://davidl-11.github.io/Computer-Vision-Basics/demos/template-matching/) (Image Filtering)
- [Median vs mean filter](https://davidl-11.github.io/Computer-Vision-Basics/demos/median-filter/) (Image Filtering)
- [Morphology & connected components](https://davidl-11.github.io/Computer-Vision-Basics/demos/morphology/) (Image Filtering)
- [Aliasing & Moiré](https://davidl-11.github.io/Computer-Vision-Basics/demos/aliasing/) (Frequency Domain)
- [Fourier series](https://davidl-11.github.io/Computer-Vision-Basics/demos/fourier-series/) (Frequency Domain)
- [2D Fourier transform](https://davidl-11.github.io/Computer-Vision-Basics/demos/fourier-transform/) (Frequency Domain)
- [Homogeneous coordinates](https://davidl-11.github.io/Computer-Vision-Basics/demos/homogeneous-coordinates/) (Cameras and Optics)
- [Pinhole camera: intrinsics & extrinsics](https://davidl-11.github.io/Computer-Vision-Basics/demos/camera-model/) (Cameras and Optics)

## Read the code, too

The algorithms behind the demos are written out by hand instead of calling an image-processing library, so the code
is meant to be read alongside the demos. This is a deliberate choice for learning: the implementations favor clarity
over speed, while staying fast enough for the image sizes in the demos.

- Each demo keeps its math in a small, pure TypeScript module next to its page, e.g.
  [`demos/template-matching/matching.ts`](demos/template-matching/matching.ts) or
  [`demos/fourier-transform/spectrum.ts`](demos/fourier-transform/spectrum.ts). The conventions are documented at the
  top of each file.
- Building blocks shared by several demos are in [`src/shared/`](src/shared/), e.g. linear filtering in
  [`filter.ts`](src/shared/filter.ts), the fast Fourier transform in [`fft.ts`](src/shared/fft.ts) and color
  conversions in [`color.ts`](src/shared/color.ts).
- The `*.test.ts` file next to each module checks the math against definitions and known results. They are a good
  place to see what each function is expected to do.
