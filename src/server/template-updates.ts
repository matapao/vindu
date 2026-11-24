import { panelsOf } from '../cards.js';
import type { Entry } from '../results.js';
import { fitRead, type Slot, sourceName } from '../templates.js';
import type { OpenMore } from './contracts.js';
import { log } from './records.js';
import type { Session } from './state.js';

export const valueIn = (e?: Entry) =>
  e?.kind === 'result' ? (e.digest ?? [e.value ?? null, e.rows ?? null, e.text]) : null; // what a read said
/** A slot's source read again and again by the host: what changed is shown in the slot and told to the model once. */
export const keepFresh = (
  session: Session,
  n: string,
  sl: Slot,
  what: { tool?: string; resource?: string; args: Record<string, unknown> },
  first: string,
  more: OpenMore,
) => {
  const src = sl.source!;
  const mode = session.mode;
  let last = JSON.stringify(valueIn(session.results.get(first)));
  const reads = [first];
  session.fresh.set(first, first);
  const stop = more.watch!(
    { server: src.server, ...what, after: first },
    src.every!,
    (id) => {
      if (session.closed || session.mode !== mode) return; // the slot is no longer the template's: nothing refills it
      const now = JSON.stringify(valueIn(session.results.get(id)));
      if (now === last) return;
      last = now; // the same: nothing to show or tell
      reads.push(id);
      for (const r of reads) session.fresh.set(r, id); // every earlier read of this source: id is its newest
      const fit = fitRead(n, sl, id);
      if ('refusal' in fit) {
        log(session, { slot: n, fresh: id, refused: fit.refusal });
        return;
      }
      void session
        .present(fit.args)
        .then(
          async () => {
            if (session.mode === mode) mode!.fills.set(n, { by: 'source', id, at: new Date().toISOString() });
            const said = `${sl.title} changed: read again from ${sourceName({ ...src, ...what })}, it now shows ${id}`;
            const others = onEarlier(session, n, new Set(reads)); // told at once when no other view shows this source
            session.shell.say(others.length ? said + (await drawAgain(session, others)) : said);
            log(session, { slot: n, fresh: id });
          },
          (e) => log(session, { slot: n, fresh: id, refused: String((e as Error).message) }),
        )
        .catch((e) => log(session, { slot: n, fresh: id, error: String((e as Error).message) }));
    },
    (e) => log(session, { slot: n, fresh: 'failed', error: String(e.message).slice(0, 200) }),
  );
  session.watches.push(stop);
  session.slotWatches.set(n, stop);
};
/** A source no longer kept fresh: stopped, and nothing keeps its stop. */
export const stopWatch = (session: Session, stop: () => void) => {
  stop();
  const at = session.watches.indexOf(stop);
  if (at >= 0) session.watches.splice(at, 1);
};
/** The other views that show a read of a source that has changed since, drawn again where they are: a panel that
 *  follows the source shows its newest read, computed again; any other is marked as not up to date. What happened,
 *  said for the model. */
const onEarlier = (session: Session, except: string, reads: Set<string>) =>
  [...session.shown]
    .filter(
      ([name, spec]) =>
        name !== except && session.specs.has(name) && panelsOf(spec).some((p) => p.from && reads.has(p.from)),
    )
    .map(([name]) => name);
export const drawAgain = async (session: Session, names: string[]): Promise<string> => {
  const marked: string[] = [],
    followed: string[] = [];
  for (const name of names) {
    const args = session.specs.get(name);
    if (!args) continue;
    try {
      const acc = await session.present(args, true);
      for (const p of acc.panels) {
        if (p.not_up_to_date) marked.push(`${name}/${String(p.id)} (${String(p.from)})`);
        if (p.follows) followed.push(`${name}/${String(p.id)}`);
      }
      log(session, {
        drawn_again: name,
        marked: acc.panels.filter((p) => p.not_up_to_date).map((p) => p.id),
        followed: acc.panels.filter((p) => p.follows).map((p) => p.id),
      });
    } catch (e) {
      session.refusals.push(String((e as Error).message));
      log(session, { drawn_again: name, refused: String((e as Error).message) });
    }
  }
  return (
    (marked.length
      ? `; still on an earlier read, so marked "not up to date" in the window: ${marked.join(', ')}. Show them from the newest read, or with follow: true to keep them on it`
      : '') + (followed.length ? `; following it, computed again: ${followed.join(', ')}` : '')
  );
};
