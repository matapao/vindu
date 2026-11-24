// Vindu's blocks: the kinds of thing people work with that a table or a record shows poorly, as cards of Vindu's own,
// each drawn by a Vindu renderer component (renderer/blocks.ts). They take rows exactly as any card does (from,
// pick, where, compute, group, sort, limit), and a block's roles say which field plays which part ("from" in a message,
// "start" in an event). The model names a role's field with map, or Vindu finds it by its usual names. What a block
// works out itself (an invoice's total, free time between meetings, what changed between two versions, where a place
// or a node is drawn) is computed by the system, and its account says so. A host offers all of them by default, some
// (blocks: [names]), or none (blocks: false); the model is told only of those offered.
import { z } from 'zod';
import { block, needOne, type Roles } from './block-kit.js';
import { EVENTS } from './block-events.js';
import { countIds, panelOption, resultIds, resultRef, rowFields, type CardDef } from './cards.js';
import { changedFields } from './changes.js';
import { addFields, num, parse as parseExpr, setValue } from './compute.js';
import { MARKDOWN_FILE, isMarkdownSection, markdownAccount } from './markdown-document.js';
import type { Row } from './results.js';
import { asText } from './format.js';

const T = /^(time|date|sent|received|at|timestamp|created|when|datetime)$/i;
export const MESSAGE = block({
  name: 'message', component: 'VMessages', about: 'mail, chat or SMS: one message, a thread, or an inbox', one: true,
  roles: { from: /^(from|sender|author|by|user)$/i, to: /^(to|recipients?)$/i, cc: /^cc$/i, subject: /^(subject|title|topic)$/i,
    body: /^(body|text|content|message|preview|snippet|html)$/i, time: T, attachments: /^attach/i, thread: /^(thread|conversation|thread_?id)$/i, state: /^(state|status|read|unread|flags?)$/i },
  layouts: ['one', 'thread', 'inbox'],
  check: (rows, _p, m) => needOne(m, ['subject', 'body'], 'a message', rows),
  rows: (rows, p, m) => {
    const layout = asText(p.layout || (rows.length === 1 ? 'one' : m.thread && new Set(rows.map(r => String(r[m.thread]))).size === 1 ? 'thread' : 'inbox'));
    return { rows: layout === 'thread' && m.time ? [...rows].sort((a, b) => String(a[m.time]).localeCompare(String(b[m.time]))) : rows, props: { layout } };
  },
  account: (rows, _p, _m, props) => ({ messages: rows.length, shows: props.layout === 'inbox' ? 'from, subject and time of each, newest as given' : props.layout === 'thread' ? 'each message in time order, with its body' : 'the whole message' }),
});

