import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '@/api/client';
import { setMe, useMe } from '@/api/queries';
import type { InterestedIn, Me } from '@/api/types';
import { fa } from '@/lib/format';
import { toast } from '@/store/ui';
import { haptic } from '@/telegram/tg';
import { Button } from '@/ui/kit';
import { Sheet } from '@/ui/Sheet';
import { RangeSlider } from '@/ui/Slider';
import { useDeck } from './deck';

const WHO: { id: InterestedIn; label: string }[] = [
  { id: 'female', label: 'خانم‌ها' },
  { id: 'male', label: 'آقایان' },
  { id: 'everyone', label: 'همه' },
];

/** The slider's right end means «and older»: no upper limit is stored as the server's maximum. */
const AGE_MIN = 18;
const AGE_TOP = 70;
const NO_LIMIT = 99;
const toSlider = (age: number) => Math.min(Math.max(age, AGE_MIN), AGE_TOP);

/** Two filters, and that's all there is: who to see, and how old. */
export function Filters({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useMe().data;
  const [age, setAge] = useState<[number, number]>([AGE_MIN, AGE_TOP]);
  const [who, setWho] = useState<InterestedIn>('everyone');
  /** «محرم» only: every account, only verified ones, or only unverified ones. */
  const [verified, setVerified] = useState<'all' | 'verified' | 'unverified'>('all');
  const [saving, setSaving] = useState(false);
  /** the user moved the age slider in this visit */
  const [ageTouched, setAgeTouched] = useState(false);

  useEffect(() => {
    if (!open || !me) return;
    // nothing chosen yet: every age
    setAge(me.preferences.ageSet ? [toSlider(me.preferences.minAge), toSlider(me.preferences.maxAge)] : [AGE_MIN, AGE_TOP]);
    setAgeTouched(false);
    setWho(me.interestedIn ?? (me.gender === 'male' ? 'female' : 'male'));
    setVerified(me.preferences.verified ?? 'all');
  }, [open, me]);

  const save = async () => {
    setSaving(true);
    try {
      // the age range is sent only when it is (or just became) the user's own choice
      const ages = ageTouched || me?.preferences.ageSet ? { minAge: age[0], maxAge: age[1] >= AGE_TOP ? NO_LIMIT : age[1] } : {};
      const gender = who !== me?.interestedIn ? { interestedIn: who } : {};
      // only a «محرم» has this control at all, so only they ever send it
      const trust = me?.mahram && verified !== me.preferences.verified ? { verified } : {};
      const updated = await api.patch<Me>('/v1/me/preferences', { ...ages, ...gender, ...trust });
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

        {me?.mahram ? (
          <section>
            <h3 className="text-[15px] font-semibold">تأیید حساب</h3>
            <p className="mt-1 text-[12px] leading-5 text-muted">این فیلتر فقط برای حساب شماست.</p>
            <div className="mt-3 grid grid-cols-3 gap-1.5 rounded-2xl border border-line bg-surface-2 p-1.5">
              {(
                [
                  ['all', 'همه'],
                  ['verified', 'تأییدشده'],
                  ['unverified', 'تأیید نشده'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => {
                    haptic.select();
                    setVerified(id);
                  }}
                  className={clsx(
                    'rounded-xl py-2.5 text-[13.5px] font-bold transition-colors',
                    verified === id ? 'bg-flame text-white shadow-[0_8px_20px_-8px_rgba(255,45,111,0.9)]' : 'text-muted',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <Button className="w-full" loading={saving} onClick={save}>
          اعمال فیلترها
        </Button>
      </div>
    </Sheet>
  );
}
