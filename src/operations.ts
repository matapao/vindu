// Operations: what a host lets the model do through the window, named by what it does. The model sees a tool with
// a name, a description, an input schema and what it returns; it never sees the form, the buttons or the dialog that
// asks the person (the binding), so a host changes those without the model knowing. One kind of ask covers all of it:
// an operation that needs the person, what the processor asks before a tool call (with its own options), a form a server
// or the processor asks for (MCP elicitation), a page it asks the person to open, and a call an MCP App wants to make.
// Each is drawn in the window by a binding and answered only there, by the person.
import { z } from 'zod';
import { BASIC_CATALOG, componentList, surfaceOf } from './catalog-id.js';
import { patternOf, PATTERN_VALUE_MAX } from './field-patterns.js';
import { asText, cutText, decimalNumber, isCalendarDay } from './format.js';
import type { Surface } from './a2ui.js';
import type { PreviewPanel } from './frames.js';

/** What an operation does to the world, as the model and the person are told (and as MCP's tool hints say). */
export type Effect = 'none' | 'read' | 'ui' | 'write' | 'external' | 'destructive';
/** A field the person fills in: the plain JSON Schema MCP elicitation uses. enum holds the values; labels and hints, when
 *  the schema titles and describes them, what the person reads for each; multi: pick any number of them. */
export const FORMATS = ['date', 'date-time', 'time', 'email', 'uri', 'money', 'place', 'file'] as const;
/** Check digits a field's value must have: an IBAN (mod 97), a Norwegian organisation number (orgnr, mod 11), Luhn (mod 10). */
export const CHECKS = ['iban', 'orgnr', 'luhn'] as const;
export type Format = typeof FORMATS[number];
export type Check = typeof CHECKS[number];
export const FieldSchema = z.object({
  type: z.enum(['string', 'number', 'integer', 'boolean']),
  title: z.string().optional(), description: z.string().optional(),
  format: z.enum(FORMATS).optional(), check: z.enum(CHECKS).optional(),
  enum: z.array(z.string()).optional(), labels: z.array(z.string()).optional(), hints: z.array(z.string().optional()).optional(),
  multi: z.boolean().optional(), long: z.boolean().optional(), default: z.unknown().optional(),
  pattern: z.string().optional(), min: z.union([z.number(), z.string()]).optional(), max: z.union([z.number(), z.string()]).optional(),
  minLength: z.number().int().min(0).optional(), maxLength: z.number().int().min(1).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(), accept: z.string().optional(), example: z.string().optional(),
});
export type Field = z.infer<typeof FieldSchema>;
/** A line shown with an ask, between its message and what the person answers: the input of a call, a diff, a file. */
export type Detail = { text: string; label?: string };
export type Form = { title?: string; message?: string; details?: Detail[]; fields?: Record<string, Field>; required?: string[]; choices?: string[] };

export type Approval = { name: string; window: string; at: string };
export type Operation = {
  name: string;                         // what the model calls: named by what it does ("approve_payment", not "show_form")
  description: string;                  // what it does and returns, for the model
  input?: Record<string, z.ZodType>;    // what the model passes, each field described
  effect: Effect;
  /** What the person is asked: fields to fill in, or choices to pick from. Left out: a write, external or destructive
   *  operation is confirmed (yes or no); one with a smaller effect just runs. Given the model's input. */
  ask?: Form | ((input: Record<string, unknown>) => Form);
  /** The host's own code: runs after the person's yes (or at once, when nothing needs asking), and its output goes to
   *  the model and into the record with the answer. */
  run?: (input: Record<string, unknown>, answer: Record<string, unknown> | null, approvals?: readonly Approval[]) => unknown;
  binding?: string;                     // which binding draws the ask: "form" (the default), or one the host added
  /** Shown beside the ask: exactly what it will send or change, drawn from its input (kept by reference). By default,
   *  for an operation that changes things, a message, a payment, changes or rows, where the input is one (frames.ts). */
  preview?: (input: Record<string, unknown>) => PreviewPanel | undefined;
  /** How many different people must say yes, each in their own window (default 1). */
  approve?: number;
};
// The person can run an operation too: a button of the host's own (a shell action) sends { type: 'operation', name },
// the ask is drawn if it has one, and the next prompt's note tells the model what the person ran.

