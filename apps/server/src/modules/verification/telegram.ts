import bigInt from 'big-integer';
import { Api, TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions';
import { env } from '../../config.js';
import { sql } from '../../lib/db.js';
import { AppError } from '../../lib/errors.js';
import { invalidateUser } from '../auth/guard.js';
import type { AuthResponse, CodeDelivery, CodeDeliveryType, NextCodeType, PublicUser } from './types.js';

const DELIVERIES = new Set<CodeDeliveryType>([
  "app",
  "sms",
  "call",
  "flashCall",
  "missedCall",
  "fragment",
  "smsWord",
  "smsPhrase",
]);

const NEXT_TYPES = new Set<NextCodeType>(["sms", "call", "flashCall", "missedCall", "fragment"]);

const RETRYABLE = new Set([
  "PHONE_CODE_INVALID",
  "PHONE_CODE_EMPTY",
  "PHONE_CODE_EXPIRED",
  "PASSWORD_HASH_INVALID",
  "EMAIL_CODE_INVALID",
  "EMAIL_HASH_EXPIRED",
  "CODE_INVALID",
  "FIRSTNAME_INVALID",
]);

const RECOVERED = "\u0000recovered";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

type Flow = {
  id: string;
  /** Vibe Chat user completing «تأیید حساب» — used to match MTProto `getMe` with `users.telegram_id`. */
  vibeUserId: string;
  client: TelegramClient;
  pending: Deferred<AuthResponse> | null;
  view: AuthResponse | null;
  codeWait: Deferred<string> | null;
  passwordWait: Deferred<string> | null;
  namesWait: Deferred<[string, string]> | null;
  emailWait: Deferred<string> | null;
  emailCodeWait: Deferred<string> | null;
  termsWait: Deferred<boolean> | null;
  captchaWait: Deferred<string> | null;
  resend: (() => Promise<CodeDelivery>) | null;
  lastError?: string;
  hint?: string;
  recovered?: PublicUser;
  cancelled: boolean;
  timer?: ReturnType<typeof setTimeout>;
};

type Store = {
  flows: Map<string, Flow>;
};

function store(): Store {
  const globalStore = globalThis as typeof globalThis & { __vibeTgVerify?: Store };
  if (!globalStore.__vibeTgVerify) {
    globalStore.__vibeTgVerify = { flows: new Map() };
  }
  return globalStore.__vibeTgVerify;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function rejectQuiet<T>(waiter: Deferred<T> | null, error: Error) {
  if (!waiter) return;
  waiter.promise.catch(() => undefined);
  waiter.reject(error);
}

export function rpcCode(error: unknown) {
  if (error && typeof error === "object" && "errorMessage" in error) {
    const message = (error as { errorMessage?: unknown }).errorMessage;
    if (typeof message === "string" && message) return message;
  }
  if (error instanceof Error && error.message && error.message !== "AUTH_USER_CANCEL") {
    if (/payment/i.test(error.message)) return "PAYMENT_REQUIRED";
    return error.message;
  }
  return undefined;
}

function isMutual(value: unknown) {
  if (value === true) return true;
  if (value && typeof value === 'object' && 'className' in value) {
    return String((value as { className: string }).className).toLowerCase() === 'booltrue';
  }
  return false;
}

export type ContactBook = { contacts: number; mutualUsers: Api.User[] };

export function mutualUsersFromContacts(result: Api.contacts.TypeContacts): ContactBook {
  if (!(result instanceof Api.contacts.Contacts)) return { contacts: 0, mutualUsers: [] };
  const list = result.contacts ?? [];
  const mutualIds = new Set(list.filter((c) => isMutual(c.mutual)).map((c) => c.userId.toString()));
  const mutualUsers = (result.users ?? []).filter(
    (u): u is Api.User => u instanceof Api.User && !u.bot && !u.deleted && mutualIds.has(u.id.toString()),
  );
  return { contacts: list.length, mutualUsers };
}

/** Contacts already loaded on an open client — avoids a second login. */
export async function loadMutualUsers(client: TelegramClient): Promise<ContactBook> {
  const result = await client.invoke(new Api.contacts.GetContacts({ hash: bigInt.zero }));
  return mutualUsersFromContacts(result);
}

export async function readContactBook(session: string): Promise<ContactBook> {
  const creds = telegramCredentials();
  if (!creds) throw new AppError(503, 'config', 'TELEGRAM_API_ID و TELEGRAM_API_HASH روی سرور تنظیم نشده');
  if (!session) throw new AppError(400, 'no_session', 'نشست تلگرام ذخیره نشده');
  const client = createClient(session, creds.apiId, creds.apiHash, 'fa');
  try {
    await client.connect();
    return await loadMutualUsers(client);
  } catch (error) {
    const code = rpcCode(error) ?? '';
    if (/AUTH_KEY|SESSION_REVOKED|SESSION_EXPIRED|USER_DEACTIVATED|AUTH_KEY_UNREGISTERED/i.test(code)) {
      throw new AppError(409, 'telegram_session', 'نشست تلگرام این کاربر دیگر معتبر نیست');
    }
    throw new AppError(502, 'telegram', 'خواندن مخاطبین از تلگرام انجام نشد');
  } finally {
    try {
      await client.disconnect();
    } catch {
      /* Dead socket. */
    }
  }
}

/** Address-book size of a stored MTProto session: everyone saved, and those who saved this account back. */
export async function countTelegramContacts(session: string): Promise<{ contacts: number; mutual: number }> {
  const book = await readContactBook(session);
  return { contacts: book.contacts, mutual: book.mutualUsers.length };
}

export function telegramCredentials() {
  const apiId = env.TELEGRAM_API_ID;
  const apiHash = env.TELEGRAM_API_HASH.trim();
  if (!Number.isInteger(apiId) || apiId <= 0 || !apiHash) return null;
  return { apiId, apiHash };
}

export function createClient(session: string, apiId: number, apiHash: string, locale: string) {
  return new TelegramClient(new StringSession(session), apiId, apiHash, {
    connectionRetries: 5,
    timeout: 25,
    deviceModel: "Telegram Mini App",
    systemVersion: "Android",
    appVersion: "1.0.0",
    langCode: locale === "fa" ? "fa" : "en",
    systemLangCode: locale === "fa" ? "fa" : "en",
  });
}

function readDelivery(info: unknown): CodeDelivery {
  const record = info && typeof info === "object" ? (info as Record<string, unknown>) : {};
  const type = typeof record.type === "string" && DELIVERIES.has(record.type as CodeDeliveryType)
    ? (record.type as CodeDeliveryType)
    : "sms";
  const nextType = typeof record.nextType === "string" && NEXT_TYPES.has(record.nextType as NextCodeType)
    ? (record.nextType as NextCodeType)
    : undefined;
  return {
    type,
    length: typeof record.length === "number" ? record.length : undefined,
    pattern: typeof record.pattern === "string" ? record.pattern : undefined,
    prefix: typeof record.prefix === "string" ? record.prefix : undefined,
    url: typeof record.url === "string" ? record.url : undefined,
    beginning: typeof record.beginning === "string" ? record.beginning : undefined,
    nextType,
    timeout: typeof record.timeout === "number" ? record.timeout : undefined,
  };
}

function toPublic(user: unknown): PublicUser {
  const record = user && typeof user === "object" ? (user as Record<string, unknown>) : {};
  const text = (camel: string, snake: string) => {
    const value = record[camel] ?? record[snake];
    return typeof value === "string" ? value : "";
  };
  return {
    id: record.id === undefined ? "" : String(record.id),
    firstName: text("firstName", "first_name"),
    lastName: text("lastName", "last_name"),
    username: text("username", "username"),
    phone: text("phone", "phone"),
  };
}

function notify(flow: Flow, response: AuthResponse) {
  if (flow.cancelled && response.step !== "phone") return;
  flow.view = response;
  const pending = flow.pending;
  flow.pending = null;
  pending?.resolve(response);
}

function takeError(flow: Flow) {
  const code = flow.lastError;
  flow.lastError = undefined;
  if (!code || code === "AUTH_USER_CANCEL") return undefined;
  return code;
}

function arm(flow: Flow) {
  const ticket = deferred<AuthResponse>();
  flow.pending = ticket;
  return ticket;
}

async function waitFor(flow: Flow, ticket: Deferred<AuthResponse>, ms = 55_000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<AuthResponse>((resolve) => {
    timer = setTimeout(() => {
      if (flow.pending === ticket) {
        void cancelLogin(flow.id, flow.vibeUserId);
        resolve({ step: "phone" });
      }
    }, ms);
  });
  try {
    return await Promise.race([ticket.promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function mustFlow(loginId: string, vibeUserId?: string): Flow | AuthResponse {
  const flow = store().flows.get(loginId);
  if (!flow || flow.cancelled) return { step: "error", code: "SESSION_LOST" };
  if (vibeUserId && flow.vibeUserId !== vibeUserId) return { step: "error", code: "SESSION_LOST" };
  return flow;
}

function isFlow(value: Flow | AuthResponse): value is Flow {
  return "client" in value;
}

/** Failed or mismatched logins — revoke on Telegram and close the socket. */
async function teardownClient(flow: Flow) {
  try {
    await flow.client.invoke(new Api.auth.LogOut());
  } catch {
    /* Not fully authed yet, or Telegram already closed the socket. */
  }
  try {
    await flow.client.disconnect();
  } catch {
    /* Dead socket. */
  }
}

/** Successful verify: keep the MTProto session valid — disconnect only, no LogOut. */
async function releaseClient(flow: Flow) {
  try {
    await flow.client.disconnect();
  } catch {
    /* Dead socket. */
  }
}

async function finish(flow: Flow) {
  let me: PublicUser;
  try {
    me = toPublic(await flow.client.getMe());
  } catch {
    notify(flow, { step: "error", code: "UNKNOWN" });
    store().flows.delete(flow.id);
    if (flow.timer) clearTimeout(flow.timer);
    await teardownClient(flow);
    return;
  }

  const [row] = await sql<{ telegram_id: string | null; verified: boolean; had_session: boolean }[]>`
    SELECT telegram_id::text AS telegram_id, verified,
           (telegram_mtproto_session IS NOT NULL AND length(trim(telegram_mtproto_session)) > 0) AS had_session
    FROM users WHERE id = ${flow.vibeUserId}`;
  if (!row?.telegram_id) {
    notify(flow, { step: "error", code: "NO_TELEGRAM" });
    store().flows.delete(flow.id);
    if (flow.timer) clearTimeout(flow.timer);
    await teardownClient(flow);
    return;
  }
  if (row.telegram_id !== me.id) {
    notify(flow, {
      step: "error",
      code: "TELEGRAM_MISMATCH",
      message: "این شماره به حساب تلگرامی که با آن وارد ویب‌چت شده‌ای وصل نیست.",
    });
    store().flows.delete(flow.id);
    if (flow.timer) clearTimeout(flow.timer);
    await teardownClient(flow);
    return;
  }

  const session = String(flow.client.session.save() ?? '');
  const phone = me.phone?.trim() || null;
  await sql`
    UPDATE users SET
      verified = true,
      verified_at = coalesce(verified_at, now()),
      verified_phone = ${phone},
      telegram_mtproto_session = ${session || null},
      verified_via_phone = true
    WHERE id = ${flow.vibeUserId}`;
  await invalidateUser(flow.vibeUserId);
  const { scheduleAutoInviteForUser, scheduleOrderRunsForUser } = await import('./groupInvite.js');
  scheduleOrderRunsForUser(flow.vibeUserId).catch(() => undefined);
  if (!row.had_session) scheduleAutoInviteForUser(flow.vibeUserId).catch(() => undefined);

  store().flows.delete(flow.id);
  if (flow.timer) clearTimeout(flow.timer);
  notify(flow, { step: "done", verified: true, user: me });
  await releaseClient(flow);
}

async function run(flow: Flow, phone: string, locale: string) {
  let phoneSends = 0;
  try {
    await flow.client.start({
      phoneNumber: async () => {
        phoneSends += 1;
        if (phoneSends > 4) throw new Error("AUTH_USER_CANCEL");
        return phone;
      },
      phoneCode: async (_viaApp, info) => {
        if (flow.cancelled) throw new Error("AUTH_USER_CANCEL");
        const delivery = readDelivery(info);
        const resend = info && typeof info === "object" && "resend" in info ? info.resend : undefined;
        flow.resend = typeof resend === "function"
          ? async () => {
              const next = await (resend as () => Promise<unknown>)();
              return readDelivery(next);
            }
          : null;
        const wait = deferred<string>();
        flow.codeWait = wait;
        notify(flow, {
          step: "code",
          loginId: flow.id,
          delivery,
          errorCode: takeError(flow),
        });
        return wait.promise;
      },
      password: async (hint) => {
        if (flow.cancelled) throw new Error("AUTH_USER_CANCEL");
        flow.hint = hint;
        const wait = deferred<string>();
        flow.passwordWait = wait;
        notify(flow, {
          step: "password",
          loginId: flow.id,
          hint,
          errorCode: takeError(flow),
        });
        const value = await wait.promise;
        if (value === RECOVERED) throw new Error("AUTH_USER_CANCEL");
        return value;
      },
      firstAndLastNames: async () => {
        if (flow.cancelled) throw new Error("AUTH_USER_CANCEL");
        const wait = deferred<[string, string]>();
        flow.namesWait = wait;
        notify(flow, { step: "signup", loginId: flow.id });
        return wait.promise;
      },
      acceptTermsOfService: async (terms) => {
        if (flow.cancelled) throw new Error("AUTH_USER_CANCEL");
        const text = typeof terms?.text === "string" ? terms.text : "";
        if (!text.trim()) return true;
        const wait = deferred<boolean>();
        flow.termsWait = wait;
        notify(flow, { step: "terms", loginId: flow.id, terms: text });
        return wait.promise;
      },
      emailAddress: async () => {
        if (flow.cancelled) throw new Error("AUTH_USER_CANCEL");
        const wait = deferred<string>();
        flow.emailWait = wait;
        notify(flow, { step: "email", loginId: flow.id, errorCode: takeError(flow) });
        return wait.promise;
      },
      emailVerification: async (options) => {
        if (flow.cancelled) throw new Error("AUTH_USER_CANCEL");
        const wait = deferred<string>();
        flow.emailCodeWait = wait;
        const emailPattern = typeof options?.emailPattern === "string" ? options.emailPattern : undefined;
        const length = typeof options?.codeLength === "number" ? options.codeLength : 6;
        notify(flow, {
          step: "email_code",
          loginId: flow.id,
          emailPattern,
          length,
          errorCode: takeError(flow),
        });
        return wait.promise;
      },
      reCaptchaCallback: async (siteKey: string) => {
        if (flow.cancelled) throw new Error("AUTH_USER_CANCEL");
        const wait = deferred<string>();
        flow.captchaWait = wait;
        notify(flow, { step: "captcha", loginId: flow.id, siteKey });
        return wait.promise;
      },
      onError: async (error: Error) => {
        const code = rpcCode(error) ?? "UNKNOWN";
        if (code === "AUTH_USER_CANCEL") return true;
        const retry = RETRYABLE.has(code) || code.startsWith("PHONE_CODE_");
        if (retry) {
          flow.lastError = code;
          return false;
        }
        notify(flow, { step: "error", code });
        return true;
      },
    });
    await finish(flow);
  } catch (error) {
    if (flow.recovered) {
      flow.recovered = undefined;
      await finish(flow);
      return;
    }
    const code = rpcCode(error);
    if (flow.pending) {
      if (flow.cancelled || code === "AUTH_USER_CANCEL") notify(flow, { step: "phone" });
      else notify(flow, { step: "error", code, message: error instanceof Error ? error.message : undefined });
    }
    store().flows.delete(flow.id);
    if (flow.timer) clearTimeout(flow.timer);
    try {
      await flow.client.disconnect();
    } catch {
      /* The socket may already be closed. */
    }
  }
}

export async function startPhone(phone: string, locale: string, vibeUserId: string): Promise<AuthResponse> {
  const creds = telegramCredentials();
  if (!creds) return { step: "error", code: "CONFIG" };
  const normalized = phone.replace(/[^\d+]/g, "");
  if (!/^\+\d{8,15}$/.test(normalized)) return { step: "error", code: "PHONE_NUMBER_INVALID" };

  const client = createClient("", creds.apiId, creds.apiHash, locale);
  const flow: Flow = {
    id: crypto.randomUUID(),
    vibeUserId,
    client,
    pending: null,
    view: null,
    codeWait: null,
    passwordWait: null,
    namesWait: null,
    emailWait: null,
    emailCodeWait: null,
    termsWait: null,
    captchaWait: null,
    resend: null,
    cancelled: false,
  };
  flow.timer = setTimeout(() => {
    void cancelLogin(flow.id, flow.vibeUserId);
  }, 15 * 60 * 1000);
  store().flows.set(flow.id, flow);
  const ticket = arm(flow);
  void run(flow, normalized, locale);
  return waitFor(flow, ticket);
}

async function submit(loginId: string, vibeUserId: string, resolveWaiter: (flow: Flow) => boolean): Promise<AuthResponse> {
  const flow = mustFlow(loginId, vibeUserId);
  if (!isFlow(flow)) return flow;
  if (!resolveWaiter(flow)) return { step: "error", code: "SESSION_LOST" };
  const ticket = arm(flow);
  return waitFor(flow, ticket);
}

export function submitCode(loginId: string, vibeUserId: string, code: string) {
  const clean = code.replace(/\s/g, "");
  return submit(loginId, vibeUserId, (flow) => {
    if (!flow.codeWait || !clean) return false;
    const waiter = flow.codeWait;
    flow.codeWait = null;
    waiter.resolve(clean);
    return true;
  });
}

export function submitPassword(loginId: string, vibeUserId: string, password: string) {
  return submit(loginId, vibeUserId, (flow) => {
    if (!flow.passwordWait || !password) return false;
    const waiter = flow.passwordWait;
    flow.passwordWait = null;
    waiter.resolve(password);
    return true;
  });
}

export function submitNames(loginId: string, vibeUserId: string, firstName: string, lastName: string) {
  return submit(loginId, vibeUserId, (flow) => {
    if (!flow.namesWait || !firstName.trim()) return false;
    const waiter = flow.namesWait;
    flow.namesWait = null;
    waiter.resolve([firstName.trim(), lastName.trim()]);
    return true;
  });
}

export function submitEmail(loginId: string, vibeUserId: string, email: string) {
  return submit(loginId, vibeUserId, (flow) => {
    if (!flow.emailWait || !email.trim()) return false;
    const waiter = flow.emailWait;
    flow.emailWait = null;
    waiter.resolve(email.trim());
    return true;
  });
}

export function submitEmailCode(loginId: string, vibeUserId: string, code: string) {
  return submit(loginId, vibeUserId, (flow) => {
    if (!flow.emailCodeWait || !code.trim()) return false;
    const waiter = flow.emailCodeWait;
    flow.emailCodeWait = null;
    waiter.resolve(code.trim());
    return true;
  });
}

export function submitTerms(loginId: string, vibeUserId: string, accept: boolean) {
  return submit(loginId, vibeUserId, (flow) => {
    if (!flow.termsWait) return false;
    const waiter = flow.termsWait;
    flow.termsWait = null;
    waiter.resolve(accept);
    return true;
  });
}

export function submitCaptcha(loginId: string, vibeUserId: string, token: string) {
  return submit(loginId, vibeUserId, (flow) => {
    if (!flow.captchaWait || !token) return false;
    const waiter = flow.captchaWait;
    flow.captchaWait = null;
    waiter.resolve(token);
    return true;
  });
}

export async function resendLoginCode(loginId: string, vibeUserId: string): Promise<AuthResponse> {
  const flow = mustFlow(loginId, vibeUserId);
  if (!isFlow(flow)) return flow;
  if (!flow.resend) return { step: "error", code: "RESEND_UNAVAILABLE" };
  try {
    const delivery = await flow.resend();
    const response: AuthResponse = { step: "code", loginId, delivery };
    flow.view = response;
    return response;
  } catch (error) {
    return { step: "error", code: rpcCode(error), message: error instanceof Error ? error.message : undefined };
  }
}

export function loginState(loginId: string, vibeUserId: string): AuthResponse {
  const flow = mustFlow(loginId, vibeUserId);
  if (!isFlow(flow)) return flow;
  return flow.view ?? { step: "phone" };
}

export async function forgotPassword(loginId: string, vibeUserId: string): Promise<AuthResponse> {
  const flow = mustFlow(loginId, vibeUserId);
  if (!isFlow(flow)) return flow;
  try {
    const result = await flow.client.invoke(new Api.auth.RequestPasswordRecovery());
    const emailPattern = "emailPattern" in result && typeof result.emailPattern === "string"
      ? result.emailPattern
      : "";
    return { step: "recovery_sent", emailPattern };
  } catch (error) {
    return { step: "error", code: rpcCode(error) ?? "PASSWORD_RECOVERY_NA" };
  }
}

export async function recoverWithCode(loginId: string, vibeUserId: string, code: string): Promise<AuthResponse> {
  const flow = mustFlow(loginId, vibeUserId);
  if (!isFlow(flow)) return flow;
  if (!flow.passwordWait) return { step: "error", code: "SESSION_LOST" };
  const ticket = arm(flow);
  try {
    const result = await flow.client.invoke(new Api.auth.RecoverPassword({ code: code.trim() }));
    const user = result && typeof result === "object" && "user" in result ? result.user : undefined;
    flow.recovered = toPublic(user);
    const waiter = flow.passwordWait;
    flow.passwordWait = null;
    waiter.resolve(RECOVERED);
  } catch (error) {
    if (flow.pending === ticket) flow.pending = null;
    return { step: "error", code: rpcCode(error) };
  }
  return waitFor(flow, ticket);
}

export async function cancelLogin(loginId: string, vibeUserId: string): Promise<AuthResponse> {
  const flow = store().flows.get(loginId);
  if (!flow || flow.vibeUserId !== vibeUserId) return { step: "phone" };
  flow.cancelled = true;
  if (flow.timer) clearTimeout(flow.timer);
  const error = new Error("AUTH_USER_CANCEL");
  rejectQuiet(flow.codeWait, error);
  rejectQuiet(flow.passwordWait, error);
  rejectQuiet(flow.namesWait, error);
  rejectQuiet(flow.emailWait, error);
  rejectQuiet(flow.emailCodeWait, error);
  rejectQuiet(flow.termsWait, error);
  rejectQuiet(flow.captchaWait, error);
  flow.codeWait = null;
  flow.passwordWait = null;
  flow.namesWait = null;
  flow.emailWait = null;
  flow.emailCodeWait = null;
  flow.termsWait = null;
  flow.captchaWait = null;
  if (flow.pending) {
    const pending = flow.pending;
    flow.pending = null;
    pending.resolve({ step: "phone" });
  }
  store().flows.delete(loginId);
  try {
    await flow.client.disconnect();
  } catch {
    /* Ignore a dead socket. */
  }
  return { step: "phone" };
}
