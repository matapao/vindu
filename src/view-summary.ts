// What a view's card says, for a window that shows several views as cards: each panel's line (panel-summary.ts), who
// changed the view last and when, whether it waits for the person, and how big it is. A view that waits (a call that
// failed, a mail drafted for the person and not yet sent; an ask is the window's own) is always drawn whole, never as
// a card. A small view (a kpi, a short record, a line of text, a notice) is never drawn fullscreen, and a view of
// notices alone is drawn as a strip, without a title bar.
import { panelsOf, recordFields, type PanelSpec, type Resolved, type ViewSpec } from './cards.js';
import { panelSummaryOf, type PanelSummary, type SummaryKit } from './panel-summary.js';

/** Who changed a view last, and when (ISO 8601): the model showing it or acting in it, or the person acting in it. */
export type ViewChange = { by: 'model' | 'person'; at: string };
/** How big a view is: small (no maximize), or a notice (a strip, without a title bar). */
export type ViewSize = 'small' | 'notice';
/** A view's card: each panel's summary, who changed it last, whether it waits for the person, and its size. */
export type ViewSummary = { panels: PanelSummary[]; changed?: ViewChange; waits?: true; size?: ViewSize };

/** At most this many panels make a small view, each of them small. */
const SMALL_PANELS = 4;
/** A record of at most this many fields is short, and a text of at most this many characters on one line is a line. */
const SHORT_RECORD = 4,
  LINE = 120;

/** The panels a view shows now: those of its steps shown so far, or all of them. */
export const shownPanels = (spec: ViewSpec): PanelSpec[] =>
  spec.step && spec.panels ? spec.panels.slice(0, spec.step.at) : panelsOf(spec);

/** Whether a panel waits for the person: its call failed, or it is a mail drafted for them that is not sent yet. */
export function waitsForPerson(p: PanelSpec, d: Resolved | undefined): boolean {
  if (!d) return false;
  if (d.failed !== undefined) return true;
  const draft = d.shaped?.props?.draft as { state?: string } | undefined;
  return p.card === 'message' && !!draft && draft.state !== 'sent';
}
/** How big a panel is: a notice, small (a kpi, a short record, a line of text), or neither. */
function panelSize(p: PanelSpec, d: Resolved | undefined): ViewSize | undefined {
  if (!d || d.waiting || d.failed !== undefined) return undefined;
  if (p.card === 'notice') return 'notice';
  if (p.card === 'kpi') return 'small';
  if (p.card === 'record' && d.record && recordFields(p, d.record).length <= SHORT_RECORD) return 'small';
  if (p.card === 'text' && d.text !== undefined && d.text.length <= LINE && !d.text.includes('\n')) return 'small';
  return undefined;
}
/** How big a view is: a notice when it holds notices alone, small when it holds a few small panels, else neither. */
export function viewSize(spec: ViewSpec, data: Record<string, Resolved>): ViewSize | undefined {
  const panels = shownPanels(spec);
  if (spec.tabs?.length || !panels.length || panels.length > SMALL_PANELS) return undefined;
  const sizes = panels.map((p) => panelSize(p, data[p.id]));
  if (sizes.every((s) => s === 'notice')) return 'notice';
  return sizes.every((s) => s !== undefined) ? 'small' : undefined;
}

/** A view's card, from its panels as resolved. */
export function viewSummaryOf(
  spec: ViewSpec,
  data: Record<string, Resolved>,
  kit: Omit<SummaryKit, 'title'>,
  changed?: ViewChange,
): ViewSummary {
  const panels = shownPanels(spec).filter((p) => data[p.id]);
  const size = viewSize(spec, data);
  return {
    panels: panels.map((p) => panelSummaryOf(p, data[p.id], { ...kit, title: spec.title })),
    ...(changed ? { changed } : {}),
    ...(panels.some((p) => waitsForPerson(p, data[p.id])) ? { waits: true as const } : {}),
    ...(size ? { size } : {}),
  };
}
