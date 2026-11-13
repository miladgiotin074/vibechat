import {
  backButton,
  closingBehavior,
  copyTextToClipboard,
  hapticFeedback,
  init,
  isTMA,
  miniApp,
  mockTelegramEnv,
  on,
  openLink as tgOpenLink,
  openTelegramLink as tgOpenTelegramLink,
  postEvent,
  requestWriteAccess,
  retrieveLaunchParams,
  retrieveRawInitData,
  shareStory as tgShareStory,
  shareURL as tgShareURL,
  swipeBehavior,
  switchInlineQuery as tgSwitchInlineQuery,
  viewport,
} from '@tma.js/sdk-react';

/** Brand colours for Telegram's own chrome: the action bar on top always matches our background. */
export const NIGHT = '#0e0a12';

export interface TelegramUserLite {
  id: number;
  firstName: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
  languageCode?: string;
}

export interface Launch {
  rawInitData: string;
  startParam: string | null;
  platform: string;
  version: string;
  user: TelegramUserLite | null;
  /** false = a normal browser with the development mock. */
  inTelegram: boolean;
}

let launch: Launch | null = null;
export const getLaunch = () => launch;

/**
 * Development outside Telegram: fakes the launch parameters so the SDK and our API (DEV_FAKE_TELEGRAM)
 * both work in a normal browser. `?u=2` picks another test user, so two tabs can chat with each other.
 */
function mockForBrowser() {
  const q = new URLSearchParams(location.search);
  const n = Number(q.get('u') ?? 1) || 1;
  const names = ['میلاد', 'سارا', 'امیر', 'نگار', 'کیان'];
  const user = {
    id: 100_000 + n,
    first_name: names[(n - 1) % names.length],
    username: `tester${n}`,
    language_code: 'fa',
    allows_write_to_pm: true,
  };
  const initData = new URLSearchParams({
    user: JSON.stringify(user),
    auth_date: String(Math.floor(Date.now() / 1000)),
    // the SDK insists on both fields; the API accepts hash=dev only with DEV_FAKE_TELEGRAM
    signature: 'dev',
    hash: 'dev',
  });
  const start = q.get('startapp');
  if (start) initData.set('start_param', start);
  mockTelegramEnv({
    launchParams: {
      tgWebAppPlatform: 'tdesktop',
      tgWebAppVersion: '8.0',
      tgWebAppThemeParams: { bg_color: NIGHT, text_color: '#f6eef9', button_color: '#ff2d6f', button_text_color: '#ffffff' },
      tgWebAppData: initData,
      ...(start ? { tgWebAppStartParam: start } : {}),
    },
  });
}

function safe(fn: () => void) {
  try {
    fn();
  } catch {
    // feature missing on this Telegram version
  }
}

/**
 * A real Telegram client either injects its bridge (mobile apps) or opens us with launch params in
 * the URL (desktop/web). The SDK also caches launch params in sessionStorage, which survives a reload
 * of a plain browser tab, so that alone does not prove we are inside Telegram.
 */
/**
 * Keeps the app's height and safe areas true after Telegram hides it and shows it again
 * (minimizing the Mini App, switching to another app, rotating the phone).
 *
 * The app's height comes from the WebView itself — the one size that is always right — instead of
 * the height Telegram reports, which some clients leave stale after a minimize (that left the tab
 * bar and the bottom buttons out of place until a reload). On every return, Telegram is also asked
 * again for the viewport and the safe areas, since not every client sends them by itself.
 */
