import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { useMe, useMeta } from '@/api/queries';
import type { Gender, WallFilters } from '@/api/types';
import { nav } from '@/store/nav';
import { haptic } from '@/telegram/tg';
import { Button, Chip, Toggle } from '@/ui/kit';
import { Sheet } from '@/ui/Sheet';
import { lookingForPlural } from './PostCard';

/** By default the Wall shows only requests the viewer can answer. */
export const DEFAULT_WALL_FILTERS: WallFilters = { forMe: true };

/** Filters that narrow the list (the header button shows a dot while any is on). */
export const restrictiveCount = (f: WallFilters) => (f.gender ? 1 : 0) + (f.category ? 1 : 0) + (f.city ? 1 : 0);

const AUTHORS: { id: Gender | undefined; label: string; emoji: string }[] = [
  { id: undefined, label: 'همه', emoji: '💫' },
  { id: 'female', label: 'خانم‌ها', emoji: '👩' },
  { id: 'male', label: 'آقایان', emoji: '👨' },
];

export function WallFilterSheet({
  open,
  onClose,
  value,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  value: WallFilters;
  onApply: (f: WallFilters) => void;
}) {
  const me = useMe().data;
  const categories = useMeta().data?.wall?.categories ?? [];
  const [draft, setDraft] = useState<WallFilters>(value);
  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);
  const set = (patch: Partial<WallFilters>) => setDraft((d) => ({ ...d, ...patch }));
  const noCity = !me?.city;

  const apply = () => {
    haptic.light();
    onApply(draft);
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title="فیلترهای دیوار">
      <div className="space-y-6">
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface-2 px-4 py-3.5">
          <div className="flex-1">
            <div className="text-[15px] font-medium">✨ فقط درخواست‌های مناسب من</div>
            <div className="text-[12px] leading-5 text-muted">
              {me?.gender ? `اونایی که برای ${lookingForPlural(me.gender)} یا همه نوشته شدن` : 'اونایی که می‌تونی بهشون جواب بدی'}
            </div>
          </div>
          <Toggle checked={!!draft.forMe} onChange={(v) => set({ forMe: v })} />
        </div>

        <section>
          <h3 className="text-[15px] font-semibold">نویسنده‌ی درخواست</h3>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {AUTHORS.map((g) => (
              <button
                key={g.label}
                onClick={() => {
                  haptic.select();
                  set({ gender: g.id });
                }}
                className={clsx(
                  'flex items-center justify-center gap-1.5 rounded-2xl py-3 text-[14px] font-medium transition-colors',
                  draft.gender === g.id ? 'border-2 border-rose bg-rose/15' : 'border border-line bg-surface-2',
                )}
              >
                <span className="text-[17px]">{g.emoji}</span>
                {g.label}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3 className="text-[15px] font-semibold">موضوع</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            <Chip label="همه" emoji="🧱" selected={!draft.category} onClick={() => set({ category: undefined })} />
            {categories.map((c) => (
              <Chip key={c.id} label={c.label} emoji={c.emoji} selected={draft.category === c.id} onClick={() => set({ category: draft.category === c.id ? undefined : c.id })} />
            ))}
          </div>
        </section>

        <div className={clsx('flex items-center gap-3 rounded-2xl border border-line bg-surface-2 px-4 py-3.5', noCity && 'opacity-70')}>
          <div className="flex-1">
            <div className="text-[15px] font-medium">📍 فقط شهر من</div>
            {noCity ? (
              <button
                className="text-[12px] text-ember underline underline-offset-4"
                onClick={() => {
                  onClose();
                  nav.push({ name: 'editProfile' });
                }}
              >
                اول شهرت رو در پروفایل انتخاب کن
              </button>
            ) : (
              <div className="text-[12px] text-muted">درخواست‌های {me?.city}</div>
            )}
          </div>
          <Toggle checked={!!draft.city} disabled={noCity} onChange={(v) => set({ city: v })} />
        </div>

        <div className="flex gap-2.5">
          <Button className="flex-1" onClick={apply}>
            نمایش درخواست‌ها
          </Button>
          <Button variant="soft" className="w-28" onClick={() => setDraft({ forMe: false })}>
            پاک کردن
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
