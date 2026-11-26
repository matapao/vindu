// Frames for what changes things, beyond the yes itself:
//   - a preview of exactly what leaves, drawn from the call's own input beside the ask (a message as a message, a
//     payment as a payment, many rows as a table), for the host's operations and for what the processor asks alike;
//   - a change set: the rows a call would change, each with its own tick, so the person accepts all of them or some;
//   - sign-off by several people: an ask that needs n different people's yes before it goes;
//   - decisions kept as records: what was decided, on what grounds and sources, by whom, when, and how to appeal.
// Who answered is said by the host with each event ({ by: { name, window } }); the window does not check identities,
// and accounts say so ("named in the window, not verified").
import { z } from 'zod';
import { changedFields } from './changes.js';
import type { Form, Operation } from './operations.js';
import type { Row } from './results.js';
import { asText } from './format.js';

/** A preview: a panel (card and how to read the payload) shown beside an ask, from the payload kept by reference. */
export type PreviewPanel = {
  card: string;
  pick?: string;
  layout?: string;
  title?: string;
  map?: Record<string, string>;
  columns?: string[];
};
/** The host's own rule for a tool the processor may call: which tool, and how to show its input. */
export type PreviewRule = {
  tool: string | RegExp;
  panel: (input: Record<string, unknown>) => PreviewPanel | undefined;
};

const has = (o: Record<string, unknown>, re: RegExp) => Object.keys(o).find((k) => re.test(k));
const objects = (v: unknown): v is Row[] =>
  Array.isArray(v) && v.length > 0 && v.every((x) => x && typeof x === 'object' && !Array.isArray(x));

/** How to preview a payload, when nothing more fitting is set: a message (an addressee and words), a payment (an amount
 *  and where it goes), a set of changes (rows with before and after), or many rows (a table). Otherwise nothing. */
export function previewOf(input: unknown): PreviewPanel | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return objects(input) ? { card: 'table', title: `${input.length} rows, exactly as they will go` } : undefined;
  const o = input as Record<string, unknown>;
  if (
    has(o, /^(to|recipients?|cc|bcc|channel|chat_?id|phone)$/i) &&
    has(o, /^(subject|body|text|message|html|content)$/i)
  )
    return { card: 'message', layout: 'one', title: 'Exactly what will be sent' };
  if (has(o, /^(amount|sum|total)$/i) && has(o, /^(currency|iban|account|payee|to|recipient|creditor|beneficiary)$/i))
    return { card: 'money', layout: 'payment', title: 'Exactly what will be paid' };
  // an HTTP API's request (a connector's tool): what goes is its body, beside the path and query
  if (o.body && typeof o.body === 'object' && !Array.isArray(o.body)) {
    const inner = previewOf(o.body);
    if (inner && !inner.pick) return { ...inner, pick: 'body' };
  }
  for (const [k, v] of Object.entries(o))
    if (objects(v) && v.some((r) => 'before' in r && 'after' in r))
      return { card: 'changes', pick: k, title: `${v.length} changes, exactly as they will be made` };
  for (const [k, v] of Object.entries(o))
    if (objects(v)) return { card: 'table', pick: k, title: `${v.length} ${k}, exactly as they will go` };
  return undefined;
}

/** The rows of a change set, each with its own tick (on by default): fields row_0, row_1, … */
export function changeSetForm(
  rows: Row[],
  o: { title?: string; message?: string; key?: (r: Row, i: number) => string; describe?: (r: Row) => string } = {},
): Form {
  const key = o.key ?? ((r: Row, i: number) => asText(r.id ?? r.key ?? r.order ?? r.number ?? i + 1));
  const describe = o.describe ?? ((r: Row) => describeChange(r));
  return {
    title: o.title ?? `Make these ${rows.length} changes?`,
    message: o.message ?? 'Untick any you do not want. Only the ticked ones are made.',
    fields: Object.fromEntries(
      rows.map((r, i) => [`row_${i}`, { type: 'boolean', title: `${key(r, i)}: ${describe(r)}`, default: true }]),
    ),
  };
}
/** "status late → refunded; refund 0 → 149", or the row's fields when it has no before and after. */
export function describeChange(r: Row): string {
  const b = r.before as Row | undefined,
    a = r.after as Row | undefined;
  if (b && a && typeof b === 'object' && typeof a === 'object') {
    return (
      changedFields(b, a)
        .map(([k, was, now]) => `${k} ${fmt(was)} → ${fmt(now)}`)
        .join('; ') || 'no change'
    );
  }
  return Object.entries(r)
    .filter(([, v]) => v === null || typeof v !== 'object')
    .slice(0, 5)
    .map(([k, v]) => `${k} ${fmt(v)}`)
    .join(', ');
}
const fmt = (v: unknown) => {
  if (v === null || v === undefined || v === '') return '—';
  return typeof v === 'object' ? JSON.stringify(v) : asText(v);
};
/** The rows the person kept ticked. */
export const acceptedRows = <T>(rows: T[], answer: Record<string, unknown> | null): T[] =>
  answer ? rows.filter((_, i) => answer[`row_${i}`] !== false) : [];