function keepLayoutInSync() {
  const root = document.documentElement;
  // set at once (a hidden page never runs animation frames), and only when it really changed
  const measure = () => {
    const h = `${Math.round(window.innerHeight)}px`;
    if (window.innerHeight > 0 && root.style.getPropertyValue('--app-height') !== h) root.style.setProperty('--app-height', h);
  };
  // the WebView settles its final size a moment after it is shown again
  let timers: ReturnType<typeof setTimeout>[] = [];
  const refresh = () => {
    timers.forEach(clearTimeout);
    measure();
    safe(() => postEvent('web_app_request_viewport'));
    safe(() => postEvent('web_app_request_safe_area'));
    safe(() => postEvent('web_app_request_content_safe_area'));
    safe(() => viewport.expand.isAvailable() && viewport.expand());
    timers = [120, 350, 800].map((ms) => setTimeout(measure, ms));
  };

  measure();
  window.addEventListener('resize', measure);
  window.visualViewport?.addEventListener('resize', measure);
  window.addEventListener('orientationchange', refresh);
  window.addEventListener('pageshow', refresh);
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refresh());
  safe(() => on('visibility_changed', (e) => e.is_visible && refresh()));
  safe(() => on('viewport_changed', (e) => e.is_state_stable && measure()));
}

/**
 * The app is back in front (restored from minimized, or the user returned from another chat).
 * Telegram clients differ in which signal they send, so all three are heard; callers get one call
 * per return at most every couple of seconds.
 */
export function onAppResume(fn: () => void): () => void {
  let last = 0;
  const fire = () => {
    if (Date.now() - last < 2_000) return;
    last = Date.now();
    fn();
  };
  const onVisible = () => document.visibilityState === 'visible' && fire();
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', fire);
  let offTg: (() => void) | undefined;
  safe(() => {
    offTg = on('visibility_changed', (e) => e.is_visible && fire());
  });
  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', fire);
    offTg?.();
  };
}

const realTelegramBridge = () =>
  'TelegramWebviewProxy' in window || /tgWebAppData=/.test(location.hash) || /tgWebAppData=/.test(location.search);

export async function initTelegram(): Promise<Launch> {
  let inTelegram: boolean;
  if (import.meta.env.VITE_DEV_MOCK === 'true' && !realTelegramBridge()) {
    mockForBrowser();
    inTelegram = false;
  } else {
    try {
      inTelegram = isTMA();
    } catch {
      inTelegram = false;
    }
    if (!inTelegram) throw new Error('not_in_telegram');
  }
  init();
  keepLayoutInSync();

  safe(() => {
    miniApp.mount();
    if (miniApp.setHeaderColor.isAvailable()) miniApp.setHeaderColor(NIGHT);
    if (miniApp.setBgColor.isAvailable()) miniApp.setBgColor(NIGHT);
    if (miniApp.setBottomBarColor.isAvailable()) miniApp.setBottomBarColor(NIGHT);
  });
  safe(() => backButton.mount());
  safe(() => {
    // Swiping cards and scrolling chats must never close the app by accident.
    swipeBehavior.mount();
    if (swipeBehavior.disableVertical.isAvailable()) swipeBehavior.disableVertical();
  });
  safe(() => {
    // Closing the Mini App (the ✕ in Telegram's header) always asks first, so nobody leaves by accident.
    closingBehavior.mount();
    if (closingBehavior.enableConfirmation.isAvailable()) closingBehavior.enableConfirmation();
  });
  // Viewport sizes come asynchronously from Telegram; never hold the first paint for them.
  void Promise.resolve()
    .then(() => viewport.mount({ timeout: 4000 }))
    .then(() => {
      viewport.bindCssVars();
      if (viewport.expand.isAvailable()) viewport.expand();
    })
    .catch(() => {
      // older clients / browser mock: CSS falls back to 100dvh
    });

  const lp = retrieveLaunchParams() as unknown as {
    tgWebAppPlatform?: string;
    tgWebAppVersion?: string;
    tgWebAppStartParam?: string;
    tgWebAppData?: { user?: { id: number; first_name?: string; firstName?: string; last_name?: string; lastName?: string; username?: string; photo_url?: string; photoUrl?: string; language_code?: string; languageCode?: string } };
  };
  const u = lp.tgWebAppData?.user;
  const fromUrl = new URLSearchParams(location.search).get('startapp');
  launch = {
    rawInitData: retrieveRawInitData() ?? '',
    startParam: lp.tgWebAppStartParam ?? fromUrl ?? null,
    platform: lp.tgWebAppPlatform ?? 'unknown',
    version: lp.tgWebAppVersion ?? '0',
    user: u
      ? {
          id: u.id,
          firstName: u.firstName ?? u.first_name ?? '',
          lastName: u.lastName ?? u.last_name,
          username: u.username,
          photoUrl: u.photoUrl ?? u.photo_url,
          languageCode: u.languageCode ?? u.language_code,
        }
      : null,
    inTelegram,
  };
  return launch;
}