/** One ask, as a binding draws it and the person answers it. A permission ask's choices are the processor's own options,
 *  in its order and words; a link ask carries the full address of the page to open. */
export type Ask = { ticket: string; title: string; message?: string; details?: Detail[]; fields: Record<string, Field>; required: string[]; choices?: string[]; confirm?: boolean;
  link?: string; kind: 'operation' | 'permission' | 'elicitation' | 'question' | 'link' | 'app'; op: string; input?: unknown; error?: string; // question: the model's own, through ask
  need?: number; approvals?: Approval[]; preview?: string;
  files?: Record<string, { ids: string[]; names: string[] }> }; // what the person picked for its file fields, kept as attachments
/** A binding: an ask drawn as an A2UI surface. Whatever it draws, its answer comes back as an action named "answer"
 *  (context: ticket and values; for a choice, the choice and its place, n) or "decline" (context: ticket), from inside
 *  the window. */
export type Binding = (ask: Ask, words: Words) => Surface;
export type Words = { submit: string; decline: string; allow: string; deny: string; open: string; pick: string; pickAgain: string; required: (f: string) => string };
export const WORDS: Words = { submit: 'Submit', decline: 'Decline', allow: 'Allow', deny: 'Deny', open: 'Open the page', pick: 'Choose a file', pickAgain: 'Choose again', required: f => `${f} is needed` };

export const HINTS: Record<Effect, { readOnlyHint: boolean; destructiveHint: boolean; openWorldHint: boolean }> = {
  none: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  read: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  ui: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  write: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  external: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  destructive: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
};
/** Whether an operation without a form of its own is confirmed by the person before it runs. */
export const confirms = (e: Effect) => e === 'write' || e === 'external' || e === 'destructive';

/** The default binding: the message and any details; a form from the fields (text, number, yes/no, one or several of a
 *  list), each with its description; choices as buttons in their order; a yes/no confirmation; or a page to open, its
 *  full address shown. A2UI's basic catalog only. */
