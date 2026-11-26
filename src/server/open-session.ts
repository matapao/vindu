import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { Place } from '../layout.js';
import type { Operation } from '../operations.js';
import type { PointItem } from '../pointing.js';
import { remindersFrom } from '../reminders.js';
import { type AnswerEntry, type Entry, withOwn } from '../results.js';
import { Shell, type ShellState } from '../shell.js';
import { ROLES } from '../shell-roles.js';
import { presentationGiven } from './presentation-option.js';
import { templateNote } from '../templates.js';
import type { Presentation } from '../shell-presentation.js';
import type { PartialViewWords } from '../view-words.js';
import { Views } from '../views/views.js';
import { appControls } from './app-events.js';
import { arrived } from './arrivals.js';
import { provideFiles } from './ask-events.js';
import { closeAsks } from './asks.js';
import { checkedCheckpoint, checkedDrafts } from './checkpoint-shape.js';
import { branchNote, checkpoint, restore, snapshotOf, startFrom } from './checkpoints.js';
import type { OpenMore, Shown, UiProcess, ViewCheckpoint, ViewSnapshot } from './contracts.js';
import { wake } from './gates.js';
import { fire } from './hooks.js';
import { hostRequests } from './host-requests.js';
import { hasOf, NOTE, noteViews } from './instructions.js';
import { messagesChanged, settleDraft } from './message-drafts.js';
import { unheard } from './page-messages.js';
import { present } from './present.js';
import { settle } from './receipts.js';
import { closeFiles } from './record-files.js';
import { log, readLines } from './records.js';
import { armRem, askRem, drawRem, REM_PANE, REM_VIEW, remCount, setRem } from './reminders.js';
import type { Endpoints, ServerRuntime } from './runtime.js';
import { readProgressOf } from './read-progress.js';
import { refetchWaiting } from './refetch-waiting.js';
import { stopWaiting } from './render-reports.js';
import { consumeWindowChanges, contextFor, resolved, setPicked } from './selection.js';
import { holdResults, letGoResults, sessionFolder } from './session-folder.js';
import type { Fill, Session } from './state.js';
import { templateControls } from './templates.js';
import { layoutServerFor, serverFor } from './tool-server.js';
import { formatOver, sessionWords, setViewWords, type ViewFormat } from './view-words.js';
import { dispatchEvent } from './window-events.js';

/** Who filled a template's slot, as the model's note says it. */
const FILLED_BY: Record<Fill['by'], string> = { source: 'its source', person: 'the person', model: 'you' };

