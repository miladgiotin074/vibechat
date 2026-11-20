export type Locale = "en" | "fa";

const en = {
  yourNumber: "Your phone number",
  startText: "Please confirm your country code and enter your phone number.",
  country: "Country",
  phoneNumber: "Phone number",
  confirmNumber: "Is this the correct number?",
  edit: "Edit",
  yes: "Yes",
  chooseCountry: "Choose a country",
  search: "Search",
  wrongCountry: "Invalid country code",
  wrongFormat: "Wrong format",
  shortNumber:
    "The number you provided is too short for **{country}**:\n\n**{phone}**\n\nPlease enter the correct number including your country code.",
  appTitle: "Check your Telegram messages",
  smsTitle: "Enter code",
  callTitle: "Enter code",
  yourCode: "Phone verification",
  missedTitle: "Enter the missing digits",
  fragmentTitle: "Enter code",
  wordTitle: "Enter word from SMS",
  phraseTitle: "Enter phrase from SMS",
  sentApp: "We've sent the code to the **Telegram** app on your other device.",
  sentSms: "We've sent an SMS with an activation code to your phone **{phone}**.",
  sentCall:
    "We're calling your phone **{phone}**.\n\nDon't accept the call, Telegram will process everything automatically.",
  sentFragment: "Get the code for **{phone}** in the Anonymous Numbers section on Fragment.",
  missedSubtitle: "Within the next few seconds you should receive a short call from:",
  missedSubtitle2: "Please enter the last digits of the number that called",
  wordHint: "Enter Word from SMS",
  phraseHint: "Enter Phrase from SMS",
  wordLabel: "Secret word",
  phraseLabel: "Secret phrase",
  wrongNumber: "Wrong number?",
  wrongCode: "You entered the wrong code. Please try again.",
  didNotGet: "Didn't get the code?",
  smsIn: "You can request an SMS in {m}:{s}",
  callIn: "You can request a voice call in {m}:{s}",
  resendSmsIn: "You can request a new SMS in {m}:{s}",
  getSms: "Get the code via SMS",
  getCall: "Call me to dictate the code",
  getMissed: "Get the code via phone call",
  sendingSms: "Sending SMS...",
  calling: "Calling you...",
  openFragment: "Open Fragment",
  passwordTitle: "Your password",
  passwordText:
    "Two-Step Verification enabled. Your account is protected with an additional password.",
  enterPassword: "Enter password",
  forgotPassword: "Forgot password?",
  profileInfo: "Profile info",
  registerText: "Enter your name and add a profile picture.",
  firstName: "First name (required)",
  lastName: "Last name (optional)",
  addEmail: "Add Email",
  addEmailText: "Please enter your valid email address to protect your account.",
  yourEmail: "Your email",
  checkEmail: "Check Your Email",
  checkEmailText: "Please enter the code we have sent to your email {email}.",
  termsLogin: "By signing up,\nyou agree to the *Terms of Service*.",
  terms: "Terms of Service",
  accept: "Accept",
  decline: "Decline",
  sorry: "Sorry",
  noEmail:
    "Since you didn't provide a recovery email when setting up your password, your remaining options are either to remember your password or to reset your account.",
  resetAccount: "Reset account",
  resetUnavailable:
    "Account reset is not available in this mini app. You can reset it from an official Telegram app.",
  close: "Close",
  recoveryTitle: "Recovery code",
  recoverySent: "We have sent a recovery code to the email address you provided:\n\n{email}",
  continue: "Continue",
  ok: "OK",
  doneTitle: "You're logged in.",
  logOut: "Log out",
  captchaTitle: "Security check",
  captchaText: "Confirm this check to continue logging in.",
  helpTitle: "Didn't get the code?",
  helpText:
    "If you didn't get the code by SMS or call, check the number **{phone}** and try again in a moment.",
  flood: "Too many attempts, please try again later.",
  invalidPhone: "Invalid phone number. Please check the number and try again.",
  bannedPhone: "This phone number is banned.",
  phoneFlood:
    "Sorry, you have deleted and re-created your account too many times recently. Please wait a few days before signing up again.",
  codeExpired: "Code expired, please retry login.",
  badPassword: "Incorrect password. Please try again.",
  config: "Add API_ID and API_HASH from my.telegram.org to the server environment, then restart the app.",
  timeout: "The request timed out. Please try again.",
  sessionLost: "This login attempt expired. Enter your phone number again.",
  badApi: "The API ID or API hash is invalid.",
  updateApp: "Telegram asked this client to update before login can continue.",
  passwordFlood: "Too many attempts. Please try again later.",
  payment:
    "Telegram is asking for a paid login code for this number. That step is only available in official apps.",
  generic: "Something went wrong. Please try again.",
  firstNameRequired: "Enter your first name.",
  emailInvalid: "Enter a valid email address.",
  telegramMismatch:
    "This phone number is not linked to the Telegram account you used to open Vibe Chat.",
  noTelegram: "Your Vibe Chat account is not linked to Telegram.",
};

