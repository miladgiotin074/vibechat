'use client';

import { KeyRound, Plus, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, ErrorBox, Field, Modal, PageHeader, Spinner } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { fmtAgo, ROLE_LABEL } from '@/lib/format';

interface Admin {
  id: string;
  username: string;
  displayName: string | null;
  role: 'superadmin' | 'moderator' | 'support';
  isActive: boolean;
  lastLoginAt: string | null;
}

export default function AdminsPage() {
  const { data, mutate, isLoading } = useApi<{ items: Admin[] }>('admin/v1/admins');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', displayName: '', role: 'moderator' as Admin['role'] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await mutate();
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="مدیران"
        subtitle="ناظر محتوا: عکس‌ها، گزارش‌ها و مسدودسازی. پشتیبانی: کاربران، پرداخت‌ها و عضویت ویژه."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> مدیر جدید
          </Button>
        }
      />
      <ErrorBox error={error} />
      <Card padded={false}>
        {isLoading ? (
          <Spinner />
        ) : (
          <div className="divide-y divide-line/60">
            {data?.items.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <div className="grid size-10 place-items-center rounded-full bg-violet/20 text-violet">
                  <ShieldCheck className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{a.displayName ?? a.username}</div>
                  <div className="text-xs text-faint" dir="ltr">
                    {a.username}
                  </div>
                </div>
                <select
                  className="field w-auto"
                  value={a.role}
                  onChange={(e) => run(() => api.patch(`admin/v1/admins/${a.id}`, { role: e.target.value }))}
                >
                  {Object.entries(ROLE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
                <span className="w-28 text-xs text-muted">{a.lastLoginAt ? `ورود ${fmtAgo(a.lastLoginAt)}` : 'هنوز وارد نشده'}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const pw = prompt('رمز جدید (حداقل ۱۰ کاراکتر):');
                    if (pw) run(() => api.patch(`admin/v1/admins/${a.id}`, { password: pw }));
                  }}
                >
                  <KeyRound className="size-4" />
                </Button>
                <Button size="sm" variant={a.isActive ? 'danger' : 'ok'} onClick={() => run(() => api.patch(`admin/v1/admins/${a.id}`, { isActive: !a.isActive }))}>
                  {a.isActive ? 'غیرفعال‌سازی' : 'فعال‌سازی'}
                </Button>
                {!a.isActive && <Badge>غیرفعال</Badge>}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal open={creating} onClose={() => setCreating(false)} title="مدیر جدید">
        <div className="space-y-4">
          <Field label="نام کاربری" hint="حروف کوچک انگلیسی، عدد، نقطه و _">
            <input className="field" dir="ltr" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })} />
          </Field>
          <Field label="نام نمایشی">
            <input className="field" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
          </Field>
          <Field label="رمز عبور" hint="حداقل ۱۰ کاراکتر">
            <input className="field" dir="ltr" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          <Field label="نقش">
            <select className="field" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Admin['role'] })}>
              {Object.entries(ROLE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Button
            variant="primary"
            className="w-full"
            loading={busy}
            onClick={async () => {
              const ok = await run(() => api.post('admin/v1/admins', { ...form, displayName: form.displayName || undefined }));
              if (ok) {
                setCreating(false);
                setForm({ username: '', password: '', displayName: '', role: 'moderator' });
              }
            }}
          >
            ایجاد
          </Button>
        </div>
      </Modal>
    </>
  );
}
