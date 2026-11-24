import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { type Field, FieldSchema, type Form, HINTS } from '../operations.js';
import { answered, openAsk, within } from './asks.js';
import { operationInput, registerOp, runFor } from './operations.js';
import { nextSent } from './page-messages.js';
import { json, keep, log, text } from './records.js';
import { doRem, setRem } from './reminders.js';
import type { Session } from './state.js';

const questionField = FieldSchema.pick({
  type: true,
  title: true,
  description: true,
  enum: true,
  multi: true,
  long: true,
}).extend({
  type: FieldSchema.shape.type
    .optional()
    .describe('string (the default), number, integer or boolean (yes or no)'),
  enum: FieldSchema.shape.enum.describe('the values to pick from'),
  multi: FieldSchema.shape.multi.describe('with enum: any number of them'),
  long: FieldSchema.shape.long.describe('text over several lines'),
});
const Question = z.object({
  question: z.string().describe('what to ask, in plain words'),
  title: z.string().optional().describe('a few words above it'),
  choices: z.array(z.string()).optional().describe('answers to pick one of: buttons, in this order'),
  fields: z
    .record(z.string(), questionField)
    .optional()
    .describe('or fields to fill in, by name; with neither, the person writes an answer'),
  required: z.array(z.string()).optional().describe('the fields that must be filled in'),
});