// ── documents: sections with anchors to cite; what changed since an earlier version, as tracked changes; or a Markdown
// file, read and parsed by the system into sections of headings, paragraphs, lists, quotes, code and tables (markdown.ts)
const words = (t: string) => t.split(/(\s+|[.,;:!?()«»"“”])/).filter(x => x !== ''); // words, spaces and punctuation, each a token
/** Word by word, what changed: kept, inserted, deleted (the longest common subsequence, by the system). */
export function wordDiff(a: string, b: string): { op: '=' | '+' | '-'; t: string }[] {
  const x = words(a), y = words(b);
  if (x.length * y.length > 4_000_000) return [{ op: '-', t: a }, { op: '+', t: b }]; // too long to compare word by word
  const n = x.length, m = y.length; const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: { op: '=' | '+' | '-'; t: string }[] = []; const push = (op: '=' | '+' | '-', t: string) => { const last = out[out.length - 1]; if (last?.op === op) last.t += t; else out.push({ op, t }); };
  let i = 0, j = 0;
  while (i < n && j < m) { if (x[i] === y[j]) { push('=', x[i]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) push('-', x[i++]); else push('+', y[j++]); }
  while (i < n) push('-', x[i++]); while (j < m) push('+', y[j++]);
  return out;
}
const DOC: Roles = { anchor: /^(anchor|id|section|clause|ref|no|number|paragraph)$/i, heading: /^(heading|title|caption|name)$/i, text: /^(text|body|content|paragraph_?text|value)$/i, level: /^(level|depth)$/i, page: /^(page|p)$/i, sources: /^(sources?|cites?|citations?|refs)$/i };
export const DOCUMENT = block({
  name: 'document', component: 'VDocument', about: 'a document as sections or paragraphs, each with an anchor to cite (§ 4.2, page 3); with before: an earlier version\'s result id, what changed is shown as tracked changes. Or a Markdown file as it is, read and drawn by the system (headings, lists, code, tables, links), up to 512,000 bytes: from an attachment (a1), or path: a .md file in the working folder',
  roles: DOC, file: MARKDOWN_FILE,
  fields: { before: resultRef(z.string().optional().describe('document: an earlier version (a result id with the same sections): what changed is computed word by word and shown as tracked changes')) },
  check: (rows, _p, m) => (rows.some(isMarkdownSection) ? null : needOne(m, ['text'], 'a document', rows)), derived: ['__changes', '__new', '__gone', '__heading', '__blocks'],
  rows: (rows, p, m, read) => {
    if (!p.before) return rows;
    const before = asText(p.before), e = read(before);
    if (!e || e.kind !== 'result') throw new Error(`before: no result "${before}"`);
    const old = (e.rows ?? (Array.isArray(e.value) ? e.value : [])) as Row[];
    const key = (r: Row, i: number) => (m.anchor ? asText(r[m.anchor] ?? i) : String(i));
    const was = new Map(old.map((r, i) => [key(r, i), asText(r[m.text] ?? r.text ?? '')]));
    const out: Row[] = rows.map((r, i) => { const k = key(r, i); const now = asText(r[m.text] ?? ''); const then = was.get(k); was.delete(k);
      return { ...r, __changes: then === undefined ? [{ op: '+', t: now }] : then === now ? [{ op: '=', t: now }] : wordDiff(then, now), __new: then === undefined }; });
    for (const [k, t] of was) out.push({ ...(m.anchor ? { [m.anchor]: k } : {}), [m.text]: '', __changes: [{ op: '-', t }], __gone: true });
    return out;
  },
  account: (rows, p) => {
    if (rows.some(isMarkdownSection)) return markdownAccount(rows);
    if (!p.before) return { sections: rows.length };
    const ops = rows.flatMap(r => (r.__changes as { op: string }[]) ?? []);
    return { sections: rows.length, tracked_changes: `computed by the system, from ${asText(p.before)} to ${p.from ?? 'these rows'}: ${ops.filter(o => o.op === '+').length} insertions, ${ops.filter(o => o.op === '-').length} deletions, ${rows.filter(r => r.__new).length} new sections, ${rows.filter(r => r.__gone).length} removed` };
  },
});

export const TASKS = block({
  name: 'tasks', component: 'VTasks', about: 'tasks: a checklist, a board of columns by state, or steps in order',
  roles: { title: /^(title|name|task|summary|what|step)$/i, state: /^(state|status|done|completed|stage|column)$/i, who: /^(assignee|owner|who|assigned_?to|responsible)$/i,
    due: /^(due|deadline|by|due_?date)$/i, priority: /^(priority|prio|severity)$/i },
  layouts: ['checklist', 'board', 'steps'],
  fields: { order: panelOption(z.array(z.string()).optional().describe('tasks, layout board: the columns (states) in order')) },
  check: (rows, _p, m) => needOne(m, ['title'], 'a task', rows),
  account: (rows, p, m) => ({ tasks: rows.length, ...(m.state ? { by_state: Object.fromEntries(rows.reduce((a, r) => a.set(asText(r[m.state] ?? ''), (a.get(asText(r[m.state] ?? '')) ?? 0) + 1), new Map<string, number>())) } : {}), ...(p.layout === 'board' && p.order ? { columns: p.order } : {}) }),
});

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
});
const q = (f: string) => (/^[A-Za-z_]\w*$/.test(f) ? f : `"${f}"`);

export const FILES = block({
  name: 'files', component: 'VFiles', about: 'files: name, type, size, when changed, who has them',
  roles: { name: /^(name|file_?name|filename|title|path)$/i, type: /^(type|mime|mime_?type|kind|content_?type|extension)$/i, size: /^(size|bytes|length)$/i,
    modified: /^(modified|updated|changed|mtime|last_?modified|date)$/i, owner: /^(owner|author|by|created_?by)$/i, shared: /^(shared|shared_?with|access|permissions)$/i },
  check: (rows, _p, m) => needOne(m, ['name'], 'a file', rows),
  account: rows => ({ files: rows.length }),
});

// ── map: places as points, lines or areas, drawn without map tiles (nothing is fetched from the network for it) ─────
type Geo = { type: string; coordinates: unknown };
const lonlats = (g: Geo): number[][] => { const out: number[][] = []; const walk = (c: unknown) => { if (Array.isArray(c) && typeof c[0] === 'number') out.push(c as number[]); else if (Array.isArray(c)) c.forEach(walk); }; walk(g.coordinates); return out; };
const merc = (lon: number, lat: number) => [lon, (Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * Math.PI) / 360)) * 180) / Math.PI];
export const MAP_BLOCK = block({
  name: 'map', component: 'VMap', about: 'places on a map: points (lat, lon) or shapes (GeoJSON geometry), with labels; drawn by the system without map tiles',
  roles: { lat: /^(lat|latitude)$/i, lon: /^(lon|lng|long|longitude)$/i, geometry: /^(geometry|geojson|shape|area|route|line)$/i, label: /^(label|name|title|address|place|stop)$/i, group: /^(group|category|kind|type|status|truck|vehicle)$/i },
  check: (rows, _p, m) => (m.geometry || (m.lat && m.lon) ? null : `a map needs lat and lon, or a geometry (GeoJSON); fields here: ${rowFields(rows).slice(0, 15).join(', ')}; say which with map`),
  rows: (rows, _p, m) => {
    const shapes = rows.map(r => { const g = m.geometry && r[m.geometry] && typeof r[m.geometry] === 'object' ? r[m.geometry] as Geo : null; return g ? lonlats(g) : num(r[m.lat]) !== null && num(r[m.lon]) !== null ? [[num(r[m.lon])!, num(r[m.lat])!]] : []; });
    const all = shapes.flat().map(([lon, lat]) => merc(lon, lat));
    if (!all.length) throw new Error('no place has numbers for lat and lon, or a geometry');
    const xs = all.map(a => a[0]), ys = all.map(a => a[1]);
    let [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const span = Math.max(x1 - x0, y1 - y0, 0.01); x0 -= span * 0.12; x1 += span * 0.3; y0 -= span * 0.08; y1 += span * 0.08; // room for labels, right of each point
    const W = 640, H = Math.round(Math.min(380, Math.max(220, (W * (y1 - y0)) / Math.max(x1 - x0, 1e-9))));
    const s = Math.min(W / (x1 - x0), H / (y1 - y0)), ox = (W - s * (x1 - x0)) / 2, oy = (H - s * (y1 - y0)) / 2;
    const at = (lon: number, lat: number) => { const [x, y] = merc(lon, lat); return [Math.round((ox + (x - x0) * s) * 10) / 10, Math.round((H - oy - (y - y0) * s) * 10) / 10]; };
    return { rows: rows.map((r, i) => {
      const g = m.geometry && r[m.geometry] && typeof r[m.geometry] === 'object' ? r[m.geometry] as Geo : null;
      const kind = g ? (/Polygon/.test(g.type) ? 'area' : /LineString/.test(g.type) ? 'line' : 'point') : 'point';
      return { ...r, __shape: { kind, points: shapes[i].map(([lon, lat]) => at(lon, lat)) } };
    }), props: { frame: { width: W, height: H, bounds: [x0, y0, x1, y1] } } };
  },
  props: () => ({ frame: { width: 640, height: 320 } }), derived: ['__shape'],
  account: rows => ({ places: rows.length, drawn: 'positions computed by the system (Web Mercator, fitted to the places); no map tiles' }),
});

export const CONTACTS = block({
  name: 'contacts', component: 'VContacts', about: 'people and organizations as contact cards',
  roles: { name: /^(name|full_?name|display_?name|contact)$/i, role: /^(role|title|job_?title|position)$/i, org: /^(org|organi[sz]ation|company|employer|department)$/i,
    email: /^(e_?mail|mail)$/i, phone: /^(phone|mobile|tel|telephone)$/i, address: /^(address|street|location)$/i },
  check: (rows, _p, m) => needOne(m, ['name', 'org'], 'a contact', rows),
  account: rows => ({ contacts: rows.length }),
});

// ── a sheet: rows with formulas per column, inputs, and scenarios side by side, all computed by the system ─────────
export const SHEET = block({
  name: 'sheet', component: 'VSheet', about: 'a spreadsheet model: rows with computed columns (compute), inputs ($name) and scenarios side by side; every computed cell says its formula. Its columns are lettered A, B, … and its rows numbered, row 1 the header. A CSV, TSV or JSON file as rows: from, its attachment id, or path, the file in the working folder; the system reads it, and draws up to 1,000 rows and 200 columns of it. notes: your notes on its cells, by A1 address',
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
  props: () => ({ sheet: {} }), allFields: () => true,
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

// ── a diagram: nodes and links, laid out in layers by the system ─────────────────────────────────────────────────
/** Layers by the longest path from a root, ordered within a layer by their parents' places (a few sweeps). */
export function layered(nodes: string[], links: [string, string][]): Map<string, { layer: number; order: number }> {
  const parents = new Map(nodes.map(n => [n, [] as string[]])); for (const [a, b] of links) if (a !== b) parents.get(b)?.push(a);
  const layer = new Map<string, number>(); const visiting = new Set<string>();
  const depth = (n: string): number => { if (layer.has(n)) return layer.get(n)!; if (visiting.has(n)) return 0; visiting.add(n); const d = Math.max(-1, ...(parents.get(n) ?? []).map(depth)) + 1; visiting.delete(n); layer.set(n, d); return d; };
  nodes.forEach(depth);
  const byLayer: string[][] = []; for (const n of nodes) (byLayer[layer.get(n)!] ??= []).push(n);
  const pos = new Map<string, number>(); byLayer.forEach(l => l.forEach((n, i) => pos.set(n, i)));
  for (let sweep = 0; sweep < 4; sweep++) for (const l of byLayer.slice(1)) {
    const bary = (n: string) => { const ps = parents.get(n)!.filter(x => pos.has(x)); return ps.length ? ps.reduce((a, x) => a + pos.get(x)!, 0) / ps.length : pos.get(n)!; };
    l.sort((a, b) => bary(a) - bary(b)).forEach((n, i) => pos.set(n, i));
  }
  return new Map(nodes.map(n => [n, { layer: layer.get(n)!, order: pos.get(n)! }]));
}
export const DIAGRAM = block({
  name: 'diagram', component: 'VDiagram', about: 'a diagram: links between things (from, to, label), laid out in layers by the system: a flow, a hierarchy, a network',
  roles: { from: /^(from|source|parent|a|sender)$/i, to: /^(to|target|child|b|receiver)$/i, label: /^(label|relation|kind|amount|via)$/i },
  check: (rows, _p, m) => (m.from && m.to ? null : `a diagram needs from and to (one link per row); fields here: ${rowFields(rows).slice(0, 15).join(', ')}`),
  rows: (rows, _p, m) => {
    const nodes = [...new Set(rows.flatMap(r => [String(r[m.from]), String(r[m.to])]))];
    const place = layered(nodes, rows.map(r => [String(r[m.from]), String(r[m.to])]));
    return { rows, props: { nodes: nodes.map(n => ({ id: n, ...place.get(n)! })) } };
  },
  props: () => ({ nodes: [] }),
  account: (rows, _p, _m, props) => ({ links: rows.length, nodes: (props.nodes as unknown[]).length, laid_out: 'by the system, in layers from the first in each chain' }),
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

// ── many at once: a result per call of a batch; a set of changes, each row's before and after ───────────────────
const failed = (v: unknown): string | null => {
  if (!v || typeof v !== 'object') return null;
  const o = v as Row;
  if (o.isError === true || o.ok === false || o.success === false) return asText(o.error ?? o.message ?? 'failed');
  if (typeof o.status === 'string' && /^(fail|error|rejected|bounced)/i.test(o.status)) return asText(o.error ?? o.status);
  if (typeof o.error === 'string' && o.error) return o.error;
  return null;
};
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
      if (!e || e.kind !== 'result') return { id, call: '', outcome: 'missing', detail: `no result ${id}` };
      const input = (e.input && typeof e.input === 'object' ? e.input : {}) as Row;
      const who = ['to', 'recipient', 'email', 'customer', 'order', 'id', 'name'].map(k => input[k]).find(v => v !== undefined && v !== null && typeof v !== 'object');
      const why = failed(e.value ?? e.rows) ?? (/^(error|failed)\b/i.test(e.text) ? e.text.slice(0, 120) : null);
      return { id, call: `${e.server}.${e.tool}`, for: who === undefined ? '' : asText(who), outcome: why ? 'failed' : 'ok', detail: why ?? '' };
    });
  },
  check: rows => (rows.length ? null : 'no calls in this batch'),
  account: rows => ({ calls: rows.length, ok: rows.filter(r => r.outcome === 'ok').length, failed: rows.filter(r => r.outcome === 'failed').map(r => r.id), missing: rows.filter(r => r.outcome === 'missing').map(r => r.id), outcome: 'read by the system from each call\'s own result' }),
});
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

export const BLOCKS: CardDef[] = [MESSAGE, DOCUMENT, EVENTS, TASKS, MONEY_BLOCK, FILES, MAP_BLOCK, CONTACTS, SHEET, SLIDES, SIGNATURE, DIAGRAM, DEVICES, BATCH, CHANGES, DECISION];
