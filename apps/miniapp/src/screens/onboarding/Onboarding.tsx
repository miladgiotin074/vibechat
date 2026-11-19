import clsx from 'clsx';
import { Check } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { api, ApiError, errorMessage } from '@/api/client';
import { keys, queryClient, setMe, useMe, useMeta } from '@/api/queries';
import type { Gender, InterestedIn, Me } from '@/api/types';
import { fa } from '@/lib/format';
import { useBackHandler } from '@/store/nav';
import { toast } from '@/store/ui';
import { askWriteAccess, haptic, type Launch } from '@/telegram/tg';
import { AgeWheel } from '@/ui/AgeWheel';
import { Button, Chip, ChoiceCard, GlowBackground, Img, NameArt } from '@/ui/kit';

/** What the sign-up starts from, so nobody has to choose anything to get going. */
const DEFAULT_GENDER: Gender = 'male';
const DEFAULT_INTERESTED: InterestedIn = 'female';
const DEFAULT_AGE = 25;

/**
 * The whole sign-up: one screen. The name and the picture come from Telegram without asking, and
 * a profile with no picture is fine — the app draws the person's name instead. So the only
 * questions are gender, who to meet and age, and all three start on a sensible answer.
 *
 * The one thing that can still be missing is a name with letters in it (a Telegram name of pure
 * emoji leaves us nothing to show): then, and only then, a second screen asks for a name.
 */
