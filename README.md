# Vindu

Vindu is a TypeScript UI SDK for browsers and Electron: it turns tool results into interactive panes and accepts
input from them. The host owns the harness, credentials, permissions, conversation and workspace. Each exported option
and function says in its doc comment what it does.

## Install

The SDK needs Node.js 22 or later on the server. To build it, use Node 24 and pnpm: `pnpm install --frozen-lockfile`,
then `pnpm build`. A sibling app can depend on `@matapao/vindu` through `link:../vindu`; `pnpm pack` makes a tarball.

## Connect a task

In the Node backend or Electron main process, open one session per task, with the host’s transport to its
renderer (`ipc` here), and `taskDir` the task’s private directory.

```ts
import { memoryResults, startVindu } from '@matapao/vindu/server';

const provider = await startVindu();
const results = memoryResults(taskDir);
const ui = provider.open({ dir: taskDir, results }, { onView: (v) => ipc.show(v), onState: (s) => ipc.layout(s) });
ipc.onEvent((event) => ui.event(event));
ui.result(results.add({ server, tool, input, value }).id);
```

Call `ui.result` for every result. Give `ui.mcpServer` to the task’s trusted MCP client (its URL and headers grant
access to the task; `mcpTokenIn: 'header'` keeps the token out of URLs), and `ui.layoutMcpServer` to a layout-only
coordinator. Close with `ui.close()` and `await provider.close()`.

## Render and interact

- `mountShell` from `@matapao/vindu` draws views and layout (`shell.view`, `shell.state`); route `onEvent` to
  `ui.event`. `mountWorkspace` adds the Activity sidebar and composer.
- Register host cards, operations and MCP Apps (`apps`) in `startVindu`, and relay `onApp` to `shell.app`.
- `views` on `provider.open` gives a task terminals and browser pages (`ViewsSetup`).
- Diff panels read the last commit through the host’s `head`. Vindu runs no git of its own; `gitHead(work)` is a
  hardened one, for a host that accepts running git on a folder the model can write.
- `@matapao/vindu/app-submission` gives evidence, never approval: see `matches`.

## Keep page data in

Pages cannot fetch from the network, but a frame can navigate away with what it read: put `frame-src
${pageFrameSource(provider.pagesPort)}` in the window’s CSP, check Electron’s `will-frame-navigate` with
`pageNavigationAllowed` and set `pageParentOrigins`. Working-folder pages read only their `uses`; secret files stay out.

## Checks

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:package` and `pnpm check:security` run in CI on macOS and Linux.
The workspace patch and the renderer’s guard cover A2UI’s Zod advisory GHSA-mrhx-c7xc-m3w5.
