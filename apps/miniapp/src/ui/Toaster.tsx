import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { useUi } from '@/store/ui';

export function Toaster() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-4 pt-3">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            layout
            initial={{ y: -40, opacity: 0, scale: 0.95 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -30, opacity: 0, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            onClick={() => {
              t.onClick?.();
              dismiss(t.id);
            }}
            className={clsx(
              'pointer-events-auto flex max-w-sm items-center gap-2.5 rounded-2xl border px-4 py-3 text-[14px] font-medium shadow-[0_16px_40px_-12px_rgba(0,0,0,0.7)] glass',
              t.tone === 'error' ? 'border-danger/40' : t.tone === 'success' ? 'border-mint/40' : 'border-line',
            )}
          >
            {t.emoji ? <span className="text-[18px]">{t.emoji}</span> : null}
            <span className="text-right leading-6">{t.text}</span>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
