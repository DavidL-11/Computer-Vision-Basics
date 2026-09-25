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
    demos: [],
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
    demos: [],
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
    demos: [],
  },
  {
    id: 'edges',
    number: 4,
    title: 'Edge Detection',
    summary:
      'Finding rapid changes in intensity: image gradients, why noise calls for smoothing, and the steps of the Canny edge detector.',
    concepts: ['Image gradients', 'Noise & smoothing', 'Derivative of Gaussian', 'Non-maximum suppression', 'Hysteresis', 'Canny'],
    demos: [],
  },
  {
    id: 'corners',
    number: 5,
    title: 'Corner Detection',
    summary:
      'Distinctive, repeatable interest points: local autocorrelation, the second moment matrix, the Harris detector and its invariance properties.',
    concepts: ['Interest points', 'Autocorrelation E(u,v)', 'Second moment matrix M', 'Harris response', 'Invariance & covariance'],
    demos: [],
  },
  {
    id: 'features',
    number: 6,
    title: 'Feature Matching',
    summary:
      'Detecting keypoints across scales, describing them with gradient histograms and matching them reliably between images.',
    concepts: ['Scale space', 'LoG / DoG', 'SIFT descriptor', 'Orientation assignment', 'Nearest neighbor matching', 'Ratio test'],
    demos: [],
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

export function demoUrl(slug: string): string {
  return `${import.meta.env.BASE_URL}demos/${slug}/`;
}
