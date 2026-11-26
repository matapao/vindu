// Blocks of text (blocks.ts): a mail, one or a thread or an inbox, or a draft the person sends; a document by its
// sections, with what changed since a version before, word by word; and tasks, each with its state.
import { z } from 'zod';
import { DOCUMENT_FILE } from './word-document.js';
import { DRAFT_LIMITS, megabytes } from './message-draft.js';
import { block, needOne, type Roles } from './block-kit.js';
import type { Row } from './results.js';
import { asText } from './format.js';
import { draftShaped } from './block-drafts.js';
import { isMarkdownSection, markdownAccount } from './markdown-document.js';
import { panelOption, resultRef } from './card-schema.js';

const T = /^(time|date|sent|received|at|timestamp|created|when|datetime)$/i;
export const MESSAGE = block({
  name: 'message',
  component: 'VMessages',
  one: true,
  about: `mail, chat or SMS: one message, a thread, or an inbox. Or, with layout draft, a mail for the person to send, as one object in data: {to, cc, subject, body, format: "text" or "markdown", in_reply_to: the original mail {from, time, subject, body, ref: the host's own reference to it, where a result gives one, which is the host's: pass it through exactly as given}, attachments: paths of files in the working folder}; at most ${DRAFT_LIMITS.addresses} addresses in to and cc, a subject of ${DRAFT_LIMITS.subject} characters, a body of ${DRAFT_LIMITS.body.toLocaleString('en-GB')}, ${DRAFT_LIMITS.attachments} attachments of ${megabytes(DRAFT_LIMITS.bytes)} in all. A mail meant to be sent is always a draft, never text in your answer: the person reads it, edits it and sends it in the window; you never press Send, and are told how it went`,
  roles: {
    from: /^(from|sender|author|by|user)$/i,
    to: /^(to|recipients?)$/i,
    cc: /^cc$/i,
    subject: /^(subject|title|topic)$/i,
    body: /^(body|text|content|message|preview|snippet|html)$/i,
    time: T,
    attachments: /^attach/i,
    thread: /^(thread|conversation|thread_?id)$/i,
    state: /^(state|status|read|unread|flags?)$/i,
    format: /^(format|body_?format|markup)$/i,
    in_reply_to: /^(in_?reply_?to|replying_?to|original)$/i,
  },
  layouts: ['one', 'thread', 'inbox', 'draft'],
  check: (rows, p, m) => {
    if (p.layout !== 'draft') return needOne(m, ['subject', 'body'], 'a message', rows);
    return rows.length > 1
      ? `a draft is one mail: send its fields as one object in data, not ${rows.length} rows`
      : null;
  },
  rows: (rows, p, m, _read, _inputs, draft) => {
    if (p.layout === 'draft') return draftShaped(rows, m, draft);
    const layout = asText(p.layout || mailLayout(rows, m.thread));
    return {
      rows:
        layout === 'thread' && m.time
          ? [...rows].sort((a, b) => String(a[m.time]).localeCompare(String(b[m.time])))
          : rows,
      props: { layout },
    };
  },
  account: (rows, _p, _m, props) =>
    props.layout === 'draft'
      ? { shows: 'a mail drafted for the person to send, which they may change in the window' }
      : { messages: rows.length, shows: mailShows(props.layout) },
  words: (w) => ({ ...w.message }),
});

// ── documents: sections with anchors to cite; what changed since an earlier version, as tracked changes; or a Markdown
// file, read and parsed by the system into sections of headings, paragraphs, lists, quotes, code and tables (markdown.ts)
/** A mail block's layout when the model gives none: one message, a thread (every message of one), or an inbox. */
function mailLayout(rows: Row[], thread: string | undefined): string {
  if (rows.length === 1) return 'one';
  return thread && new Set(rows.map((r) => String(r[thread]))).size === 1 ? 'thread' : 'inbox';
}
/** What a mail block shows, by its layout, as its account says. */
function mailShows(layout: unknown): string {
  if (layout === 'inbox') return 'from, subject and time of each, newest as given';
  return layout === 'thread' ? 'each message in time order, with its body' : 'the whole message';
}

