// The person's own answers, as a checkpoint keeps them: only those the restored views and their waits point at, and of
// those only what the person gave. What a call returned with an answer (its output), what an app or a page reported,
// what the host ran, and what the person pointed at (values read from results) stay with the task that had them.
import type { AnswerEntry } from '../results.js';
import type { KeptAnswer } from './contracts.js';
import { writeLine } from './record-files.js';
import { POINTED } from './selection.js';
import type { Gate, Session } from './state.js';

const theirs = (a: AnswerEntry): boolean => a.by === 'person' && !a.from && a.to !== POINTED;
const numberOf = (id: string) => Number(id.slice(1));
/** The answer a gate waits for, if it waits for one: the operation the person answers. */
const answeredOf = (gate: Gate): string | undefined => {
  try {
    const want = JSON.parse(gate.want) as { after?: { answered?: unknown } | null };
    return typeof want.after?.answered === 'string' ? want.after.answered : undefined;
  } catch {
    return undefined;
  }
};

/** The person's answers a checkpoint keeps: those its views point at (ids), and the one that let each panel or view
 *  waiting for an answer show. */
export const answersFor = (
  session: Session,
  ids: ReadonlySet<string>,
  gates: readonly [string, Gate][],
): KeptAnswer[] => {
  const wanted = new Set([...ids].filter((id) => /^p\d+$/.test(id)));
  for (const [, gate] of gates) {
    const answered = answeredOf(gate);
    const a =
      answered && session.own.slice(gate.sinceOwn).find((x) => x.to === answered && theirs(x) && x.values !== null);
    if (a) wanted.add(a.id);
  }
  return session.own
    .filter((a) => wanted.has(a.id) && theirs(a))
    .map((a) => ({
      id: a.id,
      to: a.to,
      values: structuredClone(a.values),
      ...(a.who ? { who: [...a.who] } : {}),
      at: a.at,
    }));
};

/** The answers a checkpoint kept, the person's again under this task's ids (p1, p2, … in their order), as already
 *  heard: their new ids (map), and where a gate that began after so many answers there begins here (sinceOwn), so an
 *  answer that let it show still does. */
export const restoreAnswers = (session: Session, kept: readonly KeptAnswer[] = []) => {
  const map: Record<string, string> = {};
  const order = [...new Map(kept.map((k) => [k.id, k])).values()].sort((a, b) => numberOf(a.id) - numberOf(b.id)); // each once
  for (const k of order) {
    const a: AnswerEntry = {
      id: `p${session.own.length + 1}`,
      kind: 'answer',
      to: k.to,
      by: 'person',
      values: k.values,
      ...(k.who ? { who: k.who } : {}),
      at: k.at,
    };
    session.own.push(a);
    writeLine(session, 'answers.jsonl', JSON.stringify(a));
    map[k.id] = a.id;
  }
  session.told = session.own.length; // what was answered before is not told again
  const sinceOwn = (before: number) => order.filter((k) => numberOf(k.id) <= before).length;
  return { map, sinceOwn };
};
