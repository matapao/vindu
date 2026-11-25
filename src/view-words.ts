// The words Vindu draws on a view's own surface, besides what the model wrote: what a panel says of itself, the way
// back and through steps and a gallery, the system's own suggestions, each hook's line with its switch, a mail
// drafted for the person to send, what the blocks say of their rows (block-words.ts), and the line each panel's card
// says of what it holds (summary-words.ts). English by default; a host gives its own, whole or word by word
// (view-words-norwegian.ts has Bokmål and Nynorsk). What the model is told stays in English, whatever the person reads.
import { BLOCK_WORDS, type BlockWords } from './block-words.js';
import { SUMMARY_WORDS, type SummaryWords } from './summary-words.js';

/** A hook's line, as the person reads it: when it runs, then each thing it does; and why it is off where it cannot be
 *  turned on. Panels come by their titles, an operation by its name with spaces. */
export type HookWords = {
  changed: (panel: string) => string;                                           // "When Invoices changes"
  crosses: (panel: string, line: { above?: number; below?: number }) => string; // "When Total is above 50000"
  picked: (panel: string) => string;                                            // "When you pick a row in Invoices"
  answered: (operation: string) => string;                                      // "When you answer "record decision""
  due: string;                                                                  // "When a reminder about this comes due"
  when: string;                                                                 // a hook whose when names nothing
  cue: (label: string) => string;                                               // "offer "What changed?""
  notify: (text: string) => string;                                             // "tell you: …"
  read: (panel: string) => string;                                              // "read Invoices again"
  job: (prompt: string) => string;                                              // "start a job: …"
  nothing: string;                                                              // what a hook that does nothing does
  idle: string;                                                                 // a job's hook in a job's own task
  unavailable: string;                                                          // a job's hook where the app starts no jobs
};
/** A mail drafted for the person to send (a message block's draft), as they read and change it: each field's label,
 *  the files it attaches, the mail it replies to, Send and how it went, and Copy. Plain words, which the window puts
 *  together with what they go with ("Failed: " and the host's reason). */
export type MessageWords = {
  to: string;            // "To"
  cc: string;            // "Cc"
  subject: string;       // "Subject"
  body: string;          // "Message": the body's label, for a screen reader
  attachments: string;   // "Attachments"
  remove: string;        // "Remove", before a file's name
  missing: string;       // after a file it attaches that is no longer there
  inReplyTo: string;     // "In reply to", above the mail it replies to
  from: string;          // "From", that mail's sender
  date: string;          // "Date", when that mail was sent
  edit: string;          // "Edit": a Markdown body's source, to change it
  preview: string;       // "Preview": a Markdown body drawn as it reads
  send: string;          // "Send"
  sending: string;       // "Sending…", while the host sends it
  sent: string;          // "Sent"
  failed: string;        // "Failed", before the host's reason
  unknown: string;       // the host cannot say whether it went
  check: string;         // a draft that cannot go as it is: its fields that need a change are marked
  copy: string;          // "Copy": the whole mail as plain text, on the clipboard
  copied: string;        // "Copied"
};
/** The words of a view's own surface. An arrow goes with the word it points with; the compiler adds only the
 *  punctuation between words (" · " and parentheses). */
