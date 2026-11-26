// A checkpoint keeps where each result came from, never what it held: on restore, the host reads each one again
// (refetch), and the restored views are drawn from what came. A panel whose result was not read again waits for it,
// saying why: for the same call again where it showed a result (from it, or as its picture: a media panel's, or one
// of a gallery's), or in words where it showed something else; the rest of its view is drawn as it was. One that
// waits for the same call keeps the pointer, to be read again later (refetch-waiting.ts).
import { panelIdsOf, resultIds } from '../cards.js';
import type { Fills } from '../gates.js';
import type { ResultEntry, Row } from '../results.js';
import type { ResultPointer } from './contracts.js';
import { stableJson } from './records.js';
import type { Session } from './state.js';
import { idsIn, swapIds } from './view-ids.js';

/** How a result is named for reading it again: by the host's ref, else by its input, else by its call alone. */
const whereFrom = (e: ResultEntry) => {
  if (e.ref !== undefined) return { ref: e.ref };
  return e.input !== undefined ? { input: structuredClone(e.input) } : {};
};
/** Where each result and attachment named here came from, as the session has it: never what it held. A result the host
 *  gave a ref of its own is named by it, in place of its input. */
export const pointersFor = (session: Session, ids: Iterable<string>): ResultPointer[] => {
  const out: ResultPointer[] = [];
  for (const id of ids) {
    const e = session.results.get(id);
    if (e?.kind === 'result')
      out.push({
        id,
        kind: 'result',
        server: e.server,
        tool: e.tool,
        ...whereFrom(e),
      });
    else if (e?.kind === 'attachment') out.push({ id, kind: 'attachment', name: e.name, mime: e.mime, file: e.file });
  }
  return out;
};

/** What a pointer reads, as one call: two ids of the same call are read again once. */
const callOf = (p: ResultPointer): string =>
  p.kind === 'attachment'
    ? stableJson({ file: p.file, name: p.name, mime: p.mime })
    : stableJson({
        server: p.server,
        tool: p.tool,
        ...(p.ref !== undefined ? { ref: p.ref } : { input: p.input ?? null }),
      });
const nameOf = (p: ResultPointer) => (p.kind === 'attachment' ? `the attachment ${p.name}` : `${p.server}.${p.tool}`);
const oneLine = (e: unknown) =>
  String((e as Error)?.message ?? e)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);

/** What came of reading a pointer again: the new entry's id; or why there is none, as a sentence, and whether it may be
 *  read again later (again): what the host could not read now it may later, but never a tool that changes things. */
export type ReadAgain = { id: string } | { why: string; again: boolean };
/** One pointer, read again by the host. */
async function readAgain(session: Session, p: ResultPointer): Promise<ReadAgain> {
  const refetch = session.more.refetch;
  if (!refetch) return { why: 'Not read again: this host reads nothing again for a task restored.', again: true };
  if (p.kind === 'result' && p.ref === undefined && session.more.isRead?.(p.server, p.tool) === false)
    return { why: `Not called again: ${nameOf(p)} changes things, as its server says.`, again: false };
  let id: unknown;
  try {
    id = await refetch(structuredClone(p));
  } catch (e) {
    return { why: `Not read again: the host could not (${oneLine(e)}).`, again: true };
  }
  if (typeof id !== 'string' || !id) return { why: 'Not read again: the host could not.', again: true };
  const e = session.results.get(id);
  if (e?.kind !== p.kind)
    return {
      why: `Not read again: the host gave ${id.slice(0, 40)}, which is not ${p.kind === 'result' ? 'a result' : 'an attachment'} of this task.`,
      again: true,
    };
  if (e.kind === 'result' && e.error) return { why: `Read again, ${nameOf(p)} failed (${id}).`, again: true };
  return { id };
}

/** Each pointer, by its key, read again by the host: each call once, and all at once. What came of each, by its key. */
export async function readEachAgain(
  session: Session,
  pointers: ReadonlyMap<string, ResultPointer>,
): Promise<Map<string, ReadAgain>> {
  const calls = new Map<string, string[]>();
  for (const [key, p] of pointers) calls.set(callOf(p), [...(calls.get(callOf(p)) ?? []), key]);
  const out = new Map<string, ReadAgain>();
  await Promise.all(
    [...calls.values()].map(async (keys) => {
      const got = await readAgain(session, pointers.get(keys[0])!);
      for (const key of keys) out.set(key, got);
    }),
  );
  return out;
}

/** Every pointer a checkpoint names, and each one a panel was kept waiting for (kept, by its view/panel), read again by
 *  the host, each call once and all at once: the new id of each one named that was read (map), why each other was not
 *  (missing) and which of those may be read again later (again); and what came of each kept one (waiting). */
export async function refetchAll(
  session: Session,
  pointers: readonly ResultPointer[],
  kept: ReadonlyMap<string, ResultPointer> = new Map(),
) {
  const keyed = new Map(kept); // a view/panel has a "/", which no id has
  for (const p of pointers) keyed.set(p.id, p);
  const map: Record<string, string> = {};
  const missing = new Map<string, string>();
  const again = new Set<string>();
  const waiting = new Map<string, ReadAgain>();
  for (const [key, got] of await readEachAgain(session, keyed)) {
    if (kept.has(key)) waiting.set(key, got);
    else if ('id' in got) map[key] = got.id;
    else {
      missing.set(key, got.why);
      if (got.again) again.add(key);
    }
  }
  return { map, missing, again, waiting };
}
export type Reread = Awaited<ReturnType<typeof refetchAll>>;

/** What restoring a view knows: the ids read again (map), why the others were not (missing) and which of those may be
 *  read again later (again), each pointer by its id, and where the view's panels that wait are told (waits). */
