// Actions inside a view, the same for the person and the model: sort a panel, show only some of its rows or all again,
// move a row or put the rows in an order, go to a slide, undo. Each changes how a view shows what it shows, never what it
// shows: the rows stay exactly what their result says. An order set by hand is the view's own, "not saved", until an
// operation that saves it is run, which asks the person as any operation does. The server keeps who did what, marks
// the model's changes in the window with an undo, and tells the model what the person changed (server.ts).
import { BLOCKS } from './blocks.js';
import { panelIdsOf, pidFor, rowFields, sourceRow, type CardDef, type Resolved } from './cards.js';
import { quoted as said, rowAt, rowKey, rowLabel as label } from './row-keys.js';
import { asText } from './format.js';

type Json = Record<string, unknown>;
type Row = Record<string, unknown>;
export const ACTIONS = ['sort', 'filter', 'clear', 'move', 'order', 'slide', 'plan', 'select', 'undo'] as const;
/** The actions every view of cards takes; the others are the actions of the cards that take them (CardDef.actions). */
export const VIEW_ACTIONS: readonly ViewAction['action'][] = [
  'sort',
  'filter',
  'clear',
  'move',
  'order',
  'select',
  'undo',
];
export type ViewAction = {
  action: (typeof ACTIONS)[number];
  panel?: string;
  field?: string;
  dir?: 'asc' | 'desc';
  value?: unknown;
  key?: string | number;
  from?: number;
  to?: number;
  keys?: (string | number)[];
  start?: string;
  end?: string; // plan: an event's new start, and end (by default it keeps its length)
};
export type Applied = { args: Json; what: string; panel: string; mark: string };
const BLOCK_CARDS: ReadonlyMap<string, CardDef> = new Map(BLOCKS.map((b) => [b.name, b]));

/** The view's arguments with the action applied, and what it did, in words for the person and the model; or why not.
 *  An action only some cards take is the panel's card's own (cards: those offered; Vindu's blocks by default). */
