import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { keys, useMe } from '@/api/queries';
import { TgVerifyLogin } from '@/verify-tg/components/login/LoginApp';
import '@/verify-tg/login.css';
import { EmptyState } from '@/ui/kit';

/**
 * «تأیید حساب». The screen is the Telegram phone login itself — no app chrome around it.
 * A successful login whose telegram id matches this account sets `users.verified`.
 */
export default function Verify() {
  const meQ = useMe();
  const me = meQ.data;
  const qc = useQueryClient();
  const cfg = useQuery({
    queryKey: ['verification', 'telegram'],
    queryFn: () => api.get<{ enabled: boolean }>('/v1/verification/telegram'),
    staleTime: 60_000,
  });

  const onVerified = () => {
    void qc.invalidateQueries({ queryKey: keys.me });
    void meQ.refetch();
  };

  if (me && !me.verified && cfg.data?.enabled) {
    return (
      <div className="h-full min-h-0">
        <TgVerifyLogin onSuccess={onVerified} dark />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {me?.verified ? (
          <EmptyState emoji="✅" title="حسابت تأیید شده" subtitle="می‌تونی بدون محدودیت گفتگو کنی." />
        ) : cfg.isLoading || !me ? (
          <div className="flex h-full items-center justify-center">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-white" />
          </div>
        ) : (
          <EmptyState
            emoji="⚙️"
            title="تأیید حساب"
            subtitle="سرویس تأیید هنوز روی سرور پیکربندی نشده. TELEGRAM_API_ID و TELEGRAM_API_HASH را در env سرور بگذار."
          />
        )}
      </div>
    </div>
  );
}
