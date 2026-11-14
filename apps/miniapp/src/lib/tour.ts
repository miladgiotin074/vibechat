import { cloudStorage } from '@tma.js/sdk-react';

/**
 * "Has this user seen the home-page tour?" — kept on this device (localStorage) and in Telegram
 * Cloud Storage, so the tour isn't repeated when the same account opens the app on another phone
 * or on desktop.
 */
const KEY = 'vibe_tour_home_v2';
let checked = false;

function localDone(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

async function cloudDone(): Promise<boolean> {
  try {
    if (!cloudStorage.getItem.isAvailable()) return false;
    const value = await Promise.race([
      cloudStorage.getItem(KEY) as Promise<string>,
      new Promise<string>((resolve) => setTimeout(() => resolve(''), 1500)),
    ]);
    return value === '1';
  } catch {
    return false;
  }
}

/** True once per app session at most, and only for users who never finished or skipped the tour. */
export async function shouldShowHomeTour(): Promise<boolean> {
  if (checked) return false;
  checked = true;
  if (localDone()) return false;
  if (await cloudDone()) {
    markHomeTourDone();
    return false;
  }
  return true;
}

/**
 * A brand-new account (still signing up) has not seen the tour, whatever this phone remembers: the
 * same Telegram account can start over after an admin reset it.
 */
export function forgetHomeTour() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // private mode
  }
  try {
    if (cloudStorage.deleteItem.isAvailable()) void (cloudStorage.deleteItem(KEY) as Promise<void>).catch(() => undefined);
  } catch {
    // older Telegram
  }
}

export function markHomeTourDone() {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    // private mode: Cloud Storage still remembers it
  }
  try {
    if (cloudStorage.setItem.isAvailable()) void (cloudStorage.setItem(KEY, '1') as Promise<void>).catch(() => undefined);
  } catch {
    // older Telegram
  }
}
