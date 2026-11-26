// The show_view schema the model is given: each panel's fields, as the cards a host offers read them, and the view's
// own (its tabs, browser page, suggestions, hooks, steps and place). Its descriptions are what the model reads of them.
import { z } from 'zod';
import { CARDS, GALLERY_MOST, GUIDE, type CardDef, type CardName } from './cards.js';

/** What a panel field is, besides what it holds: a reference to results, or an option a template's slot fixes. */
type FieldRole = { ref?: true; option?: true };
const ROLES = z.registry<FieldRole>();
/** A panel field that holds result ids (one, a list, or runs such as r5-r44): a view started in a new task is carried
 *  there with the results it points at, each under its new id (server/checkpoints.ts). A host marks its own the same way. */
export const resultRef = <T extends z.ZodType>(schema: T): T => {
  ROLES.add(schema, { ref: true });
  return schema;
};
/** A panel option a template's slot keeps fixed when a view is pinned (columns, sort, a block's layout). */
export const panelOption = <T extends z.ZodType>(schema: T): T => {
  ROLES.add(schema, { option: true });
  return schema;
};
/** The panel fields of these cards that hold result ids, and those that are options. */
export function fieldRoles(cards: readonly CardDef[] = []): { refs: Set<string>; options: Set<string> } {
  const shape = panelSchema([...cards]).shape as Record<string, z.ZodType>;
  const named = (role: keyof FieldRole) => new Set(Object.keys(shape).filter((k) => ROLES.get(shape[k])?.[role]));
  return { refs: named('ref'), options: named('option') };
}

/** Which built-in cards a host offers: all of them by default (kinds narrows it), app only where MCP Apps are on. */
export type Offer = { kinds?: string[]; apps?: boolean };
const offered = (o: Offer = {}) => (o.kinds ?? [...CARDS]).filter((k) => k !== 'app' || o.apps);

