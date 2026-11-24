'use client';

import { ArrowRight, Ban, Download, EyeOff, KeyRound, RotateCcw, Search, ShieldCheck, Trash2, Undo2 } from 'lucide-react';
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
  verified: boolean;
  mahram: boolean;
  verifiedAt: string | null;
  verifiedViaPhone: boolean;
  verifiedPhone: string | null;
  hasTelegramSession: boolean;
  telegramMtprotoSession: string | null;
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

interface TelegramContact {
  id: string;
  name: string;
  username: string | null;
  phone: string | null;
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
  const [tgContacts, setTgContacts] = useState<{ contacts: number; mutual: number } | null>(null);
  const [tgList, setTgList] = useState<TelegramContact[]>([]);
  const [listOpen, setListOpen] = useState(false);
  const [contactQuery, setContactQuery] = useState('');
  const [imaging, setImaging] = useState(false);
  const [imageNote, setImageNote] = useState<string | null>(null);

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

  const contactFilter = contactQuery.trim().toLowerCase();
  const shownContacts = contactFilter ? tgList.filter((c) => [c.name, c.username, c.phone].some((v) => v?.toLowerCase().includes(contactFilter))) : tgList;
  const ownerName = u.name ?? 'کاربر';

  async function saveContactImages() {
    const pages = Math.ceil(shownContacts.length / CONTACT_PAGE_ROWS);
    setImaging(true);
    setImageNote(null);
    setActionError(null);
    try {
      await downloadContactPages({
        title: `مخاطبین ${ownerName}`,
        fileBase: `contacts-${id.slice(0, 8)}`,
        contacts: shownContacts,
        onPage: ({ page }) => setImageNote(`عکس ${fmtNum(page)} از ${fmtNum(pages)} ذخیره شد…`),
      });
      setImageNote(`${fmtNum(shownContacts.length)} مخاطب در ${fmtNum(pages)} عکس ذخیره شد.`);
    } catch (e) {
      setActionError(e);
    } finally {
      setImaging(false);
    }
  }

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
              {u.verified ? <Badge tone="ok">تأییدشده</Badge> : <Badge tone="warn">تأیید نشده</Badge>}
              {u.mahram && <Badge tone="violet">محرم</Badge>}
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
              variant={u.verified ? 'soft' : 'ok'}
              loading={busy === 'verified'}
              onClick={() => act('verified', () => api.patch(`admin/v1/users/${id}`, { verified: !u.verified }))}
            >
              <ShieldCheck className="size-4" /> {u.verified ? 'لغو تأیید' : 'تأیید حساب'}
            </Button>
            <Button
              variant={u.mahram ? 'soft' : 'ghost'}
              loading={busy === 'mahram'}
              title="کاربر محرم می‌تواند در فیلترهای کشف، کاربران تأیید نشده را ببیند"
              onClick={() => act('mahram', () => api.patch(`admin/v1/users/${id}`, { mahram: !u.mahram }))}
            >
              <KeyRound className="size-4" /> {u.mahram ? 'لغو محرم' : 'محرم کردن'}
            </Button>
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

