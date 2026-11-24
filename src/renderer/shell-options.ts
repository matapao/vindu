import type { Place, Placement } from '../layout.js';
import type { ShellState, ShellEvent, ShownMeta } from '../shell.js';
import type { ViewMetrics } from './metrics.js';
import { MISSING, type View, type VinduComponent } from './surface.js';

export type ShellHandle = {
  view(v: View): void;              // a view's surfaces, as the UI server's onShow gives them
  state(s: ShellState): void;       // the shell's state, as its onShell gives it
  theme(t: 'light' | 'dark' | 'auto'): void; // MCP Apps hear the theme it makes
  locale(tag?: string): void;       // the window's language, as MCP Apps hear it (see ShellOptions); none: the browser's
  metrics(value: ViewMetrics): void;  // replace spacing, type size and density in place; {} restores the stock appearance
  tokens(t: ShellSkin): void;       // a new look, in place of the one given to mountShell
  command(c: ShellCommand): boolean; // what the person can do with the mouse and keys, by name; false when there is nothing to do it to
  placement(): Placement | null;    // what is drawn now, as placed
  app(view: string, panel: string, msg: unknown): void; // a message from the UI server to an MCP App's frame
  destroy(): void;                  // hidden at once; gone once its MCP Apps have answered their teardown, within half a second
};

/** The shell's look. Each is a CSS value for the variable of the same name (accent sets --v-accent, ink2 --v-ink-2),
 *  which the cards' own A2UI variables follow. A value given here holds in light and dark; dark sets other values for
 *  dark mode. A colour changed for light alone would stay in dark, so give it a dark value too, or pin a theme. */
export type ShellTokens = {
  desk: string; pane: string; head: string; line: string; hair: string; ink: string; ink2: string; muted: string; accent: string; wash: string;
  font: string; mono: string; radius: string;
};
export type ShellSkin = Partial<ShellTokens> & { dark?: Partial<ShellTokens> };
const TOKEN: Record<keyof ShellTokens, string> = {
  desk: '--v-desk', pane: '--v-pane', head: '--v-head', line: '--v-line', hair: '--v-hair', ink: '--v-ink', ink2: '--v-ink-2', muted: '--v-muted',
  accent: '--v-accent', wash: '--v-wash', font: '--v-font', mono: '--v-mono', radius: '--v-radius',
};

/** The shell's own words: its title bars, buttons, shelf, empty window, and the note for a missing component; for another
 *  language or another voice. The views' own text is the model's. */
export type ShellLabels = {
  chat: string; chatHint: string;     // the pane's "In the chat" switch
  empty: string;                     // the window before any view
  loading: string;                   // a reserved pane before its content arrives
  views: string; shelf: string; actions: string; // the shelf's toolbars (open views, collapsed views, the host's), for screen readers
  collapse: string; collapseHint: string; maximize: string; maximizeHint: string; restore: string; restoreHint: string;
  collapsed(title: string, updated: boolean): string; // a collapsed view in the shelf; updated: shown again while there
  peek: string; open: string;         // a peek's title bar (a click opens the view), and its button that does
  resize(a: string, b: string): string; // a line, between the panes on either side
  mode(mode: Placement['mode'], panes: number): string; // the shelf's right end
  missing(component: string): string; // in a pane, for a card whose component the window has not registered
  suggestion: string;                 // the shelf's button for a layout the model suggested
  byModel: string; suggests: string; undo: string; take: string; dismiss: string; // a pane's mark: a change inside the view, and who made it
  reminders(set: number, due: number): string; remindersHint: string; // the shelf's chip: the process's reminders
  noDrawer(kind: string): string;     // in a host's pane, when the window has no drawer for its kind
  stack: string; stackHint: string; spread: string; spreadHint: string; // a pane's Stack button; a stack's Spread out
  tab(titles: string[], o: { front: boolean; changed: boolean; asks: boolean }): string; // a stack's tab, for screen readers
};
export const SHELL_LABELS: ShellLabels = {
  empty: 'Views appear here as the task shows them.', loading: 'Waiting for content', views: 'Views', shelf: 'Collapsed', actions: 'Actions',
  chat: 'In the chat', chatHint: 'Each message you send carries this pane (what it shows, by reference). Alt-click or Alt-drag anything to point at it.',
  collapse: 'Collapse', collapseHint: 'Collapse into the shelf (drag the title to move the pane)', maximize: 'Maximize', maximizeHint: 'Maximize (double-click the title)', restore: 'Restore', restoreHint: 'Restore (Esc)',
  collapsed: (t, updated) => `${t}${updated ? ', updated' : ''}: collapsed. Click to open it where it was, or drag it beside a pane`,
  peek: 'Click to open it where it was', open: 'Open',
  resize: (a, b) => `Resize ${a} and ${b}`,
  mode: (m, n) => (m === 'empty' ? '' : m === 'tiled' ? `${n} panes` : m === 'maximized' ? 'maximized · esc restores' : m),
  missing: MISSING,
  suggestion: 'Use the suggested layout',
  byModel: 'By the model', suggests: 'The model suggests', undo: 'Undo', take: 'Take it', dismiss: 'No',
  reminders: (set, due) => (due ? `${due} reminder${due > 1 ? 's' : ''} due` : set ? `Reminders · ${set}` : 'Reminders'), remindersHint: 'Show the reminders, and set one',
  noDrawer: k => `This window cannot show a ${k} pane.`,
  stack: 'Stack', stackHint: 'Stack with its neighbours: one in front, the others as tabs', spread: 'Spread out', spreadHint: 'Show these views side by side again',
  tab: (t, o) => `${t.join(' + ')}${o.asks ? ': waiting for you' : o.changed ? ': changed' : ''}${o.front ? ' (in front)' : ''}`,
};

