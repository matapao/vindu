// Operations: what a host lets the model do through the window, named by what it does. The model sees a tool with
// a name, a description, an input schema and what it returns; it never sees the form, the buttons or the dialog that
// asks the person (the binding), so a host changes those without the model knowing. One kind of ask covers all of it:
// an operation that needs the person, what the processor asks before a tool call (with its own options), a form a server
// or the processor asks for (MCP elicitation), a page it asks the person to open, and a call an MCP App wants to make.
// Each is drawn in the window by a binding and answered only there, by the person.
import { z } from 'zod';
import { BASIC_CATALOG, componentList, surfaceOf } from './catalog-id.js';
import { asText, cutText, decimalNumber } from './format.js';
import type { Surface } from './a2ui.js';
import type { PreviewPanel } from './frames.js';
import { checkValue, type Field } from './field-values.js';

/** What an operation does to the world, as the model and the person are told (and as MCP's tool hints say). */
export type Effect = 'none' | 'read' | 'ui' | 'write' | 'external' | 'destructive';
/** A line shown with an ask, between its message and what the person answers: the input of a call, a diff, a file. */
export type Detail = { text: string; label?: string };
export type Form = {
  title?: string;
  message?: string;
  details?: Detail[];
  fields?: Record<string, Field>;
  required?: string[];
  choices?: string[];
};

