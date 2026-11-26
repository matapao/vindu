// Diff panels and git: Vindu runs no git of its own, and gitHead, which a host may pass as a process's head, runs no
// command a repository names. The repository here is a partial clone whose promisor remote is a command
// (ext::sh -c …, allowed by its own configuration): plain git runs it to fetch the blob it lacks.
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { gitHead, memoryResults, startVindu } from '../src/index.js';
import { mcpClient } from './helpers.js';

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const repo = tmp('lazy-repo-'),
  marker = path.join(tmp('lazy-marker-'), 'ran');
const git = (...a: string[]) =>
  execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...a], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
fs.writeFileSync(path.join(repo, 'f.txt'), 'one\n');
git('init', '-q');
git('add', 'f.txt');
git('commit', '-qm', 'first');
const blob = git('rev-parse', 'HEAD:f.txt').trim();
fs.rmSync(path.join(repo, '.git', 'objects', blob.slice(0, 2), blob.slice(2))); // the blob is the promisor's to give
for (const [k, v] of [
  ['core.repositoryformatversion', '1'],
  ['extensions.partialClone', 'origin'],
  ['remote.origin.promisor', 'true'],
  ['remote.origin.url', `ext::sh -c touch% ${marker}`],
  ['protocol.ext.allow', 'always'],
])
  git('config', k, v);
fs.writeFileSync(path.join(repo, 'f.txt'), 'two\n');
fs.writeFileSync(path.join(repo, 'new.txt'), 'a\nb\n');

const vindu = await startVindu();
const results = memoryResults(tmp('lazy-task-'));
afterAll(async () => {
  await vindu.close();
});

test('the repository is one that runs its command when plain git reads it', () => {
  try {
    execFileSync('git', ['-C', repo, 'cat-file', 'blob', 'HEAD:./f.txt'], { stdio: 'ignore' });
  } catch {
    /* the fetch fails after the command ran */
  }
  assert.equal(fs.existsSync(marker), true);
  fs.rmSync(marker);
});

test('gitHead reads the last commit with plumbing alone: no fetch, so no command the repository names', () => {
  const head = gitHead(repo);
  const lacking = head('f.txt');
  assert.match(JSON.stringify(lacking), /git could not read \\"f.txt\\" in the last commit/);
  assert.deepEqual(head('new.txt'), {
    text: '',
    commit: git('rev-parse', '--short', 'HEAD').trim(),
    added: 2,
    removed: 0,
    new: true,
  });
  assert.match(JSON.stringify(head('../outside.txt')), /no file/);
  assert.equal(fs.existsSync(marker), false);
});

test('without a head, a diff panel says so, and nothing runs at all', async () => {
  const ui = vindu.open({ results, dir: tmp('lazy-dir-'), work: repo });
  const { mcp, call } = await mcpClient(ui.url);
  try {
    const r = await call('show_view', { name: 'd', title: 'D', panels: [{ card: 'diff', path: 'f.txt' }] });
    assert.match(r.text, /this host gives no last commit to compare with; show the file with a code panel/);
    assert.equal(fs.existsSync(marker), false);
    const code = await call('show_view', { name: 'c', title: 'C', panels: [{ card: 'code', path: 'f.txt' }] });
    assert.equal(code.ok, true, code.text); // a code panel needs no git
  } finally {
    await mcp.close();
    ui.close();
  }
});

test('with gitHead as the head, a diff panel shows a file the commit has, and still runs nothing', async () => {
  const plain = tmp('plain-repo-');
  const g = (...a: string[]) =>
    execFileSync('git', ['-C', plain, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...a], {
      stdio: 'ignore',
    });
  fs.writeFileSync(path.join(plain, 'a.ts'), 'export const a = 1;\n');
  g('init', '-q');
  g('add', '.');
  g('commit', '-qm', 'first');
  fs.writeFileSync(path.join(plain, 'a.ts'), 'export const a = 2;\nexport const b = 3;\n');
  const ui = vindu.open({ results, dir: tmp('plain-dir-'), work: plain, head: gitHead(plain) });
  const { mcp, json } = await mcpClient(ui.url);
  try {
    const d = await json('show_view', { name: 'd', title: 'D', panels: [{ card: 'diff', path: 'a.ts' }] });
    assert.deepEqual({ added: d.panels[0].added, removed: d.panels[0].removed }, { added: 2, removed: 1 });
    assert.equal(fs.existsSync(marker), false);
  } finally {
    await mcp.close();
    ui.close();
  }
});
