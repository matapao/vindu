import { panelsOf, type PanelSpec, type Resolved, type ViewSpec } from '../cards.js';
import { across } from '../gates.js';
import { queueHook } from './arrivals.js';
import { log, unawaited } from './records.js';
import type { Live, Session } from './state.js';
import { drawAgain, stopWatch, valueIn } from './template-updates.js';

/** After a view is drawn: its live panels' sources are read again by the system (only tools that only read), and a
 *  crosses hook runs once each time its kpi's value goes where it looks. Notes for the model, about live panels. */
export const afterShown = (session: Session, spec: ViewSpec, data: Record<string, Resolved>): string[] => {
  const notes: string[] = [];
  const here = new Set(
    panelsOf(spec)
      .filter((p) => p.live && p.from)
      .map((p) => `${spec.name}/${p.id}`),
  );
  for (const [key, source] of session.lives) {
    for (const panel of source.panels)
      if (panel.startsWith(`${spec.name}/`) && !here.has(panel)) {
        source.panels.delete(panel);
        source.front.delete(panel);
      }
    if (!source.panels.size) {
      stopWatch(session, source.stop); // stopped: nothing keeps the source's last read
      session.lives.delete(key);
    }
  }
  for (const p of panelsOf(spec))
    if (p.live && p.from) {
      const why = startLive(session, spec.name, p);
      if (why) notes.push(`${p.id}: ${why}`);
    }
  (spec.hooks ?? []).forEach((hook, i) => {
    const crosses = hook.when.crosses;
    if (!crosses) return;
    const key = `${spec.name}#${i}`;
    const now = across(crosses, data[crosses.panel]?.value);
    const was = session.hookAt.get(key) ?? false;
    session.hookAt.set(key, now);
    if (now && !was) queueHook(session, spec.name, { crossed: crosses.panel }, i); // once this drawing is done
  });
  return notes;
};
/** A live panel: its source read again every so many seconds by the host (more.watch), from the read it shows. Why not, if not. */
const startLive = (session: Session, view: string, p: PanelSpec): string | undefined => {
  const e = session.results.get(p.from!);
  if (e?.kind !== 'result') return `live reads a result of a tool again; ${p.from} is not one`;
  const root = e;
  const key = JSON.stringify([e.server, e.tool, e.input && typeof e.input === 'object' ? e.input : {}]);
  for (const [k, source] of session.lives)
    if (source.reads.includes(e.id) || k === key) {
      // one source, read again once: another read of the same call (r2 of what r1 read) joins it
      if (!source.reads.includes(e.id)) {
        source.reads.push(e.id);
        session.fresh.set(e.id, session.fresh.get(e.id) ?? e.id);
      }
      source.panels.add(`${view}/${p.id}`);
      if ((p.live as { front?: boolean }).front) source.front.add(`${view}/${p.id}`);
      return undefined;
    }
  if (!session.more.watch) return 'live: this window reads no sources itself';
  if (session.more.isRead?.(root.server, root.tool) !== true)
    return `live: ${root.server}.${root.tool} is not marked by its server as only reading, so the app does not read it again`;
  const live = p.live as { every?: number; front?: boolean };
  const source: Live = {
    server: root.server,
    tool: root.tool,
    args: (root.input && typeof root.input === 'object' ? root.input : {}) as Record<string, unknown>,
    reads: [root.id],
    last: JSON.stringify(valueIn(root)),
    panels: new Set([`${view}/${p.id}`]),
    front: new Set(live.front ? [`${view}/${p.id}`] : []),
    readAt: Date.now(),
    stop: () => undefined,
  };
  session.lives.set(key, source);
  session.fresh.set(root.id, session.fresh.get(root.id) ?? root.id);
  source.stop = session.more.watch(
    { server: source.server, tool: source.tool, args: source.args, after: root.id },
    Math.max(10, live.every ?? 60),
    (id) => unawaited(session, { live: key, read: id }, liveRead(session, source, id)),
    (err) => log(session, { live: key, failed: String(err.message).slice(0, 200) }),
  );
  session.watches.push(source.stop);
  return undefined;
};
/** A live source read again: a read that differs is shown (live panels follow it; others are marked), told to the
 *  model once, and the hooks on it run. */
const liveRead = async (session: Session, source: Live, id: string) => {
  const now = JSON.stringify(valueIn(session.results.get(id)));
  if (now === source.last || source.reads.includes(id)) return;
  source.last = now;
  source.reads.push(id);
  for (const read of source.reads) session.fresh.set(read, id);
  const names = [...session.shown]
    .filter(
      ([name, spec]) =>
        session.specs.has(name) && panelsOf(spec).some((p) => p.from && source.reads.includes(p.from)),
    )
    .map(([name]) => name);
  const extra = await drawAgain(session, names);
  session.shell.say(
    `${source.server}.${source.tool} was read again by the system (${id}) and says something else now${extra}`,
  );
  for (const name of names)
    for (const p of panelsOf(session.shown.get(name)!))
      if (p.live && source.panels.has(`${name}/${p.id}`)) await session.fireHooks(name, { changed: p.id });
};
/** Read a live source now (its view came to the front, or a hook said so), unless it was read in the last 10 seconds. */
export const readNow = async (session: Session, source: Live) => {
  if (!session.more.source || session.closed || Date.now() - source.readAt < 10_000) return;
  source.readAt = Date.now();
  try {
    const id = await session.more.source({ server: source.server, tool: source.tool, args: source.args });
    await liveRead(session, source, id);
  } catch (e) {
    log(session, {
      live: `${source.server}.${source.tool}`,
      failed: String((e as Error).message).slice(0, 200),
    });
  }
};
export const liveOf = (session: Session, view: string, panel: string) =>
  [...session.lives.values()].find((source) => source.panels.has(`${view}/${panel}`));
