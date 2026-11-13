import clsx from 'clsx';
import { AnimatePresence, motion, type PanInfo } from 'motion/react';
import { type ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useBackHandler } from '@/store/nav';

/**
 * Bottom sheet: slides up over a dimmed backdrop, closes by tapping outside, dragging down, or
 * Telegram's Back button (registered as a back handler while open).
 */
export function Sheet({
  open,
  onClose,
  children,
  title,
  className,
  full,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: ReactNode;
  className?: string;
  /** Tall sheet (lists with search). */
  full?: boolean;
}) {
  useBackHandler(open, onClose);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            className={clsx(
              'relative flex max-h-[88%] flex-col rounded-t-[30px] border-t border-line bg-surface-1 pb-safe',
              full && 'h-[88%]',
              className,
            )}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            dragListener={!full}
            onDragEnd={(_e, info: PanInfo) => {
              if (info.offset.y > 120 || info.velocity.y > 600) onClose();
            }}
          >
            <div className="flex justify-center pt-3 pb-1">
              <span className="h-1.5 w-11 rounded-full bg-white/15" />
            </div>
            {title ? <h2 className="px-5 pt-2 pb-3 text-[18px] font-bold">{title}</h2> : null}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">{children}</div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
