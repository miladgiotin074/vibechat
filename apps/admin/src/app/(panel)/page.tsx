'use client';

import { Flag, Gem, Heart, MessageCircle, Radio, UserPlus, Users, Wallet } from 'lucide-react';
import Link from 'next/link';
import { Bars, Donut, TrendChart } from '@/components/Charts';
import { Card, ErrorBox, PageHeader, Spinner, Stat } from '@/components/ui';
import { useApi } from '@/lib/api';
import { fmtDateTime, fmtNum, fmtToman } from '@/lib/format';

interface Overview {
  users: { total: number; active: number; onboarding: number; banned: number; deleted: number; premium: number; male: number; female: number };
  pending: { reports: number };
  today: { signups: number; swipes: number; likes: number; matches: number; messages: number; activeUsers: number; revenueToman: number };
  monthRevenueToman: number;
  totals: { matches: number; messages: number };
  onlineNow: number;
  generatedAt: string;
}

interface Daily {
  items: { day: string; signups: number; activeUsers: number; swipes: number; likes: number; matches: number; messages: number; revenueToman: number }[];
}

interface Breakdown {
  provinces: { province_id: number; users: number }[];
  goals: { goal: string; users: number }[];
  ages: { bucket: string; users: number }[];
}

interface Meta {
  provinces: { id: number; name: string }[];
  goals: { id: string; label: string; emoji?: string }[];
}

export default function Dashboard() {
  const overview = useApi<Overview>('admin/v1/stats/overview', { refreshInterval: 30_000 });
  const daily = useApi<Daily>('admin/v1/stats/daily?days=30');
  const breakdown = useApi<Breakdown>('admin/v1/stats/breakdown');
  const meta = useApi<Meta>('v1/meta');

  if (overview.error) return <ErrorBox error={overview.error} />;
  if (!overview.data) return <Spinner />;
  const o = overview.data;
  const provinceName = (id: number) => meta.data?.provinces.find((p) => p.id === id)?.name ?? id;
  const goal = (id: string) => meta.data?.goals.find((g) => g.id === id);

  return (
    <>
      <PageHeader title="داشبورد" subtitle={`آخرین بروزرسانی: ${fmtDateTime(o.generatedAt)}`} />

      {o.pending.reports > 0 && (
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          {[
            { href: '/reports', n: o.pending.reports, label: 'گزارش باز', icon: <Flag className="size-5" /> },
          ].map((q) => (
            <Link
              key={q.href}
              href={q.href}
              className="card flex items-center gap-4 p-4 transition hover:border-brand/40 hover:bg-surface-2"
            >
              <div className="brand-gradient grid size-11 place-items-center rounded-2xl text-white shadow-lg shadow-brand/25">{q.icon}</div>
              <div>
                <div className="text-xl font-bold">{fmtNum(q.n)}</div>
                <div className="text-xs text-muted">{q.label}</div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Stat label="کل کاربران" value={o.users.total} icon={<Users className="size-4" />} hint={`${fmtNum(o.users.active)} فعال، ${fmtNum(o.users.onboarding)} در حال ثبت‌نام`} />
        <Stat label="آنلاین الان" value={o.onlineNow} tone="ok" icon={<Radio className="size-4" />} hint={`${fmtNum(o.today.activeUsers)} کاربر فعال امروز`} />
        <Stat label="ثبت‌نام امروز" value={o.today.signups} tone="info" icon={<UserPlus className="size-4" />} />
        <Stat label="مچ امروز" value={o.today.matches} icon={<Heart className="size-4" />} hint={`${fmtNum(o.today.likes)} لایک از ${fmtNum(o.today.swipes)} سوایپ`} />
        <Stat label="پیام امروز" value={o.today.messages} tone="violet" icon={<MessageCircle className="size-4" />} hint={`${fmtNum(o.totals.messages)} پیام در کل`} />
        <Stat label="کاربران ویژه" value={o.users.premium} tone="warn" icon={<Gem className="size-4" />} />
        <Stat label="درآمد امروز" value={fmtToman(o.today.revenueToman)} tone="ok" icon={<Wallet className="size-4" />} />
        <Stat label="درآمد ۳۰ روز" value={fmtToman(o.monthRevenueToman)} tone="ok" icon={<Wallet className="size-4" />} />
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
        <Card title="تعامل — مچ و پیام">
          {daily.data ? (
            <TrendChart
              data={daily.data.items}
              series={[
                { key: 'messages', label: 'پیام', color: '#38bdf8' },
                { key: 'matches', label: 'مچ', color: '#ff7a45' },
              ]}
            />
          ) : (
            <Spinner />
          )}
        </Card>
        <Card title="درآمد روزانه (تومان)">
          {daily.data ? <Bars data={daily.data.items.map((d) => ({ ...d, label: d.day.slice(5) }))} xKey="label" yKey="revenueToman" label="درآمد" color="#22c55e" /> : <Spinner />}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="بازه‌ی سنی">
          {breakdown.data ? <Bars data={breakdown.data.ages} xKey="bucket" yKey="users" label="کاربر" color="#8b5cf6" height={220} /> : <Spinner />}
        </Card>
        <Card title="استان‌های پرکاربر">
          <div className="space-y-2.5">
            {breakdown.data?.provinces.map((p) => {
              const max = breakdown.data!.provinces[0]?.users || 1;
              return (
                <div key={p.province_id}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span>{provinceName(p.province_id)}</span>
                    <span className="text-muted">{fmtNum(p.users)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-surface-3">
                    <div className="brand-gradient h-full rounded-full" style={{ width: `${(p.users / max) * 100}%` }} />
                  </div>
                </div>
              );
            }) ?? <Spinner />}
          </div>
        </Card>
        <Card title="هدف از آشنایی">
          <div className="space-y-2">
            {breakdown.data?.goals.map((g) => (
              <div key={g.goal} className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2 text-sm">
                <span>
                  {goal(g.goal)?.emoji} {goal(g.goal)?.label ?? g.goal}
                </span>
                <span className="font-semibold">{fmtNum(g.users)}</span>
              </div>
            )) ?? <Spinner />}
          </div>
        </Card>
      </div>
    </>
  );
}
