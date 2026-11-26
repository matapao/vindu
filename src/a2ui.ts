// Compile a checked view to A2UI v0.9 messages, and check the surface before it is called shown.
// Deterministic: the same view and data give the same messages. Ids are unique by construction.
import type { A2uiMessageList, AnyComponent } from '@a2ui/web_core/v0_9';
import { basicCatalog } from '@a2ui/web_core/v0_9/basic_catalog';
import { kindOf } from './card-kinds/registry.js';
import { panelTitle, panelsOf, pidFor, type CardDef, type PanelSpec, type Resolved, type ViewSpec } from './cards.js';
import { BASIC_CATALOG, VINDU_CATALOG, dataModelOf, surfaceOf } from './catalog-id.js';
import { cellIn } from './format.js';
import { hookWords } from './gates.js';
import { pointerStep } from './results.js';
import { Refusal } from './view-context.js';
import { VIEW_WORDS, type ViewWords } from './view-words.js';
import type { Probe } from './window-reports.js';

export type Component = Required<Pick<AnyComponent, 'id' | 'component'>> & Record<string, unknown>;
// Host-provided and persisted wire messages may be untyped. Our compiler checks its output against A2UI itself.
export type Surface = Record<string, unknown>[];
const KPI_ROW = 4; // kpis side by side, at most

/** Each panel is drawn by its card's kind (card-kinds/), below what every panel has: its title, its label, and what
 *  the system says of it (written by the model, not up to date, inputs to change). What the system says is in words,
 *  English unless the view's words are given (view-words.ts). A panel without its resolved data, or without the part
 *  its card draws, is refused, saying what the card needs. */
