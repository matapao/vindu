// Pdf panels: a PDF, an attachment or a file in the working folder, in Vindu's own pdf.js viewer; what refuses one; and
// in Chromium, through the fixtures' shell, its first page drawn in the window's sandboxed frame, "page 1 of N", pdf.js
// in its own worker, and nothing loaded from anywhere but the page host. All synthetic.
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startVindu, memoryResults, type Shown, type ShellState } from '../src/index.js';
import { chromium, mcpClient, shellServer, tinyPdf } from './helpers.js';

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const dir = tmp('pdf-task-'),
  work = tmp('pdf-work-');
const write = (file: string, body: string | Uint8Array) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return file;
};
/** A file of this many bytes that begins as a PDF does: sparse, so it takes no room. */
const large = (file: string, bytes: number) => {
  write(file, '%PDF-1.4\n');
  fs.truncateSync(file, bytes);
  return file;
};
write(path.join(work, 'docs/report.pdf'), tinyPdf(6));
write(path.join(work, 'docs/notes.txt'), 'not a PDF');
large(path.join(work, 'docs/scan.pdf'), 50_000_001);
const results = memoryResults(dir);
const brief = results.attach('brief.pdf', 'application/pdf', write(path.join(dir, 'brief.pdf'), tinyPdf(3))).id; // a1
const photo = results.attach(
  'dent.png',
  'image/png',
  write(path.join(dir, 'dent.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47])),
).id; // a2
const fake = results.attach(
  'minutes.pdf',
  'application/pdf',
  write(path.join(dir, 'minutes.pdf'), 'Minutes, typed as text.'),
).id; // a3
const huge = results.attach('archive.pdf', 'application/pdf', large(path.join(dir, 'archive.pdf'), 60_000_000)).id; // a4
const vindu = await startVindu({ waitMs: 300 });
const shown: Shown[] = [];
const st: { s?: ShellState } = {};
const ui = vindu.open(
  { results, dir, work },
  {
    onView: (v) => shown.push(v),
    onState: (s) => {
      st.s = s;
    },
  },
);
const { mcp, call, json } = await mcpClient(ui.url);
afterAll(async () => {
  await mcp.close();
  ui.close();
  await vindu.close();
});
const only = (o: Record<string, unknown>, keys: string[]) =>
  Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));

test('a pdf panel shows a PDF attachment, or a PDF in the working folder; the account says which, how big, and that the person sees it inline', async () => {
  const a = await json('show_view', { name: 'brief', title: 'Brief', panels: [{ card: 'pdf', media: brief }] });
  assert.deepEqual(only(a.panels[0], ['card', 'from', 'seen', 'file']), {
    card: 'pdf',
    from: brief,
    seen: 'the file itself',
    file: { name: 'brief.pdf', bytes: fs.statSync(path.join(dir, 'brief.pdf')).size },
  });
  assert.match(a.panels[0].shows, /inline, in its own viewer in the window: the person sees it page by page/);
  assert.equal(a.panels[0].marked, undefined); // a file is never the model's own writing
  const named = await json('show_view', {
    name: 'brief',
    title: 'Brief',
    panels: [{ card: 'pdf', media: 'Brief.pdf' }],
  }); // by its name, as media takes one
  assert.equal(named.panels[0].from, brief);
  const r = await json('show_view', {
    name: 'report',
    title: 'Report',
    panels: [{ card: 'pdf', path: 'docs/report.pdf' }],
  });
  assert.deepEqual(only(r.panels[0], ['card', 'from', 'file']), {
    card: 'pdf',
    from: 'work/docs/report.pdf',
    file: { name: 'report.pdf', bytes: fs.statSync(path.join(work, 'docs/report.pdf')).size },
  });
  const tools = (await mcp.listTools()).tools,
    show = JSON.stringify(tools.find((t) => t.name === 'show_view'));
  assert.match(show, /pdf: a PDF, shown inline in its own viewer, page by page/); // the card list the model reads
});

