// What a session writes on the computer from results lives only while it is open: its folder (a temporary one under the
// host's tempDir, readable by this user alone), the pictures of the results it read, its records (ui-calls.jsonl,
// answers.jsonl, reminders.jsonl) and the pages the model wrote. Closing it leaves nothing; in a dir of the host's own,
// Vindu's files go and the host's stay. All synthetic.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startVindu, memoryResults, type Shown } from '../src/index.js';
import { mcpClient } from './helpers.js';

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const VIEW = (photo: string) => ({
  name: 'site', title: 'Site visit', panels: [
    { id: 'photo', card: 'media', title: 'Photo', media: photo },
    { id: 'hours', card: 'kpi', title: 'Hours', from: 'r2', value: 'sum(hours) * $factor', inputs: { factor: { value: 1, label: 'Factor' } } },
    { id: 'note', card: 'page', html: '<!doctype html><title>Note</title><p>Bring the ladder.</p>' },
  ],
});

/** A session that has written all it writes: a result's picture, a page of the model's, the person's answer and a
 *  reminder; and what each left on disk while it was open. */
async function busySession(o: { tempDir?: string; dir?: string }) {
  const vindu = await startVindu({ waitMs: 300, reminders: true, verifyMs: 0, ...(o.tempDir ? { tempDir: o.tempDir } : {}) });
  const results = memoryResults(o.dir);
  const photo = results.add({ server: 'camera', tool: 'snapshot', input: { site: 'Voss' }, images: [{ data: PNG, mime: 'image/png' }] });
  results.add({ server: 'timesheet', tool: 'hours', value: [{ who: 'Kari', hours: 6 }, { who: 'Ola', hours: 4 }] });
  const shown: Shown[] = [];
  const ui = vindu.open({ results, ...(o.dir ? { dir: o.dir } : {}) }, { onView: v => shown.push(v) });
  const { mcp, json } = await mcpClient(ui.url);
  await json('show_view', VIEW(photo.id));
  assert.equal(ui.event({ type: 'action', view: 'site', name: 'set_inputs', context: { panel: 'hours', 'in:factor': '1.5' } }), true);
  for (let i = 0; i < 100 && !ui.answers().length; i++) await new Promise(r => setTimeout(r, 20));
  await json('remind', { what: 'Order the scaffolding', when: 'tomorrow at 08:30' });
  const picture = photo.images[0].file;
  const wrote = {
    picture: fs.existsSync(picture),
    records: ['ui-calls.jsonl', 'answers.jsonl', 'reminders.jsonl'].filter(f => fs.existsSync(path.join(ui.dir, f))),
    pages: fs.readdirSync(path.join(ui.dir, 'views')).filter(f => f.endsWith('.html')).length,
  };
  const close = async () => { await mcp.close(); ui.close(); await vindu.close(); };
  return { ui, picture, wrote, close };
}

test('a session without a dir writes in a temporary folder of its own under tempDir, readable by this user alone, and closing it leaves nothing', async () => {
  const parent = tmp('vindu-temp-parent-');
  const s = await busySession({ tempDir: parent });
  assert.equal(path.dirname(s.ui.dir), parent);
  assert.equal(fs.statSync(s.ui.dir).mode & 0o777, 0o700);
  assert.deepEqual(s.wrote, { picture: true, records: ['ui-calls.jsonl', 'answers.jsonl', 'reminders.jsonl'], pages: 1 });
  await s.close();
  assert.equal(fs.existsSync(s.ui.dir), false); // the folder, with its records, pages and logs
  assert.equal(fs.existsSync(s.picture), false); // and the picture of the result it read
  assert.equal(fs.existsSync(path.dirname(s.picture)), false); // in the store's own temporary folder, gone with it
  assert.deepEqual(fs.readdirSync(parent), []);
});

test('in a dir of the host\'s own, closing removes what Vindu wrote there and leaves the host\'s own file', async () => {
  const dir = tmp('vindu-host-dir-');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'The host\'s own notes.');
  const s = await busySession({ dir });
  assert.equal(s.ui.dir, dir);
  assert.equal(path.dirname(s.picture), dir);
  assert.deepEqual(s.wrote, { picture: true, records: ['ui-calls.jsonl', 'answers.jsonl', 'reminders.jsonl'], pages: 1 });
  await s.close();
  assert.deepEqual(fs.readdirSync(dir), ['notes.txt']);
  assert.equal(fs.readFileSync(path.join(dir, 'notes.txt'), 'utf8'), 'The host\'s own notes.');
});

test('a store two sessions read keeps its pictures until the last of them closes', async () => {
  const vindu = await startVindu({ waitMs: 300 });
  const results = memoryResults();
  const photo = results.add({ server: 'camera', tool: 'snapshot', images: [{ data: PNG, mime: 'image/png' }] });
  const first = vindu.open({ results }), second = vindu.open({ results });
  try {
    first.close();
    assert.equal(fs.existsSync(photo.images[0].file), true); // the second still shows it
    assert.equal(fs.existsSync(first.dir), false);
    second.close();
    assert.equal(fs.existsSync(photo.images[0].file), false);
  } finally { await vindu.close(); }
});
