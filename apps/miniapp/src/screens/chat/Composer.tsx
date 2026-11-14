import clsx from 'clsx';
import { ImagePlus, Keyboard, Send, Smile, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import type { Message } from '@/api/types';
import { fa } from '@/lib/format';
import { useBackHandler } from '@/store/nav';
import { haptic } from '@/telegram/tg';
import { Spinner } from '@/ui/kit';

/** The counter (COUNTER_FROM) only appears when the limit is close enough to matter. */
const DEFAULT_MAX = 2000;

/** Drafts survive leaving a chat and coming back within the session. */
const drafts = new Map<string, string>();

/** Fast picker: the emojis a chat actually uses, no 1500-emoji sheet to scroll. */
const EMOJI = [
  '😂', '🥹', '😍', '😘', '😊', '🙂', '😉', '😎',
  '🤩', '🥰', '😅', '🤔', '🙃', '😴', '🥺', '😢',
  '😭', '😡', '🤯', '🤭', '🙄', '😬', '🤝', '👋',
  '👍', '👌', '🙏', '💪', '🔥', '✨', '💯', '🎉',
  '❤️', '💜', '💔', '💌', '☕', '🌙', '🌸', '🎵',
];

export interface ComposerProps {
  /** Whose draft this is (a match id). */
  matchId: string;
  /** The message being replied to, if any. */
  replyTo?: Message | null;
  replyName?: string;
  onCancelReply?: () => void;
  onSend: (text: string, replyTo: string | null) => void;
  /** Without it there's no photo button. */
  onPhoto?: () => void;
  uploading?: boolean;
  onTyping?: (value: string) => void;
  /** Longest message (the server's limit for this kind of chat). */
  max?: number;
  /** The send button's colour. */
  tone?: 'flame' | 'royal';
}

/**
 * The message box: a growing text field with an emoji picker, a photo button, the reply being
 * answered, a counter near the limit, and a draft that survives leaving the chat.
 */
export function Composer({
  matchId,
  replyTo = null,
  replyName = '',
  onCancelReply,
  onSend,
  onPhoto,
  uploading = false,
  onTyping,
  max: MAX = DEFAULT_MAX,
  tone = 'flame',
}: ComposerProps) {
  const COUNTER_FROM = MAX - 200;
  const [text, setText] = useState(() => drafts.get(matchId) ?? '');
  const [emoji, setEmoji] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  // the picker closes with Back, its own ✕, the keyboard button, or by tapping into the text
  useBackHandler(emoji, () => setEmoji(false));
  const closeEmoji = (focus: boolean) => {
    haptic.select();
    setEmoji(false);
    if (focus) input.current?.focus();
  };

  // keep the draft for this chat, and drop it once the message is on its way
  useEffect(() => {
    if (text) drafts.set(matchId, text);
    else drafts.delete(matchId);
  }, [matchId, text]);

  // answering someone: the box opens focused, ready to type
  useEffect(() => {
    if (replyTo) input.current?.focus();
  }, [replyTo]);

  const grow = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 132) + 'px';
  };

  const change = (value: string) => {
    const v = value.slice(0, MAX);
    setText(v);
    onTyping?.(v);
    grow(input.current);
  };

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t, replyTo?.id ?? null);
    setText('');
    drafts.delete(matchId);
    setEmoji(false);
    requestAnimationFrame(() => {
      if (input.current) input.current.style.height = 'auto';
    });
  };

  /** Inserts an emoji where the cursor is, not blindly at the end. */
  const insert = (e: string) => {
    haptic.select();
    const el = input.current;
    const at = el?.selectionStart ?? text.length;
    const next = (text.slice(0, at) + e + text.slice(el?.selectionEnd ?? at)).slice(0, MAX);
    setText(next);
    onTyping?.(next);
    requestAnimationFrame(() => {
      grow(el);
      // on a phone, focusing would bring the keyboard up over the picker
      if (!('ontouchstart' in window)) el?.focus();
      const pos = at + e.length;
      el?.setSelectionRange(pos, pos);
    });
  };

  const left = MAX - text.length;
  const canSend = !!text.trim();

  return (
    <div className="shrink-0 border-t border-line pb-safe glass">
      {/* the message being answered */}
      <AnimatePresence initial={false}>
        {replyTo ? (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mx-3 mt-2 flex items-center gap-2.5 rounded-2xl border-r-[3px] border-rose bg-surface-2 py-2 pr-3 pl-2">
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-bold text-rose">پاسخ به {replyName}</span>
                <span className="block truncate text-[12.5px] text-muted">
                  {replyTo.kind === 'image' ? '📷 عکس' : replyTo.deleted ? 'پیام حذف‌شده' : replyTo.body}
                </span>
              </span>
              <button aria-label="لغو پاسخ" onClick={() => onCancelReply?.()} className="grid size-8 shrink-0 place-items-center rounded-full text-muted active:bg-white/10">
                <X className="size-4" />
              </button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="flex items-end gap-1.5 px-3 pt-2.5">
        {onPhoto ? (
          <button
            aria-label="ارسال عکس"
            disabled={uploading}
            onClick={onPhoto}
            className="mb-2.5 grid size-11 shrink-0 place-items-center rounded-full text-muted active:bg-white/10 disabled:opacity-50"
          >
            {uploading ? <Spinner className="size-5" /> : <ImagePlus className="size-6" />}
          </button>
        ) : null}

        <div className="relative mb-2.5 min-w-0 flex-1">
          <textarea
            ref={input}
            value={text}
            rows={1}
            onChange={(e) => change(e.target.value)}
            onPointerDown={() => emoji && setEmoji(false)}
            onKeyDown={(e) => {
              // a hardware keyboard sends with Enter; Shift+Enter still starts a new line
              if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="پیام…"
            className={clsx(
              'block max-h-[132px] min-h-11 w-full resize-none rounded-card border border-line bg-surface-2 py-[9px] pr-4 text-[15px] leading-6 outline-none',
              tone === 'royal' ? 'focus:border-violet/60' : 'focus:border-rose/50',
              'pl-11',
            )}
          />
          <button
            onPointerDown={(e) => e.preventDefault()}
            aria-label={emoji ? 'بستن ایموجی‌ها' : 'ایموجی'}
            onClick={() => {
              if (emoji) return closeEmoji(true);
              haptic.select();
              // the keyboard would cover the picker
              input.current?.blur();
              setEmoji(true);
            }}
            className={clsx(
              // centred on the first (bottom) line: (44 − 32) / 2 = 6px from the bottom, also when the box grows
              'absolute bottom-1.5 left-1.5 grid size-8 place-items-center rounded-full transition-colors',
              emoji ? (tone === 'royal' ? 'bg-violet/15 text-violet' : 'bg-rose/15 text-rose') : 'text-faint active:bg-white/10',
            )}
          >
            {emoji ? <Keyboard className="size-5" /> : <Smile className="size-5" />}
          </button>
          {text.length >= COUNTER_FROM ? (
            <span className={clsx('absolute -top-5 left-1 text-[11px] tabular', left <= 0 ? 'text-danger' : 'text-faint')}>{fa(left)}</span>
          ) : null}
        </div>

        <motion.button
          aria-label="ارسال"
          whileTap={{ scale: 0.85 }}
          onPointerDown={(e) => e.preventDefault() /* keep the keyboard open */}
          onClick={submit}
          disabled={!canSend}
          className={clsx('mb-2.5 grid size-11 shrink-0 place-items-center rounded-full transition-colors', canSend ? (tone === 'royal' ? 'bg-royal text-white' : 'bg-flame-d text-white') : 'bg-surface-2 text-faint')}
        >
          <Send className="size-5 -scale-x-100" />
        </motion.button>
      </div>

      <AnimatePresence initial={false}>
        {emoji ? (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="flex items-center justify-between px-4 pt-1">
              <span className="text-[12px] font-semibold text-faint">ایموجی</span>
              <button
                aria-label="بستن ایموجی‌ها"
                onPointerDown={(ev) => ev.preventDefault()}
                onClick={() => closeEmoji(false)}
                className="grid size-8 place-items-center rounded-full text-muted active:bg-white/10"
              >
                <X className="size-[18px]" />
              </button>
            </div>
            <div className="grid grid-cols-8 gap-1 px-3 pt-0.5 pb-2">
              {EMOJI.map((e) => (
                <button
                  key={e}
                  onPointerDown={(ev) => ev.preventDefault()}
                  onClick={() => insert(e)}
                  className="grid h-10 place-items-center rounded-xl text-[23px] leading-none active:bg-white/10"
                >
                  {e}
                </button>
              ))}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
