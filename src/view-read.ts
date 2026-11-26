// What the model sent as a view, read (view.ts): its fields, each panel's id and card, and the shapes other UI libraries
// give, each reading noted; a card there is not is a problem, and a field the card does not read is ignored, and said.
import { CARDS, cardsReading, COMMON_FIELDS, FROM_ALIASES as ALIASES, noCard, panelIdsOf, panelsOf, type CardName, type PanelSpec, type ViewSpec } from './cards.js';
import { Refusal, type ViewContext } from './view-context.js';
import type { Row } from './results.js';
import { kindOf } from './card-kinds/registry.js';

// a view's fields, as show_view takes them (cards.ts), and the path a drill gives it (server/selection.ts)
const VIEW_FIELDS = new Set(['name', 'title', 'slot', 'subtitle', 'panels', 'tabs', 'suggestions', 'after', 'hooks', 'steps', 'place', 'path']);

/** Read what the model sent: ids, cards and common shapes from other UI libraries, each reading noted; a card there is
 *  not is a problem, and a field the card does not read is ignored, and said to be. */
export function read(input: Record<string, unknown>, notes: string[], ctx: ViewContext, problems: string[], ignored: string[]): ViewSpec {
  const v = structuredClone(input) as unknown as ViewSpec;
  if (!v.panels?.length && !v.tabs?.length) throw new Refusal('a view needs "panels" (one page) or "tabs" (several pages, each with panels)');
  const extra = Object.keys(input).filter(k => !VIEW_FIELDS.has(k));
  if (extra.length) ignored.push(`the view: ${extra.map(k => `"${k}"`).join(', ')} ${extra.length > 1 ? 'are' : 'is'} not a field of a view (its fields: name, title, subtitle, panels or tabs, suggestions, after, hooks, steps, place)`);
  const offered = [...(ctx.kinds ?? CARDS), ...(ctx.cards?.keys() ?? [])].filter(k => k !== 'app' || ctx.apps || ctx.kinds?.has('app'));
  const ids = panelIdsOf(panelsOf(v));
  for (const [n, p] of panelsOf(v).entries()) {
    const raw = p as Record<string, unknown>;
    const id = ids[n]; p.id = id;
    const own = ctx.cards?.get(p.card);
    const builtIn = CARDS.includes(p.card as CardName) && (!ctx.kinds || ctx.kinds.has(p.card));
    const kind = (own || builtIn) && kindOf(p.card, ctx.cards);
    if (!kind) {
      problems.push(`panel ${id}: ${cardMissing(p.card, raw, offered)}`);
      continue;
    }
    // group changes what is shown, so a card that cannot show it refuses it, before what it does not read is left out
    if (p.group && kind.noGroup) { problems.push(`panel ${id}: ${kind.noGroup(p)}`); continue; }
    for (const alias of ALIASES) if (p.from === undefined && typeof raw[alias] === 'string') { p.from = raw[alias]; notes.push(`read "${alias}" as "from"`); }
    const reads = new Set([...COMMON_FIELDS, ...ALIASES, ...kind.reads]);
    for (const k of Object.keys(raw)) if (!reads.has(k) && raw[k] !== undefined) { // left out, so it does nothing, as said
      const by = cardsReading(k, offered);
      ignored.push(`panel ${id}: "${k}" does nothing on a ${p.card}${by.length ? ` (${by.join(', ')} ${by.length > 1 ? 'read' : 'reads'} it)` : ''}`);
      delete raw[k];
    }
    if (Array.isArray(p.rows)) { p.data = p.rows; delete p.rows; }
    const d = p.data as { columns?: unknown[]; rows?: unknown[] } | undefined;
    if (d && !Array.isArray(d) && typeof d === 'object' && Array.isArray(d.rows) && !kind.keepsData) { // {columns, rows}
      const head = (d.columns ?? []).map(String);
      p.data = d.rows.map(r => Array.isArray(r) ? Object.fromEntries(r.map((x, i) => [head[i] ?? `c${i + 1}`, x])) : r);
      notes.push(`read {columns, rows} as ${(p.data as Row[]).length} rows`);
    }
  }
  return v;
}

/** Why a panel's card is not here: MCP Apps are off, the window leaves the card out, or there is no such card. */
function cardMissing(card: PanelSpec['card'], raw: Record<string, unknown>, offered: string[]): string {
  if (card === 'app') return 'there is no "app" card here: MCP Apps are off in this window; show the result with the cards';
  return CARDS.includes(card as CardName) ? `there is no "${card}" card here; cards: ${offered.join(', ')}` : noCard(String(card), raw, offered);
}