export function applyAction(
  args: Json,
  data: Record<string, Resolved> | undefined,
  a: ViewAction,
  title: string,
  cards: ReadonlyMap<string, CardDef> = BLOCK_CARDS,
): Applied | { refusal: string } {
  const next = structuredClone(args);
  const tabs = (Array.isArray(next.tabs) ? next.tabs : []) as { panels?: unknown }[];
  const panels = [
    ...(Array.isArray(next.panels) ? next.panels : []),
    ...tabs.flatMap((t) => (Array.isArray(t?.panels) ? t.panels : [])),
  ] as Json[]; // a page's, or each tab's
  const ids = panelIdsOf(panels),
    idOf = (x: Json) => ids[panels.indexOf(x)]; // as show_view gave them: what its data and the window name
  const withRows = panels.filter((p) => typeof p.from === 'string' || p.data !== undefined);
  let p: Json | undefined; // a window names a panel by its id, or by its components' (p_…); one with rows needs no name
  if (a.panel !== undefined)
    p = panels.find((x) => idOf(x) === a.panel || x.id === a.panel || pidFor(idOf(x)) === a.panel);
  else if (withRows.length === 1) p = withRows[0];
  if (!p)
    return {
      refusal:
        a.panel !== undefined
          ? `"${title}" has no panel "${a.panel}"; its panels: ${ids.join(', ')}`
          : `say which panel of "${title}": ${withRows.map(idOf).join(', ') || 'it has none with rows'}`,
    };
  const pid = idOf(p);
  const rows = (data?.[pid]?.rows ?? []) as Row[];
  const fields = rowFields(rows);
  const where = `${title}${panels.length > 1 ? ` (${pid})` : ''}`;
  const needField = (): string | undefined => {
    if (!a.field) return `${a.action} needs a field: ${fields.join(', ')}`;
    return fields.length && !fields.includes(a.field)
      ? `"${a.field}" is not a field of ${where}; its fields: ${fields.join(', ')}`
      : undefined;
  };
  switch (a.action) {
    case 'sort': {
      const bad = needField();
      if (bad) return { refusal: bad };
      const [was, wasDir] = asText(p.sort ?? '').split(/\s+/);
      const dir = a.dir ?? (was === a.field && !/desc/i.test(wasDir ?? '') ? 'desc' : 'asc'); // the same field again turns it round
      p.sort = `${a.field} ${dir}`;
      delete p.ordered; // a sort replaces an order set by hand
      const how = dir === 'desc' ? 'largest or latest first' : 'smallest or earliest first';
      return {
        args: next,
        panel: pid,
        what: `sorted ${where} by ${a.field}, ${how}`,
        mark: `Sorted by ${a.field}, ${how}`,
      };
    }
    case 'filter': {
      const bad = needField();
      if (bad) return { refusal: bad };
      if (a.value === undefined) return { refusal: `filter needs the value to keep; to show all rows again, clear` };
      const values = new Set(rows.map((r) => asText(r[a.field!])));
      // checked against the rows shown: all of them, or those other filters keep (a value of the field filtered by is not)
      const filtered = !!p.where && Object.hasOwn(p.where, a.field!);
      if (rows.length && !filtered && !values.has(asText(a.value)))
        return {
          refusal: `no row of ${where} has ${a.field} ${said(a.value)}; its values: ${[...values].slice(0, 12).join(', ')}`,
        };
      p.where = { ...((p.where ?? {}) as Json), [a.field!]: a.value };
      return {
        args: next,
        panel: pid,
        what: `showed only the rows of ${where} where ${a.field} is ${said(a.value)}`,
        mark: `Only ${a.field} ${said(a.value)}`,
      };
    }
    case 'clear': {
      const w = { ...((p.where ?? {}) as Json) };
      if (a.field) {
        if (!Object.hasOwn(w, a.field)) return { refusal: `${where} is not filtered by ${a.field}` };
        delete w[a.field];
      } else if (!Object.keys(w).length && !p.ordered && !p.sort && !p.planned)
        return { refusal: `${where} has no filter, sort, order or plan to clear` };
      if (Object.keys(w).length && a.field) p.where = w;
      else delete p.where;
      if (!a.field) {
        delete p.ordered;
        delete p.sort;
        delete p.planned;
      }
      return {
        args: next,
        panel: pid,
        what: a.field
          ? `showed every ${a.field} of ${where} again`
          : `showed ${where} as it came: no filter, sort or order`,
        mark: a.field ? `Every ${a.field} again` : 'As it came',
      };
    }
    case 'move': {
      if (!rows.length) return { refusal: `${where} has no rows to move` };
      const found = rowAt(rows, a, 'row', where);
      if ('refusal' in found) return found;
      const { at: from, keys } = found;
      if (a.to === undefined || !Number.isInteger(a.to))
        return { refusal: 'move needs to: the place the row goes to, from 0' };
      const to = Math.max(0, Math.min(rows.length - 1, a.to));
      if (to === from) return { refusal: `${label(rows[from], keys[from])} is at place ${to + 1} already` };
      const order = [...keys];
      const [k] = order.splice(from, 1);
      order.splice(to, 0, k);
      p.ordered = order;
      return {
        args: next,
        panel: pid,
        what: `moved ${label(rows[from], keys[from])} to place ${to + 1} of ${rows.length} in ${where} (an order set by hand, not saved)`,
        mark: 'Order set by hand, not saved',
      };
    }
    case 'order': {
      if (!Array.isArray(a.keys) || !a.keys.length)
        return { refusal: "order needs keys: the rows' keys in the order to show them" };
      const known = new Set(rows.map(rowKey(rows)));
      const unknown = a.keys.map(String).filter((k) => !known.has(k));
      if (unknown.length)
        return {
          refusal: `${where} has no rows ${unknown.slice(0, 8).join(', ')}; its keys: ${[...known].slice(0, 12).join(', ')}`,
        };
      p.ordered = a.keys.map(String);
      delete p.sort;
      return {
        args: next,
        panel: pid,
        what: `put ${a.keys.length} rows of ${where} in a new order (set by hand, not saved)`,
        mark: 'Order set by hand, not saved',
      };
    }
    case 'select': {
      const followers = panels.filter((x) => (x.detail as { of?: unknown } | undefined)?.of === pid);
      if (!followers.length)
        return {
          refusal: `no panel of ${where} follows what is picked in it: give a panel detail: { "of": "${pid}" }`,
        };
      const found = rowAt(rows.map(sourceRow), a, 'row', where);
      if ('refusal' in found) return found;
      const { at, keys } = found;
      if (asText(p.selected ?? '') === keys[at])
        return { refusal: `${label(rows[at], keys[at])} is picked in ${where} already` };
      p.selected = keys[at];
      return {
        args: next,
        panel: pid,
        what: `picked ${label(rows[at], keys[at])} in ${where}, which ${followers.map((x) => String(x.title ?? x.id)).join(' and ')} ${followers.length > 1 ? 'follow' : 'follows'}`,
        mark: '',
      };
    }
    default: {
      // an action of the cards that take it: a calendar's plan, a deck's slide
      const takers = [...cards.values()].filter((c) => c.actions?.[a.action]);
      if (VIEW_ACTIONS.includes(a.action) || !takers.length)
        return { refusal: `no action "${String(a.action)}"; the actions: ${ACTIONS.join(', ')}` };
      const own = cards.get(String(p.card))?.actions?.[a.action];
      if (!own) {
        const about = takers[0].actions![a.action].about;
        return { refusal: `${where} is not ${takers.map((c) => c.name).join(' or ')}${about ? `: ${about}` : ''}` };
      }
      const r = own.run(p, rows, a, where);
      return 'refusal' in r ? r : { args: next, panel: pid, ...r };
    }
  }
}