const fa: Record<keyof typeof en, string> = {
  yourNumber: "شماره تلفن شما",
  startText: "لطفاً کد کشور را تأیید کنید و شماره تلفن خود را وارد کنید.",
  country: "کشور",
  phoneNumber: "شماره تلفن",
  confirmNumber: "آیا این شماره درست است؟",
  edit: "ویرایش",
  yes: "بله",
  chooseCountry: "انتخاب کشور",
  search: "جستجو",
  wrongCountry: "کد کشور نامعتبر است",
  wrongFormat: "قالب شماره اشتباه است",
  shortNumber:
    "شماره‌ای که وارد کردید برای **{country}** کوتاه است:\n\n**{phone}**\n\nلطفاً شماره را با کد کشور، درست وارد کنید.",
  appTitle: "پیام‌های تلگرام خود را بررسی کنید",
  smsTitle: "کد را وارد کنید",
  callTitle: "کد را وارد کنید",
  yourCode: "تأیید تلفن",
  missedTitle: "ارقام جاافتاده را وارد کنید",
  fragmentTitle: "کد را وارد کنید",
  wordTitle: "کلمه موجود در پیامک را وارد کنید",
  phraseTitle: "عبارت موجود در پیامک را وارد کنید",
  sentApp: "کد را به برنامه **تلگرام** در دستگاه دیگر شما فرستادیم.",
  sentSms: "پیامکی حاوی کد فعال‌سازی به شماره **{phone}** فرستادیم.",
  sentCall:
    "در حال تماس با شماره **{phone}** هستیم.\n\nتماس را پاسخ ندهید. تلگرام بقیه کار را انجام می‌دهد.",
  sentFragment: "کد شماره **{phone}** را در بخش Anonymous Numbers در Fragment بگیرید.",
  missedSubtitle: "تا چند ثانیه دیگر تماسی کوتاه از این شماره می‌گیرید:",
  missedSubtitle2: "لطفاً آخرین ارقام شماره‌ای که تماس گرفته را وارد کنید",
  wordHint: "کلمه پیامک را وارد کنید",
  phraseHint: "عبارت پیامک را وارد کنید",
  wordLabel: "کلمه مخفی",
  phraseLabel: "عبارت مخفی",
  wrongNumber: "شماره اشتباه است؟",
  wrongCode: "کد واردشده اشتباه است. لطفاً دوباره تلاش کنید.",
  didNotGet: "کد را دریافت نکردید؟",
  smsIn: "می‌توانید تا {m}:{s} دیگر پیامک درخواست کنید",
  callIn: "می‌توانید تا {m}:{s} دیگر تماس صوتی درخواست کنید",
  resendSmsIn: "می‌توانید تا {m}:{s} دیگر پیامک تازه درخواست کنید",
  getSms: "دریافت کد از طریق پیامک",
  getCall: "برای خواندن کد با من تماس بگیر",
  getMissed: "دریافت کد از طریق تماس",
  sendingSms: "در حال فرستادن پیامک...",
  calling: "در حال تماس...",
  openFragment: "باز کردن Fragment",
  passwordTitle: "گذرواژه شما",
  passwordText: "تأیید دو مرحله‌ای فعال است. حساب شما با یک گذرواژه اضافی محافظت می‌شود.",
  enterPassword: "گذرواژه را وارد کنید",
  forgotPassword: "گذرواژه را فراموش کرده‌اید؟",
  profileInfo: "اطلاعات پروفایل",
  registerText: "نام خود را وارد کنید و یک عکس پروفایل اضافه کنید.",
  firstName: "نام (الزامی)",
  lastName: "نام خانوادگی (اختیاری)",
  addEmail: "افزودن ایمیل",
  addEmailText: "برای محافظت از حساب خود، یک آدرس ایمیل معتبر وارد کنید.",
  yourEmail: "ایمیل شما",
  checkEmail: "ایمیل خود را بررسی کنید",
  checkEmailText: "لطفاً کدی را که به ایمیل {email} فرستادیم وارد کنید.",
  termsLogin: "با ثبت‌نام،\nبا *شرایط خدمات* موافقت می‌کنید.",
  terms: "شرایط استفاده",
  accept: "پذیرش",
  decline: "رد کردن",
  sorry: "متأسفیم",
  noEmail:
    "چون هنگام تنظیم گذرواژه ایمیل بازیابی ثبت نکرده‌اید، یا باید گذرواژه را به خاطر بیاورید یا حساب را بازنشانی کنید.",
  resetAccount: "بازنشانی حساب",
  resetUnavailable:
    "بازنشانی حساب در این مینی‌اپ فعال نیست. این کار را از یک برنامه رسمی تلگرام انجام دهید.",
  close: "بستن",
  recoveryTitle: "کد بازیابی",
  recoverySent: "کد بازیابی را به ایمیلی که ثبت کرده‌اید فرستادیم:\n\n{email}",
  continue: "ادامه",
  ok: "باشه",
  doneTitle: "وارد حساب شدید.",
  logOut: "خروج",
  captchaTitle: "بررسی امنیتی",
  captchaText: "برای ادامه ورود، این بررسی را تأیید کنید.",
  helpTitle: "کد را دریافت نکردید؟",
  helpText: "اگر کد را با پیامک یا تماس نگرفتید، شماره **{phone}** را بررسی کنید و کمی بعد دوباره تلاش کنید.",
  flood: "تلاش‌ها بیش از حد بوده است. لطفاً بعداً دوباره تلاش کنید.",
  invalidPhone: "شماره تلفن نامعتبر است. شماره را بررسی کنید و دوباره تلاش کنید.",
  bannedPhone: "این شماره تلفن مسدود شده است.",
  phoneFlood: "این حساب اخیراً چند بار حذف و دوباره ساخته شده است. لطفاً چند روز صبر کنید.",
  codeExpired: "کد منقضی شده است. ورود را از نو شروع کنید.",
  badPassword: "گذرواژه اشتباه است. لطفاً دوباره تلاش کنید.",
  config: "API_ID و API_HASH را از my.telegram.org در محیط سرور بگذارید و برنامه را دوباره اجرا کنید.",
  timeout: "درخواست طول کشید. لطفاً دوباره تلاش کنید.",
  sessionLost: "این تلاش برای ورود منقضی شد. شماره تلفن را دوباره وارد کنید.",
  badApi: "API ID یا API hash نامعتبر است.",
  updateApp: "تلگرام قبل از ادامه ورود، به‌روزرسانی این کلاینت را خواسته است.",
  passwordFlood: "تلاش‌ها بیش از حد بوده است. لطفاً بعداً دوباره تلاش کنید.",
  payment: "تلگرام برای این شماره کد پولی خواسته است. این مرحله فقط در برنامه‌های رسمی انجام می‌شود.",
  generic: "مشکلی پیش آمد. لطفاً دوباره تلاش کنید.",
  firstNameRequired: "نام را وارد کنید.",
  emailInvalid: "یک ایمیل معتبر وارد کنید.",
  telegramMismatch:
    "این شماره به حساب تلگرامی که با آن ویب‌چت را باز کردی وصل نیست.",
  noTelegram: "حساب ویب‌چتت به تلگرام وصل نیست.",
};

