// A Word document (.docx) shown in a document card, read by the system from an attachment and from the working folder:
// its headings by their styles, bold and italic, a nested list, a table, links, a tracked insertion and deletion, a
// picture, a field, a comment and hidden text; told in the account, and drawn in Chromium. All data is synthetic.
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startVindu, memoryResults, type Shown, type ShellState, type ViewPresentation } from '../src/index.js';
import { chromium, mcpClient, shellServer } from './helpers.js';
import { paragraphStyle, wordDocument } from './office-fixtures.js';

const STYLES = paragraphStyle('Heading1', 'heading 1') + paragraphStyle('Heading2', 'heading 2') + paragraphStyle('ListParagraph', 'List Paragraph')
  + paragraphStyle('Overskrift3', 'Min overskrift', '<w:basedOn w:val="Heading2"/>') // a style of its own, based on Heading 2
  + '<w:style w:type="character" w:styleId="Strong"><w:name w:val="Strong"/><w:rPr><w:b/></w:rPr></w:style>';
const NUMBERING = '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>'
  + '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>'
  + '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>';
const run = (text: string, props = '') => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const p = (inner: string, props = '') => `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${inner}</w:p>`;
const styled = (style: string, inner: string) => p(inner, `<w:pStyle w:val="${style}"/>`);
const item = (list: number, level: number, text: string) => p(run(text), `<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${list}"/></w:numPr>`);
const cell = (text: string, props = '') => `<w:tc>${props ? `<w:tcPr>${props}</w:tcPr>` : ''}${p(run(text))}</w:tc>`;
const BODY = [
  styled('Heading1', run('Prosjektplan for Ålesund')),
  p(`${run('Vanlig tekst med ')}${run('fet', '<w:b/>')}${run(', ')}${run('kursiv', '<w:i/>')}${run(' og ')}${run('begge', '<w:b/><w:i/>')}${run(' og ')}${run('sterk', '<w:rStyle w:val="Strong"/>')}${run('.')}`),
  p(`${run('Les ')}<w:hyperlink r:id="rIdWeb">${run('planen')}</w:hyperlink>${run(', ')}<w:hyperlink r:id="rIdMail">${run('skriv til oss')}</w:hyperlink>${run(' eller ')}<w:hyperlink r:id="rIdBad">${run('ikke dette')}</w:hyperlink>${run('.')}`),
  p(`${run('Endret: ')}<w:ins w:id="1" w:author="A"><w:r><w:t>lagt til</w:t></w:r></w:ins><w:del w:id="2" w:author="A"><w:r><w:delText>tatt bort</w:delText></w:r></w:del>${run(' slutt.')}`),
  p(`${run('Linje en')}<w:r><w:br/></w:r>${run('Linje to')}<w:r><w:br w:type="page"/></w:r>`),
  p(''), // an empty paragraph: space, and not drawn
  styled('Heading2', run('Steg')),
  item(1, 0, 'Første steg'), item(1, 1, 'Detalj a'), item(1, 1, 'Detalj b'), item(1, 0, 'Andre steg'),
  item(2, 0, 'Epler'), item(2, 0, 'Pærer'),
  `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol/><w:gridCol/></w:tblGrid><w:tr>${cell('Rute')}${cell('Pris')}</w:tr><w:tr>${cell('Bergen–Stavanger')}${cell('450')}</w:tr><w:tr>${cell('Pris på forespørsel', '<w:gridSpan w:val="2"/>')}</w:tr></w:tbl>`,
  p(`<w:r><w:drawing><wp:inline><wp:docPr id="1" name="Picture 1" descr="Kart over ruten"/></wp:inline></w:drawing></w:r>${run(' Se kartet.')}`),
  // a picture as Word writes it in two ways, a drawing and a picture for older readers: one picture
  p(`${run('Logo: ')}<w:r><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="wps"><w:drawing><wp:anchor><wp:docPr id="2" name="Shape 2"/></wp:anchor></w:drawing></mc:Choice><mc:Fallback><w:pict/></mc:Fallback></mc:AlternateContent></w:r>`),
  p(`${run('Side ')}<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${run('3')}<w:r><w:fldChar w:fldCharType="end"/></w:r>`),
  p(`<w:commentRangeStart w:id="0"/>${run('Kommentert tekst')}<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r>${run(' skjult', '<w:vanish/>')}`),
  styled('Overskrift3', run('Vedlegg')),
  p(run('Siste avsnitt.')),
].join('');
const DOCX = wordDocument(BODY, { styles: STYLES, numbering: NUMBERING,
  links: { rIdWeb: 'https://example.com/plan?a=1&b=2', rIdMail: 'mailto:post@example.com', rIdBad: 'javascript:alert(1)' },
  more: { 'word/comments.xml': '<?xml version="1.0"?><w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:id="0"><w:p><w:r><w:t>Never shown</w:t></w:r></w:p></w:comment></w:comments>' } });

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const dir = tmp('word-'), work = tmp('word-work-');
fs.writeFileSync(path.join(work, 'plan.docx'), DOCX);
fs.writeFileSync(path.join(dir, 'plan.docx'), DOCX);
const results = memoryResults(dir);
const attached = results.attach('plan.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', path.join(dir, 'plan.docx')).id;
const vindu = await startVindu({ waitMs: 300, timeZone: 'UTC' });
const shown: Shown[] = [], presented: ViewPresentation[] = []; let state: ShellState | undefined;
const ui = vindu.open({ results, dir, work }, { onView: v => shown.push(v), onState: s => { state = s; }, onPresentation: v => presented.push(v) });
const { mcp, json, call } = await mcpClient(ui.url);
afterAll(async () => { await mcp.close(); ui.close(); await vindu.close(); });

