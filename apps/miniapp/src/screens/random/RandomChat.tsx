import clsx from 'clsx';
import { Flag, Heart, SkipForward, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, errorMessage } from '@/api/client';
import { useMe, useMeta } from '@/api/queries';
import type { Me } from '@/api/types';
import type { RandomMessage, RandomSession } from '@/api/types';
import { clientId, clock, fa } from '@/lib/format';
import { nav } from '@/store/nav';
import { Composer } from '@/screens/chat/Composer';
import { useRandom, type Want } from '@/store/random';
import { toast } from '@/store/ui';
import { haptic } from '@/telegram/tg';
import { confirmDialog } from '@/ui/Dialog';
import { Button, GlowBackground, Img } from '@/ui/kit';
import { Sheet } from '@/ui/Sheet';

/** Random chat: a short anonymous-ish talk with someone online now; both like → real match. */
export default function RandomChat() {
  const { status, session, messages, join, leave, sync } = useRandom();
  const [starting, setStarting] = useState(false);
  const [outOfChats, setOutOfChats] = useState(false);

  // keep our place in the queue / resync after the app was in the background
  useEffect(() => {
    void sync().catch(() => undefined);
    const t = setInterval(() => {
      if (useRandom.getState().status === 'waiting') void sync().catch(() => undefined);
    }, 4000);
    return () => clearInterval(t);
  }, [sync]);

  // leaving the screen while searching gives the spot up
  useEffect(
    () => () => {
      if (useRandom.getState().status === 'waiting') void useRandom.getState().leave();
    },
    [],
  );

  const start = async () => {
    setStarting(true);
    haptic.medium();
    try {
      await join();
    } catch (e) {
      useRandom.setState({ status: 'idle' });
      if (e instanceof ApiError && e.code === 'random_limit') {
        haptic.warning();
        setOutOfChats(true);
        void sync().catch(() => undefined);
      } else toast(errorMessage(e), '⚠️', 'error');
    } finally {
      setStarting(false);
    }
  };

  const next = async () => {
    haptic.light();
    await leave();
    await start();
  };

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <AnimatePresence mode="wait">
        {status === 'idle' ? (
          <Fade key="idle">
            <Intro onStart={start} loading={starting} />
          </Fade>
        ) : status === 'waiting' ? (
          <Fade key="waiting">
            <Searching onCancel={() => void leave()} />
          </Fade>
        ) : session ? (
          <Fade key={'chat' + session.id}>
            <Conversation session={session} messages={messages} ended={status === 'ended'} onNext={next} onLeave={() => void leave()} />
          </Fade>
        ) : null}
      </AnimatePresence>
      <OutOfChats open={outOfChats} onClose={() => setOutOfChats(false)} />
    </div>
  );
}

/** A man without membership used his chats: add friends to the group, or go premium. */
function OutOfChats({ open, onClose }: { open: boolean; onClose: () => void }) {
  const meta = useMeta().data;
  const go = (to: () => void) => {
    onClose();
    to();
  };
  return (
    <Sheet open={open} onClose={onClose}>
      <div className="flex flex-col items-center pt-2 text-center">
        <div className="grid size-20 place-items-center rounded-full bg-surface-2 text-[40px]">🎲</div>
        <h2 className="mt-4 text-[20px] font-extrabold">چت‌های ناشناس رایگانت تموم شد</h2>
        <p className="mt-2 text-[14px] leading-7 text-muted">
          {meta?.referral.enabled ? 'دوستاتو به گروه Vibe اضافه کن و چت هدیه بگیر، یا با عضویت ویژه بیشتر چت کن.' : 'با عضویت ویژه بیشتر چت ناشناس کن.'}
        </p>
        {meta?.referral.enabled ? (
          <Button variant="royal" className="mt-6 w-full" onClick={() => go(() => nav.push({ name: 'invite' }))}>
            🎁 دوستاتو اضافه کن = چت رایگان
          </Button>
        ) : null}
        <Button variant="gold" className={clsx('w-full', meta?.referral.enabled ? 'mt-3' : 'mt-6')} onClick={() => go(() => nav.push({ name: 'premium', reason: 'random' }))}>
          💎 چت بیشتر با عضویت ویژه
        </Button>
      </div>
    </Sheet>
  );
}

const WANTS: { id: Want; label: string }[] = [
  { id: 'female', label: 'دختر' },
  { id: 'male', label: 'پسر' },
  { id: 'everyone', label: 'فرقی نداره' },
];

