import { type After, type Await, panelsOf, type PanelSpec, type ViewSpec } from '../cards.js';
import { awaitName, type Fills, firstAfter, panelRef } from '../gates.js';
import { log } from './records.js';
import type { Gate, Session } from './state.js';

/** The call a gate waits for, the first that came after it began: what fills its panel, which then needs no pointer
 *  to read its result again. */
const cameFor = (session: Session, gate: Gate, awaited: Await) => {
  gate.got = firstAfter(session.results.all(), gate.since, awaited)?.id;
  if (gate.got) delete gate.pointer;
};

export const gateOf = (
  session: Session,
  view: string,
  p: PanelSpec,
  spec: ViewSpec,
): { from?: string; fills?: Fills; wait?: string; failed?: string; again?: boolean } => {
  const key = `${view}/${p.id}`,
    want = JSON.stringify({ awaits: p.awaits ?? null, after: p.after ?? null });
  let gate = session.gates.get(key);
  if (!gate || gate.want !== want)
    session.gates.set(key, (gate = { want, since: session.results.all().length, sinceOwn: session.own.length })); // from its first showing: what comes after
  if (p.after) {
    const why = notYet(session, p.after, view, spec, gate);
    if (why) return { wait: why };
  }
  if (!p.awaits) return {};
  const awaited = p.awaits;
  if (!gate.got) cameFor(session, gate, awaited);
  if (!gate.got)
    return {
      wait: `${gate.why ? `${gate.why} ` : ''}Waiting for ${awaitName(awaited)}: it fills in here when it comes.`,
      ...(gate.pointer && session.more.refetch ? { again: true } : {}), // the person may have it read again now
    };
  const came = session.results.get(gate.got);
  const fills = gate.fills ? { fills: gate.fills } : {}; // the field it fills, where not from
  return came?.kind === 'result' && came.error
    ? { from: gate.got, ...fills, failed: `${awaitName(awaited)} failed (${gate.got}): ${came.text.slice(0, 600)}` }
    : { from: gate.got, ...fills };
};
/** Why a panel or a view is not shown yet, in the person's words; undefined once what it is after has happened. */
export const notYet = (
  session: Session,
  after: After,
  view: string,
  spec: ViewSpec | undefined,
  gate: Gate,
): string | undefined => {
  if (
    after.answered &&
    !session.own.slice(gate.sinceOwn).some((x) => x.to === after.answered && x.by === 'person' && x.values !== null) // the person's answer, not a page's or the host's
  )
    return `After you answer "${after.answered.replace(/_/g, ' ')}".`;
  /** The panel a ref names, in this view (as it is being shown) or in another view shown. */
  const panelAt = (ref: string) => {
    const [inView, panel] = panelRef(ref, view);
    const shownSpec = inView === view && spec ? spec : session.shown.get(inView);
    return { inView, panel, found: shownSpec && panelsOf(shownSpec).find((x) => x.id === panel) };
  };
  if (after.picked) {
    const { panel, found } = panelAt(after.picked);
    if (!found) return `After a pick in ${after.picked}, which is not shown yet.`;
    if (found.selected === undefined) return `After you pick a row in ${found.title ?? panel}.`;
  }
  if (after.filled) {
    const { inView, panel, found } = panelAt(after.filled);
    const filled = session.gates.get(`${inView}/${panel}`);
    if (found?.awaits && filled && !filled.got) cameFor(session, filled, found.awaits); // in any order: worked out here
    if (!filled?.got) return `After ${found?.title ?? after.filled} is filled.`;
  }
  return undefined;
};
/** Something happened (an answer, a pick, a result): each view held until it is shown, and each panel that waited for
 *  it is filled, by the system, without the model; the model is told once, in the next note. */
export const wake = async (session: Session): Promise<void> => {
  if (session.waking) {
    session.wakeAgain = true;
    return session.waking;
  }
  session.waking = (async () => {
    do {
      session.wakeAgain = false;
      // oxlint-disable-next-line unicorn/no-useless-spread -- a copy: each view waits to be shown, and what is held changes meanwhile
      for (const [name, heldView] of [...session.held]) {
        if (session.closed || notYet(session, heldView.after, name, undefined, heldView)) continue;
        session.held.delete(name);
        try {
          await session.present(heldView.args, false, false, undefined, true); // the model's, shown now
          session.shell.say(
            `${heldView.title} is shown now, by the system: what it was written to wait for has happened`,
          );
          log(session, { held: name, shown: true });
        } catch (e) {
          log(session, { held: name, refused: String((e as Error).message) });
        }
      }
      // oxlint-disable-next-line unicorn/no-useless-spread -- a copy: each panel waits to be filled, and what is shown changes meanwhile
      for (const [name, spec] of [...session.shown]) {
        const data = session.data.get(name);
        const args = session.specs.get(name);
        if (!data || !args) continue;
        const now = panelsOf(spec)
          .filter((p) => data[p.id]?.waiting && (p.awaits || p.after))
          .filter((p) => {
            const gate = gateOf(session, name, p, spec);
            return !gate.wait && !(gate.failed && data[p.id].failed);
          });
        if (!now.length) continue;
        try {
          await session.present(args, true);
          session.shell.say(
            now
              .map((p) => {
                const gate = session.gates.get(`${name}/${p.id}`);
                return `${spec.title} (${p.id}): ${gate?.got ? `filled from ${gate.got}, exactly as it came` : 'shown now, as what it waited for happened'}`;
              })
              .join('; '),
          );
        } catch (e) {
          log(session, { waiting: name, refused: String((e as Error).message) });
        }
      }
    } while (session.wakeAgain && !session.closed);
  })().finally(() => {
    session.waking = undefined;
    // A result can arrive after the loop finished but before this promise settled.
    if (session.wakeAgain && !session.closed)
      wake(session).catch((e) => log(session, { waiting: 'failed', error: String((e as Error).message) }));
  });
  return session.waking;
};
