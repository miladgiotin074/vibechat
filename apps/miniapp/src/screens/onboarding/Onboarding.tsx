import clsx from 'clsx';
import { Camera, Check, Loader2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { api, ApiError, errorMessage } from '@/api/client';
import { keys, queryClient, setMe, useMe, useMeta } from '@/api/queries';
import type { Gender, InterestedIn, Me } from '@/api/types';
import { fa } from '@/lib/format';
import { photoForm, pickImage, prepareImage } from '@/lib/image';
import { useBackHandler } from '@/store/nav';
import { toast } from '@/store/ui';
import { askWriteAccess, haptic, type Launch } from '@/telegram/tg';
import { AgeWheel } from '@/ui/AgeWheel';
import { Button, Chip, ChoiceCard, GlowBackground, Img } from '@/ui/kit';

/** What the sign-up starts from, so nobody has to choose anything to get going. */
const DEFAULT_GENDER: Gender = 'male';
const DEFAULT_INTERESTED: InterestedIn = 'female';
const DEFAULT_AGE = 25;

/**
 * The whole sign-up: one screen. Telegram already told us the name and gave us the profile photo,
 * so the only questions are gender, who to meet and age — and all three start on a sensible answer.
 * The name and photo are shown back on the welcome card at the end.
 *
 * Only when Telegram has no usable photo (or no usable name) does a second screen appear, asking
 * for just that. The rest of the profile can be filled later from «پروفایل من».
 */
export function Onboarding({ launch, onBack }: { launch: Launch; onBack: () => void }) {
  const me = useMe().data!;
  /** 'about' → the three questions; 'missing' → what Telegram could not give us. */
  const [step, setStep] = useState<'about' | 'missing'>('about');
  useBackHandler(true, () => (step === 'missing' ? setStep('about') : onBack()));

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-night">
      <GlowBackground intensity={0.55} />
      <AnimatePresence mode="wait" initial={false}>
        {step === 'about' ? (
          <motion.div key="about" className="relative flex min-h-0 flex-1 flex-col" initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -40, opacity: 0 }}>
            <StepAbout me={me} launch={launch} onMissing={() => setStep('missing')} />
          </motion.div>
        ) : (
          <motion.div key="missing" className="relative flex min-h-0 flex-1 flex-col" initial={{ x: -40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }}>
            <StepMissing me={me} launch={launch} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Pulls the Telegram photo (unless there is one already) and turns the profile on. */
async function activate(me: Me, name: string): Promise<Me> {
  if (name && name !== me.name) setMe(await api.patch<Me>('/v1/me', { name }));
  if (!me.photos.some((p) => p.status !== 'rejected')) {
    const m = await api.post<Me>('/v1/me/photos/telegram');
    setMe(m);
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

function StepAbout({ me, launch, onMissing }: { me: Me; launch: Launch; onMissing: () => void }) {
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
      // Telegram had no photo for us (or no name we can use): ask for just that
      const details = e instanceof ApiError && Array.isArray(e.details) ? (e.details as { path: string }[]) : [];
      const noPhoto = e instanceof ApiError && (e.status === 404 || details.some((d) => d.path === 'photos'));
      if (noPhoto || details.some((d) => d.path === 'name')) return onMissing();
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
        <p className="mt-1.5 text-[14px] text-muted">اسم و عکست از تلگرام میاد. جنسیت و سن بعداً قابل تغییر نیست.</p>

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

/**
 * The fallback: Telegram's profile photo is not shared with us (or the name has no letters in it),
 * so sign-up asks for exactly what is missing and nothing else.
 */
function StepMissing({ me, launch }: { me: Me; launch: Launch }) {
  const [name, setName] = useState(me.name ?? telegramName(launch));
  const [busy, setBusy] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [done, setDone] = useState<Me | null>(null);
  const main = me.photos.find((p) => p.status !== 'rejected');
  const needName = !me.name;
  const nameOk = name.trim().length >= 2;

  const upload = async () => {
    const file = await pickImage();
    if (!file) return;
    setBusy(true);
    try {
      setMe(await api.upload<Me>('/v1/me/photos', photoForm(await prepareImage(file))));
      haptic.success();
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), '⚠️', 'error');
    } finally {
      setBusy(false);
    }
  };

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
      const details = e instanceof ApiError && Array.isArray(e.details) ? (e.details as { path: string }[]) : [];
      toast(details.some((d) => d.path === 'photos') ? 'حداقل یک عکس لازم است 📸' : errorMessage(e), '⚠️', 'error');
      setFinishing(false);
    }
  };

  return (
    <>
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-5 pt-8 pb-4">
        <div className="text-[44px] leading-none">📸</div>
        <h1 className="mt-4 text-[27px] font-extrabold">یه عکس از خودت</h1>
        <p className="mt-1.5 text-[14px] text-muted">عکس پروفایل تلگرامت در دسترس نبود؛ یکی از گالری انتخاب کن.</p>

        <button onClick={() => !busy && upload()} className="relative mt-6 block aspect-[3/4] w-full max-w-56 overflow-hidden rounded-card border border-line bg-surface-1">
          {main ? (
            <Img src={main.md} color={main.color} className="absolute inset-0" />
          ) : (
            <div className="flex size-full flex-col items-center justify-center gap-3 rounded-card border-2 border-dashed border-rose/40 text-muted">
              <span className="grid size-14 place-items-center rounded-full bg-flame-d text-white shadow-[0_10px_30px_-8px_rgba(255,45,111,0.8)]">
                <Camera className="size-6" />
              </span>
              <span className="text-[13px]">انتخاب عکس</span>
            </div>
          )}
          {busy ? (
            <div className="absolute inset-0 grid place-items-center bg-night/60 backdrop-blur-sm">
              <Loader2 className="size-7 animate-spin text-rose" />
            </div>
          ) : null}
        </button>

        {needName ? (
          <>
            <h2 className="mt-7 text-[16px] font-bold">اسمت چیه؟</h2>
            <div className="relative mt-3">
              <input
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 30))}
                placeholder="مثلاً سارا"
                enterKeyHint="done"
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                className="h-14 w-full rounded-[18px] border border-line bg-surface-1 px-4 text-[16px] outline-none transition-colors focus:border-rose/70"
              />
              {nameOk ? <Check className="absolute top-1/2 left-4 size-5 -translate-y-1/2 text-mint" /> : null}
            </div>
          </>
        ) : null}
      </div>
      <div className="px-5 pt-2 pb-safe">
        <Button className="mb-3 w-full" disabled={!main || !nameOk || busy} loading={finishing} onClick={finish}>
          بزن بریم 🔥
        </Button>
      </div>
      <AnimatePresence>{done ? <Celebrate name={done.name ?? name.trim()} photo={done.photos[0]?.md ?? null} /> : null}</AnimatePresence>
    </>
  );
}

/** The welcome card: the name and photo we took from Telegram, shown back to them. */
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
        {photo ? (
          <div className="mx-auto size-28 overflow-hidden rounded-full ring-4 ring-rose/40">
            <Img src={photo} className="size-full" />
          </div>
        ) : (
          <div className="text-[64px]">🎉</div>
        )}
        <h1 className="mt-4 text-[26px] font-extrabold">خوش اومدی {name}!</h1>
        <p className="mt-2 text-[14px] text-muted">اسم و عکست از تلگرام گرفته شد؛ هر وقت خواستی از «پروفایل من» عوضشون کن.</p>
      </motion.div>
    </motion.div>
  );
}