const panelFields = (cards: CardDef[], o: Offer = {}) => ({
  // extra properties are allowed: one no card reads is told back as ignored
  card: z.string().describe(
    `one of these, with the fields each reads (besides from, pick, rows or data, title and id): ${offered(o)
      .map((k) => GUIDE[k as CardName]?.about ?? k)
      .join(
        ' · ',
      )}${cards.map((c) => ` · ${c.name}: ${c.about}`).join('')}. Any other card is refused: draw it in a page`,
  ),
  title: z.string().optional(),
  id: z.string().optional(),
  from: resultRef(
    z
      .string()
      .optional()
      .describe(
        'a result id (r5) or attachment id (a1) this task already got; the system reads the exact data, nothing to copy',
      ),
  ),
  pick: panelOption(
    z.string().optional().describe('with from: the list or object inside the result to show, e.g. "items"'),
  ),
  live: z
    .object({
      every: z.number().optional().describe('seconds between reads, 10 at least; 60 by default'),
      front: z.boolean().optional().describe('also when its view comes to the front'),
    })
    .optional()
    .describe(
      "with from: the system reads its source again, without you, and shows the newest read, marked; only a tool its server marks as only reading. A read that differs is told to you once, and the view's hooks on it run",
    ),
  awaits: z
    .object({
      tool: z.string().describe('the tool whose result it shows'),
      server: z.string().optional().describe('its server, if two have that tool'),
      input: z.record(z.string(), z.unknown()).optional().describe('only a call with this input (the fields given)'),
    })
    .optional()
    .describe(
      "instead of from: a result this task does not have yet: the first that comes after the view is shown, from this tool. The system fills the panel exactly when it comes, without you; until then it says what it waits for, and if the call fails it shows the server's own answer",
    ),
  after: z
    .object({
      answered: z
        .string()
        .optional()
        .describe('an operation the person answers (its name): shown once they have answered it'),
      picked: z.string().optional().describe('a panel of this view: shown once a row is picked in it'),
      filled: z.string().optional().describe('a panel of this view that waits for a result: shown once it is filled'),
    })
    .optional()
    .describe(
      'shown only once something has happened, by the system, without you; until then it says what it waits for',
    ),
  follow: z
    .boolean()
    .optional()
    .describe(
      "with from: a read the app keeps fresh (a static view's source, read again): keep this panel on its newest read, computed again by the system each time it changes. Without follow, a panel on a read that has changed since is marked as not up to date",
    ),
  rows: z
    .array(z.record(z.string(), z.unknown()))
    .optional()
    .describe('rows you worked out yourself, as a list of objects'),
  data: z.unknown().optional().describe('record: one object you worked out · kpi: a number'),
  columns: panelOption(z.array(z.string()).optional().describe('table: the fields to show, in order')),
  fields: panelOption(z.array(z.string()).optional().describe('record: the fields to show')),
  label: panelOption(z.string().optional().describe('list and timeline: the main field')),
  time: panelOption(z.string().optional().describe('timeline: the time field')),
  x: panelOption(z.string().optional().describe('charts: the category field')),
  y: panelOption(
    z
      .union([z.string(), z.array(z.string())])
      .optional()
      .describe('charts: the numeric field or fields'),
  ),
  value: panelOption(
    z
      .string()
      .optional()
      .describe(
        'kpi: a value over the rows, computed by the system: count(), sum(x), avg(x), median(x), min(x), max(x), where x is a field or a row expression (sum(hours * rate)), combined with + - * / (sum(amount) - sum(paid)); with group, computed for each group',
      ),
  ),
  compute: panelOption(
    z
      .record(z.string(), z.string())
      .optional()
      .describe(
        'fields computed for each row by the system, e.g. { "amount": "hours * rate" }: fields, numbers, $inputs, + - * / ( ), round(x, n), abs, min, max; then use them like any field (columns, value, sort, where). Never type a number you can compute this way',
      ),
  ),
  inputs: panelOption(
    z
      .record(
        z.string(),
        z.union([
          z.number(),
          z.object({
            value: z.number(),
            label: z.string().optional(),
            min: z.number().optional(),
            max: z.number().optional(),
            step: z.number().optional(),
          }),
        ]),
      )
      .optional()
      .describe(
        'what-ifs: named numbers used as $name in compute and value, e.g. { "growth": 0.04 }; the person can change them in the window, the system recomputes, and you are told',
      ),
  ),
  group: panelOption(
    z
      .string()
      .optional()
      .describe(
        'table and charts: one row per value of this field, e.g. "customer", with value computed for each; the system does the arithmetic',
      ),
  ),
  where: panelOption(
    z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'keep the rows whose fields match: a value (equal), a list (any of them), or a string with an operator: ">10000", ">= 2026-01-01", "< 5", "!= paid"',
      ),
  ),
  sort: panelOption(
    z
      .string()
      .optional()
      .describe('a field and asc or desc, e.g. "total desc"; with group, "value desc" sorts by the computed value'),
  ),
  dates: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      'dates computed for each row by the system, e.g. { "reply_by": "sent + 14 days", "pay_by": "invoice_date + 30 working days" }: a date field or today, then + or - a number of days, weeks, months or working days (Saturdays, Sundays and the holidays given are skipped)',
    ),
  holidays: z
    .array(z.string())
    .optional()
    .describe('dates: days that are not working days, as YYYY-MM-DD; public holidays are not known otherwise'),
  planned: z
    .record(z.string(), z.object({ start: z.string(), end: z.string().optional() }))
    .optional()
    .describe(
      'events: events moved by hand in the window, by key: their new start and end. A plan, not saved anywhere: to save it, run the operation that saves it, which asks the person',
    ),
  ordered: panelOption(
    z
      .array(z.string())
      .optional()
      .describe(
        "rows in this order, by their keys (their id, key, number, title or name): an order set by hand, by the person or with act_in_view; rows not listed follow. It is the view's own: not saved anywhere",
      ),
  ),
  at: z.number().int().nonnegative().optional().describe('slides: the slide shown, from 0'),
  detail: z
    .object({
      of: z.string().describe('the id of the panel whose picked row this one follows'),
      by: z.string().optional().describe('the field the two share, e.g. "customer"; by default the picked row\'s key'),
    })
    .optional()
    .describe(
      "linked panels: this panel shows what the person picks in another panel of this view, with a plain click on a row there, without you: its rows where by is the picked row's by (with from: its own result; without from: the other panel's, so the picked row itself). The first row is picked to start with",
    ),
  selected: z
    .union([z.string(), z.number()])
    .optional()
    .describe(
      "the row picked in this panel, by its key, for the panels that follow it (detail): the view's own, set by a click or with act_in_view select",
    ),
  limit: panelOption(z.number().int().positive().optional()),
  media: resultRef(
    z
      .union([z.string(), z.array(z.string())])
      .optional()
      .describe(
        `media: an attachment id, a file name, or a result id holding an image · gallery: a list of them, at most ${GALLERY_MOST} · pdf: a PDF attachment id, or its file name`,
      ),
  ),
  marks: resultRef(
    z
      .union([z.string(), z.array(z.record(z.string(), z.unknown()))])
      .optional()
      .describe(
        'media: marks on it, from a result id or as rows: regions of a picture {x, y, w, h, label} as fractions of its size (0 to 1), or moments of a recording {start, end, label} in seconds',
      ),
  ),
  text: z.string().optional().describe('text: what to say, in plain short paragraphs'),
  path: z
    .string()
    .optional()
    .describe(
      'page, code, diff and pdf (and a document, for a Markdown file): a file in the task\'s working folder, e.g. "index.html" or "src/app.ts"; the person sees it live: a page reloads when a file it loaded changes (only its styles are swapped when only those did), code, diff and pdf show the file as it changes',
    ),
  notes: z
    .array(
      z.object({
        cell: z
          .string()
          .describe(
            'an A1 address: the column\'s letters, then the row\'s number, e.g. "B3"; row 1 is the header row, and the columns are A, B, … in the order drawn',
          ),
        note: z.string().describe('what you note there, up to 200 characters'),
      }),
    )
    .optional()
    .describe(
      'table and sheet: your notes on cells, at most 20: each noted cell is marked, and the notes are listed, numbered, below it. Only on the rows and columns drawn',
    ),
  line: z.number().int().positive().optional().describe('code: the line to show first'),
  html: z
    .string()
    .optional()
    .describe(
      'page: a whole page you write, for what the cards cannot show (3D, custom charts, a dashboard with its own menus and sub-views). It runs on its own once written: everything the person does in it happens in the page, without you, so write all of it at once. Import three, three/addons/…, echarts or chart.js by name: they are pinned and served here, since a page cannot fetch from the network. Read data with task.data["r3"] (the ids in uses), or any result with await task.get("r7") (/data/r7.json); a page from the working folder ("path") reads only the results in its uses; task.value(rows, "sum(hours * rate)"), task.group(rows, "field", "sum(f)") and task.compute(rows, { amount: "hours * rate" }) compute numbers the way views do, so they count as computed, not typed. task.on("result", r => …) hears each result the task gets from then on ({id, tool, server}), task.on("change", paths => …) the files that change in the working folder. await task.send(value) sends JSON (up to 8,000 characters) to you while the person uses the page, on their click or key: it is kept as a p-id, and await_answer waits for it. vindu.select(items, note) reports what the person picked in the page (a chip above their prompt, with references if you give them), and vindu.ask(prompt) proposes a follow-up (their prompt box, unsent). The person may be in light or dark: add <meta name="color-scheme" content="light dark"> and pick colours with a prefers-color-scheme rule, or give the page its own background',
    ),
  uses: resultRef(
    z
      .array(z.string())
      .optional()
      .describe(
        'page: the result ids the page reads, given to it exactly as task.data[id]; for a page from the working folder, the only results it can read',
      ),
  ),
  static: z
    .boolean()
    .optional()
    .describe(
      'page: true for a page that runs nothing: none of its scripts run, it has no task API and it reads no data (no uses). Its images, styles, media and fonts load: those beside it in the working folder (path), or from /work/<file> and /media/<attachment id> (html). For a document or a design to look at, not an app; its check says only that it loaded, and its size',
    ),
  height: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      o.apps
        ? 'page, code, diff, pdf and app: height in pixels (default 480, 420 for an app); one alone in its view, or alone in each tab, fills its pane'
        : 'page, code, diff and pdf: height in pixels (default 480); one alone in its view, or alone in each tab, fills its pane',
    ),
});

