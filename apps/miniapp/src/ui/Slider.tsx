import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { fa } from '@/lib/format';
import { haptic } from '@/telegram/tg';

/**
 * Range/single slider. Laid out left-to-right (numbers grow to the right, like every ruler) even
 * though the page is RTL.
 *
 * Made to move at the first touch, inside a draggable bottom sheet too:
 *  - the whole 48px-high strip is the touch target, not just the thin track;
 *  - `touch-action: none` there, so the browser never waits to see whether the finger is scrolling;
 *  - the pointer is handled with native listeners on the strip that stop the event there, so the
 *    sheet's drag-to-close (listening further up) never claims the gesture;
 *  - the grabbed thumb follows the finger through pointer capture, even off the strip.
 */
export function RangeSlider({
  min,
  max,
  value,
  onChange,
  step = 1,
  maxLabel,
}: {
  min: number;
  max: number;
  value: [number, number] | number;
  onChange: (v: [number, number] | number) => void;
  step?: number;
  /** what the right end reads (e.g. «۷۰+») */
  maxLabel?: string;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const dual = Array.isArray(value);
  const [lo, hi] = dual ? value : [min, value];
  const pct = (v: number) => ((v - min) / (max - min)) * 100;
  const [dragging, setDragging] = useState<0 | 1 | null>(null);
  // the latest props, for listeners that are attached once
  const live = useRef({ lo, hi, onChange, min, max, step, dual });
  live.current = { lo, hi, onChange, min, max, step, dual };

  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    let grabbed: 0 | 1 | null = null;
    let last: number | null = null;

    const valueAt = (clientX: number) => {
      const { min: a, max: b, step: s } = live.current;
      const r = track.current!.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      return Math.min(b, Math.max(a, Math.round((a + ratio * (b - a)) / s) * s));
    };
    const apply = (clientX: number) => {
      const v = valueAt(clientX);
      if (v === last) return;
      last = v;
      haptic.select();
      const { lo: l, hi: h, onChange: change, dual: two } = live.current;
      if (!two) return change(v);
      if (grabbed === 0) change([Math.min(v, h), h]);
      else change([l, Math.max(v, l)]);
    };

    const down = (e: PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const v = valueAt(e.clientX);
      const { lo: l, hi: h, dual: two } = live.current;
      // the nearer thumb; on a tie (both at the same spot) the one that can move that way
      const dl = Math.abs(v - l);
      const dh = Math.abs(v - h);
      grabbed = !two ? 1 : dl < dh ? 0 : dl > dh ? 1 : v < l ? 0 : 1;
      last = null;
      el.setPointerCapture(e.pointerId);
      setDragging(grabbed);
      apply(e.clientX);
    };
    const move = (e: PointerEvent) => {
      if (grabbed === null) return;
      e.stopPropagation();
      apply(e.clientX);
    };
    const up = () => {
      grabbed = null;
      last = null;
      setDragging(null);
    };
    const stopTouch = (e: TouchEvent) => e.stopPropagation();

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    el.addEventListener('touchstart', stopTouch, { passive: true });
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('lostpointercapture', up);
      el.removeEventListener('touchstart', stopTouch);
    };
  }, []);

  return (
    <div dir="ltr" className="select-none px-3">
      <div ref={strip} className="relative flex h-12 cursor-pointer items-center touch-none">
        <div ref={track} className="relative h-2 w-full rounded-full bg-surface-3">
          <div className="absolute inset-y-0 rounded-full bg-flame" style={{ left: `${dual ? pct(lo) : 0}%`, right: `${100 - pct(hi)}%` }} />
          {(dual ? [lo, hi] : [hi]).map((v, i) => {
            const which = dual ? (i as 0 | 1) : 1;
            return (
              <div
                key={i}
                className={clsx(
                  'pointer-events-none absolute top-1/2 grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white shadow-[0_4px_14px_rgba(0,0,0,0.4)] transition-transform duration-100',
                  dragging === which && 'scale-125',
                )}
                style={{ left: `${pct(v)}%` }}
              >
                <span className="size-2.5 rounded-full bg-rose" />
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex justify-between text-[12px] text-faint">
        <span>{fa(min)}</span>
        <span>{maxLabel ?? fa(max)}</span>
      </div>
    </div>
  );
}
