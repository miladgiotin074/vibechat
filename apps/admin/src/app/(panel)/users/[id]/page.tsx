'use client';

import { ArrowRight, Ban, Check, EyeOff, Gem, Trash2, Undo2, X } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge, Button, Card, ErrorBox, Field, Modal, Spinner, StatusBadge } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { fmtAgo, fmtDate, fmtDateTime, fmtNum, fmtToman, GENDER_LABEL } from '@/lib/format';

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
  bonusSuperLikes: number;
  referrals: { added: number; random_used: number; likes_used: number } | undefined;
  status: string;
  gender: string | null;
  age: number | null;
  birthdate: string | null;
  interestedIn: string | null;
  goal: string | null;
  bio: string | null;
  job: string | null;
  education: string | null;
  heightCm: number | null;
  interests: string[];
  province: string | null;
  city: string | null;
  premiumUntil: string | null;
  shadowBanned: boolean;
  shadowAuto?: boolean;
  trust?: number;
  discoverable: boolean;
  incognito: boolean;
  banReason: string | null;
  likesReceived: number;
  passesReceived: number;
  score: number;
  lastActiveAt: string;
  createdAt: string;
  photos: Photo[];
  reportsAgainst: { id: string; reason: string; details: string | null; status: string; created_at: string }[];
  reportsBy: { id: string; reason: string; status: string; created_at: string }[];
  payments: { id: string; amount_toman: number; status: string; ref_id: string | null; created_at: string; title: string }[];
  sessions: { id: string; device_model: string | null; platform: string | null; app_version: string | null; ip: string | null; last_used_at: string; revoked_at: string | null }[];
  stats: { matches: number; swipes: number; blocked_by: number };
}

