'use client';

import { Bell, ExternalLink, ImagePlus, Pin, Send, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, Empty, ErrorBox, Field, PageHeader, Spinner } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { fmtDateTime, fmtNum, GENDER_LABEL } from '@/lib/format';

interface Item {
  id: string;
  title: string;
  body: string;
  segment: { gender?: string };
  via_bot: boolean;
  bot_sent: number;
  created_at: string;
  expires_at: string | null;
  image_preview: string | null;
  button_text: string | null;
  button_url: string | null;
  markdown: boolean;
  pin_hours: number;
  app_button: boolean;
}

const MARKDOWN_HELP = '*پررنگ* ـ _کج_ ـ __زیرخط__ ـ ~~خط‌خورده~~ ـ ||مخفی|| ـ `کد` ـ [متن لینک](https://example.com)';

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
  const [days, setDays] = useState(7);
  const [viaBot, setViaBot] = useState(true);
  const [image, setImage] = useState<string | null>(null);
  const [buttonText, setButtonText] = useState('');
  const [buttonUrl, setButtonUrl] = useState('');
  const [markdown, setMarkdown] = useState(true);
  const [pinHours, setPinHours] = useState(0);
  const [appButton, setAppButton] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const file = useRef<HTMLInputElement>(null);
  const { data: settings } = useApi<{ support: { telegram: string } }>('admin/v1/settings');
  const [preview, setPreview] = useState<{ html: string; length: number; captionMax: number } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // what Telegram will show, straight from the server's own converter (never a second guess at it)
  useEffect(() => {
    if (title.length < 1 && body.length < 1) return setPreview(null);
    const t = setTimeout(async () => {
      try {
        setPreview(await api.post('admin/v1/announcements/preview', { title, body, markdown }));
        setPreviewError(null);
      } catch (e) {
        setPreview(null);
        setPreviewError((e as Error).message);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [title, body, markdown]);

  /** The button people expect most: it opens the support chat with the first message already typed. */
  function supportButton() {
    const user = settings?.support.telegram?.replace('@', '');
    if (!user) return setError(new Error('اول در تنظیمات، یوزرنیم پشتیبانی را بگذارید'));
    setError(null);
    setButtonText('🛒 خرید عضویت ویژه');
    setButtonUrl(`https://t.me/${user}?text=${encodeURIComponent('سلام 👋 می‌خوام عضویت ویژه بخرم')}`);
  }

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
        segment: { ...(gender ? { gender } : {}) },
        expiresAt: days > 0 ? new Date(Date.now() + days * 86400_000).toISOString() : null,
        viaBot,
        image,
        markdown,
        pinHours,
        appButton,
        button: buttonText.trim() ? { text: buttonText.trim(), url: buttonUrl.trim() || null } : null,
      });
      setTitle('');
      setBody('');
      setImage(null);
      setButtonText('');
      setButtonUrl('');
      setPinHours(0);
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
            <Field label="متن" hint={markdown ? MARKDOWN_HELP : undefined}>
              <textarea className="field min-h-40" value={body} onChange={(e) => setBody(e.target.value)} />
            </Field>
            <label className="-mt-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={markdown} onChange={(e) => setMarkdown(e.target.checked)} />
              <span>قالب‌بندی Markdown</span>
            </label>

            {previewError && <div className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">{previewError}</div>}
            {preview && (
              <Field
                label="پیش‌نمایش در تلگرام"
                hint={
                  image && preview.length > preview.captionMax
                    ? `متن ${fmtNum(preview.length)} حرف است؛ با تصویر بیشتر از ${fmtNum(preview.captionMax)} حرف جا نمی‌شود و پیام بدون تصویر می‌رود`
                    : `${fmtNum(preview.length)} حرف`
                }
              >
                <div
                  dir="rtl"
                  className="whitespace-pre-line rounded-xl border border-line bg-surface-2 p-3 text-sm leading-7 [&_a]:text-brand [&_a]:underline [&_code]:rounded [&_code]:bg-black/40 [&_code]:px-1"
                  dangerouslySetInnerHTML={{ __html: preview.html }}
                />
              </Field>
            )}

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
              <Field
                label="لینک دکمه"
                hint="خالی = باز کردن خود اپ. برای پیام آماده در کادر تایپ کاربر: https://t.me/username?text=متن"
              >
                <input className="field" dir="ltr" placeholder="https://t.me/support" value={buttonUrl} onChange={(e) => setButtonUrl(e.target.value)} />
              </Field>
            </div>
            <button type="button" onClick={supportButton} className="-mt-2 text-xs text-brand hover:underline">
              + دکمه‌ی «خرید عضویت ویژه» با چت پشتیبانی و پیام آماده
            </button>
            <label className="-mt-2 flex items-start gap-2.5 text-sm">
              <input type="checkbox" className="mt-1" checked={appButton} onChange={(e) => setAppButton(e.target.checked)} />
              <span>
                دکمه‌ی «🔥 ورود به Vibe Chat» هم زیرش باشد
                <span className="block text-xs text-muted">
                  هر دو دکمه در همین یک پیام، زیر هم. بدون دکمه‌ی اختصاصی، پیام خودش همین دکمه را دارد.
                </span>
              </span>
            </label>

            <Field label="سنجاق در چت ربات (ساعت)" hint="۰ یعنی سنجاق نشود. بعد از این مدت، ربات خودش برش می‌دارد">
              <input type="number" className="field" value={pinHours} min={0} max={336} onChange={(e) => setPinHours(Number(e.target.value))} />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="مخاطب">
                <select className="field" value={gender} onChange={(e) => setGender(e.target.value)}>
                  <option value="">همه</option>
                  <option value="female">فقط خانم‌ها</option>
                  <option value="male">فقط آقایان</option>
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
                      {a.via_bot ? <Badge tone="ok">ربات: {a.bot_sent}</Badge> : <Badge>بدون ارسال</Badge>}
                      {a.pin_hours > 0 && (
                        <Badge tone="info">
                          <Pin className="ms-1 inline size-3" /> {fmtNum(a.pin_hours)} ساعت
                        </Badge>
                      )}
                      {a.expires_at && new Date(a.expires_at) < new Date() && <Badge>منقضی</Badge>}
                    </div>
                    <p className="mt-1 whitespace-pre-line text-sm text-muted">{a.body}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {a.button_text && (
                        <span className="inline-flex items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1 text-xs">
                          <ExternalLink className="size-3.5 text-brand" />
                          <span className="font-medium">{a.button_text}</span>
                          <span className="text-faint" dir="ltr">
                            {a.button_url || 'باز کردن اپ'}
                          </span>
                        </span>
                      )}
                      {(!a.button_text || (a.app_button && a.button_url)) && (
                        <span className="inline-flex items-center rounded-lg bg-surface-2 px-2.5 py-1 text-xs font-medium">🔥 ورود به Vibe Chat</span>
                      )}
                    </div>
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
