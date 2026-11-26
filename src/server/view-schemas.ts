import { z } from 'zod';
import { ACTIONS, VIEW_ACTIONS } from '../actions.js';
import type { CardDef } from '../cards.js';
import { BROWSER_ACTIONS } from '../views/views.js';
import { either, type Has } from './instructions.js';

const ViewNames = z.union([z.string(), z.array(z.string())]);
const ReserveName = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const Arrange = z.object({
  reserve: z
    .array(z.object({ name: ReserveName, title: z.string().trim().min(1).max(160) }))
    .max(12)
    .optional()
    .describe(
      'Reserve new panes before having content. Include their names in layout, then fill them by showing each name. Returns computed geometry immediately.',
    ),
  release: z
    .array(ReserveName)
    .max(12)
    .optional()
    .describe('Remove unfilled reservations by name. Completed views are unchanged.'),
  report: z
    .enum(['layout', 'rendered'])
    .optional()
    .describe(
      'layout returns computed geometry immediately; rendered waits briefly for the window to read back. Reservations always return immediately.',
    ),
  layout: z
    .unknown()
    .optional()
    .describe(
      'rows and columns of view names, as JSON (not a string). "a" is a pane; ["a", "b"] puts a and b side by side; {"column": ["a", "b"]} puts b below a; nest them: ["a", {"column": ["b", "c"]}]. {"stack": ["b", "c"], "front": "c"} puts b and c in one place, c in front and b as a tab the person brings in front with a click: for views written up front to be gone through, or more views than the window has room for. A share: {"view": "a", "size": 0.6} or on a split, as a fraction, "60%" or a weight; children without a size share what is left. Views left out are collapsed into the shelf. A new layout restores a maximized pane.',
    ),
  collapse: ViewNames.optional().describe(
    'views to collapse into the shelf at the bottom of the window; the others share their room',
  ),
  open: ViewNames.optional().describe(
    'views to open from the shelf: each goes back where it was (beside the same views, on the same side, at the same share) when that still fits, or else as a new view would',
  ),
  maximize: z.string().nullable().optional().describe('a view to fill the window, or null to restore the layout'),
  focus: z.string().optional().describe('a view to point the person to'),
});

/** The most characters a read gives back at once (ctx_read, a terminal's output per command): the rest is read in parts. */
export const READ_MAX = 200_000;
const ReadView = z.object({
  view: z.string().describe("the view's name, as look lists it"),
  last: z
    .number()
    .int()
    .min(0)
    .max(100)
    .optional()
    .describe('a terminal: how many of its last commands (5 by default); a page with log: how many log lines'),
  screen: z.boolean().optional().describe('a terminal: the visible screen too, as text'),
  max: z
    .number()
    .int()
    .positive()
    .max(READ_MAX)
    .optional()
    .describe(`a terminal: characters of output per command (20000 by default, at most ${READ_MAX})`),
  log: z.boolean().optional().describe('a page: what it logged and the requests that failed, too'),
  errors_only: z.boolean().optional().describe("a page's log: only errors"),
});
/** act_in_view in a page or a terminal: its fields as they take them. What the model sends there is checked against
 *  this too, as the window's schema is one for views of cards as well (where value may be anything). */
export const ActInView = z.object({
  view: z.string(),
  action: z
    .enum([...BROWSER_ACTIONS, 'run'])
    .describe('in a page: click, type, select, press, go_to, back, forward, reload, wait; in a terminal: run'),
  ref: z.string().optional().describe("click, type, select: an element's reference from the latest snapshot"),
  text: z.string().optional().describe('type: what to type; wait: text to wait for'),
  submit: z.boolean().optional().describe('type: press Enter after'),
  value: z.string().optional().describe("select: the option's value or text"),
  key: z.string().optional().describe('press: "Enter", "Escape", "ArrowDown", "Control+a"'),
  url: z.string().optional().describe('go_to: a web address'),
  ms: z.number().int().positive().max(10_000).optional().describe('wait: this long'),
  timeout_ms: z.number().int().positive().max(30_000).optional().describe('wait: for text, at most this long'),
  command: z.string().optional().describe('run: one command, one line'),
  wait_ms: z
    .number()
    .int()
    .positive()
    .max(120_000)
    .optional()
    .describe('run: how long to wait for it to end (30000 by default)'),
});
const only = (shape: z.ZodRawShape, keys: string[]) =>
  Object.fromEntries(Object.entries(shape).filter(([k]) => keys.includes(k))) as z.ZodRawShape;
/** read_view's fields, for what this window has (the handler's type stays the whole one). */
export const readViewFor = (h: Has) =>
  z.object({
    ...only(ReadView.shape, [...(h.terminals ? ['screen', 'max'] : []), ...(h.pages ? ['log', 'errors_only'] : [])]),
    view: z
      .string()
      .describe(
        `the view's name, as look lists it: ${[h.terminals ? 't1 for a terminal' : '', h.pages ? "a page's name" : '', 'a view of cards'].filter(Boolean).join(', ')}`,
      ),
    ...(h.terminals || h.pages
      ? {
          last: z
            .number()
            .int()
            .min(0)
            .max(100)
            .optional()
            .describe(
              either(
                h,
                'a terminal: how many of its last commands (5 by default)',
                'a page with log: how many log lines',
                'a terminal: how many of its last commands (5 by default); a page with log: how many log lines',
              ),
            ),
        }
      : {}),
  }) as unknown as typeof ReadView;
