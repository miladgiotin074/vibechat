'use client';

import { Save } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Button, Card, ErrorBox, Field, PageHeader, Spinner, Toggle } from '@/components/ui';
import { api, useApi } from '@/lib/api';

interface Settings {
  signupOpen: boolean;
  freeLikes: number;
  premiumDailyLikes: number;
  freeSuperLikes: number;
  premiumDailySuperLikes: number;
  boostMinutes: number;
  minAge: number;
  maxPhotos: number;
  chatMediaEnabled: boolean;
  chatMediaMinMessages: number;
  bannedWords: string[];
  maintenance: { enabled: boolean; message: string };
  newUserBoostHours: number;
  paymentsEnabled: boolean;
  randomChat: { enabled: boolean; freeSessions: number; premiumDailySessions: number; skipSeconds: number; skipLimit: number; cooldownSeconds: number };
  matching: { maxUnanswered: number; nudgeHours: number; archiveDays: number };
  safety: { autoShadowReports: number; photoReportsToHide: number };
  referral: { enabled: boolean; minAdds: number; rewardChats: number; rewardLikes: number };
  bot: { messageCooldownMin: number; likeCooldownMin: number; comebackAfterDays: number; welcomeText: string };
  wall: {
    enabled: boolean;
    freeDailyPosts: number;
    ttlHours: number;
    freeDailyChats: number;
    premiumDailyChats: number;
    autoHideReports: number;
    newcomerSpotlightHours: number;
    repostCooldownHours: number;
    requestReminderHours: number;
    telegram: { enabled: boolean; chatId: string; link: string };
  };
  growth: {
    autoWidenBelow: number;
    freeRevealedLikes: number;
    newcomerFanout: number;
    likersEvery: number;
    exposureSoftCap: number;
    passRecycleDays: number;
    inactiveDays: number;
  };
  vibeNight: {
    enabled: boolean;
    startHour: number;
    durationMinutes: number;
    bonusSuperLikes: number;
    reminderEveryDays: number;
    text: string;
  };
  support: { telegram: string; channel: string; termsUrl: string; privacyUrl: string };
}

