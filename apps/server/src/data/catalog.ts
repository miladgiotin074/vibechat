/** The two option lists left. The app renders labels from /v1/meta, so wording changes need no app update. */

export interface Option {
  id: string;
  label: string;
  emoji?: string;
}

export const MARITAL: Option[] = [
  { id: 'single', label: 'مجرد' },
  { id: 'divorced', label: 'جداشده' },
  { id: 'widowed', label: 'همسر فوت‌شده' },
];

export const REPORT_REASONS: Option[] = [
  { id: 'fake_profile', label: 'پروفایل جعلی' },
  { id: 'inappropriate_photos', label: 'عکس نامناسب' },
  { id: 'harassment', label: 'مزاحمت یا توهین' },
  { id: 'scam', label: 'کلاهبرداری یا درخواست پول' },
  { id: 'spam', label: 'تبلیغات و اسپم' },
  { id: 'underage', label: 'زیر ۱۸ سال' },
  { id: 'other', label: 'سایر' },
];

const ids = (list: Option[]) => list.map((o) => o.id) as [string, ...string[]];
export const MARITAL_IDS = ids(MARITAL);
export const REPORT_REASON_IDS = ids(REPORT_REASONS);
