const num = new Intl.NumberFormat('fa-IR');
const dateTime = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' });
const date = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium' });
const dayMonth = new Intl.DateTimeFormat('fa-IR', { month: 'short', day: 'numeric' });

export const fmtNum = (n: number | string | null | undefined) => (n == null ? '—' : num.format(Number(n)));
export const fmtDateTime = (d: string | Date | null | undefined) => (d ? dateTime.format(new Date(d)) : '—');
export const fmtDate = (d: string | Date | null | undefined) => (d ? date.format(new Date(d)) : '—');
export const fmtDay = (d: string) => dayMonth.format(new Date(d + 'T12:00:00'));

/** "۵ دقیقه پیش" */
export function fmtAgo(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'همین حالا';
  if (s < 3600) return `${num.format(Math.floor(s / 60))} دقیقه پیش`;
  if (s < 86400) return `${num.format(Math.floor(s / 3600))} ساعت پیش`;
  if (s < 30 * 86400) return `${num.format(Math.floor(s / 86400))} روز پیش`;
  return fmtDate(d);
}

export const STATUS_LABEL: Record<string, string> = {
  onboarding: 'در حال ثبت‌نام',
  active: 'فعال',
  suspended: 'تعلیق',
  banned: 'مسدود',
  deleted: 'حذف‌شده',
  pending: 'در انتظار',
  approved: 'تأییدشده',
  rejected: 'ردشده',
  review: 'در انتظار بررسی',
  open: 'باز',
  resolved: 'رسیدگی‌شده',
  dismissed: 'ردشده',
  paid: 'پرداخت‌شده',
  failed: 'ناموفق',
  canceled: 'لغوشده',
  expired: 'منقضی',
  removed: 'برداشته‌شده',
};

export const STATUS_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'muted' | 'info' | 'brand'> = {
  active: 'ok',
  approved: 'ok',
  paid: 'ok',
  resolved: 'ok',
  onboarding: 'info',
  pending: 'warn',
  open: 'warn',
  suspended: 'warn',
  banned: 'danger',
  rejected: 'danger',
  review: 'warn',
  failed: 'danger',
  deleted: 'muted',
  dismissed: 'muted',
  canceled: 'muted',
  expired: 'muted',
  removed: 'danger',
};

export const ROLE_LABEL: Record<string, string> = { superadmin: 'مدیر کل', moderator: 'ناظر محتوا', support: 'پشتیبانی' };
export const GENDER_LABEL: Record<string, string> = { male: 'مرد', female: 'زن', everyone: 'همه' };

export const REPORT_ACTION_LABEL: Record<string, string> = {
  dismiss: 'رد گزارش',
  warn: 'اخطار',
  suspend: 'تعلیق',
  ban: 'مسدودسازی',
};
