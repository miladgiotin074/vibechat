import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBackHandler } from '@/store/nav';
import { haptic } from '@/telegram/tg';

export interface SpotlightStep {
  /** Matches an element's data-tour attribute. */
  target: string;
  title: string;
  text: ReactNode;
  emoji?: string;
  /** Space around the element inside the lit area. */
  padding?: number;
  shape?: 'circle' | 'rounded';
  radius?: number;
  /** A small animation inside the lit area (the swipe gesture on the card). */
  demo?: 'swipe';
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const TOOLTIP_SPACE = 200;
const find = (target: string) => document.querySelector<HTMLElement>(`[data-tour="${target}"]`);

/**
 * Spotlight tutorial: everything is dimmed except the element being explained, which sits in a
 * glowing cut-out; a card next to it says what it does. The cut-out glides from step to step.
 * Tapping anywhere or «بعدی» moves on; Telegram's Back button goes back a step (or ends it on the first).
 */
export function Spotlight({ steps, open, onClose }: { steps: SpotlightStep[]; open: boolean; onClose: (completed: boolean) => void }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight });

  // only steps whose element is on screen right now (e.g. no card when the deck is empty)
  const available = useMemo(() => (open ? steps.filter((s) => find(s.target)) : []), [open, steps]);
  const step = available[index];
  const last = index === available.length - 1;

  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  const measure = useCallback(() => {
    setViewport({ w: window.innerWidth, h: window.innerHeight });
    const el = step && find(step.target);
    if (!el) return setRect(null);
    const r = el.getBoundingClientRect();
    setRect({ x: r.left, y: r.top, w: r.width, h: r.height });
  }, [step]);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    const t = setTimeout(measure, 250); // after any layout animation settles
    window.addEventListener('resize', measure);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', measure);
    };
  }, [open, measure]);

  const close = useCallback((completed: boolean) => onClose(completed), [onClose]);
  const next = () => {
    haptic.select();
    if (last) {
      haptic.success();
      close(true);
    } else setIndex((i) => i + 1);
  };
  const prev = () => {
    haptic.select();
    setIndex((i) => Math.max(0, i - 1));
  };

  useBackHandler(open, () => (index > 0 ? prev() : close(false)));

  useEffect(() => {
    if (open && available.length === 0) close(false);
  }, [open, available.length, close]);

  // the lit area
  let hole: Rect & { r: number } = { x: viewport.w / 2, y: viewport.h / 2, w: 0, h: 0, r: 0 };
  if (rect && step) {
    const pad = step.padding ?? 8;
    if (step.shape === 'circle') {
      const size = Math.max(rect.w, rect.h) + pad * 2;
      hole = { x: rect.x + rect.w / 2 - size / 2, y: rect.y + rect.h / 2 - size / 2, w: size, h: size, r: size / 2 };
    } else {
      hole = { x: rect.x - pad, y: rect.y - pad, w: rect.w + pad * 2, h: rect.h + pad * 2, r: step.radius ?? 22 };
    }
  }

  // the card goes below the element, else above it, else inside its lower part (big elements)
  const below = viewport.h - (hole.y + hole.h);
  const above = hole.y;
  const tipWidth = Math.min(viewport.w - 32, 400);
  const tipLeft = (viewport.w - tipWidth) / 2;
  const arrowX = Math.min(Math.max(hole.x + hole.w / 2 - tipLeft, 28), tipWidth - 28);
  const placement: 'below' | 'above' | 'inside' = below >= TOOLTIP_SPACE ? 'below' : above >= TOOLTIP_SPACE ? 'above' : 'inside';
  const tipStyle =
    placement === 'below'
      ? { top: hole.y + hole.h + 16 }
      : placement === 'above'
        ? { bottom: viewport.h - hole.y + 16 }
        : { bottom: viewport.h - (hole.y + hole.h) + 18 };

  return createPortal(
    <AnimatePresence>
      {open && step ? (
        <motion.div
          className="fixed inset-0 z-[65] select-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          {/* taps anywhere move on; nothing underneath can be touched during the tour */}
          <div className="absolute inset-0" onClick={next} />

          <motion.div
            className="pointer-events-none absolute"
            initial={false}
            animate={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h, borderRadius: hole.r }}
            transition={{ type: 'spring', stiffness: 260, damping: 30 }}
            style={{ boxShadow: '0 0 0 200vmax rgba(8, 5, 12, 0.8)' }}
          >
            <span className="absolute inset-0 rounded-[inherit] ring-2 ring-white/80 shadow-[0_0_30px_rgba(255,45,111,0.55)]" />
            <span className="absolute -inset-2 rounded-[inherit] border-2 border-rose/60 animate-ping-slow" />
          </motion.div>

          {step.demo === 'swipe' && rect ? <SwipeDemo hole={hole} /> : null}

          <motion.div
            key={step.target}
            className="absolute"
            style={{ ...tipStyle, left: tipLeft, width: tipWidth }}
            initial={{ opacity: 0, y: placement === 'below' ? -10 : 10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 340, damping: 28, delay: 0.08 }}
          >
            {placement !== 'inside' ? (
              <span
                className={clsx('absolute size-4 rotate-45 border-line bg-surface-1', placement === 'below' ? '-top-2 border-t border-l' : '-bottom-2 border-r border-b')}
                style={{ left: arrowX - 8 }}
              />
            ) : null}
            <div className="relative rounded-card border border-line bg-surface-1 p-4 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.9)]">
              <div className="flex items-start gap-3">
                {step.emoji ? <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-surface-2 text-[24px]">{step.emoji}</span> : null}
                <div className="min-w-0 flex-1">
                  <h3 className="text-[16.5px] font-extrabold">{step.title}</h3>
                  <p className="mt-1 text-[13.5px] leading-6 text-muted">{step.text}</p>
                </div>
              </div>
              <div className="mt-4 flex justify-end">
                <motion.button
                  whileTap={{ scale: 0.94 }}
                  onClick={next}
                  className="h-10 shrink-0 whitespace-nowrap rounded-2xl bg-flame px-4 text-[13.5px] font-bold text-white shadow-[0_8px_20px_-8px_rgba(255,45,111,0.8)]"
                >
                  {last ? 'بزن بریم 🔥' : 'بعدی'}
                </motion.button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

/** A hand drawing the swipe on the card: right = like, left = pass. */
function SwipeDemo({ hole }: { hole: Rect }) {
  const cy = hole.y + hole.h * 0.36;
  return (
    <div className="pointer-events-none absolute" style={{ left: hole.x, top: cy, width: hole.w }} dir="ltr">
      <motion.span
        className="absolute left-5 top-0 rounded-2xl border-2 border-danger/80 bg-black/50 px-3 py-1 text-[15px] font-black text-danger"
        animate={{ opacity: [0.25, 0.25, 1, 0.25, 0.25] }}
        transition={{ duration: 3.2, repeat: Infinity, times: [0, 0.5, 0.7, 0.9, 1] }}
      >
        ✕ نه
      </motion.span>
      <motion.span
        className="absolute right-5 top-0 rounded-2xl border-2 border-mint/80 bg-black/50 px-3 py-1 text-[15px] font-black text-mint"
        animate={{ opacity: [0.25, 1, 0.25, 0.25, 0.25] }}
        transition={{ duration: 3.2, repeat: Infinity, times: [0, 0.2, 0.4, 0.5, 1] }}
      >
        لایک ❤
      </motion.span>
      <motion.span
        className="absolute top-14 text-[46px] drop-shadow-[0_6px_14px_rgba(0,0,0,0.6)]"
        style={{ left: hole.w / 2 - 23 }}
        animate={{ x: [0, 80, 0, -80, 0], rotate: [0, 12, 0, -12, 0] }}
        transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
      >
        👆
      </motion.span>
    </div>
  );
}