export function detectLocale(language?: string): Locale {
  const value = (language ?? "").toLowerCase();
  if (value.startsWith("fa") || value.startsWith("ar")) return "fa";
  return "en";
}

export function t(locale: Locale, key: keyof typeof en, vars?: Record<string, string | number>) {
  let text = (locale === "fa" ? fa : en)[key];
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

const errorMap: Record<string, keyof typeof en> = {
  PHONE_NUMBER_INVALID: "invalidPhone",
  PHONE_NUMBER_BANNED: "bannedPhone",
  PHONE_NUMBER_FLOOD: "phoneFlood",
  PHONE_NUMBER_APP_SIGNUP_FORBIDDEN: "phoneFlood",
  PHONE_CODE_INVALID: "wrongCode",
  PHONE_CODE_EMPTY: "wrongCode",
  PHONE_CODE_EXPIRED: "codeExpired",
  PASSWORD_HASH_INVALID: "badPassword",
  API_ID_INVALID: "badApi",
  API_ID_PUBLISHED_FLOOD: "badApi",
  UPDATE_APP_TO_LOGIN: "updateApp",
  PHONE_PASSWORD_FLOOD: "passwordFlood",
  PAYMENT_REQUIRED: "payment",
  CONFIG: "config",
  TIMEOUT: "timeout",
  SESSION_LOST: "sessionLost",
  TELEGRAM_MISMATCH: "telegramMismatch",
  NO_TELEGRAM: "noTelegram",
  FIRST_NAME_REQUIRED: "firstNameRequired",
  EMAIL_INVALID: "emailInvalid",
  FLOOD_WAIT: "flood",
};

export function errorText(locale: Locale, code?: string, message?: string) {
  if (code?.startsWith("FLOOD_WAIT")) return t(locale, "flood");
  if (code && errorMap[code]) return t(locale, errorMap[code]);
  if (
    message &&
    message.length < 180 &&
    !/session|password|token|hash/i.test(message)
  ) {
    return message;
  }
  return t(locale, "generic");
}

export function clock(totalSeconds: number) {
  const safe = Math.max(0, totalSeconds);
  return {
    m: Math.floor(safe / 60),
    s: String(safe % 60).padStart(2, "0"),
  };
}
