// Install exactly what downstream apps receive, outside this repository and its dependency overrides.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { withPackedSdk } from './packed-sdk.mjs';

const lockfile = new URL('./fixtures/pnpm-lock.yaml', import.meta.url);
// After an intentional dependency change: pnpm test:package --update-lockfile
const updateLockfile = process.argv.includes('--update-lockfile');
await withPackedSdk('test:package', async ({ dir, archive, pnpm }) => {
  // pnpm locks a local directory by its dependencies, independent of edits to the packed code.
  execFileSync('tar', ['-xzf', archive], { cwd: dir });
  const manifest = JSON.parse(readFileSync(join(dir, 'package', 'package.json'), 'utf8'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'browser-consumer', private: true, type: 'module',
    dependencies: { [manifest.name]: 'file:./package', '@a2ui/web_core': manifest.dependencies['@a2ui/web_core'] },
  }));
  copyFileSync(lockfile, join(dir, 'pnpm-lock.yaml'));
  pnpm(dir, 'install', updateLockfile ? '--no-frozen-lockfile' : '--frozen-lockfile', '--ignore-scripts', '--prefer-offline');
  const entry = join(dir, 'consumer.ts');
  copyFileSync(new URL('./fixtures/package-consumer.ts', import.meta.url), entry);
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', strict: true,
      noEmit: true, skipLibCheck: false, types: [], lib: ['ES2023', 'DOM', 'DOM.Iterable'],
    },
    files: ['consumer.ts'],
  }));
  const tsc = join(dirname(fileURLToPath(import.meta.resolve('typescript/package.json'))), 'bin/tsc');
  execFileSync(process.execPath, [tsc, '-p', dir], { cwd: dir, stdio: 'inherit' });
  const { outputFiles } = await build({
    entryPoints: [entry], outfile: join(dir, 'consumer.js'), bundle: true,
    platform: 'browser', format: 'iife', globalName: 'consumer', write: false,
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const javascript = outputFiles.find(file => file.path.endsWith('.js'));
    const stylesheet = outputFiles.find(file => file.path.endsWith('.css'));
    assert.ok(javascript);
    assert.ok(stylesheet?.text.includes('.xterm'), 'The terminal entry includes its stylesheet');
    await page.addStyleTag({ content: stylesheet.text });
    await page.addScriptTag({ content: javascript.text });
    assert.deepEqual(await page.evaluate(() => globalThis.consumer.check()), {
      mounted: true, valid: true, overLimit: false, visited: 1,
    });
  } finally { await browser.close(); }
  if (updateLockfile) copyFileSync(join(dir, 'pnpm-lock.yaml'), lockfile);
  console.log('The packed SDK passed strict browser type checking, mounted a workspace and enforced collection bounds.');
});
