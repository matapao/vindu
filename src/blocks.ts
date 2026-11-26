// Vindu's blocks: the kinds of thing people work with that a table or a record shows poorly, as cards of Vindu's own,
// each drawn by a Vindu renderer component (renderer/blocks.ts). They take rows exactly as any card does (from,
// pick, where, compute, group, sort, limit), and a block's roles say which field plays which part ("from" in a message,
// "start" in an event). The model names a role's field with map, or Vindu finds it by its usual names. What a block
// works out itself (an invoice's total, free time between meetings, what changed between two versions, where a place
// or a node is drawn) is computed by the system, and its account says so. A host offers all of them by default, some
// (blocks: [names]), or none (blocks: false); the model is told only of those offered.
import { z } from 'zod';
import { block, needOne, type Roles } from './block-kit.js';
import { BATCH } from './block-batch.js';
import { EVENTS } from './block-events.js';
import { NOTICE } from './block-notice.js';
import type { CardDef } from './cards.js';
import { panelOption } from './card-schema.js';
import { changedFields } from './changes.js';
import { addFields, num, parse as parseExpr, setValue } from './compute.js';
import type { Row } from './results.js';
import { CONTACTS, DIAGRAM, MAP_BLOCK } from './blocks-drawn.js';
import { DOCUMENT, MESSAGE, TASKS } from './blocks-text.js';

// ── money: an invoice or receipt (lines, and totals the system adds up and checks), a payment before it is made ───────
const MONEY: Roles = { description: /^(description|item|name|text|line|product|service)$/i, quantity: /^(quantity|qty|hours|units?|count)$/i,
  price: /^(unit_?price|price|rate|unit_?cost)$/i, amount: /^(amount|total|line_?total|sum|net)$/i, vat: /^(vat|tax|vat_?rate|tax_?rate|mva)$/i, currency: /^(currency|ccy)$/i };
export const MONEY_BLOCK = block({
  name: 'money', component: 'VMoney', about: 'money as a document: an invoice or receipt from its lines (the system computes each line\'s amount from quantity × price where it is missing, adds them up, and checks the document\'s own total), or one payment before it is made',
  roles: MONEY, layouts: ['invoice', 'receipt', 'payment'],
  fields: { currency: z.string().optional().describe('money: the currency (ISO 4217, e.g. EUR, USD or JPY) when the rows do not say'),
    head: z.record(z.string(), z.unknown()).optional().describe('money: what stands above the lines (number, to, date, due); by default read from the result the lines are in'),
    stated_total: z.number().optional().describe('money: the document\'s own total, to check against its lines; by default its "total" field') },
  check: (rows, p, m) => (p.layout === 'payment' ? needOne(m, ['amount'], 'a payment', rows) : needOne(m, ['amount', 'price'], 'an invoice', rows)),
  rows: (rows, p, m, read) => {
    const computed = !m.amount && !!m.price; // each amount as quantity × price
    const out = computed ? addFields(rows, { amount: m.quantity ? `${q(m.quantity)} * ${q(m.price)}` : q(m.price) }).rows : rows;
    if (computed) m.amount = 'amount';
    const e = p.from ? read(String(p.from)) : undefined; const whole = e?.kind === 'result' && e.value && typeof e.value === 'object' && !Array.isArray(e.value) ? e.value as Row : undefined;
    const head = (p.head as Row | undefined) ?? (whole ? Object.fromEntries(Object.entries(whole).filter(([, v]) => v === null || typeof v !== 'object').slice(0, 10)) : undefined);
    const c = head?.currency ?? whole?.currency; const currency = p.currency || (typeof c === 'string' && /^[A-Z]{3}$/.test(c) ? c : undefined);
    const stated = num(p.stated_total ?? head?.total ?? whole?.total);
    const sum = out.reduce((a, r) => a + (num(r[m.amount]) ?? 0), 0);
    const vat = m.vat ? out.reduce((a, r) => { const rate = num(r[m.vat]); const amt = num(r[m.amount]); return a + (rate !== null && amt !== null ? amt * (rate > 1 ? rate / 100 : rate) : 0); }, 0) : 0;
    const total = Number((sum + vat).toPrecision(15));
    const totals = { lines: Number(sum.toPrecision(15)), ...(m.vat ? { vat: Number(vat.toPrecision(15)) } : {}), total, ...(stated !== null ? { stated, agrees: Math.abs(stated - total) < 0.005 || Math.abs(stated - sum) < 0.005 } : {}) };
    return { rows: out, props: { currency: currency ?? '', head: head ?? {}, totals },
      account: { lines: out.length, totals: `computed by the system${computed ? ' (each amount = quantity × price)' : ''}: ${JSON.stringify(totals)}`,
        ...(totals.agrees === false ? { mismatch: 'the document\'s own total is not what its lines add up to' } : {}) } };
  },
  props: p => ({ currency: p.currency ?? '', head: p.head ?? {}, totals: {} }),
  allFields: p => p.layout === 'payment', // one payment: every field of it
  words: w => ({ ...w.money }),
});
const q = (f: string) => (/^[A-Za-z_]\w*$/.test(f) ? f : `"${f}"`);

