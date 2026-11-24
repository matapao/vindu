// What a consumer installs, checked as published: the package packed with pnpm, then publint (its package.json and
// exports) and are-the-types-wrong (that each entry's types resolve as its code does, ESM only). test:package installs
// the same tarball into a browser consumer; this checks the package itself.
import { join } from 'node:path';
import { sdk, withPackedSdk } from './packed-sdk.mjs';

await withPackedSdk('check:package', ({ dir, archive, pnpm }) => {
  const tarball = join(dir, archive);
  pnpm(sdk, 'exec', 'publint', 'run', tarball, '--strict');
  pnpm(sdk, 'exec', 'attw', tarball, '--profile', 'esm-only');
});
