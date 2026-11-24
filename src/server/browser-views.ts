import { Refusal } from '../view-context.js';
import { json, log, text } from './records.js';
import type { Session } from './state.js';

/** read_view and act_in_view: JSON back, errors as the tool's own error, each kept in the log; what the model read
 *  or did in a terminal or page goes to the host's record, and the answer says its id. */
export const viewCall = async (
  session: Session,
  tool: string,
  args: { view: string },
  run: () => Promise<Record<string, unknown>>,
) => {
  try {
    const r = await run();
    const id = session.live?.kindOf(args.view)
      ? session.more.record?.({ tool, input: args, result: r })
      : undefined;
    log(session, { tool, args, ok: true, ...(id ? { id } : {}) });
    return json(id ? { id, ...r } : r);
  } catch (e) {
    log(session, { tool, args, ok: false, error: (e as Error).message });
    return text(`not done: ${(e as Error).message}`, true);
  }
};
/** show_view with a web address: a browser view of the model's own, in a pane like any view. */
export const showBrowser = async (
  session: Session,
  name: string,
  title: string,
  url: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
) => {
  if (!session.live?.browsers) throw new Refusal('this window shows no browser pages');
  if (!name) throw new Refusal('a browser view needs a name');
  const owner = session.shell.ownerOf(name); // the same page shown again is the host's browser pane; any other owner keeps its name
  if (owner && !(owner === 'host' && session.live.kindOf(name) === 'browser'))
    throw new Refusal(`"${name}" is shown already as another kind of view; open the page under another name`);
  if ((args as { panels?: unknown; tabs?: unknown }).panels || (args as { tabs?: unknown }).tabs)
    throw new Refusal('a view is panels or a browser page, not both');
  const r = await session.live.show(name, title, url, { place: (args as { place?: unknown }).place, signal });
  const id = r.snapshot ? session.more.record?.({ tool: 'show_view', input: args, result: r }) : undefined;
  const acc = { ...(id ? { id } : {}), ...r, shell: session.shell.account({ view: name }) };
  log(session, {
    tool: 'show_view',
    ok: true,
    args,
    browser: { view: name, opened: r.snapshot ? true : false },
  });
  return json(acc);
};
