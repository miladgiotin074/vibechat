import { useEffect, useMemo, useRef, useState } from "react";
import { countryByCode, countryByIso, countryLabel, flagEmoji, isPartialCode, listCountries, type CountryRow } from "@/verify-tg/lib/countries";
import { digitsOnly, formatByPattern, hintFromPattern, international, isTooShort } from "@/verify-tg/lib/phone";
import { t, type Locale } from "@/verify-tg/lib/i18n";
import { BackIcon, ChevronIcon, SearchIcon } from "./icons";
import { PhoneKeyboard } from "./PhoneKeyboard";
import { AlertDialog, Fab, Outline } from "./ui";

export function PhoneStep({
  locale,
  loading,
  backRef,
  onNested,
  onSubmit,
}: {
  locale: Locale;
  loading: boolean;
  backRef: { current: () => boolean };
  onNested: (open: boolean) => void;
  onSubmit: (phone: string, pretty: string) => void;
}) {
  const [country, setCountry] = useState<CountryRow | null>(null);
  const [code, setCode] = useState("");
  const [national, setNational] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [picker, setPicker] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [focused, setFocused] = useState<"code" | "phone" | null>("phone");
  const phoneRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const region = navigator.language.split("-")[1]?.toUpperCase() || (locale === "fa" ? "IR" : "US");
    const match = countryByIso(region) ?? countryByCode("1") ?? null;
    if (!match) return;
    setCountry(match);
    setCode(match.code);
    const timer = window.setTimeout(() => phoneRef.current?.focus(), 280);
    return () => window.clearTimeout(timer);
  }, [locale]);

  useEffect(() => {
    onNested(picker || confirm || Boolean(alert));
  }, [alert, confirm, onNested, picker]);

  useEffect(() => {
    backRef.current = () => {
      if (picker) {
        setPicker(false);
        return true;
      }
      if (confirm) {
        setConfirm(false);
        return true;
      }
      if (alert) {
        setAlert(null);
        return true;
      }
      return false;
    };
    return () => {
      backRef.current = () => false;
    };
  });

  const pattern = country?.pattern.trim() ?? "";
  const formatted = formatByPattern(national, pattern);
  const hint = hintFromPattern(pattern);
  const pretty = `+${code} ${formatted}`.trim();

  function applyCode(raw: string) {
    const digits = digitsOnly(raw).slice(0, 15);
    for (let size = Math.min(4, digits.length); size >= 1; size -= 1) {
      const prefix = digits.slice(0, size);
      const matched = countryByCode(prefix);
      if (matched && matched.code === prefix) {
        const overflow = digits.slice(prefix.length);
        setCountry(country?.code === prefix ? country : matched);
        setCode(prefix);
        setInvalid(false);
        if (overflow) {
          setNational((current) => digitsOnly(current + overflow).slice(0, 15));
          phoneRef.current?.focus();
        }
        return;
      }
    }
    setCode(digits.slice(0, 4));
    if (!digits) {
      setCountry(null);
      setInvalid(false);
      return;
    }
    const partial = isPartialCode(digits);
    setInvalid(!partial);
    if (!partial) setCountry(null);
  }

  function tryContinue() {
    if (loading) return;
    if (!country || invalid || !code) {
      setInvalid(true);
      return;
    }
    if (isTooShort(national, pattern)) {
      setAlert(
        t(locale, "shortNumber", {
          country: countryLabel(country, locale),
          phone: pretty,
        }),
      );
      return;
    }
    setConfirm(true);
  }

  function send() {
    if (loading) return;
    setConfirm(false);
    onSubmit(international(code, national), pretty);
  }

  return (
    <>
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-x-[18px] top-[30px] -bottom-4 flex flex-col justify-center">
        <div className="flex w-full flex-col">
        <h1 className="px-8 text-center text-[18px] font-bold" style={{ lineHeight: "calc(1em + 2px)" }}>{t(locale, "yourNumber")}</h1>
        <p className="mt-2 px-8 text-center text-[14px] text-[var(--tg-gray)]" style={{ lineHeight: "calc(1em + 2px)" }}>{t(locale, "startText")}</p>

        <button type="button" onClick={() => setPicker(true)} className="mx-4 mt-6 mb-3.5 block w-auto text-start">
          <Outline label={t(locale, "country")} active={false} floated={Boolean(country) || (invalid && focused === "phone")} height={58}>
            <span className="flex h-full items-center pe-[14px] text-[16px]">
              {invalid && focused === "phone" ? (
                <span className="min-w-0 flex-1 truncate px-4">{t(locale, "wrongCountry")}</span>
              ) : country ? (
                <span className="flex min-w-0 flex-1 items-center gap-2 px-4">
                  <Flag iso={country.iso} />
                  <span className="truncate">{countryLabel(country, locale)}</span>
                </span>
              ) : (
                <span className="flex-1" />
              )}
              <ChevronIcon />
            </span>
          </Outline>
        </button>

        <div className="mx-4 mt-2 mb-2">
          <Outline label={t(locale, "phoneNumber")} active={focused !== null} floated={focused !== null || Boolean(country) || national.length > 0} height={58}>
            <div className="flex h-full items-center px-4">
              <span className="text-[16px]">+</span>
              <input
                ref={codeRef}
                value={code}
                inputMode="none"
                aria-label={t(locale, "country")}
                autoComplete="tel-country-code"
                onFocus={() => setFocused("code")}
                onBlur={() => setFocused((current) => (current === "code" ? null : current))}
                onChange={(event) => applyCode(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    phoneRef.current?.focus();
                    event.preventDefault();
                  }
                }}
                dir="ltr"
                className="-ms-[9px] h-9 w-[55px] bg-transparent ps-[10px] text-left text-[16px] outline-none"
              />
              <span className="ms-1 me-3 h-5 bg-[var(--tg-line)]" style={{ width: "max(0.5px, calc(2px / var(--dpr, 2)))" }} />
              <div dir="ltr" className="relative h-9 min-w-0 flex-1">
                <div dir="ltr" className="pointer-events-none absolute inset-0 flex items-center justify-start whitespace-pre text-[16px] tabular-nums">
                  <span className="text-transparent">{formatted}</span>
                  <span className="text-[var(--tg-hint)]">{hint.slice(formatted.length)}</span>
                </div>
                <input
                  ref={phoneRef}
                  value={formatted}
                  inputMode="none"
                  autoComplete="tel-national"
                  aria-label={t(locale, "phoneNumber")}
                  onFocus={() => {
                    setFocused("phone");
                    if (invalid) setInvalid(true);
                  }}
                  onBlur={() => setFocused((current) => (current === "phone" ? null : current))}
                  onChange={(event) => setNational(digitsOnly(event.target.value).slice(0, 15))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      tryContinue();
                      event.preventDefault();
                      return;
                    }
                    if (event.key === "Backspace" && !national) {
                      codeRef.current?.focus();
                      return;
                    }
                    if (event.key !== "Backspace") return;
                    const input = event.currentTarget;
                    const start = input.selectionStart ?? 0;
                    const end = input.selectionEnd ?? 0;
                    if (start !== end || start === 0 || formatted[start - 1] !== " ") return;
                    event.preventDefault();
                    const digitIndex = digitsOnly(formatted.slice(0, start)).length;
                    setNational(national.slice(0, digitIndex - 1) + national.slice(digitIndex));
                  }}
                  className="absolute inset-0 w-full bg-transparent text-[16px] tabular-nums outline-none"
                />
              </div>
            </div>
          </Outline>
        </div>

        </div>
        </div>
      </div>

      {confirm ? (
        <>
          <button type="button" className="absolute inset-0 z-20 bg-black/25" onClick={() => setConfirm(false)} aria-label={t(locale, "edit")} />
          <div className="absolute inset-x-6 z-20 h-[140px] rounded-[12px] bg-[var(--tg-dialog)]" style={{ bottom: "calc(328px + var(--safe-bottom))" }}>
            <p className="absolute inset-x-6 top-5 truncate text-[14px] text-[var(--tg-gray)]">{t(locale, "confirmNumber")}</p>
            <p className="absolute inset-x-6 top-12 truncate text-start text-[18px] font-bold">
              <span dir="ltr">{pretty}</span>
            </p>
            <div className="absolute inset-x-2 bottom-2 flex items-center justify-between">
              <button type="button" onClick={() => setConfirm(false)} className="px-4 py-2 text-[16px] font-bold text-[var(--tg-blue)]">
                {t(locale, "edit")}
              </button>
              <button type="button" onClick={send} className="px-4 py-2 text-[16px] font-bold text-[var(--tg-blue)]">
                {t(locale, "yes")}
              </button>
            </div>
          </div>
        </>
      ) : null}
      <Fab keyboard loading={loading} icon={confirm ? "check" : "arrow"} onClick={confirm ? send : tryContinue} />
      <PhoneKeyboard />
      {picker ? (
        <CountryPicker
          locale={locale}
          onClose={() => setPicker(false)}
          onSelect={(next) => {
            setCountry(next);
            setCode(next.code);
            setInvalid(false);
            setPicker(false);
            window.setTimeout(() => phoneRef.current?.focus(), 200);
          }}
        />
      ) : null}
      {alert ? (
        <AlertDialog title={t(locale, "wrongFormat")} message={alert} primary={t(locale, "ok")} onPrimary={() => setAlert(null)} />
      ) : null}
    </>
  );
}