/** An operation over a set of changes: the person ticks which to make, and run gets only those (answer.accepted). */
export function changeSet(o: {
  name: string;
  description: string;
  effect?: Operation['effect'];
  rows: string;
  key?: (r: Row, i: number) => string;
  run: (accepted: Row[], input: Record<string, unknown>) => unknown;
  input?: Record<string, z.ZodType>;
  approve?: number;
}): Operation {
  return {
    name: o.name,
    description: o.description,
    effect: o.effect ?? 'write',
    approve: o.approve,
    input: o.input ?? {
      [o.rows]: z
        .array(z.record(z.string(), z.unknown()))
        .describe('the rows to change, each with its key and, best, before and after'),
    },
    ask: (input) => changeSetForm((input[o.rows] as Row[] | undefined) ?? [], { key: o.key }),
    run: async (input, answer) => {
      // the host's run may be async: its result, once it is there
      const rows = (input[o.rows] as Row[] | undefined) ?? [];
      const kept = acceptedRows(rows, answer);
      return { made: kept.length, of: rows.length, result: await o.run(kept, input) };
    },
    preview: (input) => ({
      card: 'changes',
      pick: o.rows,
      title: `${((input[o.rows] as Row[] | undefined) ?? []).length} changes, exactly as proposed`,
    }),
  };
}

/** The decision record: drafted by the model, read, changed if need be, and decided by the person (or several). */
export function decisionOperation(o: { approve?: number } = {}): Operation {
  return {
    name: 'record_decision',
    description:
      "Put a decision before the person to take, and keep it as a record: the outcome, the grounds, the sources (references such as ctx:r3#/0 or a law's section), and how to appeal. The person reads it, may change it, and decides; the record says who decided and when. Show it afterwards with a decision panel from the answer's id.",
    effect: 'write',
    approve: o.approve,
    input: {
      subject: z.string().describe('who or what it is about, e.g. "application A-1142"'),
      outcome: z.string().describe('what is decided, in one sentence'),
      grounds: z.string().describe('why: the facts and the rules they meet, in plain words'),
      sources: z
        .array(z.string())
        .describe(
          'what it rests on: references into the results (ctx:r3#/0) and the rules (e.g. "Policy 7, section 3.2")',
        ),
      appeal: z.string().optional().describe('how to appeal or complain, and by when'),
    },
    ask: (input) => ({
      title: `Decide: ${asText(input.subject ?? '')}`,
      message:
        'Drafted by the model. Read it, change what is not right, and decide. What you submit is kept as the decision, with your name and the time.',
      fields: {
        outcome: { type: 'string', title: 'Outcome', default: input.outcome, long: true },
        grounds: { type: 'string', title: 'Grounds', default: input.grounds, long: true },
        sources: {
          type: 'string',
          title: 'Sources, one per line',
          default: Array.isArray(input.sources) ? (input.sources as string[]).join('\n') : input.sources,
          long: true,
        },
        appeal: { type: 'string', title: 'How to appeal', default: input.appeal ?? '', long: true },
      },
      required: ['outcome', 'grounds'],
    }),
    run: (input, answer, approvals = []) => ({
      subject: input.subject,
      ...(approvals.length
        ? {
            decided_by: approvals.map((a) => a.name),
            at: approvals.at(-1)!.at,
            identities: 'named in the window, not verified',
          }
        : {}),
      outcome: answer?.outcome,
      grounds: answer?.grounds,
      sources: asText(answer?.sources ?? '')
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean),
      appeal: answer?.appeal || undefined,
      drafted_by: 'the model',
      changed_by_the_person: ['outcome', 'grounds', 'appeal']
        .filter((k) => (answer?.[k] ?? '') !== (input[k] ?? ''))
        .concat(
          asText(answer?.sources ?? '') !==
            (Array.isArray(input.sources) ? (input.sources as string[]).join('\n') : asText(input.sources ?? ''))
            ? ['sources']
            : [],
        ),
    }),
  };
}
