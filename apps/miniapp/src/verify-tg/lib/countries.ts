import { COUNTRY_ROWS, type CountryRow } from "./countries-data";

export type { CountryRow };

const displayNames = new Map<string, Intl.DisplayNames>();

export function flagEmoji(iso: string) {
  if (!/^[A-Z]{2}$/.test(iso)) return "🌐";
  return String.fromCodePoint(
    ...[...iso].map((char) => 0x1f1e6 + char.charCodeAt(0) - 65),
  );
}

export function countryLabel(row: CountryRow, locale: string) {
  if (row.iso === "FT" || row.iso === "GO" || row.iso === "YL") return row.name;
  try {
    let names = displayNames.get(locale);
    if (!names) {
      names = new Intl.DisplayNames([locale], { type: "region" });
      displayNames.set(locale, names);
    }
    const localized = names.of(row.iso);
    if (localized && localized.toUpperCase() !== row.iso) return localized;
  } catch {
    return row.name;
  }
  return row.name;
}

export function countryByCode(code: string, preferIso?: string) {
  const matches = COUNTRY_ROWS.filter((row) => row.code === code);
  if (matches.length === 0) return undefined;
  if (preferIso) {
    const preferred = matches.find((row) => row.iso === preferIso);
    if (preferred) return preferred;
  }
  return matches[matches.length - 1];
}

export function countryByIso(iso: string) {
  return COUNTRY_ROWS.find((row) => row.iso === iso);
}

export function listCountries(locale: string) {
  return COUNTRY_ROWS.map((row) => ({
    ...row,
    pattern: row.pattern.trim(),
    label: countryLabel(row, locale),
  })).sort((a, b) => a.label.localeCompare(b.label, locale));
}

export function isPartialCode(digits: string) {
  return COUNTRY_ROWS.some((row) => row.code.startsWith(digits));
}
