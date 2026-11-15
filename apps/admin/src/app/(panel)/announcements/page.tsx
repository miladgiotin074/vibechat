'use client';

import { Bell, ExternalLink, ImagePlus, Send, Trash2, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { Badge, Button, Card, Empty, ErrorBox, Field, PageHeader, Spinner } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { fmtDateTime, GENDER_LABEL } from '@/lib/format';

interface Item {
  id: string;
  title: string;
  body: string;
  segment: { gender?: string; premium?: boolean };
  via_bot: boolean;
  bot_sent: number;
  created_at: string;
  expires_at: string | null;
  image_preview: string | null;
  button_text: string | null;
  button_url: string | null;
}

/**
 * Shrinks the picked image in the browser before upload (the panel proxies JSON, so the image goes
 * as a data URL): at most 1600 px, high-quality JPEG. The server checks and re-encodes it anyway.
 */
async function toDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0b0a10';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.92);
}

export default function AnnouncementsPage() {
  const { data, mutate, isLoading } = useApi<{ items: Item[] }>('admin/v1/announcements');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [gender, setGender] = useState('');
  const [premium, setPremium] = useState('');
  const [days, setDays] = useState(7);
  const [viaBot, setViaBot] = useState(true);
  const [image, setImage] = useState<string | null>(null);
  const [buttonText, setButtonText] = useState('');
  const [buttonUrl, setButtonUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const file = useRef<HTMLInputElement>(null);

  async function pick(f: File) {
    if (!/^image\/(png|jpe?g|webp)$/.test(f.type)) return setError(new Error('فقط تصویر PNG، JPG یا WebP'));
    setError(null);
    try {
      setImage(await toDataUrl(f));
    } catch (e) {
      setError(e);
    }
  }

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
        image,
        button: buttonText.trim() ? { text: buttonText.trim(), url: buttonUrl.trim() || null } : null,
      });
      setTitle('');
      setBody('');
      setImage(null);
      setButtonText('');
      setButtonUrl('');
      await mutate();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="اطلاعیه‌ها" subtitle="پیام همگانی که ربات برای کاربران می‌فرستد — با تصویر و دکمه‌ی دلخواه." />
      <div className="grid gap-6 lg:grid-cols-5">
        <Card title="اطلاعیه‌ی جدید" className="lg:col-span-2">
          <div className="space-y-4">
            <Field label="عنوان">
              <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="متن">
              <textarea className="field min-h-32" value={body} onChange={(e) => setBody(e.target.value)} />
            </Field>

            <Field label="تصویر (اختیاری)" hint="اندازه‌ی پیشنهادی ۱۲۸۰×۷۲۰. بدون تصویر، از «تصاویر ربات ← اطلاعیه‌ی همگانی» استفاده می‌شود">
              {image ? (
                <div className="relative overflow-hidden rounded-xl border border-line">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image} alt="" className="max-h-44 w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setImage(null)}
                    className="absolute left-2 top-2 grid size-8 place-items-center rounded-full bg-black/70 text-white hover:bg-black"
                    aria-label="حذف تصویر"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => file.current?.click()}
                  className="flex h-24 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line text-sm text-muted hover:border-brand hover:text-ink"
                >
                  <ImagePlus className="size-5" /> انتخاب تصویر
                </button>
              )}
              <input
                ref={file}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void pick(f);
                }}
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="متن دکمه (اختیاری)">
                <input className="field" placeholder="مثلاً: گفتگو با پشتیبانی" value={buttonText} onChange={(e) => setButtonText(e.target.value)} />
              </Field>
              <Field label="لینک دکمه" hint="خالی = باز کردن خود اپ">
                <input className="field" dir="ltr" placeholder="https://t.me/support" value={buttonUrl} onChange={(e) => setButtonUrl(e.target.value)} />
              </Field>
            </div>

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
                ارسال به تلگرام کاربران (از طریق ربات)
                <span className="block text-xs text-muted">
                  با سرعت مجاز تلگرام (~۲۵ پیام در ثانیه) در پس‌زمینه ارسال می‌شود. بدون این تیک، اطلاعیه فقط ذخیره می‌شود و به دست کسی نمی‌رسد.
                </span>
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
                  {a.image_preview && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.image_preview} alt="" className="size-16 shrink-0 rounded-xl border border-line object-cover" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 font-medium">
                      {a.title}
                      {a.segment.gender && <Badge tone="violet">{GENDER_LABEL[a.segment.gender]}</Badge>}
                      {a.segment.premium !== undefined && <Badge tone="warn">{a.segment.premium ? 'ویژه' : 'عادی'}</Badge>}
                      {a.via_bot ? <Badge tone="ok">ربات: {a.bot_sent}</Badge> : <Badge>بدون ارسال</Badge>}
                      {a.expires_at && new Date(a.expires_at) < new Date() && <Badge>منقضی</Badge>}
                    </div>
                    <p className="mt-1 whitespace-pre-line text-sm text-muted">{a.body}</p>
                    {a.button_text && (
                      <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1 text-xs">
                        <ExternalLink className="size-3.5 text-brand" />
                        <span className="font-medium">{a.button_text}</span>
                        <span className="text-faint" dir="ltr">
                          {a.button_url || 'باز کردن اپ'}
                        </span>
                      </div>
                    )}
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
