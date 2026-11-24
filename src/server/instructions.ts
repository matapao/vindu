import { MESSAGE } from '../blocks.js';
import type { CardDef } from '../cards.js';
import { Views } from '../views/views.js';

/** A short note for the first prompt: how the person sees things. */
export const NOTE =
  'The person sees views next to this chat only through the ui server: show_view. Every result you get, from any tool, is kept under an id (r1, r2, …; attachments a1, a2, …; what the person answers in the window p1, p2, …), `results` lists them, a view points at them with "from", and ctx_read reads one value exactly (ctx:r3#/0/amount). Each view is a pane in the person\'s window, or collapsed in the shelf at its bottom: arrange lays the panes out, and look tells you what the person sees and has changed. A web page you build or write is shown in a page panel, and check_page tests it; what it sends while the person uses it (task.send, a value its own script chose) is kept as a p-id, and await_answer waits for it. ask puts a question to the person in the window.';
/** What this window has of terminals and pages: the model is told of these only, and gets tools and fields only for them. */
export type Has = { terminals: boolean; pages: boolean; run: boolean };
export const hasOf = (v?: Views): Has => ({
  terminals: !!v?.terminals,
  pages: !!v?.browsers,
  run: !!(v?.terminals && v.setup.terminal && v.setup.terminal.run),
});
export const either = (h: Has, t: string, p: string, both = `${t}, or ${p}`) =>
  h.terminals && h.pages ? both : h.terminals ? t : p;
export const noteViews = (h: Has) =>
  !h.terminals && !h.pages
    ? ''
    : ` A view can also be ${either(h, 'a terminal the person shares with you', 'a browser page (show_view with browser)')}: read_view reads any view${h.pages || h.run ? ', and act_in_view acts in one' : ''}.`;
export const viewsText = (h: Has) => {
  if (!h.terminals && !h.pages) return '';
  const acts = [
    h.pages ? 'in a page, click, type, select, press, go_to, back, forward, reload or wait' : '',
    h.run ? "in a terminal, run a command, after the person's yes" : '',
  ].filter(Boolean);
  return [
    ` A view can also be ${either(h, 'a terminal', 'a browser page', 'a terminal or a browser page')}, the same kind of pane:`,
    h.terminals
      ? ` the person opens terminals in the task's folder and may share one with you${h.pages ? ';' : '.'}`
      : '',
    h.pages
      ? ' show_view with {"browser": {"url": …}} opens a page of your own (this machine\'s addresses at once, another site after the person\'s yes, once per site), and the person may share theirs.'
      : '',
    ` read_view reads any view as JSON: ${either(h, "a terminal's commands with their folder, exit code and output", "a page's accessibility tree with a reference (e1, e2, …) for each element you can act on", "a terminal's commands with their folder, exit code and output, or a page's accessibility tree with a reference (e1, e2, …) for each element you can act on")}.`,
    acts.length ? ` act_in_view acts in one: ${acts.join('; ')}.` : '',
    ' There are no screenshots.',
  ].join('');
};
export const INSTRUCTIONS =
  'Shows views next to the chat. Every result this task gets, from any tool, is kept under an id (r1, r2, …; attachments a1, a2, …; the person\'s answers p1, p2, …): `results` lists them. A view points panels at those ids with "from", so the exact data is shown; type rows only for what you worked out. The card field of show_view lists each card and the fields it reads; a card there is not is refused (a page draws anything), every problem in one refusal, and a field a card does not read comes back as ignored. Each show returns a JSON account of what rendered and how its data went in: a reference into the result for each value (ctx:<id>#<pointer>), the steps applied, how each value was written, and what the window read back after drawing it. A page panel shows a web page: a file the task is building (it reloads as files change), or a page you write for what cards cannot show, with three.js, ECharts and Chart.js pinned and served here (a page cannot fetch from the network). Each view is a pane in the person\'s window: a new view takes half of the largest pane (or "place" it beside another view, or into its stack), arrange sets rows and columns of views, stacks them, or collapses them into the shelf at the bottom (and opens them again where they were), and look reports what the person sees and has changed. The person can sort, filter, order and plan a view of cards in the window, and so can you, with act_in_view: your change is marked on the pane with an undo, and theirs is told to you. A view can be written once, up front, for what is still to come, and the system does the rest without you: a panel that awaits a result this task does not have yet (filled exactly when it comes), a panel or a view after the person answers or picks, steps the person goes through, views in one stack, live panels whose source the system reads again, and hooks: what the system does when something happens in a view (offer a prompt, tell the person, read again, or a job the person turns on). Each is told to you once. A page you write reads the task as it goes (task.get(id) for any result, task.on("result") for each new one, task.on("change") for files in the working folder); a page from the working folder reads only the results in its uses, and hears file changes but no new results. Either sends to you while the person uses it (task.send(value): kept as a p-id, which the next account or await_answer gives you). check_page loads a page, runs steps (keys pressed or held, clicks, typing, JavaScript) and reports what happened. A page panel\'s account also says how the page runs in the person\'s window ("window"): whether it loaded, its errors by kind and the place in its code, what failed to load, its canvases and 3D scene, overflow; never its text or values. ask asks the person something in the window and returns the answer.';

