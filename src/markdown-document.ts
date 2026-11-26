// A Markdown file as a document block's rows (blocks.ts): one row per section, with its heading, level and anchor, and
// its body as blocks the window draws as elements (renderer/blocks/markdown.ts). The file is read by the system, at
// most MARKDOWN_MOST bytes of it, and parsed on the server (markdown.ts); its account says what it shows.
import type { CardFile, PanelSpec } from './cards.js';
import { parseMarkdown, type MarkdownBlock, type MarkdownDocument } from './markdown.js';
import type { Row } from './results.js';

/** The bytes of a Markdown file a document reads at most: of a longer one, its start. */
export const MARKDOWN_MOST = 512_000;
/** The sections a document from a file draws at most: deeper headings go into the section above them first. */
export const MOST_SECTIONS = 100;

const MARKDOWN_NAME = /\.(md|markdown)$/i;
const MARKDOWN_TYPE = /^text\/(x-)?markdown\s*(;|$)/i;

/** Whether a row is a section of a Markdown file, drawn from its blocks. */
export const isMarkdownSection = (r: Row) => Array.isArray(r.__blocks);

/** The sections of a Markdown text as rows; cut says what of the text they leave out, if anything. */
function markdownRows(text: string, panel: PanelSpec): { rows: Row[]; cut?: string } {
  if (panel.before)
    throw new Error("before compares sections with an earlier result's; a Markdown file is shown as it is, without it");
  return documentRows(parseMarkdown(text, { sections: MOST_SECTIONS }));
}
/** A document's sections as rows (a Markdown file's, or a Word document's): its heading, level, anchor and blocks each. */
export function documentRows(doc: MarkdownDocument): { rows: Row[]; cut?: string } {
  const rows = doc.sections.map((s): Row => ({
    ...(s.anchor !== undefined ? { anchor: s.anchor } : {}),
    ...(s.heading !== undefined ? { heading: s.heading } : {}),
    level: s.level,
    ...(s.title ? { __heading: s.title } : {}),
    __blocks: s.blocks,
  }));
  return { rows, ...(doc.cut ? { cut: `its first ${rows.length} sections, as much of it as a view holds` } : {}) };
}

/** Markdown files, by name or an attachment's type, for a document. */
export const MARKDOWN_FILE: CardFile = {
  kinds: 'Markdown files (.md or .markdown, or an attachment of type text/markdown)',
  takes: (name, mime) => MARKDOWN_NAME.test(name) || MARKDOWN_TYPE.test(mime ?? ''),
  most: MARKDOWN_MOST,
  rows: markdownRows,
};

/** What a document from a Markdown file says it shows: its sections and headings, as the system drew them. */
export function markdownAccount(rows: Row[]): Record<string, unknown> {
  const inside = (r: Row) =>
    (r.__blocks as MarkdownBlock[]).filter((b) => 'heading' in b && b.anchor !== undefined).length;
  return {
    sections: rows.length,
    headings: rows.reduce((n, r) => n + (r.heading !== undefined ? 1 : 0) + inside(r), 0),
    shows:
      'the file as a document, read and drawn by the system: headings, paragraphs, lists, quotes, code, tables and rules; links only to http and https; any HTML in it as text',
  };
}
