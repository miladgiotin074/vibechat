'use client';

import { Gem, Pencil, Plus, Star, Zap } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, Empty, ErrorBox, Field, Modal, PageHeader, Spinner, Toggle } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { fmtNum, fmtToman } from '@/lib/format';

interface Plan {
  id: string;
  title: string;
  description: string | null;
  kind: Kind;
  quantity: number;
  duration_days: number;
  price_toman: number;
  old_price_toman: number | null;
  badge: string | null;
  is_active: boolean;
  sort: number;
  sold: number;
}

type Kind = 'premium' | 'boost' | 'superlikes';
const KIND_LABEL: Record<Kind, string> = { premium: 'عضویت ویژه', boost: 'بسته‌ی بوست', superlikes: 'بسته‌ی سوپرلایک' };

const EMPTY = { title: '', description: '', kind: 'premium' as Kind, quantity: 0, durationDays: 30, priceToman: 99000, oldPriceToman: 0, badge: '', isActive: true, sort: 0 };

export default function PlansPage() {
  const { data, mutate, isLoading } = useApi<{ items: Plan[] }>('admin/v1/plans');
  const [editing, setEditing] = useState<{ id?: string; form: typeof EMPTY } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function save() {
    if (!editing) return;
    setBusy(true);
    setError(null);
    const body = { ...editing.form, description: editing.form.description || null, badge: editing.form.badge || null, oldPriceToman: editing.form.oldPriceToman || null };
    try {
      if (editing.id) await api.put(`admin/v1/plans/${editing.id}`, body);
      else await api.post('admin/v1/plans', body);
      setEditing(null);
      await mutate();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const set = <K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) => setEditing((e) => (e ? { ...e, form: { ...e.form, [k]: v } } : e));

  return (
    <>
      <PageHeader
        title="طرح‌های عضویت ویژه"
        subtitle="قیمت‌ها به تومان؛ پرداخت از درگاه آنلاین انجام می‌شود."
        actions={
          <Button variant="primary" onClick={() => setEditing({ form: { ...EMPTY } })}>
            <Plus className="size-4" /> طرح جدید
          </Button>
        }
      />
      {isLoading ? (
        <Spinner />
      ) : !data?.items.length ? (
        <Card>
          <Empty icon={<Gem className="size-6" />} title="هنوز طرحی تعریف نشده" hint="بدون طرح فعال، بخش خرید در اپ خالی است." />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.items.map((p) => (
            <div key={p.id} className="card relative overflow-hidden p-5">
              {p.badge && <div className="brand-gradient absolute left-4 top-4 rounded-full px-3 py-1 text-xs font-bold text-white">{p.badge}</div>}
              {p.kind === 'boost' ? <Zap className="mb-3 size-8 text-violet" /> : p.kind === 'superlikes' ? <Star className="mb-3 size-8 text-info" /> : <Gem className="mb-3 size-8 text-warn" />}
              <div className="text-lg font-bold">{p.title}</div>
              <div className="mt-1 text-sm text-muted">{p.description}</div>
              <div className="mt-4 text-2xl font-bold">{fmtToman(p.price_toman)}</div>
              <div className="text-sm text-muted">
                {p.kind === 'premium' ? `${fmtNum(p.duration_days)} روز عضویت` : `${fmtNum(p.quantity)} ${p.kind === 'boost' ? 'بوست' : 'سوپرلایک'}`}
              </div>
              <div className="mt-4 flex items-center justify-between">
                <div className="flex gap-2">
                  {p.is_active ? <Badge tone="ok">فعال</Badge> : <Badge>غیرفعال</Badge>}
                  <Badge tone="violet">{fmtNum(p.sold)} فروش</Badge>
                </div>
                <Button
                  size="sm"
                  onClick={() =>
                    setEditing({
                      id: p.id,
                      form: {
                        title: p.title,
                        description: p.description ?? '',
                        kind: p.kind,
                        quantity: p.quantity,
                        durationDays: p.duration_days,
                        priceToman: p.price_toman,
                        oldPriceToman: p.old_price_toman ?? 0,
                        badge: p.badge ?? '',
                        isActive: p.is_active,
                        sort: p.sort,
                      },
                    })
                  }
                >
                  <Pencil className="size-3.5" /> ویرایش
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'ویرایش طرح' : 'طرح جدید'}>
        {editing && (
          <div className="space-y-4">
            <Field label="عنوان">
              <input className="field" value={editing.form.title} onChange={(e) => set('title', e.target.value)} placeholder="مثلاً: یک ماهه" />
            </Field>
            <Field label="توضیح کوتاه">
              <input className="field" value={editing.form.description} onChange={(e) => set('description', e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              {editing.form.kind === 'premium' ? (
                <Field label="مدت (روز)">
                  <input type="number" className="field" value={editing.form.durationDays} onChange={(e) => set('durationDays', Number(e.target.value))} />
                </Field>
              ) : (
                <Field label={editing.form.kind === 'boost' ? 'تعداد بوست' : 'تعداد سوپرلایک'}>
                  <input type="number" className="field" value={editing.form.quantity} onChange={(e) => set('quantity', Number(e.target.value))} />
                </Field>
              )}
              <Field label="قیمت (تومان)">
                <input type="number" className="field" value={editing.form.priceToman} onChange={(e) => set('priceToman', Number(e.target.value))} />
              </Field>
              <Field label="قیمت قبل از تخفیف (اختیاری)" hint="خط‌خورده کنار قیمت نمایش داده می‌شود">
                <input type="number" className="field" value={editing.form.oldPriceToman} onChange={(e) => set('oldPriceToman', Number(e.target.value))} />
              </Field>
              <Field label="برچسب" hint="مثلاً: محبوب‌ترین">
                <input className="field" value={editing.form.badge} onChange={(e) => set('badge', e.target.value)} />
              </Field>
              <Field label="ترتیب نمایش">
                <input type="number" className="field" value={editing.form.sort} onChange={(e) => set('sort', Number(e.target.value))} />
              </Field>
            </div>
            <Toggle checked={editing.form.isActive} onChange={(v) => set('isActive', v)} label="فعال (در اپ نمایش داده شود)" />
            <ErrorBox error={error} />
            <Button variant="primary" className="w-full" loading={busy} onClick={save}>
              ذخیره
            </Button>
          </div>
        )}
      </Modal>
    </>
  );
}
