import type { Probe, Surface } from '../a2ui.js';
import type { AppsProvider, AppsSwitch } from '../apps.js';
import type { CardDef } from '../cards.js';
import type { PreviewRule } from '../frames.js';
import type { LayoutOptions } from '../layout.js';
import type { DraftFile, DraftFormat, DraftOriginal, SendResult } from '../message-draft.js';
import type { Ask, Binding, Operation, Words } from '../operations.js';
import type { PageDriver } from '../page-check.js';
import type { HeadText, Library } from '../pages.js';
import type { PointItem } from '../pointing.js';
import type { ViewPresentation } from '../presentation.js';
import type { Reminder, ReminderWords } from '../reminders.js';
import type { AnswerEntry, Entry, ResultSource } from '../results.js';
import type { ModelArrange, ShellState, ViewMark } from '../shell.js';
import type { Template } from '../templates.js';
import type { PartialViewWords } from '../view-words.js';
import type { ViewsSetup } from '../views/views.js';
import type { SavedDraft } from './message-drafts.js';
import type { Fill, Gate } from './state.js';

/** What the window gets for each view: its two surfaces; what to read back after drawing (probes) and which showing it is
 *  (seq); and, for an ask, the ask itself, for a host that draws asks its own way. */
export type Shown = {
  name: string;
  wide: Surface;
  compact: Surface;
  seq?: number;
  probes?: { wide: Probe[]; compact: Probe[] };
  ask?: Ask;
};
/** A process's view as it is, for another process (or a fresh run) to start from: each view of cards as shown, with the
 *  person's changes inside it and its mark; the layout; what the person points at; what was done; the results and
 *  attachments the views point at (ids, for the host to carry); the person's answers they point at; and their drafts
 *  in those views, as a checkpoint keeps them (a sent one stays sent, under its id; one being sent is kept as unknown). */
export type ViewSnapshot = {
  at: string;
  views: { name: string; title: string; args: Record<string, unknown>; mark?: ViewMark }[];
  layout: unknown;
  ids: string[];
  answers: AnswerEntry[];
  changes: string[];
  picked: PointItem[];
  drafts?: SavedDraft[];
};
/** How far the person has read one panel of a view: the furthest share of it they have had in view, from 0 to 1, as the
 *  window measures it (renderer/shell-reading.ts). For the host alone: the model is never told. */
export type ReadProgress = { view: string; panel: string; read: number };
/** What a checkpoint keeps of a result or an attachment the views point at, to read it again on restore: where it came
 *  from, never what it held. A result by its server, its tool and the input it was called with, or by the host's own
 *  ref where the entry has one (and then without its input); an attachment by the file the person gave. id: what the
 *  checkpoint's views call it. */
export type ResultPointer =
  | { id: string; kind: 'result'; server: string; tool: string; input?: unknown; ref?: string }
  | { id: string; kind: 'attachment'; name: string; mime: string; file: string };
/** One of the person's own answers, as a checkpoint keeps it for the views and waits that point at it: what they gave,
 *  never what a call returned with it (an answer's output) nor what they pointed at (read from results). */
export type KeptAnswer = { id: string; to: string; values: Record<string, unknown> | null; who?: string[]; at: string };
/** The view as the person left it, for a task opened again: the model's views, the layout and the person's own state of
 *  them (their what-ifs, steps, drafts as they changed them, how far they read, their reminders and the answers the
 *  views point at), and a pointer to each result and attachment the views show (pointers), read again on restore
 *  through the host's refetch. It never holds what a result held: its rows, values, text or pictures. */
