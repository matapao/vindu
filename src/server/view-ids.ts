// The ids a view points at, and the same view under other ids: a view carried into another process (startFrom), or
// restored on results read again (restore), points at that process's entries.
import { FROM_ALIASES, resultIds } from '../cards.js';
import { fieldRoles } from '../card-schema.js';
import type { Session } from './state.js';

const ID = /^[rap]\d+$/;
/** The ids a value of a field that holds them names: a run written out (r5-r44); one longer than a panel can show is
 *  no run of ids, so it is carried as it is. */
const idsOf = (v: string): string[] => {
  try {
    return resultIds([v]);
  } catch {
    return [v.trim()];
  }
};
/** The fields of a panel that hold result ids, as the cards offered here mark them (resultRef): a panel's from (and the
 *  names show_view reads as from), a document's before, media and its marks, a page's uses, a batch's results, and any
 *  of a host's own. */
export const refsOf = (session: Session) =>
  new Set([...fieldRoles([...session.runtime.cards.values()]).refs, ...FROM_ALIASES]);
/** Every id a view points at: in each field that holds ids (a run, such as r5-r44, as each of its ids), and each ctx:
 *  reference. */
export const idsIn = (x: unknown, refs: Set<string>, out = new Set<string>(), k?: string): Set<string> => {
  if (typeof x === 'string') {
    if (k && refs.has(k) && ID.test(x)) out.add(x);
    for (const m of x.matchAll(/ctx:([rap]\d+)/g)) out.add(m[1]);
  } else if (Array.isArray(x))
    for (const v of x) {
      if (k && refs.has(k) && typeof v === 'string') for (const id of idsOf(v).filter((y) => ID.test(y))) out.add(id);
      else idsIn(v, refs, out);
    }
  else if (x && typeof x === 'object') for (const [kk, v] of Object.entries(x)) idsIn(v, refs, out, kk);
  return out;
};
/** The view with each id it points at swapped for its new one: in each field that holds ids (a run written out), and
 *  in each ctx: reference. */
export const swapIds = (x: unknown, refs: Set<string>, map: Record<string, string>, k?: string): unknown => {
  const now = (id: string) => (Object.hasOwn(map, id) ? map[id] : undefined); // an id's new one: never what objects inherit
  if (typeof x === 'string')
    return ((k && refs.has(k) && now(x)) || x).replace(/ctx:([rap]\d+)/g, (m, id: string) => {
      const swapped = now(id);
      return swapped ? `ctx:${swapped}` : m;
    });
  if (Array.isArray(x))
    return x.flatMap((v) => {
      if (!(k && refs.has(k) && typeof v === 'string')) return [swapIds(v, refs, map)];
      const ids = idsOf(v),
        run = ids.length !== 1 || ids[0] !== v.trim(); // r5-r44: each of its ids, swapped
      return run && ids.every((id) => now(id)) ? ids.map((id) => map[id]) : [now(v) ?? swapIds(v, refs, map)];
    });
  if (x && typeof x === 'object')
    return Object.fromEntries(Object.entries(x).map(([kk, v]) => [kk, swapIds(v, refs, map, kk)]));
  return x;
};
