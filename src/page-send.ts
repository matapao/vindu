// What a page may send with task.send, and how often. Shared by the page host (Node) and the window (browser), so
// nothing else here.

/** The longest value a page sends, as JSON. */
export const SEND_MAX = 8000;
/** At most this many sends from one view's pages within SEND_WINDOW_MS. */
const SENDS_AT_ONCE = 5;
const SEND_WINDOW_MS = 10_000;

/** A value's length as JSON, or Infinity for what JSON cannot hold. */
export function jsonLength(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? Infinity;
  } catch {
    return Infinity;
  }
}

/** One more send from a view: the view's sends still within the window (the caller adds this one to them when it
 *  goes), and why it may not go, if it may not. */
export function checkSend(
  sentAt: readonly number[],
  value: unknown,
  now = Date.now(),
): { recent: number[]; why?: string } {
  const recent = sentAt.filter((t) => now - t < SEND_WINDOW_MS);
  let why: string | undefined;
  if (recent.length >= SENDS_AT_ONCE)
    why = `too many: ${SENDS_AT_ONCE} sends in ${SEND_WINDOW_MS / 1000} seconds at most`;
  else if (jsonLength(value) > SEND_MAX) why = `not a value of at most ${SEND_MAX} characters as JSON`;
  return why ? { recent, why } : { recent };
}
