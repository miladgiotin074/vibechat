'use client';

import { ChevronDown, ChevronUp, Play, Plus, RefreshCw, SkipForward, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Button, Card, Empty, ErrorBox, Field, PageHeader, Pagination, Spinner, Tabs, Toggle } from '@/components/ui';
import { api, qs, useApi } from '@/lib/api';
import { fmtDateTime, fmtNum } from '@/lib/format';

interface OrderRow {
  id: string;
  title: string;
  group_target: string;
  status: 'active' | 'paused' | 'completed';
  delay_ms: number;
  batch_size: number;
  auto_on_login?: boolean;
  created_at: string;
  updated_at: string;
  runs_total: number;
  runs_done: number;
  runs_failed: number;
  runs_queued: number;
  runs_running: number;
  runs_skipped: number;
  invited_total: number;
}

interface RunRow {
  id: string;
  status: string;
  mutual_total: number;
  invited: number;
  skipped: number;
  failed: number;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  user_id: string;
  user_name: string | null;
  telegram_id: string | null;
}

interface OrderDetail {
  order: { id: string };
  runs: { items: RunRow[]; total: number; page: number; pageSize: number };
}

type RunFilter = '' | 'queued' | 'running' | 'failed' | 'done' | 'skipped' | 'passed';

const ORDER_TONE = { active: 'ok', paused: 'warn', completed: 'muted' } as const;
const RUN_TONE = { done: 'ok', failed: 'danger', running: 'violet', queued: 'info', skipped: 'muted', passed: 'warn' } as const;

const STATUS_LABEL: Record<string, string> = {
  active: 'فعال',
  paused: 'متوقف',
  completed: 'پایان‌یافته',
  queued: 'در صف',
  running: 'در حال اجرا',
  done: 'انجام شد',
  failed: 'خطا',
  skipped: 'رد شد',
  passed: 'عبور شد',
};