export const formBinding: Binding = (a, w) => {
  const { components, add, text, button: press } = componentList(); const form: Record<string, unknown> = {};
  // an action's context holds plain values or data paths, one level deep: each field goes as "f:<name>", bound to the form
  const button = (id: string, label: string, name: string, extra: Record<string, unknown> = {}, primary = false) =>
    press(id, label, name, { ticket: a.ticket, ...extra }, primary);
  const kids: string[] = [];
  if (a.message) kids.push(text('message', a.message, 'body'));
  (a.details ?? []).forEach((d, i) => { if (d.label) kids.push(text(`detail${i}_label`, d.label, 'caption')); kids.push(text(`detail${i}`, d.text, 'body')); });
  if (a.link) kids.push(text('link', a.link, 'body')); // the whole address, as the person will open it
  if (a.need && a.need > 1) kids.push(text('approvals', a.approvals?.length ? `Yes from ${a.approvals.map(x => `${x.name} (${x.window})`).join(', ')}: ${a.approvals.length} of ${a.need}. Another person must say yes, in their own window; names are as each window gives them, not verified.` : `${a.need} different people must say yes, each in their own window.`, 'caption'));
  if (a.preview) kids.push(text('preview', 'Beside this: exactly what it will send or change.', 'caption'));
  if (a.error) kids.push(text('error', a.error, 'caption'));
  const names = Object.keys(a.fields);
  names.forEach((k, i) => {
    const f = a.fields[k]; const label = (f.title ?? k) + (a.required.includes(k) ? ' *' : '');
    if (f.description) kids.push(text(`f${i}_about`, f.description, 'caption'));
    if (f.enum?.length) {
      const def = f.default === undefined ? [] : Array.isArray(f.default) ? f.default.map(asText) : [asText(f.default)];
      form[k] = def;
      const options = f.enum.map((v, j) => ({ label: (f.labels?.[j] ?? v) + (f.hints?.[j] ? ` — ${f.hints[j]}` : ''), value: v }));
      kids.push(add({ id: `f${i}`, component: 'ChoicePicker', label, variant: f.multi ? 'multipleSelection' : 'mutuallyExclusive', options, value: { path: `/form/${k}` } }));
    }
    else if (f.type === 'boolean') { form[k] = f.default === true; kids.push(add({ id: `f${i}`, component: 'CheckBox', label, value: { path: `/form/${k}` } })); }
    else if (f.format === 'date' || f.format === 'date-time' || f.format === 'time') {
      form[k] = f.default !== undefined ? asText(f.default) : '';
      kids.push(add({ id: `f${i}`, component: 'DateTimeInput', label, value: { path: `/form/${k}` }, enableDate: f.format !== 'time', enableTime: f.format !== 'date',
        ...(typeof f.min === 'string' ? { min: f.min } : {}), ...(typeof f.max === 'string' ? { max: f.max } : {}) }));
    }
    else if (f.format === 'file') { // the person picks files: the host's own way to take them, kept as attachments
      const got = a.files?.[k];
      kids.push(text(`f${i}_got`, got?.names.length ? `${f.title ?? k}: ${got.names.join(', ')}` : `${label}: no file yet`, 'body'));
      kids.push(button(`f${i}`, got?.names.length ? w.pickAgain : w.pick, 'pick_file', { field: k }));
    }
    else {
      form[k] = f.default !== undefined ? asText(f.default) : '';
      const hint = f.example ? `e.g. ${f.example}` : f.format === 'money' ? `an amount${f.currency ? ` in ${f.currency}` : ''}` : f.format === 'place' ? 'an address, or latitude, longitude in decimal degrees (e.g. 12.3456, -65.4321)' : f.format === 'email' ? 'an e-mail address' : f.format === 'uri' ? 'a web address' : '';
      if (hint && !f.description) kids.push(text(`f${i}_form`, hint, 'caption'));
      kids.push(add({ id: `f${i}`, component: 'TextField', label, value: { path: `/form/${k}` }, variant: f.type === 'string' && f.format !== 'money' ? (f.long ? 'longText' : 'shortText') : 'number' }));
    }
  });
  const values = Object.fromEntries(names.map(k => [`f:${k}`, { path: `/form/${k}` }]));
  const buttons = a.choices?.length ? a.choices.map((c, i) => button(`choice${i}`, c, 'answer', { choice: c, n: i }, i === 0))
    : a.link ? [button('open', w.open, 'answer', {}, true), button('decline', w.decline, 'decline')]
    : a.confirm ? [button('allow', w.allow, 'answer', {}, true), button('deny', w.deny, 'decline')]
    : [button('submit', w.submit, 'answer', values, true), button('decline', w.decline, 'decline')];
  kids.push(add({ id: 'buttons', component: 'Row', children: buttons }));
  add({ id: 'root', component: 'Column', children: kids });
  return surfaceOf(`ask-${a.ticket}`, BASIC_CATALOG, components, { form });
};

/** The person's values, checked against what they were asked: what does not fit goes back to them, never to the model.
 *  Text from a number field becomes a number; a choice is one of the choices, at its place (n). */
