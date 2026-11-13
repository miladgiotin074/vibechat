import { AtSign, Ban, Bell, EyeOff, FileText, Heart, HelpCircle, Lightbulb, MapPinOff, MessageCircle, Pause, Shield, UserRound } from 'lucide-react';
import { api, errorMessage } from '@/api/client';
import { setMe, useMe, useMeta } from '@/api/queries';
import type { Me } from '@/api/types';
import { nav } from '@/store/nav';
import { toast, useUi } from '@/store/ui';
import { askWriteAccess, openExternal, openTelegram } from '@/telegram/tg';
import { Card, Divider, PremiumBadge, Row, SectionTitle, ToggleRow } from '@/ui/kit';

/**
 * Every setting of the account, laid out as sections. They live at the bottom of the profile tab —
 * there is no separate settings screen to go looking for.
 */
export function SettingsSections() {
  const me = useMe().data!;
  const meta = useMeta().data;

  const patch = async (path: string, body: Record<string, unknown>, premiumOnly?: boolean) => {
    if (premiumOnly && !me.premium.active && Object.values(body).some(Boolean)) {
      return nav.push({ name: 'premium', reason: 'privacy' });
    }
    try {
      setMe(await api.patch<Me>(path, body));
    } catch (e) {
      toast(errorMessage(e), '⚠️', 'error');
    }
  };

  return (
    <div>
      <SectionTitle>حریم خصوصی</SectionTitle>
      <Card className="overflow-hidden">
        <ToggleRow
          icon={<Pause />}
          tint="gold"
          title="توقف موقت حساب"
          subtitle="در کشف نشان داده نمی‌شوی؛ مچ‌ها و گفتگوها می‌مانند"
          checked={!me.privacy.discoverable}
          onChange={(v) => patch('/v1/me/privacy', { discoverable: !v })}
        />
        <Divider />
        <ToggleRow
          icon={<EyeOff />}
          tint="violet"
          title="حالت مخفی"
          badge={<PremiumBadge size={15} />}
          subtitle="فقط کسانی که لایکشان کرده‌ای تو را می‌بینند"
          checked={me.privacy.incognito}
          onChange={(v) => patch('/v1/me/privacy', { incognito: v }, true)}
        />
        <Divider />
        <ToggleRow
          icon={<UserRound />}
          tint="violet"
          title="پنهان کردن سن"
          badge={<PremiumBadge size={15} />}
          checked={me.privacy.hideAge}
          onChange={(v) => patch('/v1/me/privacy', { hideAge: v }, true)}
        />
        <Divider />
        <ToggleRow
          icon={<MapPinOff />}
          tint="sky"
          title="پنهان کردن فاصله"
          checked={me.privacy.hideDistance}
          onChange={(v) => patch('/v1/me/privacy', { hideDistance: v })}
        />
        <Divider />
        <ToggleRow
          icon={<AtSign />}
          tint="sky"
          title="نمایش آیدی تلگرام به مچ‌ها"
          subtitle={me.telegram.username ? `@${me.telegram.username} فقط برای کسانی که با آنها مچ شده‌ای` : 'برای حساب تلگرامت یوزرنیم تعریف نشده'}
          checked={me.privacy.showTelegram}
          disabled={!me.telegram.username}
          onChange={(v) => patch('/v1/me/privacy', { showTelegram: v })}
        />
      </Card>

      <SectionTitle>اعلان‌ها در تلگرام</SectionTitle>
      <Card className="overflow-hidden">
        {!me.telegram.canDm ? (
          <>
            <Row
              icon={<Bell />}
              tint="rose"
              title="روشن کردن اعلان‌ها"
              subtitle="اجازه بده ربات Vibe خبر مچ‌ها و پیام‌ها را برایت بفرستد"
              onClick={async () => {
                if (await askWriteAccess()) {
                  await api.post('/v1/me/write-access', { allowed: true }).catch(() => undefined);
                  setMe({ ...me, telegram: { ...me.telegram, canDm: true } });
                  toast('اعلان‌ها روشن شد', '🔔', 'success');
                }
              }}
            />
            <Divider />
          </>
        ) : null}
        <ToggleRow icon={<Heart />} tint="rose" title="مچ‌های جدید" checked={me.notifications.matches} onChange={(v) => patch('/v1/me/notification-settings', { matches: v })} />
        <Divider />
        <ToggleRow icon={<MessageCircle />} tint="violet" title="پیام‌های جدید" checked={me.notifications.messages} onChange={(v) => patch('/v1/me/notification-settings', { messages: v })} />
        <Divider />
        <ToggleRow icon={<Bell />} tint="gold" title="لایک‌ها" checked={me.notifications.likes} onChange={(v) => patch('/v1/me/notification-settings', { likes: v })} />
      </Card>

      <SectionTitle>امنیت و راهنما</SectionTitle>
      <Card className="overflow-hidden">
        <Row icon={<Ban />} tint="danger" title="کاربران مسدودشده" onClick={() => nav.push({ name: 'blocked' })} />
        <Divider />
        <Row
          icon={<Lightbulb />}
          tint="gold"
          title="راهنمای صفحه‌ی اصلی"
          subtitle="دوباره ببین هر دکمه چه کاری می‌کنه"
          onClick={() => {
            nav.reset('discover');
            // after the screen slides away
            setTimeout(() => useUi.getState().setTour(true), 450);
          }}
        />
        {meta?.support.telegram ? (
          <>
            <Divider />
            <Row icon={<HelpCircle />} tint="mint" title="پشتیبانی" subtitle={'@' + meta.support.telegram} onClick={() => openTelegram(`https://t.me/${meta.support.telegram}`)} />
          </>
        ) : null}
        {meta?.support.termsUrl ? (
          <>
            <Divider />
            <Row icon={<FileText />} tint="mint" title="قوانین استفاده" onClick={() => openExternal(meta.support.termsUrl)} />
          </>
        ) : null}
        {meta?.support.privacyUrl ? (
          <>
            <Divider />
            <Row icon={<Shield />} tint="mint" title="حریم خصوصی" onClick={() => openExternal(meta.support.privacyUrl)} />
          </>
        ) : null}
      </Card>

      <p className="mt-6 text-center text-[11.5px] text-faint" dir="ltr">
        Vibe Chat · {me.refCode}
      </p>
    </div>
  );
}
