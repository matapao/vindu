import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { previewOf } from '../frames.js';
import { type Approval, confirms, HINTS, type Operation } from '../operations.js';
import { drawAsk, openAsk, showPreview, within } from './asks.js';
import { clock, drawReceipt } from './receipts.js';
import { json, keep, text, unawaited } from './records.js';
import type { Pending, Session } from './state.js';
import { asText } from '../format.js';

/** What is shown beside an operation's ask: its own preview, or, for one that changes things, what its input is. */
const previewFor = (op: Operation, input: Record<string, unknown>) => {
  if (op.preview) return op.preview(input);
  return confirms(op.effect) ? previewOf(input) : undefined;
};
/** An operation, called by the model or run by the person: ask if it needs asking, then run the host's code; keep it. */
const operate = (
  session: Session,
  op: Operation,
  input: Record<string, unknown>,
  by: 'model' | 'person',
): Pending | Promise<Record<string, unknown>> => {
  const form = typeof op.ask === 'function' ? op.ask(input) : op.ask;
  let approvals: Approval[] = [];
  const finish = async (values: Record<string, unknown> | null, asked: boolean) => {
    let output: unknown;
    let failed: string | undefined;
    try {
      output = op.run ? await op.run(input, values, approvals) : undefined;
    } catch (e) {
      failed = (e as Error).message;
    }
    let kept: Record<string, unknown> | null = null; // the person's answer, or the input of what the person ran
    if (asked) kept = values;
    else if (by === 'person') kept = input;
    const entry = keep(session, {
      to: op.name,
      by: asked || by === 'person' ? 'person' : 'host',
      values: kept,
      ...(output !== undefined ? { output } : {}),
      ...(approvals.length ? { who: approvals.map((a) => `${a.name} (${a.window})`) } : {}),
    });
    return {
      op: op.name,
      id: entry.id,
      ...(asked ? { answer: values } : {}),
      ...(output !== undefined ? { output } : {}),
      ...(failed ? { failed } : {}),
      ...(by === 'person' ? { by: 'the person, from the window' } : {}),
    };
  };
  const need = Math.max(1, Math.floor(op.approve ?? 1));
  if (!form && !confirms(op.effect) && need === 1) return finish(null, false); // several yeses are asked for, whatever it does
  const p = openAsk(
    session,
    'operation',
    op.name,
    form ?? { title: op.description.split(/[.;]/)[0], message: `${op.name} with ${JSON.stringify(input)}` },
    input,
    !form,
    op.binding,
  );
  p.need = need;
  approvals = p.approvals;
  p.approves = (o2) => o2.action === 'accept';
  if (p.need > 1) {
    p.ask = { ...p.ask, need: p.need, approvals: [] };
    drawAsk(session, p);
  }
  unawaited(
    session,
    { preview: { ticket: p.ask.ticket } },
    showPreview(session, p, input, previewFor(op, input), op.name),
  );
  p.finished = p.outcome.then(async (r) => {
    if (r.action !== 'accept') {
      const e = keep(session, { to: op.name, by: 'person', values: null });
      return (p.done = { op: op.name, id: e.id, declined: true });
    }
    p.done = await finish(r.values, true);
    const rc = session.receipts.find((x) => x.ticket === p.ask.ticket); // the host ran it with exactly its input: settled at once
    if (rc) {
      rc.state = p.done.failed ? 'failed' : 'went';
      rc.went = String(p.done.id);
      const args = session.drawn.get(rc.view);
      if (args)
        await drawReceipt(session, rc.view, {
          ...args,
          title: p.done.failed ? 'Approved, but it failed' : 'Done exactly as approved',
          subtitle: `${rc.label}: approved by ${rc.who} at ${clock(session, rc.at)}; ${p.done.failed ? `it failed: ${asText(p.done.failed)}` : `kept as ${String(p.done.id)}`}`,
        }).catch(() => undefined);
    }
    return p.done;
  });
  return p;
};

export const operationInput = (op: Operation) => z.object(op.input ?? {});
export const runFor = async (session: Session, op: Operation, input: Record<string, unknown>, signal?: AbortSignal) => {
  const allowed = session.mode?.template.operations;
  if (allowed && !allowed.includes(op.name))
    return text(
      `not run: the static view "${session.mode!.template.name}" offers ${allowed.join(', ') || 'no operations'}; say in the chat what you would do, and the person decides`,
      true,
    );
  const r = operate(session, op, input, 'model');
  if (r instanceof Promise) return json(await r);
  session.keptAsks.set(r.ask.ticket, r);
  return json(await within(r, session.runtime.waitMs, signal));
};
export const registerOp = (server: McpServer, session: Session, op: Operation) => {
  const asks = !!op.ask || confirms(op.effect);
  server.registerTool(
    op.name,
    {
      description: `${op.description}${asks ? " It needs the person's answer: when they take a while, it returns pending with a ticket for await_answer." : ''}`,
      inputSchema: operationInput(op),
      annotations: HINTS[op.effect],
    },
    async (input, ctx) => runFor(session, op, input as Record<string, unknown>, ctx?.mcpReq?.signal),
  );
};
export const waitingOn = (session: Session) =>
  session.asks.size
    ? {
        waiting_for_the_person: [...session.asks.values()].map((p) => ({
          ticket: p.ask.ticket,
          op: p.ask.op,
        })),
      }
    : {};
export const addedOps = (session: Session) =>
  session.added.length
    ? {
        added_operations: session.added.map((x) => ({
          name: x.name,
          does: x.description,
          effect: x.effect,
          input: Object.keys(x.input ?? {}),
        })),
      }
    : {}; // through invoke

export const personRuns = (session: Session, name: string, input: Record<string, unknown>) => {
  const op = [...session.runtime.operations, ...session.added].find((x) => x.name === name);
  if (!op) return false;
  const parsed = operationInput(op).safeParse(input);
  if (!parsed.success) return false;
  const run = operate(session, op, parsed.data, 'person');
  unawaited(session, { person: { operation: name } }, run instanceof Promise ? run : run.finished);
  return true;
};
