// Markdown read into a document's structure by the system: sections from headings, blocks in each, text marked up
// inline, and never markup made of the input. No server and no browser involved.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseMarkdown, type MarkdownBlock } from '../src/markdown.js';
import { parseInline, webAddress } from '../src/markdown-inline.js';
import { MARKDOWN_MOST } from '../src/markdown-document.js';
import { readTextStart } from '../src/text-start.js';

/** The blocks of a text with no headings: the one section it is. */
const body = (md: string): MarkdownBlock[] => { const doc = parseMarkdown(md); assert.equal(doc.sections.length, 1); return doc.sections[0].blocks; };

test('headings become sections, each with its level, its text and an anchor; what comes before the first is a section of its own', () => {
  const doc = parseMarkdown('Before.\n\n# Ferry *plan* #\n\nIntro.\n\n## Fares\n\n## Fares\n\nSecond.\n\nRoutes\n------\n\n#hashtag is text\n\n###### Six');
  assert.deepEqual(doc.sections.map(s => [s.level, s.heading, s.anchor]), [[0, undefined, undefined], [1, 'Ferry plan', 'ferry-plan'], [2, 'Fares', 'fares'], [2, 'Fares', 'fares-1'], [2, 'Routes', 'routes'], [6, 'Six', 'six']]);
  assert.deepEqual(doc.sections[1].title, ['Ferry ', { em: ['plan'] }]); // the heading's own marks, for the window
  assert.deepEqual(doc.sections[4].blocks, [{ paragraph: ['#hashtag is text'] }]);
  assert.equal(doc.headings, 5); assert.equal(doc.cut, false);
});

test('paragraphs: lines joined, a hard break where two spaces or a backslash end a line, a rule between them', () => {
  assert.deepEqual(body('One line\n  and the next.\n\nA hard  \nbreak, and\\\nanother.\n\n***\n\n- - -'), [
    { paragraph: ['One line\nand the next.'] },
    { paragraph: ['A hard', { br: true }, 'break, and', { br: true }, 'another.'] },
    { rule: true }, { rule: true },
  ]);
});

test('lists: ordered from their first number, unordered, nested a level and more, with tasks checked or not', () => {
  assert.deepEqual(body('3. Board\n4. Sail\n   - deck\n   - cabin\n     1. bunk\n\n- [x] tickets\n- [ ] food\n* a third marker, the same list'), [
    { list: [
      { blocks: [{ paragraph: ['Board'] }] },
      { blocks: [{ paragraph: ['Sail'] }, { list: [{ blocks: [{ paragraph: ['deck'] }] }, { blocks: [{ paragraph: ['cabin'] }, { list: [{ blocks: [{ paragraph: ['bunk'] }] }], ordered: true }] }] }] },
    ], ordered: true, start: 3 },
    { list: [{ blocks: [{ paragraph: ['tickets'] }], checked: true }, { blocks: [{ paragraph: ['food'] }], checked: false }, { blocks: [{ paragraph: ['a third marker, the same list'] }] }] },
  ]);
  assert.deepEqual(body('- one\nlazy line\n- two'), [{ list: [{ blocks: [{ paragraph: ['one\nlazy line'] }] }, { blocks: [{ paragraph: ['two'] }] }] }]);
  assert.deepEqual(body('Text\n2. not a list here'), [{ paragraph: ['Text\n2. not a list here'] }]); // only 1. starts a list inside a paragraph
});

test('quotes: what they hold is read as blocks, nested and with lazy lines; too deep a nesting is text', () => {
  assert.deepEqual(body('> Said:\nlazy\n>\n> > inner\n> - item'), [{ quote: [{ paragraph: ['Said:\nlazy'] }, { quote: [{ paragraph: ['inner'] }] }, { list: [{ blocks: [{ paragraph: ['item'] }] }] }] }]);
  const deep = JSON.stringify(body('> > > > > > deep'));
  assert.match(deep, /"paragraph":\["> > deep"\]/); // four quotes in, the rest is what it says
});

test('code: fenced with its language (backticks or tildes, never closed runs to the end), or indented; never read as Markdown', () => {
  assert.deepEqual(body('```ts title="x"\nconst a = 1 < 2; // **not bold**\n\n<b>tag</b>\n```\n\n~~~\n~~~~\n\n    indented\n      more\n\n````python\nunclosed'), [
    { code: 'const a = 1 < 2; // **not bold**\n\n<b>tag</b>', language: 'ts' },
    { code: '', language: '' },
    { code: 'indented\n  more', language: '' },
    { code: 'unclosed', language: 'python' },
  ]);
  assert.deepEqual(body('```{.weird}\nx\n```'), [{ code: 'x', language: '' }]); // a language that is not a plain name is left out
});