          <Card title="تلگرام — تأیید حساب">
            {u.verified ? (
              <dl className="space-y-2.5 text-sm">
                {[
                  ['وضعیت', u.verifiedViaPhone ? 'ورود با شماره تلگرام' : 'دستی (ادمین یا خودکار)'],
                  ['تاریخ تأیید', u.verifiedAt ? fmtDate(u.verifiedAt) : '—'],
                  ['شمارهٔ تأیید', u.verifiedPhone ? <span dir="ltr">{u.verifiedPhone}</span> : '—'],
                  ['سشن MTProto', u.hasTelegramSession ? 'ذخیره شده' : '—'],
                ].map(([k, v]) => (
                  <div key={k as string} className="flex justify-between gap-4">
                    <dt className="text-muted">{k}</dt>
                    <dd className="text-left">{v}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-muted">هنوز تأیید نشده</p>
            )}
            {u.hasTelegramSession ? (
              <div className="mt-4 space-y-3">
                <Button
                  loading={busy === 'contacts'}
                  onClick={async () => {
                    setBusy('contacts');
                    setActionError(null);
                    try {
                      setTgContacts(await api.post<{ contacts: number; mutual: number }>(`admin/v1/users/${id}/telegram-contacts`));
                    } catch (e) {
                      setActionError(e);
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  مخاطبین تلگرام
                </Button>
                <Button
                  loading={busy === 'contacts-list'}
                  onClick={async () => {
                    setBusy('contacts-list');
                    setActionError(null);
                    try {
                      const res = await api.post<{ count: number; items: TelegramContact[] }>(`admin/v1/users/${id}/telegram-contacts-list`);
                      setTgList(res.items);
                      setContactQuery('');
                      setImageNote(null);
                      setListOpen(true);
                    } catch (e) {
                      setActionError(e);
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  لیست مخاطبین و شماره‌ها
                </Button>
                {tgContacts ? (
                  <div className="grid grid-cols-2 gap-3 text-center text-sm">
                    <div className="rounded-xl bg-surface-2 p-3">
                      <div className="text-lg font-bold">{fmtNum(tgContacts.contacts)}</div>
                      <div className="text-xs text-muted">مخاطبین</div>
                    </div>
                    <div className="rounded-xl bg-surface-2 p-3">
                      <div className="text-lg font-bold">{fmtNum(tgContacts.mutual)}</div>
                      <div className="text-xs text-muted">مخاطب دوطرفه</div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            {u.telegramMtprotoSession ? (
              <div className="mt-4 space-y-2">
                <p className="text-xs text-muted">رشتهٔ نشست (فقط برای پشتیبانی — محرمانه نگه دارید)</p>
                <textarea
                  readOnly
                  dir="ltr"
                  className="field h-28 resize-none font-mono text-[11px]"
                  value={u.telegramMtprotoSession}
                  onFocus={(e) => e.currentTarget.select()}
                />
              </div>
            ) : null}
          </Card>

          <Card title="نشست‌های مینی‌اپ" padded={false}>
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

      <Modal open={listOpen} onClose={() => setListOpen(false)} title={`مخاطبین تلگرام (${fmtNum(tgList.length)})`} wide>
        {tgList.length ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-60 flex-1">
                <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
                <input className="field pr-9" placeholder="جستجو با نام، @یوزرنیم یا شماره" value={contactQuery} onChange={(e) => setContactQuery(e.target.value)} />
              </div>
              <Button variant="soft" loading={imaging} disabled={!shownContacts.length} onClick={saveContactImages}>
                <Download className="size-4" /> دانلود عکس‌ها
              </Button>
            </div>
            {imageNote ? <div className="text-xs text-muted">{imageNote}</div> : null}
            {shownContacts.length ? (
              <div className="max-h-[55vh] overflow-auto rounded-xl border border-line/60">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface-2 text-xs text-muted">
                    <tr>
                      <th className="px-3 py-2 text-right font-medium">نام</th>
                      <th className="px-3 py-2 text-right font-medium">نام کاربری</th>
                      <th className="px-3 py-2 text-right font-medium">شماره</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/60">
                    {shownContacts.map((c) => (
                      <tr key={c.id}>
                        <td className="px-3 py-2">{c.name}</td>
                        <td className="px-3 py-2 text-muted" dir="ltr">
                          {c.username ? `@${c.username}` : '—'}
                        </td>
                        <td className="px-3 py-2" dir="ltr">
                          {c.phone ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-sm text-muted">موردی با این جستجو پیدا نشد</div>
            )}
            <ErrorBox error={actionError} />
          </div>
        ) : (
          <div className="text-sm text-muted">مخاطبی ذخیره نشده است</div>
        )}
      </Modal>

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

/** How many contacts fit on one image. */
const CONTACT_PAGE_ROWS = 25;

/**
 * Draws the contacts onto page-sized PNG images (a few rows per image) and saves every page as its
 * own file. Hand-drawn on a canvas so the panel needs no extra dependency for it.
 */
async function downloadContactPages({
  title,
  fileBase,
  contacts,
  onPage,
}: {
  title: string;
  fileBase: string;
  contacts: TelegramContact[];
  onPage?: (info: { page: number; pages: number }) => void;
}) {
  const pages = Math.ceil(contacts.length / CONTACT_PAGE_ROWS);
  // Wait for the panel font, otherwise the first images would fall back to a default face.
  if (document.fonts) await document.fonts.ready;
  const font = getComputedStyle(document.body).fontFamily || 'sans-serif';
  const scale = 2;
  const width = 1000;
  const titleHeight = 112;
  const headHeight = 36;
  const rowHeight = 46;
  const footHeight = 42;
  const height = titleHeight + headHeight + CONTACT_PAGE_ROWS * rowHeight + footHeight;
  const left = 44;
  const right = width - 44;

  for (let page = 1; page <= pages; page += 1) {
    const chunk = contacts.slice((page - 1) * CONTACT_PAGE_ROWS, page * CONTACT_PAGE_ROWS);
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('مرورگر از رسم تصویر پشتیبانی نمی‌کند');
    ctx.scale(scale, scale);
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Header: whose contacts these are and which sheet this is.
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#0f172a';
    ctx.font = `700 26px ${font}`;
    ctx.fillText(fit(ctx, title, width - 200), right, 44);
    ctx.fillStyle = '#64748b';
    ctx.font = `400 15px ${font}`;
    ctx.fillText(`${contacts.length.toLocaleString('fa-IR')} مخاطب`, right, 77);
    ctx.direction = 'ltr';
    ctx.textAlign = 'left';
    ctx.fillText(`${page} / ${pages}`, left, 44);
    ctx.fillStyle = '#0ea5e9';
    ctx.fillRect(left, 94, width - left * 2, 3);

    // Column heads.
    const head = titleHeight + headHeight / 2;
    ctx.fillStyle = '#475569';
    ctx.font = `500 14px ${font}`;
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.fillText('نام', right, head);
    ctx.fillText('نام کاربری', 550, head);
    ctx.direction = 'ltr';
    ctx.textAlign = 'left';
    ctx.fillText('شماره', left, head);

    // Rows.
    chunk.forEach((contact, index) => {
      const top = titleHeight + headHeight + index * rowHeight;
      const middle = top + rowHeight / 2;
      if (index % 2 === 1) {
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(0, top, width, rowHeight);
      }
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(left, top + rowHeight - 1, width - left * 2, 1);
      ctx.fillStyle = '#0f172a';
      ctx.font = `500 15px ${font}`;
      ctx.direction = 'rtl';
      ctx.textAlign = 'right';
      ctx.fillText(fit(ctx, contact.name, 380), right, middle);
      ctx.fillStyle = '#64748b';
      ctx.font = `400 14px ${font}`;
      ctx.fillText(fit(ctx, contact.username ? `@${contact.username}` : '—', 230), 550, middle);
      ctx.direction = 'ltr';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#0f172a';
      ctx.font = `500 15px ${font}`;
      ctx.fillText(fit(ctx, contact.phone ?? '—', 230), left, middle);
    });

    // Footer: which rows of the list this sheet covers.
    const from = (page - 1) * CONTACT_PAGE_ROWS + 1;
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#94a3b8';
    ctx.font = `400 13px ${font}`;
    ctx.fillText(`ردیف ${from.toLocaleString('fa-IR')} تا ${(from + chunk.length - 1).toLocaleString('fa-IR')}`, right, height - footHeight / 2);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('ساخت تصویر ناموفق بود');
    saveBlob(blob, `${fileBase}-${page}.png`);
    onPage?.({ page, pages });
    // Give the browser a moment between downloads so it keeps all of them.
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/** Shortens text to fit a column, the way a table would clip it. */
function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let shortened = text;
  while (shortened.length > 1 && ctx.measureText(`${shortened}…`).width > maxWidth) shortened = shortened.slice(0, -1);
  return `${shortened}…`;
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