/** A view as the shell knows it: its name, title, subtitle, whether it is one page, its cards ("kpi, table"), and its
 *  role (whose it is, and whether its pane has "In the chat"), as the state gives it. */
export type ShownView = ShownMeta;
/** A button of the host's own: in each pane's title bar, before collapse and maximize, or in the shelf. */
export type ShellAction = {
  id: string;
  title: string;                     // its text; with an icon, its tooltip and accessible name
  icon?: string;                     // the host's own SVG markup, on a 16 × 16 viewBox, stroked with currentColor
  where: 'pane' | 'bar';
  when?: (view: ShownView) => boolean; // pane actions: the panes that get it (every pane, without when)
  run(at: { view: ShownView | null; body: HTMLElement | null; shell: ShellHandle }): void; // body: the pane's content
};
/** The person's moves, by name: for an app's menus, keys and buttons. Each is drawn and reported like the move itself. */
export type ShellCommand =
  | { type: 'maximize'; view?: string } // the focused pane, unless one is named, which then has the focus; restore when it is maximized already; false in a phone-width window, its panes stacked
  | { type: 'restore' }
  | { type: 'collapse'; view?: string } | { type: 'close'; view?: string } // the focused pane, unless one is named, into the shelf
  | { type: 'open'; view: string; place?: Place } | { type: 'show'; view: string } // focus it, opening it (where it was, or at place) if it is collapsed
  | { type: 'next' } | { type: 'previous' }; // focus moves from pane to pane, as F6 and Shift+F6
/** A pane the host draws itself: mounted into the pane's body once, told the body's box in the window (CSS pixels)
 *  whenever the layout moves it, or null while it is hidden, and destroyed when the pane leaves the window. */
export type HostPane = { place?(box: { x: number; y: number; w: number; h: number } | null): void; destroy?(): void };
/** point: add what the person points at in a host's pane (lines of a terminal) to what they point at now. */
export type PaneDrawer = (at: { body: HTMLElement; view: ShownView; shell: ShellHandle; point: (it: Record<string, unknown>) => void }) => HostPane;
export type ShellOptions = {
  onEvent?: (e: ShellEvent) => void;    // to the UI server (ui.event), through IPC in an app
  onAction?: (a: unknown) => void;      // A2UI actions from inside surfaces
  components?: VinduComponent[];        // the host's own components, for its own cards
  theme?: 'light' | 'dark' | 'auto';
  locale?: string;                      // the window's language, a BCP 47 tag ('nb-NO'), for MCP Apps; else the browser's
  tokens?: ShellSkin;
  metrics?: ViewMetrics;
  labels?: Partial<ShellLabels>;
  actions?: ShellAction[];
  css?: boolean;                        // false: none of vindu's styles, the host's own only
  panes?: Record<string, PaneDrawer>;   // the host's own panes, by kind: "terminal", "browser" (vindu/renderer/terminal, …/browser)
};
/** One CSS value and nothing more: no other declaration or rule (; { }), no markup, no comment or backslash escape that
 *  could hide one, no string left open, and nothing that loads (url(), image-set(), …): a skin draws, and fetches nothing. */
const fine = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '' && v.length <= 500 &&
  !/[;{}<>\\@]|\/\*|\*\/|\b(?:url|image|image-set|cross-fade|element|src|expression)\s*\(/i.test(v) &&
  (v.match(/"/g)?.length ?? 0) % 2 === 0 && (v.match(/'/g)?.length ?? 0) % 2 === 0;
/** A selector the skin's rules may go on: one, with no rule or comment of its own. */
const fineSelector = (sel: string) => sel.trim() !== '' && !/[;{}<]|\/\*/.test(sel);
/** The CSS for a skin: its tokens on this shell, beating the theme's light and dark rules, and its dark values in dark mode. */
export function skinCss(sel: string, t: ShellSkin = {}): string {
  if (!fineSelector(sel)) return '';
  const decls = (x: Partial<ShellTokens>) => (Object.keys(TOKEN) as (keyof ShellTokens)[]).filter(k => fine(x[k])).map(k => `${TOKEN[k]}:${x[k]}`).join(';');
  const all = decls(t), dark = t.dark ? decls(t.dark) : '';
  return (all ? `${sel}{${all}}` : '') + (dark ? `${sel}[data-theme="dark"]{${dark}}@media (prefers-color-scheme: dark){${sel}:not([data-theme="light"]){${dark}}}` : '');
}