interface Meta {
  goals: { id: string; label: string; emoji?: string }[];
  interests: { id: string; label: string; emoji?: string }[];
  reportReasons: { id: string; label: string }[];
}

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: u, error, mutate } = useApi<Detail>(`admin/v1/users/${id}`);
  const { data: meta } = useApi<Meta>('v1/meta');
  const [busy, setBusy] = useState<string | null>(null);
  const [banOpen, setBanOpen] = useState(false);
  const [premiumOpen, setPremiumOpen] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);

  async function act(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setActionError(null);
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
  const premium = u.premiumUntil && new Date(u.premiumUntil) > new Date();
  const goal = meta?.goals.find((g) => g.id === u.goal);
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
              {premium && <Badge tone="warn"><Gem className="size-3" /> ویژه تا {fmtDate(u.premiumUntil)}</Badge>}
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
              <span>
                {u.city ?? '—'}، {u.province ?? '—'}
              </span>
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
            <Button onClick={() => setPremiumOpen(true)}>
              <Gem className="size-4" /> عضویت ویژه
            </Button>
            <Button
              loading={busy === 'shadow'}
              onClick={() => act('shadow', () => api.patch(`admin/v1/users/${id}`, { shadowBanned: !u.shadowBanned }))}
            >
              <EyeOff className="size-4" /> {u.shadowBanned ? 'لغو بن سایه' : 'بن سایه'}
            </Button>
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

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title={`عکس‌ها (${fmtNum(u.photos.length)})`}>
            {u.photos.length ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {u.photos.map((p) => (
                  <div key={p.id} className="group relative overflow-hidden rounded-2xl">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <a href={p.url} target="_blank" rel="noreferrer">
                      <img src={p.md} alt="" className="aspect-[4/5] w-full object-cover" />
                    </a>
                    <div className="absolute right-2 top-2">
                      <StatusBadge status={p.status} />
                    </div>
                    <div className="absolute inset-x-2 bottom-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
                      {p.status !== 'approved' && (
                        <Button size="sm" variant="ok" className="flex-1 bg-black/60 backdrop-blur" onClick={() => act('p' + p.id, () => api.post('admin/v1/photos/review', { ids: [p.id], action: 'approve' }))}>
                          <Check className="size-3.5" />
                        </Button>
                      )}
                      {p.status !== 'rejected' && (
                        <Button size="sm" variant="danger" className="flex-1 bg-black/60 backdrop-blur" onClick={() => act('p' + p.id, () => api.post('admin/v1/photos/review', { ids: [p.id], action: 'reject' }))}>
                          <X className="size-3.5" />
                        </Button>
                      )}
                    </div>
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

          <Card title="پرداخت‌ها" padded={false}>
            {u.payments.length ? (
              <table className="w-full text-sm">
                <tbody>
                  {u.payments.map((p) => (
                    <tr key={p.id} className="border-b border-line/60">
                      <td className="px-5 py-3">{p.title}</td>
                      <td className="px-5 py-3">{fmtToman(p.amount_toman)}</td>
                      <td className="px-5 py-3"><StatusBadge status={p.status} /></td>
                      <td className="px-5 py-3 text-muted" dir="ltr">{p.ref_id ?? ''}</td>
                      <td className="px-5 py-3 text-muted">{fmtDateTime(p.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="px-5 py-4 text-sm text-muted">پرداختی ندارد</div>
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
                ['هدف', goal ? `${goal.emoji ?? ''} ${goal.label}` : '—'],
                ['شغل', u.job ?? '—'],
                ['قد', u.heightCm ? `${fmtNum(u.heightCm)} سانتی‌متر` : '—'],
                ['نام در تلگرام', `${u.telegramName ?? '—'}${u.telegramPremium ? ' ⭐' : ''}`],
                ['اعلان ربات', u.botBlocked ? 'ربات را بلاک کرده' : u.canDm ? 'فعال' : 'اجازه نداده'],
                ['کد دعوت', u.refCode],
                ['افزوده به گروه دیوار', `${u.referrals?.added ?? 0} نفر`],
                ['چت ناشناس استفاده‌شده', String(u.referrals?.random_used ?? 0)],
                ['لایک استفاده‌شده (از سهمیه‌ی کل)', String(u.referrals?.likes_used ?? 0)],
                ['سوپرلایک هدیه', String(u.bonusSuperLikes)],
                ['قابل نمایش', u.discoverable ? 'بله' : 'خیر'],
                ['حالت مخفی', u.incognito ? 'روشن' : 'خاموش'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <dt className="text-muted">{k}</dt>
                  <dd className="text-left">{v}</dd>
                </div>
              ))}
            </dl>
            {u.bio && <p className="mt-4 whitespace-pre-line rounded-xl bg-surface-2 p-3 text-sm leading-7">{u.bio}</p>}
            {!!u.interests.length && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {u.interests.map((i) => {
                  const it = meta?.interests.find((x) => x.id === i);
                  return (
                    <Badge key={i} tone="violet">
                      {it?.emoji} {it?.label ?? i}
                    </Badge>
                  );
                })}
              </div>
            )}
          </Card>

          <Card title="آمار">
            <div className="grid grid-cols-2 gap-3 text-center text-sm">
              {[
                ['مچ', u.stats.matches],
                ['سوایپ', u.stats.swipes],
                ['لایک دریافتی', u.likesReceived],
                ['بلاک‌شده توسط', u.stats.blocked_by],
              ].map(([k, v]) => (
                <div key={k as string} className="rounded-xl bg-surface-2 p-3">
                  <div className="text-lg font-bold">{fmtNum(v as number)}</div>
                  <div className="text-xs text-muted">{k}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 text-center text-xs text-faint">امتیاز جذابیت: {fmtNum(Math.round(u.score * 100))} از ۱۰۰</div>
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
      <PremiumModal open={premiumOpen} onClose={() => setPremiumOpen(false)} onDone={() => mutate()} userId={id} />
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

function PremiumModal({ open, onClose, onDone, userId }: { open: boolean; onClose: () => void; onDone: () => void; userId: string }) {
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async (d: number) => {
    setBusy(true);
    try {
      await api.post(`admin/v1/users/${userId}/premium`, { days: d });
      onDone();
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="عضویت ویژه">
      <div className="space-y-4">
        <Field label="تعداد روز هدیه" hint="به انتهای عضویت فعلی اضافه می‌شود">
          <input type="number" className="field" value={days} min={1} onChange={(e) => setDays(Number(e.target.value))} />
        </Field>
        <div className="flex gap-2">
          {[7, 30, 90, 365].map((d) => (
            <Button key={d} size="sm" onClick={() => setDays(d)}>
              {fmtNum(d)} روز
            </Button>
          ))}
        </div>
        <ErrorBox error={error} />
        <div className="flex gap-2">
          <Button variant="primary" className="flex-1" loading={busy} onClick={() => submit(days)}>
            اعطای عضویت
          </Button>
          <Button variant="danger" loading={busy} onClick={() => submit(0)}>
            لغو عضویت
          </Button>
        </div>
      </div>
    </Modal>
  );
}
