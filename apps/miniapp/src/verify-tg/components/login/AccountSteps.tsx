import { useEffect, useRef, useState } from "react";
import type { PublicUser } from "@/verify-tg/lib/types";
import { t, type Locale } from "@/verify-tg/lib/i18n";
import { formatStoredPhone } from "@/verify-tg/lib/phone";
import { CameraBadge, LockIcon, MailIcon } from "./icons";
import { PhoneKeyboard } from "./PhoneKeyboard";
import { CodeCells, Fab, Outline, RichText } from "./ui";

export function PasswordStep({
  locale,
  hint,
  errorToken,
  errorText,
  loading,
  onSubmit,
  onForgot,
}: {
  locale: Locale;
  hint?: string;
  errorToken: number;
  errorText?: string;
  loading: boolean;
  onSubmit: (password: string) => void;
  onForgot: () => void;
}) {
  const [password, setPassword] = useState("");
  const [bad, setBad] = useState(false);
  const [focused, setFocused] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!errorToken) return;
    setBad(true);
    const timer = window.setTimeout(() => setBad(false), 450);
    return () => window.clearTimeout(timer);
  }, [errorToken]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <>
      <div className="flex flex-1 flex-col px-[18px] pt-[30px]">
        <LockIcon />
        <h1 className="mt-4 px-8 text-center text-[18px] font-bold" style={{ lineHeight: "calc(1em + 2px)" }}>{t(locale, "passwordTitle")}</h1>
        <p className="mt-2 px-3 text-center text-[14px] text-[var(--tg-gray)]" style={{ lineHeight: "calc(1em + 2px)" }}>{t(locale, "passwordText")}</p>
        <div className={`mx-4 mt-8 ${bad ? "login-shake" : ""}`}>
          <Outline label={t(locale, "enterPassword")} active={focused} floated={Boolean(hint) || password.length > 0 || focused} error={bad}>
            <input
              ref={inputRef}
              type="password"
              value={password}
              placeholder={hint || ""}
              autoComplete="current-password"
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && password) onSubmit(password);
              }}
              className="w-full bg-transparent px-4 py-4 text-start text-[18px] outline-none placeholder:text-[var(--tg-hint)]"
            />
          </Outline>
        </div>
        {errorText ? <p className="mt-3 text-center text-[14px] text-[var(--tg-danger)]">{errorText}</p> : null}
        <div className="flex-1" />
        <button type="button" onClick={onForgot} className="mb-8 flex h-14 w-full items-center px-4 text-start text-[15px] text-[var(--tg-link)]" style={{ lineHeight: "calc(1em + 2px)" }}>
          {t(locale, "forgotPassword")}
        </button>
      </div>
      <Fab loading={loading} onClick={() => { if (password) onSubmit(password); }} />
    </>
  );
}

