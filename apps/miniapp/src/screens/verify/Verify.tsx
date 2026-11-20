import { ShieldCheck } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import { keys, useMe } from '@/api/queries';
import { api } from '@/api/client';
import { TgVerifyLogin } from '@/verify-tg/components/login/LoginApp';
import '@/verify-tg/login.css';
import { EmptyState, ScreenHeader } from '@/ui/kit';

/**
 * «تأیید حساب». An unverified account may write only a few messages per conversation, and this is
 * where it is put right — by proving the Telegram phone login belongs to the same `telegram_id`
 * as the Mini App session (MTProto flow from UnofficialTelegramMiniApp).
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

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="تأیید حساب" />
      <div className="min-h-0 flex-1 overflow-hidden">
        {me?.verified ? (
          <div className="no-scrollbar h-full overflow-y-auto">
            <EmptyState emoji="✅" title="حسابت تأیید شده" subtitle="می‌تونی بدون محدودیت گفتگو کنی." />
          </div>
        ) : cfg.isLoading ? (
          <div className="flex h-full items-center justify-center">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-violet" />
          </div>
        ) : !cfg.data?.enabled ? (
          <div className="no-scrollbar h-full overflow-y-auto">
            <EmptyState
              emoji="⚙️"
              title="تأیید حساب"
              subtitle="سرویس تأیید هنوز روی سرور پیکربندی نشده. TELEGRAM_API_ID و TELEGRAM_API_HASH را در my.telegram.org بساز و در env سرور بگذار."
            />
          </div>
        ) : (
          <div className="flex h-full flex-col">
            <p className="shrink-0 border-b border-line bg-surface-1 px-4 py-3 text-center text-[13px] leading-6 text-muted">
              <ShieldCheck className="mb-1 inline size-4 text-violet" />
              <br />
              با ورود به تلگرام (همان شماره‌ای که با آن این مینی‌اپ را باز کردی) حسابت تأیید می‌شود.
            </p>
            <div className="min-h-0 flex-1">
              <TgVerifyLogin onSuccess={onVerified} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}