export type ViewCheckpoint = {
  views: ViewSnapshot['views'];
  layout: unknown;
  arrangement: Pick<ShellState, 'shelf' | 'recent' | 'focus' | 'maximized'>;
  picked: PointItem[];
  attached: string[];
  inputs: [string, { set: Record<string, number>; defaults: Record<string, number> }][];
  fresh: [string, string][];
  steps: [string, number][];
  gates: [string, Gate][];
  tickets: number;
  mode?: { template: Template; inputs: Record<string, unknown>; fills: [string, Fill][] };
  /** How far each panel of each view has been read: by view, each panel's share. */
  read?: [string, [string, number][]][];
  drafts?: SavedDraft[]; // the person's drafts of the mails drafted for them, as they changed them, and how each send went (a ViewSnapshot's the same)
  pointers?: ResultPointer[];
  answers?: KeptAnswer[];
  reminders?: Reminder[]; // the process's reminders, as the Reminders pane has them
};
export type { HeadText }; // a file of the working folder as the last commit has it, or why not
/** One process, as Vindu sees it: its results, a folder for what Vindu writes while its session is open, and its working
 *  folder if it has one, where the window reads it (work). Without dir, the session makes a temporary folder of its own
 *  (under tempDir), readable by this user alone. Either way, what Vindu writes there goes when the session closes, or as
 *  the process exits: its records (ui-calls.jsonl, answers.jsonl, reminders.jsonl), the pages the model writes (views)
 *  and its terminals' logs (terminals); the host's own files in a dir of its own stay. When the processor runs
 *  elsewhere (in a box), work is a copy here: cwd is the folder where the processor is, for its terminals. head gives each file as the last commit has it, for diff
 *  panels: Vindu runs no git of its own, so without head a diff panel says there is nothing to compare with. Pass
 *  gitHead(work) to read the folder's own repository with git, hardened (plumbing only, no fetch, git 2.45 or later):
 *  running git on a folder the model and what it clones can write in is the host's decision. */
export type UiProcess = {
  results: ResultSource;
  dir?: string;
  work?: string;
  cwd?: string;
  head?: (rel: string) => HeadText;
  sync?: () => Promise<void>;
}; // the copy brought up to date with the folder there, before a show or a check reads it

/** A mail the person sends from the window (a message block's draft, its Send pressed): a stable id for this draft
 *  (the same through the person's changes and every try, and in the task opened again, for the host to key its own
 *  record on), the view and panel it is in, its fields exactly as the person sees them, the mail it replies to (with
 *  in_reply_to.ref, the host's own reference to it, where the model passed one through, for threading the reply), the
 *  files it attaches (each its path in the working folder, its name and size, read by the system as Send was pressed),
 *  and who pressed Send, as the window says. */
