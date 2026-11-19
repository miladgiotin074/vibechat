import type { SpotlightStep } from '@/ui/Spotlight';

/** The home-page tour: the two answers under the card, and nothing else. */
export const HOME_TOUR: SpotlightStep[] = [
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
