'use client';

import { Bot, ImagePlus, Pencil, Plus, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Avatar, Badge, Button, Card, Empty, ErrorBox, Field, Modal, PageHeader, Spinner, Toggle } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { fmtAgo, fmtNum, GENDER_LABEL } from '@/lib/format';

interface Bot {
  id: string;
  name: string | null;
  gender: 'male' | 'female' | null;
  birthdate: string | null;
  interestedIn: 'male' | 'female' | 'everyone' | null;
  bio: string | null;
  maritalStatus: string | null;
  persona: string;
  model: string;
  enabled: boolean;
  discoverable: boolean;
  photoCount: number;
  replies: number;
  lastReplyAt: string | null;
  lastError: string | null;
  status: string;
  createdAt: string;
}

interface Page {
  items: Bot[];
  config: { enabled: boolean; model: string; keySet: boolean; base: string };
}

const AGE_OF = (birthdate: string | null) => {
  if (!birthdate) return null;
  const d = new Date(birthdate);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 3600_000));
};

/** A ready-made personality, so a new profile is never a blank box. */
const PERSONA_IDEAS = [
  'اهل کتاب و فیلمم، شب‌ها بیدار می‌مونم و حرف زدن رو دوست دارم. کمی خجالتی‌ام ولی زود گرم می‌گیرم. دانشجوی معماری‌ام و تو کافه کار می‌کنم.',
  'پرانرژی و شوخ‌طبعم، عاشق سفر و کوه. صبح‌ها می‌دوم. از آدم‌های رک خوشم میاد و خودم هم رکم.',
  'آرام و مهربونم، آشپزی و موسیقی سنتی دوست دارم. دنبال یه رابطه‌ی جدی و باآرامشم و حوصله‌ی بازی ندارم.',
  'گیمر و برنامه‌نویسم، بیشتر شب‌ها آنلاینم. بامزه‌ام و زیاد ایموجی می‌فرستم. دنبال کسی‌ام که باهاش راحت بخندم.',
];