test('a Word document is read by the system into a document\'s sections, and its account says what it held and what is left out', async () => {
  for (const source of [{ from: attached }, { path: 'plan.docx' }]) {
    const a = await json('show_view', { name: 'plan', title: 'Plan', panels: [{ id: 'plan', card: 'document', ...source }] });
    const at = JSON.stringify(source), o = a.panels[0];
    assert.equal(o.from, source.from ?? 'work/plan.docx', at); assert.equal(o.seen, 'the file itself, read by the system', at);
    assert.deepEqual(o.file, { name: 'plan.docx', bytes: DOCX.length }, at);
    assert.deepEqual([o.sections, o.headings, o.paragraphs, o.lists, o.tables, o.links], [3, 3, 15, 2, 1, 2], at);
    assert.equal(o.pictures, '2, each drawn as [picture] where it is; none is read');
    assert.equal(o.tracked_insertions, '1, drawn as text');
    assert.equal(o.left_out, '1 comment; 1 tracked deletion; the codes of 1 field (what each shows is drawn)');
    assert.match(o.shows, /^the Word document as a document, read and drawn by the system: headings by its Heading 1 to 6 styles/);
    assert.equal(o.marked, undefined);
  }
  const plan = presented.filter(x => x.name === 'plan').at(-1)!.panels[0], rows = plan.rows!;
  assert.deepEqual(rows.map(r => [r.heading, r.level, r.anchor]), [['Prosjektplan for Ålesund', 1, 'prosjektplan-for-ålesund'], ['Steg', 2, 'steg'], ['Vedlegg', 2, 'vedlegg']]);
  assert.equal(plan.summary.line, 'Prosjektplan for Ålesund'); // its card says its first heading
  const [intro, steps] = rows.map(r => r.__blocks as unknown[]);
  assert.deepEqual(intro[0], { paragraph: ['Vanlig tekst med ', { strong: ['fet'] }, ', ', { em: ['kursiv'] }, ' og ', { strong: [{ em: ['begge'] }] }, ' og ', { strong: ['sterk'] }, '.'] });
  assert.deepEqual(intro[1], { paragraph: ['Les ', { link: 'https://example.com/plan?a=1&b=2', text: ['planen'] }, ', ', { link: 'mailto:post@example.com', text: ['skriv til oss'] }, ' eller ikke dette.'] });
  assert.deepEqual(intro[2], { paragraph: ['Endret: lagt til slutt.'] }); // the insertion as text, the deletion left out
  assert.deepEqual(intro[3], { paragraph: ['Linje en', { br: true }, 'Linje to'] });
  assert.deepEqual(steps[0], { list: [
    { blocks: [{ paragraph: ['Første steg'] }, { list: [{ blocks: [{ paragraph: ['Detalj a'] }] }, { blocks: [{ paragraph: ['Detalj b'] }] }] }] },
    { blocks: [{ paragraph: ['Andre steg'] }] }], ordered: true });
  assert.deepEqual(steps[1], { list: [{ blocks: [{ paragraph: ['Epler'] }] }, { blocks: [{ paragraph: ['Pærer'] }] }] });
  assert.deepEqual(steps[2], { table: { align: [null, null], head: [['Rute'], ['Pris']], rows: [[['Bergen–Stavanger'], ['450']], [['Pris på forespørsel'], []]] } });
  assert.deepEqual(steps.slice(3), [{ paragraph: ['[picture: Kart over ruten] Se kartet.'] }, { paragraph: ['Logo: [picture]'] }, { paragraph: ['Side 3'] }, { paragraph: ['Kommentert tekst'] }]);
});

