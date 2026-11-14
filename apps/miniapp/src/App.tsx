import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api, request, setRelogin, setSession } from '@/api/client';
import { fetchGate, keys, queryClient, setMe, useGate, useMe } from '@/api/queries';
import type { AuthResponse, Meta } from '@/api/types';
import { fontsReady, imagesReady, upTo } from '@/lib/preload';
import { startSocket } from '@/realtime/socket';
import { useDeck } from '@/screens/discover/deck';
import { Onboarding } from '@/screens/onboarding/Onboarding';
import { Welcome } from '@/screens/onboarding/Welcome';
import { JoinGate } from '@/screens/gate/JoinGate';
import { Shell } from '@/screens/Shell';
import { handleBack, nav, useNav } from '@/store/nav';
import { initTelegram, onAppResume, onBackButton, ready, setBackButton, type Launch } from '@/telegram/tg';
import { Button, GlowBackground } from '@/ui/kit';
import { Splash } from '@/ui/Splash';
import { DialogHost } from '@/ui/Dialog';
import { Toaster } from '@/ui/Toaster';

type Boot =
  | { stage: 'loading' }
  | { stage: 'error'; title: string; message: string; retry?: boolean; emoji?: string }
  | { stage: 'ready'; launch: Launch };

/** Deep links: t.me/<bot>/<app>?startapp=chat_<id> | u_<id> | pay_<id> | s_likes | s_invite | s_premium */
function openStartParam(p: string | null) {
  if (!p) return;
  const [kind, ...rest] = p.split('_');
  const value = rest.join('_');
  if (kind === 'chat' && value) return nav.push({ name: 'chat', matchId: value });
  if (kind === 'u' && value) return nav.push({ name: 'profile', userId: value, actions: 'swipe' });
  if (kind === 'pay' && value) return nav.push({ name: 'payment', paymentId: value });
  if (kind === 'w' && value) {
    nav.setTab('wall');
    return nav.push({ name: 'wallPost', postId: value });
  }
  if (kind === 's') {
    if (value === 'likes') return nav.push({ name: 'likes' });
    if (value === 'chats') return nav.setTab('chats');
    if (value === 'wall') return nav.setTab('wall');
    if (value === 'requests') {
      nav.setTab('wall');
      return nav.push({ name: 'wallInbox' });
    }
    if (value === 'invite') return nav.push({ name: 'invite' });
    if (value === 'premium') return nav.push({ name: 'premium' });
  }
}