export function ready() {
  safe(() => miniApp.ready());
}

// ---- haptics -------------------------------------------------------------------------------

export const haptic = {
  light: () => safe(() => hapticFeedback.impactOccurred.isAvailable() && hapticFeedback.impactOccurred('light')),
  medium: () => safe(() => hapticFeedback.impactOccurred.isAvailable() && hapticFeedback.impactOccurred('medium')),
  heavy: () => safe(() => hapticFeedback.impactOccurred.isAvailable() && hapticFeedback.impactOccurred('heavy')),
  select: () => safe(() => hapticFeedback.selectionChanged.isAvailable() && hapticFeedback.selectionChanged()),
  success: () => safe(() => hapticFeedback.notificationOccurred.isAvailable() && hapticFeedback.notificationOccurred('success')),
  error: () => safe(() => hapticFeedback.notificationOccurred.isAvailable() && hapticFeedback.notificationOccurred('error')),
  warning: () => safe(() => hapticFeedback.notificationOccurred.isAvailable() && hapticFeedback.notificationOccurred('warning')),
};

// ---- back button ---------------------------------------------------------------------------

export function setBackButton(visible: boolean) {
  safe(() => {
    if (visible) backButton.show.isAvailable() && backButton.show();
    else backButton.hide.isAvailable() && backButton.hide();
  });
}

export function onBackButton(fn: () => void): () => void {
  try {
    if (backButton.onClick.isAvailable()) return backButton.onClick(fn);
  } catch {
    // ignore
  }
  return () => {};
}

// ---- links & sharing -----------------------------------------------------------------------

/** External site (payment gateway, terms) in the system browser; the Mini App stays open. */
export function openExternal(url: string) {
  try {
    if (tgOpenLink.isAvailable()) return void tgOpenLink(url, { tryBrowser: 'chrome' });
  } catch {
    // fall through
  }
  window.open(url, '_blank', 'noopener');
}

/** A t.me link (a user's profile, support, channel). */
export function openTelegram(url: string) {
  try {
    if (tgOpenTelegramLink.isAvailable()) return void tgOpenTelegramLink(url);
  } catch {
    // fall through
  }
  window.open(url, '_blank', 'noopener');
}

/** Telegram's native "share to chat" sheet. */
export function shareLink(url: string, text?: string) {
  try {
    if (tgShareURL.isAvailable()) return void tgShareURL(url, text);
  } catch {
    // fall through
  }
  window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text ?? '')}`, '_blank');
}

export const canShareStory = () => {
  try {
    return tgShareStory.isAvailable();
  } catch {
    return false;
  }
};

export function shareToStory(mediaUrl: string, text: string, link: string) {
  safe(() => {
    if (tgShareStory.isAvailable()) tgShareStory(mediaUrl, { text, widgetLink: { url: link, name: 'Vibe Chat 💜' } });
  });
}

export const canInlineShare = () => {
  try {
    return tgSwitchInlineQuery.isAvailable();
  } catch {
    return false;
  }
};

/** Opens the chat picker with "@bot " typed in: the user picks a chat and sends our invite card. */
export function inlineShare() {
  safe(() => {
    if (tgSwitchInlineQuery.isAvailable()) tgSwitchInlineQuery('', ['users', 'groups', 'channels']);
  });
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await copyTextToClipboard(text);
    return true;
  } catch {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
}

/** Lets the bot message the user (notifications) when they opened the app without starting the bot. */
export async function askWriteAccess(): Promise<boolean> {
  try {
    if (!requestWriteAccess.isAvailable()) return false;
    const status = await requestWriteAccess();
    return String(status) === 'allowed';
  } catch {
    return false;
  }
}


