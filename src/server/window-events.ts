import { isPane, nodeAt, viewsOf } from '../layout.js';
import { routeAppMessage } from './app-events.js';
import { answerFromWindow } from './ask-events.js';
import { answered } from './asks.js';
import { readNow } from './live-panels.js';
import { personRuns } from './operations.js';
import { pageSaid, sent } from './page-messages.js';
import { readFromWindow } from './read-progress.js';
import { log, unawaited, whoOf } from './records.js';
import { askRem, doRem, drawRem, isRemindersPane } from './reminders.js';
import { compare, reported } from './render-reports.js';
import type { Session } from './state.js';
import { asText } from '../format.js';

export function dispatchEvent(session: Session, e: unknown, replyToWindow = session.more.onApp): boolean {
  const more = session.more;
  if (session.closed) return false;
  const x = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>;

  const handled = updateView(session, x);
  if (handled !== undefined) return handled;
  if (x.type === 'action' && isRemindersPane(session, x.view)) {
    // the Reminders pane: done, put off, dropped, or a new one
    const ctx = (x.context ?? {}) as Record<string, unknown>;
    if (x.name === 'reminder' && ctx.do === 'ask') {
      // into the person's prompt box, unsent: they send it, or not
      const r = session.reminders.find((y) => y.id === ctx.id);
      if (!r || r.state !== 'due') return false;
      more.onSuggest?.(
        `Reminder ${r.id} is due: "${r.what}"${r.about ? ` (about ${r.about})` : ''}. What should be done now?`,
      );
      log(session, { person: { reminder: r.id, asked: true } });
      return true;
    }
    if (x.name === 'reminder')
      return !(
        'refusal' in doRem(session, asText(ctx.id ?? ''), asText(ctx.do ?? ''), 'person', whoOf(x).name)
      );
    if (x.name === 'reminder_new') {
      askRem(session);
      return true;
    }
    return false;
  }

  if (x.type === 'action') return answerFromWindow(session, x);
  if (x.type === 'rendered') return compare(session, x);
  if (x.type === 'send') return sent(session, x);
  if (x.type === 'report') return reported(session, x);
  if (x.type === 'read') return readFromWindow(session, x); // for the host alone: never told the model, nor logged as the person's

  if (x.type === 'app') return routeAppMessage(session, x, replyToWindow);
  if (x.type === 'reminders') {
    if (!session.runtime.options.reminders) return false;
    drawRem(session, true);
    return true;
  } // the bar's chip
  if (x.type === 'operation')
    return (
      typeof x.name === 'string' &&
      personRuns(
        session,
        x.name,
        x.input && typeof x.input === 'object' ? (x.input as Record<string, unknown>) : {},
      )
    );
  if (x.type === 'close') {
    // closing an ask's pane is no answer, in a pane or in the shelf: it leaves the window, and no layout change is told
    const p = [...session.asks.values()].find((q) => q.view === x.view);
    if (p) {
      answered(session, p, { action: 'cancel' });
      log(session, { person: e });
      return true;
    }
  }
  const ok = session.shell.event(e);
  const t = x.type; // an ask collapsed into the shelf is still asked
  if (ok && (t === 'focus' || t === 'open' || t === 'show' || t === 'front')) {
    // a view comes to the front: its live panels that say so are read again
    const views =
      t !== 'front'
        ? [asText(x.view ?? '')]
        : (() => {
            const st = session.shell.state();
            const at = nodeAt(st.tree, (x.path as number[]) ?? []);
            return at && !isPane(at) ? viewsOf(at.children[Number(x.index)] ?? null) : [];
          })();
    for (const L of session.lives.values())
      if ([...L.front].some((k) => views.includes(k.split('/')[0]))) void readNow(session, L);
  } // collapsing an ask's pane keeps it asked, in the shelf
  if (ok && t !== 'window' && t !== 'measure' && t !== 'focus') log(session, { person: e });
  return ok;
}

import { ACTIONS, type ViewAction } from '../actions.js';
import type { PointItem } from '../pointing.js';
import { drillBack, drillIn, setInputs, setPicked } from './selection.js';
import { act, personAct, viewAction } from './view-actions.js';
import { hookDigest, hookIsOn } from './view-state.js';