export const FILES = block({
  name: 'files', component: 'VFiles', about: 'files: name, type, size, when changed, who has them',
  roles: { name: /^(name|file_?name|filename|title|path)$/i, type: /^(type|mime|mime_?type|kind|content_?type|extension)$/i, size: /^(size|bytes|length)$/i,
    modified: /^(modified|updated|changed|mtime|last_?modified|date)$/i, owner: /^(owner|author|by|created_?by)$/i, shared: /^(shared|shared_?with|access|permissions)$/i },
  check: (rows, _p, m) => needOne(m, ['name'], 'a file', rows),
  account: rows => ({ files: rows.length }),
});

// ── a sheet: rows with formulas per column, inputs, and scenarios side by side, all computed by the system ─────────
export const SHEET = block({
  name: 'sheet', component: 'VSheet', about: 'a spreadsheet model: rows with computed columns (compute), inputs ($name) and scenarios side by side; every computed cell says its formula. Its columns are lettered A, B, … and its rows numbered, row 1 the header. A CSV, TSV or JSON file as rows: from, its attachment id, or path, the file in the working folder; the system reads it, and draws up to 1,000 rows and 200 columns of it. A workbook (.xlsx) the same way, a tab for each sheet that is not hidden, each value as Excel last saved it (formulas marked, never computed again); pick: one sheet by its name, shown alone, for where, sort, compute or notes. notes: your notes on its cells, by A1 address',
  roles: {}, cells: { rows: 1000, columns: 200 },
  fields: { scenarios: panelOption(z.record(z.string(), z.record(z.string(), z.number())).optional().describe('sheet: named sets of inputs, e.g. {"low": {"growth": 0.02}, "base": {"growth": 0.04}}; totals is computed for each')),
    totals: panelOption(z.record(z.string(), z.string()).optional().describe('sheet: values over all rows, e.g. {"Budget": "sum(budget)"}; with scenarios, one column per scenario')) },
  check: rows => (rows.length ? null : 'a sheet needs rows'),
  rows: (rows, p, _m, _read, given) => {
    const sc = (p.scenarios ?? {}) as Record<string, Record<string, number>>; const totals = (p.totals ?? {}) as Record<string, string>;
    const base = (p.inputs ?? {}) as Record<string, unknown>;
    const inputs = given ?? Object.fromEntries(Object.entries(base).map(([k, v]) => [k, typeof v === 'number' ? v : (v as { value: number }).value]));
    const compute = p.compute ?? {};
    const cols = Object.keys(sc).length ? sc : { '': {} };
    return { rows, props: { sheet: {
      formulas: compute,
      totals: Object.entries(totals).map(([label, expr]) => ({ label, expr, values: Object.entries(cols).map(([name, over]) => {
        const all = { ...inputs, ...over };
        const rs = Object.keys(compute).length ? addFields(rows, compute, all).rows : rows;
        return { scenario: name || null, value: valueOver(expr, rs, all) };
      }) })),
      scenarios: Object.keys(sc),
    } } };
  },
  props: () => ({ sheet: {} }), allFields: () => true, words: w => ({ ...w.sheet }),
  account: (rows, p, _m, props) => ({ rows: rows.length, formulas: p.compute ?? {}, totals: 'computed by the system for each scenario', values: (props.sheet as { totals?: unknown })?.totals }),
});
const valueOver = (expr: string, rows: Row[], inputs: Record<string, unknown>) => { const v = setValue(parseExpr(expr), rows, inputs); return v; };