export type Approval = { name: string; window: string; at: string };
export type Operation = {
  name: string; // what the model calls: named by what it does ("approve_payment", not "show_form")
  description: string; // what it does and returns, for the model
  input?: Record<string, z.ZodType>; // what the model passes, each field described
  effect: Effect;
  /** What the person is asked: fields to fill in, or choices to pick from. Left out: a write, external or destructive
   *  operation is confirmed (yes or no); one with a smaller effect just runs. Given the model's input. */
  ask?: Form | ((input: Record<string, unknown>) => Form);
  /** The host's own code: runs after the person's yes (or at once, when nothing needs asking), and its output goes to
   *  the model and into the record with the answer. */
  run?: (
    input: Record<string, unknown>,
    answer: Record<string, unknown> | null,
    approvals?: readonly Approval[],
  ) => unknown;
  binding?: string; // which binding draws the ask: "form" (the default), or one the host added
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
export type Ask = {
  ticket: string;
  title: string;
  message?: string;
  details?: Detail[];
  fields: Record<string, Field>;
  required: string[];
  choices?: string[];
  confirm?: boolean;
  link?: string;
  kind: 'operation' | 'permission' | 'elicitation' | 'question' | 'link' | 'app';
  op: string;
  input?: unknown;
  error?: string; // question: the model's own, through ask
  need?: number;
  approvals?: Approval[];
  preview?: string;
  files?: Record<string, { ids: string[]; names: string[] }>;
}; // what the person picked for its file fields, kept as attachments
/** A binding: an ask drawn as an A2UI surface. Whatever it draws, its answer comes back as an action named "answer"
 *  (context: ticket and values; for a choice, the choice and its place, n) or "decline" (context: ticket), from inside
 *  the window. */
export type Binding = (ask: Ask, words: Words) => Surface;
export type Words = {
  submit: string;
  decline: string;
  allow: string;
  deny: string;
  open: string;
  pick: string;
  pickAgain: string;
  required: (f: string) => string;
};
export const WORDS: Words = {
  submit: 'Submit',
  decline: 'Decline',
  allow: 'Allow',
  deny: 'Deny',
  open: 'Open the page',
  pick: 'Choose a file',
  pickAgain: 'Choose again',
  required: (f) => `${f} is needed`,
};

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
  const { components, add, text, button: press } = componentList();
  const form: Record<string, unknown> = {};
  // an action's context holds plain values or data paths, one level deep: each field goes as "f:<name>", bound to the form
  const button = (id: string, label: string, name: string, extra: Record<string, unknown> = {}, primary = false) =>
    press(id, label, name, { ticket: a.ticket, ...extra }, primary);
  const kids: string[] = [];
  if (a.message) kids.push(text('message', a.message, 'body'));
  (a.details ?? []).forEach((d, i) => {
    if (d.label) kids.push(text(`detail${i}_label`, d.label, 'caption'));
    kids.push(text(`detail${i}`, d.text, 'body'));
  });
  if (a.link) kids.push(text('link', a.link, 'body')); // the whole address, as the person will open it
  if (a.need && a.need > 1)
    kids.push(
      text(
        'approvals',
        a.approvals?.length
          ? `Yes from ${a.approvals.map((x) => `${x.name} (${x.window})`).join(', ')}: ${a.approvals.length} of ${a.need}. Another person must say yes, in their own window; names are as each window gives them, not verified.`
          : `${a.need} different people must say yes, each in their own window.`,
        'caption',
      ),
    );
  if (a.preview) kids.push(text('preview', 'Beside this: exactly what it will send or change.', 'caption'));
  if (a.error) kids.push(text('error', a.error, 'caption'));
  const names = Object.keys(a.fields);
  names.forEach((k, i) => {
    const f = a.fields[k];
    const label = (f.title ?? k) + (a.required.includes(k) ? ' *' : '');
    if (f.description) kids.push(text(`f${i}_about`, f.description, 'caption'));
    if (f.enum?.length) {
      form[k] = choicesOf(f.default);
      const options = f.enum.map((v, j) => ({
        label: (f.labels?.[j] ?? v) + (f.hints?.[j] ? ` — ${f.hints[j]}` : ''),
        value: v,
      }));
      kids.push(
        add({
          id: `f${i}`,
          component: 'ChoicePicker',
          label,
          variant: f.multi ? 'multipleSelection' : 'mutuallyExclusive',
          options,
          value: { path: `/form/${k}` },
        }),
      );
    } else if (f.type === 'boolean') {
      form[k] = f.default === true;
      kids.push(add({ id: `f${i}`, component: 'CheckBox', label, value: { path: `/form/${k}` } }));
    } else if (f.format === 'date' || f.format === 'date-time' || f.format === 'time') {
      form[k] = f.default !== undefined ? asText(f.default) : '';
      kids.push(
        add({
          id: `f${i}`,
          component: 'DateTimeInput',
          label,
          value: { path: `/form/${k}` },
          enableDate: f.format !== 'time',
          enableTime: f.format !== 'date',
          ...(typeof f.min === 'string' ? { min: f.min } : {}),
          ...(typeof f.max === 'string' ? { max: f.max } : {}),
        }),
      );
    } else if (f.format === 'file') {
      // the person picks files: the host's own way to take them, kept as attachments
      const got = a.files?.[k];
      kids.push(
        text(
          `f${i}_got`,
          got?.names.length ? `${f.title ?? k}: ${got.names.join(', ')}` : `${label}: no file yet`,
          'body',
        ),
      );
      kids.push(button(`f${i}`, got?.names.length ? w.pickAgain : w.pick, 'pick_file', { field: k }));
    } else {
      form[k] = f.default !== undefined ? asText(f.default) : '';
      const hint = fieldHint(f);
      if (hint && !f.description) kids.push(text(`f${i}_form`, hint, 'caption'));
      kids.push(
        add({ id: `f${i}`, component: 'TextField', label, value: { path: `/form/${k}` }, variant: textVariant(f) }),
      );
    }
  });
  const values = Object.fromEntries(names.map((k) => [`f:${k}`, { path: `/form/${k}` }]));
  let buttons: string[];
  if (a.choices?.length)
    buttons = a.choices.map((c, i) => button(`choice${i}`, c, 'answer', { choice: c, n: i }, i === 0));
  else if (a.link) buttons = [button('open', w.open, 'answer', {}, true), button('decline', w.decline, 'decline')];
  else if (a.confirm) buttons = [button('allow', w.allow, 'answer', {}, true), button('deny', w.deny, 'decline')];
  else buttons = [button('submit', w.submit, 'answer', values, true), button('decline', w.decline, 'decline')];
  kids.push(add({ id: 'buttons', component: 'Row', children: buttons }));
  add({ id: 'root', component: 'Column', children: kids });
  return surfaceOf(`ask-${a.ticket}`, BASIC_CATALOG, components, { form });
};
/** A field's default as the values a choice picker holds: none, each of a list, or the one. */
function choicesOf(given: unknown): string[] {
  if (given === undefined) return [];
  return Array.isArray(given) ? given.map(asText) : [asText(given)];
}
/** What a text field's value is written as, when it has no description of its own: its example, or what its format is. */
function fieldHint(f: Field): string {
  if (f.example) return `e.g. ${f.example}`;
  if (f.format === 'money') return `an amount${f.currency ? ` in ${f.currency}` : ''}`;
  if (f.format === 'place') return 'an address, or latitude, longitude in decimal degrees (e.g. 12.3456, -65.4321)';
  if (f.format === 'email') return 'an e-mail address';
  return f.format === 'uri' ? 'a web address' : '';
}
/** A text field's kind: a number (an amount too), or a line or several of text. */
function textVariant(f: Field): 'number' | 'longText' | 'shortText' {
  if (f.type !== 'string' || f.format === 'money') return 'number';
  return f.long ? 'longText' : 'shortText';
}
/** A multiple choice's values as given: a list as it is, one value as a list of one, nothing (or empty text) as none. */
function listOf(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  return v === undefined || v === null || v === '' ? [] : [v];
}

/** The person's values, checked against what they were asked: what does not fit goes back to them, never to the model.
 *  Text from a number field becomes a number; a choice is one of the choices, at its place (n). */