export default function AiUsersPage() {
  const { data, error, mutate } = useApi<Page>('admin/v1/ai');
  const models = useApi<{ items: string[]; error: string | null }>('admin/v1/ai/models');
  const [open, setOpen] = useState<'new' | Bot | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [test, setTest] = useState<{ ok: boolean; reply: string | null; error: string | null } | null>(null);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setActionError(null);
    try {
      await fn();
      await mutate();
    } catch (e) {
      setActionError(e);
    } finally {
      setBusy(null);
    }
  };

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Spinner />;

  return (
    <>
      <PageHeader
        title="کاربران هوش مصنوعی"
        subtitle={`پروفایل‌هایی که خود اپ اجرا می‌کند و با مدل زبانی به کاربران جواب می‌دهند · ${data.config.base}`}
        actions={
          <>
            <Button
              variant="soft"
              loading={busy === 'test'}
              onClick={() =>
                act('test', async () => {
                  setTest(await api.post('admin/v1/ai/test', {}));
                })
              }
            >
              <Wand2 className="size-4" /> تست مدل
            </Button>
            <Button variant="primary" onClick={() => setOpen('new')}>
              <Plus className="size-4" /> کاربر جدید
            </Button>
          </>
        }
      />

      <div className="mb-4 rounded-xl bg-surface-2 px-4 py-3 text-sm leading-7 text-muted">
        راه سریع‌تر: در تلگرام پیامی از کسی را به ربات فوروارد کنید تا فرستنده‌ی آن پیام با همان اسم و عکس پروفایل، به‌عنوان کاربر هوش مصنوعی (همیشه زن) ثبت
        شود. برای فعال بودنش، آیدی عددی خودتان را در تنظیمات ← کاربران هوش مصنوعی بگذارید (آیدی را با فرستادن <code>/id</code> به ربات بگیرید).
      </div>
      {!data.config.keySet && (
        <div className="mb-4 rounded-xl bg-warn/10 px-4 py-3 text-sm leading-7 text-warn">
          کلید هوش مصنوعی روی سرور تنظیم نشده است. در فایل <code>deploy/.env</code> مقدار <code>LLM_API_KEY</code> را بگذارید (کلید را از
          llmka.dev/app/keys بسازید) و دستور نصب را دوباره اجرا کنید. تا آن موقع این پروفایل‌ها ساخته می‌شوند ولی جواب نمی‌دهند.
        </div>
      )}
      {!data.config.enabled && (
        <div className="mb-4 rounded-xl bg-warn/10 px-4 py-3 text-sm text-warn">
          پاسخ‌دهی هوش مصنوعی در تنظیمات خاموش است (بخش «کاربران هوش مصنوعی» در صفحه‌ی تنظیمات).
        </div>
      )}
      {models.data?.error && <div className="mb-4 rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">{models.data.error}</div>}
      {test && (
        <div className={`mb-4 rounded-xl px-4 py-3 text-sm leading-7 ${test.ok ? 'bg-ok/10 text-ok' : 'bg-danger/10 text-danger'}`}>
          {test.ok ? `مدل جواب داد: «${test.reply}»` : `تست ناموفق: ${test.error}`}
        </div>
      )}
      <ErrorBox error={actionError} />

      <Card padded={false}>
        {!data.items.length ? (
          <Empty icon={<Bot className="size-6" />} title="هنوز کاربر هوش مصنوعی نساخته‌اید" hint="با دکمه‌ی «کاربر جدید» یکی یا چندتا بسازید." />
        ) : (
          <div className="divide-y divide-line/60">
            {data.items.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <Avatar name={b.name} size={44} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{b.name ?? 'بدون نام'}</span>
                    <span className="text-sm text-muted">
                      {[b.gender ? GENDER_LABEL[b.gender] : null, AGE_OF(b.birthdate) ? `${fmtNum(AGE_OF(b.birthdate)!)} ساله` : null].filter(Boolean).join('، ')}
                    </span>
                    {b.enabled ? <Badge tone="ok">فعال</Badge> : <Badge>خاموش</Badge>}
                    {b.photoCount === 0 && <Badge tone="warn">بدون عکس</Badge>}
                    {b.lastError && <Badge tone="danger">خطا در پاسخ</Badge>}
                  </div>
                  <div className="mt-0.5 text-xs text-faint">
                    {fmtNum(b.replies)} پاسخ
                    {b.lastReplyAt ? ` · آخرین پاسخ ${fmtAgo(b.lastReplyAt)}` : ''}
                    {b.model ? ` · ${b.model}` : ` · ${data.config.model} (پیش‌فرض)`}
                  </div>
                  {b.lastError && <div className="mt-1 line-clamp-2 text-xs text-danger">{b.lastError}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <Toggle checked={b.enabled} onChange={(v) => act(b.id, () => api.patch(`admin/v1/ai/${b.id}`, { enabled: v }))} />
                  <Button size="sm" variant="soft" onClick={() => setOpen(b)}>
                    <Pencil className="size-4" /> ویرایش
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    loading={busy === `del-${b.id}`}
                    onClick={() =>
                      confirm(`«${b.name}» برای همیشه حذف شود؟ گفتگوهایش هم بسته می‌شود و برگشت‌پذیر نیست.`) &&
                      act(`del-${b.id}`, () => api.del(`admin/v1/ai/${b.id}`))
                    }
                    aria-label="حذف"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <BotModal
        open={open}
        models={models.data?.items ?? []}
        defaultModel={data.config.model}
        onClose={() => setOpen(null)}
        onDone={() => {
          setOpen(null);
          void mutate();
        }}
      />
    </>
  );
}

/** Reads a picked file as the data URL the API expects. */
const toDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('عکس خوانده نشد'));
    r.readAsDataURL(file);
  });

