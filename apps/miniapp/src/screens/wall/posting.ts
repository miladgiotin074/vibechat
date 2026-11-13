import type { MyWall } from '@/api/types';
import { fa } from '@/lib/format';
import { nav, useNav } from '@/store/nav';
import { toast } from '@/store/ui';
import { haptic } from '@/telegram/tg';
import { isLive } from './PostCard';

/** «۳ ساعت» / «۲۰ دقیقه» until a time. */
export function waitText(iso: string): string {
  const minutes = Math.max(1, Math.ceil((new Date(iso).getTime() - Date.now()) / 60_000));
  return minutes >= 60 ? `${fa(Math.ceil(minutes / 60))} ساعت` : `${fa(minutes)} دقیقه`;
}

/** Why a new request can't be posted right now: too many live ones, or the pause after the last. */
export function postingBlock(mine: MyWall | undefined): { kind: 'active' | 'pause'; text: string } | null {
  if (!mine || mine.canPost !== false) return null;
  const live = mine.items.filter(isLive).length;
  if (live >= (mine.activeLimit ?? 1)) {
    return { kind: 'active', text: live > 1 ? 'به سقف درخواست‌های فعالت رسیدی؛ یکی رو ویرایش یا حذف کن' : 'یه درخواست فعال داری؛ می‌تونی ویرایشش کنی' };
  }
  if (mine.nextPostAt) return { kind: 'pause', text: `درخواست بعدی‌ت رو ${waitText(mine.nextPostAt)} دیگه می‌تونی بذاری` };
  return null;
}

/**
 * «ثبت درخواست»: opens the composer — or, when a new request isn't possible yet, says why and
 * points at the request the user already has (editing it is the way to change it).
 */
export function startCompose(mine: MyWall | undefined) {
  haptic.light();
  const block = postingBlock(mine);
  if (!block) return nav.push({ name: 'wallCompose' });
  if (block.kind === 'active') {
    toast(`${block.text} ✏️`, '📌');
    const stack = useNav.getState().stack;
    if (stack[stack.length - 1]?.name !== 'wallMine') nav.push({ name: 'wallMine' });
  } else {
    toast(block.text, '⏳');
  }
}
