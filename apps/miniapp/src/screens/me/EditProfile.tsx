import clsx from 'clsx';
import { ChevronsLeft, ChevronsRight, EyeOff, ImageUp, Lock, Plus, Star, Trash2, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api, ApiError, errorMessage } from '@/api/client';
import { setMe, useMe, useMeta } from '@/api/queries';
import type { InterestedIn, Me, MyPhoto, Option } from '@/api/types';
import { fa } from '@/lib/format';
import { photoForm, pickImage, prepareImage } from '@/lib/image';
import { nav } from '@/store/nav';
import { toast } from '@/store/ui';
import { haptic } from '@/telegram/tg';
import { confirmDialog } from '@/ui/Dialog';
import { Button, Chip, Img, Row, ScreenHeader, SectionTitle, Spinner } from '@/ui/kit';
import { Sheet } from '@/ui/Sheet';

/** Everything a profile says about someone: their photos, a name, a line about them, and two choices. */
interface Draft {
  name: string;
  bio: string;
  maritalStatus: string | null;
  interestedIn: InterestedIn | null;
}

const fromMe = (m: Me): Draft => ({
  name: m.name ?? '',
  bio: m.bio ?? '',
  maritalStatus: m.maritalStatus,
  interestedIn: m.interestedIn,
});

export default function EditProfile() {
  const me = useMe().data!;
  const meta = useMeta().data;
  const [draft, setDraft] = useState<Draft>(() => fromMe(me));
  const [saving, setSaving] = useState(false);
  const base = useMemo(() => fromMe(me), [me]);
  const dirtyKeys = (Object.keys(draft) as (keyof Draft)[]).filter((k) => JSON.stringify(draft[k]) !== JSON.stringify(base[k]));
  const dirty = dirtyKeys.length > 0;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      for (const k of dirtyKeys) {
        const v = draft[k];
        body[k] = typeof v === 'string' ? v.trim() || (k === 'name' ? v : null) : v;
      }
      const m = await api.patch<Me>('/v1/me', body);
      setMe(m);
      setDraft(fromMe(m));
      haptic.success();
      toast('پروفایلت ذخیره شد', '✅', 'success');
      nav.pop();
    } catch (e) {
      haptic.error();
      const details = e instanceof ApiError && Array.isArray(e.details) ? (e.details as { path: string; message: string }[]) : [];
      toast(details[0]?.message && details[0].message !== 'banned_word' ? details[0].message : errorMessage(e), '⚠️', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="ویرایش پروفایل" />
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        <Photos me={me} />

        <Section title="اسم">
          <Input value={draft.name} onChange={(v) => set('name', v.slice(0, 30))} placeholder="اسمت" />
        </Section>

        <Section title="درباره‌ی من" hint={`${fa(draft.bio.length)}/${fa(500)}`}>
          <textarea
            value={draft.bio}
            onChange={(e) => set('bio', e.target.value.slice(0, 500))}
            rows={4}
            placeholder="از خودت بگو: چی دوست داری، دنبال چی هستی… یه جمله‌ی بامزه معجزه می‌کنه ✨"
            className="w-full resize-none rounded-2xl border border-line bg-surface-1 px-4 py-3 text-[15px] leading-7 outline-none focus:border-rose/60"
          />
        </Section>

        <Section title="دوست داری با چه کسانی آشنا بشی؟">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['male', 'آقایان', '👨'],
                ['female', 'خانم‌ها', '👩'],
                ['everyone', 'همه', '💫'],
              ] as const
            ).map(([id, label, emoji]) => (
              <Chip key={id} label={label} emoji={emoji} selected={draft.interestedIn === id} onClick={() => set('interestedIn', id)} />
            ))}
          </div>
        </Section>

        <Section title="وضعیت تأهل">
          <Chips options={meta?.marital} value={draft.maritalStatus ? [draft.maritalStatus] : []} onToggle={(id) => set('maritalStatus', draft.maritalStatus === id ? null : id)} />
        </Section>

        <Section title="ثابت">
          <div className="overflow-hidden rounded-2xl border border-line bg-surface-1">
            <Row icon={<Lock />} tint="violet" title={`جنسیت: ${me.gender === 'female' ? 'زن' : 'مرد'}`} subtitle="برای تغییر با پشتیبانی تماس بگیر" chevron={false} />
            <Row icon={<Lock />} tint="violet" title={`سن: ${fa(me.age ?? '')} سال`} chevron={false} />
          </div>
        </Section>
      </div>

      <div className="shrink-0 border-t border-line px-4 pt-3 pb-safe glass">
        <Button className="mb-3 w-full" disabled={!dirty} loading={saving} onClick={save}>
          ذخیره‌ی تغییرات
        </Button>
      </div>

    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="pt-6">
      <div className="mb-2.5 flex items-center justify-between px-1">
        <SectionTitle tight className="px-0 pb-0">
          {title}
        </SectionTitle>
        {hint ? <span className="text-[12px] text-faint tabular">{hint}</span> : null}
      </div>
      {children}
    </section>
  );
}

