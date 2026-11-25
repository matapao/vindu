// The batch block: a row per call of many made at once (40 replies sent, 12 refunds), ok or failed as each call's own
// result says, and what each call was about as a person reads it: from its input, by the names of its fields.
import { z } from 'zod';
import { block } from './block-kit.js';
import { countIds, resultIds, resultRef } from './cards.js';
import { readableName, nameWords } from './field-names.js';
import { asText, ellipsis } from './format.js';
import type { Row } from './results.js';

/** Why a call failed, as its own result says; null when it did not. */
const failed = (v: unknown): string | null => {
  if (!v || typeof v !== 'object') return null;
  const o = v as Row;
  if (o.isError === true || o.ok === false || o.success === false) return asText(o.error ?? o.message ?? 'failed');
  if (typeof o.status === 'string' && /^(fail|error|rejected|bounced)/i.test(o.status)) return asText(o.error ?? o.status);
  if (typeof o.error === 'string' && o.error) return o.error;
  return null;
};

/** The last word of a field that names a thing by its number or code: invoice_number, orderId, fakturanr. */
const NUMBER_WORD = /^(number|no|nr|num|id|ref|reference|code|key|nummer)$/i;
/** A Norwegian compound that ends in its number: fakturanummer, ordrenr. */
const NUMBER_ENDING = /^(\p{L}{3,}?)(nummer|nr)$/iu;
/** A field that is a thing itself, given by its number or code: invoice: 10233. */
const THING = /^(invoice|order|ticket|case|issue|booking|account|customer_?id|faktura|ordre|sak|bestilling|konto)$/i;
/** A field that names who or what a call is for: a name, a title, an address. */
const NAMED = /^(name|title|subject|customer|client|recipient|to|email|company|organi[sz]ation|person|navn|tittel|emne|kunde|mottaker|firma)$/i;
/** At most this many characters of a value in a label. */
const VALUE_MOST = 60;

/** A value a label can show: text or a number, not empty and not an object. */
const shown = (v: unknown): string | undefined =>
  (typeof v === 'string' && v.trim()) || typeof v === 'number' ? ellipsis(asText(v).trim(), VALUE_MOST) : undefined;

/** A field that gives a thing by its number, as a person says it: "invoice 10233"; or the value alone ("id": "INV-7"). */
function numbered(field: string, value: string): string | undefined {
  if (THING.test(field)) return `${readableName(field.replace(/_?id$/i, ''))} ${value}`;
  const words = nameWords(field);
  if (words.length && NUMBER_WORD.test(words[words.length - 1])) {
    const thing = words.slice(0, -1).join(' ');
    return thing ? `${thing} ${value}` : value;
  }
  const compound = words.length === 1 ? NUMBER_ENDING.exec(field) : null;
  return compound ? `${compound[1]} ${value}` : undefined;
}

/** What a call was about, from its input: the thing it gives by its number (an invoice, an order) and who or what it
 *  names (a customer, a recipient, a title), in that order; else the tool's name made readable ("send reminder"). */
export function callLabel(input: Row, tool: string): string {
  let number: string | undefined, named: string | undefined;
  for (const [field, v] of Object.entries(input)) {
    const value = shown(v);
    if (value === undefined) continue;
    number ??= numbered(field, value);
    if (NAMED.test(field)) named ??= value;
  }
  const parts = new Set([number, named].filter((x): x is string => !!x));
  return [...parts].join(' · ') || readableName(tool.slice(tool.lastIndexOf('.') + 1)); // a tool's own name, without its namespace
}

export const BATCH = block({
  name: 'batch', component: 'VBatch', about: 'a result per call, for many calls at once (40 replies sent, 12 refunds): one row each, ok or failed, from the calls\' own results; give results (ids) instead of from',
  roles: {},
  fields: { results: resultRef(z.array(z.string()).optional().describe('batch: the result ids of the calls, e.g. ["r5", "r6"], or ["r5-r44"] for a run of them')) },
  derived: ['id', 'call', 'for', 'outcome', 'detail'],
  source: (p, read) => {
    const list = (p.results ?? []) as string[], n = countIds(list); // counted before any run is written out
    if (!n) throw new Error('a batch needs results: the result ids of its calls');
    if (n > 500) throw new Error(`${n} calls: show at most 500 in one batch`);
    const ids = resultIds(list, 500);
    return ids.map(id => {
      const e = read(id);
      if (!e || e.kind !== 'result') return { id, call: '', for: '', outcome: 'missing', detail: `no result ${id}` };
      const input = (e.input && typeof e.input === 'object' && !Array.isArray(e.input) ? e.input : {}) as Row;
      const why = failed(e.value ?? e.rows) ?? (/^(error|failed)\b/i.test(e.text) ? e.text.slice(0, 120) : null);
      return { id, call: `${e.server}.${e.tool}`, for: callLabel(input, e.tool), outcome: why ? 'failed' : 'ok', detail: why ?? '' };
    });
  },
  check: rows => (rows.length ? null : 'no calls in this batch'),
  words: w => ({ ...w.batch }),
  account: rows => ({ calls: rows.length, ok: rows.filter(r => r.outcome === 'ok').length, failed: rows.filter(r => r.outcome === 'failed').map(r => r.id), missing: rows.filter(r => r.outcome === 'missing').map(r => r.id), outcome: 'read by the system from each call\'s own result' }),
});