export function openSession(
  runtime: ServerRuntime,
  endpoints: Endpoints,
  port: number,
  proc: UiProcess,
  onShow: (v: Shown) => void,
  onShell?: (s: ShellState) => void,
  more: OpenMore = {},
) {
  const { host, options: o } = runtime;
  const format = formatOver(runtime.format, { locale: more.locale, timeZone: more.timeZone }); // refused before anything is made
  const token = randomBytes(16).toString('hex');
  const own: AnswerEntry[] = [];
  const results = withOwn(proc.results, { all: () => own });
  const folder = sessionFolder(proc.dir, o.tempDir);
  const inFolder = { ...proc, dir: folder.dir };
  const key = host.add({ ...inFolder, results });
  holdResults(proc.results);
  const session: Session = {
    present: (args, redraw, restoring, committed, anew, by) => present(session, args, redraw, restoring, committed, anew, by),
    fireHooks: (view, event, only) => fire(session, view, event, only),
    resumeWaiting: () => wake(session),
    runtime,
    process: inFolder,
    results,
    key,
    onShow,
    refusals: [],
    pages: new Map(),
    views: new Map(),
    shell: new Shell({ options: o.layout, onChange: onShell, arrange: o.modelArrange }),
    own,
    asks: new Map(),
    keptAsks: new Map(),
    tickets: 0,
    probes: new Map(),
    reads: new Map(),
    waiting: new Map(),
    more,
    viewWords: sessionWords(runtime, more.viewWords),
    format,
    jobs: more.jobs !== false && !!more.onJob,
    added: [],
    told: 0,
    abouts: new Map(),
    heard: new Set(),
    listeners: new Set(),
    sentAt: new Map(),
    saidAt: new Map(),
    reports: new Map(),
    reportWait: new Map(),
    specs: new Map(),
    drawn: new Map(),
    shown: new Map(),
    read: new Map(),
    inputs: new Map(),
    data: new Map(),
    picked: [],
    attached: new Set(),
    drills: new Map(),
    watches: [],
    fresh: new Map(),
    vhistory: new Map(),
    changed: new Map(),
    vsuggest: new Map(),
    vunseen: new Map(),
    receipts: [],
    reminders: o.reminders ? remindersFrom(readLines(path.join(inFolder.dir, 'reminders.jsonl'))) : [],
    cues: new Map(),
    gates: new Map(),
    held: new Map(),
    steps: new Map(),
    lives: new Map(),
    slotWatches: new Map(),
    hookOn: new Map(),
    hookAt: new Map(),
    hookRuns: new Map(),
    hooksDue: [],
    files: new Map(),
    drafts: new Map(),
    savedDrafts: new Map(),
    rereading: new Map(),
  };
  session.shell.setPresentation(presentationGiven(more.presentation, { narrow: more.narrow })); // refused before anything is drawn
  const layoutToken = randomBytes(16).toString('hex');
  endpoints.set(token, () => serverFor(session));
  endpoints.set(layoutToken, () => layoutServerFor(session.shell));

  const pane = (p: {
    name: string;
    title: string;
    subtitle?: string;
    kind: string;
    place?: Place;
    about?: () => unknown;
    chat?: boolean;
  }): string[] => {
    const owner = session.shell.ownerOf(p.name);
    if (owner === 'model') throw new Error(`"${p.name}" is a view the model showed; give the pane another name`);
    if (owner && owner !== 'host')
      throw new Error(`"${p.name}" is one of the window's own panes; give the pane another name`);
    session.abouts.set(p.name, p.about ?? (() => undefined));
    // a terminal or a browser page points its own way (its lines, its elements), so its pane has no chat button
    const chat = p.chat ?? !(p.kind === 'terminal' || p.kind === 'browser');
    return session.shell.show(
      p.name,
      {
        title: p.title,
        ...(p.subtitle ? { subtitle: p.subtitle } : {}),
        fill: true,
        panels: p.kind,
        kind: p.kind,
        role: { ...ROLES.host, chat },
      },
      p.place,
    );
  };

  const unpane = (name: string) => {
    if (session.abouts.delete(name)) session.shell.drop(name);
  };
  const tell = (what: string) => {
    session.shell.tell(what);
    log(session, { person: { elsewhere: what } });
  };

  const requests = hostRequests(session);
  if (more.views)
    session.live = new Views(more.views, {
      cwd: proc.cwd ?? proc.work ?? inFolder.dir,
      dir: inFolder.dir,
      pane: (p) => pane(p as Parameters<typeof pane>[0]),
      unpane,
      tell,
      confirm: requests.confirm,
      log: (e) => log(session, { views: e }),
    });
  if (o.reminders) {
    session.shell.claim(REM_VIEW, REM_PANE);
    session.shell.setReminders(remCount(session));
    armRem(session);
  } // kept from before: due ones now, the next one later

  return {
    url: `http://127.0.0.1:${port}/mcp/${token}`,
    layoutUrl: `http://127.0.0.1:${port}/mcp/${layoutToken}`,
    /** The folder this session writes in while it is open (its records, the pages the model writes, its terminals'
     *  logs): the process's dir, or a temporary folder of its own, gone once it closes. */
    dir: inFolder.dir,
    pages: host.base(key),
    refusals: session.refusals,
    provideFiles: (ticket: string, field: string, register: () => string[]) =>
      provideFiles(session, ticket, field, register),

    ...appControls(session),
    /** The note for the process's first prompt: how the person sees things, with this window's terminals and pages, and
     *  the static view's template if there is one. */
    get note() {
      return (
        NOTE +
        noteViews(hasOf(session.live)) +
        branchNote(session) +
        (session.mode
          ? templateNote(
              session.mode.template,
              Object.fromEntries(
                [...session.mode.fills].map(([n, f]) => [
                  n,
                  `filled by ${FILLED_BY[f.by]}`,
                ]),
              ),
            )
          : '')
      );
    },

    ...templateControls(session),
    /** What the person points at now, as JSON with references (for the chips above the prompt). */
    selection: () => resolved(session),
    /** Add one thing the person pointed at outside the panes' own marks: a browser page's element, terminal lines. */
    point: (it: PointItem) => {
      setPicked(session, [...session.picked, it]);
      return resolved(session).length;
    },
    /** The person points at an element of a browser page: the next click there picks it (without reaching the page),
     *  and it joins what they point at. Null if called off. */
    pointInPage: async (view: string, ms?: number) => {
      const it = await session.live?.pointAt(view, ms);
      if (!it) return null;
      setPicked(session, [
        ...session.picked.filter(
          (x) => !(x.view === view && x.element !== undefined && x.element === it.element),
        ),
        it,
      ]);
      log(session, { person: { points: session.picked.length } });
      return (
        resolved(session).find((x) => x.view === view && x.role === it.role && x.name === it.name) ?? null
      );
    },
    stopPointing: (view: string) => session.live?.stopPointing(view),
    /** What goes with the next message: what the person points at (kept as their answer, then cleared) and the panes in the chat. */
    context: (budget?: number) => contextFor(session, budget),

    /** What the window reports. Anything that does not fit what is shown, or does not come from where it should, is ignored (false). */

    event: (e: unknown, replyToWindow = more.onApp) => dispatchEvent(session, e, replyToWindow),
    shell: () => session.shell.state(),

    ...requests,
    /** An operation added after the process began: the tool list holds still within a session, so the model reaches it through invoke. */
    register: (op: Operation) => {
      session.added.push(op);
    },
    /** This window's terminals and browser pages (more.views): the person opens, shares and ends them here; the
     *  host draws them with @matapao/vindu/renderer/terminal and @matapao/vindu/renderer/browser. */
    views: session.live,
    /** A pane of a kind of the host's own, in the same layout as the views: the renderer draws it with the host's
     *  drawer for its kind (mountShell's panes); look tells the model what it is, from about. Terminals and pages
     *  are such panes too, made by views. */
    pane,
    /** The host's pane leaves the window. */
    unpane,
    /** What the person did inside one of the host's panes, for the model: told once, with the next prompt or look. */
    tell,
    /** A result the host has kept (from the record), said as it comes, for each one: a receipt waiting for this call is
     *  settled by it, the pages that listen hear it at once (once a host says so, they stop asking the store), and
     *  what waits for it goes on. */
    result: (id: string) => {
      void settle(session, id).catch((e) =>
        log(session, { receipt: { result: id, failed: String((e as Error).message) } }),
      );
      arrived(session, session.results.get(id));
    },
    /** The words drawn on this window's views, in place of those it opened with (over the provider's), and with them,
     *  where given, the locale and time zone its numbers and dates are written in (each one given in place of the one it
     *  had): every view shown is drawn again in them at once, where it is. What the model is told stays in English; the
     *  account of a view says the locale it is drawn in. A locale or time zone that is none is refused (a RangeError),
     *  and nothing changes. */
    setViewWords: (words?: PartialViewWords, format?: Partial<ViewFormat>) => setViewWords(session, words, format),
    /** How the window shows what the views hold now (auto, cards or content), and whether it is narrow: each one given
     *  in place of the one it had (open's presentation and narrow). The window draws it at once, and the model's look
     *  says it. One that is none is refused (a RangeError), and nothing changes. */
    setPresentation: (as?: Presentation, o: { narrow?: boolean } = {}) => session.shell.setPresentation(presentationGiven(as, o)),
    /** The host's messageSending says something else now (a mail connection made, or gone): every mail drafted for the
     *  person is drawn again, with Send, or the host's own action in its place. */
    messagesChanged: () => messagesChanged(session),
    /** A send that ended unknown, settled as the person learned on their side (it arrived, or it did not): sent locks
     *  the draft; failed shows the reason (the person's, never the model's) and lets them send it again. The draft is
     *  drawn again, and the model told once, in Vindu's words and forModel alone (plain text, at most 500 characters).
     *  Only for a draft drawn in this window whose last send ended unknown: anything else is refused (false). */
    settleDraft: (id: string, outcome: 'sent' | 'failed', reason?: string, forModel?: string): boolean =>
      settleDraft(session, id, outcome, reason, forModel),
    /** What the person's yeses let go, and how each went. */
    receipts: () => session.receipts.map((r) => ({ ...r })),
    /** How far the person has read each panel of the views shown, now: for the host alone, never the model. */
    readProgress: () => readProgressOf(session),
    /** The view as it is now, for a new process (or a fresh run of this one) to start from. */
    checkpoint: (): ViewCheckpoint => checkpoint(session),
    /** A new task restored from a checkpoint the host kept: refused, with why, if it is not one. The way to open the
     *  same task again (after a restart, say): its results read again, and the person's own state of its views, their
     *  drafts among it (a sent one sent and read-only, under its id; one being sent as unknown). */
    restore: (saved: ViewCheckpoint) => restore(session, checkedCheckpoint(session, saved)),
    /** Every panel that waits because the host could not read its result again (on restore, or since), read again now
     *  through refetch, by the same rules as restore (the computer back online, say): those that fill are drawn in
     *  place, and the model is told once; the rest wait, saying why now. How many filled, and how many still wait.
     *  Without refetch, nothing is read. A call while one runs shares it. The person's Try again on such a panel does
     *  the same for that panel alone. */
    refetchWaiting: () => refetchWaiting(session),
    snapshot: (): ViewSnapshot => snapshotOf(session),
    /** Start this window from another process's view: the host carried its results and attachments into this process's
     *  record (carried: their ids there → here); the person's answers are kept again here; every id in the views is
     *  replaced by this process's; the views are shown as they were, in their layout, with their marks; and the first
     *  prompt's note says where they came from and what was done in them. A view whose entries were not carried
     *  is left out, and says why. The person's drafts in them come as restore brings them back (a sent one sent and
     *  read-only, under its id; one being sent as unknown); drafts that are not a snapshot's are refused, with why. */
    startFrom: (snap: ViewSnapshot, carried: Record<string, string>) =>
      startFrom(session, { ...snap, drafts: checkedDrafts(snap.drafts) }, carried),
    /** The process's reminders, as they are now. */
    reminders: () => session.reminders.map((r) => ({ ...r })),
    /** A reminder from the host's own control (a menu, say) for the person, with when worked out as for the model;
     *  or why it cannot be. ask: the person's form instead, drawn in the window. */
    remind: (x?: { what: string; when: string; about?: string }, who?: string) => {
      if (!o.reminders) return { refusal: 'this window keeps no reminders' };
      if (!x) {
        askRem(session);
        return { asked: true };
      }
      const r = setRem(session, x, 'person', who);
      if (!('refusal' in r))
        session.shell.say(`${who ?? 'the person'} set reminder ${r.id}: "${r.what}" for ${r.said}`);
      return r;
    },
    /** Bring the Reminders pane before the person (they clicked a reminder's notification, say). */
    showReminders: () => {
      if (o.reminders) drawRem(session, true);
    },
    /** What changed in the window since the model last heard, for the next prompt: the person's moves and answers. */
    delta: (budget = 1200) => consumeWindowChanges(session, budget),
    answers: (): readonly Entry[] => own,
    /** What pages sent while the person used them that the model has not heard yet: a host may start a turn for it. */
    unheard: () =>
      unheard(session).map((a) => ({
        id: a.id,
        view: a.from!.view,
        panel: a.from!.panel,
        sent: a.values?.sent,
        at: a.at,
      })),
    /** The task is done here: nothing reads, waits or asks for it any longer, and what it wrote from results is gone: its
     *  folder (or Vindu's files in the process's own dir), and the pictures of a store no other session reads. Whatever
     *  was still waiting has its answer now (cancelled, or nothing came), so no call is left hanging. */
    close: () => {
      if (session.closed) return;
      session.closed = true;
      endpoints.delete(token);
      endpoints.delete(layoutToken);
      clearTimeout(session.remTimer);
      for (const stop of session.watches.splice(0)) stop();
      session.lives.clear();
      session.slotWatches.clear();
      session.held.clear();
      session.hooksDue.length = 0;
      closeAsks(session);
      stopWaiting(session);
      for (const listener of session.listeners) listener();
      session.live?.close();
      host.remove(key);
      closeFiles(session);
      folder.remove();
      letGoResults(proc.results);
    },
  };
}
