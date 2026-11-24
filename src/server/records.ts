import fs from 'node:fs';
import type { AnswerEntry } from '../results.js';
import { arrived } from './arrivals.js';
import { log, logged, writeLine } from './record-files.js';
import type { Session } from './state.js';
import { asText } from '../format.js';

export { log } from './record-files.js';

export const readLines = (file: string) => {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
};
/** Who answered, as the host says with the event: a name and the window it came from (not verified here), each as one
 *  line of at most 120 characters, so " Kari" and "Kari" are one person. */
export const whoOf = (x: Record<string, unknown>) => {
  const b = (x.by && typeof x.by === 'object' ? x.by : {}) as { name?: unknown; window?: unknown };
  const line = (v: unknown, none: string) =>
    (v === undefined || v === null ? '' : asText(v)).normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 120) || none;
  return { name: line(b.name, 'the person'), window: line(b.window, 'main') };
};
/** A promise nothing waits for: a failure is kept in the log, never thrown where no one hears it. */
export const unawaited = (session: Session, what: Record<string, unknown>, p: Promise<unknown>): void => {
  p.catch((e) => {
    try {
      log(session, { ...what, failed: String((e as Error)?.message ?? e).slice(0, 500) });
    } catch {
      // the log's own folder is gone (the task closed and its folder went): there is nowhere to say it
    }
  });
};

export const text = (t: string, isError = false) => ({
  content: [{ type: 'text' as const, text: t }],
  ...(isError ? { isError } : {}),
});
export const json = (v: unknown) => text(JSON.stringify(v));
/** A value as JSON with each object's keys in order: the same value is always the same text. */
export const stableJson = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, (x as Record<string, unknown>)[k]]),
        )
      : x,
  );
/** A JSON reply the log keeps too (e, with the reply under key), stringified once for both. */
export const loggedJson = (session: Session, e: Record<string, unknown>, key: string, reply: unknown) =>
  text(logged(session, e, key, reply));

/** What the person answered, or the host ran, kept beside the results: p1, p2, … */
export const keep = (session: Session, e: Omit<AnswerEntry, 'id' | 'kind' | 'at'>): AnswerEntry => {
  const a: AnswerEntry = {
    id: `p${session.own.length + 1}`,
    kind: 'answer',
    ...e,
    at: new Date().toISOString(),
  };
  session.own.push(a);
  writeLine(session, 'answers.jsonl', JSON.stringify(a));
  arrived(session, a); // what waits for it goes on, and the hooks on it run
  return a;
};
