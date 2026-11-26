// What a change does to a row: the fields whose values differ between its before and its after, a field left out of
// either counted as changed. Shared by the changes block (Node), its drawing (browser) and the words of an ask that
// makes changes, so nothing else here.
type Fields = Record<string, unknown>;
const fieldsOf = (v: unknown): Fields => (v && typeof v === 'object' ? (v as Fields) : {});

/** Each field that changed, with its value before and after (undefined where the field is not there). */
export function changedFields(before: unknown, after: unknown): [field: string, before: unknown, after: unknown][] {
  const was = fieldsOf(before),
    now = fieldsOf(after);
  return [...new Set([...Object.keys(was), ...Object.keys(now)])]
    .filter((field) => JSON.stringify(was[field]) !== JSON.stringify(now[field]))
    .map((field) => [field, was[field], now[field]]);
}
