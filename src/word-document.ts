// A Word document (.docx) as a document block's rows: one row per section, as a Markdown file's are
// (markdown-document.ts), read by the system from the file (zip-read.ts, docx-read.ts) and drawn as a Markdown file's
// blocks are. Its account says what it held and what of it is left out. A document with macros (.docm) is refused.
import type { CardFile, CardFileRows, PanelSpec } from './cards.js';
import { readWordDocument, type WordCounts } from './docx-read.js';
import { documentOf } from './markdown.js';
import { MARKDOWN_FILE, MOST_SECTIONS, documentRows } from './markdown-document.js';
import { withZipFile } from './zip-read.js';

const WORD_NAME = /\.(docx|docm)$/i;
const WORD_TYPE = /^application\/vnd\.(openxmlformats-officedocument\.wordprocessingml\.document|ms-word\.document\.macroenabled\.12)\s*(;|$)/i;
/** Whether a file is a Word document, by its name or an attachment's type (one with macros too, which is refused). */
const isWord = (name: string, mime?: string) => WORD_NAME.test(name) || WORD_TYPE.test(mime ?? '');

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** What the account says of a Word document besides its sections and headings: what it held, and what is left out. */
function wordAccount(c: WordCounts): Record<string, unknown> {
  const left = [c.comments ? plural(c.comments, 'comment') : '', c.deletions ? plural(c.deletions, 'tracked deletion') : '',
    c.fields ? `the codes of ${plural(c.fields, 'field')} (what each shows is drawn)` : ''].filter(Boolean);
  return {
    paragraphs: c.paragraphs, ...(c.lists ? { lists: c.lists } : {}), ...(c.tables ? { tables: c.tables } : {}), ...(c.links ? { links: c.links } : {}),
    ...(c.pictures ? { pictures: `${c.pictures}, each drawn as [picture] where it is; none is read` } : {}),
    ...(c.insertions ? { tracked_insertions: `${c.insertions}, drawn as text` } : {}),
    ...(left.length ? { left_out: left.join('; ') } : {}),
    shows: 'the Word document as a document, read and drawn by the system: headings by its Heading 1 to 6 styles, paragraphs, bold and italic, lists, tables and line breaks; links only to http, https and mailto addresses',
  };
}

/** A Word document's sections as rows. */
function wordRows(file: string, name: string, panel: PanelSpec): CardFileRows {
  if (panel.before) throw new Error('before compares sections with an earlier result\'s; a Word document is shown as it is, without it');
  if (/\.docm$/i.test(name)) throw new Error(`"${name}" is a Word document with macros (.docm); the system reads documents without them: .docx`);
  let read: ReturnType<typeof readWordDocument>;
  try { read = withZipFile(file, readWordDocument); } catch (x) { throw new Error(`"${name}" ${(x as Error).message}`); }
  if (!read.blocks.length) throw new Error(`${name} has no text, so there is nothing to show`);
  return { ...documentRows(documentOf(read.blocks, { sections: MOST_SECTIONS })), told: wordAccount(read.counts) };
}

/** The files a document shows as they are: Markdown files, and Word documents. */
export const DOCUMENT_FILE: CardFile = {
  ...MARKDOWN_FILE,
  kinds: `${MARKDOWN_FILE.kinds} or Word documents (.docx)`,
  takes: (name, mime) => MARKDOWN_FILE.takes(name, mime) || isWord(name, mime),
  binary: { takes: isWord, rows: wordRows },
};
