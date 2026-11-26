// A host's renderer code using Vindu's public browser entry and a component of its own.
// Bundled for the browser tests by pnpm build:test. app.html draws one view, shell.html a whole shell.
import { css, html, defineComponent, drawSurface, mountView, mountShell, vinduCatalog, type View, type ShellHandle, type ShellState, type ShellCommand, type ShellEvent, type PaneDrawer } from '@matapao/vindu';
import { mountFjord, NYNORSK } from '../../examples/own-look.js';
import { Progress } from '../../examples/progress-component.js';
import { mountWorkspace, type ShellSkin } from '@matapao/vindu';
import { browserPane, type BrowserIO } from '@matapao/vindu/renderer/browser';

// the host's own component for its "heat" card: one cell per row, drawn from the exact rows vindu binds to it
const Heat = defineComponent({
  name: 'Heat', tag: 'x-heat', props: { rows: 'value', label: 'string', value: 'string' },
  styles: css`.cell { display: inline-block; margin-right: 7px; }`, // the host's own styles, scoped to its element
  render: p => html`<div class="heat">${(p.rows as Record<string, unknown>[]).map(r => html`<span class="cell">${String(r[p.label])}: ${String(r[p.value])}</span>`)}</div>`,
});

// a host's own pane, as an app draws a terminal or a browser: it writes into the pane's body, and keeps the boxes it is told
const hosted: { view: string; box: { x: number; y: number; w: number; h: number } | null }[] = []; let destroyed = 0;
const terminalPane: PaneDrawer = ({ body, view }) => {
  const t = document.createElement('pre'); t.className = 'x-term'; t.tabIndex = 0; t.textContent = `host pane ${view.name}`; body.append(t); // takes the keyboard, as a terminal does
  return { place: box => hosted.push({ view: view.name, box }), destroy: () => { destroyed++; } };
};

// a host's browser pane, drawn as pictures of the page: what the pane sends the host is kept, for the test to read
const browserCalls: Record<string, unknown>[] = [];
const browserIO: BrowserIO = {
  state: async () => ({ url: 'http://localhost:9/', title: 'Page', loading: false, back: false, forward: false, shared: false, owner: 'person' }),
  onState: () => () => {}, navigate: async () => null, go: async () => null, share: async () => false,
  place: (name, box) => { browserCalls.push({ place: name, shown: !!box }); },
  frames: () => () => {}, input: (name, e) => { browserCalls.push({ input: name, ...e }); },
  point: () => new Promise(() => {}), stopPointing: name => { browserCalls.push({ stopPointing: name }); },
};

const catalogMounts = new Map<string, () => void>();
let unmount: (() => void) | undefined;
let shell: ShellHandle | undefined;
const events: ShellEvent[] = [], asked: string[] = [];
const app = {
  mountWorkspace, drawSurface, vinduCatalog,
  mount(view: View) { unmount?.(); unmount = mountView(document.getElementById('view')!, view, { components: [Heat] }); },
  catalog(id: string, view: View, options: Parameters<typeof mountView>[2]) {
    catalogMounts.get(id)?.();
    catalogMounts.set(id, mountView(document.getElementById(id)!, view, options));
    return Object.fromEntries(Array.from(vinduCatalog().components.values(), c => [c.name, (c as { tagName: string }).tagName]));
  },
  metrics(value: Parameters<ShellHandle['metrics']>[0]) { shell!.metrics(value); },
  width(px: number) { document.getElementById('view')!.style.width = `${px}px`; },
  // the shell: what the person's window would be; its events are kept for the test to hand to the UI server
  shell(theme?: 'light' | 'dark' | 'auto', progress = false, metrics?: Parameters<ShellHandle['metrics']>[0], locale?: string, sources?: string[]) { shell?.destroy(); shell = mountShell(document.getElementById('shell')!, { components: progress ? [Heat, Progress] : [Heat], theme, metrics, locale, sources, onEvent: e => events.push(e), panes: { terminal: terminalPane } }); },
  hosted() { return { boxes: hosted.splice(0), destroyed }; },
  // a shell with a browser pane, and what a host may give it: its look, and an action's icon (its markup, as given)
  hostShell(o: { tokens?: ShellSkin; icon?: string } = {}) {
    shell?.destroy();
    shell = mountShell(document.getElementById('shell')!, { tokens: o.tokens, onEvent: e => events.push(e),
      actions: o.icon ? [{ id: 'mine', title: 'Mine', icon: o.icon, where: 'bar', run: () => {} }] : [],
      panes: { terminal: terminalPane, browser: browserPane(browserIO) } });
  },
  browserCalls() { return browserCalls.splice(0); },
  destroy() { shell?.destroy(); shell = undefined; },
  // the same, in a host's own look (examples/own-look.ts): its tokens, words, buttons and component
  fjord(theme?: 'light' | 'dark' | 'auto') { shell?.destroy(); shell = mountFjord(document.getElementById('shell')!, { theme, onEvent: e => events.push(e), ask: t => asked.push(t) }); },
  theme(t: 'light' | 'dark' | 'auto') { shell!.theme(t); },
  locale(tag?: string) { shell!.locale(tag); },
  // Vindu's look with the host's words, and without the host's component: the note for a missing component, in its words
  nynorsk() { shell?.destroy(); shell = mountShell(document.getElementById('shell')!, { components: [Heat], labels: NYNORSK, onEvent: e => events.push(e) }); },
  command(c: ShellCommand) { return shell!.command(c); },
  asked() { return asked.splice(0); },
  view(v: View) { shell!.view(v); },
  app(view: string, panel: string, msg: unknown) { shell!.app(view, panel, msg); }, // the UI server's answers to an MCP App
  state(s: ShellState) { shell!.state(s); },
  events() { return events.splice(0); },
  placement() { return shell!.placement(); },
};
/** What the browser tests reach on the fixtures' pages, as window.app (test/globals.d.ts). */
export type FixtureApp = typeof app;
window.app = app;
