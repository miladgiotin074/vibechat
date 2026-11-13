import type { SpotlightStep } from '@/ui/Spotlight';

/** The home-page tour: only the five buttons under the card, then random chat. */
export const HOME_TOUR: SpotlightStep[] = [
  {
    target: 'like',
    emoji: '❤️',
    title: 'لایک',
    text: 'اگه اونم لایکت کنه مچ می‌شید و می‌تونید با هم چت کنید. کارت رو به راست بکشی هم یعنی لایک.',
    shape: 'circle',
  },
  {
    target: 'pass',
    emoji: '✖️',
    title: 'رد کردن',
    text: 'سراغ نفر بعدی برو؛ اون نمی‌فهمه 😉 کارت رو به چپ بکشی هم یعنی رد.',
    shape: 'circle',
  },
  {
    target: 'superlike',
    emoji: '⭐',
    title: 'سوپرلایک',
    text: 'یعنی خیلی ازش خوشت اومده! تو لیستش برجسته می‌شی و شانس مچ خیلی بیشتره. عدد روی دکمه یعنی چندتا داری.',
    shape: 'circle',
  },
  {
    target: 'rewind',
    emoji: '↩️',
    title: 'برگشت',
    text: 'اشتباهی کسی رو رد کردی؟ با این دکمه برگرد سراغش. (مخصوص اعضای ویژه 💎)',
    shape: 'circle',
  },
  {
    target: 'boost',
    emoji: '⚡',
    title: 'بوست',
    text: 'نیم ساعت اول از همه دیده شو و چند برابر لایک بگیر. (مخصوص اعضای ویژه 💎)',
    shape: 'circle',
  },
  {
    target: 'random',
    emoji: '🎲',
    title: 'چت تصادفی',
    text: 'همین الان با یه آدم آنلاین، ناشناس گپ بزن. اگه همدیگه رو لایک کنید، عکس‌ها باز می‌شن و مچ می‌شید.',
    padding: 6,
    radius: 999,
  },
];