export function RegisterStep({
  locale,
  loading,
  onSubmit,
}: {
  locale: Locale;
  loading: boolean;
  onSubmit: (firstName: string, lastName: string) => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [focus, setFocus] = useState<"first" | "last" | null>("first");
  const [photo, setPhoto] = useState<string | null>(null);
  const lastRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <div className="flex flex-1 flex-col items-center px-[18px] pt-[30px]">
        <button type="button" onClick={() => fileRef.current?.click()} aria-label={t(locale, "profileInfo")} className="relative h-[78px] w-[78px] rounded-full bg-[#65a9e0]">
          <span className="absolute inset-0 overflow-hidden rounded-full">
            {photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : <Person />}
          </span>
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-white">
            <CameraBadge />
          </span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            const url = URL.createObjectURL(file);
            setPhoto((current) => {
              if (current) URL.revokeObjectURL(current);
              return url;
            });
          }}
        />
        <h1 className="mt-3 px-2 text-[18px] font-bold" style={{ lineHeight: "calc(1em + 2px)" }}>{t(locale, "profileInfo")}</h1>
        <p className="mt-1.5 px-2 text-center text-[14px] text-[var(--tg-gray)]" style={{ lineHeight: "calc(1em + 2px)" }}>{t(locale, "registerText")}</p>
        <div className="mt-[21px] w-full space-y-6 px-4">
          <Outline label={t(locale, "firstName")} active={focus === "first"} floated={focus === "first" || firstName.length > 0}>
            <input
              value={firstName}
              autoFocus
              autoCapitalize="words"
              aria-label={t(locale, "firstName")}
              onFocus={() => setFocus("first")}
              onBlur={() => setFocus(null)}
              onChange={(event) => setFirstName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") lastRef.current?.focus();
              }}
              className="w-full bg-transparent px-4 py-4 text-start text-[17px] leading-5 outline-none"
            />
          </Outline>
          <Outline label={t(locale, "lastName")} active={focus === "last"} floated={focus === "last" || lastName.length > 0}>
            <input
              ref={lastRef}
              value={lastName}
              autoCapitalize="words"
              aria-label={t(locale, "lastName")}
              onFocus={() => setFocus("last")}
              onBlur={() => setFocus(null)}
              onChange={(event) => setLastName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && firstName.trim()) onSubmit(firstName.trim(), lastName.trim());
              }}
              className="w-full bg-transparent px-4 py-4 text-start text-[17px] leading-5 outline-none"
            />
          </Outline>
        </div>
        <div className="flex-1" />
        <p className="mb-8 flex h-14 items-center self-start whitespace-pre-line ps-[14px] pe-[70px] text-[14px] text-[var(--tg-gray)]" style={{ lineHeight: "calc(1em + 2px)" }}>
          {t(locale, "termsLogin").split("*").map((part, index) =>
            index % 2 === 1 ? (
              <span key={index} className="text-[var(--tg-value)]">{part}</span>
            ) : (
              <span key={index}>{part}</span>
            ),
          )}
        </p>
      </div>
      <Fab loading={loading} onClick={() => { if (firstName.trim()) onSubmit(firstName.trim(), lastName.trim()); }} />
    </>
  );
}

export function EmailStep({
  locale,
  loading,
  onSubmit,
}: {
  locale: Locale;
  loading: boolean;
  onSubmit: (email: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [focus, setFocus] = useState(true);
  return (
    <>
      <div className="flex flex-1 flex-col items-center px-[18px] pt-[30px]">
        <MailIcon />
        <h1 className="mt-4 px-8 text-center text-[18px] font-bold" style={{ lineHeight: "calc(1em + 2px)" }}>{t(locale, "addEmail")}</h1>
        <p className="mt-2 px-8 text-center text-[14px] text-[var(--tg-gray)]" style={{ lineHeight: "calc(1em + 2px)" }}>{t(locale, "addEmailText")}</p>
        <div className="mt-6 w-full px-4">
          <Outline label={t(locale, "yourEmail")} active={focus} floated={focus || email.length > 0} height={58}>
            <input
              type="email"
              autoFocus
              value={email}
              autoComplete="email"
              onFocus={() => setFocus(true)}
              onBlur={() => setFocus(false)}
              onChange={(event) => setEmail(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && email.includes("@")) onSubmit(email.trim());
              }}
              className="h-full w-full bg-transparent px-4 text-start text-[17px] leading-5 outline-none"
            />
          </Outline>
        </div>
      </div>
      <Fab loading={loading} onClick={() => { if (email.includes("@")) onSubmit(email.trim()); }} />
    </>
  );
}

export function EmailCodeStep({
  locale,
  emailPattern,
  length,
  errorToken,
  loading,
  onSubmit,
}: {
  locale: Locale;
  emailPattern?: string;
  length: number;
  errorToken: number;
  loading: boolean;
  onSubmit: (code: string) => void;
}) {
  const [code, setCode] = useState("");
  const [bad, setBad] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const sent = useRef("");

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!errorToken) return;
    setBad(true);
    setCode("");
    sent.current = "";
    const timer = window.setTimeout(() => {
      setBad(false);
      inputRef.current?.focus();
    }, 450);
    return () => window.clearTimeout(timer);
  }, [errorToken]);

  function updateCode(value: string) {
    if (loading || bad) return;
    const next = value.replace(/\D/g, "").slice(0, length);
    setCode(next);
    if (next.length === length && sent.current !== next) {
      sent.current = next;
      onSubmit(next);
    }
  }

  return (
    <>
      <div className="flex flex-1 flex-col items-center px-[18px] pt-[30px]">
        <MailIcon inbox />
        <h1 className="mt-4 px-8 text-center text-[18px] font-bold" style={{ lineHeight: "calc(1em + 2px)" }}>{t(locale, "checkEmail")}</h1>
        <p className="mt-2 px-6 text-center text-[14px] text-[var(--tg-gray)]" style={{ lineHeight: "calc(1em + 2px)" }}>
          <RichText text={t(locale, "checkEmailText", { email: emailPattern || "" })} />
        </p>
        <div className="mt-8">
          <CodeCells value={code} length={length} bad={bad} label={t(locale, "checkEmail")} inputRef={inputRef} onChange={updateCode} />
        </div>
      </div>
      <PhoneKeyboard />
    </>
  );
}

