// What the blocks say of their rows, drawn in the window: part of the words a view is drawn in (view-words.ts). A word
// with a slot in braces ({count}) gets its value there as the window draws it: a number or a date as the view's locale
// writes it. A host's own word keeps the same slots. No imports: the blocks in the window read these too.

/** An invoice or a receipt (the money block): the labels of its head and its lines, its totals, and whether the
 *  document's own total is what its lines add up to. */
export type MoneyWords = {
  number: string; customer: string; date: string; due: string; currency: string; // its head: "Number", "Customer", …
  description: string; quantity: string; price: string; amount: string;           // its lines' columns
  lines: string; vat: string; total: string;                                      // "Lines", "VAT", "Total", before each sum
  agrees: string;  // "the document's own total, {stated}, is what its lines add up to"
  differs: string; // "the document says {stated}; its lines add up to {total}"
};
/** The events block: free time between events, what it says with nothing to show, and what a week carries: each day's
 *  precipitation and wind, the warnings over its days by level, and the tasks due on it. */
export type EventWords = {
  free: string;    // "free {time}": the time, in hours and minutes
  hours: string;   // "{hours} h"
  minutes: string; // "{minutes} min"
  none: string;    // "No events."
  noFree: string;  // no free time of the length asked for
  rain: string;    // "{amount} mm": a day's precipitation
  wind: string;    // "{speed} m/s": a day's strongest wind
  yellow: string; orange: string; red: string; // a warning, by its level: "Yellow warning"
  due: string;     // "Due: {title}": a task due that day, for a screen reader
};
/** The notice block: a notice by its level, and when it is from and to. */
export type NoticeWords = {
  yellow: string; orange: string; red: string; // "Yellow warning"
  from: string;    // "from {when}"
  until: string;   // "until {when}"
};
/** The batch block: how many calls went how, of all of them. */
export type BatchWords = {
  ok: string;      // "{count} ok"
  failed: string;  // "{count} failed"
  missing: string; // "{count} missing": a call whose result is not there
  of: string;      // "of {count}"
};
/** The map block: how its places were drawn. */
export type MapWords = { drawn: string }; // "Positions drawn by the system; no map tiles."
/** The tasks block: when a task is due. */
export type TaskWords = { due: string };  // "due {date}"
/** A pdf panel: the page in view of how many, and why a PDF is not shown. */
export type PdfWords = {
  page: string;       // "page {at} of {of}"
  loading: string;    // "Loading the PDF…"
  locked: string;     // a PDF protected by a password
  unreadable: string; // "This PDF could not be read: {why}"
};
export type BlockWords = { money: MoneyWords; events: EventWords; notice: NoticeWords; batch: BatchWords; map: MapWords; tasks: TaskWords; pdf: PdfWords };

export const BLOCK_WORDS: BlockWords = {
  money: {
    number: 'Number', customer: 'Customer', date: 'Date', due: 'Due', currency: 'Currency',
    description: 'Description', quantity: 'Quantity', price: 'Price', amount: 'Amount',
    lines: 'Lines', vat: 'VAT', total: 'Total',
    agrees: 'the document\'s own total, {stated}, is what its lines add up to',
    differs: 'the document says {stated}; its lines add up to {total}',
  },
  events: { free: 'free {time}', hours: '{hours} h', minutes: '{minutes} min', none: 'No events.', noFree: 'No free time of that length in that range.',
    rain: '{amount} mm', wind: '{speed} m/s', yellow: 'Yellow warning', orange: 'Orange warning', red: 'Red warning', due: 'Due: {title}' },
  notice: { yellow: 'Yellow warning', orange: 'Orange warning', red: 'Red warning', from: 'from {when}', until: 'until {when}' },
  batch: { ok: '{count} ok', failed: '{count} failed', missing: '{count} missing', of: 'of {count}' },
  map: { drawn: 'Positions drawn by the system; no map tiles.' },
  tasks: { due: 'due {date}' },
  pdf: { page: 'page {at} of {of}', loading: 'Loading the PDF…', locked: 'This PDF is protected by a password, so it is not shown.', unreadable: 'This PDF could not be read: {why}' },
};

/** A word with its slots filled: "{count} ok" with count "4" is "4 ok". A slot with no value is left as it is. */
export const wordWith = (word: string, values: Record<string, string>): string =>
  word.replace(/\{(\w+)\}/g, (slot, name: string) => values[name] ?? slot);

/** A block's words as the window gets them: each one the surface gives, and the English one for each it does not. */
export function wordsGiven<T extends Record<string, string>>(given: unknown, english: T): T {
  const words = (given && typeof given === 'object' ? given : {}) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(english).map(([k, word]) => [k, typeof words[k] === 'string' ? words[k] : word])) as T;
}