function Flag({ iso }: { iso: string }) {
  const [fallback, setFallback] = useState(false);
  if (!/^[A-Z]{2}$/.test(iso) || fallback) {
    return <span className="inline-block w-6 text-center text-[20px] leading-none">{flagEmoji(iso)}</span>;
  }
  return (
    <img
      src={`https://flagcdn.com/24x18/${iso.toLowerCase()}.png`}
      alt=""
      width={24}
      height={18}
      className="h-[18px] w-6 rounded-[2px] object-cover"
      onError={() => setFallback(true)}
    />
  );
}

function CountryPicker({
  locale,
  onClose,
  onSelect,
}: {
  locale: Locale;
  onClose: () => void;
  onSelect: (country: CountryRow & { label: string }) => void;
}) {
  const [query, setQuery] = useState("");
  const countries = useMemo(() => listCountries(locale), [locale]);
  const filtered = countries.filter((country) => {
    const haystack = `${country.label} ${country.name} ${country.code}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });

  return (
    <div data-system-keyboard="" className="absolute inset-0 z-40 flex flex-col bg-[var(--tg-bg)]">
      <div className="flex h-14 items-center gap-1 pe-3" style={{ marginTop: "var(--safe-top)" }}>
        <button type="button" onClick={onClose} className="flex h-12 w-12 items-center justify-center" aria-label={t(locale, "edit")}>
          <BackIcon />
        </button>
        <h2 className="text-[18px] font-bold">{t(locale, "chooseCountry")}</h2>
      </div>
      <label className="flex items-center gap-3 border-b border-[var(--tg-line)] px-4 py-3 text-[var(--tg-hint)]">
        <SearchIcon />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t(locale, "search")}
          className="w-full bg-transparent text-[16px] text-[var(--tg-text)] outline-none placeholder:text-[var(--tg-hint)]"
        />
      </label>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.map((country) => (
          <button
            key={`${country.iso}-${country.code}`}
            type="button"
            onClick={() => onSelect(country)}
            className="flex h-12 w-full items-center gap-3 px-4 text-start active:bg-black/5"
          >
            <Flag iso={country.iso} />
            <span className="min-w-0 flex-1 truncate text-[16px]">{country.label}</span>
            <span dir="ltr" className="text-[15px] text-[var(--tg-gray)]">+{country.code}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
