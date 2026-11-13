'use client';

import clsx from 'clsx';
import { Flag, MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Badge, Button, Card, Empty, ErrorBox, Field, Modal, PageHeader, Pagination, Spinner, StatusBadge, Tabs } from '@/components/ui';
import { api, qs, useApi } from '@/lib/api';
import { fmtAgo, fmtDateTime, fmtNum, REPORT_ACTION_LABEL } from '@/lib/format';

interface Row {
  id: string;
  reason: string;
  details: string | null;
  status: string;
  action: string | null;
  created_at: string;
  has_chat: boolean;
  reporter_id: string;
  reporter_name: string | null;
  reported_id: string;
  reported_name: string | null;
  reported_status: string;
  reported_total: number;
}

interface Detail extends Row {
  resolution_note: string | null;
  context: { messages: { id: string; senderId: string; kind: string; body: string | null; media: { thumb: string } | null; createdAt: string }[] } | null;
}

interface Meta {
  reportReasons: { id: string; label: string }[];
}

export default function ReportsPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Reports />
    </Suspense>
  );
}

function Reports() {
  const params = useSearchParams();
  const [status, setStatus] = useState<'open' | 'resolved' | 'dismissed'>('open');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, mutate, isLoading } = useApi<{ items: Row[]; total: number; page: number; pageSize: number }>(
    `admin/v1/reports${qs({ status, page })}`,
  );
  const { data: meta } = useApi<Meta>('v1/meta');
  const reason = (r: string) => meta?.reportReasons.find((x) => x.id === r)?.label ?? r;

  useEffect(() => {
    const id = params.get('open');
    if (id) setOpenId(id);
  }, [params]);

  return (
    <>
      <PageHeader title="گزارش‌ها" subtitle="گزارش کاربران از یکدیگر. گزارش‌دهنده خودکار فرد را بلاک کرده است." />
      <div className="mb-4">
        <Tabs
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          items={[
            { value: 'open', label: 'باز' },
            { value: 'resolved', label: 'رسیدگی‌شده' },
            { value: 'dismissed', label: 'ردشده' },
          ]}
        />
      </div>
      <Card padded={false}>
        {isLoading && !data ? (
          <Spinner />
        ) : !data?.items.length ? (
          <Empty icon={<Flag className="size-6" />} title="گزارشی نیست" />
        ) : (
          <div className="divide-y divide-line/60">
            {data.items.map((r) => (
              <button key={r.id} onClick={() => setOpenId(r.id)} className="flex w-full flex-wrap items-center gap-4 px-5 py-4 text-right transition hover:bg-white/[0.03]">
                <div className="grid size-10 place-items-center rounded-xl bg-danger/15 text-danger">
                  <Flag className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 font-medium">
                    {reason(r.reason)}
                    {r.has_chat && (
                      <Badge tone="info">
                        <MessageSquare className="size-3" /> همراه گفتگو
                      </Badge>
                    )}
                    {r.reported_total > 1 && <Badge tone="danger">{fmtNum(r.reported_total)} گزارش</Badge>}
                  </div>
                  <div className="mt-0.5 text-sm text-muted">
                    {r.reporter_name ?? 'کاربر'} ← <span className="text-ink">{r.reported_name ?? 'کاربر'}</span>
                    {r.details && <span className="text-faint">، {r.details}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {r.action && <Badge>{REPORT_ACTION_LABEL[r.action]}</Badge>}
                  <StatusBadge status={r.reported_status} />
                  <span className="text-xs text-faint">{fmtAgo(r.created_at)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </Card>
      {openId && (
        <ReportModal
          id={openId}
          reason={reason}
          onClose={() => setOpenId(null)}
          onDone={() => {
            setOpenId(null);
            mutate();
          }}
        />
      )}
    </>
  );
}

function ReportModal({ id, reason, onClose, onDone }: { id: string; reason: (r: string) => string; onClose: () => void; onDone: () => void }) {
  const { data: r, error } = useApi<Detail>(`admin/v1/reports/${id}`);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  async function resolve(action: 'dismiss' | 'warn' | 'suspend' | 'ban') {
    setBusy(action);
    try {
      await api.post(`admin/v1/reports/${id}/resolve`, { action, note: note || undefined });
      onDone();
    } catch (e) {
      setActionError(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal open onClose={onClose} title="جزئیات گزارش" wide>
      <ErrorBox error={error} />
      {!r ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-surface-2 p-3 text-sm">
              <div className="text-xs text-muted">گزارش‌دهنده</div>
              <Link href={`/users/${r.reporter_id}`} className="font-medium hover:underline">
                {r.reporter_name ?? 'کاربر'}
              </Link>
            </div>
            <div className="rounded-xl bg-surface-2 p-3 text-sm">
              <div className="text-xs text-muted">گزارش‌شده</div>
              <Link href={`/users/${r.reported_id}`} className="font-medium hover:underline">
                {r.reported_name ?? 'کاربر'}
              </Link>{' '}
              <StatusBadge status={r.reported_status} />
            </div>
          </div>
          <div className="rounded-xl bg-surface-2 p-3 text-sm">
            <div className="font-medium">{reason(r.reason)}</div>
            {r.details && <p className="mt-1 whitespace-pre-line text-muted">{r.details}</p>}
            <div className="mt-1 text-xs text-faint">{fmtDateTime(r.created_at)}</div>
          </div>

          {r.context?.messages?.length ? (
            <div>
              <div className="mb-2 text-xs font-medium text-muted">آخرین پیام‌های گفتگو (ثبت‌شده هنگام گزارش)</div>
              <div className="max-h-80 space-y-2 overflow-y-auto rounded-xl bg-bg p-3">
                {r.context.messages.map((m) => {
                  const fromReported = m.senderId === r.reported_id;
                  return (
                    <div key={m.id} className={clsx('flex', fromReported ? 'justify-end' : 'justify-start')}>
                      <div className={clsx('max-w-[75%] rounded-2xl px-3 py-2 text-sm', fromReported ? 'bg-danger/15' : 'bg-surface-3')}>
                        {m.media ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={m.media.thumb} alt="" className="max-h-40 rounded-lg" />
                        ) : (
                          <span className="whitespace-pre-line">{m.body ?? '—'}</span>
                        )}
                        <div className="mt-1 text-[10px] text-faint">
                          {fromReported ? r.reported_name : r.reporter_name}، {fmtDateTime(m.createdAt)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {r.status === 'open' ? (
            <>
              <Field label="یادداشت (برای اخطار به کاربر نمایش داده می‌شود)">
                <input className="field" value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
              <ErrorBox error={actionError} />
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" loading={busy === 'dismiss'} onClick={() => resolve('dismiss')}>
                  رد گزارش
                </Button>
                <Button loading={busy === 'warn'} onClick={() => resolve('warn')}>
                  ⚠️ اخطار
                </Button>
                <Button variant="danger" loading={busy === 'suspend'} onClick={() => resolve('suspend')}>
                  تعلیق
                </Button>
                <Button variant="danger" loading={busy === 'ban'} onClick={() => resolve('ban')}>
                  مسدود دائم
                </Button>
              </div>
            </>
          ) : (
            <div className="rounded-xl bg-surface-2 p-3 text-sm">
              نتیجه: {r.action ? REPORT_ACTION_LABEL[r.action] : '—'} {r.resolution_note && `، ${r.resolution_note}`}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
