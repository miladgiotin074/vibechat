import type { SpotlightStep } from '@/ui/Spotlight';

/** The home-page tour: the card, and the two answers under it. */
export const HOME_TOUR: SpotlightStep[] = [
  {
    target: 'card',
    emoji: '👀',
    title: 'پروفایل‌ها',
    text: 'عکس‌ها رو با زدن روی دو طرف کارت ببین، و برای دیدن پروفایل کامل روی کارت بزن.',
    padding: 4,
    radius: 28,
  },
  {
    target: 'message',
    emoji: '💬',
    title: 'پیام بده',
    text: 'خوشت اومد؟ یه پیام کوتاه بنویس و همون لحظه گفتگوتون شروع می‌شه. نه لایکی، نه انتظاری.',
    padding: 6,
    radius: 999,
  },
  {
    target: 'skip',
    emoji: '✖️',
    title: 'رد کردن',
    text: 'سراغ نفر بعدی برو؛ اون نمی‌فهمه 😉',
    shape: 'circle',
  },
];