export type MessageDraft = {
  id: string;
  view: string;
  panel: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  format: DraftFormat;
  in_reply_to?: DraftOriginal;
  attachments: DraftFile[];
  by: { name: string; window: string };
};
/** What a host adds when it opens a process: MCP Apps (their servers, reached through the host), and what an app asks of the person. */
export type OpenMore = {
  apps?: AppsProvider;
  onApp?: (view: string, panel: string, msg: Record<string, unknown>) => void;
  /** A renderer-independent projection of each resolved card view, including updates from the person and from tools. */
  onPresentation?: (view: ViewPresentation) => void;
  /** How far the person has read a panel grew: by 0.05 at least since the last call for it, or to 1 (read). For the host
   *  alone, the model is never told; ui.readProgress() gives every panel's now. A host that draws views itself sends
   *  { type: 'read', view, seq, read: { [panel]: share } } through ui.event. */
  onReadProgress?: (r: ReadProgress) => void;
  onAppMessage?: (text: string) => Promise<void> | void;
  onOpenLink?: (url: string) => Promise<void> | void;
  onAskGone?: (view: string, action: 'accept' | 'decline' | 'cancel') => void; // an ask has left: answered, declined, or no longer waited on
  onSend?: (view: string, sent: AnswerEntry) => void; // a page sent something while the person used it: kept as a p-id, for the model to hear
  /** Terminals and browser pages in this window, as views: what the host gives them (a shell, a way to show a page).
   *  A terminal's shell gets only what a shell needs of the host's environment unless terminal.env gives it more; the
   *  model's pages reach another site, in any frame, only on the person's yes for that site. */
  views?: ViewsSetup;
  /** What the model read or did in a terminal or a page, for the host to keep with the process's results: the id it is
   *  kept under, which the answer then carries, so a view can point at it. */
  record?: (e: { tool: string; input: unknown; result: unknown }) => string | undefined;
  /** A template's source: the host reads it itself (kept as an exact result) and says its result id:
   *  a tool the server marks as read-only, or a resource. */
  source?: (s: {
    server: string;
    tool?: string;
    resource?: string;
    args: Record<string, unknown>;
  }) => Promise<string>;
  /** A result or attachment a restored view points at, read again (restore): the host calls the tool again with the same
   *  input, or looks up its own ref, or attaches the person's file again; keeps what came as a new entry; and says its
   *  id. undefined, or a throw, when it cannot: the panels that showed it wait, saying why. Called once for each pointer
   *  the checkpoint keeps, as restore begins; never for a tool its server says changes things (isRead false) unless the
   *  result carries the host's own ref. Without it, every panel that shows a result restores waiting. A panel waiting
   *  for the same call keeps the pointer in every checkpoint until a result fills it, and is read again with it on each
   *  restore after, on ui.refetchWaiting, and on the person's Try again on that panel. */
  refetch?: (p: ResultPointer) => Promise<string | undefined>;
  /** Whether a tool only reads, as its server says (MCP's readOnlyHint): only reads may be a template's sources. */
  isRead?: (server: string, tool: string) => boolean | undefined;
  /** A slot the person fills by capturing (a photo, a file, a signature): the host's own way to take it, kept as attachments.
   *  now: the person asked for it this moment (a form's file field): the host's picker at once, not a wait in its bar. */
  capture?: (c: {
    slot: string;
    kind: string;
    min?: number;
    max?: number;
    about?: string;
    accept?: string;
    now?: boolean;
  }) => Promise<string[] | { ids: string[]; by?: { name: string; window: string } }>;
  /** A suggestion the person took, or a page's proposed follow-up: into their prompt box, unsent. */
  onSuggest?: (prompt: string) => void;
  /** A reminder is due: the host's own notice of it (the system's notification, say), besides the bar and the pane. */
  onReminder?: (r: Reminder) => void;
  /** A view's hook tells the person something: the host's own notice (its list of processes; the system's notification when they are not looking). */
  onNotice?: (n: { view: string; title: string; text: string }) => void;
  /** A view's hook starts a job the person turned on: the host starts a new process from the view (its snapshot) in the
   *  background, with the job's prompt and connectors, reads only unless writes; its id, or why it did not. */
  onJob?: (j: {
    view: string;
    hook: number;
    label: string;
    prompt: string;
    connectors?: string[];
    writes: boolean;
    snapshot: ViewSnapshot;
  }) => Promise<{ id?: string; refused?: string }>;
  /** The person pressed Send on a mail drafted for them (a message block's draft): the host sends it as it decides, and
   *  says how it went; unknown when it may not have arrived. Their click is their yes: there is no ask after it, and
   *  only that click calls this, never the model. Until it answers the draft says "Sending…"; once sent it is
   *  read-only; after failed or unknown the person may change it and send it again. A throw counts as unknown. The
   *  result's reason is shown to the person; the model hears Vindu's own words, and the result's forModel alone of
   *  the host's. An unknown one the host may settle later with the opened window's settleDraft. */
  onSendMessage?: (draft: MessageDraft) => Promise<SendResult>;
  /** Whether this window can send mail now: true, or the host's own action in place of Send, with its label (a window
   *  with no mail connection yet, say), which onMessageAction then runs. Read each time a draft is drawn; call the opened
   *  window's messagesChanged when it changes, and every draft is drawn again. Without it, Send is there wherever
   *  onSendMessage is; without either, a draft has Copy alone. */
  messageSending?: () => true | { action: string };
  /** The person clicked the host's own action in place of Send (messageSending): the draft, where it is, and who. */
  onMessageAction?: (a: { id: string; view: string; panel: string; by: { name: string; window: string } }) => void;
  /** false: this process starts no jobs (a job's own process: what it shows never starts another). */
  jobs?: boolean;
  /** false: no hook runs in this process (a job's own process: its views are its source's, and their hooks ran there). */
  hooks?: boolean;
  /** The words drawn on this window's views, word by word over the provider's (viewWords there); setViewWords changes
   *  them while it runs. */
  viewWords?: PartialViewWords;
  /** How this window's views write numbers and dates, in place of the provider's (locale and timeZone there): a BCP 47
   *  tag ('nb-NO') and an IANA time zone ('Europe/Oslo'). Each account says the one its view is drawn in, and
   *  setViewWords changes them while it runs. One that is none is refused as the window opens (a RangeError). */
  locale?: string;
  timeZone?: string;
  /** A source kept fresh (a slot's source with every): the host reads it again every so many seconds, from the result
   *  it starts from (after), and says each new result's id when what it read changed. Returns a stop. */
  watch?: (
    s: { server: string; tool?: string; resource?: string; args: Record<string, unknown>; after: string },
    seconds: number,
    onRead: (id: string) => void,
    onError?: (e: Error) => void,
  ) => () => void;
};

