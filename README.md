# Vindu

[![Checks](https://github.com/matapao/vindu/actions/workflows/checks.yml/badge.svg)](https://github.com/matapao/vindu/actions/workflows/checks.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/matapao/vindu/badge)](https://scorecard.dev/viewer/?uri=github.com/matapao/vindu)

Vindu is a TypeScript UI SDK for browsers and Electron: it turns tool results into interactive panes and accepts
input from them. The host owns the harness, credentials, permissions, conversation and workspace. Each exported option
and function says in its doc comment what it does.

## Setup

`pnpm add @matapao/vindu` installs it from npm; the server needs Node.js 22 or later. A sibling app can depend on it
through `link:../vindu`.

## Use

### Connect a task

In the Node backend or Electron main process, open one session per task with the host’s transport (`ipc` here).

```ts
import { memoryResults, startVindu } from '@matapao/vindu/server';

const provider = await startVindu();
const results = memoryResults();
const ui = provider.open({ results }, { onView: (v) => ipc.show(v), onState: (s) => ipc.layout(s), refetch });
ipc.onEvent((event) => ui.event(event));
ui.result(results.add({ server, tool, input, value }).id);
```

Call `ui.result` for every result. Give `ui.mcpServer` to the task’s trusted MCP client (its URL and headers grant
access to the task; `mcpTokenIn: 'header'` keeps the token out of URLs), and `ui.layoutMcpServer` to a layout-only
coordinator. What a session writes from results goes with `ui.close()`, in a temporary folder (`tempDir`); its
checkpoint keeps where each came from, read again by `refetch` on `restore`. Close the provider with `provider.close()`.

### Render and interact

- `mountShell` (`@matapao/vindu`) is a component the host mounts in its own window; nothing installs into it. It draws
  views and layout (`shell.view`, `shell.state`); route `onEvent` to `ui.event`. `mountWorkspace` adds a composer.
- Register host cards, operations and MCP Apps (`apps`) in `startVindu`, and relay `onApp` to `shell.app`.
- `views` on `provider.open` gives a task terminals and browser pages (`ViewsSetup`).
- Diff panels read the last commit through the host’s `head`. Vindu runs no git of its own; `gitHead(work)` is a
  hardened one, for a host that accepts running git on a folder the model can write.
- `@matapao/vindu/app-submission` gives evidence, never approval: see `matches`.

### Keep page data in

Pages cannot fetch from the network, but a frame can navigate away with what it read: put `frame-src
${pageFrameSource(provider.pagesPort)}` in the window’s CSP, check Electron’s `will-frame-navigate` with
`pageNavigationAllowed` and set `pageParentOrigins`. Working-folder pages read only their `uses`; secret files stay out.

## Develop

`pnpm install --frozen-lockfile && pnpm check`, on the Node in `.nvmrc` and pnpm 12. [AGENTS.md](AGENTS.md) has the
rest.

## Security

Report a vulnerability privately, as [.github/SECURITY.md](.github/SECURITY.md) says. Verify a release's tarball with
`gh attestation verify <tarball> --repo matapao/vindu`.

## License

MIT: see [LICENSE](LICENSE).