export const actText = (h: Has) =>
  [
    'Act in a view.',
    h.pages
      ? ' In a browser page, by reference from its latest snapshot: click (ref), type (ref, text; submit presses Enter after), select (ref, value), press (key, e.g. "Enter" or "Control+a"), go_to (url), back, forward, reload, or wait (text, or ms; it says whether the text came). Each returns the page\'s new snapshot. Another site than this machine opens only after the person\'s yes, once per site.'
      : '',
    h.run
      ? ' In a terminal the person shares: run (command), one line, which the person sees and says yes or no to first; it returns the command with its output and exit code once it ends, or what it printed so far after wait_ms.'
      : '',
  ].join('');
export const readText = (h: Has) =>
  [
    'Read what a view holds, as JSON.',
    h.terminals
      ? ' A terminal the person shares with you: its last commands, each with what ran, the folder, the exit code and its output, and the screen if asked.'
      : '',
    h.pages
      ? ' A browser page (yours, or one the person shares): its accessibility tree, with a reference (e1, e2, …) for each element you can act on, and what it logged if asked.'
      : '',
    ' A view of cards: its account, as look gives it.',
    h.terminals || h.pages
      ? ` What you read from ${either(h, 'a terminal', 'a page', 'a terminal or page')} is kept under an id, as any result.`
      : '',
  ].join('');
/** What the model is told of a mail meant to be sent, where the message block is offered: it is a view the person
 *  sends, never words in the model's answer. */
export const DRAFTS_TEXT =
  ' A mail meant to be sent is shown as a message draft ({"card": "message", "layout": "draft", "data": {"to", "subject", "body", …}}), never written as text in your answer: the person reads it, edits it and sends it in the window; you never press Send, and you are told how it went.';
/** Whether this window offers Vindu's message block, and so its drafts. */
export const offersDrafts = (cards: ReadonlyMap<string, CardDef>) => cards.get('message') === MESSAGE;
export const showText = (h: Has) =>
  `Show the person a view next to the chat, as a pane in their window: one page of panels, several tabs${h.pages ? ', or a browser page of your own ("browser": {"url"}), which you then read with read_view and use with act_in_view' : ''}. Point panels at results with "from". A page panel shows a web page ("path" in the working folder, or "html" you write). Showing a name again replaces that view in its pane, keeping the tab the person has open; a view the person collapsed into the shelf stays there, updated and marked. Returns a JSON account of what rendered, how each value went in, what the window read back, and where its pane is; a page panel's account says how the page loaded${h.pages ? ", and a browser page's gives its accessibility tree" : ''}.`;
