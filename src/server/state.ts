import type { Probe } from '../a2ui.js';
import type { Account } from '../account.js';
import type { ViewAction } from '../actions.js';
import type { After, Resolved, ViewSpec } from '../cards.js';
import type { HookEvent } from '../gates.js';
import type { Approval, Ask, Binding, Operation } from '../operations.js';
import type { WindowReport } from '../page-report.js';
import type { PointItem } from '../pointing.js';
import type { Reminder } from '../reminders.js';
import type { AnswerEntry, ResultSource } from '../results.js';
import { Shell } from '../shell.js';
import type { Template } from '../templates.js';
import type { ViewWords } from '../view-words.js';
import { Views } from '../views/views.js';
import type { OpenMore, Shown, UiProcess } from './contracts.js';
import type { KeptDraft, SavedDraft } from './message-drafts.js';
import type { RecordFile } from './record-files.js';
import type { ServerRuntime } from './runtime.js';

/** A page for check_page to read: where it is, how it is named, the results it reads, and whether it runs nothing. */
export type Page = { url: string; label: string; uses: string[]; static?: true };
export type Outcome =
  | { action: 'accept'; values: Record<string, unknown>; n?: number }
  | { action: 'decline' }
  | { action: 'cancel' };
export type Pending = {
  ask: Ask;
  view: string;
  binding: Binding;
  settle: (o: Outcome) => void;
  outcome: Promise<Outcome>;
  finished: Promise<Record<string, unknown>>;
  done?: Record<string, unknown>;
  need: number;
  approvals: Approval[];
  values?: Record<string, unknown>; // what the first yes submitted: what each yes after it approves
  n?: number; // and, for a choice, its place
  call?: { server: string; tool: string; input: unknown; label: string }; // the processor's call this ask is for, when the host says which
  approves?: (o: Outcome) => boolean;
}; // whether an answer is a yes: its preview then stays, as a receipt
/** What a yes let go, beside where its ask was: what was approved, who said yes, and once it went, whether it went as approved. */
export type Receipt = {
  view: string;
  ticket: string;
  call?: Pending['call'];
  input: unknown;
  entry: string;
  who: string;
  at: string;
  label: string;
  state: 'waiting' | 'went' | 'differs' | 'failed' | 'done';
  went?: string;
};
/** What the window has read back of one showing of a view, merged across reads: each probe as last read, and the tab open. */
type Read = {
  seq: number;
  surface: 'wide' | 'compact';
  tab?: number;
  got: Map<
    number,
    { text: string | null; visible: boolean; frame?: { w: number; h: number; loaded: boolean } }
  >;
};
export type Session = {
  /** committed: called once the view has passed its checks and is shown, before anything is awaited; anew: the
   *  model's view in place of the one under its name, what was made or allowed in the old going with it (present.ts). */
  present(
    args: Record<string, unknown>,
    redraw?: boolean,
    restoring?: boolean,
    committed?: () => void,
    anew?: boolean,
  ): Promise<Account>;
  fireHooks(view: string, event: HookEvent, only?: number): Promise<void>;
  resumeWaiting(): Promise<void>;
  runtime: ServerRuntime;
  process: UiProcess & { dir: string }; // dir: the folder it writes in while it is open (session-folder.ts)
  results: ResultSource;
  key: string;
  onShow: (v: Shown) => void;
  refusals: string[];
  pages: Map<string, Page>;
  views: Map<string, string[]>;
  shell: Shell;
  own: AnswerEntry[];
  asks: Map<string, Pending>;
  keptAsks: Map<string, Pending>; // every ask by ticket, kept for await_answer once it is answered
  tickets: number;
  probes: Map<string, { seq: number; wide: Probe[]; compact: Probe[]; tabs: string[] }>;
  reads: Map<string, Read>;
  waiting: Map<string, Set<(v?: unknown) => void>>; // who waits for the window to read a view back, by view
  more: OpenMore;
  viewWords: ViewWords; // the words its views are drawn in: the session's own over the provider's (view-words.ts)
  jobs: boolean; // whether a hook's job may start here: the host starts jobs (onJob), and this is not a job's own process
  added: Operation[];
  told: number;
  heard: Set<string>;
  listeners: Set<() => void>;
  sentAt: Map<string, number[]>; // what pages sent: heard by the model, who waits, how often
  saidAt: Map<string, number[]>; // what pages said with vindu.select and vindu.ask, by view: how often
  reports: Map<string, WindowReport>;
  reportWait: Map<string, Set<(r?: WindowReport) => void>>; // how each page panel runs in the person's window, by view/panel and by panel
  abouts: Map<string, () => unknown>; // the host's panes (terminals, pages, its own kinds): what each is, for look
  live?: Views; // the process's terminals and browser pages: views that live on the host
  specs: Map<string, Record<string, unknown>>; // what the model sent for each view, to show it again (inputs, drills)
  drawn: Map<string, Record<string, unknown>>; // the system's own panes (an ask's preview, then its receipt) as it drew them
  watches: (() => void)[]; // sources kept fresh: each one's stop
  fresh: Map<string, string>; // every read of a source kept fresh: that source's newest read
  vhistory: Map<string, { args: Record<string, unknown>; by: 'person' | 'model'; what: string }[]>; // each view's changes inside it, for undo
  vsuggest: Map<string, ViewAction & { what: string }>; // a change inside a view the model suggested, for the person to take or not
  vunseen: Map<string, string[]>; // the person's changes inside a view the model has not been told of yet
  receipts: Receipt[]; // what the person's yeses let go, and how it went
  reminders: Reminder[];
  remTimer?: ReturnType<typeof setTimeout>; // the process's reminders (reminders.jsonl), and the next one's timer
  cues: Map<string, { label: string; prompt: string }[]>; // what the system noticed about a view, offered on its pane as a prompt to take
  branch?: {
    views: string[];
    map: Record<string, string>;
    changes: string[];
    refused: Record<string, string>;
  }; // started from another process's view
  closed?: boolean;
  pointedBy?: { name: string; window: string }; // who pointed, as the host says (not verified)
  shown: Map<string, ViewSpec>; // each view as last shown, with its panels' ids
  read: Map<string, Map<string, { read: number; told: number }>>; // by view and panel: how far the person has read it, and what the host was told of it
  inputs: Map<string, { set: Record<string, number>; defaults: Record<string, number> }>; // view/panel: the person's what-ifs
  mode?: StaticMode; // a static view: the template, its inputs, and what filled each slot
  data: Map<string, Record<string, Resolved>>; // each view's panels as last resolved: what pointing refers into
  picked: PointItem[]; // what the person points at now (chips above the prompt)
  attached: Set<string>; // panes the person put "in the chat": each message carries them
  drills: Map<string, Record<string, unknown>[]>; // a view drilled into: what it was, each step back
  gates: Map<string, Gate>; // view/panel: a panel that waits, since when, and the result that came
  held: Map<string, Gate & { args: Record<string, unknown>; title: string; after: After }>; // views written up front, held until what they are after
  steps: Map<string, number>; // a view with steps: how many of its panels are shown
  lives: Map<string, Live>; // live panels' sources, read again by the system, by source
  slotWatches: Map<string, () => void>; // a static view's slots kept fresh from their sources: each one's stop, by slot
  hookOn: Map<string, string>; // view#n: a hook's job the person turned on, as the whole hook was then (hookDigest)
  hookAt: Map<string, boolean>; // view#n: a crosses hook's value is where it looks
  hookRuns: Map<string, number[]>; // view#n: when its job ran, for its budget
  hooksDue: { view: string; event: HookEvent; only?: number }[]; // hooks set off, to run in order once what set them off is done
  files: Map<RecordFile, number>; // the session's files with its process, each open from its first line until close
  drafts: Map<string, KeptDraft>; // view/panel: the person's draft of each mail drafted for them (message-drafts.ts)
  savedDrafts: Map<string, SavedDraft>; // view/panel: a draft a checkpoint kept, until its view draws the same mail again
  waking?: Promise<void>;
  wakeAgain?: boolean; // a wake running, and whether another is due after it
};
/** What a panel or a held view waits for, and since when: the process's entries and the person's answers at that moment;
 *  why, when the system made it wait (a restored panel whose result was not read again). */
export type Gate = { want: string; since: number; sinceOwn: number; got?: string; why?: string };
/** A live panel's source: what is read again, every read of it so far, what the last said, who shows it, and its stop. */
export type Live = {
  server: string;
  tool: string;
  args: Record<string, unknown>;
  reads: string[];
  last: string;
  panels: Set<string>;
  front: Set<string>;
  readAt: number;
  stop: () => void;
};
export type Fill = {
  by: 'source' | 'model' | 'person';
  id?: string;
  at: string;
  approved?: string[];
  declined?: boolean;
  failed?: string;
};
export type StaticMode = { template: Template; inputs: Record<string, unknown>; fills: Map<string, Fill> };
