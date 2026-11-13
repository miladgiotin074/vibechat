'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button, Card, PageHeader, Spinner } from '@/components/ui';
import { qs, useApi } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';

interface Log {
  id: string;
  username: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  meta: unknown;
  created_at: string;
}

const ACTIONS: Record<string, string> = {
  login: 'ورود به پنل',
  'password.change': 'تغییر رمز',
  'user.update': 'ویرایش کاربر',
  'user.ban': 'مسدودسازی کاربر',
  'user.suspend': 'تعلیق کاربر',
  'user.unban': 'رفع مسدودی',
  'user.premium': 'تغییر عضویت ویژه',
  'user.delete': 'حذف حساب',
  'photo.approve': 'تأیید عکس',
  'photo.reject': 'رد عکس',
  'verification.approve': 'تأیید هویت',
  'verification.reject': 'رد تأیید هویت',
  'report.view': 'مشاهده‌ی گزارش',
  'report.dismiss': 'رد گزارش',
  'report.warn': 'اخطار به کاربر',
  'report.suspend': 'تعلیق از گزارش',
  'report.ban': 'مسدودسازی از گزارش',
  'plan.create': 'ایجاد طرح',
  'plan.update': 'ویرایش طرح',
  'settings.update': 'تغییر تنظیمات',
  'announcement.create': 'ارسال اطلاعیه',
  'announcement.delete': 'حذف اطلاعیه',
  'admin.create': 'ایجاد مدیر',
  'admin.update': 'ویرایش مدیر',
};

export default function AuditPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useApi<{ items: Log[] }>(`admin/v1/audit-logs${qs({ page })}`, { keepPreviousData: true });

  return (
    <>
      <PageHeader title="گزارش فعالیت مدیران" subtitle="هر اقدام مدیریتی اینجا ثبت می‌شود." />
      <Card padded={false}>
        {isLoading && !data ? (
          <Spinner />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted">
                <tr className="border-b border-line">
                  {['زمان', 'مدیر', 'اقدام', 'هدف', 'جزئیات'].map((h) => (
                    <th key={h} className="px-4 py-3 text-right font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data?.items.map((l) => (
                  <tr key={l.id} className="border-b border-line/60 align-top">
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{fmtDateTime(l.created_at)}</td>
                    <td className="px-4 py-3" dir="ltr">
                      {l.username ?? '—'}
                    </td>
                    <td className="px-4 py-3">{ACTIONS[l.action] ?? l.action}</td>
                    <td className="px-4 py-3">
                      {l.target_type === 'user' && l.target_id ? (
                        <Link href={`/users/${l.target_id}`} className="text-info hover:underline">
                          کاربر
                        </Link>
                      ) : (
                        <span className="text-muted">{l.target_type ?? '—'}</span>
                      )}
                    </td>
                    <td className="max-w-md px-4 py-3">
                      {l.meta ? <code className="block truncate text-xs text-faint" dir="ltr">{JSON.stringify(l.meta)}</code> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex justify-between border-t border-line px-5 py-3">
          <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            جدیدتر
          </Button>
          <Button size="sm" variant="ghost" disabled={(data?.items.length ?? 0) < 50} onClick={() => setPage(page + 1)}>
            قدیمی‌تر
          </Button>
        </div>
      </Card>
    </>
  );
}
