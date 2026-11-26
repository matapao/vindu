// Code and diff panels: a file in the working folder in Monaco (offline, live), and what changed in it since the last
// commit.
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { gitHead, startVindu, memoryResults } from '../src/index.js';
import { playwrightDriver } from '../src/drivers/playwright.js';
import { chromium, mcpClient } from './helpers.js';

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const work = tmp('code-work-');
const git = (...a: string[]) =>
  execFileSync('git', ['-C', work, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...a], {
    encoding: 'utf8',
  });
fs.mkdirSync(path.join(work, 'src'));
fs.writeFileSync(path.join(work, 'src/fare.ts'), 'export function fare(km: number) {\n  return 30 + km * 12;\n}\n');
fs.writeFileSync(path.join(work, 'notes.md'), '# Notes\n\nFerry fares.\n');
git('init', '-q');
git('add', '.');
git('commit', '-qm', 'first');
fs.writeFileSync(
  path.join(work, 'src/fare.ts'),
  'export function fare(km: number, child = false) {\n  const full = 30 + km * 12;\n  return child ? full / 2 : full;\n}\n',
);
fs.writeFileSync(path.join(work, 'src/route.ts'), 'export const route = "Bergen–Stavanger";\n');
fs.writeFileSync(path.join(work, 'logo.bin'), Buffer.from([0x89, 0x50, 0x00, 0x01]));
const plain = tmp('code-plain-');
fs.writeFileSync(path.join(plain, 'a.ts'), 'export const a = 1;\n');

const browser = await chromium.launch();
const vindu = await startVindu({ driver: playwrightDriver(browser) });
const results = memoryResults(tmp('code-task-'));
const ui = vindu.open({ results, dir: tmp('code-dir-'), work, head: gitHead(work) }); // the host reads the folder's repository
const bare = vindu.open({ results, dir: tmp('code-dir2-'), work: plain, head: gitHead(plain) });
const { mcp, call, json } = await mcpClient(ui.url);
const other = await mcpClient(bare.url);
afterAll(async () => {
  await mcp.close();
  await other.mcp.close();
  ui.close();
  bare.close();
  await vindu.close();
  await browser.close();
});
const only = (o: Record<string, unknown>, keys: string[]) =>
  Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));

test('a file as code, and what changed in it since the last commit: which file, its language and lines, and the change', async () => {
  const a = await json('show_view', {
    name: 'fare',
    title: 'Fare',
    panels: [{ card: 'code', path: 'src/fare.ts', line: 3 }],
  });
  assert.deepEqual(only(a.panels[0], ['card', 'from', 'seen', 'path', 'language', 'lines', 'line']), {
    card: 'code',
    from: 'work/src/fare.ts',
    seen: 'the file itself',
    path: 'src/fare.ts',
    language: 'typescript',
    lines: 4,
    line: 3,
  });
  assert.equal(a.shell.this.view, 'fare');
  assert.equal(a.panels[0].marked, undefined); // a file in the working folder is not the model's own writing
  const d = await json('show_view', {
    name: 'changes',
    title: 'Changes',
    panels: [
      { card: 'diff', path: 'src/fare.ts' },
      { card: 'diff', path: 'src/route.ts' },
    ],
  });
  assert.match(d.panels[0].against, /^HEAD \([0-9a-f]{7,}\)$/);
  assert.deepEqual(only(d.panels[0], ['added', 'removed', 'new']), { added: 3, removed: 2 });
  assert.deepEqual(only(d.panels[1], ['added', 'removed', 'new']), { added: 1, removed: 0, new: true }); // not in the last commit: all of it new
  const bad = (
    await call('show_view', {
      name: 'bad',
      title: 'Bad',
      panels: [
        { card: 'code' },
        { card: 'code', path: 'nope.ts' },
        { card: 'code', path: 'logo.bin' },
        { card: 'code', path: 'notes.md', line: 99 },
        { card: 'code', path: '../outside.ts' },
      ],
    })
  ).text;
  assert.match(bad, /^not shown: 5 panels need changes/);
  assert.match(bad, /needs "path": a file in the working folder/);
  assert.match(bad, /no file "nope.ts" in the working folder/);
  assert.match(bad, /"logo.bin" is not text/);
  assert.match(bad, /"notes.md" has 3 lines, so there is no line 99/);
  assert.match(bad, /no file "\.\.\/outside.ts"/);
  assert.match(
    (await other.call('show_view', { name: 'd', title: 'D', panels: [{ card: 'diff', path: 'a.ts' }] })).text,
    /not a git repository, so there is no last commit to compare with; show the file with a code panel/,
  );
});

test('Monaco draws them, offline: the file as it is, the file again when it changes, and both sides of a diff', async () => {
  await json('show_view', { name: 'live', title: 'Live', panels: [{ card: 'code', id: 'notes', path: 'notes.md' }] });
  setTimeout(() => fs.writeFileSync(path.join(work, 'notes.md'), '# Notes\n\nFerry fares, by route.\n'), 1800);
  const value = 'js:monaco.editor.getModels()[0].getValue()';
  const r = await json('check_page', {
    panel: 'notes',
    steps: [{ wait: 'body[data-ready]' }, { js: 'monaco.editor.getModels()[0].getValue()' }, { wait: 3000 }],
    read: [value, 'js:monaco.editor.getModels()[0].getLanguageId()'],
  });
  assert.equal(r.errors, undefined, JSON.stringify(r.errors));
  assert.equal(r.failed_requests, undefined);
  assert.equal(r.blocked, undefined);
  assert.equal(r.steps[1].note, '# Notes\n\nFerry fares.\n');
  assert.equal(r.read[value], '# Notes\n\nFerry fares, by route.\n'); // read again when it changed, in place
  assert.equal(r.read['js:monaco.editor.getModels()[0].getLanguageId()'], 'markdown');
  await json('show_view', {
    name: 'delta',
    title: 'Delta',
    panels: [{ card: 'diff', id: 'fare', path: 'src/fare.ts' }],
  });
  const d = await json('check_page', {
    panel: 'fare',
    steps: [{ wait: 'body[data-ready]' }, { wait: '.editor.modified .view-lines' }, { wait: 300 }],
    read: ['.editor.original .view-lines', '.editor.modified .view-lines'],
  });
  assert.match(d.read['.editor.original .view-lines'], /return 30 \+ km \* 12;/);
  assert.match(d.read['.editor.modified .view-lines'], /return child \? full \/ 2 : full;/);
});
