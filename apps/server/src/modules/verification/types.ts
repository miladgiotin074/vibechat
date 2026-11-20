export type CodeDeliveryType =
  | 'app'
  | 'sms'
  | 'call'
  | 'flashCall'
  | 'missedCall'
  | 'fragment'
  | 'smsWord'
  | 'smsPhrase';

export type NextCodeType = 'sms' | 'call' | 'flashCall' | 'missedCall' | 'fragment';

export type CodeDelivery = {
  type: CodeDeliveryType;
  length?: number;
  pattern?: string;
  prefix?: string;
  url?: string;
  beginning?: string;
  nextType?: NextCodeType;
  timeout?: number;
};

export type PublicUser = {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  phone: string;
};

export type AuthResponse =
  | { step: 'code'; loginId: string; delivery: CodeDelivery; errorCode?: string }
  | { step: 'password'; loginId: string; hint?: string; errorCode?: string }
  | { step: 'signup'; loginId: string }
  | { step: 'terms'; loginId: string; terms: string }
  | { step: 'email'; loginId: string; errorCode?: string }
  | {
      step: 'email_code';
      loginId: string;
      emailPattern?: string;
      length?: number;
      errorCode?: string;
    }
  | { step: 'captcha'; loginId: string; siteKey: string }
  | { step: 'done'; verified: true; user: PublicUser }
  | { step: 'error'; code?: string; message?: string }
  | { step: 'phone' }
  | { step: 'recovery_sent'; emailPattern: string };