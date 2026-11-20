import { useEffect, useRef } from "react";

const KEYS: { label: string; symbols: string }[] = [
  { label: "1", symbols: "" },
  { label: "2", symbols: "ABC" },
  { label: "3", symbols: "DEF" },
  { label: "4", symbols: "GHI" },
  { label: "5", symbols: "JKL" },
  { label: "6", symbols: "MNO" },
  { label: "7", symbols: "PQRS" },
  { label: "8", symbols: "TUV" },
  { label: "9", symbols: "WXYZ" },
];

let lastInput: HTMLInputElement | null = null;

function rememberInput(event: { target: EventTarget | null }) {
  const target = event.target;
  if (target instanceof HTMLInputElement && !target.disabled && !target.closest("[data-system-keyboard]")) {
    lastInput = target;
  }
}

function targetInput() {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement && !active.disabled && !active.closest("[data-system-keyboard]")) return active;
  return lastInput && document.contains(lastInput) ? lastInput : null;
}

/** Inserts into the focused field the same way CustomPhoneKeyboardView writes into the focused EditText. */
export function typeIntoFocused(symbol: string) {
  const el = targetInput();
  if (!el) return;
  if (document.activeElement !== el) {
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }
  if (symbol === "backspace") {
    const event = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true });
    el.dispatchEvent(event);
    if (event.defaultPrevented) return;
  }
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? start;
  let next: string;
  let caret: number;
  if (symbol === "backspace") {
    if (start !== end) {
      next = el.value.slice(0, start) + el.value.slice(end);
      caret = start;
    } else if (start <= 0) {
      return;
    } else {
      next = el.value.slice(0, start - 1) + el.value.slice(end);
      caret = start - 1;
    }
  } else {
    next = el.value.slice(0, start) + symbol + el.value.slice(end);
    caret = start + symbol.length;
  }
  const atEnd = start === el.value.length && end === el.value.length;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(el, next);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  const pos = atEnd ? el.value.length : Math.min(caret, el.value.length);
  el.setSelectionRange(pos, pos);
}

function corner(index: number) {
  const topLeft = index === 0 ? 24 : 12;
  const topRight = index === 2 ? 24 : 12;
  const bottomRight = index === 11 ? 24 : 12;
  const bottomLeft = 12;
  return `${topLeft}px ${topRight}px ${bottomRight}px ${bottomLeft}px`;
}

const keyClass =
  "relative flex items-center justify-center bg-[rgba(0,0,0,0.059)] text-[var(--tg-text)] active:scale-[0.98] active:bg-[rgba(0,0,0,0.118)]";

let pointerAt = 0;

function pressKey(symbol: string, fromPointer: boolean) {
  if (fromPointer) pointerAt = Date.now();
  else if (Date.now() - pointerAt < 500) return;
  typeIntoFocused(symbol);
}

export function PhoneKeyboard() {
  useEffect(() => {
    document.addEventListener("focusin", rememberInput);
    if (document.activeElement instanceof HTMLInputElement) rememberInput({ target: document.activeElement });
    return () => document.removeEventListener("focusin", rememberInput);
  }, []);

  return (
    <div
      dir="ltr"
      className="grid shrink-0 grid-cols-3 gap-x-[6px] gap-y-[6px] px-[10px] pt-[10px]"
      style={{ height: "calc(230px + var(--safe-bottom))", paddingBottom: "calc(14px + var(--safe-bottom))", gridTemplateRows: "repeat(4, minmax(0, 1fr))" }}
    >
      {KEYS.map((key, index) => (
        <button
          key={key.label}
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onPointerDown={(event) => {
            event.preventDefault();
            pressKey(key.label, true);
          }}
          onClick={() => pressKey(key.label, false)}
          className={keyClass}
          style={{ borderRadius: corner(index) }}
        >
          <span className="absolute text-[24px] leading-none" style={{ left: "25%", top: "50%", transform: "translate(-50%, -50%)" }}>
            {key.label}
          </span>
          {key.symbols ? (
            <span className="absolute text-[14px] leading-none text-[var(--tg-hint)]" style={{ left: "70%", top: "50%", transform: "translate(-50%, -50%)" }}>
              {key.symbols}
            </span>
          ) : null}
        </button>
      ))}
      <span />
      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          event.preventDefault();
          pressKey("0", true);
        }}
        onClick={() => pressKey("0", false)}
        className={keyClass}
        style={{ borderRadius: corner(10) }}
      >
        <span className="absolute text-[24px] leading-none" style={{ left: "25%", top: "50%", transform: "translate(-50%, -50%)" }}>
          0
        </span>
        <span className="absolute text-[14px] leading-none text-[var(--tg-hint)]" style={{ left: "70%", top: "50%", transform: "translate(-50%, -50%)" }}>
          +
        </span>
      </button>
      <BackspaceKey />
    </div>
  );
}

function BackspaceKey() {
  const wait = useRef<number | null>(null);
  const repeat = useRef<number | null>(null);

  function stop() {
    if (wait.current !== null) window.clearTimeout(wait.current);
    if (repeat.current !== null) window.clearInterval(repeat.current);
    wait.current = null;
    repeat.current = null;
  }

  return (
    <button
      type="button"
      aria-label="Delete"
      onMouseDown={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        event.preventDefault();
        stop();
        typeIntoFocused("backspace");
        wait.current = window.setTimeout(() => {
          typeIntoFocused("backspace");
          repeat.current = window.setInterval(() => typeIntoFocused("backspace"), 50);
        }, 200);
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      className={keyClass}
      style={{ borderRadius: corner(11) }}
    >
      <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
        <path
          fill="currentColor"
          d="M22 3H7c-.69 0-1.23.35-1.59.88L0 12l5.41 8.11c.36.53.9.89 1.59.89h15c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-3 12.59L17.59 17 14 13.41 10.41 17 9 15.59 12.59 12 9 8.41 10.41 7 14 10.59 17.59 7 19 8.41 15.41 12 19 15.59z"
        />
      </svg>
    </button>
  );
}
