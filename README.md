# Computer Vision Basics

[![Live demos](https://img.shields.io/badge/demos-live-2ea44f?logo=githubpages&logoColor=white)](https://davidl-11.github.io/Computer-Vision-Basics/)
[![Deploy](https://img.shields.io/github/actions/workflow/status/DavidL-11/Computer-Vision-Basics/deploy.yml?branch=main&label=deploy&logo=githubactions&logoColor=white)](https://github.com/DavidL-11/Computer-Vision-Basics/actions/workflows/deploy.yml)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue)](https://github.com/DavidL-11/Computer-Vision-Basics/blob/main/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/DavidL-11/Computer-Vision-Basics?logo=github&color=yellow)](https://github.com/DavidL-11/Computer-Vision-Basics/stargazers)

Interactive computer vision fundamentals: **https://davidl-11.github.io/Computer-Vision-Basics/**

If you found this repository useful, please consider starring it on GitHub.

## Available demos

### 1. Images, Color and Gamma

- [Sampling & quantization](https://davidl-11.github.io/Computer-Vision-Basics/demos/sampling-quantization/)
- [Bayer pattern & demosaicing](https://davidl-11.github.io/Computer-Vision-Basics/demos/bayer-demosaicing/)
- [Color space explorer](https://davidl-11.github.io/Computer-Vision-Basics/demos/color-spaces/)
- [Chroma subsampling](https://davidl-11.github.io/Computer-Vision-Basics/demos/chroma-subsampling/)
- [Gamma](https://davidl-11.github.io/Computer-Vision-Basics/demos/gamma/)

### 2. Image Filtering

- [Convolution & correlation](https://davidl-11.github.io/Computer-Vision-Basics/demos/convolution/)
- [Gaussian & separability](https://davidl-11.github.io/Computer-Vision-Basics/demos/separable-gaussian/)
- [Template matching](https://davidl-11.github.io/Computer-Vision-Basics/demos/template-matching/)
- [Median vs mean filter](https://davidl-11.github.io/Computer-Vision-Basics/demos/median-filter/)
- [Morphology & connected components](https://davidl-11.github.io/Computer-Vision-Basics/demos/morphology/)

### 3. Frequency Domain

- [Aliasing & Moiré](https://davidl-11.github.io/Computer-Vision-Basics/demos/aliasing/)
- [Fourier series](https://davidl-11.github.io/Computer-Vision-Basics/demos/fourier-series/)
- [2D Fourier transform](https://davidl-11.github.io/Computer-Vision-Basics/demos/fourier-transform/)
- [Magnitude vs phase](https://davidl-11.github.io/Computer-Vision-Basics/demos/magnitude-phase/)
- [Deconvolution](https://davidl-11.github.io/Computer-Vision-Basics/demos/deconvolution/)
- [JPEG & the DCT](https://davidl-11.github.io/Computer-Vision-Basics/demos/jpeg-dct/)

### 4. Edge Detection

- [Derivatives & noise](https://davidl-11.github.io/Computer-Vision-Basics/demos/edge-derivatives/)
- [Canny edge detector](https://davidl-11.github.io/Computer-Vision-Basics/demos/canny/)

### 5. Corner Detection

- [Autocorrelation surface](https://davidl-11.github.io/Computer-Vision-Basics/demos/autocorrelation/)
- [Harris corner detector](https://davidl-11.github.io/Computer-Vision-Basics/demos/harris/)
- [Harris invariance](https://davidl-11.github.io/Computer-Vision-Basics/demos/harris-invariance/)

### 6. Feature Matching

- [Scale space & DoG](https://davidl-11.github.io/Computer-Vision-Basics/demos/scale-space/)
- [SIFT descriptor](https://davidl-11.github.io/Computer-Vision-Basics/demos/sift-descriptor/)
- [Matching & ratio test](https://davidl-11.github.io/Computer-Vision-Basics/demos/feature-matching/)

### 7. Cameras and Optics

- [Homogeneous coordinates](https://davidl-11.github.io/Computer-Vision-Basics/demos/homogeneous-coordinates/)
- [Pinhole camera: intrinsics & extrinsics](https://davidl-11.github.io/Computer-Vision-Basics/demos/camera-model/)
- [Thin lens & depth of field](https://davidl-11.github.io/Computer-Vision-Basics/demos/depth-of-field/)
- [Vanishing points & horizon](https://davidl-11.github.io/Computer-Vision-Basics/demos/vanishing-points/)
- [Focal length, FOV & orthographic projection](https://davidl-11.github.io/Computer-Vision-Basics/demos/field-of-view/)

### 8. Transformations and Calibration

- [2D transformations](https://davidl-11.github.io/Computer-Vision-Basics/demos/transformations-2d/)

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
