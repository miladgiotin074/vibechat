import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '@/api/client';
import { setMe, useMe } from '@/api/queries';
import type { InterestedIn, Me } from '@/api/types';
import { fa } from '@/lib/format';
import { nav } from '@/store/nav';
import { toast } from '@/store/ui';
import { haptic } from '@/telegram/tg';
import { Button } from '@/ui/kit';
import { Sheet } from '@/ui/Sheet';
import { RangeSlider } from '@/ui/Slider';
import { useDeck } from './deck';

type Scope = Me['preferences']['scope'];

const WHO: { id: InterestedIn; label: string }[] = [
  { id: 'female', label: 'خانم‌ها' },
  { id: 'male', label: 'آقایان' },
  { id: 'everyone', label: 'همه' },
];

const SCOPES: { id: Scope; label: string; emoji: string }[] = [
  { id: 'nearby', label: 'نزدیک من', emoji: '📍' },
  { id: 'city', label: 'شهر من', emoji: '🏙️' },
  { id: 'province', label: 'استان من', emoji: '🗺️' },
  { id: 'country', label: 'کل ایران', emoji: '🇮🇷' },
];

function locate(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('no_geo'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      reject,
      { enableHighAccuracy: false, timeout: 12_000, maximumAge: 10 * 60_000 },
    );
  });
}

/** The slider's right end means «and older»: no upper limit is stored as the server's maximum. */
const AGE_MIN = 18;
const AGE_TOP = 70;
const NO_LIMIT = 99;
const toSlider = (age: number) => Math.min(Math.max(age, AGE_MIN), AGE_TOP);

export function Filters({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useMe().data;
  const [age, setAge] = useState<[number, number]>([AGE_MIN, AGE_TOP]);
  const [scope, setScope] = useState<Scope>('country');
  const [who, setWho] = useState<InterestedIn>('everyone');
  const [km, setKm] = useState(50);
  const [saving, setSaving] = useState(false);
  /** the user moved the age slider in this visit */
  const [ageTouched, setAgeTouched] = useState(false);

  useEffect(() => {
    if (!open || !me) return;
    // nothing chosen yet: every age
    setAge(me.preferences.ageSet ? [toSlider(me.preferences.minAge), toSlider(me.preferences.maxAge)] : [AGE_MIN, AGE_TOP]);
    setAgeTouched(false);
    setScope(me.preferences.scope);
    setWho(me.interestedIn ?? (me.gender === 'male' ? 'female' : 'male'));
    setKm(me.preferences.maxKm);
  }, [open, me]);

  const needsCity = (scope === 'city' || scope === 'province') && !me?.provinceId;

  const save = async () => {
    setSaving(true);
    try {
      if (scope === 'nearby' && !me?.hasLocation) {
        try {
          const pos = await locate();
          await api.put('/v1/me/location', pos);
        } catch {
          toast('دسترسی به موقعیت داده نشد. «کل ایران» یا «شهر من» رو انتخاب کن.', '📍', 'error');
          setSaving(false);
          return;
        }
      }
      // the age range is sent only when it is (or just became) the user's own choice: until then
      // it is a suggestion that orders the cards without hiding anyone
      const ages = ageTouched || me?.preferences.ageSet ? { minAge: age[0], maxAge: age[1] >= AGE_TOP ? NO_LIMIT : age[1] } : {};
      const gender = who !== me?.interestedIn ? { interestedIn: who } : {};
      const updated = await api.patch<Me>('/v1/me/preferences', { ...ages, ...gender, scope, maxKm: km });
      setMe(updated);
      haptic.success();
      onClose();
      await useDeck.getState().reset();
    } catch (e) {
      toast(errorMessage(e), '⚠️', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="فیلترهای کشف">
      <div className="space-y-6">
        <section>
          <h3 className="text-[15px] font-semibold">دوست داری کیا رو ببینی؟</h3>
          <div className="mt-3 grid grid-cols-3 gap-1.5 rounded-2xl border border-line bg-surface-2 p-1.5">
            {WHO.map((w) => (
              <button
                key={w.id}
                onClick={() => {
                  haptic.select();
                  setWho(w.id);
                }}
                className={clsx(
                  'rounded-xl py-2.5 text-[14px] font-bold transition-colors',
                  who === w.id ? 'bg-flame text-white shadow-[0_8px_20px_-8px_rgba(255,45,111,0.9)]' : 'text-muted',
                )}
              >
                {w.label}
              </button>
            ))}
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between">
            <h3 className="text-[15px] font-semibold">بازه‌ی سنی</h3>
            <span className="rounded-full bg-surface-2 px-3 py-1 text-[13px] font-semibold tabular text-rose">
              {age[0] <= AGE_MIN && age[1] >= AGE_TOP ? 'همه‌ی سن‌ها' : `${fa(age[0])} تا ${age[1] >= AGE_TOP ? `${fa(AGE_TOP)}+` : fa(age[1])}`}
            </span>
          </div>
          <RangeSlider
            min={AGE_MIN}
            max={AGE_TOP}
            maxLabel={`${fa(AGE_TOP)}+`}
            value={age}
            onChange={(v) => {
              setAge(v as [number, number]);
              setAgeTouched(true);
            }}
          />
          {!ageTouched && me && !me.preferences.ageSet ? (
            <p className="mt-2 text-[12px] leading-5 text-muted">
              الان همه‌ی سن‌ها رو می‌بینی. اگه بازه رو تغییر بدی، فقط همون سن‌ها نشونت داده می‌شن.
            </p>
          ) : null}
        </section>

        <section>
          <h3 className="text-[15px] font-semibold">از کجا؟</h3>
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            {SCOPES.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  haptic.select();
                  setScope(s.id);
                }}
                className={clsx(
                  'flex items-center gap-2 rounded-2xl px-3.5 py-3 text-[14px] font-medium transition-colors',
                  scope === s.id ? 'border-2 border-rose bg-rose/15' : 'border border-line bg-surface-2',
                )}
              >
                <span className="text-[18px]">{s.emoji}</span>
                {s.label}
              </button>
            ))}
          </div>
          {needsCity ? (
            <button
              className="mt-2 text-[12.5px] text-ember underline underline-offset-4"
              onClick={() => {
                onClose();
                nav.push({ name: 'editProfile' });
              }}
            >
              اول شهرت رو در پروفایل انتخاب کن
            </button>
          ) : null}
        </section>

        {scope === 'nearby' ? (
          <section>
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-semibold">حداکثر فاصله</h3>
              <span className="rounded-full bg-surface-2 px-3 py-1 text-[13px] font-semibold tabular text-rose">{fa(km)} کیلومتر</span>
            </div>
            <RangeSlider min={1} max={300} value={km} onChange={(v) => setKm(v as number)} />
          </section>
        ) : null}

        <Button className="w-full" loading={saving} disabled={needsCity} onClick={save}>
          اعمال فیلترها
        </Button>
      </div>
    </Sheet>
  );
}