export type Restoring = {
  refs: Set<string>;
  map: Record<string, string>;
  missing: Map<string, string>;
  again: ReadonlySet<string>;
  pointers: Map<string, ResultPointer>;
  waits: string[];
};
const isRecord = (x: unknown): x is Row => !!x && typeof x === 'object' && !Array.isArray(x);
export const NOT_KEPT = 'Not shown again: what it showed is not kept once its task has closed.';
/** What the model is told of the panels that wait for their results, each "view (panel): why", as restore says it. */
export const waitsSaid = (waits: readonly string[]): string =>
  `${waits.length === 1 ? 'one panel waits for its result' : `${waits.length} panels wait for their results`}: ${waits.slice(0, 12).join('; ')}${waits.length > 12 ? '; …' : ''}`;
/** What a panel showed, where the checkpoint says. */
const showed = (p: ResultPointer | undefined): string => {
  if (!p) return '';
  return p.kind === 'result' ? ` It showed what ${nameOf(p)} gave.` : ` It showed ${p.name}, which the person gave.`;
};

/** A gallery's items, each run of result ids written out (r5-r8 as r5, r6, r7, r8); undefined for a list that is not
 *  one of names and ids. */
const itemsOf = (media: unknown): string[] | undefined => {
  if (!Array.isArray(media) || !media.every((x) => typeof x === 'string')) return undefined;
  try {
    return resultIds(media);
  } catch {
    return undefined;
  }
};
/** Where the same call again fills a panel that showed one id not read again: its from, a media panel's picture, or one
 *  item of a gallery, its other items on the ids read again. The panel without that id, and the field the call fills
 *  where it is not from. Undefined where that id is anywhere else, or in a panel that waits already. */
function waitsIn(panel: Row, gone: string, r: Restoring): { rest: Row; fills?: Fills } | undefined {
  const swapped = swapIds(panel, r.refs, r.map) as Row;
  if (panel.from === gone) {
    const { from: _from, ...rest } = swapped;
    return { rest };
  }
  if (panel.awaits !== undefined) return undefined;
  if (panel.card === 'media' && panel.media === gone) {
    const { media: _media, ...rest } = swapped;
    return { rest, fills: { field: 'media' } };
  }
  const items = panel.card === 'gallery' ? itemsOf(panel.media) : undefined;
  if (!items || items.filter((x) => x === gone).length !== 1) return undefined;
  const at = items.indexOf(gone);
  const media = items.filter((_, i) => i !== at).map((x) => (Object.hasOwn(r.map, x) ? r.map[x] : x));
  return { rest: { ...swapped, media }, fills: { field: 'media', at } };
}

/** A panel as restored: on the ids read again; or, where one it shows was not, waiting for it with why. */
function restoredPanel(session: Session, view: string, id: string, panel: Row, r: Restoring): Row {
  const gone = [...idsIn(panel, r.refs)].filter((x) => !Object.hasOwn(r.map, x));
  if (!gone.length) return swapIds(panel, r.refs, r.map) as Row;
  const why = r.missing.get(gone[0]) ?? NOT_KEPT;
  const p = r.pointers.get(gone[0]);
  r.waits.push(`${view} (${id}): ${why}`);
  const call = gone.length === 1 && p?.kind === 'result' ? p : undefined; // the one id it showed, a tool's result
  const waiting = call && waitsIn(panel, gone[0], r);
  if (call && waiting) {
    // the same call again fills it, exactly as it comes: in from, or in the field named
    const { rest, fills } = waiting;
    const awaits = {
      tool: call.tool,
      server: call.server,
      ...(call.ref === undefined && isRecord(call.input) ? { input: call.input } : {}),
    };
    const since = session.results.all().length;
    const want = JSON.stringify({ awaits, after: rest.after ?? null });
    const kept = r.again.has(gone[0]) ? { pointer: call } : {}; // read again later, on the next restore or a try again
    session.gates.set(`${view}/${id}`, {
      want,
      since,
      sinceOwn: session.own.length,
      why,
      ...kept,
      ...(fills ? { fills } : {}),
    });
    return { ...rest, id, awaits };
  }
  return {
    id,
    card: 'text',
    ...(typeof panel.title === 'string' ? { title: panel.title } : {}),
    text: `${why}${showed(p)}`,
  };
}

/** A view as restored: each id it points at swapped for the one read again, and each panel on one that was not waiting
 *  for it, saying why. */
export function restoredView(session: Session, args: Record<string, unknown>, r: Restoring): Record<string, unknown> {
  const view = String(args.name);
  const listed = (x: unknown): Row[] => (Array.isArray(x) ? x.filter(isRecord) : []);
  const tabs = listed(args.tabs);
  const all = [...listed(args.panels), ...tabs.flatMap((t) => listed(t.panels))]; // in the order show_view names them
  const ids = new Map(panelIdsOf(all).map((id, i) => [all[i], id]));
  const each = (x: unknown) =>
    Array.isArray(x)
      ? x.map((p) => (isRecord(p) && ids.has(p) ? restoredPanel(session, view, ids.get(p)!, p, r) : p))
      : x;
  return Object.fromEntries(
    Object.entries(args).map(([k, v]) => {
      if (k === 'panels') return [k, each(v)];
      if (k === 'tabs' && Array.isArray(v))
        return [
          k,
          v.map((t) =>
            isRecord(t) ? { ...(swapIds({ ...t, panels: [] }, r.refs, r.map) as Row), panels: each(t.panels) } : t,
          ),
        ];
      return [k, swapIds(v, r.refs, r.map, k)];
    }),
  );
}
