import { badRequest } from './errors.js';

/**
 * The little Markdown an admin writes in the panel, turned into the HTML Telegram understands.
 *
 * Telegram's own MarkdownV2 is unforgiving — one stray «.» or «!» breaks the whole message and
 * Telegram refuses it — so the text is escaped first and only this subset is turned into tags:
 *
 *   *bold*  **bold**     _italic_     __underline__
 *   ~strike~  ~~strike~~ ||spoiler||  `code`   ```pre```
 *   [the words](https://example.com)
 *
 * A marker glued to a letter or a digit is left as it is, so «سلام_دوست_من» stays what it says.
 */
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

/**
 * A marker that only counts between words: *bold* works, a*b*c stays a*b*c.
 * In Unicode mode only syntax characters may carry a backslash, so « _ » is written as it is.
 */
function loose(marker: string, tag: string): [RegExp, string] {
  const m = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const inClass = marker.replace(/[\]\\^-]/g, '\\$&');
  return [
    new RegExp(`(?<![\\p{L}\\p{N}${inClass}])${m}([^${inClass}\\n]+)${m}(?![\\p{L}\\p{N}${inClass}])`, 'gu'),
    `<${tag}>$1</${tag}>`,
  ];
}

const RULES: [RegExp, string][] = [
  [/\*\*([^*\n]+)\*\*/g, '<b>$1</b>'],
  [/__([^_\n]+)__/g, '<u>$1</u>'],
  [/~~([^~\n]+)~~/g, '<s>$1</s>'],
  [/\|\|([^|\n]+)\|\|/g, '<tg-spoiler>$1</tg-spoiler>'],
  loose('*', 'b'),
  loose('_', 'i'),
  loose('~', 's'),
];

const LINK = /\[([^\]\n]+)]\(([^)\s]+)\)/g;

/** Turns the admin's Markdown into Telegram HTML. Throws on a link Telegram would refuse. */
export function telegramHtml(input: string): string {
  // code is kept out of the way: nothing inside it is formatting
  const code: string[] = [];
  const park = (html: string) => `\u0000${code.push(html) - 1}\u0000`;
  let text = input
    .replace(/```([\s\S]*?)```/g, (_m, c: string) => park(`<pre>${esc(c.replace(/^\n/, '').replace(/\n$/, ''))}</pre>`))
    .replace(/`([^`\n]+)`/g, (_m, c: string) => park(`<code>${esc(c)}</code>`));

  text = esc(text).replace(LINK, (whole, label: string, href: string) => {
    // «&» became «&amp;» with the rest of the text, which is what an href wants anyway
    const url = href.replace(/&amp;/g, '&');
    if (!/^(https?|tg):\/\/\S+$/i.test(url)) throw badRequest(`لینک «${url.slice(0, 60)}» معتبر نیست؛ باید با https:// یا tg:// شروع شود`);
    // a quote in the link would end the attribute and start something else
    return `<a href="${href.replace(/"/g, '%22')}">${label}</a>`;
  });
  for (const [re, to] of RULES) text = text.replace(re, to);
  return text.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => code[Number(i)]!);
}

/** Plain text, escaped, for an admin who turned Markdown off. */
export const plainHtml = (input: string) => esc(input);
