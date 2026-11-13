/**
 * Shrinks a picked photo before upload (phones produce 4–12 MB images; mobile data is precious).
 * EXIF orientation is applied by createImageBitmap; the server re-encodes and strips metadata anyway.
 */
export async function prepareImage(file: File, maxSide = 1600, quality = 0.86): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('not_image');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file; // HEIC etc.: let the server try
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 1.5 * 1024 * 1024) {
    bitmap.close();
    return file;
  }
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), 'image/jpeg', quality));
}

/** Opens the system picker (gallery/camera inside Telegram) and resolves with the chosen file. */
export function pickImage(opts: { capture?: 'user' | 'environment' } = {}): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (opts.capture) input.setAttribute('capture', opts.capture);
    input.style.display = 'none';
    input.onchange = () => {
      resolve(input.files?.[0] ?? null);
      input.remove();
    };
    document.body.appendChild(input);
    input.click();
  });
}

export function photoForm(blob: Blob, field = 'photo', extra: Record<string, string> = {}): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  form.append(field, blob, 'photo.jpg');
  return form;
}
