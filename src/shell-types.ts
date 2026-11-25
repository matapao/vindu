// What the shell's state is made of, as a renderer draws it and the window reports back (shell.ts keeps it): each view
// as the shell knows it, the shelf, the layout, how the views are shown (as cards or as their content), and the
// window's events. Types alone.
import type { LayoutNode, LayoutOptions, Place, Slot } from './layout.js';
import type { Sight } from './shell-resize.js';
import type { ViewRole } from './shell-roles.js';
import type { ViewSummary } from './view-summary.js';
import type { ShellPresentation } from './shell-presentation.js';

/** What the shell knows of a view: its title, whether it is one page (which takes its pane's whole height), its cards
 *  (panels: their names in words; cards: the same, one by one). kind: a pane the host draws itself (a terminal, a browser
 *  page), with no surfaces of Vindu's. role: whose it is and what the window does with it (shell-roles.ts). summary:
 *  what its card says, who changed it last, whether it waits for the person and how big it is (view-summary.ts), for
 *  a model's view of cards. */
export type ViewMeta = { title: string; subtitle?: string; fill: boolean; panels: string; cards?: string[]; kind?: string; ask?: boolean; mark?: ViewMark; loading?: boolean; // ask: a question to the person
  masters?: string[]; role?: ViewRole; summary?: ViewSummary }; // masters: panels other panels follow (detail): a plain click on a row picks it (by panel id and by its components' id)
/** What changed how a view shows what it shows, and who did it, with its undo; or what the model suggests, to take or not. */
export type ViewMark = { text: string; by: 'person' | 'model'; undo?: boolean; suggestion?: boolean };
/** A view collapsed in the shelf: who put it there (the person, the model, or no room for it when another view came),
 *  when (the revision), where it was (its slot), and whether it was shown again while there. */
export type Shelved = { by: 'person' | 'model' | 'room'; at: number; slot?: Slot; updated?: boolean };
/** What a renderer draws: the layout, every view shown (in the order first shown), the shelf, the maximized and focused
 *  panes, the revision (one more on every change, whoever made it), and a layout the model suggested, for the person to take. */
export type ShellState = { tree: LayoutNode | null; views: ShownMeta[]; shelf: Record<string, Shelved>; maximized: string | null; focus: string | null; recent: string[]; options: LayoutOptions;
  rev: number; suggestion: { tree: LayoutNode | null; maximize?: string | null } | null;
  pointing?: { picked: unknown[]; attached: string[] };  // what the person points at, and the panes in the chat
  reminders?: { set: number; due: number };            // the process's reminders: how many are set, and how many are due now (the bar's chip)
  presentation?: ShellPresentation };                  // how the views are shown: as cards or as their content (shell-presentation.ts)
/** A view in the window, as state gives it: its name, what the shell knows of it, and always its role. */
export type ShownMeta = { name: string } & ViewMeta & { role: ViewRole };
/** How far the model arranges the window: it does (allow), it proposes and the person takes it (suggest), or never (off). */
export type ModelArrange = 'allow' | 'suggest' | 'off';
/** What the window reports: its size, what the person did, and how tall each view's content is. */
export type ShellEvent =
  | { type: 'window'; w: number; h: number }
  | { type: 'resize'; path: number[]; sizes: number[] }
  | { type: 'collapse'; view: string }                 // a pane into the shelf ("close" is read the same)
  | { type: 'open'; view: string; place?: Place }      // out of the shelf: where it was, or beside the pane it was dropped on ("show" is read the same)
  | { type: 'move'; view: string; place: Place }       // a pane dragged beside another
  | { type: 'maximize'; view: string | null }
  | { type: 'focus'; view: string }
  | { type: 'take-suggestion' }
  | { type: 'presentation'; as: 'cards' | 'content' } // the person's Cards or Content: a host may keep it, and give it at open again
  | { type: 'card'; view: string | null }             // a view opened alone from its card; null: back to the cards
  | { type: 'stack'; path: number[] } | { type: 'spread'; path: number[] } | { type: 'front'; path: number[]; index: number } // a split as a stack, or spread out; a tab in front
  | { type: 'view'; view: string; action: string; [k: string]: unknown } // an action inside a view (actions.ts), or its mark's undo, take or dismiss
  | { type: 'measure'; views: Record<string, { content: number; visible: number; sight?: Record<string, Sight> }> }
  // for the UI server, not the layout: a button in an ask's pane, what a view drew, an app's message, what a page sent
  // (task.send, while the person used it), an operation run by the person
  | { type: 'action'; view: string; name?: string; context?: unknown }
  | { type: 'rendered'; view: string; seq?: number; surface: 'wide' | 'compact'; tab?: number; got: { i: number; text: string | null; visible: boolean; frame?: { w: number; h: number; loaded: boolean } }[] }
  | { type: 'app'; view: string; panel: string; resource: string; mount: string; msg: unknown }
  | { type: 'send'; view: string; panel: string; value: unknown }
  | { type: 'report'; view: string; panel: string; report: unknown } // how a page runs in the window: the page itself (page-report.ts)
  | { type: 'read'; view: string; seq?: number; read: Record<string, number> } // how far each panel is read, by pid: for the host, never the model
  | { type: 'operation'; name: string }
  | { type: 'reminders' }                              // the bar's chip: show the Reminders pane
  // what the person points at (pointing.ts): marked things, a pane in the chat, a bar opened, a page's bridge
  | { type: 'select'; by?: string; items: unknown[] }
  | { type: 'attach'; view: string; on: boolean }
  | { type: 'drill'; view: string; panel?: string; pid?: string; row: number }
  | { type: 'page'; kind: 'select' | 'ask'; view: string; panel?: string; items?: unknown; note?: string; prompt?: string };

