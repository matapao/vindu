// A Markdown file as a document, over real MCP and then drawn in Chromium: from an attachment or the working folder,
// read and parsed by the system, told in the account (the file, its sections and headings, whether it was cut), and
// drawn as elements, its HTML as text. All data is synthetic.
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startVindu, memoryResults, type Shown, type ShellState, type ViewPresentation } from '../src/index.js';
import type { Page } from 'playwright';
import { chromium, mcpClient } from './helpers.js';

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
/** The document a panel's sections are drawn in. */
const documentOf = (page: Page, panel: string) => page.locator(`.vindu-pane[data-view="notes"] [data-panel="${panel}"]`).first().locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " vb-md ")][1]');
const PLAN = `# Ferry plan

The crossing from **Bergen** to *Stavanger*, with \`fare()\` and a [timetable](https://example.com/timetable).
A [bad link](javascript:alert(1)) is its text.

## Steps

1. Book the cabin
2. Board
   - deck
   - cabin

## Code

\`\`\`ts
export const fare = (km: number) => 30 + km * 12;
\`\`\`

## Fares

| Route | Adult |
|:------|------:|
| Bergen–Stavanger | 450 |

> Check in an hour before.

<script>window.__ran = 1</script>

<img src="x" onerror="window.__ran = 2">
`;
const dir = tmp('mddoc-'), work = tmp('mddoc-work-');
fs.mkdirSync(path.join(work, 'notes'));
fs.writeFileSync(path.join(work, 'notes/plan.md'), PLAN);
fs.writeFileSync(path.join(work, 'notes/plan.txt'), 'plain text');
fs.mkdirSync(path.join(work, 'notes/site.md')); fs.writeFileSync(path.join(work, 'notes/site.md/index.html'), '<h1>A folder</h1>');
fs.writeFileSync(path.join(work, 'notes/long.md'), `# Long\n\n${'A line of the long file, for its start.\n'.repeat(16_000)}`); // over 512,000 bytes
const results = memoryResults(dir);
const md = path.join(dir, 'plan.md'); fs.writeFileSync(md, PLAN.replace('# Ferry plan', '# Ferry plan (attached)'));
const attached = results.attach('plan.md', 'text/markdown', md).id;
const png = path.join(dir, 'shot.png'); fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
const picture = results.attach('shot.png', 'image/png', png).id;
const sections = results.add({ tool: 'read_contract', server: 'synthetic', value: [{ id: '4.1', heading: 'Ends', text: 'Ramped over 12 m.' }] }).id;

const vindu = await startVindu({ waitMs: 400, timeZone: 'UTC' });
const shown: Shown[] = [], presented: ViewPresentation[] = []; let state: ShellState | undefined;
const ui = vindu.open({ results, dir, work }, { onView: v => shown.push(v), onState: s => { state = s; }, onPresentation: v => presented.push(v) });
const { mcp, json, call } = await mcpClient(ui.url);
afterAll(async () => { await mcp.close(); ui.close(); await vindu.close(); });

test('a document from a Markdown attachment: read and parsed by the system, and its account says what it shows', async () => {
  const a = await json('show_view', { name: 'attached', title: 'Attached plan', panels: [{ id: 'plan', card: 'document', from: attached }] });
  const p = a.panels[0];
  assert.equal(p.from, attached); assert.equal(p.seen, 'the file itself, read by the system');
  assert.deepEqual(p.file, { name: 'plan.md', bytes: fs.statSync(md).size });
  assert.equal(p.sections, 4); assert.equal(p.headings, 4); assert.equal(p.cut, undefined);
  assert.equal(p.marked, undefined); // the file's words, not the model's
  assert.match(p.shows, /links only to http and https; any HTML in it as text/);
  // a host's own drawing gets the sections with their blocks, and the file they are from
  const drawn = presented.filter(x => x.name === 'attached').at(-1)!.panels[0];
  assert.deepEqual(drawn.rows!.map(r => [r.heading, r.anchor, r.level]), [['Ferry plan (attached)', 'ferry-plan-attached', 1], ['Steps', 'steps', 2], ['Code', 'code', 2], ['Fares', 'fares', 2]]);
  assert.deepEqual((drawn.rows![2].__blocks as unknown[])[0], { code: 'export const fare = (km: number) => 30 + km * 12;', language: 'ts' });
  assert.deepEqual(drawn.props!.file, { name: 'plan.md', cut: false });
});

