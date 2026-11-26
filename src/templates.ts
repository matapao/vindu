// Static and dynamic views. A process's view is dynamic by default: the model composes it. A template makes it static:
// slots instead of views, each saying what fills it and how much the model decides there:
//   - block: a card or block's name (the model binds data only; options the slot gives are fixed), "choose" (one of
//     "of"), "free" (anything, a page of its own included), "page" or "app";
//   - source: a read the app runs itself before the model starts ($name takes an input's value): exact, the same each time;
//     a tool the server marks as read-only, or a resource (a resource only reads; $name in its address takes an input);
//     with every: seconds, kept fresh while the process is open: a resource when its server says it changed (MCP
//     subscriptions), anything else read again that often; what changed is shown in the slot, and the model told;
//   - by: "person": the person fills it (a form, a capture), and their answer is kept like any answer;
//   - then: what the model fills goes to the person next, to approve (approve: n people) or to change (edit).
// Templates are files (JSON). One is chosen when the process starts, pinned from a dynamic view, or kept with the person's
// own arrangement. A template whose source could change something is refused when it loads.
import { BLOCKS } from './blocks.js';
import { kindOf } from './card-kinds/registry.js';
import type { CardDef } from './cards.js';
import { fieldRoles } from './card-schema.js';
import { asText } from './format.js';
import { FieldSchema } from './field-values.js';
import { z } from 'zod';
import type { Row } from './results.js';

const SourceSchema = z.object({ server: z.string(), tool: z.string().optional(), resource: z.string().optional(), args: z.record(z.string(), z.unknown()).optional(),
  every: z.number().min(10).max(86_400).optional() }) // keep it fresh: a resource on its server's word where it can say so, else read again every so many seconds
  .refine(s => (s.tool === undefined) !== (s.resource === undefined), 'a source reads a tool or a resource: one of "tool" and "resource"');
const AskSchema = z.object({ fields: z.record(z.string(), FieldSchema).optional(), capture: z.enum(['photo', 'video', 'audio', 'file', 'signature']).optional(),
  min: z.number().int().min(0).optional(), max: z.number().int().min(1).optional(), about: z.string().optional() });
const SlotSchema = z.looseObject({
  title: z.string(), block: z.string(), of: z.array(z.string()).optional(), needs: z.string().optional(), required: z.boolean().optional(),
  source: SourceSchema.optional(), by: z.enum(['model', 'person']).optional(), ask: AskSchema.optional(),
  // oxlint-disable-next-line unicorn/no-thenable -- a slot's then (what follows its fill) holds an object, never a function: nothing awaits it as a promise
  then: z.object({ by: z.literal('person'), approve: z.number().int().min(1).optional(), edit: z.boolean().optional() }).optional(),
  suggestions: z.array(z.object({ label: z.string(), prompt: z.string() })).optional(),
});
export const TemplateSchema = z.object({
  name: z.string().min(1), about: z.string().optional(), version: z.number().int().optional(),
  inputs: z.record(z.string(), FieldSchema).optional(),
  slots: z.record(z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'a slot\'s name: lowercase, digits and dashes'), SlotSchema),
  layout: z.unknown().optional(), compact: z.array(z.string()).optional(), operations: z.array(z.string()).optional(),
});
export type Template = z.infer<typeof TemplateSchema>;
export type Slot = z.infer<typeof SlotSchema>;
/** The keys that say what a slot is; every other key of a slot is a panel option it fixes (columns, sort, group, …). */
const SLOT_KEYS = new Set(['title', 'block', 'of', 'needs', 'required', 'source', 'by', 'ask', 'then', 'suggestions']);
const KINDS = ['free', 'choose', 'page', 'app'];
export const fixedOf = (slot: Slot): Record<string, unknown> => Object.fromEntries(Object.entries(slot).filter(([k]) => !SLOT_KEYS.has(k)));