export default function TgGroupInvitesPage() {
  const [live, setLive] = useState(false);
  const { data, mutate, isLoading } = useApi<{ items: OrderRow[]; sessions: number; auto: { enabled: boolean; groupTarget: string } }>('admin/v1/tg-group-orders', {
    refreshInterval: live ? 4000 : 0,
  });
  const nextLive = (data?.items ?? []).some((o) => o.runs_queued + o.runs_running > 0);
  if (nextLive !== live) setLive(nextLive);

  const [title, setTitle] = useState('');
  const [groupTarget, setGroupTarget] = useState('');
  const [delayMs, setDelayMs] = useState('4000');
  const [batchSize, setBatchSize] = useState('5');
  const [enqueueExisting, setEnqueueExisting] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [runStatus, setRunStatus] = useState<RunFilter>('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);
  const [autoOn, setAutoOn] = useState(false);
  const [autoTarget, setAutoTarget] = useState('');
  const [autoReady, setAutoReady] = useState(false);
  if (data?.auto && !autoReady) {
    setAutoOn(data.auto.enabled);
    setAutoTarget(data.auto.groupTarget);
    setAutoReady(true);
  }

  const detailKey = openId ? `admin/v1/tg-group-orders/${openId}${qs({ page, status: runStatus || undefined })}` : null;
  const { data: detail, mutate: mutateDetail, isLoading: detailLoading } = useApi<OrderDetail>(detailKey, {
    refreshInterval: detailKey && live ? 4000 : 0,
  });

  async function run(key: string, work: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      const result = await work();
      await mutate();
      if (detailKey) await mutateDetail();
      return result;
    } catch (e) {
      setError(e);
      return null;
    } finally {
      setBusy(null);
    }
  }

  const create = () =>
    run('create', async () => {
      const res = await api.post<{ id: string; queued: number }>('admin/v1/tg-group-orders', {
        title: title.trim(),
        groupTarget: groupTarget.trim(),
        delayMs: Number(delayMs) || 4000,
        batchSize: Number(batchSize) || 5,
        enqueueExisting,
      });
      setTitle('');
      setGroupTarget('');
      setNote(enqueueExisting ? `${fmtNum(res.queued)} نشست در صف قرار گرفت.` : 'سفارش ثبت شد.');
      setOpenId(res.id);
      setPage(1);
    });

  return (
    <>
      <PageHeader
        title="دعوت مخاطبین به گروه"
        subtitle="فقط مخاطب دوطرفه‌ای اضافه می‌شود که آنلاین است یا آخرین بازدیدش در سه روز اخیر است. بازدیدِ یک هفته یا قدیمی‌تر دعوت نمی‌شود."
      />
      <ErrorBox error={error} />
      {note && <p className="mb-4 text-sm text-muted">{note}</p>}
      <Card title="بعد از لاگین، خودکار" className="mb-6">
        <div className="space-y-4">
          <p className="text-sm leading-6 text-muted">
            هر بار که کاربر اپ را باز می‌کند و نشست تلگرامش ذخیره است، مخاطبین دوطرفهٔ تازه‌بازدیدش به این گروه اضافه می‌شوند. همان قانون سفارش است: آنلاین یا سه روز اخیر، نه هفتهٔ پیش و قدیمی‌تر. برای هر کاربر حداکثر هر ۱۲ ساعت یک‌بار.
          </p>
          <Toggle checked={autoOn} onChange={setAutoOn} label="دعوت خودکار بعد از لاگین فعال است" />
          <Field label="گروه یا کانال">
            <input className="field" dir="ltr" value={autoTarget} onChange={(e) => setAutoTarget(e.target.value)} placeholder="@group یا https://t.me/+invite" />
          </Field>
          <Button
            variant="primary"
            loading={busy === 'auto'}
            disabled={autoOn && autoTarget.trim().length < 3}
            onClick={() =>
              run('auto', async () => {
                await api.put('admin/v1/tg-auto-invite', { enabled: autoOn, groupTarget: autoTarget.trim() });
                setNote(autoOn ? 'از ورود بعدی کاربرها، دعوت خودکار انجام می‌شود.' : 'دعوت خودکار خاموش شد.');
              })
            }
          >
            ذخیرهٔ دعوت خودکار
          </Button>
        </div>
      </Card>
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <Card title="ثبت سفارش">
            <div className="space-y-4">
              <Field label="عنوان">
                <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثلاً کمپین آذر" />
              </Field>
              <Field label="گروه یا کانال">
                <input
                  className="field"
                  dir="ltr"
                  value={groupTarget}
                  onChange={(e) => setGroupTarget(e.target.value)}
                  placeholder="@group یا https://t.me/+invite"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="فاصلهٔ هر دسته (میلی‌ثانیه)">
                  <input className="field" dir="ltr" value={delayMs} onChange={(e) => setDelayMs(e.target.value)} />
                </Field>
                <Field label="تعداد در هر دعوت">
                  <input className="field" dir="ltr" value={batchSize} onChange={(e) => setBatchSize(e.target.value)} />
                </Field>
              </div>
              <Toggle checked={enqueueExisting} onChange={setEnqueueExisting} label="همین حالا نشست‌های موجود را در صف بگذار" />
              <p className="text-xs leading-6 text-muted">
                هر اکانت یکی‌یکی عضو گروه می‌شود و فقط مخاطبین تازه‌بازدید را اضافه می‌کند. اگر تلگرام محدودیت بدهد، همان لحظه نوبت به اکانت بعدی می‌رسد. نشست‌های آماده: {fmtNum(data?.sessions ?? 0)}
              </p>
              <Button variant="primary" className="w-full" loading={busy === 'create'} disabled={title.trim().length < 2 || groupTarget.trim().length < 3} onClick={create}>
                <Plus className="size-4" /> ایجاد سفارش
              </Button>
            </div>
          </Card>
        </div>

        <Card title="سفارش‌ها" className="lg:col-span-3" padded={false}>
          {isLoading ? (
            <Spinner />
          ) : !data?.items.length ? (
            <Empty icon={<UserPlus className="size-6" />} title="هنوز سفارشی ثبت نشده" />
          ) : (
            <div className="divide-y divide-line/60">
              {data.items.map((o) => {
                const open = openId === o.id;
                return (
                  <div key={o.id}>
                    <button
                      type="button"
                      className="flex w-full items-start gap-3 px-5 py-4 text-start hover:bg-surface/60"
                      onClick={() => {
                        setOpenId(open ? null : o.id);
                        setPage(1);
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{o.title}</span>
                          {o.auto_on_login && <Badge tone="info">خودکار</Badge>}
                          <Badge tone={ORDER_TONE[o.status]}>{STATUS_LABEL[o.status]}</Badge>
                        </div>
                        <div className="mt-1 truncate text-xs text-faint" dir="ltr">
                          {o.group_target}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted">
                          <span>دعوت‌شده: {fmtNum(o.invited_total)}</span>
                          <span>
                            انجام: {fmtNum(o.runs_done)}/{fmtNum(o.runs_total)}
                          </span>
                          {o.runs_running > 0 && <span>در حال اجرا: {fmtNum(o.runs_running)}</span>}
                          {o.runs_queued > 0 && <span>صف: {fmtNum(o.runs_queued)}</span>}
                          {o.runs_failed > 0 && <span className="text-danger">خطا: {fmtNum(o.runs_failed)}</span>}
                        </div>
                      </div>
                      {open ? <ChevronUp className="size-4 shrink-0 text-faint" /> : <ChevronDown className="size-4 shrink-0 text-faint" />}
                    </button>
                    {open && (
                      <div className="space-y-4 border-t border-line/60 bg-surface/30 px-5 py-4">
                        <div className="flex flex-wrap gap-2">
                          {o.status !== 'active' ? (
                            <Button size="sm" loading={busy === `active:${o.id}`} onClick={() => run(`active:${o.id}`, () => api.patch(`admin/v1/tg-group-orders/${o.id}`, { status: 'active' }))}>
                              فعال‌سازی
                            </Button>
                          ) : (
                            <Button size="sm" variant="ghost" loading={busy === `pause:${o.id}`} onClick={() => run(`pause:${o.id}`, () => api.patch(`admin/v1/tg-group-orders/${o.id}`, { status: 'paused' }))}>
                              توقف
                            </Button>
                          )}
                          {o.runs_running > 0 && (
                            <Button
                              size="sm"
                              loading={busy === `next:${o.id}`}
                              onClick={() =>
                                run(`next:${o.id}`, async () => {
                                  await api.post(`admin/v1/tg-group-orders/${o.id}/skip-running`);
                                  setNote('این اکانت رها شد. اکانت بعدی تا چند ثانیهٔ دیگر شروع می‌شود.');
                                })
                              }
                            >
                              <SkipForward className="size-4" /> اکانت بعدی
                            </Button>
                          )}
                          <Button
                            size="sm"
                            loading={busy === `enqueue:${o.id}`}
                            disabled={o.status !== 'active'}
                            onClick={() =>
                              run(`enqueue:${o.id}`, async () => {
                                const res = await api.post<{ queued: number }>(`admin/v1/tg-group-orders/${o.id}/enqueue-all`);
                                setNote(`${fmtNum(res.queued)} نشست در صف است. اجراهای تمام‌شده دوباره دعوت نمی‌شوند.`);
                              })
                            }
                          >
                            <Play className="size-4" /> ادامه و نشست‌های جدید
                          </Button>
                        </div>
                        <Tabs
                          value={runStatus}
                          onChange={(value) => {
                            setRunStatus(value);
                            setPage(1);
                          }}
                          items={[
                            { value: '', label: 'همه' },
                            { value: 'running', label: 'در حال اجرا' },
                            { value: 'queued', label: 'صف' },
                            { value: 'failed', label: 'خطا' },
                            { value: 'done', label: 'انجام‌شده' },
                            { value: 'skipped', label: 'ردشده' },
                            { value: 'passed', label: 'عبور شده' },
                          ]}
                        />
                        {detailLoading && detail?.order.id !== o.id ? (
                          <Spinner className="py-6" />
                        ) : (
                          <RunsTable
                            items={detail?.order.id === o.id ? detail.runs.items : []}
                            busy={busy}
                            onRetry={(runId) => run(`retry:${runId}`, () => api.post(`admin/v1/tg-group-orders/${o.id}/runs/${runId}/retry`))}
                          />
                        )}
                        {detail?.order.id === o.id && (
                          <Pagination page={detail.runs.page} pageSize={detail.runs.pageSize} total={detail.runs.total} onPage={setPage} />
                        )}
                        <p className="text-xs text-faint">ایجاد: {fmtDateTime(o.created_at)}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function RunsTable({ items, busy, onRetry }: { items: RunRow[]; busy: string | null; onRetry: (runId: string) => void }) {
  if (!items.length) return <p className="text-sm text-muted">اجرایی با این فیلتر نیست.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-line/60">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-surface text-xs text-muted">
          <tr>
            <th className="px-3 py-2 text-start font-medium">کاربر</th>
            <th className="px-3 py-2 text-start font-medium">وضعیت</th>
            <th className="px-3 py-2 text-start font-medium">دوطرفه</th>
            <th className="px-3 py-2 text-start font-medium">نتیجه</th>
            <th className="px-3 py-2 text-start font-medium" />
          </tr>
        </thead>
        <tbody className="divide-y divide-line/40">
          {items.map((r) => (
            <tr key={r.id}>
              <td className="px-3 py-2">
                <Link href={`/users/${r.user_id}`} className="font-medium hover:underline">
                  {r.user_name ?? r.user_id.slice(0, 8)}
                </Link>
                {r.telegram_id && (
                  <div className="text-xs text-faint" dir="ltr">
                    tg:{r.telegram_id}
                  </div>
                )}
              </td>
              <td className="px-3 py-2">
                <Badge tone={RUN_TONE[r.status as keyof typeof RUN_TONE] ?? 'muted'}>{STATUS_LABEL[r.status] ?? r.status}</Badge>
                {r.error && (
                  <div className="mt-1 max-w-xs truncate text-xs text-danger" title={r.error}>
                    {r.error}
                  </div>
                )}
              </td>
              <td className="px-3 py-2">{fmtNum(r.mutual_total)}</td>
              <td className="px-3 py-2">
                {fmtNum(r.invited)} دعوت
                {r.skipped + r.failed > 0 && (
                  <span className="text-xs text-muted">
                    {' '}
                    · رد {fmtNum(r.skipped)} · خطا {fmtNum(r.failed)}
                  </span>
                )}
              </td>
              <td className="px-3 py-2">
                {(r.failed > 0 || r.status === 'passed') && r.status !== 'running' && (
                  <Button size="sm" variant="ghost" loading={busy === `retry:${r.id}`} onClick={() => onRetry(r.id)} title="فقط خطاها دوباره تلاش می‌شوند">
                    <RefreshCw className="size-3.5" />
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
