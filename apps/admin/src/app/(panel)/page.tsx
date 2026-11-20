'use client';

import { Flag, MessageCircle, Radio, ShieldCheck, SkipForward, UserPlus, Users } from 'lucide-react';
import Link from 'next/link';
import { Bars, Donut, TrendChart } from '@/components/Charts';
import { Card, ErrorBox, PageHeader, Spinner, Stat } from '@/components/ui';
import { useApi } from '@/lib/api';
import { fmtDateTime, fmtNum } from '@/lib/format';

interface Overview {
  users: {
    total: number;
    active: number;
    onboarding: number;
    banned: number;
    deleted: number;
    male: number;
    female: number;
    verified: number;
    verified_via_phone: number;
  };
  pending: { reports: number };
  today: { signups: number; swipes: number; matches: number; messages: number; activeUsers: number };
  totals: { matches: number; messages: number };
  onlineNow: number;
  generatedAt: string;
}

interface Daily {
  items: { day: string; signups: number; activeUsers: number; skips: number; chats: number; messages: number }[];
}

interface Breakdown {
  ages: { bucket: string; users: number }[];
}

export default function Dashboard() {
  const overview = useApi<Overview>('admin/v1/stats/overview', { refreshInterval: 30_000 });
  const daily = useApi<Daily>('admin/v1/stats/daily?days=30');
  const breakdown = useApi<Breakdown>('admin/v1/stats/breakdown');

  if (overview.error) return <ErrorBox error={overview.error} />;
  if (!overview.data) return <Spinner />;
  const o = overview.data;

  return (
    <>
      <PageHeader title="داشبورد" subtitle={`آخرین بروزرسانی: ${fmtDateTime(o.generatedAt)}`} />

      {o.pending.reports > 0 && (
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          {[{ href: '/reports', n: o.pending.reports, label: 'گزارش باز', icon: <Flag className="size-5" /> }].map((q) => (
            <Link key={q.href} href={q.href} className="card flex items-center gap-4 p-4 transition hover:border-brand/40 hover:bg-surface-2">
              <div className="brand-gradient grid size-11 place-items-center rounded-2xl text-white shadow-lg shadow-brand/25">{q.icon}</div>
              <div>
                <div className="text-xl font-bold">{fmtNum(q.n)}</div>
                <div className="text-xs text-muted">{q.label}</div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        <Stat label="کل کاربران" value={o.users.total} icon={<Users className="size-4" />} hint={`${fmtNum(o.users.active)} فعال، ${fmtNum(o.users.onboarding)} در حال ثبت‌نام`} />
        <Link
          href="/users?verified=true"
          className="card col-span-2 flex items-center gap-4 p-4 transition hover:border-ok/40 hover:bg-surface-2 md:col-span-1"
        >
          <div className="grid size-11 place-items-center rounded-2xl bg-ok/20 text-ok shadow-lg shadow-ok/10">
            <ShieldCheck className="size-5" />
          </div>
          <div>
            <div className="text-xl font-bold">{fmtNum(o.users.verified)}</div>
            <div className="text-xs text-muted">تأییدشده — {fmtNum(o.users.verified_via_phone)} با سشن تلگرام</div>
          </div>
        </Link>
        <Stat label="آنلاین الان" value={o.onlineNow} tone="ok" icon={<Radio className="size-4" />} hint={`${fmtNum(o.today.activeUsers)} کاربر فعال امروز`} />
        <Stat label="ثبت‌نام امروز" value={o.today.signups} tone="info" icon={<UserPlus className="size-4" />} />
        <Stat label="گفتگوی تازه‌ی امروز" value={o.today.matches} tone="violet" icon={<MessageCircle className="size-4" />} hint={`${fmtNum(o.totals.matches)} گفتگو در کل`} />
        <Stat label="پیام امروز" value={o.today.messages} tone="violet" icon={<MessageCircle className="size-4" />} hint={`${fmtNum(o.totals.messages)} پیام در کل`} />
        <Stat label="رد کردن امروز" value={o.today.swipes} icon={<SkipForward className="size-4" />} />
        <Stat label="مسدود / حذف‌شده" value={`${fmtNum(o.users.banned)} / ${fmtNum(o.users.deleted)}`} tone="danger" icon={<Flag className="size-4" />} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card title="رشد کاربران — ۳۰ روز اخیر" className="xl:col-span-2">
          {daily.data ? (
            <TrendChart
              data={daily.data.items}
              series={[
                { key: 'activeUsers', label: 'کاربر فعال', color: '#8b5cf6' },
                { key: 'signups', label: 'ثبت‌نام', color: '#ff2d6f' },
              ]}
            />
          ) : (
            <Spinner />
          )}
        </Card>
        <Card title="ترکیب جنسیتی کاربران فعال">
          <Donut
            data={[
              { name: 'زن', value: o.users.female, color: '#ff2d6f' },
              { name: 'مرد', value: o.users.male, color: '#8b5cf6' },
            ]}
          />
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card title="تعامل — گفتگو و پیام">
          {daily.data ? (
            <TrendChart
              data={daily.data.items}
              series={[
                { key: 'messages', label: 'پیام', color: '#38bdf8' },
                { key: 'chats', label: 'گفتگوی تازه', color: '#ff7a45' },
              ]}
            />
          ) : (
            <Spinner />
          )}
        </Card>
        <Card title="بازه‌ی سنی">
          {breakdown.data ? <Bars data={breakdown.data.ages} xKey="bucket" yKey="users" label="کاربر" color="#8b5cf6" height={220} /> : <Spinner />}
        </Card>
      </div>
    </>
  );
}