/** Check a template against this window: blocks it offers, operations it has, and sources that only read. */
export function checkTemplate(raw: unknown, o: { cards: Set<string>; operations: string[]; isRead?: (server: string, tool: string) => boolean | undefined }): { template?: Template; problems: string[]; notes: string[] } {
  const parsed = TemplateSchema.safeParse(raw);
  if (!parsed.success) return { problems: parsed.error.issues.map(i => `${i.path.join('.') || 'template'}: ${i.message}`), notes: [] };
  const t = parsed.data; const problems: string[] = []; const notes: string[] = [];
  const names = Object.keys(t.slots);
  if (!names.length) problems.push('a template needs at least one slot');
  for (const [name, s] of Object.entries(t.slots)) {
    if (!o.cards.has(s.block) && !KINDS.includes(s.block)) problems.push(`slot ${name}: no block "${s.block}" here; blocks: ${[...o.cards].join(', ')}, or ${KINDS.join(', ')}`);
    if (s.block === 'choose' && !s.of?.length) problems.push(`slot ${name}: "choose" needs "of": the blocks to choose from`);
    for (const b of s.of ?? []) if (!o.cards.has(b)) problems.push(`slot ${name}: no block "${b}" to choose`);
    if (s.source?.tool !== undefined) {
      const read = o.isRead?.(s.source.server, s.source.tool);
      if (read !== true) problems.push(`slot ${name}: its source ${s.source.server}.${s.source.tool} ${read === false ? 'can change things; a source may only read' : 'is not known to only read (its server does not say so); a source may only read'}`);
    }
    if (s.source?.resource !== undefined) for (const m of s.source.resource.matchAll(/\$([A-Za-z_]\w*)/g)) if (!(t.inputs && m[1] in t.inputs)) problems.push(`slot ${name}: $${m[1]} is no input of this template`);
    if (s.source) {
      for (const v of Object.values(s.source.args ?? {})) if (typeof v === 'string' && v.startsWith('$') && !(t.inputs && v.slice(1) in t.inputs)) problems.push(`slot ${name}: ${v} is no input of this template`);
    }
    if (s.by === 'person' && !s.ask) problems.push(`slot ${name}: the person fills it, so it needs "ask": fields, or a capture`);
    if (s.by === 'person' && s.source) problems.push(`slot ${name}: a source or the person fills it, not both`);
  }
  const inLayout = layoutNames(t.layout);
  for (const n of inLayout) if (!names.includes(n)) problems.push(`layout: no slot "${n}"`);
  for (const n of t.compact ?? []) if (!names.includes(n)) problems.push(`compact: no slot "${n}"`);
  for (const op of t.operations ?? []) if (!o.operations.includes(op)) notes.push(`operation ${op} is not in this window: it shows as not available`);
  return { ...(problems.length ? {} : { template: t }), problems, notes };
}
/** The view names a layout uses (rows, columns, {view, size}, {slot, size}, {column: […]}). */
export function layoutNames(l: unknown): string[] {
  const out: string[] = [];
  const walk = (x: unknown) => {
    if (typeof x === 'string') out.push(x);
    else if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === 'object') { const o = x as Record<string, unknown>; if (typeof o.view === 'string') out.push(o.view); if (typeof o.slot === 'string') out.push(o.slot); for (const k of ['row', 'column', 'children']) if (o[k]) walk(o[k]); }
  };
  walk(l); return out;
}
/** A template's layout, with "slot" read as "view" (the shell lays out views; a slot's view has its name). */
export const asViewLayout = (l: unknown): unknown => JSON.parse(JSON.stringify(l ?? null), (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) && typeof v.slot === 'string' ? { ...v, view: v.slot, slot: undefined } : v));

