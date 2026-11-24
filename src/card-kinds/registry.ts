// Every card's kind, by name: the built-in cards' own, then a kind for each card a host adds. And the checks a card's
// resolved data must pass before it is shown.
import { rowFields, shownFields, type CardDef, type CardName, type PanelSpec, type Resolved } from '../cards.js';
import { BAR_CHART, LINE_CHART } from './charts.js';
import { APP, CODE, DIFF, MEDIA, PAGE } from './frames.js';
import { hostKind } from './host.js';
import { nested, type CardKind } from './kind.js';
import { LIST, TABLE, TIMELINE } from './rows.js';
import { KPI, RECORD, TEXT } from './values.js';

const BUILT_IN: Record<CardName, CardKind> = {
  kpi: KPI, table: TABLE, list: LIST, record: RECORD, timeline: TIMELINE, 'bar-chart': BAR_CHART, 'line-chart': LINE_CHART,
  media: MEDIA, text: TEXT, page: PAGE, code: CODE, diff: DIFF, app: APP,
};
const hosts = new WeakMap<CardDef, CardKind>();
/** A card's kind: a built-in card's own, or the kind of a card a host added; none for a card there is not. */
export function kindOf(card: string, cards?: ReadonlyMap<string, CardDef>): CardKind | undefined {
  if (Object.hasOwn(BUILT_IN, card)) return BUILT_IN[card as CardName];
  const def = cards?.get(card); if (!def) return undefined;
  let kind = hosts.get(def); if (!kind) hosts.set(def, (kind = hostKind(def)));
  return kind;
}

/** A panel's checks on its resolved data: those every card of rows has, then its card's own. Null when it fits,
 *  otherwise what to send instead. */
export function check(p: PanelSpec, d: Resolved, cards?: ReadonlyMap<string, CardDef>): string | null {
  const rows = d.rows;
  if (rows) {
    if (!rows.length) return 'there are no rows to show; say so in your reply or a text panel';
    const fields = rowFields(rows); const shown = shownFields(p, rows, cards?.get(p.card));
    const missing = shown.filter(f => !f || !fields.includes(f));
    if (missing.length) return `no field ${missing.map(f => `"${f ?? '?'}"`).join(', ')} in these rows; fields: ${fields.slice(0, 15).join(', ')}`;
    const empty = shown.filter(f => rows.every(r => r[f] === undefined || r[f] === null || r[f] === ''));
    if (empty.length) return `${empty.map(f => `"${f}"`).join(', ')} is empty in every row; fields that have values: ${fields.filter(f => rows.some(r => r[f] !== null && r[f] !== '' && r[f] !== undefined)).join(', ')}`;
    const deep = shown.filter(f => rows.some(r => nested(r[f])));
    if (deep.length) return `${deep.join(', ')} holds lists or objects, which would show as raw text; show that list in its own panel with "pick", or choose other fields`;
  }
  return kindOf(p.card, cards)?.check?.(p, d) ?? null;
}