const PAGE_FIELDS = ['ref', 'text', 'submit', 'value', 'key', 'url', 'ms', 'timeout_ms'],
  RUN_FIELDS = ['command', 'wait_ms'];
/** The actions in a view of cards here: those every view takes, and those of the cards offered (a deck's slide, a
 *  calendar's plan), in their order. */
const cardActions = (cards: Iterable<CardDef>): string[] => {
  const offered = new Set([...cards].flatMap((c) => Object.keys(c.actions ?? {})));
  return ACTIONS.filter((a) => VIEW_ACTIONS.includes(a) || offered.has(a));
};
/** "a", "a and b", "a, b and c". */
const listed = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : (xs[0] ?? ''));
/** act_in_view's actions and fields, for what this window has: a page's, and run where the model may run commands. */
const cardFields = (h: Has, acts: string[]) => ({
  // value and key mean one thing in a view of cards and another in a page: both are said where the window has pages
  panel: z.string().optional().describe('a view of cards: the panel, when it has more than one with rows'),
  field: z.string().optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  value: z
    .unknown()
    .optional()
    .describe(`filter: the value to keep${h.pages ? "; select, in a page: the option's value or text" : ''}`),
  key: z
    .union([z.string(), z.number()])
    .optional()
    .describe(
      `${listed(['move', 'plan', 'select'].filter((a) => acts.includes(a)))}: the row's key (its id, number, title or name)${h.pages ? '; press, in a page: "Enter", "Escape", "ArrowDown", "Control+a"' : ''}`,
    ),
  from: z
    .number()
    .int()
    .optional()
    .describe(
      `${listed(['move', 'plan', 'select'].filter((a) => acts.includes(a)))}: the row's place, from 0, instead of its key`,
    ),
  to: z
    .number()
    .int()
    .optional()
    .describe(acts.includes('slide') ? 'move and slide: the place or slide, from 0' : 'move: the place, from 0'),
  keys: z
    .array(z.union([z.string(), z.number()]))
    .optional()
    .describe("order: the rows' keys in order"),
  ...(acts.includes('plan')
    ? {
        start: z.string().optional().describe("plan: the event's new start (ISO 8601)"),
        end: z.string().optional().describe('plan: its new end; by default it keeps its length'),
      }
    : {}),
});
/** What act_in_view does in a view of cards, for the cards offered. */
export const cardActsFor = (cards: Iterable<CardDef>) => {
  const acts = cardActions(cards);
  return `Change how a shown view of cards shows what it shows, as the person can in the window: sort a panel by a field (sort; the same field again turns it round), show only the rows where a field has a value (filter) or all again (clear), move one row to another place (move: by its key or place, to a place from 0) or put rows in an order (order: their keys), ${acts.includes('slide') ? 'go to a slide (slide), ' : ''}${acts.includes('plan') ? 'move an event in a calendar to a new time (plan: a plan, not saved; the system marks clashes), ' : ''}pick a row in a panel other panels follow (select: by its key or place; they show what is picked, as when the person clicks it), or undo your own last change (undo). The rows stay exactly what their result says; an order${acts.includes('plan') ? ' or plan' : ''} set by hand is the view's own, not saved: to save it, run the operation that saves it, which asks the person. The person sees your change marked on the pane, with an undo. They decide how far you may go: changes of theirs you have not been told of come first, and their window may take your changes as suggestions, or not at all.`;
};
/** act_in_view's schema: the actions of a view of cards here (cards: the cards offered), a page's, and a terminal's run.
 *  Its type is what it checks (a view of cards takes any value); a page's fields are checked again (ActInView). */
export const actInViewFor = (h: Has, cards: Iterable<CardDef>) => {
  const acts = cardActions(cards);
  const actions = [
    ...acts,
    ...(h.pages ? BROWSER_ACTIONS.filter((a) => !(ACTIONS as readonly string[]).includes(a)) : []),
    ...(h.run ? ['run' as const] : []),
  ];
  return z.object({
    view: z.string(),
    action: z
      .enum(actions as [string, ...string[]])
      .describe(
        [
          `in a view of cards: ${acts.join(', ')}`,
          h.pages ? `in a page: ${BROWSER_ACTIONS.join(', ')}` : '',
          h.run ? 'in a terminal: run' : '',
        ]
          .filter(Boolean)
          .join('; '),
      ),
    ...cardFields(h, acts),
    ...only(
      ActInView.shape,
      [...(h.pages ? PAGE_FIELDS : []), ...(h.run ? RUN_FIELDS : [])].filter((k) => k !== 'value' && k !== 'key'),
    ),
  });
};
