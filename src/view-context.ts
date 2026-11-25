import type { DraftLook, ModelDraft } from './block-drafts.js';
import type { CardDef, PanelSpec, ViewSpec } from './cards.js';
import type { HeadText } from './pages.js';
import { brief, type Entry, type ResultSource } from './results.js';
import type { ViewWords } from './view-words.js';
import type { TextStart } from './text-start.js';

export class Refusal extends Error {} // shown to the model as "not shown: …", with what to send instead

/** What a view can reach besides the results: the cards the host added, the host's pages (web pages and media),
 *  and the MCP Apps it allows (each in a frame of its own origin). */
export type ViewContext = {
  results: ResultSource;
  cards?: Map<string, CardDef>;
  kinds?: Set<string>;                              // the built-in cards offered here (all, by default)
  format?: { locale: string; timeZone: string };    // how values are written, said in every account
  words?: ViewWords;                                // the words the view's own surface is drawn in (English by default); the account stays English
  holidays?: string[];                              // the host's days that are not working days, for dates worked out in working days
  /** Cues the host noticed about this view (a receipt that went otherwise than approved, say): offered on the pane as
   *  the system's suggestions, for the person to take into their prompt box or not. */
  cues?: (view: string) => { label: string; prompt: string }[];
  apps?: {
    allowed(server: string): boolean;               // MCP Apps on for this connection
    resourceOf(server: string, tool: string): string | undefined; // the tool's ui:// resource, as its server listed it
    frame(server: string, uri: string, result: string): string;   // the URL the app loads from, on an origin of its own
  };
  marks?: boolean;                                  // mark what the model wrote itself ("Written by the model"); on by default
  classify?: (e: Entry) => string | undefined;      // a label for a result ("Confidential"), shown on every panel that shows it
  /** For a read the app keeps fresh (a source read again): the newest read of that source, which is the read itself
   *  while nothing has changed. Undefined for anything else. */
  newest?: (id: string) => string | undefined;
  /** A panel that waits (awaits a result, or after something): the result that came (from), or what it still waits
   *  for (wait), said for the person; failed: that result is a failed call (the server's own answer); again: what it
   *  waits for is a result the host could not read again, which the person may have it try again now. */
  gate?: (view: string, p: PanelSpec, spec: ViewSpec) => { from?: string; wait?: string; failed?: string; again?: boolean };
  /** A view with steps: how many of its panels are shown now (1 to start). */
  step?: (view: string) => number;
  /** A view's hook, as the person sees it: a job they turned on or not (or jobs are off here), or the system's own. */
  hookState?: (view: string, n: number) => 'on' | 'off' | 'unavailable' | 'system' | 'idle';
  /** The person's draft of a panel (a message block's draft), as the window keeps it, given the model's: what they
   *  changed, the files it attaches as read now, how its send went, and what the window offers in place of Send. */
  draft?: (view: string, panel: string, model: ModelDraft) => DraftLook;
  /** The values the person set for a panel's inputs in the window (what-ifs), which win over the model's own. */
  inputs?: (view: string, panel: string, defaults: Record<string, number>) => Record<string, number>;
  pages?: {
    base: string;                                   // this process's page origin, e.g. http://<key>.localhost:<port>
    workFile(rel: string): string | null;           // a page in the working folder, as a path under it
    workUrl(rel: string, query: string, uses: string[], hash: string): string; // its address: on a work origin for its uses
    workAny?(rel: string): string | null;           // any file there (an image, a sound), as a path under it
    workPath?(rel: string): { rel: string; file: string } | null; // any file there: its path under it and on disk, for a table or a sheet to read
    workPages(): string[];                          // the pages there, for a refusal that lists them
    writeView(name: string, html: string): string;  // keep a page the model wrote; its path under /view/, with a version
    workText?(rel: string): { rel: string; text: string } | { why: string };  // a text file there, for code and diff panels
    workStart?(rel: string, most: number): ({ rel: string } & TextStart) | { why: string }; // the start of one, for a document
    headText?(rel: string): HeadText;               // it as the last commit has it
  };
};

export const listing = (results: ResultSource) => {
  const all = results.all();
  return (all.length > 40 ? `(the latest 40 of ${all.length}) ` : '') + (all.slice(-40).map(brief).join('; ') || 'nothing yet');
};
