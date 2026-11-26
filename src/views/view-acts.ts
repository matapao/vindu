// What act_in_view does in a view (views.ts): a command run in a shared terminal, after the person's yes, or an action in
// a page by reference from its latest snapshot, waited for until what it starts has loaded and been drawn.
import type { BrowserPage, Sent } from './browser.js';
import { webAddress } from './browser.js';
import { commandRefusal, type Terminals } from './terminal.js';
import type { ViewHost, ViewsSetup } from './view-setup.js';

export type ReadArgs = { last?: number; screen?: boolean; max?: number; log?: boolean; errors_only?: boolean };
export type ActArgs = {
  action: string;
  ref?: string;
  text?: string;
  submit?: boolean;
  value?: string;
  key?: string;
  url?: string;
  ms?: number;
  timeout_ms?: number;
  command?: string;
  wait_ms?: number;
};
export const BROWSER_ACTIONS = [
  'click',
  'type',
  'select',
  'press',
  'go_to',
  'back',
  'forward',
  'reload',
  'wait',
] as const;

/** What the model is told of something the page wanted to send: where, which fields, and whether the person let it go. */
export const told = (s: Sent) => ({
  to: `${s.method} ${s.url}`,
  fields: s.fields,
  ...(s.secret.length ? { secret_fields: s.secret } : {}),
  ...(s.sent ? { sent: true } : { sent: false, note: 'the person did not let the page send it' }),
});

/** A command in a terminal the person shared, where the host lets the model run one: refused before the person is asked
 *  if it could do other than it says, then run on their yes, as it is. */
export async function runInTerminal(
  terminals: Terminals,
  setup: ViewsSetup,
  h: ViewHost,
  name: string,
  a: ActArgs,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  if (!setup.terminal || !setup.terminal.run)
    throw new Error(
      "a terminal is only read here: running commands in the person's terminals is off in this app; the person can turn it on",
    );
  if (a.action !== 'run') throw new Error(`a terminal takes one action: run, with a command (not "${a.action}")`);
  const sharing = terminals.whileShared(name);
  const i = terminals.info(name);
  if (!a.command) throw new Error('run needs a command');
  const refused = commandRefusal(a.command);
  if (refused) throw new Error(refused); // before the person is asked: what they approve is what runs
  const yes = await h.confirm(
    {
      title: `Run this in ${i.title}?`,
      message: `The model wants to run a command in ${i.title}, in ${i.cwd}. It runs there as you, outside the harness's sandbox.`,
      details: [{ label: 'command', text: a.command }],
    },
    signal,
  );
  h.log({ view: name, command: a.command, cwd: i.cwd, asked: true, yes });
  if (!yes) return { view: name, ran: false, declined: 'the person said no' };
  sharing.throwIfAborted(); // sharing may have changed while the person decided
  const r = await terminals.run(name, a.command, a.wait_ms ?? 30_000);
  sharing.throwIfAborted(); // a running command may finish after sharing was withdrawn
  return 'done' in r
    ? { view: name, ran: true, done: r.done }
    : { view: name, ran: true, running: r.running, note: 'still running: read the view later' };
}

/** An action in a page, by reference from its latest snapshot: done, and waited for what it starts. What it says, for an
 *  action that says something itself (a wait, or a site the person did not let the model open); nothing otherwise. */
export async function actInPage(
  p: BrowserPage,
  name: string,
  a: ActArgs,
  active: AbortSignal,
  o: { allow: (url: string, signal: AbortSignal) => Promise<boolean>; snap: (signal: AbortSignal) => Promise<unknown> },
): Promise<Record<string, unknown> | undefined> {
  const need = (k: keyof ActArgs) => {
    if (a[k] === undefined || a[k] === '') throw new Error(`${a.action} needs ${k}`);
    return String(a[k]);
  }; // one act_in_view for every kind of view: a value or key may come as a number
  switch (a.action) {
    case 'click': {
      const ref = need('ref');
      await p.acting(() => p.click(ref, active));
      break;
    } // a page it opens, loaded
    case 'type': {
      const ref = need('ref'),
        text = need('text');
      await p.acting(() => p.type(ref, text, a.submit, active));
      break;
    }
    case 'select': {
      const ref = need('ref'),
        value = need('value');
      await p.acting(() => p.select(ref, value, active));
      break;
    }
    case 'press': {
      const key = need('key');
      await p.acting(() => p.press(key, active));
      break;
    }
    case 'go_to': {
      const addr = webAddress(need('url'));
      if (!(await o.allow(addr, active)))
        return { view: name, did: 'nothing', declined: `the person did not let the model open ${new URL(addr).host}` };
      active.throwIfAborted();
      await p.navigate(addr);
      break;
    }
    case 'back':
    case 'forward':
    case 'reload':
      await p.go(a.action, undefined, active);
      break;
    case 'wait': {
      const w = await p.wait({ text: a.text, ms: a.ms, timeoutMs: a.timeout_ms }, active);
      return { view: name, did: 'wait', ...w, snapshot: await o.snap(active) };
    }
    default:
      throw new Error(`a browser view takes: ${BROWSER_ACTIONS.join(', ')} (not "${a.action}")`);
  }
  return undefined;
}
