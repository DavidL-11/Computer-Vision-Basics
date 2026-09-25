import type { FolderApi } from 'tweakpane';
import type { RGBImage } from './image';
import { type TestImage, imageOptions, openImageFile, testImage } from './testImages';

export interface ImagePickerOptions {
  names: TestImage[];
  value: TestImage;
  width: number;
  height: number;
  label?: string;
}

/** A list of test images plus "Open image…". Returns the initial image; later changes go to onChange. */
export function addImagePicker(parent: FolderApi, opts: ImagePickerOptions, onChange: (img: RGBImage) => void): RGBImage {
  const state = { image: opts.value as string };
  let previous = state.image;
  let file: RGBImage | null = null;
  const binding = parent.addBinding(state, 'image', {
    label: opts.label ?? 'image',
    options: { ...imageOptions(opts.names), 'Your image': 'file' },
  });

  const load = async () => {
    const img = await openImageFile(opts.width, opts.height);
    if (img) {
      file = img;
      state.image = previous = 'file';
      onChange(img);
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
        onChange(file);
      } else {
        void load();
      }
      return;
    }
    previous = value;
    onChange(testImage(value as TestImage, opts.width, opts.height));
  });
  parent.addButton({ title: 'Open image…' }).on('click', () => void load());
  return testImage(opts.value, opts.width, opts.height);
}
