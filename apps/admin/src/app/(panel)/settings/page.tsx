'use client';

import { Save } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Button, Card, ErrorBox, Field, PageHeader, Spinner, Toggle } from '@/components/ui';
import { api, useApi } from '@/lib/api';

interface Settings {
  signupOpen: boolean;
  newUserBoostHours: number;
  inactiveDays: number;
  skipRecycleDays: number;
  newcomerFanout: number;
  minAge: number;
  maxPhotos: number;
  chatMediaEnabled: boolean;
  chatMediaMinMessages: number;
  bannedWords: string[];
  maintenance: { enabled: boolean; message: string };
  matching: { dailyNewChats: number; maxUnanswered: number; nudgeHours: number; archiveDays: number };
  verification: { enabled: boolean; freeMessages: number };
  ai: {
    enabled: boolean;
    model: string;
    leadNewcomerHours: number;
    leadCount: number;
    replyDelayS: number;
    historyMessages: number;
    maxMessages: number;
    temperature: number;
  };
  safety: { autoShadowReports: number };
  wall: {
    enabled: boolean;
    freeDailyPosts: number;
    repostCooldownHours: number;
    ttlHours: number;
    autoHideReports: number;
    telegram: { enabled: boolean; chatId: string; link: string };
  };
  bot: { messageCooldownMin: number; comebackAfterDays: number; welcomeText: string };
  support: { telegram: string; channel: string; termsUrl: string; privacyUrl: string };
}

function NumberField({ label, hint, value, onChange }: { label: string; hint?: string; value: number; onChange: (v: number) => void }) {
  return (
    <Field label={label} hint={hint}>
      <input type="number" className="field" value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </Field>
  );
}

interface BotGroup {
  chatId: string;
  title: string | null;
  link: string;
}

