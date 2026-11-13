'use client';

import { Heart, Megaphone, MessageCircle, Send, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Button, Card, Empty, ErrorBox, PageHeader, Pagination, Spinner, StatusBadge, Tabs } from '@/components/ui';
import { api, qs, useApi } from '@/lib/api';
import { fmtAgo, fmtNum, GENDER_LABEL } from '@/lib/format';

interface Row {
  id: string;
  text: string;
  category: string;
  lookingFor: string;
  status: string;
  likeCount: number;
  chatCount: number;
  reportCount: number;
  inGroup: boolean;
  city: string | null;
  createdAt: string;
  expiresAt: string;
  removedReason: string | null;
  user: { id: string; name: string | null; gender: string | null; age: number | null; telegramUsername: string | null; photo: string | null };
}

type Status = '' | 'active' | 'reported' | 'removed' | 'expired' | 'deleted';

const LOOKING_FOR: Record<string, string> = { male: 'آقا', female: 'خانم', everyone: 'همه' };

/** Wall moderation: everything is published at once; moderators take requests down afterwards. */
export default function WallPage() {
  const [status, setStatus] = useState<Status>('active');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const { data, isLoading, mutate } = useApi<{ items: Row[]; total: number; page: number; pageSize: number }>(
    `admin/v1/wall${qs({ status, page })}`,
    { keepPreviousData: true },
  );

  async function remove(id: string) {
    const reason = prompt('دلیل برداشتن (به کاربر گفته می‌شود):', 'مغایر با قوانین دیوار');
    if (!reason) return;
    setBusy(id);
    setError(null);
    try {
      await api.post(`admin/v1/wall/${id}/remove`, { reason });
      await mutate();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader title="دیوار" subtitle="درخواست‌های دوستیابی؛ بلافاصله منتشر می‌شوند و اینجا می‌شود برشان داشت (از گروه تلگرام هم حذف می‌شوند)." />
      <div className="mb-4">
        <Tabs
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          items={[
            { value: 'active', label: 'فعال' },
            { value: 'reported', label: 'گزارش‌شده' },
            { value: 'removed', label: 'برداشته‌شده' },
            { value: 'expired', label: 'منقضی' },
            { value: 'deleted', label: 'حذف‌شده توسط کاربر' },
            { value: '', label: 'همه' },
          ]}
        />
      </div>
      <ErrorBox error={error} />
      {isLoading && !data ? (
        <Spinner />
      ) : !data?.items.length ? (
        <Card>
          <Empty icon={<Megaphone className="size-6" />} title="درخواستی نیست" />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.items.map((r) => (
            <Card key={r.id}>
              <div className="flex items-start gap-3">
                {r.user.photo ? (
                  <img src={r.user.photo} alt="" className="size-12 shrink-0 rounded-full object-cover ring-1 ring-line" />
                ) : (
                  <div className="grid size-12 shrink-0 place-items-center rounded-full bg-surface-2 text-muted">{r.user.name?.[0] ?? '؟'}</div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/users/${r.user.id}`} className="font-semibold hover:underline">
                      {r.user.name ?? 'کاربر'}
                      {r.user.age ? `، ${fmtNum(r.user.age)}` : ''}
                    </Link>
                    {r.user.gender ? <span className="text-xs text-muted">{GENDER_LABEL[r.user.gender]}</span> : null}
                    {r.user.telegramUsername ? (
                      <span className="text-xs text-faint" dir="ltr">
                        @{r.user.telegramUsername}
                      </span>
                    ) : null}
                    <StatusBadge status={r.status} />
                    {r.reportCount > 0 ? <Badge tone="danger">{fmtNum(r.reportCount)} گزارش</Badge> : null}
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    {r.category} · دنبال {LOOKING_FOR[r.lookingFor]} {r.city ? `· ${r.city}` : ''} · {fmtAgo(r.createdAt)}
                  </div>
                </div>
              </div>
              <p className="mt-3 whitespace-pre-wrap rounded-xl bg-surface-2 p-3 text-sm leading-7">{r.text}</p>
              {r.removedReason ? <p className="mt-2 text-xs text-danger">دلیل برداشتن: {r.removedReason}</p> : null}
              <div className="mt-3 flex items-center gap-4 text-sm text-muted">
                <span className="flex items-center gap-1">
                  <Heart className="size-4" /> {fmtNum(r.likeCount)}
                </span>
                <span className="flex items-center gap-1">
                  <MessageCircle className="size-4" /> {fmtNum(r.chatCount)}
                </span>
                {r.inGroup ? (
                  <span className="flex items-center gap-1 text-sky-400">
                    <Send className="size-4" /> در گروه
                  </span>
                ) : null}
                <span className="flex-1" />
                {r.status === 'active' || r.status === 'expired' ? (
                  <Button size="sm" variant="danger" loading={busy === r.id} onClick={() => remove(r.id)}>
                    <Trash2 className="size-3.5" /> برداشتن
                  </Button>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}
      {data ? (
        <div className="mt-4">
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </div>
      ) : null}
    </>
  );
}