function Input({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      enterKeyHint="done"
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className="h-13 w-full rounded-2xl border border-line bg-surface-1 px-4 py-3.5 text-[15px] outline-none focus:border-rose/60"
    />
  );
}

function Chips({ options, value, onToggle }: { options?: Option[]; value: string[]; onToggle: (id: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options?.map((o) => <Chip key={o.id} label={o.label} emoji={o.emoji} selected={value.includes(o.id)} onClick={() => onToggle(o.id)} />)}
    </div>
  );
}

/**
 * The profile's photos. A photo can be replaced in place (which is the only way to change the one
 * photo a profile must always have), moved, made the main one, or deleted.
 */
function Photos({ me }: { me: Me }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [action, setAction] = useState<MyPhoto | null>(null);
  const photos = me.photos;
  const max = me.limits.maxPhotos;
  const at = action ? photos.findIndex((p) => p.id === action.id) : -1;

  /** Every change answers with the whole profile, so the grid always matches the server. */
  const run = async (key: string, fn: () => Promise<Me>) => {
    setAction(null);
    setBusy(key);
    try {
      setMe(await fn());
      haptic.success();
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), '⚠️', 'error');
    } finally {
      setBusy(null);
    }
  };

  const add = async () => {
    const file = await pickImage();
    if (!file) return;
    await run('add', async () => api.upload<Me>('/v1/me/photos', photoForm(await prepareImage(file))));
  };

  const replace = async (p: MyPhoto) => {
    setAction(null);
    const file = await pickImage();
    if (!file) return;
    await run(p.id, async () => api.uploadPut<Me>(`/v1/me/photos/${p.id}`, photoForm(await prepareImage(file))));
  };

  /** Moves a photo one place towards the front (or back); the first one is the main photo. */
  const move = (p: MyPhoto, by: 1 | -1) => {
    const from = photos.findIndex((x) => x.id === p.id);
    const to = from + by;
    if (from < 0 || to < 0 || to >= photos.length) return;
    const ids = photos.map((x) => x.id);
    [ids[from], ids[to]] = [ids[to]!, ids[from]!];
    void run(p.id, () => api.put<Me>('/v1/me/photos/order', { ids }));
  };

  const makeMain = (p: MyPhoto) => {
    const ids = [p.id, ...photos.filter((x) => x.id !== p.id).map((x) => x.id)];
    void run(p.id, () => api.put<Me>('/v1/me/photos/order', { ids }));
  };

  const remove = async (p: MyPhoto) => {
    setAction(null);
    if (!(await confirmDialog('این عکس حذف شود؟', 'حذف', true))) return;
    await run(p.id, () => api.del<Me>(`/v1/me/photos/${p.id}`));
  };

  return (
    <section className="pt-3">
      <div className="grid grid-cols-3 gap-2.5">
        {Array.from({ length: max }, (_, i) => {
          const p = photos[i];
          if (!p) {
            // any empty slot adds a photo; they fill from the first free one anyway
            const first = i === photos.length;
            return (
              <button
                key={'slot' + i}
                disabled={!!busy}
                onClick={add}
                className={clsx(
                  'grid aspect-[3/4] place-items-center rounded-2xl border-2 border-dashed transition-colors',
                  first ? 'border-rose/50 bg-rose/5 text-rose' : 'border-line text-faint',
                  busy && 'opacity-60',
                )}
              >
                {busy === 'add' && first ? <Spinner className="size-6" /> : <Plus className="size-7" />}
              </button>
            );
          }
          const hidden = !p.visible && p.status !== 'rejected';
          return (
            <button
              key={p.id}
              disabled={!!busy}
              onClick={() => setAction(p)}
              className="relative aspect-[3/4] overflow-hidden rounded-2xl border border-line"
            >
              <Img src={p.thumb} color={p.color} className="absolute inset-0" />
              {i === 0 ? <span className="absolute top-1.5 right-1.5 rounded-full bg-flame px-2 py-0.5 text-[10.5px] font-bold">اصلی</span> : null}
              {p.status === 'rejected' ? (
                <span className="absolute inset-0 grid place-items-center bg-danger/40 text-[11px] font-bold">
                  <span className="flex flex-col items-center gap-1">
                    <XCircle className="size-6" /> رد شد
                  </span>
                </span>
              ) : hidden ? (
                <span className="absolute inset-0 grid place-items-center bg-night/70 px-1 text-[10.5px] font-bold leading-4">
                  <span className="flex flex-col items-center gap-1 text-center">
                    <EyeOff className="size-5" /> در انتظار بررسی
                  </span>
                </span>
              ) : null}
              {busy === p.id ? (
                <span className="absolute inset-0 grid place-items-center bg-night/60">
                  <Spinner className="size-6" />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <p className="mt-2 px-1 text-[12px] leading-5 text-faint">
        اولین عکس، عکس اصلی پروفایلته. روی هر عکس بزن تا تعویض، جابه‌جا یا حذفش کنی.
      </p>

      <Sheet open={!!action} onClose={() => setAction(null)}>
        {action ? (
          <div className="-mx-5 divide-y divide-line">
            {action.status === 'rejected' && action.rejectReason ? (
              <p className="px-5 pb-3 text-[13px] text-danger">دلیل رد: {action.rejectReason}</p>
            ) : !action.visible && action.status !== 'rejected' ? (
              <p className="px-5 pb-3 text-[13px] leading-6 text-muted">
                این عکس تا بررسی ناظر برای بقیه نمایش داده نمی‌شه. می‌تونی تعویضش کنی.
              </p>
            ) : null}
            <Row icon={<ImageUp />} tint="violet" title="تعویض این عکس" subtitle="جای همین عکس عوض می‌شه" onClick={() => void replace(action)} chevron={false} />
            {at > 0 && action.status !== 'rejected' ? (
              <Row icon={<Star />} tint="gold" title="عکس اصلی کن" onClick={() => makeMain(action)} chevron={false} />
            ) : null}
            {at > 0 ? <Row icon={<ChevronsRight />} tint="sky" title="یک خانه جلوتر" onClick={() => move(action, -1)} chevron={false} /> : null}
            {at >= 0 && at < photos.length - 1 ? (
              <Row icon={<ChevronsLeft />} tint="sky" title="یک خانه عقب‌تر" onClick={() => move(action, 1)} chevron={false} />
            ) : null}
            <Row icon={<Trash2 />} tint="danger" title="حذف عکس" onClick={() => remove(action)} chevron={false} />
          </div>
        ) : null}
      </Sheet>
    </section>
  );
}
