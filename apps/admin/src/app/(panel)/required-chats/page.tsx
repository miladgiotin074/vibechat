'use client';

import { ExternalLink, Plus, Radio, Trash2, Users } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, Empty, ErrorBox, Field, PageHeader, Spinner, Toggle } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';

interface Item {
  id: string;
  chat_id: string;
  title: string;
  kind: 'channel' | 'group';
  username: string | null;
  link: string;
  position: number;
  is_active: boolean;
  created_at: string;
}

interface Candidate {
  chat_id: string;
  title: string | null;
  kind: 'channel' | 'group';
  username: string | null;
  updated_at: string;
}

const KIND = { channel: 'کانال', group: 'گروه' } as const;

export default function RequiredChatsPage() {
  const { data, mutate, isLoading } = useApi<{ items: Item[]; candidates: Candidate[]; botReady: boolean }>('admin/v1/required-chats');
  const [chat, setChat] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function run(key: string, work: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await work();
      await mutate();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  const add = (ref: string, l?: string) =>
    run(`add:${ref}`, async () => {
      await api.post('admin/v1/required-chats', { chat: ref, ...(l ? { link: l } : {}) });
      setChat('');
      setLink('');
    });

  const move = (items: Item[], i: number, dir: -1 | 1) =>
    run(`move:${items[i]!.id}`, async () => {
      const order = [...items];
      [order[i], order[i + dir]] = [order[i + dir]!, order[i]!];
      // renumber the whole (short) list so the order never depends on old values
      await Promise.all(order.map((c, position) => (c.position === position ? null : api.patch(`admin/v1/required-chats/${c.id}`, { position }))));
    });

  return (
    <>
      <PageHeader
        title="عضویت اجباری"
        subtitle="کانال‌ها و گروه‌هایی که کاربر (خانم و آقا) بعد از ثبت‌نام، پیش از استفاده از اپ باید عضوشان شود. ربات عضویت را خودش بررسی می‌کند."
      />
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-2">
          <Card title="افزودن کانال یا گروه">
            <div className="space-y-4">
              <ol className="list-decimal space-y-1 ps-5 text-sm text-muted">
                <li>ربات را در کانال یا گروه <b>ادمین</b> کنید.</li>
                <li>یوزرنیم (مثل @vibe_channel) یا شناسه‌ی عددی را وارد کنید. کانال‌هایی که ربات تازه ادمینشان شده، پایین همین کادر آماده‌ی افزودن‌اند.</li>
                <li>لینک دعوت اختیاری است: برای کانال عمومی از یوزرنیم ساخته می‌شود و برای خصوصی، ربات خودش لینک می‌سازد.</li>
              </ol>
              <Field label="یوزرنیم یا شناسه">
                <input className="field" dir="ltr" placeholder="@channel  یا  -1001234567890" value={chat} onChange={(e) => setChat(e.target.value)} />
              </Field>
              <Field label="لینک دعوت (اختیاری)">
                <input className="field" dir="ltr" placeholder="https://t.me/+AbCd…" value={link} onChange={(e) => setLink(e.target.value)} />
              </Field>
              <ErrorBox error={error} />
              <Button variant="primary" className="w-full" loading={busy === `add:${chat}`} disabled={chat.trim().length < 2 || data?.botReady === false} onClick={() => add(chat, link.trim())}>
                <Plus className="size-4" /> بررسی و افزودن
              </Button>
              {data?.botReady === false && <p className="text-sm text-danger">توکن ربات روی سرور تنظیم نشده است.</p>}
            </div>
          </Card>

          {!!data?.candidates.length && (
            <Card title="ربات در این‌ها ادمین است" padded={false}>
              <div className="divide-y divide-line/60">
                {data.candidates.map((c) => (
                  <div key={c.chat_id} className="flex items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{c.title ?? c.chat_id}</div>
                      <div className="text-xs text-faint" dir="ltr">
                        {c.username ? `@${c.username}` : c.chat_id}
                      </div>
                    </div>
                    <Badge tone="violet">{KIND[c.kind] ?? c.kind}</Badge>
                    <Button size="sm" loading={busy === `add:${c.chat_id}`} onClick={() => add(c.chat_id)}>
                      <Plus className="size-4" /> افزودن
                    </Button>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        <Card title="لیست عضویت اجباری" className="lg:col-span-3" padded={false}>
          {isLoading ? (
            <Spinner />
          ) : !data?.items.length ? (
            <Empty icon={<Radio className="size-6" />} title="هنوز چیزی اضافه نشده" hint="تا وقتی این لیست خالی است، کاربر مستقیم وارد اپ می‌شود." />
          ) : (
            <div className="divide-y divide-line/60">
              {data.items.map((c, i, all) => (
                <div key={c.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                  <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted">
                    {c.kind === 'channel' ? <Radio className="size-5" /> : <Users className="size-5" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 font-medium">
                      {c.title}
                      <Badge tone="violet">{KIND[c.kind]}</Badge>
                      {!c.is_active && <Badge>غیرفعال</Badge>}
                    </div>
                    <a href={c.link} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-brand" dir="ltr">
                      {c.link} <ExternalLink className="size-3" />
                    </a>
                    <div className="mt-0.5 text-xs text-faint">
                      <span dir="ltr">{c.chat_id}</span> · {fmtDateTime(c.created_at)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" disabled={i === 0 || !!busy} onClick={() => move(all, i, -1)} aria-label="بالاتر">
                      ↑
                    </Button>
                    <Button size="sm" variant="ghost" disabled={i === all.length - 1 || !!busy} onClick={() => move(all, i, 1)} aria-label="پایین‌تر">
                      ↓
                    </Button>
                    <Toggle checked={c.is_active} onChange={(v) => run(`toggle:${c.id}`, () => api.patch(`admin/v1/required-chats/${c.id}`, { isActive: v }))} />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (!confirm(`«${c.title}» از عضویت اجباری حذف شود؟`)) return;
                        void run(`del:${c.id}`, () => api.del(`admin/v1/required-chats/${c.id}`));
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