export function readAnswer(a: Ask, raw: unknown, fileSelection?: unknown, words: Pick<Words, 'required'> = WORDS): { values: Record<string, unknown>; n?: number } | { error: string } {
  if (a.confirm || a.link) return { values: {} };
  const got = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  if (a.choices?.length) {
    const c = got.choice; const n = typeof got.n === 'number' ? got.n : typeof c === 'string' ? a.choices.indexOf(c) : -1;
    return typeof c === 'string' && Number.isInteger(n) && a.choices[n] === c ? { values: { choice: c }, n } : { error: 'pick one of the choices' };
  }
  const out: Record<string, unknown> = {};
  for (const [k, f] of Object.entries(a.fields)) {
    if (f.format === 'file') { // only registered attachments become the answer
      const ids = a.files?.[k]?.ids ?? [];
      if (fileSelection !== undefined) {
        const selection = fileSelection && typeof fileSelection === 'object' && !Array.isArray(fileSelection)
          ? fileSelection as Record<string, unknown> : undefined;
        const expected = selection && Object.hasOwn(selection, k) ? selection[k] : undefined;
        if (!Array.isArray(expected) || expected.length !== ids.length || ids.some((id, i) => id !== expected[i]))
          return { error: 'The selected files changed. Review the files and submit again.' };
      }
      if (!ids.length) { if (a.required.includes(k)) return { error: words.required(f.title ?? k) }; continue; }
      out[k] = ids.length === 1 && f.type !== 'string' ? ids[0] : ids; continue;
    }
    let v = Object.hasOwn(got, k) ? got[k] : undefined;
    if (f.multi) {
      const list = (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]).map(String);
      if (!list.length) { if (a.required.includes(k)) return { error: words.required(f.title ?? k) }; continue; }
      const bad = list.find(x => !f.enum?.includes(x));
      if (bad !== undefined) return { error: `${f.title ?? k}: ${bad} is not one of ${f.enum?.join(', ')}` };
      out[k] = list; continue;
    }
    if (Array.isArray(v) && f.enum) v = v[0]; // a choice picker holds a list
    if (typeof v === 'string') v = v.trim();
    if (v === '' || v === undefined || v === null) { if (a.required.includes(k)) return { error: words.required(f.title ?? k) }; continue; }
    const wrong = checkValue(f, v);
    if (wrong) return { error: `${f.title ?? k}: ${wrong}` };
    if (f.format === 'money') { out[k] = decimalNumber(v); continue; }
    if (f.format === 'date-time' || f.format === 'date' || f.format === 'time') { out[k] = asText(v); continue; }
    if (f.type === 'number' || f.type === 'integer') { const n = Number(asText(v).replace(',', '.')); if (!Number.isFinite(n) || (f.type === 'integer' && !Number.isInteger(n))) return { error: `${f.title ?? k}: a ${f.type === 'integer' ? 'whole ' : ''}number` }; v = n; }
    else if (f.type === 'boolean') v = v === true || v === 'true';
    else v = asText(v);
    if (f.enum && !f.enum.includes(String(v))) return { error: `${f.title ?? k}: one of ${f.enum.join(', ')}` };
    out[k] = v;
  }
  return { values: out };
}

type Choice = { const?: unknown; title?: string; description?: string };
type Prop = { type?: string; title?: string; description?: string; enum?: unknown[]; enumNames?: string[]; oneOf?: Choice[]; anyOf?: Choice[];
  items?: { type?: string; enum?: unknown[]; anyOf?: Choice[]; oneOf?: Choice[] }; default?: unknown; format?: string; maxLength?: number; minLength?: number; minimum?: number; maximum?: number; pattern?: string };
/** An elicitation's schema (MCP's: an object of plain fields) as the fields of an ask, keeping what the schema says the
 *  person reads: each field's title and description, each choice's title and description (titled enums, the older
 *  enumNames), and lists to pick several from. */
export function fieldsOf(schema: unknown): { fields: Record<string, Field>; required: string[] } {
  const s = (schema ?? {}) as { properties?: Record<string, Prop>; required?: string[] };
  const entries: [string, Field][] = []; // made into an object at once: a field named __proto__ is a field like any other
  const choices = (list: Choice[]) => ({ enum: list.map(o => String(o.const)), labels: list.map(o => o.title ?? String(o.const)), ...(list.some(o => o.description) ? { hints: list.map(o => o.description) } : {}) });
  for (const [k, p] of Object.entries(s.properties ?? {})) {
    const base = { ...(p.title ? { title: p.title } : {}), ...(p.description ? { description: p.description } : {}), ...(p.default !== undefined ? { default: p.default } : {}) };
    if (p.type === 'array') {
      const it = p.items ?? {}; const titled = it.anyOf ?? it.oneOf;
      const en = titled?.length ? choices(titled) : it.enum?.length ? { enum: it.enum.map(String) } : undefined;
      entries.push([k, en ? { type: 'string', multi: true, ...base, ...en } : { type: 'string', long: true, ...base }]); // a list of free text is written one per line
      continue;
    }
    const type = p.type === 'number' || p.type === 'integer' || p.type === 'boolean' ? p.type : 'string';
    const titled = p.oneOf ?? p.anyOf;
    const en = titled?.length ? choices(titled) : p.enum?.length ? { enum: p.enum.map(String), ...(p.enumNames?.length === p.enum.length ? { labels: p.enumNames } : {}) } : {};
    const kind = type === 'string' && p.format && (FORMATS as readonly string[]).includes(p.format) ? { format: p.format as Format } : {};
    const limits = { ...(p.minLength !== undefined ? { minLength: p.minLength } : {}), ...(p.maxLength !== undefined ? { maxLength: p.maxLength } : {}), ...(p.minimum !== undefined ? { min: p.minimum } : {}), ...(p.maximum !== undefined ? { max: p.maximum } : {}),
      ...(typeof p.pattern === 'string' && patternOf(p.pattern) ? { pattern: p.pattern } : {}) }; // a pattern not safe to test is left out, as the server's to check
    entries.push([k, { type, ...base, ...en, ...kind, ...limits, ...(type === 'string' && !('enum' in en) && (p.maxLength ?? 0) > 200 ? { long: true } : {}) }]);
  }
  const fields: Record<string, Field> = Object.fromEntries(entries);
  return { fields, required: (Array.isArray(s.required) ? s.required : []).filter(k => Object.hasOwn(fields, k)) };
}