test('refused, each with why: over 50 MB, not a PDF, a picture, neither or both, or a list of them', async () => {
  const bad = await call('show_view', {
    name: 'bad',
    title: 'Bad',
    panels: [
      { card: 'pdf', id: 'scan', path: 'docs/scan.pdf' },
      { card: 'pdf', id: 'archive', media: huge },
      { card: 'pdf', id: 'notes', path: 'docs/notes.txt' },
      { card: 'pdf', id: 'minutes', media: fake },
      { card: 'pdf', id: 'photo', media: photo },
      { card: 'pdf', id: 'none' },
      { card: 'pdf', id: 'both', media: brief, path: 'docs/report.pdf' },
      { card: 'pdf', id: 'gone', path: 'docs/gone.pdf' },
      { card: 'pdf', id: 'result', media: 'r9' },
      { card: 'pdf', id: 'many', media: [brief, brief] },
    ],
  });
  assert.equal(bad.ok, false);
  assert.match(bad.text, /^not shown: 10 panels need changes/);
  assert.match(bad.text, /panel many: a pdf shows one PDF: "media" is one attachment id or file name, not a list/);
  assert.match(bad.text, /panel scan: scan\.pdf is 50\.0 MB; a pdf panel shows PDFs up to 50 MB/);
  assert.match(bad.text, /panel archive: archive\.pdf is 60\.0 MB; a pdf panel shows PDFs up to 50 MB/);
  assert.match(bad.text, /panel notes: notes\.txt is not a PDF: it does not begin with "%PDF-"/);
  assert.match(bad.text, /panel minutes: minutes\.pdf is not a PDF: it does not begin with "%PDF-"/);
  assert.match(
    bad.text,
    new RegExp(
      `panel photo: ${photo} is dent\\.png \\(image/png\\); a pdf panel shows PDFs; show it with a media panel \\("media": "${photo}"\\)`,
    ),
  );
  assert.match(
    bad.text,
    /panel none: a pdf panel needs "media" \(a PDF attachment, e\.g\. "a1"\) or "path" \(a PDF in the working folder/,
  );
  assert.match(
    bad.text,
    /panel both: a pdf shows "media" \(an attachment\) or "path" \(a file in the working folder\), not both/,
  );
  assert.match(bad.text, /panel gone: no file "docs\/gone\.pdf" in the working folder/);
  assert.match(bad.text, /panel result: "r9" is no attachment; .*Attachments: a1 \(brief\.pdf\)/);
  const media = await call('show_view', { name: 'm', title: 'M', panels: [{ card: 'media', media: brief }] }); // and a media panel says where a PDF goes
  assert.match(
    media.text,
    new RegExp(
      `brief\\.pdf is application/pdf; media shows images, video and audio; show it with a pdf panel \\("media": "${brief}"\\)`,
    ),
  );
});

test('in Chromium: the window draws its first page in a sandboxed frame, says "page 1 of 6", runs pdf.js in its own worker, and loads nothing from elsewhere', async () => {
  await json('show_view', {
    name: 'report',
    title: 'Report',
    panels: [{ card: 'pdf', id: 'doc', path: 'docs/report.pdf' }],
  });
  const shell = await shellServer(import.meta.dirname);
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1000, height: 760 } }),
      page = await context.newPage();
    const asked: string[] = [];
    context.on('request', (r) => asked.push(r.url()));
    const errors: string[] = [];
    page.on('pageerror', (e: Error) => errors.push(e.message));
    await page.goto(shell.url);
    await page.evaluate(() => window.app.shell('light'));
    const report = shown.findLast((v) => v.name === 'report');
    assert.ok(report, 'the report is shown');
    await page.evaluate((x: Shown) => window.app.view(x), report);
    await page.evaluate((s: ShellState) => window.app.state(s), st.s!);
    const frame = await page.waitForSelector('.vindu-pane[data-view="report"] iframe[data-page-panel="doc"]');
    assert.equal(await frame.getAttribute('sandbox'), 'allow-scripts allow-same-origin allow-forms allow-pointer-lock');
    const doc = (await frame.contentFrame())!;
    await doc.waitForSelector('body[data-ready="1"]', { timeout: 15_000 });
    assert.equal(await doc.textContent('#at'), 'page 1 of 6');
    assert.equal(await doc.evaluate(() => document.querySelectorAll('.page').length), 6);
    // the first page is drawn: its canvas holds dark pixels, the words "Page 1" in a standard font pdf.js read from /lib
    const inked = await doc.evaluate(() => {
      const c = document.querySelector('.page canvas') as HTMLCanvasElement,
        d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let dark = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 100 && d[i + 3] > 200) dark++;
      return dark;
    });
    assert.ok(inked > 100, `the first page is drawn: ${inked} dark pixels`);
    assert.ok(
      page.workers().some((w) => String(w.url()).endsWith('/lib/pdfjs-dist/build/pdf.worker.min.mjs')),
      JSON.stringify(page.workers().map((w) => w.url())),
    );
    const hostOrigin = new URL(ui.pages).origin,
      shellOrigin = new URL(shell.url).origin;
    const elsewhere = asked.filter(
      (u) => !/^(data|blob):/.test(u) && ![hostOrigin, shellOrigin].includes(new URL(u).origin),
    );
    assert.deepEqual(elsewhere, []);
    assert.ok(
      asked.some((u) => u.endsWith('/work/docs/report.pdf')),
      'the PDF came from the page host',
    );
    assert.ok(
      asked.some((u) => u === `${hostOrigin}/lib/pdfjs-dist/build/pdf.min.mjs`),
      'pdf.js came from the page host',
    );
    // the file changes in the working folder: the viewer reads it again, in place
    fs.writeFileSync(path.join(work, 'docs/report.pdf'), tinyPdf(2));
    await doc.waitForFunction(() => document.getElementById('at')?.textContent === 'page 1 of 2', null, {
      timeout: 15_000,
    });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    shell.close();
  }
});
