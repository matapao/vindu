// Amounts worth comparing between what the model typed (or a page shows) and what the process got.
// Ids, dates, times and versions are not amounts; years and numbers under 100 are left out.
// A number grouped with commas, or with the no-break spaces locales write (as Intl does), is one number. One grouped with
// plain spaces may be one (454 750, as Norwegian writes it) or several (axis labels: 100 200 300): it is read as
// several, and the whole run counts as known when it is known as one number.
import { asText } from './format.js';
const STRICT = /-?\d{1,3}(?:[,   ]\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?/g;
const SPACED = /(?<![\d.,])-?\d{1,3}(?: \d{3})+(?:\.\d+)?(?![\d,])/g;
const NOT_AMOUNTS = /\b[A-Z]{1,6}-[A-Z]?\d[\w-]*\b|\b\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+Z?)?\b|\b\d{1,2}:\d{2}(?::\d{2})?\b|\bv?\d+\.\d+\.\d+\b/g;
const amount = (x: string) => Math.round(Number(x.replace(/[,\s   ]/g, '')) * 100) / 100;
const worth = (x: string, n: number) => !/^(199\d|20\d\d)$/.test(x) && Number.isFinite(n) && Math.abs(n) >= 100;
const clean = (text: unknown) => asText(text ?? '').replace(NOT_AMOUNTS, ' ');
const read = (t: string, re: RegExp) => [...t.matchAll(re)].map(m => [m[0], amount(m[0])] as const).filter(([x, n]) => worth(x, n)).map(([, n]) => n);

/** Every amount in a text, in each reading: for an index of what is known. */
export function amountsIn(text: unknown): number[] {
  const t = clean(text);
  return [...read(t, STRICT), ...read(t, SPACED)];
}

/** The amounts in a text that are not known: each number on its own, except a run with plain spaces that is known as one. */
export function unknownAmounts(text: unknown, known: (n: number) => boolean): number[] {
  const t = clean(text), excused = new Set<number>();
  for (const m of t.matchAll(SPACED)) if (known(amount(m[0]))) for (const x of read(m[0], STRICT)) excused.add(x);
  return read(t, STRICT).filter(n => !known(n) && !excused.has(n));
}