test('tables: a head, its alignment, rows as long as the head, an escaped pipe; a table may follow a line of text', () => {
  assert.deepEqual(body('Fares:\n| Route | Adult | Child |\n|:------|------:|:-----:|\n| Bergen–Stavanger | 450 | **225** |\n| a \\| b | 1 |\n| x | 1 | 2 | 3 |\n\nAfter.'), [
    { paragraph: ['Fares:'] },
    { table: { align: ['left', 'right', 'center'], head: [['Route'], ['Adult'], ['Child']], rows: [
      [['Bergen–Stavanger'], ['450'], [{ strong: ['225'] }]],
      [['a | b'], ['1'], []],
      [['x'], ['1'], ['2']],
    ] } },
    { paragraph: ['After.'] },
  ]);
  assert.deepEqual(parseMarkdown('a | b\n---').sections.map(s => s.heading), ['a | b']); // a heading, not a table: its delimiter row has no pipe
});

test('emphasis, strong, both, struck through and inline code; an underscore inside a word is a letter', () => {
  assert.deepEqual(parseInline('*a* **b** ***c*** _d_ __e__ ~~f~~ `g` snake_case_name'), [
    { em: ['a'] }, ' ', { strong: ['b'] }, ' ', { em: [{ strong: ['c'] }] }, ' ', { em: ['d'] }, ' ', { strong: ['e'] }, ' ', { del: ['f'] }, ' ', { code: 'g' }, ' snake_case_name',
  ]);
  assert.deepEqual(parseInline('*a **b** c* and **a *b* c**'), [{ em: ['a ', { strong: ['b'] }, ' c'] }, ' and ', { strong: ['a ', { em: ['b'] }, ' c'] }]);
  assert.deepEqual(parseInline('`` a`b `` `C:\\Users\\` `*not em*` \\*escaped\\* 2 * 3 * 4 ** x'), [
    { code: 'a`b' }, ' ', { code: 'C:\\Users\\' }, ' ', { code: '*not em*' }, ' *escaped* 2 * 3 * 4 ** x',
  ]);
});

