// What a session keeps on the computer lives only while it is open: the folder it writes in, and the pictures of the
// results it reads. A session without a dir of its own writes in a temporary folder, made where the host says
// (tempDir) or in the system's temporary folder; it goes whole when the session closes. In a dir of the host's own,
// only Vindu's files go: its records, the pages the model wrote and its terminals' logs, never the host's own files.
// Whatever is left as the process exits goes then (temp-folders.ts).
import fs from 'node:fs';
import path from 'node:path';
import type { ResultSource } from '../results.js';
import { removable, tempFolder } from '../temp-folders.js';

/** What Vindu writes in a session's folder: its records (record-files.ts), the pages the model writes (pages.ts) and
 *  its terminals' scripts and logs (views/terminal.ts). */
const OWN = ['ui-calls.jsonl', 'answers.jsonl', 'reminders.jsonl', 'views', 'terminals'];

/** The folder a session writes in, and its removal when the session closes. */
export function sessionFolder(
  given: string | undefined,
  tempDir: string | undefined,
): { dir: string; remove: () => void } {
  if (given === undefined) {
    const dir = tempFolder('vindu-session-', tempDir);
    return { dir, remove: removable(dir) };
  }
  fs.mkdirSync(given, { recursive: true });
  const removals = OWN.map((name) => removable(path.join(given, name)));
  return {
    dir: given,
    remove: () => {
      for (const remove of removals) remove();
    },
  };
}

const readers = new WeakMap<ResultSource, number>(); // the sessions open on each store
/** A session reads this store from now on. */
export const holdResults = (results: ResultSource): void => {
  readers.set(results, (readers.get(results) ?? 0) + 1);
};
/** A session that read this store has closed: once none is left, what the store wrote from results goes (release). */
export const letGoResults = (results: ResultSource): void => {
  const left = (readers.get(results) ?? 1) - 1;
  if (left > 0) {
    readers.set(results, left);
    return;
  }
  readers.delete(results);
  results.release?.();
};
