// The SDK packed as it is published, in a temporary folder of its own: what test:package installs and
// check:package checks.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const sdk = fileURLToPath(new URL('../', import.meta.url));

/** Packs the SDK with pnpm and gives `use` the folder, the tarball's name in it and pnpm (a folder to run in, then its
 *  arguments). The folder is removed when `use` is done. `script` is the package script that runs this. */
export async function withPackedSdk(script, use) {
  const pnpmScript = process.env.npm_execpath; // set when pnpm runs this script
  if (!pnpmScript) throw new Error(`Run this through pnpm: pnpm ${script}`);
  const pnpm = (cwd, ...args) => execFileSync(process.execPath, [pnpmScript, ...args], { cwd, stdio: 'inherit' });
  const dir = mkdtempSync(join(tmpdir(), 'vindu-package-'));
  try {
    pnpm(sdk, 'pack', '--pack-destination', dir);
    const [archive] = readdirSync(dir).filter((name) => name.endsWith('.tgz'));
    return await use({ dir, archive, pnpm });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
