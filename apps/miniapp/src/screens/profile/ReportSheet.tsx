import clsx from 'clsx';
import { useState } from 'react';
import { api, errorMessage } from '@/api/client';
import { keys, queryClient, useMeta } from '@/api/queries';
import { toast } from '@/store/ui';
import { haptic } from '@/telegram/tg';
import { Button } from '@/ui/kit';
import { Sheet } from '@/ui/Sheet';

/** Report = block + a case for moderators (with the last messages of the chat, if there is one). */
export function ReportSheet({
  open,
  onClose,
  userId,
  name,
  matchId,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  name: string;
  matchId?: string;
  onDone?: () => void;
}) {
  const meta = useMeta();
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [sending, setSending] = useState(false);

  const submit = async () => {
    if (!reason) return;
    setSending(true);
    try {
      await api.post('/v1/reports', { userId, reason, details: details.trim() || undefined, matchId });
      haptic.success();
      toast('گزارشت ثبت شد و این کاربر مسدود شد. ممنون که کمک می‌کنی Vibe امن بمونه 💜', '🛡️', 'success');
      void queryClient.invalidateQueries({ queryKey: keys.conversations });
      onClose();
      onDone?.();
    } catch (e) {
      toast(errorMessage(e), '⚠️', 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={`گزارش ${name}`}>
      <p className="-mt-1 mb-4 text-[13px] text-muted">گزارش‌ها محرمانه‌اند؛ {name} نمی‌فهمه چه کسی گزارش داده.</p>
      <div className="space-y-2">
        {meta.data?.reportReasons.map((r) => (
          <button
            key={r.id}
            onClick={() => {
              haptic.select();
              setReason(r.id);
            }}
            className={clsx(
              'flex w-full items-center justify-between rounded-2xl px-4 py-3.5 text-right text-[14.5px] transition-colors',
              reason === r.id ? 'border-2 border-danger bg-danger/10' : 'border border-line bg-surface-2',
            )}
          >
            {r.label}
            <span className={clsx('size-5 rounded-full', reason === r.id ? 'border-[6px] border-danger' : 'border-2 border-faint')} />
          </button>
        ))}
      </div>
      <textarea
        value={details}
        onChange={(e) => setDetails(e.target.value.slice(0, 1000))}
        placeholder="توضیح بیشتر (اختیاری)"
        rows={3}
        className="mt-4 w-full resize-none rounded-2xl border border-line bg-surface-2 px-4 py-3 text-[14.5px] outline-none focus:border-danger/60"
      />
      <Button variant="danger" className="mt-4 w-full" disabled={!reason} loading={sending} onClick={submit}>
        ثبت گزارش و مسدود کردن
      </Button>
    </Sheet>
  );
}
