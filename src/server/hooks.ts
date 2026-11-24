import { type Hook, panelTitle } from '../cards.js';
import { type HookEvent, hookMatches, hookWords } from '../gates.js';
import { snapshotOf } from './checkpoints.js';
import { liveOf, readNow } from './live-panels.js';
import { log } from './records.js';
import type { Session } from './state.js';
import { hookIsOn } from './view-state.js';

/** Something happened in a view: each hook on it runs (only, when only is given): it offers a prompt, tells the
 *  person, reads a live panel again, or starts a job the person turned on, within its budget. Told to the model once. */
export const fire = async (session: Session, view: string, ev: HookEvent, only?: number): Promise<void> => {
  const spec = session.shown.get(view);
  if (!spec?.hooks?.length || session.closed || session.more.hooks === false) return;
  const titleOf = (id: string) => panelTitle(spec, id);
  for (const [i, h] of spec.hooks.entries()) {
    if (only !== undefined ? i !== only : !hookMatches(h, ev)) continue;
    const did: string[] = [];
    if (h.do.cue) {
      session.cues.set(view, [
        ...(session.cues.get(view) ?? []).filter((c) => c.label !== h.do.cue!.label),
        { label: h.do.cue.label, prompt: h.do.cue.prompt },
      ]);
      did.push(`offered "${h.do.cue.label}" on its pane`);
    }
    if (h.do.notify) {
      try {
        session.more.onNotice?.({ view, title: spec.title, text: h.do.notify });
      } catch (e) {
        log(session, { hook: view, notice: String((e as Error).message) });
      }
      did.push(`told the person: ${h.do.notify}`);
    }
    if (h.do.read) {
      const L = liveOf(session, view, h.do.read);
      if (L) {
        void readNow(session, L); // no more often than any read of it: a hook it sets off itself does not read it on and on
        did.push(`read ${titleOf(h.do.read)} again`);
      } else did.push(`could not read ${h.do.read} again: it is not a live panel`);
    }
    if (h.do.job) did.push(await job(session, view, i, h));
    if (h.do.cue) {
      const args = session.specs.get(view);
      if (args) {
        await session
          .present(args, true)
          .catch((e) => log(session, { hook: view, redraw: String((e as Error).message) }));
      }
    }
    log(session, { hook: { view, n: i, when: ev, did } });
    session.shell.say(`in ${spec.title}, the system ${did.join('; ')} (hook ${i}: ${hookWords(h, titleOf)})`);
  }
};
/** A hook's job: only once the person turned it on, as it is now, where this process may start jobs, within its budget
 *  (a job the host did not start costs none of it). What happened. */
const job = async (session: Session, view: string, i: number, h: Hook): Promise<string> => {
  const k = `${view}#${i}`;
  const onJob = session.jobs ? session.more.onJob?.bind(session.more) : undefined;
  if (!onJob) return 'did not start its job: jobs are off here';
  if (!hookIsOn(session, view, i, h)) return 'did not start its job: the person has not turned it on';
  const day = Date.now() - 86_400_000;
  const runs = (session.hookRuns.get(k) ?? []).filter((t) => t > day);
  const per = session.runtime.options.jobs?.perDay ?? 3;
  if (runs.length >= per)
    return `did not start its job: it has run ${runs.length} times in the last day, its budget (${per})`;
  const at = Date.now();
  runs.push(at); // held while the host decides, so jobs set off together stay within the budget
  session.hookRuns.set(k, runs);
  const j = h.do.job!;
  const r = await onJob({
    view,
    hook: i,
    label: h.label ?? j.prompt.slice(0, 60),
    prompt: j.prompt,
    ...(j.connectors ? { connectors: j.connectors } : {}),
    writes: !!j.writes,
    snapshot: snapshotOf(session),
  }).catch((e): { id?: string; refused?: string } => ({ refused: String((e as Error).message ?? e) }));
  if (!r.id) {
    const kept = session.hookRuns.get(k) ?? [];
    const mine = kept.indexOf(at);
    if (mine >= 0) kept.splice(mine, 1);
  }
  return r.id
    ? `started its job, as the task ${r.id} (${j.writes ? "it may change data, each change after the person's yes" : 'it only reads'})`
    : `did not start its job: ${r.refused ?? 'the host did not say why'}`;
};
