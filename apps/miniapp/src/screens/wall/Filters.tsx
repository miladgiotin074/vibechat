import clsx from 'clsx';
import { useEffect, useState } from 'react';
import type { Gender, WallFilters } from '@/api/types';
import { haptic } from '@/telegram/tg';
import { Button } from '@/ui/kit';
import { Sheet } from '@/ui/Sheet';

/** The Wall shows every live request; the only filter is whose. */
export const DEFAULT_WALL_FILTERS: WallFilters = {};

/** How many filters are narrowing the Wall right now (for the badge on the header button). */
export const restrictiveCount = (f: WallFilters) => (f.gender ? 1 : 0);

const WHO: { id: Gender | 'all'; label: string }[] = [
  { id: 'all', label: 'همه' },
  { id: 'female', label: '👩 خانم‌ها' },
  { id: 'male', label: '👨 آقایان' },
];

/** One switch, and that's all: whose requests to show. */
export function WallFilterSheet({ open, onClose, value, onApply }: { open: boolean; onClose: () => void; value: WallFilters; onApply: (f: WallFilters) => void }) {
  const [who, setWho] = useState<Gender | 'all'>('all');

  useEffect(() => {
    if (!open) return;
    setWho(value.gender ?? 'all');
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

        <Button
          className="w-full"
          onClick={() => {
            onApply({ gender: who === 'all' ? undefined : who });
            onClose();
          }}
        >
          اعمال فیلترها
        </Button>
      </div>
    </Sheet>
  );
}
