# Working on the Vindu SDK

## Boundaries

- Keep UI sessions, the MCP provider and the renderer in `src/`.
- Keep Node built-ins and Electron out of the browser entry.
- Run the provider in the consumer’s backend or Electron main process. The host owns harness startup,
  credentials, model selection, execution policy, device permissions and cancellation.
- Keep consumer names and app-specific prompts or tool descriptions out of the SDK.

## Code style

- Give each module one responsibility. Aim for 300 physical lines. `pnpm lint` enforces 500 for
  handwritten source, tests and configuration, including comments and blank lines.
- Use descriptive names, named exports and type-only imports. Keep related state and operations together.
- Prefer straightforward control flow. Keep semantic markup, presentation and data handling distinct.

## Checks

Install with `pnpm install --frozen-lockfile` and `pnpm exec playwright install chromium`.
Run these checks from the repository root and report the results.

- `pnpm lint`: ESLint on the scripts, oxlint with type-aware rules on all code, Knip for unused code and
  dependencies, and the line limits (500 a file, 50 the README).
- `pnpm typecheck` checks the SDK, tests and examples.
- `pnpm test` builds the SDK and runs Vitest and Chromium using isolated data.
- `pnpm test:package` installs the packed SDK into an independent browser consumer and exercises it in Chromium;
  `pnpm check:package` checks the packed tarball with publint and are-the-types-wrong.
- After building, `node --test scripts/test-runtime.mjs` verifies the public provider and its MCP endpoints.
- `pnpm check:security` when a change adds a package or touches `.github/`: lockfile sources, hidden characters,
  licences, OSV-Scanner, secrets, Semgrep, zizmor and actionlint. CI runs it with `--strict`, and pnpm audit too.
- `pnpm lint:style` reports the owner's style (Prettier, no nested ternaries, no explicit any) until the code follows it.

GitHub's CodeQL default setup scans the code, and CI runs OpenSSF Scorecard on public repositories. Dependabot
proposes updates a week after release.
Tests run without model calls. Leave pushes and merges to the person.
