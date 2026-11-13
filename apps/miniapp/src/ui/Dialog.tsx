import clsx from 'clsx';
import { AlertTriangle, HelpCircle } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { useBackHandler } from '@/store/nav';
import { haptic } from '@/telegram/tg';
import { Button } from '@/ui/kit';

/**
 * The app's own confirmation dialog, used everywhere instead of Telegram's popup or the browser's
 * confirm(): same colours, type and buttons as the rest of the UI, RTL, and closed by Back, a tap
 * outside or Escape (all of which mean «no»).
 *
 *   if (!(await confirmDialog('این عکس حذف شود؟', 'حذف', true))) return;
 */

interface Request {
  id: number;
  title?: string;
  message: string;
  ok: string;
  cancel: string;
  destructive: boolean;
  emoji?: string;
  resolve: (yes: boolean) => void;
}

const useDialog = create<{ current: Request | null }>(() => ({ current: null }));
let seq = 0;

export interface DialogOptions {
  /** shown in the circle on top instead of the default icon */
  emoji?: string;
  cancel?: string;
}

export function confirmDialog(message: string, ok = 'بله', destructive = false, title?: string, opts: DialogOptions = {}): Promise<boolean> {
  return new Promise((resolve) => {
    // a new question replaces one still open (which counts as «no»)
    useDialog.getState().current?.resolve(false);
    if (destructive) haptic.warning();
    useDialog.setState({
      current: { id: ++seq, title, message, ok, cancel: opts.cancel ?? 'انصراف', destructive, emoji: opts.emoji, resolve },
    });
  });
}

function answer(yes: boolean) {
  const r = useDialog.getState().current;
  if (!r) return;
  useDialog.setState({ current: null });
  r.resolve(yes);
}

/** Mounted once, next to the Toaster. */
export function DialogHost() {
  const r = useDialog((s) => s.current);
  useBackHandler(!!r, () => answer(false));
  useEffect(() => {
    if (!r) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') answer(false);
      if (e.key === 'Enter') answer(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [r]);

  return createPortal(
    <AnimatePresence>
      {r ? (
        <div key={r.id} className="fixed inset-0 z-[70] flex items-center justify-center px-6">
          <motion.div
            className="absolute inset-0 bg-black/65 backdrop-blur-[3px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => answer(false)}
          />
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-label={r.title ?? r.message}
            className="relative w-full max-w-[340px] rounded-[28px] border border-line bg-surface-1 px-5 pt-6 pb-5 text-center shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]"
            initial={{ opacity: 0, scale: 0.9, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 8 }}
            transition={{ type: 'spring', stiffness: 460, damping: 32 }}
          >
            <div
              className={clsx(
                'mx-auto grid size-14 place-items-center rounded-full',
                r.destructive ? 'bg-danger/15 text-danger' : 'bg-violet/15 text-violet',
                r.emoji && 'text-[28px]',
              )}
            >
              {r.emoji ?? (r.destructive ? <AlertTriangle className="size-7" /> : <HelpCircle className="size-7" />)}
            </div>
            {r.title ? <h2 className="mt-4 text-[17px] font-extrabold">{r.title}</h2> : null}
            <p className={clsx('text-[14.5px] leading-7', r.title ? 'mt-1.5 text-muted' : 'mt-4 font-semibold text-ink')}>{r.message}</p>
            <div className="mt-6 grid grid-cols-2 gap-2.5">
              <Button variant="soft" size="md" onClick={() => answer(false)}>
                {r.cancel}
              </Button>
              {r.destructive ? (
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  onClick={() => answer(true)}
                  className="h-12 rounded-[18px] bg-danger text-[14px] font-bold text-white shadow-[0_10px_24px_-10px_rgba(239,68,68,0.9)]"
                >
                  {r.ok}
                </motion.button>
              ) : (
                <Button size="md" onClick={() => answer(true)}>
                  {r.ok}
                </Button>
              )}
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
