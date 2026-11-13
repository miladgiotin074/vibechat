/** Arabic ي/ك → Persian ی/ک, zero-width cleanup, trimmed. Applied to every user-written field. */
export function normalizeText(input: string): string {
  return input
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[​‍﻿]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function compile(words: string[]): RegExp | null {
  const clean = words.map((w) => normalizeText(w).toLowerCase()).filter(Boolean);
  if (!clean.length) return null;
  const escaped = clean.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(escaped.join('|'), 'giu');
}

let cache: { words: string[]; re: RegExp | null } = { words: [], re: null };

function regexFor(words: string[]): RegExp | null {
  if (cache.words !== words) cache = { words, re: compile(words) };
  return cache.re;
}

export function containsBannedWord(text: string, words: string[]): boolean {
  const re = regexFor(words);
  if (!re) return false;
  re.lastIndex = 0;
  return re.test(text.toLowerCase());
}

export function maskBannedWords(text: string, words: string[]): string {
  const re = regexFor(words);
  if (!re) return text;
  return text.replace(re, (m) => '*'.repeat([...m].length));
}

/** Short preview for chat lists and notifications. */
export function preview(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return [...flat].length > max ? [...flat].slice(0, max).join('') + '…' : flat;
}

export function ageFrom(birthdate: string | Date | null): number | null {
  if (!birthdate) return null;
  const d = typeof birthdate === 'string' ? new Date(birthdate + 'T00:00:00Z') : birthdate;
  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return age;
}

/** Birthdate (YYYY-MM-DD) of someone who turns `age` today. */
export function birthdateForAge(age: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear() - age, now.getUTCMonth(), now.getUTCDate()));
  return d.toISOString().slice(0, 10);
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

/**
 * Phone numbers, @usernames and links in public text (Wall requests). People are meant to reach
 * each other inside the app, where blocking and reporting work; this also keeps out ads.
 */
export function containsContactInfo(text: string): boolean {
  const t = text.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0)).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660));
  if (/(?:\+?98|0)?9\d{2}[\s.-]?\d{3}[\s.-]?\d{4}/.test(t)) return true; // Iranian mobile numbers
  if (/\d[\d\s.-]{8,}\d/.test(t)) return true; // any long run of digits
  if (/@[a-z0-9_]{4,}/i.test(t)) return true; // @username
  if (/(?:https?:\/\/|www\.|t\.me\/|telegram\.me|instagram\.com|wa\.me)/i.test(t)) return true;
  if (/\b[a-z0-9-]+\.(?:com|ir|net|org|me|io|app)\b/i.test(t)) return true;
  return false;
}
