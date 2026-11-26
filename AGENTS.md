# Working on Vindu

Vindu is a public UI SDK, `@matapao/vindu` on npm: UI sessions, an MCP provider and a page host for a Node backend or an
Electron main process (Node 22 or later), and a renderer on A2UI's Lit renderer for a browser or an Electron window,
all in TypeScript. This file is for the people and coding agents who change it.

## Check your work

- Setup: the Node in `.nvmrc` (26.13.1) and pnpm 12 (`packageManager`), then `pnpm install --frozen-lockfile` and
  `pnpm exec playwright install chromium`.
- `pnpm check` must pass before you say a change works. It runs, every one even after one fails: `typecheck` (the SDK,
  tests and examples), `lint` (oxlint with type-aware rules on src, test, scripts and examples, then Knip for unused
  code and dependencies), `format:check` (Prettier), `check:files` (500 lines a file, the Markdown, suppressions with
  their reasons, nothing left behind) and `test` (builds the SDK and runs Vitest, in Node and Chromium, with isolated
  data). CI runs `pnpm check --coverage` on macOS: `test:coverage`, the same tests with their floors (lines 68,
  branches 64, functions 69, as measured; `vitest.config.ts`), and `pnpm check` on Linux, not yet required.
- `pnpm check:security` when a change adds a package or touches `.github/`: lockfile sources, hidden characters,
  licences, OSV-Scanner, secrets, Semgrep, zizmor and actionlint. CI runs it with `--strict`, and pnpm audit too.
- This repository's extra checks, in CI too: `pnpm test:package` installs the packed SDK into an independent browser
  consumer and exercises it in Chromium; `pnpm check:package` checks the packed tarball with publint and
  are-the-types-wrong; after building, `node --test scripts/test-runtime.mjs` runs the public provider and its MCP
  endpoints, which CI does on Node 22.0.0 (engines.node) and 24.22.3 (Electron 45), with the whole suite on 24.22.3.
- The tests give the same answer every run: the test files run in a random order, and the tests inside a file in order,
  as they share one session (a browser, a provider); Vitest prints the seed it used ("Running tests with seed"), and
  `pnpm test --sequence.seed=<seed>` runs the files in that order again. Every test process
  runs in UTC (`test.env`, asserted in `test/determinism.test.ts`). No retries, no `.only`, no snapshots written in
  CI, no network beyond loopback and no model calls. A new test waits for what it expects, never a fixed time; about
  90 older waits still sleep a fixed time (most to see that nothing happened) and are to be replaced.
- A release is a commit that sets `version` in package.json, and its tag `v<version>`: the Publish workflow
  (`publish.yml`) publishes it to npm by trusted publishing, with provenance, and attaches the attested tarball, its
  attestation (`.sigstore.json`, `.intoto.jsonl`) and its SBOM (`.cdx.json`) to the tag's GitHub release. npm's
  trusted publisher for `@matapao/vindu` names matapao/vindu and `publish.yml`.
- On GitHub, CodeQL (`codeql.yml`), dependency review and OpenSSF Scorecard run on the public repository; Dependabot
  proposes updates a week after release. `pnpm github:settings` says which of the repository's settings differ from
  the standard; the owner applies them with `--apply`.

## Layout

- `src/`: the Node provider (`index.ts`, `provider.ts`, `server.ts` and `server/`: sessions, tools, checkpoints), the
  page host (`pages.ts`, `page-*.ts`), views (`views/`: terminals and browser pages), card kinds (`card-kinds/`), the
  Playwright page driver (`drivers/`) and the renderer (`renderer/`, `renderer/blocks/`), the browser entry.
- `test/`: Vitest tests (`*.test.ts`), compiled with the SDK into `out/` and run from there. `helpers.ts` has the
  shared clients, servers and typed readers, `*-session.ts` the setup of a subject whose tests span two files (each
  file gets its own session), `globals.d.ts` what tests read on a page (`window.app`), and `fixtures/` the shell and
  app pages the browser tests load.
- `examples/`: how a host uses the SDK, type-checked with the tests.
- `scripts/`: the checks (`check.mjs`, `check-files.mjs`, `check-security.mjs`), the package checks
  (`test-package.mjs`, `check-package.mjs`, `packed-sdk.mjs`, `fixtures/`), `test-runtime.mjs` and
  `github-settings.mjs`.
- `types/`: declarations for what the consumer's bundler resolves; `patches/`: the workspace's dependency patch.

## Rules

- Keep UI sessions, the MCP provider and the renderer in `src/`.
- Keep Node built-ins and Electron out of the browser entry.
- Run the provider in the consumer’s backend or Electron main process. The host owns harness startup, credentials,
  model selection, execution policy, device permissions and cancellation.
- Keep consumer names and app-specific prompts or tool descriptions out of the SDK.
- Vindu installs no app and is installed in none. `mountShell` is a UI component a host mounts in its own window.
- Give each module one responsibility. Aim for 300 lines; `check:files` enforces 500 for every hand-written file,
  comments and blank lines included.
- Use descriptive names, named exports and type-only imports. Keep related state and operations together.
- Prettier formats the code but not what is inside lit's `html` and `css` templates (`embeddedLanguageFormatting`
  off): the whitespace in a template is text a view reads and says.
- Prefer straightforward control flow: no nested ternaries (an if/else or a small named function) and no explicit
  `any` (a real type, or `unknown` and a check). Keep semantic markup, presentation and data handling distinct.
- A2UI's Zod advisory GHSA-mrhx-c7xc-m3w5 is covered by the workspace patch (`patches/`) and the renderer's guard
  (`withinSurfaceLimits`, `guardA2uiArrays`). Accepted advisories, each with its reason and an expiry, are in
  `osv-scanner.toml` (and `scripts/fixtures/osv-scanner.toml` for the consumer's lockfile); the daily security run
  fails on any other.
- The supported Node versions (22 and 24) set `engines.node` and `@types/node`; the toolchain is `.nvmrc`.

## Don't

- Push, merge, tag, publish or deploy: those are the person's.
- Add Markdown besides README.md, AGENTS.md and `.github/SECURITY.md`, or a file over 500 lines.
- Add a suppression without its reason (`-- <reason>`, `@ts-expect-error <reason>`).
- Edit generated files: `pnpm-lock.yaml` (pnpm), `scripts/fixtures/pnpm-lock.yaml` (`pnpm test:package
--update-lockfile`), `patches/` (`pnpm patch-commit`), and nothing in `dist/` or `out/`.
- Call a model from a test, or reach the network beyond loopback.
