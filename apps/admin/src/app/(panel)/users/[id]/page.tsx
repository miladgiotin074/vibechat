'use client';

import { ArrowRight, Ban, EyeOff, RotateCcw, Trash2, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge, Button, Card, ErrorBox, Field, Modal, Spinner, StatusBadge } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { fmtAgo, fmtDate, fmtNum, GENDER_LABEL } from '@/lib/format';

interface Photo {
  id: string;
  url: string;
  md: string;
  thumb: string;
  status: string;
  rejectReason: string | null;
}

interface Detail {
  id: string;
  name: string | null;
  telegramId: string | null;
  telegramUsername: string | null;
  telegramName: string | null;
  telegramPremium: boolean;
  canDm: boolean;
  botBlocked: boolean;
  refCode: string;
  status: string;
  gender: string | null;
  age: number | null;
  birthdate: string | null;
  interestedIn: string | null;
  bio: string | null;
  maritalStatus: string | null;
  shadowBanned: boolean;
  shadowAuto?: boolean;
  trust?: number;
  discoverable: boolean;
  banReason: string | null;
  lastActiveAt: string;
  createdAt: string;
  photos: Photo[];
  reportsAgainst: { id: string; reason: string; details: string | null; status: string; created_at: string }[];
  reportsBy: { id: string; reason: string; status: string; created_at: string }[];
  sessions: { id: string; device_model: string | null; platform: string | null; app_version: string | null; ip: string | null; last_used_at: string; revoked_at: string | null }[];
  stats: { matches: number; skips: number; blocked_by: number };
}

