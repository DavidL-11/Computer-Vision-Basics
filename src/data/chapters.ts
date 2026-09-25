export interface Demo {
  title: string;
  description: string;
  /** Folder name in demos/. */
  slug: string;
}

export interface Chapter {
  id: string;
  number: number;
  title: string;
  summary: string;
  concepts: string[];
  demos: Demo[];
}

export const chapters: Chapter[] = [
  {
    id: 'images-color',
    number: 1,
    title: 'Images, Color and Gamma',
    summary:
      'How a sensor turns light into a grid of numbers: sampling, color filter arrays, color spaces and the gamma encoding hidden in pixel values.',
    concepts: [
      'Images as sampled signals',
      'Cones & rods',
      'Bayer pattern & demosaicing',
      'RGB / HSV / YCbCr / L*a*b*',
      'Chroma subsampling',
      'Gamma / sRGB',
      'Linear vs encoded values',
    ],
    demos: [
      {
        title: 'Sampling & quantization',
        description:
          'Reduce the resolution and bit depth of an image and watch blocks and banding appear, with the intensity profile of a row and the storage it needs.',
        slug: 'sampling-quantization',
      },
      {
        title: 'Bayer pattern & demosaicing',
        description:
          'See the raw RGGB mosaic of a color sensor, why green is sampled twice, and compare nearest-neighbor and bilinear demosaicing and their artifacts.',
        slug: 'bayer-demosaicing',
      },
      {
        title: 'Color space explorer',
        description:
          'Split an image into RGB, HSV, YCbCr and L*a*b* channels, inspect picked colors in every space and interpolate between two colors in each.',
        slug: 'color-spaces',
      },
      {
        title: 'Chroma subsampling',
        description:
          'Store Cb and Cr at lower resolution with 4:2:2, 4:2:0 and coarser schemes, and see why this is almost invisible while reducing Y is not.',
        slug: 'chroma-subsampling',
      },
      {
        title: 'Gamma',
        description:
          'The sRGB curve, what medium gray really is, blurring encoded values versus linear light, and gamma adjustment per channel versus on luma.',
        slug: 'gamma',
      },
    ],
  },
  {
    id: 'filtering',
    number: 2,
    title: 'Image Filtering',
    summary:
      'Computing a function of each local neighborhood: linear filters such as Gaussian, box and Sobel, and non-linear ones such as the median filter and morphology.',
    concepts: [
      'Correlation vs convolution',
      'Gaussian & separability',
      'Box filter',
      'Boundary handling',
      'Sobel',
      'Template matching',
      'Median filter',
      'Morphology',
      'Connected components',
    ],
    demos: [
      {
        title: 'Convolution & correlation',
        description:
          'Slide a kernel over an image: box, Gaussian, sharpen, Sobel or your own weights, correlation vs convolution with an asymmetric kernel, and four ways to handle the border.',
        slug: 'convolution',
      },
      {
        title: 'Gaussian & separability',
        description:
          'Split a 2D Gaussian into two 1D passes, count the multiplications MNPQ vs MN(P+Q), and watch repeated box filtering converge to a Gaussian.',
        slug: 'separable-gaussian',
      },
      {
        title: 'Template matching',
        description:
          'Select a template and compare correlation, zero-mean correlation, SSD and normalized cross-correlation score maps and their best matches.',
        slug: 'template-matching',
      },
      {
        title: 'Median vs mean filter',
        description:
          'Add salt-and-pepper or Gaussian noise and compare how the mean and the median remove it, how they treat edges, and their PSNR.',
        slug: 'median-filter',
      },
      {
        title: 'Morphology & connected components',
        description:
          'Paint a binary image, apply erosion, dilation, opening and closing with a structuring element, and label the connected components.',
        slug: 'morphology',
      },
    ],
  },
  {
    id: 'frequency',
    number: 3,
    title: 'Frequency Domain',
    summary:
      'Images as sums of sinusoids: sampling and aliasing, the Fourier transform, filtering by multiplication, deconvolution and JPEG compression.',
    concepts: [
      'Sampling & aliasing',
      'Nyquist',
      'Anti-aliasing',
      '2D Fourier transform',
      'Magnitude & phase',
      'Convolution theorem',
      'Deconvolution',
      'JPEG / DCT',
    ],
    demos: [
      {
        title: 'Aliasing & Moiré',
        description:
          'Sample a sinusoid below the Nyquist rate and find its alias frequency, then subsample an image with and without a Gaussian pre-filter and watch moiré appear.',
        slug: 'aliasing',
      },
      {
        title: 'Fourier series',
        description:
          'Add sine terms one by one to approximate a square, sawtooth or triangle wave, and see how the coefficients decay and why jumps overshoot.',
        slug: 'fourier-series',
      },
      {
        title: '2D Fourier transform',
        description:
          'An image and its magnitude and phase spectrum: click a frequency to see its basis image, apply low-, high- and band-pass filters, paint out stripe noise and check the convolution theorem.',
        slug: 'fourier-transform',
      },
      {
        title: 'Magnitude vs phase',
        description:
          'Combine the Fourier magnitude of one image with the phase of another and see that the phase carries the structure, while magnitude spectra all look alike.',
        slug: 'magnitude-phase',
      },
      {
        title: 'Deconvolution',
        description:
          'Undo a known blur by dividing in the frequency domain, watch a tiny amount of noise explode, and tame it with a truncated inverse or a Wiener filter.',
        slug: 'deconvolution',
      },
      {
        title: 'JPEG & the DCT',
        description:
          'Inspect the DCT coefficients of 8×8 blocks, quantize them with a quality slider, and watch zeros appear and block artifacts and ringing grow.',
        slug: 'jpeg-dct',
      },
    ],
  },
  {
    id: 'edges',
    number: 4,
    title: 'Edge Detection',
    summary:
      'Finding rapid changes in intensity: image gradients, why noise calls for smoothing, and the steps of the Canny edge detector.',
    concepts: ['Image gradients', 'Noise & smoothing', 'Derivative of Gaussian', 'Non-maximum suppression', 'Hysteresis', 'Canny'],
    demos: [
      {
        title: 'Derivatives & noise',
        description:
          'Plot a row of an image with its first and second derivative, add noise until the edges drown, then smooth first and see that this equals filtering with a derivative of Gaussian.',
        slug: 'edge-derivatives',
      },
      {
        title: 'Canny edge detector',
        description:
          'Follow a pixel through derivatives of Gaussian, gradient magnitude and orientation, non-maximum suppression and hysteresis thresholding, with adjustable σ and thresholds.',
        slug: 'canny',
      },
    ],
  },
  {
    id: 'corners',
    number: 5,
    title: 'Corner Detection',
    summary:
      'Distinctive, repeatable interest points: local autocorrelation, the second moment matrix, the Harris detector and its invariance properties.',
    concepts: ['Interest points', 'Autocorrelation E(u,v)', 'Second moment matrix M', 'Harris response', 'Invariance & covariance'],
    demos: [
      {
        title: 'Autocorrelation surface',
        description:
          'Shift a window over flat regions, edges and corners, and compare the change E(u,v) with its quadratic approximation by the second moment matrix M, its ellipse and its eigenvalues.',
        slug: 'autocorrelation',
      },
      {
        title: 'Harris corner detector',
        description:
          'Follow a pixel through derivatives, the windowed second moment matrix, the cornerness det(M) − α trace(M)², thresholding and non-maximum suppression, and see all pixels in the λ₁/λ₂ plane.',
        slug: 'harris',
      },
      {
        title: 'Harris invariance',
        description:
          'Change brightness and contrast, shift, rotate and scale an image, detect corners again and measure how many come back: covariant with rotation, not with scale.',
        slug: 'harris-invariance',
      },
    ],
  },
  {
    id: 'features',
    number: 6,
    title: 'Feature Matching',
    summary:
      'Detecting keypoints across scales, describing them with gradient histograms and matching them reliably between images.',
    concepts: [
      'Scale space',
      'LoG / DoG',
      'Keypoint refinement',
      'SIFT descriptor',
      'Orientation assignment',
      'Nearest neighbor matching',
      'Ratio test',
    ],
    demos: [
      {
        title: 'Scale space & DoG',
        description:
          'Blur an image at growing σ in octaves, subtract neighboring scales, find the extrema in position and scale, and refine and filter them into keypoints whose size follows the image.',
        slug: 'scale-space',
      },
      {
        title: 'SIFT descriptor',
        description:
          'Follow a keypoint through gradients, the orientation histogram, 4 × 4 histograms of 8 orientations, normalization and clamping, and test the 128 values under rotation, scaling and lighting changes.',
        slug: 'sift-descriptor',
      },
      {
        title: 'Matching & ratio test',
        description:
          'Match features between an image and a transformed copy with known ground truth, and compare a distance threshold with the nearest neighbor distance ratio.',
        slug: 'feature-matching',
      },
    ],
  },
  {
    id: 'cameras-optics-perspective',
    number: 7,
    title: 'Cameras and Optics',
    summary:
      'From the pinhole model to real lenses: perspective projection, homogeneous coordinates, intrinsic and extrinsic parameters, field of view and distortion.',
    concepts: [
      'Pinhole model',
      'Aperture & lenses',
      'Homogeneous coordinates',
      'Vanishing points & lines',
      'Intrinsics K',
      'Extrinsics [R | t]',
      'Field of view',
      'Orthographic projection',
      'Radial distortion',
      'Depth of field',
    ],
    demos: [
      {
        title: 'Homogeneous coordinates',
        description:
          'Points become rays and lines become planes through the origin. Build lines and intersections with cross products and watch parallel lines meet at a point at infinity.',
        slug: 'homogeneous-coordinates',
      },
      {
        title: 'Pinhole camera: intrinsics & extrinsics',
        description:
          'Move a virtual camera through a 3D scene, change focal length, principal point and skew, and watch K, [R | t] and P = K[R | t] update together with the image.',
        slug: 'camera-model',
      },
    ],
  },
  {
    id: 'calibration',
    number: 8,
    title: 'Transformations and Calibration',
    summary:
      'Parametric 2D transformations, least-squares fitting with the SVD, and estimating a camera’s projection matrix from known 3D–2D correspondences.',
    concepts: [
      '2D transformations',
      'Affine & projective',
      'Homography',
      'SVD',
      'Least squares & total least squares',
      'DLT',
      'Factorizing M into K[R | t]',
    ],
    demos: [],
  },
  {
    id: 'epipolar-geometry',
    number: 9,
    title: 'Epipolar Geometry',
    summary:
      'The geometry of two views: epipoles, epipolar lines and the essential and fundamental matrices.',
    concepts: ['Epipolar constraint', 'Essential matrix E', 'Fundamental matrix F', '8-point algorithm'],
    demos: [],
  },
  {
    id: 'dense-motion',
    number: 10,
    title: 'Dense Motion Estimation',
    summary:
      'Estimating motion between frames: matching error metrics, Lucas–Kanade, coarse-to-fine search, parametric motion and per-pixel optical flow.',
    concepts: [
      'Optical flow vs motion flow',
      'Aperture problem',
      'SSD / SAD / robust / NCC',
      'Lucas–Kanade',
      'Coarse-to-fine',
      'Parametric motion',
      'Regularized flow',
    ],
    demos: [],
  },
  {
    id: 'stereo',
    number: 11,
    title: 'Stereo Vision',
    summary:
      'Depth from two views: disparity and triangulation, rectification, window-based correspondence and stereo as energy minimization.',
    concepts: [
      'Disparity',
      'Z = f·T / d',
      'Baseline trade-off',
      'Rectification',
      'Window matching',
      'Scanline stereo',
      'Energy minimization',
    ],
    demos: [],
  },
  {
    id: 'structured-light',
    number: 12,
    title: 'Structured Light',
    summary:
      'Active 3D sensing: projecting known light patterns to make correspondence easy, and measuring depth directly with time of flight.',
    concepts: ['Active vs passive', 'Light-plane triangulation', 'Binary & Gray codes', 'Speckle patterns', 'Time of flight'],
    demos: [],
  },
  {
    id: 'surface-reconstruction',
    number: 13,
    title: 'Surface Reconstruction',
    summary:
      'From point clouds to surfaces: aligning scans with ICP, estimating normals, implicit functions and extracting meshes with marching cubes.',
    concepts: [
      'Procrustes alignment',
      'ICP',
      'Normal estimation',
      'Implicit surfaces',
      'Marching squares / cubes',
      "Hoppe's method",
      'TSDF fusion',
    ],
    demos: [],
  },
];

export function chapterById(id: string): Chapter | undefined {
  return chapters.find((c) => c.id === id);
}
