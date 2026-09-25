// OpenCV.js is ~10 MB, so it is injected at runtime instead of bundled.

export type OpenCV = any;

const OPENCV_URL = 'https://docs.opencv.org/4.10.0/opencv.js';

let loading: Promise<OpenCV> | null = null;

export function loadOpenCV(url: string = OPENCV_URL): Promise<OpenCV> {
  if (loading) return loading;
  loading = new Promise<OpenCV>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onerror = () => {
      loading = null;
      reject(new Error(`Failed to load OpenCV.js from ${url}`));
    };
    script.onload = () => {
      const w = window as unknown as { cv: OpenCV };
      const cv = w.cv;
      // Depending on the build, `cv` is either a ready module, a promise, or
      // a module that signals readiness through onRuntimeInitialized.
      if (cv instanceof Promise) cv.then(resolve, reject);
      else if (cv?.Mat) resolve(cv);
      else cv.onRuntimeInitialized = () => resolve(cv);
    };
    document.head.appendChild(script);
  });
  return loading;
}