function updateView(session: Session, x: Record<string, unknown>): boolean | undefined {
  const more = session.more;
  if (x.type === 'action' && x.name === 'set_inputs') return setInputs(session, x); // what-ifs, from a view's own pane
  if (x.type === 'action' && x.name === 'view_action' && typeof x.view === 'string')
    return personAct(session, x.view, viewAction((x.context ?? {}) as Record<string, unknown>), whoOf(x)); // a column's head, say
  if (x.type === 'view' && typeof x.view === 'string') {
    // inside a view: a process moved, a slide; or a mark's undo, take or dismiss
    const view = x.view;
    const sg = session.vsuggest.get(view);
    if (x.action === 'take') {
      if (!sg) return false;
      session.vsuggest.delete(view);
      void act(session, view, sg, 'model', (what) =>
        session.shell.say(`the person took your suggestion in "${view}": ${what}`),
      ).catch((e) => log(session, { person: { view, take: sg.what, failed: String((e as Error).message) } }));
      return true;
    }
    if (x.action === 'dismiss') {
      if (!sg) return false;
      session.vsuggest.delete(view);
      session.shell.mark(view, undefined);
      session.shell.say(`the person did not take your suggestion in "${view}" (${sg.what})`);
      return true;
    }
    if (!ACTIONS.includes(x.action as ViewAction['action'])) return false;
    return personAct(session, view, viewAction(x), whoOf(x));
  }
  if (x.type === 'select' && Array.isArray(x.items)) {
    const items = (x.items as PointItem[]).map((it) =>
      it && typeof it.text === 'string' && session.live?.kindOf(it.view) === 'terminal' && !it.command
        ? { ...it, command: session.live.commandOf(it.view, it.text) }
        : it,
    );
    setPicked(session, items);
    session.pointedBy =
      x.from && typeof x.from === 'object' ? (x.from as { name: string; window: string }) : undefined;
    log(session, { person: { points: session.picked.length } });
    return true;
  }
  if (x.type === 'attach' && typeof x.view === 'string') {
    // in the chat only where the pane's role says so (an ask's pane, a reserved one and a terminal do not), whatever a
    // host's window drew; out of it, always
    if (x.on && !session.shell.viewOf(x.view)?.role.chat) return false;
    if (x.on) session.attached.add(x.view);
    else session.attached.delete(x.view);
    session.shell.setPicked(session.picked, [...session.attached]);
    log(session, { person: { attach: x.view, on: !!x.on } });
    return true;
  }
  if (x.type === 'drill') {
    void drillIn(session, x).catch((e) => log(session, { drill: String((e as Error).message) }));
    return session.shown.has(asText(x.view ?? ''));
  }
  if (x.type === 'action' && x.name === 'drill_back') {
    const view = asText(x.view ?? '');
    const back = session.drills.has(view);
    unawaited(session, { drill_back: view }, drillBack(session, view));
    return back;
  }
  if (x.type === 'action' && x.name === 'hook') {
    // a hook's job: the person turns it on, or off
    const view = asText(x.view ?? '');
    const spec = session.shown.get(view);
    const c = (x.context ?? {}) as { n?: unknown; on?: unknown };
    const n = Number(c.n);
    const h = Number.isInteger(n) ? spec?.hooks?.[n] : undefined;
    const args = session.specs.get(view);
    if (!h?.do.job || !args || !session.jobs) return false;
    const on = c.on === true;
    if (hookIsOn(session, view, n, h) === on) return false;
    if (on) session.hookOn.set(`${view}#${n}`, hookDigest(h)); // this hook, as it is now: any other is not turned on
    else session.hookOn.delete(`${view}#${n}`);
    // said as it is done, before the view is drawn again: what the model is told never waits on a drawing
    session.shell.say(
      `${whoOf(x).name} turned ${on ? 'on' : 'off'} the job of hook ${n} in ${spec!.title}: ${h.label ?? h.do.job.prompt}`,
    );
    log(session, { person: { view, hook: n, on } });
    redraw(session, view, args);
    return true;
  }
  if (x.type === 'action' && x.name === 'step') {
    // a view with steps: the person goes on, or back
    const view = asText(x.view ?? '');
    const spec = session.shown.get(view);
    const args = session.specs.get(view);
    const to = Number((x.context as { to?: unknown } | undefined)?.to);
    if (!spec?.step || !args || !Number.isInteger(to) || to < 1 || to > spec.step.of || to === spec.step.at)
      return false;
    session.steps.set(view, to);
    session.shell.say(`${whoOf(x).name} went to step ${to} of ${spec.step.of} in ${spec.title}`);
    log(session, { person: { view, step: to } });
    redraw(session, view, args);
    return true;
  }
  if (x.type === 'action' && x.name === 'suggest') {
    // into the person's prompt box, unsent; they send it or not
    const c = (x.context ?? {}) as { label?: unknown; prompt?: unknown };
    const spec = session.shown.get(asText(x.view ?? ''));
    if (!spec?.suggestions?.some((sg) => sg.prompt === c.prompt)) return false;
    more.onSuggest?.(String(c.prompt));
    log(session, { person: { suggestion: c.label, view: x.view } });
    session.shell.tell(`took the suggestion "${String(c.label)}" in ${spec.title}`);
    return true;
  }
  if (x.type === 'page' && typeof x.view === 'string') return pageSaid(session, x); // vindu.select, vindu.ask

  return undefined;
}

/** A view drawn again by the system for what the person did in it: where it is, shown or hidden. */
const redraw = (session: Session, view: string, args: Record<string, unknown>) =>
  void session.present(args, true).catch((e) => log(session, { redraw: view, failed: String((e as Error).message) }));
