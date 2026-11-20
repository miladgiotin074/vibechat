import { COUNTRY_ROWS } from "./countries-data";

export function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

export function formatByPattern(digits: string, pattern: string) {
  const clean = digitsOnly(digits);
  if (!pattern) return clean;
  let index = 0;
  let formatted = "";
  for (const char of pattern) {
    if (index >= clean.length) break;
    if (char === " ") formatted += " ";
    else {
      formatted += clean[index];
      index += 1;
    }
  }
  if (index < clean.length) formatted += clean.slice(index);
  return formatted;
}

export function hintFromPattern(pattern: string) {
  return pattern.replace(/X/g, "0");
}

export function isTooShort(digits: string, pattern: string) {
  const expected = (pattern.match(/X/g) ?? []).length;
  if (!expected) return digitsOnly(digits).length < 4;
  return digitsOnly(digits).length < expected;
}

export function international(code: string, national: string) {
  return `+${digitsOnly(code)}${digitsOnly(national)}`;
}

export function formatStoredPhone(phone: string) {
  const digits = digitsOnly(phone);
  if (!digits) return phone;
  const codes = [...new Set(COUNTRY_ROWS.map((row) => row.code))].sort((a, b) => b.length - a.length);
  const code = codes.find((item) => digits.startsWith(item));
  if (!code) return `+${digits}`;
  const matches = COUNTRY_ROWS.filter((row) => row.code === code);
  const pattern = matches[matches.length - 1]?.pattern.trim() ?? "";
  return `+${code} ${formatByPattern(digits.slice(code.length), pattern)}`.trim();
}
