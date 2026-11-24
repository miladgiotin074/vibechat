'use client';

import { Loader2, Search, ShieldOff, Users as UsersIcon } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Avatar, Badge, Button, Card, Empty, ErrorBox, Modal, PageHeader, Pagination, Spinner, StatusBadge } from '@/components/ui';
import { api, qs, useApi } from '@/lib/api';
import { fmtAgo, fmtDate, fmtNum, GENDER_LABEL } from '@/lib/format';

interface UserRow {
  id: string;
  name: string | null;
  telegramId: string | null;
  telegramUsername: string | null;
  status: string;
  gender: string | null;
  age: number | null;
  shadowBanned: boolean;
  verified: boolean;
  verifiedAt: string | null;
  verifiedViaPhone: boolean;
  verifiedPhone: string | null;
  hasTelegramSession: boolean;
  /** shadow-banned automatically after several reports; a moderator hasn't decided yet */
  shadowAuto: boolean;
  trust: number;
  photo: string | null;
  lastActiveAt: string;
  createdAt: string;
}

interface Page {
  items: UserRow[];
  total: number;
  page: number;
  pageSize: number;
}

interface Audit {
  running: boolean;
  total: number;
  checked: number;
  expired: number;
  unknown: number;
  startedAt: string | null;
  finishedAt: string | null;
}

