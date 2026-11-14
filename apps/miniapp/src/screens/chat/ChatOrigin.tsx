import { ChevronLeft } from 'lucide-react';
import type { ChatOrigin } from '@/api/types';
import { fullDate } from '@/lib/format';
import { nav } from '@/store/nav';
import { useCategory } from '../wall/PostCard';

/** What started this conversation, in a sentence, from my side of it. */
function describe(origin: ChatOrigin, meId: string, name: string): { emoji: string; title: string; sub: string } {
  switch (origin.kind) {
    case 'superlike':
      return origin.by === meId
        ? { emoji: '⭐', title: `با سوپرلایک تو شروع شد`, sub: `${name} هم پسندیدت و مچ شدید` }
        : { emoji: '⭐', title: `${name} بهت سوپرلایک داد`, sub: 'تو هم پسندیدی و مچ شدید' };
    case 'like':
      if (!origin.by) return { emoji: '❤️', title: 'همدیگه رو لایک کردید', sub: 'از صفحه‌ی کشف مچ شدید' };
      return origin.by === meId
        ? { emoji: '❤️', title: `تو اول ${name} رو لایک کردی`, sub: 'اونم پسندیدت و مچ شدید' }
        : { emoji: '❤️', title: `${name} اول لایکت کرد`, sub: 'تو هم پسندیدی و مچ شدید' };
    // legacy: the random chat is gone, but old conversations keep where they began
    case 'random':
      return { emoji: '🎲', title: 'از چت تصادفی', sub: 'هر دو همدیگه رو پسندیدید و گفتگو موند' };
    case 'wall':
      if (!origin.author) return { emoji: '📣', title: 'از دیوار', sub: 'این گفتگو از یه درخواست روی دیوار شروع شد' };
      return origin.author === meId
        ? { emoji: '📣', title: `${name} به درخواستت روی دیوار پیام داد`, sub: 'و تو قبولش کردی' }
        : { emoji: '📣', title: `به درخواست ${name} روی دیوار پیام دادی`, sub: 'و قبولش کرد' };
  }
}

/**
 * Sits above the very first message: how these two met (a like, a super like or a Wall post —
 * with the post itself) and when.
 */
export function ChatOriginCard({ origin, meId, name, since }: { origin: ChatOrigin; meId: string; name: string; since: string }) {
  const d = describe(origin, meId, name);
  const wall = origin.kind === 'wall' ? origin : null;
  const category = useCategory(wall?.category ?? '');
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
            {category ? (
              <span className="mb-0.5 block text-[11.5px] text-faint">
                {category.emoji} {category.label}
              </span>
            ) : null}
            <span className="line-clamp-3 block text-[13px] leading-6">«{wall.text}»</span>
          </span>
          {wall.postId ? <ChevronLeft className="mt-1 size-4 shrink-0 text-faint" /> : null}
        </button>
      ) : null}
      <div className="mt-2.5 text-[11.5px] text-faint">{fullDate(since)}</div>
    </div>
  );
}