export function App() {
  const [boot, setBoot] = useState<Boot>({ stage: 'loading' });
  const [welcomed, setWelcomed] = useState(false);
  const me = useMe();
  const started = useRef(false);

  const start = useCallback(async () => {
    setBoot({ stage: 'loading' });
    // the font downloads while Telegram and the login are busy
    const fonts = fontsReady();
    let launch: Launch;
    try {
      launch = await initTelegram();
    } catch {
      return setBoot({
        stage: 'error',
        emoji: '✈️',
        title: 'Vibe را از تلگرام باز کن',
        message: 'این اپ داخل تلگرام اجرا می‌شود. ربات Vibe Chat را در تلگرام باز کن و روی «ورود» بزن.',
      });
    }
    // Logging in = proving who we are with Telegram's signed init data; also used when the session runs out.
    const login = () =>
      request<AuthResponse>(
        'POST',
        '/v1/auth/telegram',
        { initData: launch.rawInitData, startParam: launch.startParam ?? undefined, platform: launch.platform, version: launch.version },
        { auth: false },
      );
    try {
      const auth = await login();
      setSession(auth);
      setRelogin(login);
      setMe(auth.user);
      void queryClient.prefetchQuery({ queryKey: keys.meta, queryFn: () => api.get<Meta>('/v1/meta') });
      // The spinner stays until the first screen can be shown whole: the font in every weight, and
      // the pictures it opens with (the welcome picture, or the first cards in Discover). Capped,
      // so a slow connection shows the app a little late rather than never.
      // members-only channels: known before the first screen, so the app never flashes behind the gate
      const gate =
        auth.user.status === 'active'
          ? queryClient.fetchQuery({ queryKey: keys.gate, queryFn: fetchGate, staleTime: 0 }).catch(() => undefined)
          : Promise.resolve();
      const pictures =
        auth.user.status === 'onboarding'
          ? imagesReady(['/img/welcome.webp'])
          : useDeck
              .getState()
              .load()
              .then(() => imagesReady(useDeck.getState().cards.slice(0, 2).map((c) => c.photos[0]?.md)));
      // our spinner, not Telegram's blank placeholder, is what shows while we wait
      ready();
      await upTo(8000, Promise.all([fonts, pictures, gate]));
      setBoot({ stage: 'ready', launch });
      if (auth.user.status === 'active') openStartParam(launch.startParam);
      startSocket();
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, 'network', 'اتصال برقرار نشد');
      if (err.code === 'account_banned') {
        return setBoot({ stage: 'error', emoji: '🚫', title: 'حساب مسدود است', message: err.message });
      }
      if (err.code === 'maintenance') {
        return setBoot({ stage: 'error', emoji: '🛠️', title: 'در حال بروزرسانی هستیم', message: err.message, retry: true });
      }
      if (err.code === 'telegram_auth_failed') {
        return setBoot({ stage: 'error', emoji: '🔐', title: 'ورود تأیید نشد', message: err.message, retry: true });
      }
      if (err.code === 'signup_closed') {
        return setBoot({ stage: 'error', emoji: '⏳', title: 'ثبت‌نام موقتاً بسته است', message: err.message, retry: true });
      }
      setBoot({
        stage: 'error',
        emoji: '📡',
        title: 'اتصال برقرار نشد',
        message: err.code === 'network' ? 'اینترنتت رو چک کن و دوباره امتحان کن.' : err.message,
        retry: true,
      });
    } finally {
      ready();
    }
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void start();
  }, [start]);

  // Telegram's Back button mirrors our navigation: visible whenever there is something to go back from.
  useEffect(() => {
    const off = onBackButton(() => handleBack());
    const sync = () => {
      const s = useNav.getState();
      setBackButton(s.stack.length > 0 || s.handlers.length > 0);
    };
    sync();
    const unsub = useNav.subscribe(sync);
    return () => {
      off();
      unsub();
    };
  }, [boot.stage]);

  const user = me.data;
  // after sign-up (and on every launch): the required channels come before the app itself
  const gateOn = boot.stage === 'ready' && user?.status === 'active';
  const gate = useGate(gateOn);
  // People can leave a required channel at any time: besides every launch, check again whenever the
  // app comes back from the background (Telegram keeps a minimized Mini App alive). A failed check
  // keeps the last answer instead of locking anyone out.
  useEffect(() => {
    if (!gateOn) return;
    return onAppResume(() => void queryClient.fetchQuery({ queryKey: keys.gate, queryFn: fetchGate, staleTime: 0 }).catch(() => undefined));
  }, [gateOn]);
  let content: React.ReactNode;
  if (boot.stage === 'loading' || (boot.stage === 'ready' && !user) || (user?.status === 'active' && gate.isPending && gate.fetchStatus !== 'idle')) {
    content = <Splash key="splash" />;
  } else if (boot.stage === 'error') {
    content = <BootError key="error" {...boot} onRetry={start} />;
  } else if (user!.status === 'onboarding') {
    content = welcomed ? (
      <Onboarding key="onboarding" launch={boot.launch} onBack={() => setWelcomed(false)} />
    ) : (
      <Welcome key="welcome" onStart={() => setWelcomed(true)} />
    );
  } else if (gate.data && !gate.data.ok) {
    content = <JoinGate key="gate" status={gate.data} />;
  } else {
    content = <Shell key="shell" />;
  }

  return (
    <>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={(content as { key?: string }).key ?? 'x'}
          className="absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          {content}
        </motion.div>
      </AnimatePresence>
      <Toaster />
      <DialogHost />
    </>
  );
}

function BootError({ title, message, retry, emoji, onRetry }: { title: string; message: string; retry?: boolean; emoji?: string; onRetry: () => void }) {
  return (
    <div className="relative flex h-full flex-col items-center justify-center bg-night px-8 text-center">
      <GlowBackground intensity={0.5} />
      <div className="relative">
        <div className="mx-auto grid size-24 place-items-center rounded-full bg-surface-2 text-[42px]">{emoji ?? '😕'}</div>
        <h1 className="mt-6 text-[20px] font-bold">{title}</h1>
        <p className="mt-3 text-[14px] leading-7 text-muted">{message}</p>
        {retry ? (
          <Button className="mt-8 w-full" onClick={onRetry}>
            تلاش دوباره
          </Button>
        ) : null}
      </div>
    </div>
  );
}
