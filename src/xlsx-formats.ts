// What a workbook's number formats make of a number, as the sheet card draws it: a date, a time, or both, from Excel's
// serial number of days (in the 1900 date system, or the 1904 one); a percentage; or a number with as many decimals as
// the format gives. A format's layout is not copied: the card writes each kind as the window's locale writes it.

/** How a number is drawn, by its format: date, time or datetime (seconds: true when the format shows them), percent or
 *  fixed (with decimals), or as a number (undefined). */
export type NumberLook = { format: 'date' | 'time' | 'datetime'; seconds?: true } | { format: 'percent' | 'fixed'; decimals: number };

/** Excel's built-in formats that are not General, by their id: the ones the sheet card draws other than as a number. */
const BUILT_IN: Record<number, string> = {
  1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 14: 'm/d/yyyy', 15: 'd-mmm-yy', 16: 'd-mmm',
  17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss', 22: 'm/d/yyyy h:mm', 37: '#,##0 ;(#,##0)',
  38: '#,##0 ;[Red](#,##0)', 39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;[Red](#,##0.00)', 45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mmss.0',
  // East Asian dates and times, which Excel writes in other languages' workbooks too, by what they show: their own codes
  // are written in those languages' scripts
  27: 'yyyy-m', 28: 'm-d', 29: 'm-d', 30: 'm-d-yy', 31: 'yyyy-m-d', 32: 'h:mm', 33: 'h:mm:ss', 34: 'yyyy-m', 35: 'm-d', 36: 'yyyy-m',
  50: 'yyyy-m', 51: 'm-d', 52: 'yyyy-m', 53: 'm-d', 54: 'm-d', 55: 'yyyy-m', 56: 'm-d', 57: 'yyyy-m', 58: 'm-d',
};

/** A format's code by its id: the workbook's own (numFmts), or Excel's built-in one. */
export const formatCode = (id: number, own: ReadonlyMap<number, string>): string => own.get(id) ?? BUILT_IN[id] ?? 'General';

/** How a format code draws a number: its first section, without what is quoted, escaped or in brackets (a colour, a
 *  locale such as [$-414]), read for date and time parts (y, m, d, h, s), a percent sign, or decimals. A format that
 *  counts elapsed time ([h]:mm) draws its number as it is. */
export function lookOf(code: string): NumberLook | undefined {
  const first = code.split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/)[0];
  if (/\[(h+|m+|s+)\]/i.test(first)) return undefined;
  const bare = first.replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[[^\]]*\]/g, '').replace(/_.|\*./g, '').replace(/AM\/PM|A\/P/gi, '');
  if (/^general$/i.test(bare.trim()) || bare.includes('@')) return undefined;
  const date = /[yd]/i.test(bare) || /m/i.test(bare.replace(/(h[^a-z]*m+|m+[^a-z]*s)/gi, '')), time = /[hs]/i.test(bare);
  if (date || time) {
    const seconds = /s/i.test(bare) ? { seconds: true as const } : {};
    if (date && time) return { format: 'datetime', ...seconds };
    return date ? { format: 'date' } : { format: 'time', ...seconds };
  }
  const decimals = /\.(0+)/.exec(bare)?.[1].length ?? 0;
  if (bare.includes('%')) return { format: 'percent', decimals };
  return /0/.test(bare) && decimals ? { format: 'fixed', decimals } : undefined;
}

const DAY = 86_400_000;
const pad = (n: number, width = 2) => String(n).padStart(width, '0');
/** Excel's serial number as a date and time in ISO 8601, as the card's look writes it: 2026-03-14, 09:30 (or 09:30:15),
 *  2026-03-14T09:30. In the 1900 system, day 60 is the 29 February 1900 that never was, written as the 28th; null for a
 *  number no date is. */
export function serialDate(serial: number, look: Extract<NumberLook, { format: 'date' | 'time' | 'datetime' }>, from1904: boolean): string | null {
  if (!Number.isFinite(serial) || serial < 0 || serial >= 2_958_466) return null; // up to 9999-12-31
  const whole = Math.floor(serial);
  // before day 60, Excel counts 1900-01-01 as day 1; from day 61 on, it counts the day that never was
  const base = from1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, whole < 60 ? 31 : 30);
  const d = new Date(base + whole * DAY + Math.round((serial - whole) * 86_400) * 1000);
  const ymd = `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const hms = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}${look.seconds ? `:${pad(d.getUTCSeconds())}` : ''}`;
  if (look.format === 'date') return ymd;
  return look.format === 'time' ? hms : `${ymd}T${hms}`;
}
