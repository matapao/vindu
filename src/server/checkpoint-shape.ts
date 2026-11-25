// A checkpoint comes back from the host's own store, where anything could have changed it: before a task is restored
// from one, it is checked to be what a checkpoint is, each part of it, and its views are the model's, under names the
// model may show. Its template is checked as any template is when it loads. A snapshot's drafts are checked the same
// way before a window starts from it.
import { z } from 'zod';
import { CARDS } from '../cards.js';
import { DRAFT_LIMITS } from '../message-draft.js';
import { keptFor } from '../shell-roles.js';
import { checkTemplate } from '../templates.js';
import type { ViewCheckpoint } from './contracts.js';
import { digestOf, type SavedDraft } from './message-drafts.js';
import type { Session } from './state.js';

const Name = z.string().min(1).max(200);
const Count = z.number().int().min(0);
const Mark = z.object({
  text: z.string().max(1000),
  by: z.enum(['person', 'model']),
  undo: z.boolean().optional(),
  suggestion: z.boolean().optional(),
});
const View = z.object({
  name: Name,
  title: z.string().max(1000),
  args: z.record(z.string(), z.unknown()),
  mark: Mark.optional(),
});
const Shelved = z.object({
  by: z.enum(['person', 'model', 'room']),
  at: Count,
  slot: z.unknown().optional(),
  updated: z.boolean().optional(),
});
const Gate = z.object({ want: z.string(), since: Count, sinceOwn: Count, got: z.string().optional(), why: z.string().max(1000).optional() });
const Fill = z.object({
  by: z.enum(['source', 'model', 'person']),
  id: z.string().optional(),
  at: z.string(),
  approved: z.array(z.string()).optional(),
  declined: z.boolean().optional(),
  failed: z.string().optional(),
});
const Numbers = z.record(z.string(), z.number());
const Texts = (most: number, each: number) => z.array(z.string().max(each)).max(most);
const DraftFields = z.object({
  to: Texts(DRAFT_LIMITS.addresses, DRAFT_LIMITS.address),
  cc: Texts(DRAFT_LIMITS.addresses, DRAFT_LIMITS.address),
  subject: z.string().max(DRAFT_LIMITS.subject),
  body: z.string().max(DRAFT_LIMITS.body),
  attachments: Texts(DRAFT_LIMITS.attachments, DRAFT_LIMITS.path),
});
const Draft = z.object({
  view: Name,
  panel: Name,
  id: z.string().min(1).max(100),
  of: z.string().regex(/^[a-f0-9]{64}$/).optional(), // the mail the model drafted, by its digest
  model: z.object({ // the mail itself, as a checkpoint kept it before it kept only its digest
    fields: DraftFields,
    format: z.enum(['text', 'markdown']),
    original: z
      .object({ id: z.string().max(500), ref: z.string().max(500), from: z.string().max(DRAFT_LIMITS.address), time: z.string().max(100), subject: z.string().max(DRAFT_LIMITS.subject), body: z.string().max(DRAFT_LIMITS.body) })
      .partial()
      .optional(),
  }).optional(),
  edited: DraftFields.optional(),
  state: z.enum(['draft', 'sent', 'failed', 'unknown']), // a send under way is kept as unknown
  reason: z.string().max(1000).optional(),
});
const Drafts = z.array(Draft).max(200);
/** Each draft, naming the mail the model drafted by its digest (of): a checkpoint kept before drafts were kept by
 *  digest kept the mail itself. */
const byDigest = (drafts: z.infer<typeof Drafts>, kept: 'task checkpoint' | 'view snapshot'): SavedDraft[] =>
  drafts.map(({ model, of, ...d }) => {
    const mail = of ?? (model && digestOf(model));
    if (!mail) throw new Error(`Not a ${kept}: the draft in "${d.view}" names no mail`);
    return { ...d, of: mail };
  });