export type ViewWords = {
  classified: (label: string) => string;                 // "Confidential · classified by the host"
  written: string;                                       // "Written by the model"
  notUpToDate: (shows: string, newer: string) => string; // "Not up to date: this shows r1, and its source has changed since (r2)"
  recompute: string;                                     // a panel's values computed again with the inputs the person set
  tryAgain: string;                                      // "Try again": a waiting panel's result the host could not read, read again now
  back: string;                                          // "‹ Back", after a drill and on a step after the first
  pathSeparator: string;                                 // between the steps of a drill's way in
  step: (at: number, of: number) => string;              // "Step 2 of 3"
  next: string;                                          // "Next ›"
  previous: string;                                      // "‹ Previous", in a gallery's item shown large
  close: string;                                         // "Close", the way back to the gallery
  itemOf: (at: number, of: number) => string;            // "3 of 12", the item shown large of a gallery's
  bySystem: string;                                      // "the system", after what it offers or does by itself
  on: string;                                            // a hook's job, or a device, that is on
  off: string;
  turnOn: string;                                        // the switch of a hook's job, or of a device
  turnOff: string;
  hook: HookWords;
  message: MessageWords;
  summary: SummaryWords;
} & BlockWords;
/** The groups of words, each merged word by word. */
const GROUPS = ['hook', 'message', 'summary', 'money', 'events', 'notice', 'batch', 'map', 'tasks', 'pdf'] as const satisfies readonly (keyof ViewWords)[];
type Group = (typeof GROUPS)[number];
/** Words a host gives: any of them; each one it leaves out is the one under it. */
export type PartialViewWords = Partial<Omit<ViewWords, Group>> & { [G in Group]?: Partial<ViewWords[G]> };

/** The line a crosses hook looks at, in the words given: "above 50000 or below 100". */
export const lineIn = (
  line: { above?: number; below?: number },
  words: { above: string; or: string; below: string },
  number: (n: number) => string = String,
): string =>
  [line.above !== undefined ? `${words.above} ${number(line.above)}` : '', line.below !== undefined ? `${words.below} ${number(line.below)}` : '']
    .filter(Boolean).join(` ${words.or} `);

export const VIEW_WORDS: ViewWords = {
  classified: label => `${label} · classified by the host`,
  written: 'Written by the model',
  notUpToDate: (shows, newer) => `Not up to date: this shows ${shows}, and its source has changed since (${newer})`,
  recompute: 'Recompute',
  tryAgain: 'Try again',
  back: '‹ Back',
  pathSeparator: ' › ',
  step: (at, of) => `Step ${at} of ${of}`,
  next: 'Next ›',
  previous: '‹ Previous',
  close: 'Close',
  itemOf: (at, of) => `${at} of ${of}`,
  bySystem: 'the system',
  on: 'on',
  off: 'off',
  turnOn: 'Turn on',
  turnOff: 'Turn off',
  hook: {
    changed: panel => `When ${panel} changes`,
    crosses: (panel, line) => `When ${panel} is ${lineIn(line, { above: 'above', or: 'or', below: 'below' })}`,
    picked: panel => `When you pick a row in ${panel}`,
    answered: operation => `When you answer "${operation}"`,
    due: 'When a reminder about this comes due',
    when: 'When',
    cue: label => `offer "${label}"`,
    notify: text => `tell you: ${text}`,
    read: panel => `read ${panel} again`,
    job: prompt => `start a job: ${prompt}`,
    nothing: 'nothing',
    idle: 'off: a job\'s own task runs no hooks',
    unavailable: 'off: jobs are off in this app',
  },
  message: {
    to: 'To',
    cc: 'Cc',
    subject: 'Subject',
    body: 'Message',
    attachments: 'Attachments',
    remove: 'Remove',
    missing: 'no longer in the working folder',
    inReplyTo: 'In reply to',
    from: 'From',
    date: 'Date',
    edit: 'Edit',
    preview: 'Preview',
    send: 'Send',
    sending: 'Sending…',
    sent: 'Sent',
    failed: 'Failed',
    unknown: 'It may not have arrived. Check before you send it again.',
    check: 'Check the marked fields',
    copy: 'Copy',
    copied: 'Copied',
  },
  summary: SUMMARY_WORDS,
  ...BLOCK_WORDS,
};

/** The words given, without those left undefined. */
const given = <T extends object>(words: T | undefined): Partial<T> =>
  Object.fromEntries(Object.entries(words ?? {}).filter(([, word]) => word !== undefined)) as Partial<T>;
/** Words over others, word by word: each one given in place of the one under it, in every group. */
export const viewWordsOver = (under: ViewWords, words?: PartialViewWords): ViewWords => {
  const over: Record<string, unknown> = { ...under, ...given(words) };
  for (const group of GROUPS) over[group] = { ...under[group], ...given(words?.[group]) };
  return over as ViewWords;
};
