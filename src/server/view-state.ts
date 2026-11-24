// What the session keeps of each view besides what it shows, and when it goes: the changes made inside it (for undo),
// what the system offered on its pane, the person's yes to each of its hooks' jobs, how far the person has read it, and,
// once a view leaves the window for good, everything it was shown with.
import type { Hook } from '../cards.js';
import { dropDrafts } from './message-drafts.js';
import { stableJson } from './records.js';
import type { Session } from './state.js';

/** The changes made inside a view, and the mark on its pane: gone with the view they were made in. */
export const forget = (session: Session, view: string) => {
  session.vhistory.delete(view);
  session.vsuggest.delete(view);
  session.vunseen.delete(view);
  session.shell.mark(view, undefined);
};

/** A view's own state, kept by hook number (view#n): its hooks' switches and where a crosses hook looks. */
const forHooks = (session: Session, view: string) => {
  for (const map of [session.hookOn, session.hookAt])
    for (const k of map.keys()) if (k.slice(0, k.lastIndexOf('#')) === view) map.delete(k);
};

/** The model showed a view anew under a name: what was made inside the old one, offered on it, and the person's yes to
 *  its hooks' jobs go with it, so nothing the person allowed carries over to what the model wrote in its place; and so
 *  does how far they have read it, as what they read was the old. */
export const shownAnew = (session: Session, view: string) => {
  forget(session, view);
  forHooks(session, view);
  session.cues.delete(view);
  session.read.delete(view);
};

/** A hook as the person saw it when they turned its job on: all of it (when, what it does, its job's prompt, connectors
 *  and writes, its label), so any change to it is another hook, which the person has not turned on. */
export const hookDigest = (h: Hook): string => stableJson(h);
/** Whether the person turned on this hook's job, as it is now. */
export const hookIsOn = (session: Session, view: string, n: number, h: Hook | undefined): boolean =>
  !!h && session.hookOn.get(`${view}#${n}`) === hookDigest(h);

/** A view leaves the window for good (an ask's preview, with its ask): its pane, and all it was shown with. */
export const dropView = (session: Session, view: string) => {
  session.shell.drop(view);
  shownAnew(session, view);
  for (const map of [session.specs, session.drawn, session.shown, session.data, session.probes, session.reads])
    map.delete(view);
  for (const id of session.views.get(view) ?? []) {
    session.reports.delete(`${view}/${id}`);
    session.pages.delete(`${view}/${id}`);
  }
  session.views.delete(view);
  dropDrafts(session, view);
  session.steps.delete(view);
  session.drills.delete(view);
  for (const k of [...session.inputs.keys(), ...session.gates.keys()])
    if (k.startsWith(`${view}/`)) {
      session.inputs.delete(k);
      session.gates.delete(k);
    }
};
