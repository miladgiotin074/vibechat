'use client';

import clsx from 'clsx';
import { CheckCircle2, CloudUpload, ImageIcon, ImagePlus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Badge, Button, ErrorBox, PageHeader, Spinner } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { fmtAgo, fmtNum } from '@/lib/format';

interface Slot {
  id: string;
  title: string;
  when: string;
  image: { preview: string; width: number; height: number; bytes: number; onTelegram: boolean; sent: number; updatedAt: string } | null;
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

/** Pictures on the bot's messages: one per kind of message, with a default for the rest. */
export default function BotMediaPage() {
  const { data, isLoading, mutate } = useApi<{ items: Slot[] }>('admin/v1/bot-media');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const items = data?.items ?? [];
  const hasDefault = !!items.find((s) => s.id === 'default')?.image;
  const done = items.filter((s) => s.image).length;

  async function upload(slot: string, file: File) {
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) return setError(new Error('فقط تصویر PNG، JPG یا WebP'));
    setBusy(slot);
    setError(null);
    try {
      const image = await toDataUrl(file);
      await mutate(await api.put<{ items: Slot[] }>(`admin/v1/bot-media/${slot}`, { image }), { revalidate: false });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  async function remove(slot: Slot) {
    if (!confirm(`تصویر «${slot.title}» حذف شود؟`)) return;
    setBusy(slot.id);
    setError(null);
    try {
      await mutate(await api.del<{ items: Slot[] }>(`admin/v1/bot-media/${slot.id}`), { revalidate: false });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title="تصاویر ربات"
        subtitle="هر پیامی که ربات برای کاربر می‌فرستد با یک تصویر ارسال می‌شود. برای هر نوع پیام تصویر خودش را بگذارید؛ پیام‌هایی که تصویر ندارند از تصویر «پیش‌فرض» استفاده می‌کنند."
      />

      <div className="card mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm text-muted">
        <span>
          📐 اندازه‌ی پیشنهادی:{' '}
          <b className="text-ink" dir="ltr">
            1280×720
          </b>{' '}
          (افقی ۱۶:۹)، JPG یا PNG
        </span>
        <span>⚡ هر تصویر فقط یک بار به تلگرام آپلود می‌شود و بعد از آن از همان نسخه استفاده می‌شود</span>
        <span className="ms-auto">
          <Badge tone={done === items.length && items.length ? 'ok' : 'brand'}>
            {fmtNum(done)} از {fmtNum(items.length)} تصویر
          </Badge>
        </span>
      </div>

      <ErrorBox error={error} />

      {isLoading ? (
        <div className="grid place-items-center py-20">
          <Spinner />
        </div>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((s) => (
            <SlotCard key={s.id} slot={s} hasDefault={hasDefault} busy={busy === s.id} locked={!!busy} onPick={(f) => upload(s.id, f)} onRemove={() => remove(s)} />
          ))}
        </div>
      )}
    </>
  );
}

function SlotCard({
  slot,
  hasDefault,
  busy,
  locked,
  onPick,
  onRemove,
}: {
  slot: Slot;
  hasDefault: boolean;
  busy: boolean;
  locked: boolean;
  onPick: (f: File) => void;
  onRemove: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const img = slot.image;
  const isDefault = slot.id === 'default';
  return (
    <section className={clsx('card overflow-hidden', isDefault && 'ring-1 ring-brand/40')}>
      <button
        type="button"
        disabled={locked}
        onClick={() => input.current?.click()}
        className="group relative block aspect-video w-full bg-black/40"
        aria-label={`آپلود تصویر ${slot.title}`}
      >
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img.preview} alt="" className="size-full object-contain" />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-2 text-muted">
            <ImageIcon className="size-8 opacity-60" />
            <span className="text-xs">{isDefault ? 'تصویر پیش‌فرض هنوز گذاشته نشده' : hasDefault ? 'از تصویر پیش‌فرض استفاده می‌شود' : 'بدون تصویر (فقط متن)'}</span>
          </div>
        )}
        <span className="absolute inset-0 grid place-items-center bg-black/55 opacity-0 transition group-hover:opacity-100">
          <span className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm text-white backdrop-blur">
            <ImagePlus className="size-4" /> {img ? 'تعویض تصویر' : 'آپلود تصویر'}
          </span>
        </span>
        {busy ? (
          <span className="absolute inset-0 grid place-items-center bg-black/60">
            <Spinner />
          </span>
        ) : null}
      </button>

      <div className="space-y-3 p-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{slot.title}</h3>
            {isDefault ? <Badge tone="brand">پیش‌فرض</Badge> : null}
            <code className="ms-auto text-[11px] text-muted" dir="ltr">
              {slot.id}
            </code>
          </div>
          <p className="mt-1 text-xs leading-6 text-muted">{slot.when}</p>
        </div>

        {img ? (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {img.onTelegram ? (
              <Badge tone="ok">
                <CheckCircle2 className="size-3.5" /> روی سرور تلگرام
              </Badge>
            ) : (
              <Badge tone="warn">
                <CloudUpload className="size-3.5" /> با اولین ارسال آپلود می‌شود
              </Badge>
            )}
            <Badge>
              <span dir="ltr">
                {img.width}×{img.height}
              </span>
            </Badge>
            <Badge>{fmtNum(Math.round(img.bytes / 1024))} KB</Badge>
            {img.sent ? <Badge tone="info">{fmtNum(img.sent)} ارسال</Badge> : null}
            <span className="ms-auto text-muted">{fmtAgo(img.updatedAt)}</span>
          </div>
        ) : null}

        <div className="flex gap-2">
          <Button size="sm" variant={img ? 'soft' : 'primary'} disabled={locked} onClick={() => input.current?.click()} className="flex-1">
            <ImagePlus className="size-4" /> {img ? 'تعویض' : 'آپلود تصویر'}
          </Button>
          {img ? (
            <Button size="sm" variant="danger" disabled={locked} onClick={onRemove} aria-label="حذف تصویر">
              <Trash2 className="size-4" />
            </Button>
          ) : null}
        </div>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) onPick(f);
          }}
        />
      </div>
    </section>
  );
}
