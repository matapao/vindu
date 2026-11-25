// The making of a block (blocks.ts): its roles (which field plays which part, from the model's map or by their usual
// names), the layouts it has, and what it works out from its rows, given to its component and its account and never
// kept on the panel.
import { z } from 'zod';
import { panelOption, rowFields, type CardAction, type CardDef, type PanelSpec, type Shaped } from './cards.js';
import type { DraftContext } from './block-drafts.js';
import type { Entry, Row } from './results.js';
import { asText } from './format.js';

export type Roles = Record<string, RegExp>;

/** Which field plays each role: the model's map first, then the usual names. */
export function rolesOf(rows: Row[], p: PanelSpec, roles: Roles): Record<string, string> {
  const fields = rowFields(rows); const given = givenMap(p); const out: Record<string, string> = {}; const used = new Set<string>();
  for (const [role, f] of Object.entries(given)) if (role in roles && fields.includes(f)) { out[role] = f; used.add(f); }
  for (const [role, re] of Object.entries(roles)) { if (out[role]) continue; const f = fields.find(x => !used.has(x) && re.test(x)); if (f) { out[role] = f; used.add(f); } }
  return out;
}
/** The map as the model sent it. */
const givenMap = (p: PanelSpec): Record<string, string> => (p.map ?? {}) as Record<string, string>;
const unknownRoles = (p: PanelSpec, roles: Roles, rows: Row[], fieldsFrom?: Row[]): string | null => {
  const given = givenMap(p); const fields = rowFields(fieldsFrom ?? rows);
  const bad = Object.entries(given).filter(([r, f]) => !(r in roles) || !fields.includes(f));
  return bad.length ? `map: ${bad.map(([r, f]) => (!(r in roles) ? `no role "${r}" here (roles: ${Object.keys(roles).join(', ')})` : `no field "${f}" for ${r}`)).join('; ')}; fields: ${fields.slice(0, 15).join(', ')}` : null;
};
export const needOne = (map: Record<string, string>, roles: string[], what: string, rows: Row[]) =>
  roles.some(r => map[r]) ? null : `${what} needs ${roles.length > 1 ? `one of ${roles.join(', ')}` : roles[0]}; fields here: ${rowFields(rows).slice(0, 15).join(', ')}; say which with map, e.g. {"${roles[0]}": "…"}`;

const MAP = z.record(z.string(), z.string()).optional();
/** A block: its roles and layouts, and what it works out from its rows (props for its component, what its account adds,
 *  the rows its check reads), given the roles found (map). Nothing it works out is kept on the panel. */
type Spec = { name: string; about: string; component: string; roles: Roles; layouts?: string[]; fields?: Record<string, z.ZodType>; one?: boolean; cells?: CardDef['cells'];
  check?: (rows: Row[], p: PanelSpec, map: Record<string, string>) => string | null;
  rows?: (rows: Row[], p: PanelSpec, map: Record<string, string>, read: (id: string) => Entry | undefined, inputs?: Record<string, number>, draft?: DraftContext, timeZone?: string) => Row[] | Shaped;
  source?: CardDef['source'];
  file?: CardDef['file'];                            // files it shows as they are (a document's Markdown)
  props?: (p: PanelSpec) => Record<string, unknown>; // fixed props for its component
  account?: (rows: Row[], p: PanelSpec, map: Record<string, string>, props: Record<string, unknown>) => Record<string, unknown>;
  derived?: string[];                                // fields of each row it works out itself, which a host's drawing gets too
  allFields?: (p: PanelSpec) => boolean;             // a host's drawing gets every field of each row, not only its roles'
  actions?: Record<string, CardAction>; suggest?: CardDef['suggest']; words?: CardDef['words'] };
export function block(o: Spec): CardDef {
  const badLayout = (p: PanelSpec) => !!(o.layouts && p.layout && !o.layouts.includes(asText(p.layout)));
  const fixed = (p: PanelSpec) => ({ map: p.map ?? {}, layout: p.layout ?? '', ...o.props?.(p) });
  return {
    name: o.name, component: o.component, context: true, ...(o.one ? { one: true } : {}), ...(o.cells ? { cells: o.cells } : {}),
    about: `${o.about}${Object.keys(o.roles).length ? `; roles: ${Object.keys(o.roles).join(', ')}` : ''}${o.layouts ? `; layout: ${o.layouts.join(' | ')}` : ''}`,
    fields: { map: panelOption(MAP.describe('blocks: which of the rows\' fields plays each role, e.g. {"from": "sender"}; roles left out are found by their usual names')),
      layout: panelOption(z.string().optional().describe('blocks: how it is drawn; each block lists its layouts')), ...o.fields },
    shows: () => [], // a block checks its own roles: a role may hold a list (recipients) or an object (a shape)
    check: (rows, p, shaped) => {
      if (badLayout(p)) return `${o.name} has no layout "${asText(p.layout)}"; layouts: ${o.layouts!.join(', ')}`;
      const given = shaped?.checkRows; // a block that made its own rows (free time) is checked against the rows it was given
      return unknownRoles(p, o.roles, rows, given) ?? o.check?.(given ?? rows, p, rolesOf(given ?? rows, p, o.roles)) ?? null;
    },
    rows: (rows, p, read, context) => {
      if (badLayout(p)) return rows; // the check says so
      const map = rolesOf(rows, p, o.roles);
      const made = o.rows?.(rows, p, map, read, context?.inputs, context?.draft, context?.timeZone) ?? rows;
      const { rows: out, props: worked, account: more, checkRows } = Array.isArray(made) ? { rows: made } as Shaped : made;
      const props = { ...fixed(p), map, ...o.props?.(p), ...worked };
      const account = { roles: map, ...(props.layout ? { layout: props.layout } : {}), ...o.account?.(out, p, map, props), ...more };
      return { rows: out, props, account, ...(checkRows ? { checkRows } : {}) };
    },
    ...(o.source ? { source: o.source } : {}), ...(o.file ? { file: o.file } : {}),
    props: fixed,
    presentFields: (rows, p, props) => (o.allFields?.(p)
      ? [...new Set(rows.flatMap(row => Object.keys(row).filter(key => !key.startsWith('__'))))]
      : [...new Set([...Object.values((props.map ?? {}) as Record<string, string>), ...(o.derived ?? [])])]),
    ...(o.actions ? { actions: o.actions } : {}), ...(o.suggest ? { suggest: o.suggest } : {}), ...(o.words ? { words: o.words } : {}),
  };
}
