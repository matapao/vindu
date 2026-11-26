import fs from 'node:fs';
import path from 'node:path';
import type { Session } from './state.js';

/** The files a session keeps while it is open, one JSON line each, never sent anywhere: every view call and answer (the
 *  log), the person's answers, and the reminders. Each is the person's own record: theirs alone to read, and gone with
 *  the session's folder once it closes (session-folder.ts). */
export type RecordFile = 'ui-calls.jsonl' | 'answers.jsonl' | 'reminders.jsonl';

/** A line written to one of the session's files, at once and in order. Each file is opened once, at its first line, and
 *  closed with the session; a line that comes after (an answer that closing it settled) is kept nowhere, as the files
 *  go with the session. */
export const writeLine = (session: Session, file: RecordFile, line: string): void => {
  if (session.closed) return;
  const at = path.join(session.process.dir, file);
  let fd = session.files.get(file);
  if (fd === undefined) session.files.set(file, (fd = fs.openSync(at, 'a', 0o600)));
  const bytes = Buffer.from(`${line}\n`);
  for (let written = 0; written < bytes.length;) written += fs.writeSync(fd, bytes, written);
};
/** The session's files, closed with it. */
export const closeFiles = (session: Session): void => {
  for (const fd of session.files.values()) fs.closeSync(fd);
  session.files.clear();
};

// a local log of every view call and every answer, kept with the process (never sent anywhere)
const logLine = (e: Record<string, unknown>) => JSON.stringify({ at: new Date().toISOString(), ...e });
export const log = (session: Session, e: Record<string, unknown>): void =>
  writeLine(session, 'ui-calls.jsonl', logLine(e));
/** A JSON reply that the log keeps too, under key: it is written as JSON once, for both. */
export const logged = (session: Session, e: Record<string, unknown>, key: string, reply: unknown): string => {
  const out = JSON.stringify(reply);
  writeLine(session, 'ui-calls.jsonl', `${logLine(e).slice(0, -1)},${JSON.stringify(key)}:${out}}`);
  return out;
};