export function CaptchaStep({
  locale,
  siteKey,
  onToken,
}: {
  locale: Locale;
  siteKey: string;
  onToken: (token: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    let cancelled = false;
    const render = () => {
      const grecaptcha = (window as unknown as { grecaptcha?: { render: (el: HTMLElement, options: object) => void; ready: (cb: () => void) => void } }).grecaptcha;
      if (!grecaptcha || !ref.current || cancelled) return;
      grecaptcha.ready(() => {
        if (!ref.current || cancelled) return;
        ref.current.replaceChildren();
        grecaptcha.render(ref.current, { sitekey: siteKey, callback: (token: string) => onTokenRef.current(token) });
      });
    };
    const existing = document.querySelector<HTMLScriptElement>("script[data-recaptcha='1']");
    if (existing) render();
    else {
      const script = document.createElement("script");
      script.src = "https://www.google.com/recaptcha/api.js?render=explicit";
      script.async = true;
      script.dataset.recaptcha = "1";
      script.onload = render;
      document.body.appendChild(script);
    }
    return () => {
      cancelled = true;
    };
  }, [siteKey]);

  return (
    <div className="flex flex-1 flex-col items-center px-6 pt-20">
      <h1 className="text-[18px] font-bold">{t(locale, "captchaTitle")}</h1>
      <p className="mt-2 text-center text-[14px] text-[var(--tg-gray)]">{t(locale, "captchaText")}</p>
      <div ref={ref} className="mt-8" />
    </div>
  );
}

export function DoneStep({
  locale,
  user,
  onLogout,
}: {
  locale: Locale;
  user: PublicUser;
  onLogout: () => void;
}) {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
  const phone = user.phone ? formatStoredPhone(user.phone) : "";
  const color = avatarColor(user.id || name);
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 pb-16">
      <div className="flex h-[86px] w-[86px] items-center justify-center rounded-full text-[34px] font-medium text-white" style={{ background: color }}>
        {(user.firstName || "?").slice(0, 1).toUpperCase()}
      </div>
      <h1 className="mt-4 text-[20px] font-bold">{name || t(locale, "doneTitle")}</h1>
      {phone ? <p dir="ltr" className="mt-1 text-[15px] text-[var(--tg-gray)]">{phone}</p> : null}
      {user.username ? <p dir="ltr" className="text-[15px] text-[var(--tg-link)]">@{user.username}</p> : null}
      <p className="mt-3 text-center text-[15px] text-[var(--tg-gray)]">{t(locale, "doneTitle")}</p>
      <button type="button" onClick={onLogout} className="mt-8 text-[16px] text-[var(--tg-link)]">
        {t(locale, "logOut")}
      </button>
    </div>
  );
}

function Person() {
  return (
    <svg viewBox="0 0 78 78" className="h-full w-full" aria-hidden="true">
      <circle cx="39" cy="30" r="12" fill="#ffffff" opacity="0.95" />
      <path d="M18 66c3-12 12-18 21-18s18 6 21 18" fill="#ffffff" opacity="0.95" />
    </svg>
  );
}

function avatarColor(id: string) {
  const colors = ["#e17076", "#faa774", "#a695e7", "#7bc862", "#6ec9cb", "#65aadd", "#ee7aae"];
  let hash = 0;
  for (const char of id) hash = (hash + char.charCodeAt(0)) % colors.length;
  return colors[hash] ?? colors[0];
}