/** The cards offered, by name. */
export const offeredKinds = (o: Offer = {}) => new Set(offered(o));
/** Every field of the shared panel schema: a host's card may read any of them, besides its own. */
export const PANEL_FIELDS = Object.keys(panelFields([]));
/** The panel schema, with the fields of the cards a host added. */
export function panelSchema(cards: CardDef[] = [], o: Offer = {}) {
  const base = z.looseObject(panelFields(cards, o));
  const extra: Record<string, z.ZodType> = Object.assign({}, ...cards.map((c) => c.fields ?? {}));
  return Object.keys(extra).length ? base.extend(extra) : base;
}
export function showViewSchema(cards: CardDef[] = [], o: Offer = {}) {
  const Panel = panelSchema(cards, o);
  return z.looseObject({
    name: z
      .string()
      .optional()
      .describe('a short id, lowercase with dashes; showing the same name again replaces the view'),
    title: z.string().optional(),
    slot: z
      .string()
      .optional()
      .describe('in a static view only: the slot to fill (look lists them); its name and title come from the template'),
    subtitle: z.string().optional(),
    panels: z.array(Panel).optional().describe('one page of panels'),
    tabs: z
      .array(z.object({ title: z.string(), panels: z.array(Panel) }))
      .optional()
      .describe('or several tabs, each with panels: a menu of sub-views the person moves between without you'),
    browser: z
      .object({
        url: z
          .string()
          .describe(
            "a web address: this machine's (localhost) opens at once; another site asks the person first, once per site",
          ),
      })
      .optional()
      .describe(
        'or a browser view: a live web page of your own in the pane, which you read with read_view and act in with act_in_view',
      ),
    suggestions: z
      .array(
        z.object({
          label: z.string().describe('a few words, on the button'),
          prompt: z.string().describe('what the person would send; it goes into their prompt box, unsent'),
          refs: z.array(z.string()).optional().describe('what it is about: ctx: references'),
        }),
      )
      .max(3)
      .optional()
      .describe('up to three suggestions of what to check or do next, about this view: the person may take one'),
    after: z
      .object({
        answered: z
          .string()
          .optional()
          .describe('an operation the person answers (its name): shown once they have answered it'),
        picked: z.string().optional().describe('a view and its panel (view/panel): shown once a row is picked there'),
        filled: z
          .string()
          .optional()
          .describe('a view and its panel (view/panel) that waits for a result: shown once it is filled'),
      })
      .optional()
      .describe(
        'write a view up front that the system shows itself once something has happened: the person answered, picked, or a result came. Until then it is held, not shown',
      ),
    hooks: z
      .array(
        z.object({
          label: z.string().optional().describe('what it is, in a few words, for the person'),
          when: z.object({
            changed: z
              .string()
              .optional()
              .describe('a live panel of this view: its source, read again, says something else'),
            crosses: z
              .object({
                panel: z.string().describe('a kpi panel of this view'),
                above: z.number().optional(),
                below: z.number().optional(),
              })
              .optional()
              .describe(
                "a kpi panel's value, worked out by the system, is above or below a line (once each time it goes there)",
              ),
            picked: z
              .string()
              .optional()
              .describe('a panel of this view that others follow (detail): the person picks a row in it'),
            answered: z.string().optional().describe('an operation (its name): the person answers it'),
            due: z.boolean().optional().describe('a reminder about this view comes due'),
          }),
          do: z.object({
            cue: z
              .object({ label: z.string(), prompt: z.string() })
              .optional()
              .describe('offer a prompt on the pane, for the person to take into their prompt box, or not'),
            notify: z
              .string()
              .optional()
              .describe(
                "tell the person, in the app's list of tasks (and the system's notification when they are not looking)",
              ),
            read: z.string().optional().describe('read a live panel of this view again'),
            job: z
              .object({
                prompt: z.string().describe('what the job does, as a prompt to a new task that starts from this view'),
                connectors: z
                  .array(z.string())
                  .optional()
                  .describe("the connectors it may use (all of the task's, by default)"),
                writes: z.boolean().optional().describe('it may also change data: each change still asks the person'),
              })
              .optional()
              .describe(
                "start a job: a new task from this view, in the background, with this prompt: off until the person turns it on, with a budget; its results come to the person in the app's list of tasks",
              ),
          }),
        }),
      )
      .max(8)
      .optional()
      .describe(
        'what the system does by itself when something happens in this view, without you: offer a prompt (cue), tell the person (notify), read a live panel again (read), or start a job (job: off until the person turns it on)',
      ),
    steps: z
      .boolean()
      .optional()
      .describe(
        'its panels one at a time, in order: the person goes on with Next and back with Back, without you; a panel that waits still waits',
      ),
    place: z
      .object({
        beside: z.string().optional().describe('a view already shown'),
        side: z.enum(['left', 'right', 'above', 'below']).optional().describe('default right'),
        size: z.number().optional().describe('the share of that pane this view takes, 0.1 to 0.9; default 0.5'),
        into: z
          .string()
          .optional()
          .describe(
            'or a view already shown, to stack this view with: one place, this in front, the other a tab the person brings back with a click',
          ),
      })
      .optional()
      .describe(
        'where the pane goes; by default a new view takes half of the largest pane, and with no room left it is stacked with the view used longest ago',
      ),
  });
}
export const Panel = z.looseObject(panelFields([]));
export const ShowView = showViewSchema();