/** Why a value does not fit its field, or nothing: the system checks each kind itself, so the model gets only values
 *  that fit (a real date, an amount with at most two decimals, an IBAN whose check digits add up). The field's own rules
 *  (its length, its pattern, its check digits) hold whatever its format. */
export function checkValue(f: Field, v: unknown): string | undefined {
  const t = String(v);
  return formatWrong(f, t) ?? rulesWrong(f, t);
}
/** name@domain.tld, as /^[^\s@]+@[^\s@]+\.[^\s@]+$/ says, without its backtracking over every dot of the domain: one "@"
 *  with no space anywhere, something before it, and a dot in the domain with something on either side. */
export const isEmail = (t: string): boolean => /^[^\s@]+@[^\s@]+$/.test(t) && t.slice(t.indexOf('@') + 2, -1).includes('.');
/** Why a value is not what its format says (a date, a time, an e-mail address, an amount, a place), or nothing. */
function formatWrong(f: Field, t: string): string | undefined {
  const between = (x: number | string, kind: string) => (f.min !== undefined && x < f.min ? `${kind} ${f.min} or later` : f.max !== undefined && x > f.max ? `${kind} ${f.max} or earlier` : undefined);
  switch (f.format) {
    case 'date': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return 'a date, as YYYY-MM-DD';
      return isCalendarDay(t) ? between(t, 'a date') : `${t} is not a day of the calendar`;
    }
    case 'time': return /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(t) ? between(t, 'a time') : 'a time, as HH:MM';
    case 'date-time': {
      if (!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/.test(t)) return 'a date and time, as YYYY-MM-DDTHH:MM';
      return isCalendarDay(t.slice(0, 10)) ? between(t, 'a time') : `${t.slice(0, 10)} is not a day of the calendar`;
    }
    case 'email': return isEmail(t) ? undefined : 'an e-mail address, as name@example.com';
    case 'uri': try { const u = new URL(t); return /^(https?|mailto|tel):$/.test(u.protocol) ? undefined : 'a web address, http:// or https://'; } catch { return 'a web address, http:// or https://'; }
    case 'money': {
      const s = t.replace(/\s/g, '').replace(',', '.'); if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return `an amount${f.currency ? ` in ${f.currency}` : ''}, with at most two decimals`;
      const n = Number(s); return f.min !== undefined && n < Number(f.min) ? `at least ${f.min}` : f.max !== undefined && n > Number(f.max) ? `at most ${f.max}` : undefined;
    }
    case 'place': {
      const m = /^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/.exec(t);
      if (m && (Math.abs(+m[1]) > 90 || Math.abs(+m[2]) > 180)) return 'latitude is -90 to 90, longitude -180 to 180';
      if (!m && t.length < 3) return 'an address, or latitude, longitude';
    }
  }
  return undefined;
}
/** Why a value breaks its field's own rules (a number's bounds, its length, its pattern, its check digits), or nothing. */
function rulesWrong(f: Field, t: string): string | undefined {
  if (f.type === 'number' || f.type === 'integer') {
    const n = Number(t.replace(',', '.'));
    if (f.min !== undefined && n < Number(f.min)) return `at least ${f.min}`;
    if (f.max !== undefined && n > Number(f.max)) return `at most ${f.max}`;
  }
  if (f.minLength !== undefined && t.length < f.minLength) return `at least ${f.minLength} characters`;
  if (f.maxLength !== undefined && t.length > f.maxLength) return `at most ${f.maxLength} characters`;
  const re = f.pattern ? patternOf(f.pattern) : undefined; // a pattern broken or not safe to test is not held against the person
  if (re && t.length > PATTERN_VALUE_MAX) return `at most ${PATTERN_VALUE_MAX} characters`;
  if (re && !re.test(t)) return f.example ? `in the form ${f.example}` : `in the form ${f.pattern}`;
  if (f.check && !checkDigits(f.check, t)) return f.check === 'iban' ? 'not an IBAN: its check digits do not add up' : f.check === 'orgnr' ? 'not an organisation number (Norway\'s orgnr): nine digits whose check digit adds up' : 'its check digit does not add up';
  return undefined;
}

