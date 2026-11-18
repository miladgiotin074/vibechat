import { ChevronLeft } from 'lucide-react';
import type { ChatOrigin } from '@/api/types';
import { fullDate } from '@/lib/format';
import { nav } from '@/store/nav';

/** What started this conversation, in a sentence, from my side of it. */
function describe(origin: ChatOrigin, meId: string, name: string): { emoji: string; title: string; sub: string } {
  switch (origin.kind) {
    case 'message':
      if (!origin.by) return { emoji: '💬', title: 'از صفحه‌ی کشف', sub: 'این گفتگو با یه پیام شروع شد' };
      return origin.by === meId
        ? { emoji: '💬', title: `تو به ${name} پیام دادی`, sub: 'و گفتگوتون شروع شد' }
        : { emoji: '💬', title: `${name} برات پیام فرستاد`, sub: 'و گفتگوتون شروع شد' };
    case 'wall':
      if (!origin.author) return { emoji: '📣', title: 'از دیوار', sub: 'این گفتگو از یه درخواست روی دیوار شروع شد' };
      return origin.author === meId
        ? { emoji: '📣', title: `${name} به درخواستت روی دیوار پیام داد`, sub: 'و گفتگوتون شروع شد' }
        : { emoji: '📣', title: `به درخواست ${name} روی دیوار پیام دادی`, sub: 'و گفتگوتون شروع شد' };
    // from before the app was simplified: old conversations still say where they began
    case 'superlike':
      return origin.by === meId
        ? { emoji: '⭐', title: 'با سوپرلایک تو شروع شد', sub: `${name} هم پسندیدت` }
        : { emoji: '⭐', title: `${name} بهت سوپرلایک داد`, sub: 'تو هم پسندیدی' };
    case 'like':
      if (!origin.by) return { emoji: '❤️', title: 'همدیگه رو لایک کردید', sub: 'از صفحه‌ی کشف با هم آشنا شدید' };
      return origin.by === meId
        ? { emoji: '❤️', title: `تو اول ${name} رو لایک کردی`, sub: 'اونم پسندیدت' }
        : { emoji: '❤️', title: `${name} اول لایکت کرد`, sub: 'تو هم پسندیدی' };
    case 'random':
      return { emoji: '🎲', title: 'از چت تصادفی', sub: 'هر دو همدیگه رو پسندیدید و گفتگو موند' };
  }
}

/**
 * Sits above the very first message: how this conversation began (a message from Discover, or a
 * Wall request — with the request itself) and when.
 */
export function ChatOriginCard({ origin, meId, name, since }: { origin: ChatOrigin; meId: string; name: string; since: string }) {
  const d = describe(origin, meId, name);
  const wall = origin.kind === 'wall' ? origin : null;
  return (
    <div className="mx-auto mt-2 mb-4 w-full max-w-[320px] rounded-card border border-line bg-surface-1/80 px-4 py-3.5 text-center">
      <div className="text-[26px] leading-none">{d.emoji}</div>
      <div className="mt-2 text-[14px] font-bold">{d.title}</div>
      <div className="mt-0.5 text-[12.5px] text-muted">{d.sub}</div>
      {wall?.text ? (
        <button
          disabled={!wall.postId}
          onClick={() => wall.postId && nav.push({ name: 'wallPost', postId: wall.postId })}
          className="mt-3 flex w-full items-start gap-2 rounded-2xl bg-surface-2 px-3 py-2.5 text-right"
        >
          <span className="min-w-0 flex-1">
            <span className="line-clamp-3 block text-[13px] leading-6">«{wall.text}»</span>
          </span>
          {wall.postId ? <ChevronLeft className="mt-1 size-4 shrink-0 text-faint" /> : null}
        </button>
      ) : null}
      <div className="mt-2.5 text-[11.5px] text-faint">{fullDate(since)}</div>
    </div>
  );
}