function BotModal({
  open,
  models,
  defaultModel,
  onClose,
  onDone,
}: {
  open: 'new' | Bot | null;
  models: string[];
  defaultModel: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const editing = open && open !== 'new' ? open : null;
  const [name, setName] = useState('');
  const [gender, setGender] = useState<'male' | 'female'>('female');
  const [age, setAge] = useState(25);
  const [interestedIn, setInterestedIn] = useState<'male' | 'female' | 'everyone'>('male');
  const [bio, setBio] = useState('');
  const [marital, setMarital] = useState('');
  const [persona, setPersona] = useState('');
  const [model, setModel] = useState('');
  const [count, setCount] = useState(1);
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setPhoto(null);
    setCount(1);
    if (editing) {
      setName(editing.name ?? '');
      setGender(editing.gender ?? 'female');
      setAge(AGE_OF(editing.birthdate) ?? 25);
      setInterestedIn(editing.interestedIn ?? 'male');
      setBio(editing.bio ?? '');
      setMarital(editing.maritalStatus ?? '');
      setPersona(editing.persona);
      setModel(editing.model);
    } else {
      setName('');
      setGender('female');
      setAge(25);
      setInterestedIn('male');
      setBio('');
      setMarital('');
      setPersona('');
      setModel('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: name.trim(),
        gender,
        age,
        interestedIn,
        bio: bio.trim() || null,
        maritalStatus: marital || null,
        persona: persona.trim(),
        model: model.trim(),
      };
      if (editing) {
        await api.patch(`admin/v1/ai/${editing.id}`, body);
        if (photo) await api.put(`admin/v1/ai/${editing.id}/photo`, { photo });
      } else {
        await api.post('admin/v1/ai', { ...body, count, photo });
      }
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={!!open} onClose={onClose} title={editing ? `ویرایش ${editing.name ?? ''}` : 'کاربر هوش مصنوعی جدید'} wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="اسم" hint={editing ? undefined : 'برای چند کاربر، شماره به اسم اضافه می‌شود'}>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً نیلوفر" />
        </Field>
        {!editing && (
          <Field label="تعداد" hint="هر چند کاربر با همین مشخصات (۱ تا ۵۰)">
            <input type="number" className="field" min={1} max={50} value={count} onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value))))} />
          </Field>
        )}
        <Field label="جنسیت">
          <select className="field" value={gender} onChange={(e) => setGender(e.target.value as 'male' | 'female')}>
            <option value="female">زن</option>
            <option value="male">مرد</option>
          </select>
        </Field>
        <Field label="سن">
          <input type="number" className="field" min={18} max={80} value={age} onChange={(e) => setAge(Number(e.target.value))} />
        </Field>
        <Field label="به چه کسانی نشان داده شود">
          <select className="field" value={interestedIn} onChange={(e) => setInterestedIn(e.target.value as 'male' | 'female' | 'everyone')}>
            <option value="male">آقایان</option>
            <option value="female">خانم‌ها</option>
            <option value="everyone">همه</option>
          </select>
        </Field>
        <Field label="وضعیت تأهل">
          <select className="field" value={marital} onChange={(e) => setMarital(e.target.value)}>
            <option value="">—</option>
            <option value="single">مجرد</option>
            <option value="divorced">جدا شده</option>
            <option value="married">متأهل</option>
            <option value="complicated">پیچیده است</option>
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="درباره‌ی من (بیو)" hint="همان متنی که کاربران روی پروفایل می‌بینند">
            <textarea className="field min-h-20" value={bio} onChange={(e) => setBio(e.target.value.slice(0, 500))} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="شخصیت" hint="به مدل گفته می‌شود که این آدم کیست؛ کاربران این متن را نمی‌بینند">
            <textarea className="field min-h-28" value={persona} onChange={(e) => setPersona(e.target.value.slice(0, 4000))} />
          </Field>
          <div className="mt-2 flex flex-wrap gap-2">
            {PERSONA_IDEAS.map((p, i) => (
              <button key={i} type="button" onClick={() => setPersona(p)} className="rounded-xl border border-line px-3 py-1.5 text-xs transition hover:bg-white/[0.04]">
                <Sparkles className="me-1 inline size-3" /> نمونه {i + 1}
              </button>
            ))}
          </div>
        </div>
        <Field label="مدل" hint={`خالی = پیش‌فرض تنظیمات (${defaultModel || 'تعیین نشده'})`}>
          <select className="field" value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">پیش‌فرض</option>
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            {model && !models.includes(model) ? <option value={model}>{model}</option> : null}
          </select>
        </Field>
        <Field label="عکس پروفایل" hint={editing ? 'عکس تازه به عکس‌های این پروفایل اضافه می‌شود' : 'همین عکس برای همه‌ی کاربرهای این دسته گذاشته می‌شود'}>
          <div className="flex items-center gap-2">
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo} alt="" className="size-12 rounded-xl border border-line object-cover" />
            ) : null}
            <Button size="sm" variant="soft" onClick={() => file.current?.click()}>
              <ImagePlus className="size-4" /> {photo ? 'تعویض' : 'انتخاب عکس'}
            </Button>
            <input
              ref={file}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) setPhoto(await toDataUrl(f));
              }}
            />
          </div>
        </Field>
      </div>

      <ErrorBox error={error} />
      <p className="mt-4 text-xs leading-6 text-faint">
        این پروفایل‌ها برای کاربران تازه‌وارد در ابتدای صفحه‌ی کشف نشان داده می‌شوند و وقتی کسی به آن‌ها پیام بدهد، مدل زبانی جواب می‌دهد. پروفایلی که عکس نداشته
        باشد، حرف اول اسمش را به‌عنوان تصویر نشان می‌دهد.
      </p>
      <Button variant="primary" className="mt-4 w-full" loading={busy} disabled={name.trim().length < 2} onClick={save}>
        {editing ? 'ذخیره‌ی تغییرات' : count > 1 ? `ساخت ${count} کاربر` : 'ساخت کاربر'}
      </Button>
    </Modal>
  );
}
