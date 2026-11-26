// How far the person has read each panel of the views shown, as the window says (renderer/shell-reading.ts): the
// furthest share of it they have had in view, from 0 to 1, kept for the session and for the host alone. It only grows,
// and goes when the model shows the view anew (shownAnew). The host hears it grow (onReadProgress), by 0.05 at least or
// to 1, and reads all of it at once (ui.readProgress). The model is told none of it: no account, note, delta or look
// says it.
import { panelsOf, pidFor } from '../cards.js';
import { asText } from '../format.js';
import type { ReadProgress } from './contracts.js';
import { log } from './records.js';
import type { Session } from './state.js';

/** How much a panel's read grows before the host hears of it again; it always hears when it reaches 1. */
const STEP = 0.05;

/** What the window read of a showing of a view: each panel's share, by its pid (or its id), kept where it grew. Only for
 *  the view's newest showing (seq), and only for its own panels. Whether anything grew. */
export function readFromWindow(session: Session, x: Record<string, unknown>): boolean {
  const view = asText(x.view ?? ''),
    spec = session.shown.get(view),
    seq = session.probes.get(view)?.seq;
  if (!spec || seq === undefined || x.seq !== seq || !x.read || typeof x.read !== 'object') return false;
  const ids = new Map(
    panelsOf(spec).flatMap((p) => [
      [p.id, p.id],
      [pidFor(p.id), p.id],
    ]),
  );
  const kept = session.read.get(view) ?? new Map<string, { read: number; told: number }>();
  let grew = false;
  for (const [key, share] of Object.entries(x.read as Record<string, unknown>).slice(0, 200)) {
    const panel = ids.get(key);
    if (!panel || typeof share !== 'number' || !(share >= 0 && share <= 1)) continue;
    const read = share >= 0.985 ? 1 : Math.round(share * 1000) / 1000;
    const had = kept.get(panel) ?? { read: 0, told: 0 };
    if (read <= had.read) continue;
    had.read = read;
    kept.set(panel, had);
    grew = true;
    if (read - had.told >= STEP || (read === 1 && had.told < 1)) {
      had.told = read;
      tell(session, { view, panel, read });
    }
  }
  if (kept.size) session.read.set(view, kept);
  return grew;
}

/** The host hears it: a host's callback that throws is its own, and logged. */
const tell = (session: Session, r: ReadProgress) => {
  try {
    session.more.onReadProgress?.(r);
  } catch (error) {
    log(session, { readProgress: r.view, failed: String((error as Error).message) });
  }
};

/** Every panel's read now, in the order the views and panels were first read. */
export const readProgressOf = (session: Session): ReadProgress[] =>
  [...session.read].flatMap(([view, panels]) => [...panels].map(([panel, r]) => ({ view, panel, read: r.read })));

/** How far each view's panels have been read, for a checkpoint. */
export const readForCheckpoint = (session: Session): [string, [string, number][]][] =>
  [...session.read].map(([view, panels]) => [view, [...panels].map(([panel, r]) => [panel, r.read])]);

/** How far the restored views' panels had been read, as the host was told of it then: it hears only what grows after.
 *  Only of the views restored, and their own panels. */
export const restoreRead = (session: Session, saved: [string, [string, number][]][] = []) => {
  session.read = new Map();
  for (const [view, panels] of saved) {
    const spec = session.shown.get(view),
      ids = new Set(spec ? panelsOf(spec).map((p) => p.id) : []);
    const kept = new Map(
      panels.filter(([panel]) => ids.has(panel)).map(([panel, read]) => [panel, { read, told: read }]),
    );
    if (kept.size) session.read.set(view, kept);
  }
};
