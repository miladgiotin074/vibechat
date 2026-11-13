const FA = '۰۱۲۳۴۵۶۷۸۹';

/** 123 → ۱۲۳ (Persian digits everywhere numbers are shown). */
export const fa = (v: string | number | null | undefined) => String(v ?? '').replace(/\d/g, (d) => FA[Number(d)]!);

/** Persian/Arabic digits typed by the user → Latin. */
export const latinDigits = (s: string) => s.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0)).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660));

export const toman = (n: number) => fa(n.toLocaleString('en-US')) + ' تومان';

/** Price in thousands: 239000 → «۲۳۹ هزار». */
export const tomanShort = (n: number) => (n >= 1000 && n % 1000 === 0 ? fa((n / 1000).toLocaleString('en-US')) + ' هزار' : fa(n.toLocaleString('en-US')));

export function clock(iso: string) {
  const d = new Date(iso);
  return fa(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
}

const dayFmt = new Intl.DateTimeFormat('fa-IR', { weekday: 'long' });
const dateFmt = new Intl.DateTimeFormat('fa-IR', { day: 'numeric', month: 'long' });
const fullFmt = new Intl.DateTimeFormat('fa-IR', { day: 'numeric', month: 'long', year: 'numeric' });

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Chat list timestamps: «۱۴:۲۰», «دیروز», «سه‌شنبه», «۱۲ آبان». */
export function shortTime(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  if (sameDay(d, now)) return clock(iso);
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return 'دیروز';
  if (now.getTime() - d.getTime() < 6 * 86400_000) return dayFmt.format(d);
  return dateFmt.format(d);
}

/** Day separators inside a chat. */
export function dayLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (sameDay(d, now)) return 'امروز';
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return 'دیروز';
  return now.getTime() - d.getTime() < 6 * 86400_000 ? dayFmt.format(d) : fullFmt.format(d);
}

export const fullDate = (iso: string) => fullFmt.format(new Date(iso));

/** «همین الان», «۵ دقیقه پیش», «۳ ساعت پیش», «دیروز»… */
export function ago(iso: string | null | undefined) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'همین الان';
  if (s < 3600) return `${fa(Math.floor(s / 60))} دقیقه پیش`;
  if (s < 86400) return `${fa(Math.floor(s / 3600))} ساعت پیش`;
  if (s < 2 * 86400) return 'دیروز';
  if (s < 30 * 86400) return `${fa(Math.floor(s / 86400))} روز پیش`;
  return dateFmt.format(new Date(iso));
}

export function lastSeen(iso: string, online: boolean) {
  if (online) return 'آنلاین';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return 'اخیراً فعال';
  if (s < 86400) return 'امروز فعال بوده';
  return `فعال ${ago(iso)}`;
}

export const isNewcomer = (lastActiveAt: string, activatedAt?: string | null) =>
  !!activatedAt && Date.now() - new Date(activatedAt).getTime() < 3 * 86400_000 && !!lastActiveAt;

export const clientId = () => (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, '');