test('a Word document a document does not read is refused, saying why', async () => {
  fs.writeFileSync(path.join(work, 'makro.docm'), wordDocument(p(run('x'))));
  fs.writeFileSync(path.join(work, 'vba.docx'), wordDocument(p(run('x')), { more: { 'word/vbaProject.bin': new Uint8Array([1, 2, 3]) } }));
  fs.writeFileSync(path.join(work, 'tom.docx'), wordDocument(p('')));
  fs.writeFileSync(path.join(work, 'ikke.docx'), 'just text, not a zip archive');
  const bad = (await call('show_view', { name: 'bad', title: 'Bad', panels: [
    { id: 'docm', card: 'document', path: 'makro.docm' }, { id: 'vba', card: 'document', path: 'vba.docx' }, { id: 'empty', card: 'document', path: 'tom.docx' },
    { id: 'zip', card: 'document', path: 'ikke.docx' }, { id: 'missing', card: 'document', path: 'borte.docx' }, { id: 'before', card: 'document', path: 'plan.docx', before: 'r1' },
  ] })).text;
  assert.match(bad, /panel docm: "makro.docm" is a Word document with macros \(\.docm\); the system reads documents without them: \.docx/);
  assert.match(bad, /panel vba: "vba.docx" holds macros \(its part word\/vbaProject.bin\); the system reads workbooks and documents without them: \.xlsx and \.docx/);
  assert.match(bad, /panel empty: tom.docx has no text, so there is nothing to show/);
  assert.match(bad, /panel zip: "ikke.docx" is damaged, or not a zip archive as \.xlsx and \.docx files are: it has no central directory/);
  assert.match(bad, /panel missing: no file "borte.docx" in the working folder/);
  assert.match(bad, /panel before: before compares sections with an earlier result's; a Word document is shown as it is, without it/);
});

test('drawn in Chromium: headings, bold and italic, the nested list, the table and the links as elements; what is left out is nowhere', async () => {
  await json('show_view', { name: 'plan', title: 'Plan', panels: [{ id: 'plan', card: 'document', path: 'plan.docx' }] });
  const shell = await shellServer(import.meta.dirname), browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    const errors: string[] = []; page.on('pageerror', (e: Error) => errors.push(e.message));
    await page.goto(shell.url);
    await page.evaluate(() => window.app.shell('light'));
    await page.evaluate((x: Shown) => window.app.view(x), shown.filter(v => v.name === 'plan').at(-1)!);
    await page.evaluate((s: ShellState) => window.app.state({ ...s, tree: { view: 'plan', size: 1 }, maximized: null }), state!);
    const doc = page.locator('.vb-md').first();
    await doc.locator('.vb-mdbody [role="heading"]').first().waitFor();
    assert.deepEqual(await doc.locator('.vb-mdbody [role="heading"]').allInnerTexts(), ['Prosjektplan for Ålesund', 'Steg', 'Vedlegg']);
    assert.deepEqual(await doc.locator('.vb-mdbody [role="heading"]').evaluateAll((hs: Element[]) => hs.map(h => h.getAttribute('aria-level'))), ['1', '2', '2']);
    assert.equal(await doc.locator('.vb-mdfile').innerText(), 'plan.docx');
    assert.deepEqual(await doc.locator('.vb-mdbody p strong').allInnerTexts(), ['fet', 'begge', 'sterk']);
    assert.deepEqual(await doc.locator('.vb-mdbody p em').allInnerTexts(), ['kursiv', 'begge']);
    assert.deepEqual(await doc.locator('.vb-mdbody ol > li').evaluateAll((lis: Element[]) => lis.map(li => li.firstElementChild?.textContent)), ['Første steg', 'Andre steg']);
    assert.deepEqual(await doc.locator('.vb-mdbody ol > li > ul > li').allInnerTexts(), ['Detalj a', 'Detalj b']);
    assert.deepEqual(await doc.locator('.vb-mdbody > .vb-mdsec > ul > li').allInnerTexts(), ['Epler', 'Pærer']);
    assert.deepEqual(await doc.locator('table th').allInnerTexts(), ['Rute', 'Pris']);
    assert.deepEqual(await doc.locator('table td').allInnerTexts(), ['Bergen–Stavanger', '450', 'Pris på forespørsel', '']);
    assert.deepEqual(await doc.locator('a').evaluateAll((as: Element[]) => as.map(a => [a.getAttribute('href'), a.getAttribute('rel'), a.textContent])),
      [['https://example.com/plan?a=1&b=2', 'noopener noreferrer', 'planen'], ['mailto:post@example.com', 'noopener noreferrer', 'skriv til oss']]);
    const text = await doc.locator('.vb-mdbody').innerText();
    for (const shown of ['lagt til', 'Linje en\nLinje to', '[picture: Kart over ruten] Se kartet.', 'Side 3', 'ikke dette']) assert.ok(text.includes(shown), shown);
    for (const left of ['tatt bort', 'PAGE', 'Never shown', 'skjult']) assert.ok(!text.includes(left), left);
    assert.equal(await doc.evaluate((d: Element) => d.querySelectorAll('img, script, iframe').length), 0); // the picture is never drawn
    assert.deepEqual(errors, []);
  } finally { await browser.close(); shell.close(); }
});
