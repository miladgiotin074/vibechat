import clsx from 'clsx';
import { RotateCw } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type ReactNode, type RefObject, type UIEvent } from 'react';
import { haptic } from '@/telegram/tg';

/** How far the circle travels before letting go refreshes, and how far it can go at most. */
const TRIGGER = 72;
const MAX = 110;
const SIZE = 40;

interface PullOptions {
  disabled?: boolean;
  /** Whether a touch that starts here may begin a pull (default: any, as long as the area is scrolled to its top). */
  canStart?: (e: TouchEvent) => boolean;
}

/**
 * Android-style pull to refresh on `target`: pulled down from the very top, the circle follows the
 * finger; let go past the mark and it spins until `onRefresh` is done. Returns what <PullCircle>
 * needs. The target need not scroll (the home page pulls from its top bar).
 */
export function usePullRefresh(target: RefObject<HTMLElement | null>, onRefresh: () => Promise<unknown>, { disabled, canStart }: PullOptions = {}) {
  const circle = useRef<HTMLDivElement>(null);
  const icon = useRef<SVGSVGElement>(null);
  const [refreshing, setRefreshing] = useState(false);
  const busy = useRef(false);
  const latest = useRef(onRefresh);
  latest.current = onRefresh;
  const allowed = useRef(canStart);
  allowed.current = canStart;

  useEffect(() => {
    const el = target.current;
    if (!el || disabled) return;
    let startX = 0;
    let startY = 0;
    // null: not decided yet; false: a scroll or a sideways swipe; true: pulling
    let pulling: boolean | null = null;
    let distance = 0;
    let armed = false;

    const place = (d: number, animated: boolean) => {
      const c = circle.current;
      if (!c) return;
      c.style.transition = animated ? 'transform 220ms cubic-bezier(.2,.8,.2,1), opacity 220ms' : 'none';
      c.style.transform = `translate(-50%, ${d - SIZE - 8}px)`;
      c.style.opacity = String(Math.min(1, d / (TRIGGER * 0.6)));
      if (icon.current && !busy.current) icon.current.style.transform = `rotate(${d * 4}deg)`;
    };

    const start = (e: TouchEvent) => {
      if (busy.current || el.scrollTop > 0 || e.touches.length !== 1 || (allowed.current && !allowed.current(e))) {
        pulling = false;
        return;
      }
      startX = e.touches[0]!.clientX;
      startY = e.touches[0]!.clientY;
      pulling = null;
      distance = 0;
      armed = false;
    };

    const move = (e: TouchEvent) => {
      if (pulling === false) return;
      const dx = e.touches[0]!.clientX - startX;
      const dy = e.touches[0]!.clientY - startY;
      if (pulling === null) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        pulling = dy > 0 && Math.abs(dy) > Math.abs(dx) && el.scrollTop <= 0;
        if (!pulling) return;
      }
      e.preventDefault(); // no page scroll or iOS bounce while the circle follows the finger
      // resistance grows as it goes, like a rubber band
      distance = Math.max(0, MAX * (1 - Math.exp(-Math.max(0, dy) / (MAX * 1.6))));
      if (distance >= TRIGGER !== armed) {
        armed = distance >= TRIGGER;
        if (armed) haptic.select();
      }
      place(distance, false);
    };

    const end = () => {
      if (!pulling) return;
      pulling = false;
      if (!armed) return place(0, true);
      busy.current = true;
      setRefreshing(true);
      place(TRIGGER * 0.85, true);
      haptic.light();
      const minimum = new Promise((r) => setTimeout(r, 600)); // a spin too short to see looks like a glitch
      void Promise.allSettled([latest.current(), minimum]).then(() => {
        busy.current = false;
        setRefreshing(false);
        place(0, true);
      });
    };

    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
  }, [target, disabled]);

  return { circle, icon, refreshing };
}

/** The circle that slides down over the content. Sits (absolutely) in a `relative` box above what it covers. */
export function PullCircle({ circle, icon, refreshing }: ReturnType<typeof usePullRefresh>) {
  return (
    <div
      ref={circle}
      aria-hidden
      className="pointer-events-none absolute top-0 left-1/2 z-20 grid place-items-center rounded-full border border-line bg-surface-2 shadow-[0_8px_24px_-6px_rgba(0,0,0,0.8)]"
      style={{ width: SIZE, height: SIZE, transform: `translate(-50%, ${-SIZE - 8}px)`, opacity: 0 }}
    >
      <RotateCw ref={icon} className={clsx('size-5 text-rose', refreshing && 'animate-spin')} strokeWidth={2.5} />
    </div>
  );
}

interface Props {
  /** Resolves when fresh data has arrived. */
  onRefresh: () => Promise<unknown>;
  /** Classes of the scrolling area (it keeps its own padding and flex sizing). */
  className?: string;
  style?: CSSProperties;
  onScroll?: (e: UIEvent<HTMLDivElement>) => void;
  disabled?: boolean;
  children: ReactNode;
}

/**
 * A scrolling area with Android-style pull to refresh: pulled down from the very top, a circle
 * slides in over the content and turns with the finger; let go past the mark and it spins until
 * `onRefresh` is done. The forwarded ref is the scrolling element.
 */
export const PullRefresh = forwardRef<HTMLDivElement, Props>(function PullRefresh({ onRefresh, className, style, onScroll, disabled, children }, ref) {
  const scroller = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => scroller.current!, []);
  const pull = usePullRefresh(scroller, onRefresh, { disabled });

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <PullCircle {...pull} />
      <div ref={scroller} className={className} style={style} onScroll={onScroll}>
        {children}
      </div>
    </div>
  );
});
