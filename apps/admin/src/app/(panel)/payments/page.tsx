'use client';

import { CreditCard } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Card, Empty, PageHeader, Pagination, Spinner, StatusBadge, Tabs } from '@/components/ui';
import { qs, useApi } from '@/lib/api';
import { fmtDateTime, fmtToman } from '@/lib/format';

interface Row {
  id: string;
  amount_toman: number;
  status: string;
  gateway: string;
  token: string | null;
  method: string | null;
  created_at: string;
  paid_at: string | null;
  user_id: string;
  user_name: string | null;
  tg_username: string | null;
  plan: string;
}

type Status = '' | 'paid' | 'pending' | 'failed' | 'canceled' | 'expired';

/** Online payments through Tetra98. Settlement is automatic (callback, webhook, and a worker re-check). */
export default function PaymentsPage() {
  const [status, setStatus] = useState<Status>('paid');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useApi<{ items: Row[]; total: number; paidSumToman: number; page: number; pageSize: number }>(
    `admin/v1/payments${qs({ status, page })}`,
    { keepPreviousData: true },
  );

  return (
    <>
      <PageHeader title="پرداخت‌ها" subtitle={data ? `جمع پرداخت‌های موفق: ${fmtToman(data.paidSumToman)}` : undefined} />
      <div className="mb-4">
        <Tabs
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          items={[
            { value: 'paid', label: 'موفق' },
            { value: 'pending', label: 'در انتظار پرداخت' },
            { value: 'failed', label: 'ناموفق' },
            { value: 'expired', label: 'منقضی' },
            { value: 'canceled', label: 'لغوشده' },
            { value: '', label: 'همه' },
          ]}
        />
      </div>
      <Card padded={false}>
        {isLoading && !data ? (
          <Spinner />
        ) : !data?.items.length ? (
          <Empty icon={<CreditCard className="size-6" />} title="پرداختی نیست" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted">
                <tr className="border-b border-line">
                  {['کاربر', 'طرح', 'روش', 'مبلغ', 'وضعیت', 'توکن درگاه', 'زمان'].map((h) => (
                    <th key={h} className="px-4 py-3 text-right font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((p) => (
                  <tr key={p.id} className="border-b border-line/60">
                    <td className="px-4 py-3">
                      <Link href={`/users/${p.user_id}`} className="hover:underline">
                        {p.user_name ?? 'کاربر'}
                      </Link>
                      {p.tg_username ? (
                        <div className="text-xs text-faint" dir="ltr">
                          @{p.tg_username}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">{p.plan}</td>
                    <td className="px-4 py-3">
                      <Badge tone="info">تتراپی{p.method === 'card' ? ' · کارت' : p.method === 'online' ? ' · آنلاین' : ''}</Badge>
                    </td>
                    <td className="px-4 py-3 font-medium">{fmtToman(p.amount_toman)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="max-w-40 truncate px-4 py-3 font-mono text-xs text-muted" dir="ltr" title={p.token ?? ''}>
                      {p.token ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-muted">{fmtDateTime(p.paid_at ?? p.created_at)}</td>
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