export function registerOperationTools(server: McpServer, session: Session) {
  for (const op of session.runtime.operations) registerOp(server, session, op);

  if (session.runtime.options.questions !== false)
    server.registerTool(
      'ask',
      {
        description:
          'Ask the person something in the window, and wait for the answer: a question with choices (buttons, in your order), or fields to fill in (text, numbers, yes or no, one or several of a list), or else an answer they write. Returns their answer, kept as a p-id like any result, or that they declined; when they take a while, pending with a ticket for await_answer.',
        inputSchema: Question,
        annotations: HINTS.ui,
      },
      async (a, ctx) => {
        const fields: Record<string, Field> = Object.fromEntries(
          Object.entries(a.fields ?? {}).map(([k, f]) => [k, { ...f, type: f.type ?? 'string' }]),
        );
        const form: Form = a.choices?.length
          ? { title: a.title ?? 'A question for you', message: a.question, choices: a.choices }
          : {
              title: a.title ?? 'A question for you',
              message: a.question,
              fields: Object.keys(fields).length
                ? fields
                : { answer: { type: 'string', title: 'Your answer', long: true } },
              required: Object.keys(fields).length
                ? (a.required ?? []).filter((k) => Object.hasOwn(fields, k))
                : ['answer'],
            };
        const p = openAsk(session, 'question', 'ask', form, undefined, false);
        p.finished = p.outcome.then((r) => {
          const e = keep(session, {
            to: `the question "${a.question.slice(0, 80)}"`,
            by: 'person',
            values: r.action === 'accept' ? r.values : null,
          });
          return (p.done =
            r.action === 'accept'
              ? { id: e.id, answer: r.values }
              : { id: e.id, [r.action === 'decline' ? 'declined' : 'withdrawn']: true });
        });
        session.keptAsks.set(p.ask.ticket, p);
        log(session, { tool: 'ask', args: a });
        // a call the processor cancels while it waits takes the question away; once it has answered (pending), it stays
        const signal = ctx?.mcpReq?.signal,
          gone = () => {
            if (session.asks.get(p.ask.ticket) === p) answered(session, p, { action: 'cancel' });
          };
        signal?.addEventListener('abort', gone, { once: true });
        try {
          return json(await within(p, session.runtime.waitMs, signal));
        } finally {
          signal?.removeEventListener('abort', gone);
        }
      },
    );

  server.registerTool(
    'await_answer',
    {
      description:
        "Wait for the person's answer to something that returned pending (a ticket such as k2), and get it; still pending if they have not answered yet. Or, without a ticket, wait for what a page sends next (task.send, while the person uses it: the value is the page's): from the pages in one view, or from any.",
      inputSchema: z.object({
        ticket: z.string().optional(),
        view: z
          .string()
          .optional()
          .describe('without a ticket: wait for what is sent from the pages in this view only'),
      }),
      annotations: HINTS.read,
    },
    async ({ ticket, view }, ctx) => {
      if (ticket !== undefined) {
        const p = session.asks.get(ticket) ?? session.keptAsks.get(ticket);
        if (!p)
          return text(
            `not waiting: no ticket "${ticket}"; waiting: ${[...session.asks.keys()].join(', ') || 'none'}`,
            true,
          );
        return json(p.done ?? (await within(p, session.runtime.waitMs, ctx?.mcpReq?.signal)));
      }
      if (view !== undefined && !session.views.get(view)?.length)
        return text(
          `not waiting: no page panel is shown in view "${view}"; views with pages: ${
            [...session.views]
              .filter(([, ids]) => ids.length)
              .map(([v]) => `"${v}"`)
              .join(', ') || 'none'
          }`,
          true,
        );
      const a = await nextSent(session, view, session.runtime.waitMs, ctx?.mcpReq?.signal);
      if (!a)
        return json({
          pending: true,
          ...(view ? { view } : {}),
          note: 'nothing sent yet: await_answer waits again, and what a page sends is kept as a p-id either way',
        });
      session.heard.add(a.id);
      return json({ id: a.id, by: a.by, from: a.from, sent: a.values?.sent, at: a.at });
    },
  );

  if (session.runtime.options.reminders)
    server.registerTool(
      'remind',
      {
        description:
          'Set a reminder for the person and you: what to come back to, and when. The system works out when, exactly, in the task\'s time zone: a time ("2026-11-30T14:00"), a day (at 09:00), or from a day or a value read: "today + 3 working days", "tomorrow at 08:30", "now + 2 hours", "ctx:r3#/0/due - 2 working days at 10:00". Returns the reminder with its exact time and how it was worked out. The person sees it in the window (the bar\'s Reminders, and its pane) and may drop it; when it is due, they are notified and you are told with the next prompt. done or drop, with a reminder\'s id: one of yours is done, or not needed (the person\'s own are theirs). look lists them.',
        inputSchema: z.object({
          what: z.string().max(500).optional().describe('what to come back to, as the person will read it'),
          when: z.string().optional().describe('a time, a day, or how to work it out (see above)'),
          about: z
            .string()
            .max(200)
            .optional()
            .describe("what it is about: a view's name, or a reference such as ctx:r3#/0"),
          done: z.string().optional().describe("a reminder's id (m1): it is done"),
          drop: z.string().optional().describe("a reminder's id (m1): drop it, not needed"),
        }),
        annotations: HINTS.ui,
      },
      async (args) => {
        const id = args.done ?? args.drop;
        const r = id
          ? doRem(session, id, args.done ? 'done' : 'drop', 'model')
          : setRem(session, args, 'model');
        if ('refusal' in r) {
          log(session, { tool: 'remind', args, refused: r.refusal });
          return text(`not set: ${r.refusal}`, true);
        }
        log(session, { tool: 'remind', args, ok: true });
        if ('did' in r) return json({ did: r.did, reminder: { id: r.reminder.id, what: r.reminder.what } });
        return json({
          set: {
            id: r.id,
            what: r.what,
            at: r.at,
            when: r.said,
            how: r.how,
            ...(r.about ? { about: r.about } : {}),
          },
          the_person: `sees it in the window${session.shell.arranges === 'allow' ? ', in the Reminders pane' : ', in the bar'}, and may drop it; you are told when it is due`,
        });
      },
    );

  server.registerTool(
    'invoke',
    {
      description:
        'Run an operation the host added after this task began, by name, with its input: look lists them, with what each does and takes.',
      inputSchema: z.object({ name: z.string(), input: z.record(z.string(), z.unknown()).optional() }),
    },
    async ({ name, input }, ctx) => {
      const op = session.added.find((x) => x.name === name);
      if (!op)
        return text(
          `not run: no added operation "${name}"; added: ${session.added.map((x) => x.name).join(', ') || 'none'} (the others are tools of their own)`,
          true,
        );
      const parsed = operationInput(op).safeParse(input ?? {});
      if (!parsed.success) return text(parsed.error.message, true);
      return runFor(session, op, parsed.data, ctx?.mcpReq?.signal);
    },
  );
}