export function compile(
  view: ViewSpec,
  data: Record<string, Resolved>,
  {
    compact,
    cards,
    locale = 'en-GB',
    timeZone = 'UTC',
    words = VIEW_WORDS,
  }: { compact: boolean; cards?: ReadonlyMap<string, CardDef>; locale?: string; timeZone?: string; words?: ViewWords },
): Surface {
  const cell = (v: unknown, field?: string) => cellIn(v, field, locale);
  const sid = view.name;
  // each panel's components and data go under its id's pid, which the window and the probes name it by: one each
  const panels = panelsOf(view),
    pids = panels.map((p) => pidFor(p.id)),
    twice = pids.findIndex((x, i) => pids.indexOf(x) !== i);
  if (twice >= 0)
    throw new Error(
      `panels "${panels[pids.indexOf(pids[twice])].id}" and "${panels[twice].id}" go by the same id in the window (${pids[twice]}): give them ids that differ in letters or digits`,
    );
  const comps: Component[] = [];
  const ids = new Set<string>();
  const add = (c: Component): string => {
    let id = c.id;
    for (let i = 2; ids.has(id); i++) id = `${c.id}_${i}`;
    ids.add(id);
    comps.push({ ...c, id });
    return id;
  };
  const text = (id: string, t: unknown, variant?: string, weight?: number) =>
    add({ id, component: 'Text', text: t, ...(variant ? { variant } : {}), ...(weight ? { weight } : {}) });
  const model: { panels: Record<string, Record<string, unknown>> } = { panels: {} };

  const card = (p: PanelSpec, weight?: number): string => {
    const pid = add({ id: pidFor(p.id), component: 'Card', child: '', ...(weight ? { weight } : {}) }); // panel ids are unique, so this id is too; child set below
    const d = data[p.id];
    const m: Record<string, unknown> = (model.panels[pid] = {});
    const kids: string[] = [];
    if (!d || typeof d !== 'object')
      throw new Refusal(`panel ${p.id}: a ${p.card} needs its resolved data: there is none under "${p.id}"`);
    if (p.title) kids.push(text(`${pid}__title`, p.title, 'h4'));
    if (d.label) kids.push(text(`${pid}__label`, words.classified(d.label), 'caption'));
    if (d.typed) kids.push(text(`${pid}__made`, words.written, 'caption'));
    if (d.newer) kids.push(text(`${pid}__newer`, words.notUpToDate(String(d.src?.id ?? p.from), d.newer), 'caption'));
    if (d.inputs && Object.keys(d.inputs).length) {
      // what-ifs: the person changes a number and asks for the values again
      const names = Object.keys(d.inputs);
      m.inputs = Object.fromEntries(names.map((k) => [k, String(d.inputs![k])]));
      const label = (k: string) => {
        const v = (p.inputs as Record<string, unknown> | undefined)?.[k];
        return v && typeof v === 'object' && typeof (v as { label?: unknown }).label === 'string'
          ? String((v as { label: string }).label)
          : k;
      };
      const at = (k: string) => `/panels/${pid}/inputs${pointerStep(k)}`; // an input's name as one step of a JSON Pointer
      const fields = names.map((k, i) =>
        add({
          id: `${pid}__in${i}`,
          component: 'TextField',
          label: label(k),
          value: { path: at(k) },
          variant: 'number',
          weight: 1,
        }),
      );
      const again = add({
        id: `${pid}__recompute`,
        component: 'Button',
        child: text(`${pid}__recompute_label`, words.recompute),
        action: {
          event: {
            name: 'set_inputs',
            context: { panel: p.id, ...Object.fromEntries(names.map((k) => [`in:${k}`, { path: at(k) }])) },
          },
        },
      });
      kids.push(add({ id: `${pid}__inputs`, component: 'Row', children: [...fields, again] }));
    }
    kids.push(
      ...kindOf(p.card, cards)!.draw(p, d, {
        pid,
        model: m,
        add,
        text,
        list: (cells, item) => list(pid, cells, item),
        cell,
        compact,
        locale,
        timeZone,
        words,
      }),
    );
    if (d.waiting?.again)
      // a result the host could not read again: the person has it read again now
      kids.push(
        add({
          id: `${pid}__again`,
          component: 'Button',
          child: text(`${pid}__again_label`, words.tryAgain),
          action: { event: { name: 'try_again', context: { panel: p.id } } },
        }),
      );
    const body = add({ id: `${pid}__body`, component: 'Column', children: kids });
    comps.find((c) => c.id === pid)!.child = body;
    return pid;
  };
  const list = (pid: string, cells: string[], item_: 'Row' | 'Column' = 'Column'): string => {
    const item = add({ id: `${pid}__item`, component: item_, children: cells });
    return add({ id: `${pid}__rows`, component: 'List', children: { componentId: item, path: `/panels/${pid}/rows` } });
  };

  // consecutive kpis (cards drawn side by side) sit side by side on a wide screen (at most four to a row), one above
  // another on a narrow one
  const cardsOf = (ps: PanelSpec[], at: string): string[] => {
    const out: string[] = [];
    let run: PanelSpec[] = [];
    const flush = () => {
      for (let i = 0; i < run.length; i += KPI_ROW) {
        const part = run.slice(i, i + KPI_ROW);
        if (part.length > 1 && !compact)
          out.push(add({ id: `${at}_kpis_${out.length}`, component: 'Row', children: part.map((p) => card(p, 1)) }));
        else out.push(...part.map((p) => card(p)));
      }
      run = [];
    };
    for (const p of ps)
      if (kindOf(p.card, cards)?.sideBySide) run.push(p);
      else {
        flush();
        out.push(card(p));
      }
    flush();
    return out;
  };
  const head = [
    text('title', view.title, 'h2'),
    ...(view.subtitle ? [text('subtitle', view.subtitle, 'caption')] : []),
  ];
  if (view.path && view.path.length > 1) {
    // after a drill: the way in, and a way back, in the same pane
    const back = add({
      id: 'back',
      component: 'Button',
      child: text('back_label', words.back),
      action: { event: { name: 'drill_back', context: { depth: view.path.length - 1 } } },
    });
    head.push(
      add({
        id: 'path',
        component: 'Row',
        align: 'center',
        children: [back, text('path_text', view.path.join(words.pathSeparator), 'caption')],
      }),
    );
  }
  const body = view.tabs
    ? add({
        id: 'tabs',
        component: 'Tabs',
        tabs: view.tabs.map((t, i) => ({
          title: t.title,
          child: add({ id: `tab_${i}`, component: 'Column', children: cardsOf(t.panels, `tab_${i}`) }),
        })),
      })
    : add({
        id: 'panels',
        component: 'Column',
        children: cardsOf(view.step ? view.panels!.slice(0, view.step.at) : view.panels!, 'panels'),
      });
  const stepper =
    view.step && view.step.of > 1
      ? [
          add({
            id: 'steps',
            component: 'Row',
            align: 'center',
            children: [
              ...(view.step.at > 1
                ? [
                    add({
                      id: 'step_back',
                      component: 'Button',
                      child: text('step_back_label', words.back),
                      action: { event: { name: 'step', context: { to: view.step.at - 1 } } },
                    }),
                  ]
                : []),
              text('step_text', words.step(view.step.at, view.step.of), 'caption'),
              ...(view.step.at < view.step.of
                ? [
                    add({
                      id: 'step_next',
                      component: 'Button',
                      child: text('step_next_label', words.next),
                      action: { event: { name: 'step', context: { to: view.step.at + 1 } } },
                    }),
                  ]
                : []),
            ],
          }),
        ]
      : [];
  const tips = (view.suggestions ?? []).slice(0, 6).map((sg, i) =>
    add({
      id: `suggest_${i}`,
      component: 'Button',
      child: text(`suggest_${i}_label`, sg.by === 'system' ? `${sg.label} (${words.bySystem})` : sg.label),
      action: { event: { name: 'suggest', context: { n: i, label: sg.label, prompt: sg.prompt } } },
    }),
  );
  // the view's hooks, as the person sees them: what the system does by itself, and each job's switch
  const titleOf = (id: string) => panelTitle(view, id);
  const states = {
    system: ` (${words.bySystem})`,
    on: ` · ${words.on}`,
    off: ` · ${words.off}`,
    idle: ` · ${words.hook.idle}`,
    unavailable: ` · ${words.hook.unavailable}`,
  };
  const hooks = (view.hooks ?? []).map((h, i) => {
    const st = view.hookStates?.[i] ?? 'system';
    const line = text(`hook_${i}_text`, `${hookWords(h, titleOf, words.hook)}${states[st]}`, 'caption');
    const sw =
      st === 'on' || st === 'off'
        ? [
            add({
              id: `hook_${i}_switch`,
              component: 'Button',
              child: text(`hook_${i}_switch_label`, st === 'on' ? words.turnOff : words.turnOn),
              action: { event: { name: 'hook', context: { n: i, on: st === 'off' } } },
            }),
          ]
        : [];
    return add({ id: `hook_${i}`, component: 'Row', align: 'center', children: [line, ...sw] });
  });
  add({
    id: 'root',
    component: 'Column',
    children: [
      ...head,
      body,
      ...stepper,
      ...(tips.length ? [add({ id: 'suggestions', component: 'Row', children: tips })] : []),
      ...(hooks.length ? [add({ id: 'hooks', component: 'Column', children: hooks })] : []),
    ],
  });
  // a component the basic catalog does not have (a chart, a page, a host's own) is Vindu's catalog's, which has them all
  const own = comps.some((c) => !basicCatalog.components.has(c.component));
  return surfaceOf(sid, own ? VINDU_CATALOG : BASIC_CATALOG, comps, model) satisfies A2uiMessageList;
}

export type { Probe } from './window-reports.js';
/** Where each shown value of a surface is (Probe), for the window to read back after it draws. */
export function probesFor(
  view: ViewSpec,
  data: Record<string, Resolved>,
  surface: Surface,
  cards?: ReadonlyMap<string, CardDef>,
): Probe[] {
  const model = (dataModelOf(surface)?.panels ?? {}) as Record<string, Record<string, unknown>>;
  const tabOf = new Map((view.tabs ?? []).flatMap((t, i) => t.panels.map((p) => [p.id, i] as const)));
  return panelsOf(view).flatMap((p) => {
    const pid = pidFor(p.id);
    const tab = tabOf.has(p.id) ? { tab: tabOf.get(p.id)! } : {};
    return (kindOf(p.card, cards)?.probes?.(p, data[p.id], model[pid] ?? {}, pid) ?? []).map((x) => ({ ...x, ...tab }));
  });
}
