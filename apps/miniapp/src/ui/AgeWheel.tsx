import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { fa } from '@/lib/format';
import { haptic } from '@/telegram/tg';

const ITEM = 64;

/**
 * Horizontal snap "ruler" for picking an age: scroll or tap, the centred number is the value.
 * Kept left-to-right inside the RTL page so scroll positions behave the same on every WebView.
 */
export function AgeWheel({ min = 18, max = 70, value, onChange, initial = 25 }: { min?: number; max?: number; value: number | null; onChange: (v: number) => void; initial?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [center, setCenter] = useState(value ?? initial);
  const touched = useRef(false);
  const ages = Array.from({ length: max - min + 1 }, (_, i) => min + i);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollLeft = ((value ?? initial) - min) * ITEM;
    // only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const idx = Math.max(0, Math.min(ages.length - 1, Math.round(el.scrollLeft / ITEM)));
    const v = ages[idx]!;
    if (v !== center) {
      setCenter(v);
      haptic.select();
    }
    if (touched.current && v !== value) onChange(v);
  };

  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-y-0 left-1/2 z-10 w-[64px] -translate-x-1/2 rounded-2xl border-2 border-rose/70 bg-rose/10" />
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-night to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-night to-transparent" />
      <div
        ref={ref}
        dir="ltr"
        onScroll={onScroll}
        onPointerDown={() => (touched.current = true)}
        onTouchStart={() => (touched.current = true)}
        onWheel={() => (touched.current = true)}
        className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto py-3"
        style={{ paddingInline: `calc(50% - ${ITEM / 2}px)` }}
      >
        {ages.map((a) => {
          const d = Math.abs(a - center);
          return (
            <button
              key={a}
              onClick={() => {
                touched.current = true;
                ref.current?.scrollTo({ left: (a - min) * ITEM, behavior: 'smooth' });
                onChange(a);
              }}
              className={clsx(
                'grid h-16 shrink-0 snap-center place-items-center font-bold tabular transition-all duration-150',
                d === 0 ? (value != null ? 'text-[30px] text-ink' : 'text-[30px] text-muted') : d === 1 ? 'text-[20px] text-muted' : 'text-[16px] text-faint',
              )}
              style={{ width: ITEM }}
            >
              {fa(a)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