export function Onboarding({ launch, onBack }: { launch: Launch; onBack: () => void }) {
  const me = useMe().data!;
  /** 'about' → the three questions; 'name' → Telegram's name had no letters in it. */
  const [step, setStep] = useState<'about' | 'name'>('about');
  useBackHandler(true, () => (step === 'name' ? setStep('about') : onBack()));

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-night">
      <GlowBackground intensity={0.55} />
      <AnimatePresence mode="wait" initial={false}>
        {step === 'about' ? (
          <motion.div key="about" className="relative flex min-h-0 flex-1 flex-col" initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -40, opacity: 0 }}>
            <StepAbout me={me} launch={launch} onNeedName={() => setStep('name')} />
          </motion.div>
        ) : (
          <motion.div key="name" className="relative flex min-h-0 flex-1 flex-col" initial={{ x: -40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }}>
            <StepName me={me} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Turns the profile on. Their Telegram picture is taken if there is one to take; when there isn't,
 * sign-up carries on without a photo and their name becomes their picture — nobody is asked for
 * one, and nothing is said about it.
 */
async function activate(me: Me, name: string): Promise<Me> {
  if (name && name !== me.name) setMe(await api.patch<Me>('/v1/me', { name }));
  if (!me.photos.some((p) => p.status !== 'rejected')) {
    await api
      .post<Me>('/v1/me/photos/telegram')
      .then(setMe)
      .catch(() => undefined);
  }
  return api.post<Me>('/v1/me/complete');
}

/** Telegram's own first name, cleaned the way the server cleans it (letters and spaces only). */
const telegramName = (launch: Launch) =>
  (launch.user?.firstName ?? '')
    .replace(/[^\p{L}\p{M} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30);

function StepAbout({ me, launch, onNeedName }: { me: Me; launch: Launch; onNeedName: () => void }) {
  const meta = useMeta();
  const [gender, setGender] = useState<Gender>(me.gender ?? DEFAULT_GENDER);
  const [interested, setInterested] = useState<InterestedIn>(me.interestedIn ?? DEFAULT_INTERESTED);
  const [age, setAge] = useState<number>(me.age ?? DEFAULT_AGE);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Me | null>(null);
  const minAge = meta.data?.minAge ?? 18;
  const name = me.name ?? telegramName(launch);

  const pickGender = (g: Gender) => {
    haptic.select();
    setGender(g);
    // «who do you want to meet» follows the gender until the user says otherwise
    if (interested === gender || interested === (gender === 'male' ? 'female' : 'male')) {
      setInterested(g === 'male' ? 'female' : 'male');
    }
  };

  const start = async () => {
    setBusy(true);
    try {
      const saved = await api.patch<Me>('/v1/me', { gender, age, interestedIn: interested });
      setMe(saved);
      const m = await activate(saved, name);
      haptic.success();
      setDone(m);
      // Telegram messages are our push notifications: ask once, right when there is a reason to.
      if (!m.telegram.canDm) {
        const allowed = await askWriteAccess();
        if (allowed) await api.post('/v1/me/write-access', { allowed: true }).catch(() => undefined);
      }
      setTimeout(() => {
        setMe(m);
        void queryClient.invalidateQueries({ queryKey: keys.summary });
      }, 1600);
    } catch (e) {
      haptic.error();
      // the only thing we cannot do without: a name with letters in it
      const details = e instanceof ApiError && Array.isArray(e.details) ? (e.details as { path: string }[]) : [];
      if (details.some((d) => d.path === 'name')) return onNeedName();
      toast(errorMessage(e), '⚠️', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-5 pt-8 pb-4">
        <div className="text-[44px] leading-none">✨</div>
        <h1 className="mt-4 text-[27px] font-extrabold">{name ? `سلام ${name}!` : 'خودت رو معرفی کن'}</h1>
        <p className="mt-1.5 text-[14px] text-muted">جنسیت و سن بعداً قابل تغییر نیست.</p>

        <div className="mt-6 space-y-3">
          <ChoiceCard emoji="👨" title="مرد" selected={gender === 'male'} onClick={() => pickGender('male')} />
          <ChoiceCard emoji="👩" title="زن" selected={gender === 'female'} onClick={() => pickGender('female')} />
        </div>

        <h2 className="mt-7 text-[16px] font-bold">دوست داری با چه کسانی آشنا بشی؟</h2>
        <div className="mt-3 flex flex-wrap gap-2.5">
          <Chip emoji="👩" label="خانم‌ها" selected={interested === 'female'} onClick={() => setInterested('female')} />
          <Chip emoji="👨" label="آقایان" selected={interested === 'male'} onClick={() => setInterested('male')} />
          <Chip emoji="💫" label="همه" selected={interested === 'everyone'} onClick={() => setInterested('everyone')} />
        </div>

        <h2 className="mt-8 text-[16px] font-bold">چند سالته؟</h2>
        <p className="mt-1 text-[12.5px] text-muted">{fa(age)} سال</p>
        <div className="-mx-5 mt-2">
          <AgeWheel min={minAge} max={70} value={age} onChange={setAge} />
        </div>
      </div>
      <div className="px-5 pt-2 pb-safe">
        <Button className="mb-3 w-full" loading={busy} onClick={start}>
          بزن بریم 🔥
        </Button>
      </div>
      <AnimatePresence>{done ? <Celebrate name={done.name ?? name} photo={done.photos[0]?.md ?? null} /> : null}</AnimatePresence>
    </>
  );
}

/** The one fallback: their Telegram name has no letters in it, so we ask what to call them. */
function StepName({ me }: { me: Me }) {
  const [name, setName] = useState('');
  const [finishing, setFinishing] = useState(false);
  const [done, setDone] = useState<Me | null>(null);
  const nameOk = name.trim().length >= 2;

  const finish = async () => {
    setFinishing(true);
    try {
      const m = await activate(me, name.trim());
      haptic.success();
      setDone(m);
      if (!m.telegram.canDm) {
        const allowed = await askWriteAccess();
        if (allowed) await api.post('/v1/me/write-access', { allowed: true }).catch(() => undefined);
      }
      setTimeout(() => {
        setMe(m);
        void queryClient.invalidateQueries({ queryKey: keys.summary });
      }, 1600);
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), '⚠️', 'error');
      setFinishing(false);
    }
  };

  return (
    <>
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-5 pt-8 pb-4">
        <div className="text-[44px] leading-none">✍️</div>
        <h1 className="mt-4 text-[27px] font-extrabold">اسمت چیه؟</h1>
        <p className="mt-1.5 text-[14px] text-muted">همین اسم رو بقیه می‌بینن.</p>
        <div className="relative mt-6">
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 30))}
            placeholder="مثلاً سارا"
            autoFocus
            enterKeyHint="done"
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className="h-14 w-full rounded-[18px] border border-line bg-surface-1 px-4 text-[16px] outline-none transition-colors focus:border-rose/70"
          />
          {nameOk ? <Check className="absolute top-1/2 left-4 size-5 -translate-y-1/2 text-mint" /> : null}
        </div>
      </div>
      <div className="px-5 pt-2 pb-safe">
        <Button className="mb-3 w-full" disabled={!nameOk} loading={finishing} onClick={finish}>
          بزن بریم 🔥
        </Button>
      </div>
      <AnimatePresence>{done ? <Celebrate name={done.name ?? name.trim()} photo={done.photos[0]?.md ?? null} /> : null}</AnimatePresence>
    </>
  );
}

/** The welcome card: their picture, or their name drawn as one. */
function Celebrate({ name, photo }: { name: string; photo: string | null }) {
  return (
    <motion.div className="absolute inset-0 z-30 grid place-items-center overflow-hidden bg-night/90 backdrop-blur" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      {Array.from({ length: 18 }, (_, i) => (
        <span
          key={i}
          className={clsx('absolute bottom-0 animate-float-up text-[22px]')}
          style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 6) * 0.25}s`, animationDuration: `${4 + (i % 4)}s` }}
        >
          {['💖', '✨', '🔥', '💜'][i % 4]}
        </span>
      ))}
      <motion.div className="relative text-center" initial={{ scale: 0.7 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 14 }}>
        <div className="mx-auto size-28 overflow-hidden rounded-full ring-4 ring-rose/40">
          {photo ? <Img src={photo} className="size-full" /> : <NameArt name={name} className="size-full" />}
        </div>
        <h1 className="mt-4 text-[26px] font-extrabold">خوش اومدی {name}!</h1>
        <p className="mt-2 text-[14px] text-muted">بریم ببینیم کیا منتظرتن…</p>
      </motion.div>
    </motion.div>
  );
}