const words = (t: string) => t.split(/(\s+|[.,;:!?()«»"“”])/).filter((x) => x !== ''); // words, spaces and punctuation, each a token
/** Word by word, what changed: kept, inserted, deleted (the longest common subsequence, by the system). */
export function wordDiff(a: string, b: string): { op: '=' | '+' | '-'; t: string }[] {
  const x = words(a),
    y = words(b);
  if (x.length * y.length > 4_000_000)
    return [
      { op: '-', t: a },
      { op: '+', t: b },
    ]; // too long to compare word by word
  const n = x.length,
    m = y.length;
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: { op: '=' | '+' | '-'; t: string }[] = [];
  const push = (op: '=' | '+' | '-', t: string) => {
    const last = out[out.length - 1];
    if (last?.op === op) last.t += t;
    else out.push({ op, t });
  };
  let i = 0,
    j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      push('=', x[i]);
      i++;
      j++;
    } else if (L[i + 1][j] >= L[i][j + 1]) push('-', x[i++]);
    else push('+', y[j++]);
  }
  while (i < n) push('-', x[i++]);
  while (j < m) push('+', y[j++]);
  return out;
}
/** What changed in a section's text: all of it is new, none of it changed, or word by word. */
function changesOf(then: string | undefined, now: string): ReturnType<typeof wordDiff> {
  if (then === undefined) return [{ op: '+', t: now }];
  return then === now ? [{ op: '=', t: now }] : wordDiff(then, now);
}

const DOC: Roles = {
  anchor: /^(anchor|id|section|clause|ref|no|number|paragraph)$/i,
  heading: /^(heading|title|caption|name)$/i,
  text: /^(text|body|content|paragraph_?text|value)$/i,
  level: /^(level|depth)$/i,
  page: /^(page|p)$/i,
  sources: /^(sources?|cites?|citations?|refs)$/i,
};
export const DOCUMENT = block({
  name: 'document',
  component: 'VDocument',
  about:
    "a document as sections or paragraphs, each with an anchor to cite (§ 4.2, page 3); with before: an earlier version's result id, what changed is shown as tracked changes. Or a Markdown file as it is, read and drawn by the system (headings, lists, code, tables, links), up to 512,000 bytes; or a Word document (.docx), its headings, paragraphs, lists, tables and links read and drawn by the system, each picture as [picture]: from an attachment (a1), or path: a .md or .docx file in the working folder",
  roles: DOC,
  file: DOCUMENT_FILE,
  words: (w) => ({ ...w.document }),
  fields: {
    before: resultRef(
      z
        .string()
        .optional()
        .describe(
          'document: an earlier version (a result id with the same sections): what changed is computed word by word and shown as tracked changes',
        ),
    ),
  },
  check: (rows, _p, m) => (rows.some(isMarkdownSection) ? null : needOne(m, ['text'], 'a document', rows)),
  derived: ['__changes', '__new', '__gone', '__heading', '__blocks'],
  rows: (rows, p, m, read) => {
    if (!p.before) return rows;
    const before = asText(p.before),
      e = read(before);
    if (!e || e.kind !== 'result') throw new Error(`before: no result "${before}"`);
    const old = (e.rows ?? (Array.isArray(e.value) ? e.value : [])) as Row[];
    const key = (r: Row, i: number) => (m.anchor ? asText(r[m.anchor] ?? i) : String(i));
    const was = new Map(old.map((r, i) => [key(r, i), asText(r[m.text] ?? r.text ?? '')]));
    const out: Row[] = rows.map((r, i) => {
      const k = key(r, i);
      const now = asText(r[m.text] ?? '');
      const then = was.get(k);
      was.delete(k);
      return { ...r, __changes: changesOf(then, now), __new: then === undefined };
    });
    for (const [k, t] of was)
      out.push({ ...(m.anchor ? { [m.anchor]: k } : {}), [m.text]: '', __changes: [{ op: '-', t }], __gone: true });
    return out;
  },
  account: (rows, p) => {
    if (rows.some(isMarkdownSection)) return markdownAccount(rows);
    if (!p.before) return { sections: rows.length };
    const ops = rows.flatMap((r) => (r.__changes as { op: string }[]) ?? []);
    return {
      sections: rows.length,
      tracked_changes: `computed by the system, from ${asText(p.before)} to ${p.from ?? 'these rows'}: ${ops.filter((o) => o.op === '+').length} insertions, ${ops.filter((o) => o.op === '-').length} deletions, ${rows.filter((r) => r.__new).length} new sections, ${rows.filter((r) => r.__gone).length} removed`,
    };
  },
});

export const TASKS = block({
  name: 'tasks',
  component: 'VTasks',
  about: 'tasks: a checklist, a board of columns by state, or steps in order',
  roles: {
    title: /^(title|name|task|summary|what|step)$/i,
    state: /^(state|status|done|completed|stage|column)$/i,
    who: /^(assignee|owner|who|assigned_?to|responsible)$/i,
    due: /^(due|deadline|by|due_?date)$/i,
    priority: /^(priority|prio|severity)$/i,
  },
  layouts: ['checklist', 'board', 'steps'],
  fields: {
    order: panelOption(z.array(z.string()).optional().describe('tasks, layout board: the columns (states) in order')),
  },
  check: (rows, _p, m) => needOne(m, ['title'], 'a task', rows),
  words: (w) => ({ ...w.tasks }),
  account: (rows, p, m) => ({
    tasks: rows.length,
    ...(m.state
      ? {
          by_state: Object.fromEntries(
            rows.reduce(
              (a, r) => a.set(asText(r[m.state] ?? ''), (a.get(asText(r[m.state] ?? '')) ?? 0) + 1),
              new Map<string, number>(),
            ),
          ),
        }
      : {}),
    ...(p.layout === 'board' && p.order ? { columns: p.order } : {}),
  }),
});