/** The groups the bot was made an admin of: one click fills in the Wall group. */
function BotGroups({ current, onPick }: { current: string; onPick: (g: BotGroup) => void }) {
  const { data } = useApi<{ items: BotGroup[] }>('admin/v1/bot-groups');
  if (!data) return <div />;
  return (
    <div className="sm:col-span-2">
      <span className="mb-1.5 block text-xs font-medium text-muted">گروه‌هایی که ربات در آن‌ها ادمین است</span>
      {data.items.length ? (
        <div className="flex flex-wrap gap-2">
          {data.items.map((g) => (
            <button
              key={g.chatId}
              type="button"
              onClick={() => onPick(g)}
              className={
                'rounded-xl border px-3 py-2 text-sm transition ' +
                (g.chatId === current ? 'border-brand bg-brand/15 text-ink' : 'border-line hover:bg-white/[0.04]')
              }
            >
              {g.title ?? g.chatId}
              <span className="ms-2 text-xs text-faint" dir="ltr">
                {g.chatId}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <span className="block text-xs text-faint">هنوز گروهی نیست. ربات را در گروه ادمین کنید و این صفحه را دوباره باز کنید.</span>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card title={title}>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </Card>
  );
}

export default function SettingsPage() {
  const { data, mutate } = useApi<Settings>('admin/v1/settings');
  const [s, setS] = useState<Settings | null>(null);
  const [words, setWords] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (data) {
      setS(data);
      setWords(data.bannedWords.join('\n'));
    }
  }, [data]);

  if (!s) return <Spinner />;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });
  const setIn = <K extends 'maintenance' | 'support' | 'bot' | 'wall' | 'matching' | 'safety' | 'ai' | 'verification'>(
    k: K,
    patch: Partial<Settings[K]>,
  ) =>
    setS({ ...s, [k]: { ...s[k], ...patch } });

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const bannedWords = words
        .split('\n')
        .map((w) => w.trim())
        .filter(Boolean);
      const next = await api.put<Settings>('admin/v1/settings', { ...s, bannedWords });
      await mutate(next, { revalidate: false });
      setSaved(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="تنظیمات"
        subtitle="تغییرات بلافاصله روی همه‌ی سرورها اعمال می‌شود."
        actions={
          <Button variant="primary" loading={busy} onClick={save}>
            <Save className="size-4" /> ذخیره‌ی تغییرات
          </Button>
        }
      />
      <ErrorBox error={error} />
      {saved && <div className="mb-4 rounded-xl bg-ok/10 px-4 py-3 text-sm text-ok">ذخیره شد ✓</div>}
      <div className="space-y-6">
        <Section title="ثبت‌نام و دسترسی">
          <Toggle checked={s.signupOpen} onChange={(v) => set('signupOpen', v)} label="ثبت‌نام کاربران جدید باز است" />
          <Toggle checked={s.maintenance.enabled} onChange={(v) => setIn('maintenance', { enabled: v })} label="حالت تعمیر (ورود جدید بسته می‌شود)" />
          <Field label="پیام حالت تعمیر">
            <input className="field" value={s.maintenance.message} onChange={(e) => setIn('maintenance', { message: e.target.value })} />
          </Field>
          <NumberField label="حداقل سن" value={s.minAge} onChange={(v) => set('minAge', v)} />
          <NumberField label="حداکثر تعداد عکس پروفایل" value={s.maxPhotos} onChange={(v) => set('maxPhotos', v)} />
        </Section>

        <Section title="گفتگوها">
          <p className="rounded-xl bg-surface-2 p-3 text-sm text-muted sm:col-span-2">
            در این نسخه چیزی برای فروش نیست و همه‌ی کاربران امکانات یکسانی دارند. عددهای زیر فقط جلوی هرزنامه را می‌گیرند، نه ابزار فروش.
          </p>
          <NumberField
            label="گفتگوی تازه در روز (برای هر کاربر)"
            hint="سقف تعداد نفراتی که یک کاربر در روز می‌تواند اولین پیام را برایشان بفرستد؛ ۰ = بدون محدودیت"
            value={s.matching.dailyNewChats}
            onChange={(v) => setIn('matching', { dailyNewChats: v })}
          />
          <NumberField
            label="حداکثر پیام پشت‌سرهم تا جواب طرف مقابل"
            hint="جلوی سیل پیام برای کسی که هنوز جواب نداده را می‌گیرد؛ ۰ = بدون محدودیت"
            value={s.matching.maxUnanswered}
            onChange={(v) => setIn('matching', { maxUnanswered: v })}
          />
          <NumberField
            label="یادآوری گفتگوی بی‌جواب بعد از چند ساعت"
            hint="به هر دو طرف، یک بار؛ ۰ = خاموش"
            value={s.matching.nudgeHours}
            onChange={(v) => setIn('matching', { nudgeHours: v })}
          />
          <NumberField
            label="بایگانی گفتگوی بی‌پیام بعد از چند روز"
            hint="حذف نمی‌شود؛ فقط از لیست اصلی کنار می‌رود و با اولین پیام برمی‌گردد. ۰ = هرگز"
            value={s.matching.archiveDays}
            onChange={(v) => setIn('matching', { archiveDays: v })}
          />
        </Section>

        <Section title="کشف: ترتیب و انصاف">
          <NumberField
            label="دیده‌شدن بیشتر کاربران تازه‌وارد (ساعت)"
            hint="پروفایل‌های جدید این مدت در کشف بالاتر می‌آیند؛ ۰ = خاموش"
            value={s.newUserBoostHours}
            onChange={(v) => set('newUserBoostHours', v)}
          />
          <NumberField
            label="نمایش فوری تازه‌وارد به کاربران آنلاین"
            hint="بعد از ثبت‌نام، تازه‌وارد اول کارت‌های این تعداد کاربرِ آنلاینِ مناسب قرار می‌گیرد"
            value={s.newcomerFanout}
            onChange={(v) => set('newcomerFanout', v)}
          />
          <NumberField
            label="برگشت ردشده‌ها بعد از چند روز"
            hint="وقتی کارت‌ها تمام شد، کسانی که قبلاً رد شده‌اند دوباره نشان داده می‌شوند؛ ۰ = هرگز"
            value={s.skipRecycleDays}
            onChange={(v) => set('skipRecycleDays', v)}
          />
          <NumberField
            label="حذف از کشف بعد از چند روز بی‌فعالیتی"
            hint="پروفایل‌های خیلی قدیمی تجربه‌ی اول را خراب می‌کنند"
            value={s.inactiveDays}
            onChange={(v) => set('inactiveDays', v)}
          />
        </Section>

        <Section title="نظارت بر محتوا">
          <div className="space-y-3">
            <Toggle checked={s.chatMediaEnabled} onChange={(v) => set('chatMediaEnabled', v)} label="ارسال عکس در گفتگو" />
            <NumberField label="حداقل پیام هر طرف قبل از ارسال عکس" value={s.chatMediaMinMessages} onChange={(v) => set('chatMediaMinMessages', v)} />
          </div>
          <div className="sm:col-span-2">
            <Field label="کلمات ممنوع (هر خط یک کلمه)" hint="در پیام‌ها با * پوشانده می‌شوند و در نام/بیو پذیرفته نمی‌شوند">
              <textarea className="field min-h-36" value={words} onChange={(e) => setWords(e.target.value)} />
            </Field>
          </div>
        </Section>

        <Section title="تأیید حساب">
          <p className="rounded-xl bg-surface-2 p-3 text-sm leading-7 text-muted sm:col-span-2">
            خانم‌ها و پروفایل‌های هوش مصنوعی از ابتدا تأییدشده‌اند؛ آقایان تأیید نشده شروع می‌کنند. کاربر تأیید نشده در هر گفتگو فقط این تعداد پیام می‌تواند بفرستد و
            بعد صفحه‌ی «تأیید حساب» برایش باز می‌شود. تا زمانی که روش تأیید پیاده شود، از صفحه‌ی کاربران می‌توانید دستی تأیید کنید.
          </p>
          <Toggle checked={s.verification.enabled} onChange={(v) => setIn('verification', { enabled: v })} label="تأیید حساب فعال است" />
          <NumberField
            label="پیام مجاز قبل از تأیید (در هر گفتگو)"
            hint="۰ = بدون محدودیت"
            value={s.verification.freeMessages}
            onChange={(v) => setIn('verification', { freeMessages: v })}
          />
        </Section>

        <Section title="کاربران هوش مصنوعی">
          <p className="rounded-xl bg-surface-2 p-3 text-sm leading-7 text-muted sm:col-span-2">
            پروفایل‌ها را در صفحه‌ی «کاربران هوش مصنوعی» می‌سازید. کلید API در فایل env سرور تنظیم می‌شود: <code>LLM_API_KEY</code> (از
            llmka.dev/app/keys) و در صورت نیاز <code>LLM_BASE_URL</code> برای استفاده از سرویس دیگر. نام مدل را از فهرست همان صفحه انتخاب کنید.
          </p>
          <Toggle checked={s.ai.enabled} onChange={(v) => setIn('ai', { enabled: v })} label="پاسخ‌دهی هوش مصنوعی فعال است" />
          <Field label="مدل پیش‌فرض" hint="اگر برای یک پروفایل مدلی انتخاب نشده باشد، همین استفاده می‌شود">
            <input className="field" dir="ltr" value={s.ai.model} onChange={(e) => setIn('ai', { model: e.target.value.trim() })} />
          </Field>
          <NumberField
            label="نمایش در ابتدای کشف تازه‌واردها (ساعت)"
            hint="تا این مدت بعد از ثبت‌نام، کارت این پروفایل‌ها اول صف کشف کاربر می‌آید؛ ۰ = خاموش"
            value={s.ai.leadNewcomerHours}
            onChange={(v) => setIn('ai', { leadNewcomerHours: v })}
          />
          <NumberField label="چند پروفایل در ابتدای صف" value={s.ai.leadCount} onChange={(v) => setIn('ai', { leadCount: v })} />
          <NumberField
            label="تأخیر پاسخ (ثانیه)"
            hint="تا همین مقدار هم به‌صورت تصادفی اضافه می‌شود تا جواب فوری و رباتیک نباشد"
            value={s.ai.replyDelayS}
            onChange={(v) => setIn('ai', { replyDelayS: v })}
          />
          <NumberField
            label="تعداد پیام‌های اخیر برای مدل"
            hint="چند پیام آخر گفتگو به مدل داده می‌شود تا رشته‌ی حرف را بگیرد"
            value={s.ai.historyMessages}
            onChange={(v) => setIn('ai', { historyMessages: v })}
          />
          <NumberField
            label="سقف پیام با هر کاربر"
            hint="بعد از این تعداد پیامِ خودش به یک نفر، دیگر جواب نمی‌دهد؛ ۰ = بی‌نهایت"
            value={s.ai.maxMessages}
            onChange={(v) => setIn('ai', { maxMessages: v })}
          />
          <Field label="خلاقیت مدل (temperature)" hint="بین ۰ تا ۲؛ عدد بالاتر = جواب‌های متنوع‌تر و غیرقابل‌پیش‌بینی‌تر">
            <input
              type="number"
              step="0.1"
              min={0}
              max={2}
              className="field"
              value={s.ai.temperature}
              onChange={(e) => setIn('ai', { temperature: Number(e.target.value) })}
            />
          </Field>
        </Section>

        <Section title="ایمنی خودکار">
          <NumberField
            label="بن سایه بعد از گزارش چند نفرِ متفاوت"
            hint="در ۲۴ ساعت؛ حساب برای خودش کار می‌کند ولی به کسی نمی‌رسد، تا ناظر بررسی کند. ۰ = خاموش"
            value={s.safety.autoShadowReports}
            onChange={(v) => setIn('safety', { autoShadowReports: v })}
          />
        </Section>

        <Section title="دیوار">
          <Toggle checked={s.wall.enabled} onChange={(v) => setIn('wall', { enabled: v })} label="دیوار فعال است" />
          <NumberField label="مدت نمایش هر درخواست (ساعت)" value={s.wall.ttlHours} onChange={(v) => setIn('wall', { ttlHours: v })} />
          <NumberField
            label="درخواست فعال هم‌زمان"
            hint="کاربر به‌جای ثبت دوباره، درخواست فعالش را ویرایش می‌کند"
            value={s.wall.freeDailyPosts}
            onChange={(v) => setIn('wall', { freeDailyPosts: v })}
          />
          <NumberField
            label="فاصله تا درخواست بعدی (ساعت)"
            hint="۲۴ یعنی روزی یک درخواست. از زمان ثبت آخرین درخواست؛ حذف کردن آن را کوتاه نمی‌کند. ۰ = بدون فاصله"
            value={s.wall.repostCooldownHours}
            onChange={(v) => setIn('wall', { repostCooldownHours: v })}
          />
          <NumberField
            label="برداشتن خودکار بعد از چند گزارش"
            hint="تا بررسی ناظر از دیوار و گروه برداشته می‌شود"
            value={s.wall.autoHideReports}
            onChange={(v) => setIn('wall', { autoHideReports: v })}
          />
          <Toggle
            checked={s.wall.telegram.enabled}
            onChange={(v) => setIn('wall', { telegram: { ...s.wall.telegram, enabled: v } })}
            label="انتشار درخواست‌ها در گروه تلگرام"
          />
          <Field label="شناسه‌ی گروه" hint="ربات را ادمین گروه کنید؛ گروه در فهرست زیر می‌آید (مثل -1001234567890)">
            <input
              className="field"
              dir="ltr"
              value={s.wall.telegram.chatId}
              onChange={(e) => setIn('wall', { telegram: { ...s.wall.telegram, chatId: e.target.value.trim() } })}
            />
          </Field>
          <BotGroups
            current={s.wall.telegram.chatId}
            onPick={(g) => setIn('wall', { telegram: { ...s.wall.telegram, chatId: g.chatId, link: g.link || s.wall.telegram.link } })}
          />
          <Field label="لینک عمومی گروه" hint="در اپ نمایش داده می‌شود (https://t.me/...)">
            <input
              className="field"
              dir="ltr"
              value={s.wall.telegram.link}
              onChange={(e) => setIn('wall', { telegram: { ...s.wall.telegram, link: e.target.value.trim() } })}
            />
          </Field>
        </Section>

        <Section title="ربات تلگرام و اعلان‌ها">
          <NumberField label="فاصله‌ی اعلان پیام‌های یک گفتگو (دقیقه)" value={s.bot.messageCooldownMin} onChange={(v) => setIn('bot', { messageCooldownMin: v })} />
          <NumberField
            label="پیام «دلمون برات تنگ شده» بعد از چند روز غیبت"
            hint="هر روز ساعت ۱۸، حداکثر هفته‌ای یک بار برای هر نفر. ۰ = خاموش"
            value={s.bot.comebackAfterDays}
            onChange={(v) => setIn('bot', { comebackAfterDays: v })}
          />
          <div className="sm:col-span-2">
            <Field label="پیام خوش‌آمد ربات (/start)" hint="HTML تلگرام مجاز است؛ {name} = نام کاربر">
              <textarea className="field min-h-32" value={s.bot.welcomeText} onChange={(e) => setIn('bot', { welcomeText: e.target.value })} />
            </Field>
          </div>
        </Section>

        <Section title="پشتیبانی و قوانین">
          <Field label="یوزرنیم پشتیبانی در تلگرام (بدون @)">
            <input className="field" dir="ltr" value={s.support.telegram} onChange={(e) => setIn('support', { telegram: e.target.value.replace('@', '') })} />
          </Field>
          <Field label="کانال رسمی (بدون @)">
            <input className="field" dir="ltr" value={s.support.channel} onChange={(e) => setIn('support', { channel: e.target.value.replace('@', '') })} />
          </Field>
          <Field label="لینک قوانین">
            <input className="field" dir="ltr" value={s.support.termsUrl} onChange={(e) => setIn('support', { termsUrl: e.target.value })} />
          </Field>
          <Field label="لینک حریم خصوصی">
            <input className="field" dir="ltr" value={s.support.privacyUrl} onChange={(e) => setIn('support', { privacyUrl: e.target.value })} />
          </Field>
        </Section>
      </div>
    </>
  );
}
