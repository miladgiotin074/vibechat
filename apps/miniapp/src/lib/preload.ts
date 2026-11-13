/**
 * What the first screen needs before the loading spinner may go away: the app's font in every
 * weight it uses, and the pictures that screen opens with. Nothing here ever fails — a font or
 * an image that can't be had is simply skipped — and `upTo` caps the wait, so a slow network
 * shows the app late rather than never.
 */

const WEIGHTS = [400, 500, 600, 700];

/** Vazirmatn in all its weights, downloaded and ready to draw with. */
export async function fontsReady(): Promise<void> {
  if (!('fonts' in document)) return;
  // asking for each weight starts its download now, even before any text uses it
  await Promise.all(WEIGHTS.map((w) => document.fonts.load(`${w} 16px Vazirmatn`, 'سلام Vibe').catch(() => [])));
  await document.fonts.ready;
}

/** Downloads (and decodes) these pictures, so they appear at once instead of fading in late. */
export async function imagesReady(urls: (string | null | undefined)[]): Promise<void> {
  const unique = [...new Set(urls.filter((u): u is string => !!u))];
  await Promise.all(
    unique.map(
      (src) =>
        new Promise<void>((done) => {
          const img = new Image();
          img.decoding = 'async';
          // decoding first makes it appear without a flash, but some WebViews never settle decode()
          // (a page in the background, for one): give it a moment, then go on regardless
          img.onload = () => void Promise.race([img.decode().catch(() => undefined), new Promise((r) => setTimeout(r, 400))]).finally(done);
          img.onerror = () => done();
          img.src = src;
        }),
    ),
  );
}

/** Waits for `work`, but never longer than `ms`. */
export function upTo(ms: number, work: Promise<unknown>): Promise<void> {
  return Promise.race([work.then(() => undefined, () => undefined), new Promise<void>((r) => setTimeout(r, ms))]);
}