test('a document from a Markdown file in the working folder, and a long one, of which only its start is shown', async () => {
  const a = await json('show_view', { name: 'notes', title: 'Notes', panels: [{ id: 'plan', card: 'document', path: 'notes/plan.md' }, { id: 'long', card: 'document', path: 'notes/long.md' }] });
  const [plan, long] = a.panels;
  assert.equal(plan.from, 'work/notes/plan.md'); assert.deepEqual(plan.file, { name: 'plan.md', bytes: Buffer.byteLength(PLAN) });
  assert.deepEqual([plan.sections, plan.headings, plan.cut, plan.marked], [4, 4, undefined, undefined]);
  assert.equal(long.from, 'work/notes/long.md'); assert.equal(long.file.bytes, fs.statSync(path.join(work, 'notes/long.md')).size);
  assert.match(long.cut, /^Only its start is shown: the first \d+ of its \d+ bytes$/);
  assert.ok(Number(/first (\d+)/.exec(long.cut)![1]) <= 512_000);
  assert.equal(a.typed_numbers_not_in_any_result, undefined);
});

test('a file a document does not show is refused, with why and what to send instead; a document of sections is as it was', async () => {
  const bad = (await call('show_view', { name: 'bad', title: 'Bad', panels: [
    { id: 'png', card: 'document', from: picture },
    { id: 'txt', card: 'document', path: 'notes/plan.txt' },
    { id: 'none', card: 'document', path: 'notes/missing.md' },
    { id: 'both', card: 'document', from: attached, path: 'notes/plan.md' },
    { id: 'before', card: 'document', path: 'notes/plan.md', before: sections },
    { id: 'outside', card: 'document', path: '../plan.md' },
    { id: 'folder', card: 'document', path: 'notes/site.md' },
  ] })).text;
  assert.match(bad, /^not shown: 7 panels need changes/);
  assert.match(bad, new RegExp(`panel png: ${picture} is shot.png \\(image/png\\); a document shows Markdown files \\(.md or .markdown, or an attachment of type text/markdown\\) or Word documents \\(.docx\\); show it with a media panel \\("media": "${picture}"\\)`));
  assert.match(bad, /panel txt: "notes\/plan.txt" is not a file a document shows: it shows Markdown files .*; show another file with a code panel/);
  assert.match(bad, /panel none: no file "notes\/missing.md" in the working folder/);
  assert.match(bad, /panel both: a document shows "from" \(an attachment\) or "path" \(a file in the working folder\), not both/);
  assert.match(bad, /panel before: before compares sections with an earlier result's; a Markdown file is shown as it is/);
  assert.match(bad, /panel outside: no file "\.\.\/plan.md" in the working folder/);
  assert.match(bad, /panel folder: "notes\/site.md" is a folder, and document panels show files: Markdown files/);
  const a = await json('show_view', { name: 'contract', title: 'Contract', panels: [{ id: 'clauses', card: 'document', from: sections }] });
  assert.deepEqual([a.panels[0].sections, a.panels[0].seen, a.panels[0].file], [1, 'reported', undefined]);
});

test('drawn in Chromium: headings, a list, code, a table and links as elements, a table of contents where there is room, and the HTML as text that never runs', async () => {
  const app = http.createServer((req, res) => {
    const f = req.url === '/app.bundle.js' ? path.join(import.meta.dirname, 'fixtures', 'app.bundle.js') : path.join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'shell.html');
    res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }).end(fs.readFileSync(f));
  });
  await new Promise<void>(r => app.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    const errors: string[] = []; page.on('pageerror', (e: Error) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${(app.address() as { port: number }).port}/shell.html`);
    await page.evaluate(() => window.app.shell('light'));
    await page.evaluate((x: Shown) => window.app.view(x), shown.filter(v => v.name === 'notes').at(-1)!);
    await page.evaluate((s: ShellState) => window.app.state({ ...s, tree: { view: 'notes', size: 1 }, maximized: null }), state!);
    await page.waitForTimeout(900);
    const doc = documentOf(page, 'plan');
    assert.deepEqual(await doc.locator('.vb-mdbody [role="heading"]').allInnerTexts(), ['Ferry plan', 'Steps', 'Code', 'Fares']);
    assert.deepEqual(await doc.locator('.vb-mdbody [role="heading"]').evaluateAll((hs: HTMLElement[]) => hs.map(h => [h.getAttribute('aria-level'), h.dataset.anchor])), [['1', 'ferry-plan'], ['2', 'steps'], ['2', 'code'], ['2', 'fares']]);
    assert.equal(await doc.locator('[data-panel="plan"][data-row]').count(), 4); // each section, to point at
    assert.deepEqual(await doc.locator('.vb-mdbody ol > li').evaluateAll((lis: Element[]) => lis.map(li => li.firstElementChild?.textContent)), ['Book the cabin', 'Board']);
    assert.deepEqual(await doc.locator('.vb-mdbody ol ul > li').allInnerTexts(), ['deck', 'cabin']);
    assert.equal(await doc.locator('pre[data-language="ts"] code').innerText(), 'export const fare = (km: number) => 30 + km * 12;');
    assert.deepEqual(await doc.locator('table th').allInnerTexts(), ['Route', 'Adult']);
    assert.deepEqual(await doc.locator('table td').allInnerTexts(), ['Bergen–Stavanger', '450']);
    assert.equal(await doc.locator('td.vb-right').innerText(), '450');
    assert.deepEqual([await doc.locator('strong').first().innerText(), await doc.locator('em').first().innerText(), await doc.locator('p code').first().innerText()], ['Bergen', 'Stavanger', 'fare()']);
    assert.deepEqual(await doc.locator('a').evaluateAll((as: Element[]) => as.map(a => [a.getAttribute('href'), a.getAttribute('target'), a.getAttribute('rel'), a.textContent])), [['https://example.com/timetable', '_blank', 'noopener noreferrer', 'timetable']]);
    assert.match(await doc.locator('.vb-mdbody').innerText(), /A bad link is its text\./);
    assert.equal(await doc.locator('blockquote').innerText(), 'Check in an hour before.');
    // the file's HTML is its text: shown, never an element, never run
    const text = await doc.locator('.vb-mdbody').innerText();
    assert.ok(text.includes('<script>window.__ran = 1</script>'), text); assert.ok(text.includes('<img src="x" onerror="window.__ran = 2">'));
    assert.deepEqual(await doc.evaluate((d: Element) => [d.querySelectorAll('script, img, iframe, [onerror]').length, window.__ran]), [0, undefined]);
    // a table of contents beside it, and a click on an entry brings its section into view
    assert.equal(await doc.locator('.vb-toc').isVisible(), true);
    assert.deepEqual(await doc.locator('.vb-toc button').allInnerTexts(), ['Ferry plan', 'Steps', 'Code', 'Fares']);
    const fares = doc.locator('[data-anchor="fares"]'), before = (await fares.boundingBox())!;
    await doc.locator('.vb-toc button', { hasText: 'Fares' }).click();
    await page.waitForTimeout(800);
    const box = (await fares.boundingBox())!, pane = (await page.locator('.vindu-pane[data-view="notes"] .vindu-pane-body').boundingBox())!;
    assert.ok(box.y < before.y && box.y >= pane.y - 1 && box.y < pane.y + 60, JSON.stringify({ before, box, pane }));
    // the long file: only its start, and it says so
    const long = documentOf(page, 'long');
    assert.equal(await long.locator('.vb-mdcut').innerText(), 'Only its start is shown.');
    assert.equal(await long.locator('.vb-toc').isVisible(), false); // one heading: no contents
    // a narrow pane has no room for the contents
    await page.setViewportSize({ width: 560, height: 1000 }); await page.waitForTimeout(500);
    assert.equal(await doc.locator('.vb-toc').isVisible(), false);
    assert.equal(await doc.locator('.vb-mdbody [role="heading"]').count(), 4);
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => document.body.innerText.includes('which this window has not registered')), false);
  } finally { await browser.close(); app.close(); }
});
