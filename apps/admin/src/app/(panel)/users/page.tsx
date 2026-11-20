'use client';

import { Search, Users as UsersIcon } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Avatar, Badge, Card, Empty, ErrorBox, PageHeader, Pagination, Spinner, StatusBadge } from '@/components/ui';
import { qs, useApi } from '@/lib/api';
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

export default function UsersPage() {
  const sp = useSearchParams();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [gender, setGender] = useState('');
  const [shadow, setShadow] = useState('');
  const [verified, setVerified] = useState(() => (sp.get('verified') === 'true' ? 'true' : ''));
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const { data, error, isLoading } = useApi<Page>(`admin/v1/users${qs({ q, status, gender, shadow, verified, page })}`, { keepPreviousData: true });

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
      <PageHeader title="کاربران" subtitle={data ? `${fmtNum(data.total)} کاربر` : undefined} />
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
    </>
  );
}
