'use client';

import { Bell, Send, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, Empty, ErrorBox, Field, PageHeader, Spinner } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { fmtDateTime, GENDER_LABEL } from '@/lib/format';

interface Item {
  id: string;
  title: string;
  body: string;
  segment: { gender?: string; premium?: boolean };
  created_at: string;
  expires_at: string | null;
}

export default function AnnouncementsPage() {
  const { data, mutate, isLoading } = useApi<{ items: Item[] }>('admin/v1/announcements');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [gender, setGender] = useState('');
  const [premium, setPremium] = useState('');
  const [days, setDays] = useState(7);
  const [viaBot, setViaBot] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await api.post('admin/v1/announcements', {
        title,
        body,
        segment: { ...(gender ? { gender } : {}), ...(premium ? { premium: premium === 'true' } : {}) },
        expiresAt: days > 0 ? new Date(Date.now() + days * 86400_000).toISOString() : null,
        viaBot,
      });
      setViaBot(false);
      setTitle('');
      setBody('');
      await mutate();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="اطلاعیه‌ها" subtitle="پیام همگانی در اپ — و در صورت انتخاب، در تلگرام از طریق ربات." />
      <div className="grid gap-6 lg:grid-cols-5">
        <Card title="اطلاعیه‌ی جدید" className="lg:col-span-2">
          <div className="space-y-4">
            <Field label="عنوان">
              <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="متن">
              <textarea className="field min-h-32" value={body} onChange={(e) => setBody(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="مخاطب">
                <select className="field" value={gender} onChange={(e) => setGender(e.target.value)}>
                  <option value="">همه</option>
                  <option value="female">فقط خانم‌ها</option>
                  <option value="male">فقط آقایان</option>
                </select>
              </Field>
              <Field label="عضویت">
                <select className="field" value={premium} onChange={(e) => setPremium(e.target.value)}>
                  <option value="">همه</option>
                  <option value="true">فقط ویژه</option>
                  <option value="false">فقط عادی</option>
                </select>
              </Field>
            </div>
            <Field label="مدت نمایش (روز)" hint="۰ یعنی بدون انقضا">
              <input type="number" className="field" value={days} min={0} onChange={(e) => setDays(Number(e.target.value))} />
            </Field>
            <label className="flex items-start gap-2.5 rounded-xl bg-surface-2 p-3 text-sm">
              <input type="checkbox" className="mt-1" checked={viaBot} onChange={(e) => setViaBot(e.target.checked)} />
              <span>
                ارسال به تلگرام کاربران هم (از طریق ربات)
                <span className="block text-xs text-muted">با سرعت مجاز تلگرام (~۲۵ پیام در ثانیه) در پس‌زمینه ارسال می‌شود. با احتیاط استفاده کنید.</span>
              </span>
            </label>
            <ErrorBox error={error} />
            <Button variant="primary" className="w-full" loading={busy} disabled={title.length < 2 || body.length < 2} onClick={send}>
              <Send className="size-4" /> ارسال
            </Button>
          </div>
        </Card>
        <Card title="ارسال‌شده‌ها" className="lg:col-span-3" padded={false}>
          {isLoading ? (
            <Spinner />
          ) : !data?.items.length ? (
            <Empty icon={<Bell className="size-6" />} title="اطلاعیه‌ای ارسال نشده" />
          ) : (
            <div className="divide-y divide-line/60">
              {data.items.map((a) => (
                <div key={a.id} className="flex gap-4 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 font-medium">
                      {a.title}
                      {a.segment.gender && <Badge tone="violet">{GENDER_LABEL[a.segment.gender]}</Badge>}
                      {a.segment.premium !== undefined && <Badge tone="warn">{a.segment.premium ? 'ویژه' : 'عادی'}</Badge>}
                      {a.expires_at && new Date(a.expires_at) < new Date() && <Badge>منقضی</Badge>}
                    </div>
                    <p className="mt-1 whitespace-pre-line text-sm text-muted">{a.body}</p>
                    <div className="mt-1 text-xs text-faint">{fmtDateTime(a.created_at)}</div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      if (!confirm('این اطلاعیه حذف شود؟')) return;
                      await api.del(`admin/v1/announcements/${a.id}`);
                      mutate();
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
