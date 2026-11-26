import { z } from 'zod';
import { appsOn, type AppSubmission, canSubmitApp, fromApp } from '../apps.js';
import { viewsOf } from '../layout.js';
import { openAsk } from './asks.js';
import type { OpenMore } from './contracts.js';
import { keep, log } from './records.js';
import type { Session } from './state.js';

export function routeAppMessage(
  session: Session,
  x: Record<string, unknown>,
  replyToWindow: OpenMore['onApp'],
): boolean {
  const more = session.more;
  const view = String(x.view),
    panel = String(x.panel);
  const app = session.data.get(view)?.[panel]?.app;
  const msg = x.msg as Record<string, unknown> | undefined;
  if (
    session.closed ||
    !app ||
    x.resource !== new URL(app.url).hostname ||
    typeof x.mount !== 'string' ||
    !/^[a-f0-9]{32}$/.test(x.mount) ||
    !msg ||
    typeof msg !== 'object'
  )
    return false;
  const current = () => !session.closed && session.data.get(view)?.[panel]?.app === app;
  log(session, { app: { view: x.view, panel: x.panel, method: msg.method ?? null, id: msg.id ?? null } });
  void fromApp(app, msg, session.results, more.apps, {
    ask: async (title, message) => {
      const request = openAsk(session, 'app', title, { title, message }, undefined, true);
      return (await request.outcome).action === 'accept' && current();
    },
    record: (e2) => keep(session, e2),
    send: (response) => {
      if (current()) replyToWindow?.(view, panel, { ...response, vinduMount: x.mount });
    },
    onMessage: more.onAppMessage,
    onOpenLink: more.onOpenLink,
  }).catch((error) => log(session, { app: { view, panel, failed: String(error) } }));
  return true;
}
export function appControls(session: Session) {
  const more = session.more;
  return {
    /** Run the exact input a person submitted in the host's own control. Never forward an iframe or model
     *  message to this method. Connector calls stay subject to the host's connector policy. */
    async submitAppTool(
      { view, panel, frame, name, arguments: input }: AppSubmission,
      dispatch?: (server: string, tool: string, args: Record<string, unknown>) => Promise<unknown>,
    ): Promise<unknown> {
      const app = session.data.get(view)?.[panel]?.app;
      const shell = session.shell.state();
      if (
        session.closed ||
        !app ||
        app.url !== frame ||
        !viewsOf(shell.tree).includes(view) ||
        (shell.maximized && shell.maximized !== view)
      )
        throw new Error('This app pane is no longer open');
      const provider = more.apps;
      if (
        !provider ||
        app.tool !== name ||
        !appsOn(session.runtime.options.apps, app.server) ||
        !canSubmitApp(provider.tools(app.server), name, app.uri)
      ) {
        throw new Error('The submitted tool is unavailable for this app pane');
      }
      z.record(z.string(), z.json()).parse(input);
      // Keep the exact JSON keys and retain an independent record of what left the control.
      const submitted = structuredClone(input),
        args = structuredClone(submitted);
      const result = dispatch ? await dispatch(app.server, name, args) : await provider.call(app.server, name, args);
      keep(session, {
        to: `${app.server}.${name}`,
        by: 'person',
        from: { view, panel },
        values: { arguments: submitted },
        output: result,
      });
      return result;
    },
  };
}