export function readAnswer(
  a: Ask,
  raw: unknown,
  fileSelection?: unknown,
  words: Pick<Words, 'required'> = WORDS,
): { values: Record<string, unknown>; n?: number } | { error: string } {
  if (a.confirm || a.link) return { values: {} };
  const got = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  if (a.choices?.length) {
    const c = got.choice;
    let n = -1;
    if (typeof got.n === 'number') n = got.n;
    else if (typeof c === 'string') n = a.choices.indexOf(c);
    return typeof c === 'string' && Number.isInteger(n) && a.choices[n] === c
      ? { values: { choice: c }, n }
      : { error: 'pick one of the choices' };
  }
  const out: Record<string, unknown> = {};
  for (const [k, f] of Object.entries(a.fields)) {
    if (f.format === 'file') {
      // only registered attachments become the answer
      const ids = a.files?.[k]?.ids ?? [];
      if (fileSelection !== undefined) {
        const selection =
          fileSelection && typeof fileSelection === 'object' && !Array.isArray(fileSelection)
            ? (fileSelection as Record<string, unknown>)
            : undefined;
        const expected = selection && Object.hasOwn(selection, k) ? selection[k] : undefined;
        if (!Array.isArray(expected) || expected.length !== ids.length || ids.some((id, i) => id !== expected[i]))
          return { error: 'The selected files changed. Review the files and submit again.' };
      }
      if (!ids.length) {
        if (a.required.includes(k)) return { error: words.required(f.title ?? k) };
        continue;
      }
      out[k] = ids.length === 1 && f.type !== 'string' ? ids[0] : ids;
      continue;
    }
    let v = Object.hasOwn(got, k) ? got[k] : undefined;
    if (f.multi) {
      const list = listOf(v).map(String);
      if (!list.length) {
        if (a.required.includes(k)) return { error: words.required(f.title ?? k) };
        continue;
      }
      const bad = list.find((x) => !f.enum?.includes(x));
      if (bad !== undefined) return { error: `${f.title ?? k}: ${bad} is not one of ${f.enum?.join(', ')}` };
      out[k] = list;
      continue;
    }
    if (Array.isArray(v) && f.enum) v = v[0]; // a choice picker holds a list
    if (typeof v === 'string') v = v.trim();
    if (v === '' || v === undefined || v === null) {
      if (a.required.includes(k)) return { error: words.required(f.title ?? k) };
      continue;
    }
    const wrong = checkValue(f, v);
    if (wrong) return { error: `${f.title ?? k}: ${wrong}` };
    if (f.format === 'money') {
      out[k] = decimalNumber(v);
      continue;
    }
    if (f.format === 'date-time' || f.format === 'date' || f.format === 'time') {
      out[k] = asText(v);
      continue;
    }
    if (f.type === 'number' || f.type === 'integer') {
      const n = Number(asText(v).replace(',', '.'));
      if (!Number.isFinite(n) || (f.type === 'integer' && !Number.isInteger(n)))
        return { error: `${f.title ?? k}: a ${f.type === 'integer' ? 'whole ' : ''}number` };
      v = n;
    } else if (f.type === 'boolean') v = v === true || v === 'true';
    else v = asText(v);
    if (f.enum && !f.enum.includes(String(v))) return { error: `${f.title ?? k}: one of ${f.enum.join(', ')}` };
    out[k] = v;
  }
  return { values: out };
}

/** What a processor asks before a tool call, as details the person reads: the tool, its input as the processor gave it, each
 *  change it would make (a diff of the lines that differ) and the files it touches. Nothing added, nothing left out but
 *  what is too long to read, which says so. */
export function permissionDetails(
  p: { tool?: string; input?: unknown; content?: unknown[]; locations?: { path: string; line?: number | null }[] },
  max = 4000,
): Detail[] {
  const cut = (t: string) => cutText(t, max);
  const out: Detail[] = [];
  if (p.tool) out.push({ label: 'tool', text: p.tool });
  if (
    p.input !== undefined &&
    p.input !== null &&
    !(typeof p.input === 'object' && !Array.isArray(p.input) && !Object.keys(p.input).length)
  )
    out.push({ label: 'input', text: cut(typeof p.input === 'string' ? p.input : JSON.stringify(p.input, null, 2)) });
  for (const c of p.content ?? []) {
    const x = c as {
      type?: string;
      path?: string;
      oldText?: string | null;
      newText?: string;
      content?: { type?: string; text?: string };
      terminalId?: string;
    };
    if (x.type === 'diff' && typeof x.newText === 'string')
      out.push({ label: `change to ${x.path ?? 'a file'}`, text: cut(lineDiff(x.oldText ?? null, x.newText)) });
    else if (x.type === 'content' && x.content?.type === 'text' && x.content.text)
      out.push({ text: cut(x.content.text) });
    else if (x.type === 'terminal') out.push({ label: 'terminal', text: String(x.terminalId ?? '') });
  }
  if (p.locations?.length)
    out.push({ label: 'files', text: p.locations.map((l) => (l.line ? `${l.path}:${l.line}` : l.path)).join('\n') });
  return out;
}
/** The lines that differ between two texts, as "- old" and "+ new", with the unchanged lines around them left out. */
export function lineDiff(oldText: string | null, newText: string): string {
  if (oldText === null)
    return newText
      .split('\n')
      .map((l) => `+ ${l}`)
      .join('\n'); // a new file
  const a = oldText.split('\n'),
    b = newText.split('\n');
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0;
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  const lines = [...a.slice(s, a.length - e).map((l) => `- ${l}`), ...b.slice(s, b.length - e).map((l) => `+ ${l}`)];
  return (s ? `@@ line ${s + 1}\n` : '') + (lines.join('\n') || '(no change)');
}
