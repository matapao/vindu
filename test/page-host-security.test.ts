// The page host's edges, over plain HTTP: names it writes, origins it answers to (128-bit keys, its own port only),
// who may frame it, what an attachment is served as, what a working folder never gives out (dot names, secrets, a link
// out), prototype names that are no file, apps' declared domains, waits that end with their request, where the boot
// script goes in a page, libraries found only when asked for, and the pdf viewer with the files of pdf.js it needs.
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { appCsp, CSP, inject, memoryResults, pageNavigationAllowed, startPageHost, watchFolder } from '../src/index.js';
import { secretName } from '../src/page-workspace.js';
import { pdfPage } from '../src/pdf-page.js';
import { get, sleep, tinyPdf } from './helpers.js';

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const write = (root: string, files: Record<string, string>) => {
  for (const [f, s] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), s);
  }
};

const work = tmp('host-work-'),
  dir = tmp('host-task-');
write(work, {
  'index.html': '<!doctype html><title>Site</title>',
  'credentials.ts': 'export const how = "ask the person";',
  'secret-santa.html': '<title>Santa</title>',
  id_rsa: 'PRIVATE',
  'server.key': 'PRIVATE',
  'tls/cert.pem': 'PRIVATE',
  'credentials.json': '{}',
  'config/secrets.yaml': 'x: 1',
  'client_secret.json': '{}',
  'secrets/db.txt': 'x',
  'secrets/index.html': '<title>In a folder of secrets</title>',
  'file.constructor': 'not a type',
});
const results = memoryResults(dir);
const script = path.join(dir, 'app.js');
fs.writeFileSync(script, 'document.title = "ran as a script";');
const js = results.attach('app.js', 'text/javascript', script);
const png = path.join(dir, 'dot.png');
fs.writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
const image = results.attach('dot.png', 'image/png', png);
const host = await startPageHost();
const key = host.add({ results, dir, work });
const base = host.base(key),
  workBase = base.replace('http://', 'http://work-');
afterAll(async () => {
  host.remove(key);
  await host.close();
});

test("a process's origin is a 128-bit key on the host's own port, and nothing else answers for it", async () => {
  assert.match(base, new RegExp(`^http://[a-f0-9]{32}\\.localhost:${host.port}$`));
  assert.match(
    host.workUrl(key, 'index.html', '', ['r1']),
    new RegExp(`^http://work-${key}-[a-f0-9]{24}\\.localhost:${host.port}/work/index\\.html\\?uses=r1$`),
  );
  assert.ok(new URL(host.workUrl(key, 'index.html', '', ['r1'])).hostname.split('.')[0].length <= 63); // one DNS label
  assert.equal((await get(`${base}/work/index.html`)).status, 200);
  const raw = (hostHeader: string) =>
    new Promise<number>((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port: host.port, path: '/work/index.html', headers: { host: hostHeader } }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        })
        .on('error', reject);
    });
  for (const other of [
    `${key}.localhost`,
    `${key}.localhost:${host.port + 1}`,
    `${key}.localhost:${host.port}0`,
    `${key.slice(0, 16)}.localhost:${host.port}`,
    `x${key}.localhost:${host.port}`,
  ])
    assert.equal(await raw(other), 404, other);
  assert.equal(pageNavigationAllowed(`http://${key.slice(0, 16)}.localhost:${host.port}/`, { port: host.port }), false); // the guard knows the names too
  const app = host.prepareApp(key, async () => ({ html: '<p>app</p>' }));
  assert.match(app.url, new RegExp(`^http://app-[a-f0-9]{32}\\.localhost:${host.port}/$`));
});

