// A panel restored waiting because its result was not read again (the host could not, or reads nothing again for a task
// restored) keeps where that result came from on its gate: its pointer, in every checkpoint, until a result fills the
// panel. Every restore after reads it again, with the same rules as the first. The host has every such panel read
// again now (ui.refetchWaiting), and the person one of them (its Try again): what comes is drawn in place and the
// model is told once; the rest wait, saying why now. A panel the model wrote to await a call keeps no pointer.
import type { ResultPointer } from './contracts.js';
import { log, unawaited } from './records.js';
import { NOT_KEPT, readEachAgain, type ReadAgain, type Reread, waitsSaid } from './refetch.js';
import type { Gate, Session } from './state.js';

/** What a run of reads again did: how many panels it filled, and how many still wait. */
export type Refetched = { filled: number; still: number };
type Waiting = [key: string, gate: Gate];

const viewOf = (key: string) => key.slice(0, key.lastIndexOf('/')); // a panel's id has no "/"
const panelOf = (key: string) => key.slice(key.lastIndexOf('/') + 1);
/** Whether a panel waits for its result read again: its gate keeps a pointer, nothing has filled it, and the view shown
 *  draws it waiting. */
const waitsForRead = (session: Session, key: string, gate: Gate): boolean =>
  !!gate.pointer && !gate.got && !!session.data.get(viewOf(key))?.[panelOf(key)]?.waiting;

/** The gates a checkpoint keeps, each a copy: with its pointer only where its panel waits for that result read again. */
export const keptGates = (session: Session, gates: readonly [string, Gate][]): [string, Gate][] =>
  gates.map(([key, g]) => {
    const { pointer, ...gate } = g;
    return [key, pointer && waitsForRead(session, key, g) ? { ...gate, pointer: structuredClone(pointer) } : gate];
  });
/** The pointer each gate given keeps for a result to read again, by its view/panel. */
export const keptPointers = (gates: readonly Waiting[]) =>
  new Map(gates.flatMap(([key, g]): [string, ResultPointer][] => (g.pointer && !g.got ? [[key, g.pointer]] : [])));

/** What a gate restores to: the result read again for it, or why there is none, with the pointer kept where it may be
 *  read again later. What filled it (got) is read again by its id; a pointer kept on it, by its view/panel. told: a
 *  panel this restore made wait, as the model is told of it. */
export function gateRestored(
  key: string,
  g: Gate,
  read: Reread,
  now: (id?: string) => string | undefined,
  pointers: ReadonlyMap<string, ResultPointer>,
): { got?: string; why?: string; pointer?: Gate['pointer']; told?: string } {
  const told = (why: string) => `${viewOf(key)} (${panelOf(key)}): ${why}`;
  if (g.got) {
    const got = now(g.got);
    if (got) return { got };
    const p = pointers.get(g.got);
    const why = read.missing.get(g.got) ?? NOT_KEPT;
    return { why, ...(read.again.has(g.got) && p?.kind === 'result' ? { pointer: p } : {}), told: told(why) };
  }
  const came = read.waiting.get(key);
  if (!g.pointer || !came) return g.why ? { why: g.why } : {};
  if ('id' in came) return { got: came.id };
  return { why: came.why, ...(came.again ? { pointer: g.pointer } : {}), told: told(came.why) };
}

/** What came for the panels read again, kept on their gates: each filled from its result, or waiting, saying why now,
 *  and without its pointer where it may not be read again; their views drawn again where they are, and the model told
 *  once of those filled. The panels filled. */
function settle(session: Session, waiting: Waiting[], read: Map<string, ReadAgain>): Set<string> {
  const filled = new Set<string>();
  const views = new Set<string>();
  const drawn: string[] = [];
  const still: string[] = [];
  for (const [key, gate] of waiting) {
    const came = read.get(key);
    if (!came || session.gates.get(key) !== gate) continue; // drawn anew meanwhile: this wait is gone
    if (gate.got)
      filled.add(key); // the call came meanwhile and filled it, told as it came
    else if ('id' in came) {
      gate.got = came.id;
      delete gate.pointer;
      delete gate.why;
      filled.add(key);
      views.add(viewOf(key));
      drawn.push(`${viewOf(key)} (${panelOf(key)}), from ${came.id}`);
    } else {
      if (came.why !== gate.why || !came.again) views.add(viewOf(key));
      gate.why = came.why;
      if (!came.again) delete gate.pointer;
      still.push(`${viewOf(key)} (${panelOf(key)}): ${came.why}`);
    }
  }
  if (session.closed) return filled;
  for (const view of views) {
    const args = session.specs.get(view);
    if (args) unawaited(session, { reread: view }, session.present(args, true));
  }
  if (drawn.length) {
    const one = drawn.length === 1;
    session.shell.say(
      `${one ? 'one panel that waited is' : `${drawn.length} panels that waited are`} drawn from ${one ? 'its result' : 'their results'} read again: ${drawn.slice(0, 12).join('; ')}${drawn.length > 12 ? '; …' : ''}${still.length ? `; ${waitsSaid(still)}` : ''}`,
    );
  }
  log(session, { reread: { filled: [...filled], still: still.length } });
  return filled;
}

/** The panels given, each read again: one already being read is waited for, the others read now, each call once. */
async function readAgainNow(session: Session, waiting: Waiting[]): Promise<Refetched> {
  const fresh = waiting.filter(([key]) => !session.rereading.has(key));
  if (fresh.length) {
    const reading = readEachAgain(session, keptPointers(fresh))
      .then(
        (read) => settle(session, fresh, read),
        (e) => {
          if (!session.closed) log(session, { reread: 'failed', error: String((e as Error).message) });
          return new Set<string>();
        },
      )
      .finally(() => {
        for (const [key] of fresh) session.rereading.delete(key);
      });
    for (const [key] of fresh)
      session.rereading.set(
        key,
        reading.then((filled) => filled.has(key)),
      );
  }
  const each = await Promise.all(waiting.map(([key]) => session.rereading.get(key) ?? Promise.resolve(false)));
  const filled = each.filter(Boolean).length;
  return { filled, still: waiting.length - filled };
}

/** Every panel of this task that waits for its result read again, read again by the host now (ui.refetchWaiting): how
 *  many it filled and how many still wait. Without the host's refetch, nothing is read. Calls while one runs share it. */
export function refetchWaiting(session: Session): Promise<Refetched> {
  if (!session.more.refetch || session.closed) return Promise.resolve({ filled: 0, still: 0 });
  if (!session.refetching) {
    const waiting = [...session.gates].filter(([key, gate]) => waitsForRead(session, key, gate));
    session.refetching = readAgainNow(session, waiting).finally(() => {
      session.refetching = undefined;
    });
  }
  return session.refetching;
}

/** The person's Try again on one panel that waits for its result read again: that panel's result alone, read again
 *  now. Refused (false) for any other panel, and where the host reads nothing again. */
export function tryAgain(session: Session, view: string, panel: string, who: { name: string }): boolean {
  const key = `${view}/${panel}`;
  const gate = session.gates.get(key);
  if (!session.more.refetch || !gate || !waitsForRead(session, key, gate)) return false;
  log(session, { person: { view, panel, tryAgain: who.name } });
  unawaited(session, { reread: key }, readAgainNow(session, [[key, gate]]));
  return true;
}
