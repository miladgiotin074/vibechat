import type { ReactNode } from "react";

export function RichText({ text, className = "", strongClassName = "font-semibold text-[var(--tg-text)]" }: { text: string; className?: string; strongClassName?: string }) {
  const lines = text.split("\n");
  return (
    <span className={className}>
      {lines.map((line, lineIndex) => {
        const open = line.indexOf("**");
        const close = line.lastIndexOf("**");
        const plain = open === -1 || close <= open;
        return (
          <span key={`${lineIndex}-${line}`}>
            {lineIndex > 0 ? <br /> : null}
            {plain ? (
              line
            ) : (
              <>
                {line.slice(0, open)}
                <strong className={strongClassName}>{line.slice(open + 2, close)}</strong>
                {line.slice(close + 2)}
              </>
            )}
          </span>
        );
      })}
    </span>
  );
}

export function Outline({
  label,
  active,
  floated,
  error = false,
  height,
  className = "",
  children,
}: {
  label: string;
  active: boolean;
  floated: boolean;
  error?: boolean;
  height?: number;
  className?: string;
  children: ReactNode;
}) {
  const border = error ? "var(--tg-danger)" : active ? "var(--tg-blue)" : "var(--tg-line)";
  const labelColor = error ? "text-[var(--tg-danger)]" : active ? "text-[var(--tg-value)]" : "text-[var(--tg-hint)]";
  // Stroke is centered on a rect inset by the full stroke width, under a 6px top padding. Radius is the path radius.
  const stroke = active || error ? "1.6667px" : "max(0.5px, calc(2px / var(--dpr, 2)))";
  const half = `calc((${stroke}) / 2)`;
  return (
    <div className={`relative ${className}`} style={height ? { height } : undefined}>
      <div
        className="pointer-events-none absolute"
        style={{
          top: `calc(6px + ${half})`,
          right: half,
          bottom: half,
          left: half,
          borderStyle: "solid",
          borderColor: border,
          borderWidth: stroke,
          borderRadius: `calc(8px + ${half})`,
        }}
      />
      <span
        className={`pointer-events-none absolute z-[1] whitespace-nowrap bg-[var(--tg-bg)] leading-none ${labelColor}`}
        style={
          floated
            ? { insetInlineStart: 11, top: 6.25, paddingInline: 4, fontSize: 12, transform: "translateY(-50%)" }
            : { insetInlineStart: 14, top: "50%", fontSize: 16, transform: "translateY(-50%)" }
        }
      >
        {label}
      </span>
      <div className={height ? "absolute inset-x-0 bottom-0" : "relative pt-1.5"} style={height ? { top: 6 } : undefined}>
        {children}
      </div>
    </div>
  );
}

export function Fab({
  loading,
  disabled,
  icon = "arrow",
  keyboard = false,
  onClick,
}: {
  loading?: boolean;
  disabled?: boolean;
  icon?: "arrow" | "check";
  keyboard?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label="Done"
      disabled={disabled || loading}
      onClick={onClick}
      className="absolute end-5 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--tg-fab)] text-white shadow-[0_0.5px_0_rgba(0,0,0,.2)] transition active:brightness-90 disabled:opacity-50"
      style={{ bottom: keyboard ? "calc(240px + var(--safe-bottom))" : "calc(14px + var(--safe-bottom))" }}
    >
      {loading ? (
        <span className="h-[22px] w-[22px] animate-spin rounded-full border-2 border-white/40 border-t-white" />
      ) : icon === "check" ? (
        <CheckMark />
      ) : (
        <Arrow />
      )}
    </button>
  );
}

export function CodeCells({
  value,
  length,
  bad,
  compact = false,
  label,
  inputRef,
  onChange,
}: {
  value: string;
  length: number;
  bad: boolean;
  compact?: boolean;
  label: string;
  inputRef: { current: HTMLInputElement | null };
  onChange: (value: string) => void;
}) {
  const focused = value.length >= length ? length - 1 : value.length;
  return (
    <div className={`relative ${bad ? "login-shake" : ""}`} onClick={() => inputRef.current?.focus()}>
      <div className={`flex items-center justify-center ${compact ? "gap-[5px]" : "gap-[7px]"}`}>
        {Array.from({ length }, (_, index) => {
          const border = bad ? "border-[var(--tg-danger)]" : index === focused ? "border-[var(--tg-blue)]" : "border-[var(--tg-line)]";
          const box = compact ? "h-[34px] w-[28px]" : "h-[42px] w-[34px]";
          return (
            <span key={index} className={`relative flex items-center justify-center text-[20px] font-bold ${box}`}>
              <span aria-hidden className={`pointer-events-none absolute border-[1.5px] border-solid ${border}`} style={{ inset: 0.75, borderRadius: 4.75 }} />
              {value[index] ?? ""}
            </span>
          );
        })}
      </div>
      <input
        ref={inputRef}
        value={value}
        inputMode="none"
        autoComplete="one-time-code"
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
        className="absolute inset-0 cursor-text opacity-0"
      />
    </div>
  );
}

function Arrow() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 flip-rtl" aria-hidden="true">
      <path
        d="M5 12h12M13 6l6 6-6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true">
      <path
        d="M5 12.5 10 17.5 19 7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AlertDialog({
  title,
  message,
  primary,
  secondary,
  onPrimary,
  onSecondary,
}: {
  title?: string;
  message: string;
  primary: string;
  secondary?: string;
  onPrimary: () => void;
  onSecondary?: () => void;
}) {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 px-6">
      <div className="w-full max-w-[340px] rounded-[10px] bg-[var(--tg-dialog)] px-6 pt-5 pb-2 shadow-[0_12px_40px_rgba(0,0,0,.28)]">
        {title ? <h2 className="text-[19px] font-bold leading-6">{title}</h2> : null}
        <div className={`text-[16px] leading-6 ${title ? "mt-3" : ""}`}>
          <RichText text={message} />
        </div>
        <div className="mt-3 flex items-center justify-end">
          {secondary ? (
            <button type="button" onClick={onSecondary} className="px-3 py-2 text-[15px] font-medium text-[var(--tg-link)]">
              {secondary}
            </button>
          ) : null}
          <button type="button" onClick={onPrimary} className="px-3 py-2 text-[15px] font-medium text-[var(--tg-link)]">
            {primary}
          </button>
        </div>
      </div>
    </div>
  );
}
