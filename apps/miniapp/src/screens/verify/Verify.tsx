import { ShieldCheck } from 'lucide-react';
import { useMe } from '@/api/queries';
import { EmptyState, ScreenHeader } from '@/ui/kit';

/**
 * «تأیید حساب». An unverified account may write only a few messages per conversation, and this is
 * where it is put right.
 *
 * The screen is deliberately empty: how verification happens is not decided yet. When it is, what
 * goes here is the flow itself — everything around it (the gate on the server, the notice in the
 * chat, the way here) already works.
 */
export default function Verify() {
  const me = useMe().data;

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="تأیید حساب" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {me?.verified ? (
          <EmptyState emoji="✅" title="حسابت تأیید شده" subtitle="می‌تونی بدون محدودیت گفتگو کنی." />
        ) : (
          <EmptyState
            emoji="🪪"
            title="تأیید حساب"
            subtitle="این بخش به‌زودی فعال می‌شه. تا اون موقع می‌تونی در هر گفتگو چند پیام بفرستی."
            action={
              <div className="flex items-center justify-center gap-2 rounded-card border border-line bg-surface-1 px-4 py-3 text-[13px] text-muted">
                <ShieldCheck className="size-4 text-violet" />
                در حال آماده‌سازی
              </div>
            }
          />
        )}
      </div>
    </div>
  );
}
