import { previewOf } from '../frames.js';
import { fieldsOf, permissionDetails } from '../operations.js';
import { openAsk, showPreview, until } from './asks.js';
import { keep, unawaited } from './records.js';
import type { Session } from './state.js';

/** An HTTP request's own words, for a call that makes one (a connector's write: its method and path): " (POST /x)". */
const requestLine = (input: unknown): string => {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  return typeof o.method === 'string' && typeof o.path === 'string'
    ? ` (${o.method.toUpperCase()} ${o.path.split('?')[0]})`
    : '';
};

export function hostRequests(session: Session) {
  const confirm = async (
    q: { title: string; message?: string; details?: { label?: string; text: string }[] },
    signal?: AbortSignal,
  ): Promise<boolean> => {
    const p = until(
      session,
      openAsk(
        session,
        'operation',
        q.title,
        {
          title: q.title,
          ...(q.message ? { message: q.message } : {}),
          ...(q.details?.length ? { details: q.details } : {}),
        },
        undefined,
        true,
      ),
      signal,
    );
    return (await p.outcome).action === 'accept';
  };

  return {
    /** A form the processor or a server asks the person (ACP elicitation, from the host): drawn by the same binding. */
    ask: async (
      e: { message: string; schema?: unknown; title?: string },
      signal?: AbortSignal,
    ): Promise<
      { action: 'accept'; content: Record<string, unknown> } | { action: 'decline' } | { action: 'cancel' }
    > => {
      const p = until(
        session,
        openAsk(
          session,
          'elicitation',
          e.title ?? 'a question',
          { title: e.title ?? 'A question for you', message: e.message, ...fieldsOf(e.schema) },
          undefined,
          false,
        ),
        signal,
      );
      const r = await p.outcome;
      if (r.action === 'accept') {
        keep(session, { to: `the question "${e.message.slice(0, 80)}"`, by: 'person', values: r.values });
        return { action: 'accept', content: r.values };
      }
      keep(session, { to: `the question "${e.message.slice(0, 80)}"`, by: 'person', values: null });
      return r;
    },
    /** What the processor asks before a tool call (from the host): drawn as it asks it, its options as the choices in its
     *  order and words, with the call's tool, input, diff and files. The answer is the option's place, or null when
     *  the person closed the ask; it goes to the processor, so it is not kept here. own: a call to this window's own tools
     *  (or the host's), which shows itself in the window: nothing to preview. */
    permission: async (
      q: {
        title: string;
        tool?: string;
        input?: unknown;
        content?: unknown[];
        locations?: { path: string; line?: number | null }[];
        options: { name: string; kind?: string }[];
        own?: boolean;
        server?: string;
        name?: string;
      },
      signal?: AbortSignal,
    ): Promise<number | null> => {
      if (!q.options.length) return null;
      const p = until(
        session,
        openAsk(
          session,
          'permission',
          q.tool ? `${q.tool}${requestLine(q.input)}` : q.title,
          { title: q.title, details: permissionDetails(q), choices: q.options.map((x) => x.name) },
          undefined,
          false,
        ),
        signal,
      );
      if (q.server && q.name)
        p.call = {
          server: q.server,
          tool: q.name,
          input: q.input,
          label: `${q.tool ?? `${q.server}: ${q.name}`}${requestLine(q.input)}`,
        }; // the call, so its receipt finds what went
      if (p.call)
        p.approves = (o2) =>
          o2.action === 'accept' &&
          o2.n !== undefined &&
          (q.options[o2.n]?.kind
            ? String(q.options[o2.n].kind).startsWith('allow')
            : /^(yes|allow|ok|approve)/i.test(q.options[o2.n]?.name ?? ''));
      const rule = (session.runtime.options.previews ?? []).find((x) =>
        typeof x.tool === 'string' ? x.tool === q.tool : x.tool.test(q.tool ?? ''),
      );
      if (!q.own)
        unawaited(
          session,
          { preview: { ticket: p.ask.ticket } },
          Promise.resolve().then(() =>
            showPreview(
              session,
              p,
              q.input,
              rule ? rule.panel((q.input ?? {}) as Record<string, unknown>) : previewOf(q.input),
              q.tool ?? q.title,
            ),
          ),
        ); // a call to the window's own tools shows itself
      const r = await p.outcome;
      return r.action === 'accept' && r.n !== undefined && r.n >= 0 && r.n < q.options.length ? r.n : null;
    },
    /** A yes or no of the host's own, with what it is about shown as details: drawn by the binding, answered only in
     *  its pane. Closed, or no longer waited for: no. */
    confirm,
    /** A page the processor or a server asks the person to open (URL elicitation): its words and full address. accept:
     *  the person chose to open it (the host opens it, outside the window); decline; cancel: closed unanswered. */
    link: async (
      e: { message: string; url: string; title?: string },
      signal?: AbortSignal,
    ): Promise<'accept' | 'decline' | 'cancel'> => {
      const p = until(
        session,
        openAsk(
          session,
          'link',
          e.title ?? 'a page to open',
          { title: e.title ?? 'A page to open', message: e.message },
          undefined,
          false,
          'form',
          e.url,
        ),
        signal,
      );
      const r = await p.outcome;
      const host = (() => {
        try {
          return new URL(e.url).host;
        } catch {
          return 'an address';
        }
      })(); // the host only: an address can carry a one-time code
      keep(session, {
        to: `the request to open a page at ${host}`,
        by: 'person',
        values: r.action === 'accept' ? { opened: true } : null,
      });
      return r.action;
    },
  };
}