test('links: only http and https are links; javascript:, data:, mailto: and paths are their text alone; an image is its description', () => {
  assert.deepEqual(parseInline('[site](https://example.com/a?b=1 "Title") [x](javascript:alert(1)) [y](JAVASCRIPT:alert(1)) [z](data:text/html,<script>alert(1)</script>) [m](mailto:a@example.com) [p](./plan.md)'), [
    { link: 'https://example.com/a?b=1', text: ['site'] }, ' x y z m p',
  ]);
  assert.deepEqual(parseInline('![chart](https://example.com/c.png) [![badge](https://example.com/b.svg)](http://example.com) <https://example.com/x> see https://example.com/y. or (https://example.com/z)'), [
    'chart ', { link: 'http://example.com/', text: ['badge'] }, ' ', { link: 'https://example.com/x', text: ['https://example.com/x'] },
    ' see ', { link: 'https://example.com/y', text: ['https://example.com/y'] }, '. or (', { link: 'https://example.com/z', text: ['https://example.com/z'] }, ')',
  ]);
  assert.deepEqual(parseInline('[a [b](https://example.com/in) c](https://example.com/out)'), [{ link: 'https://example.com/out', text: ['a b c'] }]); // no link inside a link
  for (const bad of ['javascript:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'vbscript:x', 'file:///etc/passwd', '//example.com', '/plan.md']) assert.equal(webAddress(bad), null, bad);
  assert.equal(webAddress('HTTPS://Example.com/a b'), 'https://example.com/a%20b');
});

test('raw HTML is text, never parsed or run: blocks of it, tags inside a paragraph, comments; entities are read as the characters they name', () => {
  const doc = parseMarkdown('<script>alert(1)</script>\n\n<div onclick="x()">\n*hi*\n</div>\n\nA <img src=x onerror=alert(1)> and <!-- note --> &lt;b&gt; &amp; &#169; &#x2014; &bogus;');
  assert.deepEqual(doc.sections[0].blocks, [
    { paragraph: ['<script>alert(1)</script>'] },
    { paragraph: ['<div onclick="x()">\n', { em: ['hi'] }, '\n</div>'] },
    { paragraph: ['A <img src=x onerror=alert(1)> and <!-- note --> <b> & © — &bogus;'] },
  ]);
});

test('CRLF and CR line ends, a byte order mark, a NUL, and front matter read as what they are', () => {
  const lf = parseMarkdown('# Plan\n\n- a\n- b\n\n```js\nx\n```\n');
  assert.deepEqual(parseMarkdown('\ufeff# Plan\r\n\r\n- a\r\n- b\r\n\r\n```js\r\nx\r\n```\r\n'), lf);
  assert.deepEqual(parseMarkdown('# Plan\r\r- a\r- b\r\r```js\rx\r```\r'), lf);
  assert.deepEqual(body('a\0b'), [{ paragraph: ['a\ufffdb'] }]);
  assert.deepEqual(parseMarkdown('---\ntitle: Plan\ntags: [a]\n---\n# Plan').sections.map(s => s.blocks[0] ?? s.heading), [{ code: 'title: Plan\ntags: [a]', language: 'yaml' }, 'Plan']);
  assert.deepEqual(parseMarkdown('---\nNot front matter\n---').sections.map(s => [s.heading, s.blocks]), [[undefined, [{ rule: true }]], ['Not front matter', []]]);
  assert.deepEqual(body('> # In a quote'), [{ quote: [{ heading: ['In a quote'], level: 1 }] }]); // a heading inside a quote is no section
});

test('a long document: deeper headings go into their section to keep to 100 sections, then it is cut, and the values the window is given are bounded', () => {
  const md = Array.from({ length: 80 }, (_, i) => `## Part ${i}\n\nText.\n\n### Detail ${i}\n\nMore.`).join('\n\n');
  const folded = parseMarkdown(md);
  assert.equal(folded.sections.length, 80); assert.equal(folded.headings, 160); assert.equal(folded.cut, false);
  assert.deepEqual(folded.sections[3].blocks, [{ paragraph: ['Text.'] }, { heading: ['Detail 3'], level: 3, anchor: 'detail-3' }, { paragraph: ['More.'] }]);
  const many = parseMarkdown(Array.from({ length: 150 }, (_, i) => `# H${i}`).join('\n'));
  assert.equal(many.sections.length, 100); assert.equal(many.cut, true);
  const wide = parseMarkdown(`# Table\n\n| a | b |\n|---|---|\n${'| 1 | 2 |\n'.repeat(9000)}`, { values: 20_000 });
  const rows = (wide.sections[0].blocks[0] as { table: { rows: unknown[] } }).table.rows.length;
  assert.equal(wide.cut, true); assert.ok(rows > 1000 && rows < 4000, `${rows} rows kept`);
});

test('text full of marks that close nowhere, brackets and long lines still reads quickly', () => {
  const t = Date.now();
  for (const s of ['*a '.repeat(150_000), '[]('.repeat(150_000), '[a]('.repeat(100_000) + ')'.repeat(100_000), '`a '.repeat(150_000), '!['.repeat(150_000), '_a_b '.repeat(100_000), 'a  \n'.repeat(120_000)]) parseInline(s);
  parseMarkdown('> '.repeat(5000) + 'x\n' + '- '.repeat(5000) + 'y\n' + 'line\n'.repeat(100_000));
  assert.ok(Date.now() - t < 8000, `${Date.now() - t} ms`);
});

test('the start of a file: at most 512,000 bytes, cut after its last whole line, never inside a character; text only', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-start-'));
  const file = path.join(dir, 'long.md'); fs.writeFileSync(file, `${'# Line of text, for the start\n'.repeat(20_000)}`); // 600,000 bytes
  const start = readTextStart(file, MARKDOWN_MOST)!;
  assert.equal(MARKDOWN_MOST, 512_000); assert.equal(start.size, 600_000);
  assert.ok(start.bytes <= 512_000 && start.bytes > 511_900 && start.text.endsWith('start\n'), String(start.bytes));
  const wide = path.join(dir, 'one-line.md'); fs.writeFileSync(wide, 'æ'.repeat(300_000)); // 600,000 bytes, no line end
  const one = readTextStart(wide, MARKDOWN_MOST)!;
  assert.equal(one.bytes, 512_000); assert.equal(one.text, 'æ'.repeat(256_000));
  const odd = readTextStart(wide, 511_999)!; assert.equal(odd.bytes, 511_998); // not half of an æ
  const bom = path.join(dir, 'bom.md'); fs.writeFileSync(bom, '\ufeff# Plan\n');
  assert.deepEqual(readTextStart(bom, MARKDOWN_MOST), { text: '# Plan\n', bytes: 10, size: 10 });
  const bin = path.join(dir, 'bin.md'); fs.writeFileSync(bin, Buffer.from([0x23, 0x00, 0x01]));
  assert.equal(readTextStart(bin, MARKDOWN_MOST), null);
});