function NumberField({ label, hint, value, onChange }: { label: string; hint?: string; value: number; onChange: (v: number) => void }) {
  return (
    <Field label={label} hint={hint}>
      <input type="number" className="field" value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </Field>
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
  const setIn = <
    K extends 'maintenance' | 'support' | 'randomChat' | 'referral' | 'bot' | 'wall' | 'growth' | 'vibeNight' | 'matching' | 'safety',
  >(
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
        </Section>

        <Section title="محدودیت‌ها و امکانات ویژه">
          <p className="rounded-xl bg-surface-2 p-3 text-sm text-muted sm:col-span-2">
            خانم‌ها بی‌صدا همه‌ی امکانات عضو ویژه را دارند و هیچ سقفی برای لایک و چت ناشناس ندارند (بدون نشان ویژه و بدون پیشنهاد خرید). محدودیت‌ها فقط برای آقایان است. تنها
            استثنا دیوار است: روزی یک درخواست برای همه.
          </p>
          <NumberField
            label="لایک رایگان آقایان (کل، نه روزانه)"
            hint="وقتی تمام شد، لایک قفل می‌شود تا کاربر دوستانش را به گروه اضافه کند یا عضو ویژه شود. رد کردن همیشه آزاد است"
            value={s.freeLikes}
            onChange={(v) => set('freeLikes', v)}
          />
          <NumberField label="سقف لایک روزانه‌ی آقایان ویژه" hint="۰ = نامحدود" value={s.premiumDailyLikes} onChange={(v) => set('premiumDailyLikes', v)} />
          <NumberField label="سوپرلایک رایگان آقایان (کل)" value={s.freeSuperLikes} onChange={(v) => set('freeSuperLikes', v)} />
          <NumberField label="سوپرلایک روزانه‌ی کاربر ویژه (و خانم‌ها)" value={s.premiumDailySuperLikes} onChange={(v) => set('premiumDailySuperLikes', v)} />
          <NumberField label="مدت بوست (دقیقه)" value={s.boostMinutes} onChange={(v) => set('boostMinutes', v)} />
          <NumberField label="حداکثر تعداد عکس پروفایل" value={s.maxPhotos} onChange={(v) => set('maxPhotos', v)} />
          <NumberField
            label="دیده‌شدن بیشتر کاربران تازه‌وارد (ساعت)"
            hint="پروفایل‌های جدید این مدت در کشف بالاتر می‌آیند تا زود لایک بگیرند و بمانند. ۰ = خاموش"
            value={s.newUserBoostHours}
            onChange={(v) => set('newUserBoostHours', v)}
          />
        </Section>

        <Section title="نظارت بر محتوا">
          <div className="space-y-3">
            <Toggle checked={s.chatMediaEnabled} onChange={(v) => set('chatMediaEnabled', v)} label="ارسال عکس در گفتگو" />
            <NumberField
              label="حداقل پیام هر طرف قبل از ارسال عکس"
              value={s.chatMediaMinMessages}
              onChange={(v) => set('chatMediaMinMessages', v)}
            />
          </div>
          <div className="sm:col-span-2">
            <Field label="کلمات ممنوع (هر خط یک کلمه)" hint="در پیام‌ها با * پوشانده می‌شوند و در نام/بیو پذیرفته نمی‌شوند">
              <textarea className="field min-h-36" value={words} onChange={(e) => setWords(e.target.value)} />
            </Field>
          </div>
        </Section>

        <Section title="پرداخت آنلاین (تتراپی)">
          <Toggle checked={s.paymentsEnabled} onChange={(v) => set('paymentsEnabled', v)} label="خرید عضویت ویژه فعال است" />
          <p className="text-sm text-muted">کلید API و حالت آزمایشی (sandbox) در فایل env سرور تنظیم می‌شوند: TETRA_API_KEY و TETRA_SANDBOX.</p>
        </Section>

        <Section title="رشد: دعوت دوستان (افزودن به گروه دیوار)">
          <Toggle checked={s.referral.enabled} onChange={(v) => setIn('referral', { enabled: v })} label="سیستم دعوت فعال است" />
          <p className="text-sm text-muted sm:col-span-2">
            کاربر دوستانش را از مخاطبین تلگرامش به گروه دیوار (تنظیمات دیوار ← گروه تلگرام) اضافه می‌کند و چت ناشناس و لایک هدیه می‌گیرد. هر حساب تلگرام فقط یک بار و برای اولین
            کسی که اضافه‌اش کرده حساب می‌شود. ربات باید در گروه ادمین باشد.
          </p>
          <NumberField
            label="حداقل افزودن برای اولین هدیه"
            hint="کمتر از این تعداد هدیه‌ای ندارد؛ از آن به بعد هر نفر سهم خودش را دارد"
            value={s.referral.minAdds}
            onChange={(v) => setIn('referral', { minAdds: v })}
          />
          <NumberField
            label="چت ناشناس هدیه به ازای همین تعداد"
            hint="مثلاً ۲۰ ← ۵: با ۲۰ نفر ۵ چت، با ۲۴ نفر ۶ چت، با ۴۰ نفر ۱۰ چت"
            value={s.referral.rewardChats}
            onChange={(v) => setIn('referral', { rewardChats: v })}
          />
          <NumberField
            label="لایک هدیه به ازای همین تعداد"
            hint="همان افزودن‌ها هر دو هدیه را می‌دهند؛ ۰ = دعوت لایک نمی‌دهد"
            value={s.referral.rewardLikes}
            onChange={(v) => setIn('referral', { rewardLikes: v })}
          />
        </Section>
        <Section title="تجربه‌ی اول کاربر تازه‌وارد">
          <NumberField
            label="باز شدن خودکار محدوده‌ی کشف"
            hint="اگر در شهر/استان کاربر کمتر از این تعداد آدم جدید بود، از استان و بعد کل کشور هم نشان داده می‌شود؛ ۰ = خاموش"
            value={s.growth.autoWidenBelow}
            onChange={(v) => setIn('growth', { autoWidenBelow: v })}
          />
          <NumberField
            label="لایک‌های اول رایگان"
            hint="چند نفر اولی که کاربر را لایک می‌کنند بدون عضویت ویژه دیده می‌شوند"
            value={s.growth.freeRevealedLikes}
            onChange={(v) => setIn('growth', { freeRevealedLikes: v })}
          />
          <NumberField
            label="نمایش فوری تازه‌وارد به کاربران آنلاین"
            hint="بعد از ثبت‌نام، تازه‌وارد اول کارت‌های این تعداد کاربرِ آنلاینِ مناسب قرار می‌گیرد"
            value={s.growth.newcomerFanout}
            onChange={(v) => setIn('growth', { newcomerFanout: v })}
          />
        </Section>

        <Section title="کشف: ترتیب و انصاف">
          <NumberField
            label="هر چند کارت، یک نفر که لایکت کرده"
            hint="سریع‌ترین راه رسیدن به مچ؛ ۰ = قاطی نشود"
            value={s.growth.likersEvery}
            onChange={(v) => setIn('growth', { likersEvery: v })}
          />
          <NumberField
            label="سقف نرم لایک روزانه‌ی هر پروفایل"
            hint="پروفایلی که در یک روز بیشتر از این لایک گرفته، کمتر نشان داده می‌شود تا لایک‌ها بین همه پخش شود؛ ۰ = خاموش"
            value={s.growth.exposureSoftCap}
            onChange={(v) => setIn('growth', { exposureSoftCap: v })}
          />
          <NumberField
            label="برگشت ردشده‌ها بعد از چند روز"
            hint="وقتی کارت‌ها تمام شد، کسانی که قبلاً رد شده‌اند دوباره نشان داده می‌شوند؛ ۰ = هرگز"
            value={s.growth.passRecycleDays}
            onChange={(v) => setIn('growth', { passRecycleDays: v })}
          />
          <NumberField
            label="حذف از کشف بعد از چند روز بی‌فعالیتی"
            hint="پروفایل‌های خیلی قدیمی تجربه‌ی اول را خراب می‌کنند"
            value={s.growth.inactiveDays}
            onChange={(v) => setIn('growth', { inactiveDays: v })}
          />
        </Section>

        <Section title="مچ و گفتگو">
          <NumberField
            label="حداکثر پیام پشت‌سرهم تا جواب طرف مقابل"
            hint="جلوی سیل پیام برای کسی که هنوز جواب نداده را می‌گیرد؛ ۰ = بدون محدودیت"
            value={s.matching.maxUnanswered}
            onChange={(v) => setIn('matching', { maxUnanswered: v })}
          />
          <NumberField
            label="یادآوری مچِ بی‌پیام بعد از چند ساعت"
            hint="به هر دو طرف، یک بار؛ ۰ = خاموش"
            value={s.matching.nudgeHours}
            onChange={(v) => setIn('matching', { nudgeHours: v })}
          />
          <NumberField
            label="بایگانی مچِ بی‌پیام بعد از چند روز"
            hint="حذف نمی‌شود؛ فقط از لیست اصلی کنار می‌رود و با اولین پیام برمی‌گردد. ۰ = هرگز"
            value={s.matching.archiveDays}
            onChange={(v) => setIn('matching', { archiveDays: v })}
          />
        </Section>

        <Section title="ایمنی خودکار">
          <NumberField
            label="بن سایه بعد از گزارش چند نفرِ متفاوت"
            hint="در ۲۴ ساعت؛ حساب برای خودش کار می‌کند ولی به کسی نمی‌رسد، تا ناظر بررسی کند. ۰ = خاموش"
            value={s.safety.autoShadowReports}
            onChange={(v) => setIn('safety', { autoShadowReports: v })}
          />
          <NumberField
            label="مخفی کردن عکس‌ها بعد از گزارش چند نفر"
            hint="گزارش «پروفایل جعلی» یا «عکس نامناسب» از افراد متفاوت در ۲۴ ساعت؛ ۰ = خاموش"
            value={s.safety.photoReportsToHide}
            onChange={(v) => setIn('safety', { photoReportsToHide: v })}
          />
        </Section>

        <Section title="شب Vibe (ساعت شلوغ هر شب)">
          <Toggle checked={s.vibeNight.enabled} onChange={(v) => setIn('vibeNight', { enabled: v })} label="شب Vibe فعال است" />
          <div />
          <NumberField label="ساعت شروع (به وقت تهران، ۰ تا ۲۳)" value={s.vibeNight.startHour} onChange={(v) => setIn('vibeNight', { startHour: v })} />
          <NumberField label="مدت (دقیقه)" value={s.vibeNight.durationMinutes} onChange={(v) => setIn('vibeNight', { durationMinutes: v })} />
          <NumberField
            label="سوپرلایک هدیه برای ورود در شب Vibe"
            hint="هر کاربر هر شب یک بار"
            value={s.vibeNight.bonusSuperLikes}
            onChange={(v) => setIn('vibeNight', { bonusSuperLikes: v })}
          />
          <NumberField
            label="یادآوری تلگرامی هر چند روز یک بار"
            hint="فقط برای کسانی که امروز سر نزده‌اند؛ ۰ = بدون یادآوری"
            value={s.vibeNight.reminderEveryDays}
            onChange={(v) => setIn('vibeNight', { reminderEveryDays: v })}
          />
          <div className="sm:col-span-2">
            <Field label="متن یادآوری" hint="HTML تلگرام مجاز است (<b>، <i>)">
              <textarea className="field min-h-20" value={s.vibeNight.text} onChange={(e) => setIn('vibeNight', { text: e.target.value })} />
            </Field>
          </div>
        </Section>

        <Section title="دیوار">
          <Toggle checked={s.wall.enabled} onChange={(v) => setIn('wall', { enabled: v })} label="دیوار فعال است" />
          <NumberField label="مدت نمایش هر درخواست (ساعت)" value={s.wall.ttlHours} onChange={(v) => setIn('wall', { ttlHours: v })} />
          <NumberField
            label="درخواست فعال هم‌زمان"
            hint="برای همه، اعضای ویژه هم؛ کاربر به‌جای ثبت دوباره، درخواست فعالش را ویرایش می‌کند"
            value={s.wall.freeDailyPosts}
            onChange={(v) => setIn('wall', { freeDailyPosts: v })}
          />
          <NumberField
            label="فاصله تا درخواست بعدی (ساعت)"
            hint="برای همه؛ ۲۴ یعنی روزی یک درخواست. از زمان ثبت آخرین درخواست؛ حذف کردن آن را کوتاه نمی‌کند. ۰ = بدون فاصله"
            value={s.wall.repostCooldownHours}
            onChange={(v) => setIn('wall', { repostCooldownHours: v })}
          />
          <NumberField
            label="یادآوری درخواست‌های بی‌جواب (ساعت)"
            hint="به صاحب درخواست، برای هر درخواست گفتگو یک بار؛ ۰ = خاموش"
            value={s.wall.requestReminderHours}
            onChange={(v) => setIn('wall', { requestReminderHours: v })}
          />
          <NumberField label="درخواست گفتگو از دیوار در روز — عادی" value={s.wall.freeDailyChats} onChange={(v) => setIn('wall', { freeDailyChats: v })} />
          <NumberField label="درخواست گفتگو از دیوار در روز — ویژه" value={s.wall.premiumDailyChats} onChange={(v) => setIn('wall', { premiumDailyChats: v })} />
          <NumberField
            label="برداشتن خودکار بعد از چند گزارش"
            hint="تا بررسی ناظر از دیوار و گروه برداشته می‌شود"
            value={s.wall.autoHideReports}
            onChange={(v) => setIn('wall', { autoHideReports: v })}
          />
          <NumberField
            label="نمایش ویژه‌ی اولین درخواست تازه‌واردها (ساعت)"
            hint="بالای دیوار و با برچسب «تازه‌وارد»؛ ۰ = خاموش"
            value={s.wall.newcomerSpotlightHours}
            onChange={(v) => setIn('wall', { newcomerSpotlightHours: v })}
          />
          <Toggle
            checked={s.wall.telegram.enabled}
            onChange={(v) => setIn('wall', { telegram: { ...s.wall.telegram, enabled: v } })}
            label="انتشار درخواست‌ها در گروه تلگرام"
          />
          <Field label="شناسه‌ی گروه" hint="ربات را ادمین گروه کنید و در گروه /chatid بفرستید (مثل -1001234567890)">
            <input
              className="field"
              dir="ltr"
              value={s.wall.telegram.chatId}
              onChange={(e) => setIn('wall', { telegram: { ...s.wall.telegram, chatId: e.target.value.trim() } })}
            />
          </Field>
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
          <NumberField label="فاصله‌ی اعلان «یک نفر لایکت کرد» (دقیقه)" value={s.bot.likeCooldownMin} onChange={(v) => setIn('bot', { likeCooldownMin: v })} />
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

        <Section title="چت تصادفی">
          <Toggle checked={s.randomChat.enabled} onChange={(v) => setIn('randomChat', { enabled: v })} label="چت تصادفی فعال است" />
          <NumberField
            label="چت رایگان آقایان (کل، نه روزانه)"
            hint="فقط گفتگوهایی که هر دو طرف پیام داده‌اند حساب می‌شوند. بیشتر از این با دعوت دوستان یا عضویت ویژه؛ خانم‌ها و اعضای ویژه نامحدودند"
            value={s.randomChat.freeSessions}
            onChange={(v) => setIn('randomChat', { freeSessions: v })}
          />
          <NumberField
            label="سقف روزانه‌ی آقایان ویژه"
            hint="چت ناشناس در روز برای آقایانی که عضو ویژه‌اند؛ ۰ = نامحدود. خانم‌ها همیشه نامحدودند"
            value={s.randomChat.premiumDailySessions}
            onChange={(v) => setIn('randomChat', { premiumDailySessions: v })}
          />
          <NumberField
            label="ترک زودهنگام تا چند ثانیه «رد کردن» حساب شود"
            value={s.randomChat.skipSeconds}
            onChange={(v) => setIn('randomChat', { skipSeconds: v })}
          />
          <NumberField
            label="چند رد کردن پشت‌سرهم تا وقفه"
            hint="۰ = بدون وقفه"
            value={s.randomChat.skipLimit}
            onChange={(v) => setIn('randomChat', { skipLimit: v })}
          />
          <NumberField label="مدت وقفه (ثانیه)" value={s.randomChat.cooldownSeconds} onChange={(v) => setIn('randomChat', { cooldownSeconds: v })} />
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
