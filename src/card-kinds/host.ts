// A card a host adds, and each of Vindu's blocks (blocks.ts): its rows resolved as for any card, its own shaping and
// checks, and the rows, exact, bound to the component the host's renderer registers.
import { MAX_ROWS, PANEL_FIELDS, type CardDef, type PanelSpec, type Resolved } from '../cards.js';
import { pointerStep } from '../results.js';
import type { CardKind } from './kind.js';

export function hostKind(def: CardDef): CardKind {
  const props = (p: PanelSpec, d: Resolved) => (def.props || d.shaped?.props ? { ...def.props?.(p), ...d.shaped?.props } : undefined);
  return {
    reads: [...PANEL_FIELDS, ...Object.keys(def.fields ?? {})], // a host's card may read any shared field, besides its own
    ...(def.one ? { one: true } : {}), ...(def.rows ? { rows: def.rows } : {}), ...(def.source ? { source: def.source } : {}),
    check: (p, d) => (d.rows && def.check ? def.check(d.rows, p, d.shaped) : null),
    props,
    draw: (p, d, k) => {
      k.model.rows = d.rows!.slice(0, MAX_ROWS);
      // A2UI takes plain values as they are and anything else bound by path: a block's maps and lists go in the data model
      const bound = Object.fromEntries(Object.entries(props(p, d) ?? {}).map(([name, v]) => {
        if (v === null || typeof v !== 'object') return [name, v];
        const held = (k.model.props ??= {}) as Record<string, unknown>; held[name] = v; return [name, { path: `/panels/${k.pid}/props${pointerStep(name)}` }];
      }));
      return [k.add({ id: `${k.pid}__custom`, component: def.component, rows: { path: `/panels/${k.pid}/rows` }, ...(def.context ? { locale: k.locale, timeZone: k.timeZone, panel: p.id } : {}), ...bound })];
    },
    account: (o, p, d) => { o.rows = d.rows!.length; if (d.rows!.length > MAX_ROWS) o.shown_rows = MAX_ROWS; Object.assign(o, def.account?.(d.rows!, p), d.shaped?.account); },
    ...(def.presentFields ? { presentFields: (rows, p, d) => def.presentFields!(rows, p, props(p, d) ?? {}) } : {}),
    ...(def.suggest ? { suggest: def.suggest } : {}),
  };
}