export default function UsersPage() {
  const sp = useSearchParams();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [gender, setGender] = useState('');
  const [shadow, setShadow] = useState('');
  const [verified, setVerified] = useState(() => (sp.get('verified') === 'true' ? 'true' : ''));
  const [page, setPage] = useState(1);
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditBusy, setAuditBusy] = useState(false);
  const [auditError, setAuditError] = useState<unknown>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const { data, error, isLoading, mutate: refreshUsers } = useApi<Page>(`admin/v1/users${qs({ q, status, gender, shadow, verified, page })}`, { keepPreviousData: true });
  const { data: audit, mutate: refreshAudit } = useApi<Audit>('admin/v1/tg-session-audit', { refreshInterval: auditOpen ? 3000 : 0 });

  async function startAudit() {
    setAuditBusy(true);
    setAuditError(null);
    try {
      await api.post('admin/v1/tg-session-audit');
      await refreshAudit();
    } catch (e) {
      setAuditError(e);
    } finally {
      setAuditBusy(false);
    }
  }

  const select = (value: string, set: (v: string) => void, options: [string, string][]) => (
    <select
      className="field w-auto min-w-32"
      value={value}
      onChange={(e) => {
        set(e.target.value);
        setPage(1);
      }}
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );

  return (
    <>
      <PageHeader
        title="کاربران"
        subtitle={data ? `${fmtNum(data.total)} کاربر` : undefined}
        actions={
          <Button variant="soft" onClick={() => setAuditOpen(true)}>
            <ShieldOff className="size-4" /> بررسی سشن‌های خراب
            {audit?.running ? <Loader2 className="size-4 animate-spin" /> : null}
          </Button>
        }
      />
      <Card padded={false}>
        <div className="flex flex-wrap gap-2 border-b border-line p-4">
          <div className="relative min-w-60 flex-1">
            <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <input className="field pr-9" placeholder="جستجو با نام، @یوزرنیم، آیدی عددی تلگرام، کد دعوت یا شناسه" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {select(status, setStatus, [
            ['', 'همه‌ی وضعیت‌ها'],
            ['active', 'فعال'],
            ['onboarding', 'در حال ثبت‌نام'],
            ['suspended', 'تعلیق'],
            ['banned', 'مسدود'],
            ['deleted', 'حذف‌شده'],
          ])}
          {select(gender, setGender, [
            ['', 'همه'],
            ['female', 'زن'],
            ['male', 'مرد'],
          ])}
          {select(verified, setVerified, [
            ['', 'تأیید: همه'],
            ['true', 'تأییدشده'],
            ['false', 'تأیید نشده'],
          ])}
          {select(shadow, setShadow, [
            ['', 'بن سایه'],
            ['auto', 'خودکار — منتظر بررسی'],
            ['true', 'همه‌ی بن‌های سایه'],
          ])}
        </div>
        <ErrorBox error={error} />
        {isLoading && !data ? (
          <Spinner />
        ) : !data?.items.length ? (
          <Empty icon={<UsersIcon className="size-6" />} title="کاربری پیدا نشد" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="px-4 py-3 text-right font-medium">کاربر</th>
                  <th className="px-4 py-3 text-right font-medium">شماره</th>
                  <th className="px-4 py-3 text-right font-medium">جنسیت / سن</th>
                  <th className="px-4 py-3 text-right font-medium">تأیید حساب</th>
                  <th className="px-4 py-3 text-right font-medium">وضعیت</th>
                  <th className="px-4 py-3 text-right font-medium">اعتماد</th>
                  <th className="px-4 py-3 text-right font-medium">آخرین فعالیت</th>
                  <th className="px-4 py-3 text-right font-medium">عضویت</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((u) => (
                  <tr key={u.id} className="border-b border-line/60 transition hover:bg-white/[0.03]">
                    <td className="px-4 py-3">
                      <Link href={`/users/${u.id}`} className="flex items-center gap-3">
                        <Avatar src={u.photo} name={u.name} />
                        <div>
                          <div className="flex items-center gap-1.5 font-medium">
                            {u.name || <span className="text-faint">بدون نام</span>}
                          </div>
                          {u.telegramUsername && <div className="text-xs text-faint" dir="ltr">@{u.telegramUsername}</div>}
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted" dir="ltr">
                      {u.telegramId ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      {[u.gender ? GENDER_LABEL[u.gender] : '—', u.age ? fmtNum(u.age) : null].filter(Boolean).join('، ')}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {u.verified ? (
                        <div className="space-y-0.5 text-xs">
                          <div className="flex flex-wrap items-center gap-1">
                            <Badge tone="ok">تأییدشده</Badge>
                            {u.verifiedViaPhone ? <Badge tone="muted">ورود تلگرام</Badge> : null}
                            {u.hasTelegramSession ? <Badge tone="info">سشن</Badge> : null}
                          </div>
                          {u.verifiedPhone ? <div dir="ltr">{u.verifiedPhone}</div> : null}
                          {u.verifiedAt ? <div className="text-faint">{fmtDate(u.verifiedAt)}</div> : null}
                        </div>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <StatusBadge status={u.status} />
                        {u.shadowBanned && <Badge tone={u.shadowAuto ? 'warn' : 'danger'}>{u.shadowAuto ? 'سایه‌ی خودکار' : 'سایه'}</Badge>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={u.trust >= 60 ? 'ok' : u.trust >= 35 ? 'muted' : 'danger'}>{fmtNum(u.trust)}</Badge>
                    </td>
                    <td className="px-4 py-3 text-muted">{fmtAgo(u.lastActiveAt)}</td>
                    <td className="px-4 py-3 text-muted">{fmtDate(u.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </Card>

      <Modal open={auditOpen} onClose={() => { setAuditOpen(false); refreshUsers(); }} title="بررسی سشن‌های تلگرام">
        <div className="space-y-4">
          <p className="text-sm leading-7 text-muted">
            سشن تلگرام هر حساب تأییدشده دوباره تست می‌شود. حساب‌هایی که سشن‌شان منقضی یا خراب شده از حالت تأییدشده درمی‌آیند تا خودشان دوباره حساب را تأیید کنند.
          </p>
          {audit && (audit.running || audit.finishedAt) ? (
            <div className="grid grid-cols-2 gap-3 text-center text-sm sm:grid-cols-4">
              {[
                ['کل', audit.total, ''],
                ['بررسی‌شده', audit.checked, 'text-info'],
                ['منقضی/خراب', audit.expired, 'text-danger'],
                ['نامشخص', audit.unknown, 'text-warn'],
              ].map(([label, value, tone]) => (
                <div key={label as string} className="rounded-xl bg-surface-2 p-3">
                  <div className={`text-lg font-bold ${tone}`}>{fmtNum(value as number)}</div>
                  <div className="text-xs text-muted">{label}</div>
                </div>
              ))}
            </div>
          ) : null}
          {audit?.running ? (
            <div className="flex items-center gap-2 text-sm text-muted">
              <Loader2 className="size-4 animate-spin" /> در حال بررسی… (پنجره را باز بگذارید)
            </div>
          ) : audit?.finishedAt ? (
            <div className="rounded-xl bg-ok/10 px-4 py-3 text-sm leading-7 text-ok">
              بررسی تمام شد؛ {fmtNum(audit.expired)} حساب از حالت تأییدشده خارج شد و باید دوباره تأیید کند.
            </div>
          ) : null}
          <ErrorBox error={auditError} />
          <Button variant="primary" className="w-full" loading={auditBusy || audit?.running} onClick={startAudit}>
            <ShieldOff className="size-4" /> شروع بررسی
          </Button>
        </div>
      </Modal>
    </>
  );
}