/** "$name" values replaced by the inputs' values, everywhere in a source's arguments. */
export function withInputs<T>(v: T, inputs: Record<string, unknown>): T {
  return JSON.parse(JSON.stringify(v), (_k, x) => (typeof x === 'string' && /^\$[A-Za-z_]\w*$/.test(x) && x.slice(1) in inputs ? inputs[x.slice(1)] : x));
}
/** A resource's address with "$name" replaced by the inputs' values, each as a part of an address. */
export const uriWith = (uri: string, inputs: Record<string, unknown>): string => uri.replace(/\$([A-Za-z_]\w*)/g, (m, k: string) => (k in inputs ? encodeURIComponent(String(inputs[k])) : m));
/** What a source reads, in words. */
export const sourceName = (s: NonNullable<Slot['source']>): string => (s.resource !== undefined ? `${s.server} ${s.resource}` : `${s.server}.${s.tool}`);

/** What the model sent for a slot, made to fit it: the slot's block, its fixed options, its name and title. */
export function fitSlot(name: string, slot: Slot, args: Record<string, unknown>): { args: Record<string, unknown>; notes: string[] } | { refusal: string } {
  const notes: string[] = [];
  const panels = (args.panels as Record<string, unknown>[] | undefined) ?? [];
  if (args.browser) return { refusal: `slot ${name} is ${slot.block === 'free' ? 'free, but a browser page is a view of its own' : `a ${slot.block}`}; a browser page is not a slot` };
  if (slot.by === 'person') return { refusal: `the person fills slot ${name} (${slot.title}); it is not yours to fill` };
  if (slot.block === 'free') return { args: { ...args, name, title: slot.title }, notes };
  if (args.tabs) return { refusal: `slot ${name} takes one ${slot.block === 'choose' ? `of ${slot.of!.join(', ')}` : slot.block} panel, not tabs` };
  if (panels.length !== 1) return { refusal: `slot ${name} takes one ${slot.block === 'choose' ? `panel: one of ${slot.of!.join(', ')}` : `${slot.block} panel`}, not ${panels.length}` };
  const p = { ...panels[0] };
  const allowed = slot.block === 'choose' ? slot.of! : [slot.block];
  if (p.card === undefined) p.card = allowed[0];
  if (!allowed.includes(asText(p.card))) return { refusal: `slot ${name} takes ${allowed.length > 1 ? `one of ${allowed.join(', ')}` : allowed[0]}, not ${asText(p.card)}` };
  const fixed = fixedOf(slot);
  const changed = Object.keys(fixed).filter(k => p[k] !== undefined && JSON.stringify(p[k]) !== JSON.stringify(fixed[k]));
  if (changed.length) notes.push(`slot ${name} fixes ${changed.join(', ')}: the template's values were used`);
  return { args: { ...args, name, title: slot.title, panels: [{ ...p, ...fixed }] }, notes };
}

/** A read of a slot's source, as the one panel that fills it: the slot's block (the first it may choose, or a table where
 *  it is free), made to fit it. */
export const fitRead = (name: string, slot: Slot, id: string) => fitSlot(name, { ...slot, source: undefined },
  { panels: [{ id: name, card: readCard(slot), from: id }] });
/** The card a read fills a slot with: the first it may choose, a table where it is free, or its own block. */
function readCard(slot: Slot) {
  if (slot.block === 'choose') return slot.of![0];
  return slot.block === 'free' ? 'table' : slot.block;
}

/** A slot not filled yet: what it needs, and who fills it. */
export function waitingPanel(slot: Slot, why?: string): Record<string, unknown> {
  let who = slot.by === 'person' ? 'the person fills it' : 'the model fills it';
  if (slot.source) who = `filled from ${sourceName(slot.source)}`;
  return { id: 'waiting', card: 'text', text: `${why ?? 'Not filled yet'}. ${slot.needs ? `Needs: ${slot.needs}. ` : ''}${who[0].toUpperCase()}${who.slice(1)}.` };
}

