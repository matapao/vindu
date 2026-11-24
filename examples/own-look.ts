// A host's own shell, in the window: its colours, type and corners for light and dark, its words (here Norwegian
// Nynorsk), its own buttons on panes and in the bar, and its own component for its own card. None of it reaches the
// model: the panes are where the UI server says, and the model is told the same as with Vindu's default appearance.
import { mountShell, type ShellAction, type ShellEvent, type ShellHandle, type ShellSkin, type ShellLabels } from '@matapao/vindu';
import { Progress } from './progress-component.js';

// #region tokens
// a font the app ships (its own @font-face) first, then the system's
export const FJORD: ShellSkin = {
  font: '"Poppins", "Inter", system-ui, sans-serif', mono: '"DejaVu Sans Mono", ui-monospace, monospace', radius: '10px',
  desk: '#e9eeea', pane: '#ffffff', head: '#f3f6f3', line: '#c5d0c8', hair: '#e0e7e2',
  ink: '#0f1f17', ink2: '#3d5045', muted: '#6f8076', accent: '#0f7b5f', wash: 'rgba(15,123,95,.08)',
  dark: {
    desk: '#0a110d', pane: '#121b16', head: '#0f1712', line: '#2b3a31', hair: '#1e2b24',
    ink: '#e6efe9', ink2: '#b4c4ba', muted: '#7f9086', accent: '#3fbf95', wash: 'rgba(63,191,149,.12)',
  },
};
// #endregion

// #region labels
export const NYNORSK: Partial<ShellLabels> = {
  empty: 'Visingar kjem her når oppgåva viser dei.', views: 'Visingar', shelf: 'Lagt vekk', actions: 'Handlingar',
  collapse: 'Legg vekk', collapseHint: 'Legg vekk i hylla nedst (dra tittelen for å flytte ruta)', maximize: 'Maksimer', maximizeHint: 'Maksimer (dobbeltklikk på tittelen)',
  restore: 'Gjenopprett', restoreHint: 'Gjenopprett (Esc)',
  collapsed: (t, updated) => `${t}${updated ? ', oppdatert' : ''} (lagd vekk – klikk for å opne visinga der ho var)`,
  peek: 'Klikk for å opne visinga der ho var', open: 'Opne',
  resize: (a, b) => `Endre storleik på ${a} og ${b}`,
  mode: (m, n) => ({ empty: '', single: 'éi vising', tiled: `${n} ruter`, stacked: 'stabla', maximized: 'maksimert · esc gjenopprettar' })[m],
  missing: c => `Dette kortet treng komponenten «${c}», som ikkje er registrert i dette vindauget.`,
};
// #endregion

// #region actions
const icon = (d: string) => `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${d}"/></svg>`;
const WITH_ROWS = new Set(['table', 'list', 'record', 'timeline', 'progress']); // cards with rows to copy

/** The host's buttons. ask puts a question about a view into the person's chat box; the person sends it, or not. */
export function fjordActions(ask: (text: string) => void): ShellAction[] {
  return [
    {
      id: 'copy', where: 'pane', title: 'Kopier teksten', icon: icon('M5.5 5.5h7v8h-7zM3.5 10.5v-8h7'),
      when: v => (v.cards ?? []).some(card => WITH_ROWS.has(card)), // panes with rows to copy
      run: ({ body }) => { if (body) void navigator.clipboard.writeText(body.innerText).catch(() => {}); },
    },
    {
      id: 'ask', where: 'pane', title: 'Spør om denne visinga', icon: icon('M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z'),
      run: ({ view }) => { if (view) ask(`Om «${view.title}»: `); },
    },
    { id: 'next', where: 'bar', title: 'Neste rute', run: ({ shell }) => { shell.command({ type: 'next' }); } },
  ];
}

export function mountFjord(host: HTMLElement, o: { onEvent?: (e: ShellEvent) => void; ask?: (text: string) => void; theme?: 'light' | 'dark' | 'auto' } = {}): ShellHandle {
  return mountShell(host, {
    onEvent: o.onEvent, theme: o.theme,
    tokens: FJORD, labels: NYNORSK, actions: fjordActions(o.ask ?? (() => {})), components: [Progress],
  });
}
// #endregion