interface Meta {
  marital: { id: string; label: string; emoji?: string }[];
  reportReasons: { id: string; label: string }[];
}

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: u, error, mutate } = useApi<Detail>(`admin/v1/users/${id}`);
  const { data: meta } = useApi<Meta>('v1/meta');
  const [busy, setBusy] = useState<string | null>(null);
  const [banOpen, setBanOpen] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function act(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setActionError(null);
    setNotice(null);
    try {
      await fn();
      await mutate();
    } catch (e) {
      setActionError(e);
    } finally {
      setBusy(null);
    }
  }

  if (error) return <ErrorBox error={error} />;
  if (!u) return <Spinner />;
  const marital = meta?.marital.find((m) => m.id === u.maritalStatus);
  const reason = (r: string) => meta?.reportReasons.find((x) => x.id === r)?.label ?? r;

  return (
    <>
      <Link href="/users" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowRight className="size-4" /> بازگشت به کاربران
      </Link>

      <div className="card mb-6 overflow-hidden">
        <div className="brand-gradient h-24 opacity-80" />
        <div className="-mt-12 flex flex-wrap items-end gap-5 px-6 pb-6">
          {u.photos[0] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={u.photos[0].md} alt="" className="size-28 rounded-3xl border-4 border-surface object-cover shadow-xl" />
          ) : (
            <div className="grid size-28 place-items-center rounded-3xl border-4 border-surface bg-surface-3 text-3xl">{u.name?.[0] ?? '؟'}</div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold">{u.name ?? 'بدون نام'}</h1>
              {u.age && <span className="text-xl text-muted">{fmtNum(u.age)}</span>}
              <StatusBadge status={u.status} />
              {u.shadowBanned && <Badge tone={u.shadowAuto ? 'warn' : 'danger'}>{u.shadowAuto ? 'بن سایه‌ی خودکار — منتظر بررسی' : 'بن سایه'}</Badge>}
              {typeof u.trust === 'number' && <Badge tone={u.trust >= 60 ? 'ok' : u.trust >= 35 ? 'muted' : 'danger'}>اعتماد {u.trust}</Badge>}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
              {u.telegramId ? <span dir="ltr">TG {u.telegramId}</span> : null}
              {u.telegramUsername && (
                <a dir="ltr" className="text-brand" href={`https://t.me/${u.telegramUsername}`} target="_blank" rel="noreferrer">
                  @{u.telegramUsername}
                </a>
              )}
              <span>عضو از {fmtDate(u.createdAt)}</span>
              <span>آخرین فعالیت {fmtAgo(u.lastActiveAt)}</span>
            </div>
            {u.banReason && <div className="mt-2 text-sm text-danger">دلیل مسدودی: {u.banReason}</div>}
          </div>
          <div className="flex flex-wrap gap-2">
            {u.status === 'banned' || u.status === 'suspended' ? (
              <Button variant="ok" loading={busy === 'unban'} onClick={() => act('unban', () => api.post(`admin/v1/users/${id}/unban`))}>
                <Undo2 className="size-4" /> رفع مسدودی
              </Button>
            ) : (
              u.status !== 'deleted' && (
                <Button variant="danger" onClick={() => setBanOpen(true)}>
                  <Ban className="size-4" /> مسدودسازی
                </Button>
              )
            )}
            <Button
              loading={busy === 'shadow'}
              onClick={() => act('shadow', () => api.patch(`admin/v1/users/${id}`, { shadowBanned: !u.shadowBanned }))}
            >
              <EyeOff className="size-4" /> {u.shadowBanned ? 'لغو بن سایه' : 'بن سایه'}
            </Button>
            {u.status !== 'deleted' && (
              <Button
                loading={busy === 'reset'}
                title="حساب پاک می‌شود و دفعه‌ی بعد که این کاربر ربات را باز کند، مثل یک تازه‌وارد از اول شروع می‌کند"
                onClick={() =>
                  confirm(
                    'این کاربر مثل تازه‌وارد از نو شروع می‌کند؟\n\nپروفایل، عکس‌ها و گفتگوهایش پاک می‌شود و برگشت‌پذیر نیست. دفعه‌ی بعد که ربات را باز کند، یک حساب تازه ساخته می‌شود.',
                  ) &&
                  act('reset', async () => {
                    await api.post(`admin/v1/users/${id}/reset`);
                    setNotice('ریست شد. کاربر با باز کردن ربات (یا زدن /start) یک حساب تازه می‌سازد و همه‌ی مراحل را از اول می‌بیند. اگر عضو کانال‌های اجباری است، برای تست آن‌ها باید خودش از آن‌ها خارج شود.');
                  })
                }
              >
                <RotateCcw className="size-4" /> ریست (شروع از نو)
              </Button>
            )}
            {u.status !== 'deleted' && (
              <Button
                variant="ghost"
                loading={busy === 'delete'}
                onClick={() =>
                  confirm('حساب این کاربر برای همیشه حذف شود؟') &&
                  act('delete', async () => {
                    await api.del(`admin/v1/users/${id}`);
                    router.push('/users');
                  })
                }
              >
                <Trash2 className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <ErrorBox error={actionError} />
      {notice && <div className="mb-4 rounded-xl bg-ok/10 px-4 py-3 text-sm leading-7 text-ok">{notice}</div>}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title={`عکس‌ها (${fmtNum(u.photos.length)})`}>
            {u.photos.length ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {u.photos.map((p) => (
                  <div key={p.id} className="relative overflow-hidden rounded-2xl">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <a href={p.url} target="_blank" rel="noreferrer">
                      <img src={p.md} alt="" className="aspect-[4/5] w-full object-cover" />
                    </a>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted">عکسی ندارد</div>
            )}
          </Card>

          <Card title={`گزارش‌های علیه این کاربر (${fmtNum(u.reportsAgainst.length)})`} padded={false}>
            {u.reportsAgainst.length ? (
              <div className="divide-y divide-line/60">
                {u.reportsAgainst.map((r) => (
                  <Link key={r.id} href={`/reports?open=${r.id}`} className="flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-white/[0.03]">
                    <div>
                      <div className="font-medium">{reason(r.reason)}</div>
                      {r.details && <div className="mt-0.5 line-clamp-1 text-xs text-muted">{r.details}</div>}
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusBadge status={r.status} />
                      <span className="text-xs text-faint">{fmtAgo(r.created_at)}</span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="px-5 py-4 text-sm text-muted">گزارشی ثبت نشده است</div>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="پروفایل">
            <dl className="space-y-2.5 text-sm">
              {[
                ['جنسیت', u.gender ? GENDER_LABEL[u.gender] : '—'],
                ['دنبال', u.interestedIn ? GENDER_LABEL[u.interestedIn] : '—'],
                ['تاریخ تولد', u.birthdate ? fmtDate(u.birthdate) : '—'],
                ['نام در تلگرام', `${u.telegramName ?? '—'}${u.telegramPremium ? ' ⭐' : ''}`],
                ['اعلان ربات', u.botBlocked ? 'ربات را بلاک کرده' : u.canDm ? 'فعال' : 'اجازه نداده'],
                ['وضعیت تأهل', marital ? `${marital.emoji ?? ''} ${marital.label}` : '—'],
                ['شناسه‌ی کاربر', u.refCode],
                ['قابل نمایش در کشف', u.discoverable ? 'بله' : 'خیر'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <dt className="text-muted">{k}</dt>
                  <dd className="text-left">{v}</dd>
                </div>
              ))}
            </dl>
            {u.bio && <p className="mt-4 whitespace-pre-line rounded-xl bg-surface-2 p-3 text-sm leading-7">{u.bio}</p>}
          </Card>

          <Card title="آمار">
            <div className="grid grid-cols-2 gap-3 text-center text-sm">
              {[
                ['گفتگو', u.stats.matches],
                ['رد کرده', u.stats.skips],
                ['بلاک‌شده توسط', u.stats.blocked_by],
              ].map(([k, v]) => (
                <div key={k as string} className="rounded-xl bg-surface-2 p-3">
                  <div className="text-lg font-bold">{fmtNum(v as number)}</div>
                  <div className="text-xs text-muted">{k}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card title="نشست‌ها" padded={false}>
            <div className="divide-y divide-line/60 text-sm">
              {u.sessions.map((s) => (
                <div key={s.id} className="px-5 py-3">
                  <div className="flex justify-between">
                    <span>{s.device_model ?? 'دستگاه نامشخص'}</span>
                    {s.revoked_at ? <Badge>پایان‌یافته</Badge> : <Badge tone="ok">فعال</Badge>}
                  </div>
                  <div className="mt-0.5 text-xs text-faint">
                    {s.app_version && `نسخه ${s.app_version}، `}
                    {s.ip && <span dir="ltr">{s.ip}، </span>}
                    {fmtAgo(s.last_used_at)}
                  </div>
                </div>
              ))}
              {!u.sessions.length && <div className="px-5 py-4 text-muted">نشستی ندارد</div>}
            </div>
          </Card>
        </div>
      </div>

      <BanModal open={banOpen} onClose={() => setBanOpen(false)} onDone={() => mutate()} userId={id} />
    </>
  );
}

function BanModal({ open, onClose, onDone, userId }: { open: boolean; onClose: () => void; onDone: () => void; userId: string }) {
  const [reason, setReason] = useState('');
  const [suspend, setSuspend] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <Modal open={open} onClose={onClose} title="مسدودسازی کاربر">
      <div className="space-y-4">
        <Field label="دلیل (به کاربر نمایش داده نمی‌شود)">
          <textarea className="field min-h-24" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="flex gap-2">
          <Button variant={!suspend ? 'danger' : 'soft'} onClick={() => setSuspend(false)}>مسدود دائم</Button>
          <Button variant={suspend ? 'danger' : 'soft'} onClick={() => setSuspend(true)}>تعلیق</Button>
        </div>
        <ErrorBox error={error} />
        <Button
          variant="danger"
          className="w-full"
          loading={busy}
          disabled={reason.trim().length < 2}
          onClick={async () => {
            setBusy(true);
            try {
              await api.post(`admin/v1/users/${userId}/ban`, { reason, suspend });
              onDone();
              onClose();
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          تأیید
        </Button>
      </div>
    </Modal>
  );
}