const Text = (most: number) => z.string().max(most);
const Pointer = z.discriminatedUnion('kind', [
  z.object({ id: z.string().regex(/^r\d+$/), kind: z.literal('result'), server: Text(200), tool: Text(200), input: z.unknown().optional(), ref: Text(1000).optional() }),
  z.object({ id: z.string().regex(/^a\d+$/), kind: z.literal('attachment'), name: Text(1000), mime: Text(200), file: Text(4096) }),
]);
const Answer = z.object({
  id: z.string().regex(/^p\d+$/),
  to: Text(2000),
  values: z.record(z.string(), z.unknown()).nullable(),
  who: z.array(Text(300)).max(20).optional(),
  at: Text(100),
});
const When = z.string().max(100).refine((t) => Number.isFinite(Date.parse(t)), 'a time');
const Kept = z.object({
  id: z.string().regex(/^m\d+$/),
  what: Text(500),
  at: When,
  said: Text(200),
  how: Text(2000),
  by: z.enum(['person', 'model']),
  who: Text(300).optional(),
  about: Text(200).optional(),
  state: z.enum(['set', 'due', 'done']),
  set_at: When,
  due_at: When.optional(),
  done_at: When.optional(),
  done_by: z.enum(['person', 'model']).optional(),
});
const Checkpoint = z.object({
  views: z.array(View).max(200),
  layout: z.unknown(),
  arrangement: z.object({
    shelf: z.record(z.string(), Shelved),
    recent: z.array(z.string()),
    focus: z.string().nullable(),
    maximized: z.string().nullable(),
  }),
  picked: z.array(z.object({ view: z.string() }).passthrough()).max(60),
  attached: z.array(z.string()),
  inputs: z.array(z.tuple([z.string(), z.object({ set: Numbers, defaults: Numbers })])),
  fresh: z.array(z.tuple([z.string(), z.string()])),
  steps: z.array(z.tuple([z.string(), z.number().int().min(1)])),
  gates: z.array(z.tuple([z.string(), Gate])),
  tickets: Count,
  mode: z
    .object({
      template: z.unknown(),
      inputs: z.record(z.string(), z.unknown()),
      fills: z.array(z.tuple([z.string(), Fill])),
    })
    .optional(),
  read: z
    .array(z.tuple([Name, z.array(z.tuple([z.string().max(80), z.number().min(0).max(1)])).max(200)]))
    .max(200)
    .optional(),
  drafts: Drafts.optional(),
  pointers: z.array(Pointer).max(5000).optional(),
  answers: z.array(Answer).max(1000).optional(),
  reminders: z.array(Kept).max(1000).optional(),
});

/** What is wrong, in a few words for the host's log. */
const issuesOf = (error: z.ZodError) =>
  error.issues
    .slice(0, 3)
    .map((i) => `${i.path.join('.') || 'it'}: ${i.message}`)
    .join('; ');
/** A snapshot's drafts (startFrom), as a checkpoint's are, or why they are not. */
export const checkedDrafts = (saved: unknown): SavedDraft[] | undefined => {
  if (saved === undefined) return undefined;
  const r = Drafts.safeParse(saved);
  if (!r.success) throw new Error(`Not a view snapshot: its drafts: ${issuesOf(r.error)}`);
  return byDigest(r.data, 'view snapshot');
};
/** The checkpoint, as a checkpoint, or why it is not one: what is wrong, in a few words for the host's log. */
export const checkedCheckpoint = (session: Session, saved: unknown): ViewCheckpoint => {
  const r = Checkpoint.safeParse(saved);
  if (!r.success) throw new Error(`Not a task checkpoint: ${issuesOf(r.error)}`);
  const cp = r.data;
  for (const v of cp.views) {
    if (v.args.name !== v.name) throw new Error(`Not a task checkpoint: view "${v.name}" is shown under another name`);
    if (keptFor(v.name) !== undefined || session.shell.ownerOf(v.name) !== undefined)
      throw new Error(`Not a task checkpoint: "${v.name}" is one of the window's own panes, not a view of the model's`);
  }
  let mode: ViewCheckpoint['mode'];
  if (cp.mode) {
    const t = checkTemplate(cp.mode.template, {
      cards: new Set([...CARDS, ...session.runtime.cards.keys()]),
      operations: [...session.runtime.operations, ...session.added].map((x) => x.name),
      // a restored view reads no source again: only one its server says can change things is refused here
      isRead: (server, tool) => session.more.isRead?.(server, tool) !== false,
    });
    if (!t.template) throw new Error(`Not a task checkpoint: its template: ${t.problems.slice(0, 3).join('; ')}`);
    mode = { ...cp.mode, template: t.template };
  }
  const picked = cp.picked as ViewCheckpoint['picked']; // each a view's, as pointing reads it; what does not fit it is dropped there
  const drafts = cp.drafts && byDigest(cp.drafts, 'task checkpoint');
  const rest = cp as Omit<ViewCheckpoint, 'mode' | 'picked' | 'drafts'>;
  return { ...rest, picked, ...(mode ? { mode } : {}), ...(drafts ? { drafts } : {}) };
};
