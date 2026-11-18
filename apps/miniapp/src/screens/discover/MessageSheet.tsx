import { Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError, errorMessage } from '@/api/client';
import type { Card } from '@/api/types';
import { nav } from '@/store/nav';
import { toast } from '@/store/ui';
import { haptic } from '@/telegram/tg';
import { Avatar, Button } from '@/ui/kit';
import { Sheet } from '@/ui/Sheet';
import { useDeck } from './deck';

const OPENERS = ['سلام! 👋 چه پروفایل باحالی داری', 'سلام، حالت چطوره؟ 😊', 'سلام! از پروفایلت خوشم اومد', 'سلام 👋 اهل کجایی؟'];

/**
 * The first message. There is no liking and no waiting to be liked back: whatever is written here
 * opens the conversation and lands in the other person's chats.
 */
export function MessageSheet({ card, onClose }: { card: Card | null; onClose: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (card) setText('');
  }, [card]);

  const send = async () => {
    const body = text.trim();
    if (!card || !body || busy) return;
    setBusy(true);
    try {
      const r = await useDeck.getState().message(card, body);
      haptic.success();
      onClose();
      nav.push({ name: 'chat', matchId: r.matchId });
    } catch (e) {
      toast(errorMessage(e), '⚠️', 'error');
      if (e instanceof ApiError && e.code === 'chat_daily_limit') onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={!!card} onClose={onClose} title={card ? `پیام به ${card.name}` : ''}>
      {card ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Avatar src={card.photos[0]?.thumb} name={card.name} size={48} />
            <p className="text-[13px] leading-6 text-muted">یه پیام کوتاه بنویس؛ گفتگوتون همین‌جا باز می‌شه و توی «گفتگوها» ادامه می‌دید.</p>
          </div>

          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 1000))}
            placeholder="سلام! …"
            className="min-h-28 w-full rounded-card border border-line bg-surface-2 p-3 text-[15px] leading-7 outline-none focus:border-rose"
          />

          <div className="flex flex-wrap gap-2">
            {OPENERS.map((o) => (
              <button
                key={o}
                onClick={() => {
                  haptic.select();
                  setText(o);
                }}
                className="rounded-full border border-line bg-surface-2 px-3 py-1.5 text-[12.5px] text-muted active:scale-95"
              >
                {o}
              </button>
            ))}
          </div>

          <Button className="w-full" loading={busy} disabled={text.trim().length < 1} icon={<Send className="size-5" />} onClick={send}>
            فرستادن و شروع گفتگو
          </Button>
        </div>
      ) : null}
    </Sheet>
  );
}
