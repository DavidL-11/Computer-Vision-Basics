import type { Container } from './controls';
import type { RGBImage } from './image';
import { type TestImage, imageOptions, openImageFile, testImage } from './testImages';

export interface ImagePickerOptions {
  names: TestImage[];
  value: TestImage;
  width: number;
  height: number;
  label?: string;
}

/**
 * A list of test images plus a button that opens the user's own image. Returns the initial image; later changes go to onChange, together with the
 * chosen test image or 'file' for the user's image.
 */
export function addImagePicker(
  parent: Container,
  opts: ImagePickerOptions,
  onChange: (img: RGBImage, source: TestImage | 'file') => void,
): RGBImage {
  const state = { image: opts.value as string };
  let previous = state.image;
  let file: RGBImage | null = null;
  const binding = parent.addBinding(state, 'image', {
    label: opts.label ?? 'image',
    options: { ...imageOptions(opts.names), 'Your image': 'file' },
    view: 'select',
    action: { title: 'Open your own image', onClick: () => void load() },
  });

  const load = async () => {
    const img = await openImageFile(opts.width, opts.height);
    if (img) {
      file = img;
      state.image = previous = 'file';
      onChange(img, 'file');
    } else {
      state.image = previous;
    }
    binding.refresh();
  };

  binding.on('change', ({ value }) => {
    if (value === previous) return;
    if (value === 'file') {
      if (file) {
        previous = value;
        onChange(file, 'file');
      } else {
        void load();
      }
      return;
    }
    previous = value;
    onChange(testImage(value as TestImage, opts.width, opts.height), value as TestImage);
  });
  return testImage(opts.value, opts.width, opts.height);
}
