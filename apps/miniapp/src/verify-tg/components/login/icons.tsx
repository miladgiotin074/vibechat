import { TgLottie } from "./TgLottie";

export function BackIcon() {
  return <img src="/tg/ic_ab_back.webp" alt="" width={24} height={24} className="h-6 w-6 flip-rtl" />;
}

export function ChevronIcon() {
  return <img src="/tg/msg_inputarrow.webp" alt="" width={24} height={24} className="h-6 w-6 flip-rtl" />;
}

export function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <circle cx="11" cy="11" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M16 16.5 20 20.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** R.raw.code_laptop, 128dp, loops. */
export function LaptopIcon() {
  return <TgLottie name="code_laptop" size={128} />;
}

/** R.raw.sms_incoming_info, 64dp, loops. */
export function SmsIcon() {
  return <TgLottie name="sms_incoming_info" size={64} />;
}

/** R.raw.phone_flash_call, 64dp. */
export function FlashCallIcon() {
  return <TgLottie name="phone_flash_call" size={64} />;
}

/** R.drawable.login_phone1 and R.drawable.login_arrow1, 64dp. */
export function MissedCallIcon() {
  return (
    <span className="relative block h-16 w-16">
      <img src="/tg/login_phone1.webp" alt="" width={64} height={64} className="h-16 w-16" />
      <img src="/tg/login_arrow1.webp" alt="" width={64} height={64} className="absolute inset-0 h-16 w-16" />
    </span>
  );
}

/** R.raw.tsv_setup_intro, 120dp, plays once. Hidden on short screens. */
export function LockIcon() {
  return <TgLottie name="tsv_setup_intro" size={120} loop={false} className="hero-optional" />;
}

/** R.raw.tsv_setup_mail or R.raw.email_check_inbox, 120dp, plays once. */
export function MailIcon({ inbox = false }: { inbox?: boolean }) {
  return <TgLottie name={inbox ? "email_check_inbox" : "tsv_setup_mail"} size={120} loop={false} className="hero-optional" />;
}

/** R.raw.bubble, 95dp. */
export function BubbleIcon() {
  return <TgLottie name="bubble" size={95} />;
}

/** R.raw.camera, 70dp, intro frames 0–43. */
export function CameraBadge() {
  return <TgLottie name="camera" size={70} endFrame={43} />;
}
