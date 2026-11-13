/** Profile option lists. The app renders labels from /v1/meta, so wording changes need no app update. */

export interface Option {
  id: string;
  label: string;
  emoji?: string;
}

export const GOALS: Option[] = [
  { id: 'serious', label: 'رابطه‌ی جدی', emoji: '💞' },
  { id: 'marriage', label: 'ازدواج', emoji: '💍' },
  { id: 'dating', label: 'قرار عاشقانه', emoji: '🌹' },
  { id: 'friendship', label: 'دوستی', emoji: '🤝' },
  { id: 'chat', label: 'هم‌صحبتی', emoji: '💬' },
  { id: 'unsure', label: 'هنوز مطمئن نیستم', emoji: '✨' },
];

export const INTERESTS: Option[] = [
  { id: 'music', label: 'موسیقی', emoji: '🎵' },
  { id: 'movies', label: 'فیلم و سریال', emoji: '🎬' },
  { id: 'travel', label: 'سفر', emoji: '✈️' },
  { id: 'nature', label: 'طبیعت‌گردی', emoji: '🌿' },
  { id: 'mountain', label: 'کوهنوردی', emoji: '⛰️' },
  { id: 'gym', label: 'باشگاه', emoji: '💪' },
  { id: 'football', label: 'فوتبال', emoji: '⚽' },
  { id: 'swimming', label: 'شنا', emoji: '🏊' },
  { id: 'yoga', label: 'یوگا', emoji: '🧘' },
  { id: 'dance', label: 'رقص', emoji: '💃' },
  { id: 'books', label: 'کتاب', emoji: '📚' },
  { id: 'poetry', label: 'شعر', emoji: '🖋️' },
  { id: 'coffee', label: 'کافه‌گردی', emoji: '☕' },
  { id: 'food', label: 'غذای خوب', emoji: '🍕' },
  { id: 'cooking', label: 'آشپزی', emoji: '🍳' },
  { id: 'photography', label: 'عکاسی', emoji: '📷' },
  { id: 'art', label: 'هنر و نقاشی', emoji: '🎨' },
  { id: 'fashion', label: 'مد و استایل', emoji: '👗' },
  { id: 'shopping', label: 'خرید', emoji: '🛍️' },
  { id: 'gaming', label: 'گیم', emoji: '🎮' },
  { id: 'tech', label: 'تکنولوژی', emoji: '💻' },
  { id: 'cars', label: 'ماشین', emoji: '🏎️' },
  { id: 'pets', label: 'حیوانات خانگی', emoji: '🐾' },
  { id: 'sea', label: 'دریا', emoji: '🌊' },
  { id: 'party', label: 'دورهمی', emoji: '🌙' },
  { id: 'podcast', label: 'پادکست', emoji: '🎧' },
  { id: 'psychology', label: 'روانشناسی', emoji: '🧠' },
  { id: 'business', label: 'کسب‌وکار', emoji: '📈' },
  { id: 'astrology', label: 'طالع‌بینی', emoji: '♈' },
  { id: 'languages', label: 'یادگیری زبان', emoji: '🗣️' },
];

export const EDUCATION: Option[] = [
  { id: 'diploma', label: 'دیپلم' },
  { id: 'associate', label: 'کاردانی' },
  { id: 'bachelor', label: 'کارشناسی' },
  { id: 'master', label: 'کارشناسی ارشد' },
  { id: 'phd', label: 'دکترا' },
  { id: 'other', label: 'سایر' },
];

export const SMOKING: Option[] = [
  { id: 'no', label: 'سیگار نمی‌کشم' },
  { id: 'sometimes', label: 'گاهی' },
  { id: 'yes', label: 'سیگار می‌کشم' },
];

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
export const GOAL_IDS = ids(GOALS);
export const INTEREST_IDS = new Set(INTERESTS.map((o) => o.id));
export const EDUCATION_IDS = ids(EDUCATION);
export const SMOKING_IDS = ids(SMOKING);
export const MARITAL_IDS = ids(MARITAL);
export const REPORT_REASON_IDS = ids(REPORT_REASONS);

/** What a Wall request is about. */
export const WALL_CATEGORIES: Option[] = [
  { id: 'chat', label: 'هم‌صحبتی', emoji: '💬' },
  { id: 'friendship', label: 'دوستی', emoji: '🤝' },
  { id: 'dating', label: 'قرار عاشقانه', emoji: '🌹' },
  { id: 'serious', label: 'رابطه‌ی جدی', emoji: '💞' },
  { id: 'outing', label: 'کافه و تفریح', emoji: '☕' },
  { id: 'travel', label: 'همسفر', emoji: '✈️' },
  { id: 'sport', label: 'هم‌ورزشی', emoji: '🏃' },
  { id: 'gaming', label: 'هم‌بازی', emoji: '🎮' },
];
export const WALL_CATEGORY_IDS = ids(WALL_CATEGORIES);
