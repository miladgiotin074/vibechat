import clsx from 'clsx';
import { Camera, Check, ImagePlus, Loader2, RefreshCw, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
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

/**
 * The whole sign-up: two short steps. Telegram already told us who the user is, so we only ask what
 * matching needs — gender, age and one photo (their Telegram photo is put in for them). The rest of
 * the profile can be filled later from «پروفایل من».
 */
export function Onboarding({ launch, onBack }: { launch: Launch; onBack: () => void }) {
  const me = useMe().data!;
  const [step, setStep] = useState<1 | 2>(me.gender && me.age ? 2 : 1);
  useBackHandler(true, () => (step === 2 ? setStep(1) : onBack()));

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-night">
      <GlowBackground intensity={0.55} />
      <div className="relative flex items-center gap-3 px-5 pt-4">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
          <motion.div className="h-full rounded-full bg-flame" animate={{ width: step === 1 ? '50%' : '100%' }} transition={{ type: 'spring', stiffness: 140, damping: 22 }} />
        </div>
        <span className="text-[13px] text-muted tabular">
          {fa(step)} از {fa(2)}
        </span>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        {step === 1 ? (
          <motion.div key="s1" className="relative flex min-h-0 flex-1 flex-col" initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -40, opacity: 0 }}>
            <StepAbout me={me} onDone={() => setStep(2)} />
          </motion.div>
        ) : (
          <motion.div key="s2" className="relative flex min-h-0 flex-1 flex-col" initial={{ x: -40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }}>
            <StepPhoto me={me} launch={launch} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StepAbout({ me, onDone }: { me: Me; onDone: () => void }) {
  const meta = useMeta();
  const [gender, setGender] = useState<Gender | null>(me.gender);
  const [interested, setInterested] = useState<InterestedIn | null>(me.interestedIn);
  const [age, setAge] = useState<number | null>(me.age);
  const [saving, setSaving] = useState(false);
  const minAge = meta.data?.minAge ?? 18;

  const pickGender = (g: Gender) => {
    setGender(g);
    if (!interested || interested === gender || (gender && interested === (gender === 'male' ? 'female' : 'male'))) {
      setInterested(g === 'male' ? 'female' : 'male');
    }
  };

  const save = async () => {
    if (!gender || !age) return;
    setSaving(true);
    try {
      setMe(await api.patch<Me>('/v1/me', { gender, age, interestedIn: interested ?? (gender === 'male' ? 'female' : 'male') }));
      haptic.success();
      onDone();
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), '⚠️', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-5 pt-8 pb-4">
        <div className="text-[44px] leading-none">✨</div>
        <h1 className="mt-4 text-[27px] font-extrabold">خودت رو معرفی کن</h1>
        <p className="mt-1.5 text-[14px] text-muted">جنسیت و سن بعداً قابل تغییر نیست.</p>

        <div className="mt-6 space-y-3">
          <ChoiceCard emoji="👩" title="زن" selected={gender === 'female'} onClick={() => pickGender('female')} />
          <ChoiceCard emoji="👨" title="مرد" selected={gender === 'male'} onClick={() => pickGender('male')} />
        </div>

        <AnimatePresence>
          {gender ? (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="overflow-hidden">
              <h2 className="mt-7 text-[16px] font-bold">دوست داری با چه کسانی آشنا بشی؟</h2>
              <div className="mt-3 flex flex-wrap gap-2.5">
                <Chip emoji="👨" label="آقایان" selected={interested === 'male'} onClick={() => setInterested('male')} />
                <Chip emoji="👩" label="خانم‌ها" selected={interested === 'female'} onClick={() => setInterested('female')} />
                <Chip emoji="💫" label="همه" selected={interested === 'everyone'} onClick={() => setInterested('everyone')} />
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <h2 className="mt-8 text-[16px] font-bold">چند سالته؟</h2>
        <p className="mt-1 text-[12.5px] text-muted">{age ? `${fa(age)} سال` : 'بکش و انتخاب کن'}</p>
        <div className="-mx-5 mt-2">
          <AgeWheel min={minAge} max={70} value={age} onChange={setAge} />
        </div>
      </div>
      <div className="px-5 pt-2 pb-safe">
        <Button className="mb-3 w-full" disabled={!gender || !age} loading={saving} onClick={save}>
          ادامه
        </Button>
      </div>
    </>
  );
}

function StepPhoto({ me, launch }: { me: Me; launch: Launch }) {
  const meta = useMeta();
  const [name, setName] = useState(me.name ?? launch.user?.firstName ?? '');
  const [busy, setBusy] = useState<'telegram' | 'upload' | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [done, setDone] = useState(false);
  const tried = useRef(false);
  const photos = me.photos.filter((p) => p.status !== 'rejected');
  const main = photos[0];
  const maxPhotos = meta.data?.maxPhotos ?? 6;

  // Put their Telegram profile photo in for them: most people keep it.
  useEffect(() => {
    if (tried.current || photos.length > 0) return;
    tried.current = true;
    setBusy('telegram');
    api
      .post<Me>('/v1/me/photos/telegram')
      .then((m) => {
        setMe(m);
        haptic.success();
      })
      .catch(() => undefined)
      .finally(() => setBusy(null));
  }, [photos.length]);

  const upload = async (replaceId?: string) => {
    const file = await pickImage();
    if (!file) return;
    setBusy('upload');
    try {
      const blob = await prepareImage(file);
      let m = await api.upload<Me>('/v1/me/photos', photoForm(blob));
      if (replaceId) m = await api.del<Me>(`/v1/me/photos/${replaceId}`);
      setMe(m);
      haptic.success();
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), '⚠️', 'error');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    try {
      setMe(await api.del<Me>(`/v1/me/photos/${id}`));
    } catch (e) {
      toast(errorMessage(e), '⚠️', 'error');
    }
  };

  const nameOk = name.trim().length >= 2;

  const finish = async () => {
    setFinishing(true);
    try {
      if (name.trim() !== me.name) setMe(await api.patch<Me>('/v1/me', { name: name.trim() }));
      const m = await api.post<Me>('/v1/me/complete');
      haptic.success();
      setDone(true);
      // Telegram messages are our push notifications: ask once, right when there is a reason to.
      if (!m.telegram.canDm) {
        const allowed = await askWriteAccess();
        if (allowed) await api.post('/v1/me/write-access', { allowed: true }).catch(() => undefined);
      }
      setTimeout(() => {
        setMe(m);
        void queryClient.invalidateQueries({ queryKey: keys.summary });
      }, 1400);
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
        <h1 className="mt-4 text-[27px] font-extrabold">یه عکس خوب، یه اسم</h1>
        <p className="mt-1.5 text-[14px] text-muted">عکسی که چهره‌ات واضح باشه، تا ۳ برابر مچ بیشتری می‌گیره.</p>

        <div className="mt-6 flex gap-3">
          <button
            onClick={() => !busy && upload(main?.id)}
            className="relative aspect-[3/4] flex-[1.6] overflow-hidden rounded-card border border-line bg-surface-1"
          >
            {main ? (
              <>
                <Img src={main.md} color={main.color} className="absolute inset-0" />
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 bg-gradient-to-t from-black/70 to-transparent pt-10 pb-3 text-[12.5px] font-medium">
                  <RefreshCw className="size-3.5" /> عوض کردن
                </div>
                <span className="absolute top-3 right-3 rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-semibold backdrop-blur">عکس اصلی</span>
              </>
            ) : (
              <div className="flex size-full flex-col items-center justify-center gap-3 border-2 border-dashed border-rose/40 rounded-card text-muted">
                <span className="grid size-14 place-items-center rounded-full bg-flame-d text-white shadow-[0_10px_30px_-8px_rgba(255,45,111,0.8)]">
                  <Camera className="size-6" />
                </span>
                <span className="text-[13px]">انتخاب عکس</span>
              </div>
            )}
            {busy ? (
              <div className="absolute inset-0 grid place-items-center bg-night/60 backdrop-blur-sm">
                <div className="flex flex-col items-center gap-2 text-[12.5px] text-muted">
                  <Loader2 className="size-7 animate-spin text-rose" />
                  {busy === 'telegram' ? 'آوردن عکس تلگرامت…' : 'در حال آپلود…'}
                </div>
              </div>
            ) : null}
          </button>
          <div className="flex flex-1 flex-col gap-3">
            {[1, 2].map((k) => {
              const p = photos[k];
              return (
                <button
                  key={k}
                  onClick={() => (p ? remove(p.id) : !busy && photos.length < maxPhotos && upload())}
                  className="relative flex-1 overflow-hidden rounded-card border border-line bg-surface-1"
                >
                  {p ? (
                    <>
                      <Img src={p.thumb} color={p.color} className="absolute inset-0" />
                      <span className="absolute top-1.5 left-1.5 grid size-6 place-items-center rounded-full bg-black/60">
                        <X className="size-3.5" />
                      </span>
                    </>
                  ) : (
                    <span className="grid size-full place-items-center text-faint">
                      <ImagePlus className="size-6" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

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
        <p className="mt-2 text-[12px] text-faint">بقیه‌ی پروفایلت (بیو، علاقه‌مندی‌ها، شهر…) رو هر وقت خواستی از «پروفایل من» کامل کن.</p>
      </div>
      <div className="px-5 pt-2 pb-safe">
        <Button className="mb-3 w-full" disabled={!main || !nameOk || !!busy} loading={finishing} onClick={finish}>
          بزن بریم 🔥
        </Button>
      </div>
      <AnimatePresence>{done ? <Celebrate name={name.trim()} /> : null}</AnimatePresence>
    </>
  );
}

function Celebrate({ name }: { name: string }) {
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
        <div className="text-[64px]">🎉</div>
        <h1 className="mt-3 text-[26px] font-extrabold">خوش اومدی {name}!</h1>
        <p className="mt-2 text-[14px] text-muted">بریم ببینیم کیا منتظرتن…</p>
      </motion.div>
    </motion.div>
  );
}