export const SLIDES = block({
  name: 'slides', component: 'VSlides', props: p => ({ at: p.at ?? 0 }), about: 'slides: one per row, with a title, points and a figure; shown one at a time; every number on a slide is checked against the task\'s results',
  roles: { title: /^(title|heading|headline)$/i, points: /^(points|bullets|body|text|content)$/i, figure: /^(figure|number|kpi|value|metric)$/i, label: /^(label|figure_?label|caption)$/i, notes: /^(notes|speaker_?notes)$/i },
  check: (rows, _p, m) => needOne(m, ['title'], 'a slide', rows),
  account: (rows, p) => ({ slides: rows.length, slide: (p.at ?? 0) + 1 }),
  actions: { slide: { run: (p, rows, a, where) => { // the slide shown, the same in every window
    if (a.to === undefined || !Number.isInteger(a.to) || a.to < 0 || (rows.length && a.to >= rows.length)) return { refusal: `slide needs to: 0 to ${Math.max(0, rows.length - 1)}` };
    p.at = a.to;
    return { what: `went to slide ${a.to + 1} of ${rows.length} in ${where}`, mark: `Slide ${a.to + 1}` };
  } } },
});

export const SIGNATURE = block({
  name: 'signature', component: 'VSignature', one: true, about: 'a signature: who signed what, when, and the digest of what was signed',
  roles: { who: /^(who|signer|name|by|signed_?by)$/i, when: /^(when|at|signed_?at|time|date)$/i, what: /^(what|document|subject|title)$/i, digest: /^(digest|sha256|hash)$/i, image: /^(image|png|svg|drawing|signature)$/i },
  check: (rows, _p, m) => needOne(m, ['who'], 'a signature', rows),
  account: rows => ({ signatures: rows.length }),
});

export const DEVICES = block({
  name: 'devices', component: 'VDevices', about: 'devices and settings: each one\'s state; with operation, the person can switch one from the window (a host operation, asked as any is)',
  roles: { name: /^(name|device|setting|label|title)$/i, state: /^(state|status|on|value|enabled|level)$/i, kind: /^(kind|type|class)$/i, id: /^(id|key|serial)$/i },
  fields: { operation: z.string().optional().describe('devices: a host operation the person can run on a row from the window, given that row\'s id') },
  check: (rows, _p, m) => needOne(m, ['name'], 'a device', rows),
  props: p => ({ operation: p.operation ?? '' }),
  words: w => ({ on: w.on, off: w.off, turnOn: w.turnOn, turnOff: w.turnOff }),
  account: rows => ({ devices: rows.length }),
});

// ── many at once: a result per call of a batch (block-batch.ts); a set of changes, each row's before and after ────
export const CHANGES = block({
  name: 'changes', component: 'VChanges', about: 'a set of changes to rows: each row\'s key, and its fields before and after (before/after objects, or field, before and after columns)',
  roles: { key: /^(key|id|number|no|order|row)$/i, field: /^(field|column|attribute)$/i, before: /^(before|old|was|from)$/i, after: /^(after|new|now|to)$/i },
  check: (_rows, _p, m) => (m.before && m.after ? null : 'changes need before and after: objects with the row\'s fields, or values with a field column'),
  account: (rows, _p, m) => ({ rows: rows.length, fields_changed: [...new Set(rows.flatMap(r => (m.field ? [String(r[m.field])] : changedFields(r[m.before], r[m.after]).map(([k]) => k))))].slice(0, 20) }),
});

export const DECISION = block({
  name: 'decision', component: 'VDecision', one: true, about: 'a decision: what was decided, on what grounds and sources, by whom and when, and how to appeal',
  roles: { outcome: /^(outcome|decision|result|verdict)$/i, grounds: /^(grounds|reasons?|because|rationale)$/i, sources: /^(sources?|refs|references|evidence)$/i,
    by: /^(by|decided_?by|who|officer|approvers?)$/i, at: /^(at|when|date|decided_?at)$/i, appeal: /^(appeal|complaint|how_?to_?appeal|rights)$/i },
  check: (rows, _p, m) => needOne(m, ['outcome'], 'a decision', rows) ?? needOne(m, ['grounds'], 'a decision', rows),
  account: rows => ({ decisions: rows.length }),
});

export const BLOCKS: CardDef[] = [MESSAGE, DOCUMENT, EVENTS, NOTICE, TASKS, MONEY_BLOCK, FILES, MAP_BLOCK, CONTACTS, SHEET, SLIDES, SIGNATURE, DIAGRAM, DEVICES, BATCH, CHANGES, DECISION];
