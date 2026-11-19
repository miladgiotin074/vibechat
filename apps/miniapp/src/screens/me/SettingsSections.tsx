import { Ban, FileText, HelpCircle, Lightbulb, Shield } from 'lucide-react';
import { useMe, useMeta } from '@/api/queries';
import { nav } from '@/store/nav';
import { useUi } from '@/store/ui';
import { openExternal, openTelegram } from '@/telegram/tg';
import { Card, Divider, Row, SectionTitle } from '@/ui/kit';

/**
 * What is left at the bottom of the profile tab: blocked people, the home-page tour, support and
 * the two documents. There is no separate settings screen to go looking for.
 */
export function SettingsSections() {
  const me = useMe().data!;
  const meta = useMeta().data;

  return (
    <div>
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