/** A slot's state, as the model is told it: what fills it now, that the person fills it, or what it needs. */
function slotState(s: Slot, filled: string | undefined): string {
  if (filled) return `: ${filled}`;
  if (s.by === 'person') return ': the person fills it';
  return s.needs ? `: ${s.needs}` : '';
}
/** What the model is told when a static view starts: the template, its slots, and what it may do. */
export function templateNote(t: Template, filled: Record<string, string>): string {
  const slots = Object.entries(t.slots).map(([n, s]) => `${n} (${s.block === 'choose' ? `one of ${s.of!.join(', ')}` : s.block})${slotState(s, filled[n])}`);
  return ` This task uses the static view "${t.name}". Fill each slot with show_view and "slot": ${slots.join('; ')}. You can't add, move or restyle panes, and arrange is not offered; the template's options in a slot are fixed. If something doesn't fit, say so in the chat: the person may let you change the view.`;
}

/** A template from the view as it is now: each view of cards a slot (one panel: its block and the options it sets, fixed;
 *  several, or one in a frame of its own, such as a page: free), and where a panel read a result a source could read
 *  again, that read as the slot's source. cards: the cards offered besides the built-in ones (Vindu's blocks by default). */
/** A view's name as a slot's: lowercase letters, digits and dashes, none at either end; "slot" when nothing is left.
 *  The ends are trimmed by counting, not by a pattern: /-+$/ retries every dash of a long run. */
export function slotName(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  let start = 0, end = s.length;
  while (start < end && s[start] === '-') start++;
  while (end > start && s[end - 1] === '-') end--;
  return s.slice(start, end) || 'slot';
}

export function pinTemplate(o: { name: string; about?: string; views: { name: string; title: string; args: Record<string, unknown> }[]; layout: unknown;
  resultOf: (id: string) => { server: string; tool: string; input?: unknown } | undefined; isRead?: (server: string, tool: string) => boolean | undefined;
  cards?: readonly CardDef[] }): { template: Template; notes: string[] } {
  const slots: Record<string, Slot> = {}; const notes: string[] = [];
  const cards = o.cards ?? BLOCKS; const KEEP = [...fieldRoles(cards).options];
  const byName = new Map(cards.map(c => [c.name, c]));
  for (const v of o.views) {
    const name = slotName(v.name);
    const panels = (v.args.panels as Row[] | undefined) ?? [];
    if (v.args.tabs || panels.length !== 1 || kindOf(String(panels[0].card), byName)?.framed) { slots[name] = { title: v.title, block: 'free', needs: `what "${v.title}" showed: ${panels.map(p => p.card).join(', ') || 'tabs'}` }; continue; }
    const p = panels[0]; const fixed = Object.fromEntries(KEEP.filter(k => p[k] !== undefined).map(k => [k, p[k]]));
    const slot: Slot = { title: v.title, block: String(p.card), ...fixed };
    const r = typeof p.from === 'string' ? o.resultOf(p.from) : undefined;
    const uri = r?.tool === 'resources/read' && r.input && typeof (r.input as { uri?: unknown }).uri === 'string' ? (r.input as { uri: string }).uri : undefined;
    if (r && uri) slot.source = { server: r.server, resource: uri }; // a resource only reads
    else if (r && o.isRead?.(r.server, r.tool) === true) slot.source = { server: r.server, tool: r.tool, ...(r.input && typeof r.input === 'object' ? { args: r.input as Record<string, unknown> } : {}) };
    else { slot.needs = `what "${v.title}" showed${r ? ` (from ${r.server}.${r.tool}, which is not known to only read, so the model fills it)` : ''}`; if (r) notes.push(`${name}: ${r.server}.${r.tool} is not known to only read, so the model fills it each time`); }
    slots[name] = slot;
  }
  const rename = new Map(o.views.map(v => [v.name, slotName(v.name)]));
  const layout = JSON.parse(JSON.stringify(o.layout ?? null), (_k, x) => (typeof x === 'string' && rename.has(x) ? rename.get(x) : x));
  return { template: { name: o.name, ...(o.about ? { about: o.about } : {}), version: 1, slots, layout, compact: Object.keys(slots) }, notes };
}
