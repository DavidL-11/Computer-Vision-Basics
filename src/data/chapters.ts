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
      {
        title: 'Thin lens & depth of field',
        description:
          'Change focal length, aperture and focus distance, follow the circle of confusion of near and far objects, and compare a smartphone with a portrait lens.',
        slug: 'depth-of-field',
      },
      {
        title: 'Vanishing points & horizon',
        description:
          'Turn a camera in a 3D scene and follow where parallel lines meet: v = K R d, the horizon as the vanishing line of the ground, and one-, two- and three-point perspective.',
        slug: 'vanishing-points',
      },
      {
        title: 'Focal length, FOV & orthographic projection',
        description:
          'Relate AFOV = 2·arctan(H / 2f) to the image, compare perspective, weak perspective and orthographic projection, and try the dolly zoom.',
        slug: 'field-of-view',
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
    demos: [
      {
        title: '2D transformations',
        description:
          'Compose translation, rotation, scaling, mirror, shear and perspective into one 3 × 3 matrix and see its degrees of freedom and which properties survive.',
        slug: 'transformations-2d',
      },
      {
        title: 'SVD visualized',
        description:
          'Watch A = UΣVᵀ rotate, scale and rotate the unit circle into an ellipse, solve Ax = b with the pseudo-inverse and rebuild an image from its first p singular values.',
        slug: 'svd',
      },
      {
        title: 'Line fitting: vertical vs total least squares',
        description:
          'Drag points and compare y = mx + b from the normal equations with the line from the smallest eigenvector of AᵀA: vertical lines, rotation and outliers.',
        slug: 'line-fitting',
      },
      {
        title: 'Homography & rectification',
        description:
          'Drag four corners of a planar object, solve Ah = 0 with the SVD for the homography H, and unwarp the photo into a front view.',
        slug: 'homography',
      },
      {
        title: 'DLT calibration',
        description:
          'Estimate the projection matrix M of a camera from a 3D target with Ax = b or Ax = 0, factor it with the RQ decomposition into K and R, and recover t and the camera center.',
        slug: 'dlt-calibration',
      },
    ],
  },
  {
    id: 'epipolar-geometry',
    number: 9,
    title: 'Epipolar Geometry',
    summary:
      'The geometry of two views: epipolar planes, lines and epipoles, the fundamental matrix that maps a point to its epipolar line, and estimating it from correspondences.',
    concepts: [
      'Epipolar plane & lines',
      'Epipoles & baseline',
      'Backprojection with P⁺',
      'Fundamental matrix F',
      'Epipolar constraint',
      '8-point algorithm',
      'Normalization',
      'Rank-2 constraint',
    ],
    demos: [
      {
        title: 'Two-view geometry & epipolar lines',
        description:
          'Click a point in one image and see its epipolar line in the other, slide the 3D point along its ray, and move the cameras to follow the epipoles and F = [e₁]× P₁ P₀⁺.',
        slug: 'epipolar-geometry',
      },
      {
        title: '8-point algorithm',
        description:
          'Estimate F from noisy correspondences with the SVD, and see why normalizing the coordinates and enforcing rank 2 matter.',
        slug: 'eight-point',
      },
    ],
  },
  {
    id: 'dense-motion',
    number: 10,
    title: 'Dense Motion Estimation',
    summary:
      'Estimating motion between frames: motion parallax and the focus of expansion, matching error metrics, Lucas–Kanade, coarse-to-fine search, parametric motion and per-pixel optical flow.',
    concepts: [
      'Optical flow vs motion flow',
      'Motion parallax',
      'Focus of expansion',
      'Aperture problem',
      'SSD / SAD / robust / NCC',
      'Lucas–Kanade',
      'Coarse-to-fine',
      'Parametric motion',
      'Regularized flow',
    ],
    demos: [
      {
        title: 'Matching cost surface',
        description:
          'Compare SSD, SAD, Lp, Geman–McClure, bias & gain and NCC over a search window, with masks and normalization at the border, occlusion and exposure changes.',
        slug: 'matching-cost',
      },
      {
        title: 'Lucas–Kanade step by step',
        description:
          'Linearize the image, solve AᵀA Δu = Aᵀb and step with size α: watch a translation converge to subpixel accuracy, and fail on edges and from far starts.',
        slug: 'lucas-kanade',
      },
      {
        title: 'Coarse-to-fine alignment',
        description:
          'Build an image pyramid, estimate a large motion on the smallest level, double it and refine it level by level, and see why a single scale gets stuck.',
        slug: 'coarse-to-fine',
      },
      {
        title: 'Parametric alignment',
        description:
          'Align whole images with a translation, Euclidean, affine or projective model: see the Jacobian as steepest-descent images and what a too simple model leaves behind.',
        slug: 'parametric-alignment',
      },
      {
        title: 'Patch-based vs regularized flow',
        description:
          'Compute a flow vector for every pixel with Lucas–Kanade per window or with a smoothness term α²‖∇u‖², and see where each fails: flat regions, edges, repetitive patterns and motion boundaries.',
        slug: 'optical-flow',
      },
      {
        title: 'Motion parallax & focus of expansion',
        description:
          'Move a camera through a scene: near points flow faster (f·T/Z), forward motion radiates from the focus of expansion, and rotation adds flow that carries no depth.',
        slug: 'motion-parallax',
      },
    ],
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
    demos: [
      {
        title: 'Disparity, depth & triangulation',
        description:
          'Intersect the rays of two parallel cameras: depth from disparity Z = f·T/d, a depth error that grows with Z², the baseline trade-off, noise and wrong matches.',
        slug: 'stereo-depth',
      },
      {
        title: 'Vergence & rectification',
        description:
          'Turn two cameras towards a fixation point, see positive and negative disparities and slanted epipolar lines, then warp both images so that matches share a scanline.',
        slug: 'rectification',
      },
      {
        title: 'Scanline matching cost',
        description:
          'Plot the SSD or NCC window cost of a pixel along the scanline: clear, flat and repeated minima, small vs large windows, and a hierarchical search on a pyramid.',
        slug: 'scanline-matching',
      },
      {
        title: 'Disparity map',
        description:
          'Compute a disparity map by window matching and by scanline stereo with dynamic programming: occlusions, streaking, and stereo as match quality plus smoothness.',
        slug: 'disparity-map',
      },
      {
        title: 'Random-dot stereogram',
        description: 'Two images of random dots without any visible shape: matching them reveals a square floating in front of the background.',
        slug: 'random-dot-stereogram',
      },
    ],
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