export type UiServerOptions = {
  tempDir?: string; // where each session without a dir of its own makes its temporary folder (the system's temporary folder by default)
  driver?: PageDriver; // the browser page checks run in (none: pages are shown, not checked)
  cards?: CardDef[]; // the host's own cards
  blocks?: boolean | string[]; // Vindu's blocks (message, document, events, processes, money, files, map, …): all (default), some by name, or none
  kinds?: string[]; // the built-in cards offered (all, by default)
  libraries?: Library[]; // what pages may import by name besides three.js, ECharts and Chart.js
  /** Who may frame generated pages, MCP Apps and media: they then carry frame-ancestors for these alone. Exact http(s)
   *  origins, or a bare scheme: 'file:' for an Electron window loaded from a file (Chromium matches it; any local file
   *  may then frame the pages), or the app's own scheme such as 'app:' (register it as standard, so its frames see its
   *  origin). Schemes anyone's pages have (http:, https:, data:, blob:, …) are refused alone. A function is read on
   *  every request. Without it, pages say nothing of who may frame them. */
  pageParentOrigins?: readonly string[] | (() => readonly string[]);
  mcpTokenIn?: 'path' | 'header'; // where a session's MCP endpoint carries its token: in the URL (default), or as Authorization: Bearer, so it stays out of URL logs; the server takes either
  layout?: Partial<LayoutOptions>; // the shell's sizes, the same as the renderer's
  operations?: Operation[]; // what the model can do through the window, each a tool named by what it does
  bindings?: Record<string, Binding>; // the host's own ways of drawing an ask (an operation's binding names one)
  asks?: 'panes' | 'host'; // asks as panes in the window (the default), or drawn by the host alone: no pane, each from onShow, onAskGone when it leaves
  questions?: boolean; // the ask tool: the model asks the person something in the window (on by default)
  words?: Partial<Words>; // the binding's buttons, in the host's words
  viewWords?: PartialViewWords; // the words drawn on a view's own surface (its steps, its hooks, what a panel says of itself), word by word over English; what the model is told stays English
  apps?: AppsSwitch; // MCP Apps: off (the default), on, or per connection
  appsNetwork?: boolean; // let app frames reach the domains they declare (off: no fetch from the network at all)
  modelArrange?: ModelArrange; // the model arranges the window (allow), proposes (suggest) or not at all (off)
  locale?: string;
  timeZone?: string; // how values are written, said in every account
  verifyMs?: number; // how long show_view waits for the window to read back what it drew (0: no wait)
  waitMs?: number; // how long an operation waits for the person before it answers "pending"
  previews?: PreviewRule[]; // how to show what a tool the processor asks about will send (by default: a message, a payment, changes or rows, where its input is one)
  decisions?: boolean | { approve?: number }; // offer record_decision: decisions drafted by the model, taken by the person (or several), kept as records
  jobs?: { perDay?: number }; // a hook's job, once the person turns it on: at most so many runs a day each (3 by default)
  marks?: boolean; // mark what the model wrote itself, in the window and the account (default on)
  classify?: (e: Entry) => string | undefined; // a label for a result ("Confidential"), shown on every panel that shows it
  reminders?: boolean | { words?: Partial<ReminderWords>; max?: number }; // reminders the person and the model set, kept with the process (off by default)
  holidays?: string[]; // days that are not working days (YYYY-MM-DD), besides Saturdays and Sundays: for dates and reminders worked out in working days
};

/** The outcome of starting a host-provided view template. */
export type TemplateStart = {
  started: boolean;
  action?: 'cancel' | 'decline';
  problems?: string[];
  notes?: string[];
  read?: string[];
  failed?: string[];
};
