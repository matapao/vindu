// How a value is written for the person, the same in every card and block, in Node and in the window (no imports).
// fields whose whole numbers are names, not amounts: a year, an id, a code; written as they are, never grouped. An
// English name ends in one as a word of its own (invoice_no); a Norwegian one as the end of a compound too (byggeår,
// varenr), as Norwegian writes them
const AS_IS = /(^|_)(year|yr|id|no|nr|number|code|zip|postcode|phone|ext|version|port)$/i;
const AS_IS_NORWEGIAN = /(år|nr|nummer|kode|postnr|orgnr|kid|konto|telefon|versjon)$/i;
/** Whether a field's whole numbers are written as they are: a year, an id, a code, by its name. */
const asIs = (field: string) => { const name = field.normalize('NFC'); return AS_IS.test(name) || AS_IS_NORWEGIAN.test(name); };
/** A list of plain values: none of them an object or a list. */
export const plainList = (v: unknown): v is unknown[] => Array.isArray(v) && v.every(x => x === null || typeof x !== 'object');
/** A value as String writes it, but an object, or a list that holds one, as JSON: never "[object Object]". */
export const asText = (v: unknown): string => {
  if (typeof v !== 'object' || v === null) return String(v);
  return plainList(v) ? v.join(',') : JSON.stringify(v);
};
/** A cell as the person reads it: numbers grouped in the locale (not years, ids or codes), plain lists as words,
 *  nothing as raw JSON unless it is one. The rule the account states, so the model knows how each value went in. */
export const cellIn = (v: unknown, field?: string, locale = 'en-GB'): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return field && Number.isInteger(v) && asIs(field) ? String(v) : v.toLocaleString(locale, { maximumFractionDigits: 2 });
  return plainList(v) ? v.map(x => cellIn(x, field, locale)).join(', ') : asText(v);
};
/** The cell rule in en-GB, as it always was. */
export const cell = (v: unknown, field?: string): string => cellIn(v, field);
export const CELL_RULE = 'numbers grouped as the locale writes them, at most 2 decimals; whole numbers in fields named year, id, no, number, code, zip, phone, version or port, or whose names end in år, nr, nummer, kode, postnr, orgnr, kid, konto, telefon or versjon (byggeår, varenr), as written; empty for null; lists of plain values joined with ", "';

/** Whether YYYY-MM-DD is a day of the calendar: 2026-02-30 is not, and is never rolled over into March. */
export const isCalendarDay = (day: string): boolean => { const d = new Date(`${day}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day; };
/** A date or time as the person reads it, in the process's locale and time zone; as written when it is not one. */
export const whenIn = (v: unknown, locale = 'en-GB', timeZone = 'UTC', withTime = true): string => {
  if (v === null || v === undefined || v === '') return '';
  const s = asText(v); const d = new Date(s); const written = /\d{4}-\d{2}-\d{2}/.exec(s);
  if (Number.isNaN(d.getTime()) || !written || !isCalendarDay(written[0])) return s;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s);
  return new Intl.DateTimeFormat(locale, dateOnly || !withTime ? { dateStyle: 'medium', timeZone: dateOnly ? 'UTC' : timeZone } : { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(d);
};
/** An amount with its currency (ISO 4217), as the locale writes it. */
export const moneyIn = (v: unknown, currency?: string, locale = 'en-GB'): string => {
  const n = typeof v === 'number' ? v : Number(v);
  if (v === null || v === undefined || v === '' || !Number.isFinite(n)) return v === null || v === undefined ? '' : asText(v);
  try { return currency ? new Intl.NumberFormat(locale, { style: 'currency', currency }).format(n) : n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  catch { return `${n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`; }
};
/** A size in bytes, as people read it. */
export const bytesIn = (v: unknown, locale = 'en-GB'): string => {
  if (v === null || v === undefined || v === '') return ''; // no size, rather than 0 B
  const n = Number(v); if (!Number.isFinite(n)) return asText(v);
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let x = n; while (x >= 1024 && i < u.length - 1) { x /= 1024; i++; }
  return `${x.toLocaleString(locale, { maximumFractionDigits: i ? 1 : 0 })} ${u[i]}`;
};
/** Text cut to at most max characters, saying how many more there were. */
export const cutText = (t: string, max: number): string => (t.length > max ? `${t.slice(0, max)}… (${t.length - max} more characters)` : t);
/** Text cut to at most n characters, its last an ellipsis when it was longer. */
export const ellipsis = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** A number as a person types it: spaces between groups of digits left out, a decimal comma read as a point. */
export const decimalNumber = (v: unknown): number => Number(String(v).replace(/\s/g, '').replace(',', '.'));