/** Who to talk to this time (any gender, even if the profile says otherwise). */
function WantPicker({ me }: { me: Me }) {
  const want = useRandom((s) => s.want) ?? ((me.interestedIn as Want | null) ?? 'everyone');
  const setWant = useRandom((s) => s.setWant);
  return (
    <div className="mt-5 w-full max-w-sm">
      <div className="mb-2 text-[13px] font-semibold text-muted">با کی می‌خوای حرف بزنی؟</div>
      <div className="grid grid-cols-3 gap-1.5 rounded-2xl border border-line bg-surface-1/80 p-1.5">
        {WANTS.map((w) => (
          <button
            key={w.id}
            onClick={() => {
              haptic.select();
              setWant(w.id);
            }}
            className={clsx(
              'rounded-xl py-2.5 text-[14px] font-bold transition-colors',
              want === w.id ? 'bg-royal text-white shadow-[0_8px_20px_-8px_rgba(139,92,246,0.9)]' : 'text-muted',
            )}
          >
            {w.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Fade({ children }: { children: React.ReactNode }) {
  return (
    <motion.div className="absolute inset-0 flex flex-col" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
      {children}
    </motion.div>
  );
}

function Rings({ emoji }: { emoji: string }) {
  return (
    <div className="relative grid size-56 place-items-center">
      <span className="absolute inset-0 rounded-full border border-rose/40 animate-ping-slow" />
      <span className="absolute inset-6 rounded-full border border-violet/50 animate-ping-slow [animation-delay:1.2s]" />
      <span className="absolute inset-2 rounded-full border border-white/10" />
      <span className="absolute inset-10 rounded-full border border-white/10" />
      <motion.div
        initial={{ scale: 0.6, rotate: -10 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 12 }}
        className="grid size-28 place-items-center rounded-panel bg-royal text-[54px] shadow-[0_20px_60px_-10px_rgba(139,92,246,0.8)]"
      >
        {emoji}
      </motion.div>
    </div>
  );
}

function Intro({ onStart, loading }: { onStart: () => void; loading: boolean }) {
  const meta = useMeta();
  const me = useMe().data;
  return (
    <>
      <GlowBackground />
      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
        <Rings emoji="🎲" />
        <h1 className="mt-6 text-[25px] font-extrabold">یه نفر جدید، همین الان</h1>
        <p className="mt-2 max-w-sm text-[14px] leading-7 text-muted">با یه آدم تصادفی که همین الان آنلاینه هم‌صحبت شو. اگه هر دو همدیگه رو لایک کنید، مچ می‌شید.</p>
        {me ? <WantPicker me={me} /> : null}
        <div className="mt-4 w-full max-w-sm space-y-2 text-right">
          {[
            ['👤', 'از همون اول پروفایل و عکس‌های همدیگه رو می‌بینید'],
            ['⏭️', 'هر وقت خواستی برو سراغ نفر بعدی'],
          ].map(([e, t]) => (
            <div key={t} className="flex items-center gap-3 rounded-2xl border border-line bg-surface-1/80 px-4 py-2.5 text-[13.5px]">
              <span className="text-[18px]">{e}</span>
              {t}
            </div>
          ))}
        </div>
      </div>
      <div className="relative px-5 pb-safe">
        <Button variant="royal" className="mb-4 w-full" loading={loading} disabled={meta.data?.randomChat === false} onClick={onStart}>
          شروع گفتگو
        </Button>
      </div>
    </>
  );
}

function Searching({ onCancel }: { onCancel: () => void }) {
  return (
    <>
      <GlowBackground />
      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
        <Rings emoji="🔎" />
        <h1 className="mt-6 text-[22px] font-bold">دنبال یه هم‌صحبت می‌گردیم…</h1>
        <p className="mt-2 text-[13.5px] text-muted">معمولاً چند ثانیه بیشتر طول نمی‌کشه</p>
      </div>
      <div className="relative px-5 pb-safe">
        <Button variant="soft" className="mb-4 w-full" onClick={onCancel}>
          انصراف
        </Button>
      </div>
    </>
  );
}

function Conversation({
  session,
  messages,
  ended,
  onNext,
  onLeave,
}: {
  session: RandomSession;
  messages: RandomMessage[];
  ended: boolean;
  onNext: () => void;
  onLeave: () => void;
}) {
  const me = useMe().data!;
  const meta = useMeta();
  const [report, setReport] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [likedClosed, setLikedClosed] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const p = session.peer;
  const openProfile = () => {
    if (!p.id) return;
    haptic.light();
    nav.push({ name: 'profile', userId: p.id, actions: 'none' });
  };
  // skipping a conversation that has started: one tap could lose it, so ask first
  const next = async () => {
    const talked = messages.some((m) => m.senderId === me.id) || messages.some((m) => m.senderId !== me.id);
    if (talked && !(await confirmDialog(`گفتگو با ${p.name} تموم بشه و بری سراغ نفر بعدی؟`, 'نفر بعدی'))) return;
    onNext();
  };
  // after a real chat (both wrote), a quick 👍 / 👎 about the other person
  const [rated, setRated] = useState<null | boolean>(null);
  const bothWrote = messages.some((m) => m.senderId === me.id) && messages.some((m) => m.senderId !== me.id);
  const rate = (up: boolean) => {
    haptic.select();
    setRated(up);
    void api.post('/v1/random/rate', { sessionId: session.id, up }).catch(() => undefined);
  };

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);

  const send = async (raw: string) => {
    const t = raw.trim();
    if (!t || ended) return;
    const cid = clientId();
    const optimistic: RandomMessage = { id: 'tmp' + cid, senderId: me.id, text: t, clientId: cid, createdAt: new Date().toISOString() };
    useRandom.setState((s) => ({ messages: [...s.messages, optimistic] }));
    try {
      const saved = await api.post<RandomMessage>('/v1/random/messages', { text: t, clientId: cid });
      useRandom.setState((s) => ({ messages: s.messages.map((m) => (m.clientId === cid ? saved : m)) }));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'random_ended') useRandom.setState({ status: 'ended' });
      else toast(errorMessage(e), '⚠️', 'error');
    }
  };

  const like = async () => {
    if (session.iLiked) return;
    haptic.medium();
    try {
      const s = await api.post<RandomSession>('/v1/random/like');
      useRandom.getState().onUpdate(s);
      if (s.matchId) haptic.success();
    } catch (e) {
      toast(errorMessage(e), '⚠️', 'error');
    }
  };

  const sendReport = async () => {
    if (!reason) return;
    await api.post('/v1/random/report', { reason }).catch(() => undefined);
    setReport(false);
    toast('گزارش ثبت شد و این کاربر مسدود شد', '🛡️', 'success');
    onLeave();
  };

  return (
    <>
      <header className="flex shrink-0 items-center gap-2 border-b border-line py-2.5 pr-3 pl-2 glass">
        <button
          onClick={() => openProfile()}
          aria-label={`پروفایل ${p.name}`}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl text-right active:opacity-70"
        >
          <span className="relative size-12 shrink-0 overflow-hidden rounded-full bg-surface-3">
            <Img src={p.photo} className="size-full" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[16px] font-bold">
              {p.name}
              {p.age ? `، ${fa(p.age)}` : ''}
            </span>
            <span className="block truncate text-[12px] text-muted">{p.city ? `${p.city} · ` : ''}دیدن پروفایل</span>
          </span>
        </button>
        <motion.button
          whileTap={{ scale: 0.85 }}
          aria-label={session.iLiked ? 'لایک کردی' : 'لایک'}
          onClick={like}
          className={clsx('grid size-10 shrink-0 place-items-center rounded-full', session.iLiked ? 'bg-rose/15' : 'bg-white/[0.06]')}
        >
          <Heart className={clsx('size-[22px] text-rose', session.iLiked && 'fill-rose')} />
        </motion.button>
        <button aria-label="گزارش" onClick={() => setReport(true)} className="grid size-10 shrink-0 place-items-center rounded-full bg-white/[0.06] text-muted">
          <Flag className="size-[18px]" />
        </button>
        {!ended ? (
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={next}
            className="flex h-10 shrink-0 items-center gap-1 rounded-full bg-royal pr-3.5 pl-2.5 text-[13.5px] font-bold text-white shadow-[0_8px_20px_-8px_rgba(139,92,246,0.9)]"
          >
            بعدی
            <SkipForward className="size-[18px] -scale-x-100" />
          </motion.button>
        ) : null}
      </header>

      <div ref={list} className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <div className="mb-4 flex flex-col items-center text-center">
          <span className="text-[34px]">🎲</span>
          <p className="mt-1 text-[13px] text-muted">
            به {p.name} وصل شدی{p.city ? ` — از ${p.city}` : ''}. سلام کن 👋
          </p>
        </div>
        {messages.map((m) => {
          const mine = m.senderId === me.id;
          return (
            <div key={m.clientId ?? m.id} className={clsx('mt-2 flex', mine ? 'justify-start' : 'justify-end')}>
              <div className={clsx('max-w-[78%] rounded-[20px] px-4 py-2.5', mine ? 'rounded-br-md bg-royal' : 'rounded-bl-md bg-surface-2')}>
                <p className="whitespace-pre-wrap break-words text-[15px] leading-7">{m.text}</p>
                <p className="mt-0.5 text-[10.5px] opacity-60 tabular">{clock(m.createdAt)}</p>
              </div>
            </div>
          );
        })}
      </div>

      <AnimatePresence>
        {session.matchId ? (
          <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="mx-3 mb-2 flex items-center gap-3 rounded-card border border-mint/40 bg-mint/10 p-3">
            <span className="text-[26px]">💘</span>
            <span className="flex-1 text-[13.5px] font-semibold">مچ شدید! گفتگو در «گفتگوها» ادامه داره.</span>
            <Button size="sm" onClick={() => nav.replace({ name: 'chat', matchId: session.matchId! })}>
              ادامه
            </Button>
          </motion.div>
        ) : session.peerLiked && !session.iLiked && !likedClosed ? (
          <motion.div
            key="liked"
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            className="mx-3 mb-2 flex items-center gap-2.5 rounded-card border border-rose/40 bg-rose/10 py-2.5 pr-3 pl-2"
          >
            <span className="flex-1 text-[13.5px]">{p.name} ازت خوشش اومده! لایکش کن تا مچ بشید.</span>
            <Button size="sm" onClick={like}>
              لایک ❤️
            </Button>
            <button aria-label="بستن" onClick={() => setLikedClosed(true)} className="grid size-8 shrink-0 place-items-center rounded-full text-muted active:bg-white/10">
              <X className="size-[18px]" />
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {ended ? (
        <div className="shrink-0 border-t border-line px-4 pt-3 pb-safe text-center glass">
          <p className="text-[13.5px] text-muted">{p.name} گفتگو را ترک کرد.</p>
          {bothWrote ? (
            rated === null ? (
              <div className="mt-2.5 flex items-center justify-center gap-2.5">
                <span className="text-[13px]">گفتگو با {p.name} چطور بود؟</span>
                <button onClick={() => rate(true)} aria-label="خوب بود" className="grid size-10 place-items-center rounded-full border border-line bg-white/[0.06] text-[18px] active:bg-white/10">
                  👍
                </button>
                <button onClick={() => rate(false)} aria-label="خوب نبود" className="grid size-10 place-items-center rounded-full border border-line bg-white/[0.06] text-[18px] active:bg-white/10">
                  👎
                </button>
              </div>
            ) : (
              <p className="mt-2 text-[12.5px] text-faint">ممنون از نظرت 🙏</p>
            )
          ) : null}
          <Button variant="royal" className="my-3 w-full" icon={<SkipForward className="size-5 -scale-x-100" />} onClick={onNext}>
            نفر بعدی
          </Button>
        </div>
      ) : (
        <Composer matchId={`rc:${session.id}`} max={1000} tone="royal" onSend={(t) => void send(t)} />
      )}

      <Sheet open={report} onClose={() => setReport(false)} title="گزارش هم‌صحبت">
        <div className="space-y-2">
          {meta.data?.reportReasons.map((r) => (
            <button
              key={r.id}
              onClick={() => setReason(r.id)}
              className={clsx('flex w-full rounded-2xl px-4 py-3.5 text-[14.5px]', reason === r.id ? 'border-2 border-danger bg-danger/10' : 'border border-line bg-surface-2')}
            >
              {r.label}
            </button>
          ))}
        </div>
        <Button
          variant="danger"
          className="mt-4 w-full"
          disabled={!reason}
          onClick={async () => {
            if (await confirmDialog('گزارش ثبت و این کاربر مسدود شود؟', 'ثبت گزارش', true)) await sendReport();
          }}
        >
          ثبت گزارش
        </Button>
      </Sheet>
    </>
  );
}
