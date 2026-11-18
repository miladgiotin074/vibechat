import clsx from 'clsx';
import { useEffect, useState } from 'react';
import type { Gender, WallFilters } from '@/api/types';
import { haptic } from '@/telegram/tg';
import { Button } from '@/ui/kit';
import { Sheet } from '@/ui/Sheet';

/** By default the Wall shows only the requests the user can actually answer. */
export const DEFAULT_WALL_FILTERS: WallFilters = { forMe: true };

/** How many filters are narrowing the Wall right now (for the badge on the header button). */
export const restrictiveCount = (f: WallFilters) => (f.gender ? 1 : 0);

const WHO: { id: Gender | 'all'; label: string }[] = [
  { id: 'all', label: 'همه' },
  { id: 'female', label: '👩 خانم‌ها' },
  { id: 'male', label: '👨 آقایان' },
];

/** Two switches, and that's all: whose requests, and whether to see ones not meant for me. */
export function WallFilterSheet({ open, onClose, value, onApply }: { open: boolean; onClose: () => void; value: WallFilters; onApply: (f: WallFilters) => void }) {
  const [who, setWho] = useState<Gender | 'all'>('all');
  const [forMe, setForMe] = useState(true);

  useEffect(() => {
    if (!open) return;
    setWho(value.gender ?? 'all');
    setForMe(!!value.forMe);
  }, [open, value]);

  return (
    <Sheet open={open} onClose={onClose} title="فیلترهای دیوار">
      <div className="space-y-6">
        <section>
          <h3 className="text-[15px] font-semibold">نوشته‌ی کیا رو ببینی؟</h3>
          <div className="mt-3 grid grid-cols-3 gap-1.5 rounded-2xl border border-line bg-surface-2 p-1.5">
            {WHO.map((w) => (
              <button
                key={w.id}
                onClick={() => {
                  haptic.select();
                  setWho(w.id);
                }}
                className={clsx('rounded-xl py-2.5 text-[14px] font-bold transition-colors', who === w.id ? 'bg-flame text-white shadow-[0_8px_20px_-8px_rgba(255,45,111,0.9)]' : 'text-muted')}
              >
                {w.label}
              </button>
            ))}
          </div>
        </section>

        <button
          onClick={() => {
            haptic.select();
            setForMe((v) => !v);
          }}
          className="flex w-full items-center gap-3 rounded-card border border-line bg-surface-2 p-3.5 text-right"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[14.5px] font-semibold">فقط درخواست‌هایی که برای منه</span>
            <span className="block text-[12px] leading-5 text-muted">اگه خاموش باشه همه‌ی درخواست‌های دیوار رو می‌بینی</span>
          </span>
          <span className={clsx('relative h-7 w-12 shrink-0 rounded-full transition-colors', forMe ? 'bg-flame' : 'bg-white/10')}>
            <span className={clsx('absolute top-1 size-5 rounded-full bg-white transition-all', forMe ? 'right-1' : 'right-6')} />
          </span>
        </button>

        <Button
          className="w-full"
          onClick={() => {
            onApply({ forMe, gender: who === 'all' ? undefined : who });
            onClose();
          }}
        >
          اعمال فیلترها
        </Button>
      </div>
    </Sheet>
  );
}