/** Whether a number's check digits add up: an IBAN (mod 97), a Norwegian organisation number (mod 11), Luhn (mod 10). */
export function checkDigits(c: Check, raw: string): boolean {
  const s = raw.replace(/[\s-]/g, '').toUpperCase();
  if (c === 'iban') {
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
    const moved = s.slice(4) + s.slice(0, 4); let rem = 0;
    for (const ch of moved) { const d = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch; for (const x of d) rem = (rem * 10 + Number(x)) % 97; }
    return rem === 1;
  }
  if (c === 'orgnr') {
    if (!/^\d{9}$/.test(s)) return false;
    const sum = [3, 2, 7, 6, 5, 4, 3, 2].reduce((a, w, i) => a + w * Number(s[i]), 0); const r = sum % 11; const k = r === 0 ? 0 : 11 - r;
    return k !== 10 && k === Number(s[8]);
  }
  if (!/^\d{2,}$/.test(s)) return false;
  let sum = 0; for (let i = 0; i < s.length; i++) { let d = Number(s[s.length - 1 - i]); if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; } sum += d; }
  return sum % 10 === 0;
}

/** What a processor asks before a tool call, as details the person reads: the tool, its input as the processor gave it, each
 *  change it would make (a diff of the lines that differ) and the files it touches. Nothing added, nothing left out but
 *  what is too long to read, which says so. */
export function permissionDetails(p: { tool?: string; input?: unknown; content?: unknown[]; locations?: { path: string; line?: number | null }[] }, max = 4000): Detail[] {
  const cut = (t: string) => cutText(t, max);
  const out: Detail[] = [];
  if (p.tool) out.push({ label: 'tool', text: p.tool });
  if (p.input !== undefined && p.input !== null && !(typeof p.input === 'object' && !Array.isArray(p.input) && !Object.keys(p.input).length)) out.push({ label: 'input', text: cut(typeof p.input === 'string' ? p.input : JSON.stringify(p.input, null, 2)) });
  for (const c of p.content ?? []) {
    const x = c as { type?: string; path?: string; oldText?: string | null; newText?: string; content?: { type?: string; text?: string }; terminalId?: string };
    if (x.type === 'diff' && typeof x.newText === 'string') out.push({ label: `change to ${x.path ?? 'a file'}`, text: cut(lineDiff(x.oldText ?? null, x.newText)) });
    else if (x.type === 'content' && x.content?.type === 'text' && x.content.text) out.push({ text: cut(x.content.text) });
    else if (x.type === 'terminal') out.push({ label: 'terminal', text: String(x.terminalId ?? '') });
  }
  if (p.locations?.length) out.push({ label: 'files', text: p.locations.map(l => (l.line ? `${l.path}:${l.line}` : l.path)).join('\n') });
  return out;
}
/** The lines that differ between two texts, as "- old" and "+ new", with the unchanged lines around them left out. */
export function lineDiff(oldText: string | null, newText: string): string {
  if (oldText === null) return newText.split('\n').map(l => `+ ${l}`).join('\n'); // a new file
  const a = oldText.split('\n'), b = newText.split('\n');
  let s = 0; while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0; while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  const lines = [...a.slice(s, a.length - e).map(l => `- ${l}`), ...b.slice(s, b.length - e).map(l => `+ ${l}`)];
  return (s ? `@@ line ${s + 1}\n` : '') + (lines.join('\n') || '(no change)');
}