test("the names it writes are plain, and a diff needs the host's head: no git of Vindu's own", () => {
  for (const name of ['../evil', 'a/b', '', 'x'.repeat(201), 'with space', '..'])
    assert.throws(() => host.writeView(key, name, '<p>x</p>'), /a page's name is/, name);
  assert.equal(fs.existsSync(path.join(dir, 'evil.html')), false);
  assert.match(host.writeView(key, 'p_ok__1', '<p>x</p>'), /^p_ok__1\.html\?v=1$/);
  host.removeView(key, 'p_ok__1');
  assert.equal(fs.existsSync(path.join(dir, 'views', 'p_ok__1.html')), false);
  assert.deepEqual(host.headText(key, 'index.html'), {
    why: 'this host gives no last commit to compare with; show the file with a code panel',
  });
  let asked: string[] = [];
  const other = host.add({
    results,
    dir: tmp('host-head-'),
    work,
    head: (rel) => {
      asked.push(rel);
      return { why: 'asked' };
    },
  });
  for (const rel of ['../outside.txt', '.env', 'id_rsa', 'nope.ts'])
    assert.match(JSON.stringify(host.headText(other, rel)), /no file/, rel);
  assert.deepEqual(asked, []); // the host's head is asked only for a file in the folder
  host.headText(other, '/index.html');
  assert.deepEqual(asked, ['index.html']);
  asked = [];
  host.remove(other);
});

test('files of secrets are never served or read, on either origin; source code that only names them is', async () => {
  for (const name of [
    'id_rsa',
    'id_ed25519',
    'server.key',
    'cert.pem',
    'store.p12',
    'store.pfx',
    'AuthKey_1.p8',
    'vault.kdbx',
    'credentials',
    'credentials.json',
    'aws-credentials.ini',
    'client_secret.json',
    'secrets.yaml',
    'secret.txt',
    '_netrc',
  ])
    assert.equal(secretName(name), true, name);
  for (const name of [
    'credentials.ts',
    'secret-santa.html',
    'SecretsManager.ts',
    'keyboard.js',
    'secretary.json',
    'index.html',
    'id_rsa.pub',
  ])
    assert.equal(secretName(name), false, name);
  for (const p of [
    'id_rsa',
    'server.key',
    'tls/cert.pem',
    'credentials.json',
    'config/secrets.yaml',
    'client_secret.json',
    'secrets/db.txt',
  ])
    for (const origin of [base, workBase])
      assert.equal((await get(`${origin}/work/${p}`)).status, 404, `${origin} ${p}`);
  for (const p of ['credentials.ts', 'secret-santa.html'])
    assert.equal((await get(`${base}/work/${p}`)).status, 200, p);
  assert.deepEqual(host.workText(key, 'id_rsa'), { why: 'no file "id_rsa" in the working folder' }); // a code panel neither
  assert.equal(host.workAny(key, 'tls/cert.pem'), null);
  assert.ok(
    host.workPages(key).includes('secret-santa.html') && !host.workPages(key).some((p) => p.startsWith('secrets/')),
    JSON.stringify(host.workPages(key)),
  );
});

test('the folder watcher follows no link out of the folder and hears no file of secrets', async () => {
  const root = tmp('watch-root-'),
    outside = tmp('watch-outside-');
  fs.mkdirSync(path.join(outside, 'deep'));
  fs.symlinkSync(outside, path.join(root, 'early')); // there before the watch
  const heard: string[] = [];
  const stop = watchFolder(root, (paths) => heard.push(...paths), 20);
  try {
    fs.symlinkSync(outside, path.join(root, 'late')); // and one made while it watches
    await sleep(300);
    heard.length = 0;
    fs.writeFileSync(path.join(outside, 'leak.txt'), 'x');
    fs.writeFileSync(path.join(outside, 'deep', 'leak.txt'), 'x');
    fs.writeFileSync(path.join(root, 'id_rsa'), 'x');
    fs.writeFileSync(path.join(root, 'notes.txt'), 'x');
    await sleep(400);
    assert.deepEqual([...new Set(heard)], ['notes.txt']); // one file may be heard twice (made, then written): only which files counts
  } finally {
    stop();
  }
});

test('an attachment is served as what it is only when it is media or text; never as a script, and never run', async () => {
  const asScript = await get(`${base}/media/${js.id}`);
  assert.equal(asScript.headers['content-type'], 'application/octet-stream');
  assert.equal(
    asScript.headers['content-security-policy'],
    "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox",
  );
  assert.equal((await get(`${base}/media/${image.id}`)).headers['content-type'], 'image/png');
  assert.equal((await get(`${base}/work/file.constructor`)).headers['content-type'], 'application/octet-stream'); // no type named by a prototype key
});

test('a name the prototype has is no library wrapper, and no 500', async () => {
  for (const name of ['toString', 'constructor', '__proto__', 'hasOwnProperty'])
    assert.equal((await get(`${base}/lib/_vindu/${name}`)).status, 404, name);
  assert.equal((await get(`${base}/lib/_vindu/three.js`)).status, 200);
});

test("an app's declared domains are hosts of its own: no wildcard alone, no script from data:", () => {
  const csp = appCsp(
    {
      resourceDomains: [
        'https://*',
        'https://*.com',
        'https://*.example.com',
        'https://cdn.example.com:8443',
        'https://x*.example.com',
        'http://plain.example.com',
        'https://localhost',
      ],
      connectDomains: ['https://*'],
    },
    true,
  );
  const scripts = csp.split('; ').find((d) => d.startsWith('script-src'))!;
  assert.equal(
    scripts,
    "script-src 'unsafe-inline' 'unsafe-eval' blob: https://*.example.com https://cdn.example.com:8443",
  );
  assert.match(csp, /connect-src 'none'/);
  assert.doesNotMatch(
    appCsp({}, false)
      .split('; ')
      .find((d) => d.startsWith('script-src'))!,
    /data:/,
  );
});

test("who may frame pages and apps: exact origins, or a window's own scheme alone; never a scheme anyone has", async () => {
  for (const bad of [
    'https:',
    'http:',
    'data:',
    'blob:',
    'about:',
    'javascript:',
    'FILE:',
    'file://',
    'https://*.example.com',
    'https://example.com/path',
  ])
    await assert.rejects(startPageHost({ pageParentOrigins: [bad] }), /pageParentOrigins/, bad);
  const framed = await startPageHost({ pageParentOrigins: ['file:', 'app:', 'http://localhost:5173/'] });
  try {
    const k = framed.add({ results, dir: tmp('host-framed-'), work });
    assert.match(
      String((await get(`${framed.base(k)}/work/index.html`)).headers['content-security-policy']),
      /; frame-ancestors file: app: http:\/\/localhost:5173; sandbox$/,
    );
    const app = framed.prepareApp(k, async () => ({ html: '<p>app</p>' }));
    app.mount();
    assert.match(
      String((await get(app.url)).headers['content-security-policy']),
      /^default-src 'none'; .*; frame-ancestors file: app: http:\/\/localhost:5173$/,
    );
    assert.match(
      String((await get(`${framed.base(k)}/media/${image.id}`)).headers['content-security-policy']),
      /; frame-ancestors file: app: http:\/\/localhost:5173; sandbox$/,
    );
  } finally {
    await framed.close();
  }
  const app = host.prepareApp(key, async () => ({ html: '<p>app</p>' }));
  app.mount();
  assert.doesNotMatch(String((await get(app.url)).headers['content-security-policy']), /frame-ancestors/); // none set: none said
});

test('a page that stops waiting for events takes its timers with it', async () => {
  const timers = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
  const before = timers();
  const requests = ['/__vindu/events?v=0&n=0', '/__vindu/changes?since=0', '/__vindu/events?v=0&n=0'].map((p) =>
    http
      .get({ host: '127.0.0.1', port: host.port, path: p, headers: { host: new URL(base).host } })
      .on('error', () => undefined),
  );
  // the timers as soon as they count as expected, or after 5 s: polled, as the requests arrive when they do
  const settled = async (expected: (n: number) => boolean) => {
    for (const end = Date.now() + 5000; !expected(timers()) && Date.now() < end;) await sleep(10);
    return timers();
  };
  const during = await settled((n) => n >= before + 3);
  assert.ok(during >= before + 3, `${during} timers while they wait, ${before} before`);
  for (const r of requests) r.destroy();
  const after = await settled((n) => n <= before);
  assert.ok(after <= before, `${after} timers after they left, ${during} while they waited, ${before} before`);
});

test('the boot script comes before anything a page runs, whatever its markup says', () => {
  const tags = (html: string) => inject(html, [], false);
  const bootAt = (html: string) => tags(html).indexOf('<script type="importmap">');
  const pageScript = (html: string) => tags(html).indexOf('<script>');
  for (const html of [
    '<!doctype html><!-- <head> --><script>early()</script><head><title>x</title></head>',
    '<!doctype html><script>early()</script><head></head>',
    '<!--> <script>early()</script> <!-- --><!doctype html><head></head>',
    '<!---> <script>early()</script> --><head></head>',
    '<!-- a --!> <script>early()</script> --><head></head>',
    '<?xml version="1.0"?><script>early()</script><head></head>',
    '<html><body><script>early()</script><!-- <head> --></body></html>',
  ])
    assert.ok(bootAt(html) >= 0 && bootAt(html) < pageScript(html), html);
  assert.equal(tags('<!doctype html>\n<p>x</p>').startsWith('<!doctype html><script type="importmap">'), true); // on the doctype's line
  assert.equal(
    tags(' <!-- c -->\n<!DOCTYPE html><html lang="en">').indexOf('<html lang="en">') >
      bootAt(' <!-- c -->\n<!DOCTYPE html><html lang="en">'),
    true,
  );
  assert.match(
    tags('<p>a fragment</p>'),
    /^<!doctype html><head><meta charset="utf-8"><script type="importmap">.*<\/head><p>a fragment<\/p>$/,
  );
  assert.ok(tags('<!-- never ended <script>early()</script>').startsWith('<!-- never ended <script>early()</script>')); // all comment: it runs nothing
});

test("a library that is not installed is refused alone; the others, and the host's, still work", async () => {
  const lone = tmp('lone-libraries-'); // a copy of the module where no package is beside it
  fs.copyFileSync(new URL('../src/page-libraries.js', import.meta.url), path.join(lone, 'page-libraries.js'));
  const m = (await import(
    pathToFileURL(path.join(lone, 'page-libraries.js')).href
  )) as typeof import('../src/page-libraries.js');
  assert.ok(
    m.LIBRARIES.every((l) => l.version === 'not installed'),
    JSON.stringify(m.LIBRARIES),
  );
  const libDir = tmp('lone-host-lib-');
  fs.writeFileSync(path.join(libDir, 'd.js'), 'export const d = 1;');
  const table = m.libraryTable([
    { name: 'dee', version: '1.0.0', license: 'MIT', dir: libDir, imports: { dee: 'd.js' } },
  ]);
  assert.deepEqual(table.importMap, { dee: '/lib/dee/d.js' });
  assert.deepEqual(table.pinned, ['dee: dee 1.0.0']);
  assert.equal(table.dirOf('three/three.module.js'), undefined);
  assert.equal(table.dirOf('dee/d.js')?.[0], 'dee');
  assert.equal(m.wrapperFor('three.js'), undefined);
  assert.match(String(host.pinned.join('\n')), /three, three\/addons\/…: three \d/); // installed here: pinned
});

test("the pdf viewer is a page of the process's origin with its headers, and of pdf.js only what a viewer needs is served", async () => {
  const paper = results.attach('paper.pdf', 'application/pdf', path.join(dir, 'paper.pdf'));
  fs.writeFileSync(paper.file, tinyPdf(1));
  const kept = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
  const view = await get(
    `${base}/view/${host.writeView(key, 'p_paper__doc', pdfPage({ url: `/media/${paper.id}`, name: 'paper.pdf' }))}`,
  );
  assert.deepEqual(
    [view.status, view.headers['content-type'], view.headers['content-security-policy']],
    [200, 'text/html; charset=utf-8', CSP],
  ); // its requests stay on its origin
  for (const [k, v] of Object.entries(kept)) assert.equal(view.headers[k], v, k);
  assert.match(
    view.body,
    /^<!doctype html><script type="importmap">.*?<\/script><script src="\/__vindu\/boot\.js"><\/script>/,
  ); // the boot script first, as in every page
  assert.match(
    view.body,
    /from '\/lib\/pdfjs-dist\/build\/pdf\.min\.mjs';\nconst spec = \{"url":"\/media\/a\d+","name":"paper\.pdf"\};/,
  );
  const pdf = await get(`${base}/media/${paper.id}`); // what the viewer reads: the PDF as what it is, and never run as a page
  assert.deepEqual(
    [pdf.headers['content-type'], pdf.headers['x-content-type-options']],
    ['application/pdf', 'nosniff'],
  );
  assert.match(String(pdf.headers['content-security-policy']), /^default-src 'none'; .*; sandbox$/);
  for (const [file, type] of [
    ['build/pdf.min.mjs', 'text/javascript'],
    ['build/pdf.worker.min.mjs', 'text/javascript'],
    ['cmaps/UniJIS-UTF16-H.bcmap', 'application/octet-stream'],
    ['standard_fonts/LiberationSans-Regular.ttf', 'font/ttf'],
    ['standard_fonts/FoxitSerif.pfb', 'application/octet-stream'],
    ['wasm/openjpeg.wasm', 'application/wasm'],
    ['iccs/CGATS001Compat-v2-micro.icc', 'application/octet-stream'],
  ]) {
    const r = await get(`${base}/lib/pdfjs-dist/${file}`);
    assert.deepEqual(
      [r.status, r.headers['content-type'], r.headers['content-security-policy']],
      [200, type, CSP],
      file,
    );
    for (const [k, v] of Object.entries(kept)) assert.equal(r.headers[k], v, `${file} ${k}`);
  }
  for (const file of [
    '',
    'package.json',
    'LICENSE',
    'README.md',
    'build/pdf.mjs',
    'build/pdf.min.mjs.map',
    'build/pdf.worker.mjs',
    'build/pdf.worker.mjs.map',
    'build/pdf.sandbox.min.mjs',
    'build/pdf.renderer.min.mjs',
    'legacy/build/pdf.min.mjs',
    'web/pdf_viewer.mjs',
    'image_decoders/pdf.image_decoders.min.mjs',
    'wasm/quickjs-eval.wasm',
    'wasm/quickjs-eval.js',
    'wasm/openjpeg_nowasm_fallback.js',
    'cmaps/LICENSE',
    'types/src/pdf.d.ts',
    'build/../package.json',
    'cmaps/..%2Fpackage.json',
  ])
    assert.equal((await get(`${base}/lib/pdfjs-dist/${file}`)).status, 404, file);
});
