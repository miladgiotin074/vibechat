import sharp, { type Sharp } from 'sharp';
import { badRequest } from './errors.js';

sharp.concurrency(2);

export interface ProcessedImage {
  width: number;
  height: number;
  color: string;
  variants: { name: string; body: Buffer }[];
  /** 32px blurred preview (locked "likes you" list, chat photos before tap-to-reveal). */
  blur: Buffer;
  /**
   * 0–100, a rough guess at how much of the picture is skin. It is NOT a nudity detector — it
   * only decides which new photos moderators look at first.
   */
  risk: number;
}

const MAX_INPUT_PIXELS = 40_000_000;

/**
 * Normalizes an upload: honours EXIF rotation, strips every bit of metadata (GPS included —
 * sharp drops it unless asked to keep it) and writes WebP variants:
 *   lg 1080w for full screen, md 600w for cards, sm 240w for lists, plus a 32w blurred preview.
 */
export async function processPhoto(input: Buffer): Promise<ProcessedImage> {
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch {
    throw badRequest('فایل تصویر قابل خواندن نیست');
  }
  if (!meta.format || !['jpeg', 'png', 'webp', 'heif', 'avif', 'gif'].includes(meta.format)) {
    throw badRequest('فقط عکس JPG، PNG یا WebP قابل قبول است');
  }
  const base = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).rotate();
  const { info } = await base.clone().resize({ width: 1080, withoutEnlargement: true }).toBuffer({ resolveWithObject: true });
  if (info.width < 200 || info.height < 200) throw badRequest('عکس خیلی کوچک است');

  const sizes: [string, number, number][] = [
    ['lg', 1080, 82],
    ['md', 600, 80],
    ['sm', 240, 75],
  ];
  const variants = await Promise.all(
    sizes.map(async ([name, width, quality]) => ({
      name,
      body: await base.clone().resize({ width, withoutEnlargement: true }).webp({ quality }).toBuffer(),
    })),
  );
  const blur = await base.clone().resize({ width: 32 }).blur(4).webp({ quality: 50 }).toBuffer();
  const stats = await base.clone().resize({ width: 64 }).stats();
  const { r, g, b } = stats.dominant;
  const color = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  return { width: info.width, height: info.height, color, variants, blur, risk: await skinShare(base) };
}

/** Share of pixels in a skin-tone range on a 48px copy (classic RGB rule), as 0–100. */
async function skinShare(image: Sharp): Promise<number> {
  try {
    const { data, info } = await image.clone().resize(48, 48, { fit: 'cover' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let skin = 0;
    const px = info.width * info.height;
    for (let i = 0; i < px * 3; i += 3) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      if (r > 95 && g > 40 && b > 20 && r > g && r > b && r - Math.min(g, b) > 15 && Math.abs(r - g) > 15) skin++;
    }
    return Math.round((skin / px) * 100);
  } catch {
    return 0;
  }
}
