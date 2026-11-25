// A document read from a Markdown file or a Word document (markdown-document.ts, word-document.ts), drawn as elements:
// each section with its heading, and its blocks as paragraphs, lists, quotes, code, tables and rules, in the theme's own
// look. Everything it is sent is set as text, never as markup, and read as untrusted: a link is drawn only to http or
// https, or a mailto: address from a Word document, checked here again, and
// opens as the host opens links (a new window, which the browser, or an Electron host's window-open handler, decides
// on). A document of more than two headings has a table of contents beside it, where its pane is wide enough.
import { html, nothing } from 'lit';
import { linkAddress } from '../../markdown-inline.js';
import { type BlockRow, type RowBlockProps, fieldValue, rowContainer } from './shared.js';

type Json = Record<string, unknown>;
const listOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const isObject = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const MAX_DEPTH = 12; // marks and blocks inside each other, at most: what the server never sends is not drawn
/** A heading as the file writes it: never read as a date or a number. */
function said(v: unknown): string {
  if (typeof v === 'string') return v;
  return v === undefined || v === null ? '' : JSON.stringify(v);
}

/** A part of a paragraph: text, or text marked (emphasis, strong, struck through, code, a link, a line break). */
function inline(x: unknown, depth: number): unknown {
  if (typeof x === 'string') return x;
  if (!isObject(x) || depth > MAX_DEPTH) return nothing;
  if (typeof x.code === 'string') return html`<code>${x.code}</code>`;
  if (x.br === true) return html`<br>`;
  if ('em' in x) return html`<em>${inlines(x.em, depth)}</em>`;
  if ('strong' in x) return html`<strong>${inlines(x.strong, depth)}</strong>`;
  if ('del' in x) return html`<s>${inlines(x.del, depth)}</s>`;
  if ('link' in x) {
    const href = typeof x.link === 'string' ? linkAddress(x.link) : null, text = inlines(x.text, depth);
    return href ? html`<a href=${href} target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${text}</a>` : text;
  }
  return nothing;
}
const inlines = (v: unknown, depth = 0) => listOf(v).map(x => inline(x, depth + 1));

/** A heading: its level as the document gives it, and its anchor, which the table of contents goes to. */
const heading = (content: unknown, level: unknown, anchor?: unknown) => {
  const n = Math.min(6, Math.max(1, Math.round(Number(level)) || 1));
  return html`<div class=${`vb-mdh vb-mdh${n}`} role="heading" aria-level=${n} data-anchor=${typeof anchor === 'string' ? anchor : nothing}>${content}</div>`;
};
const ALIGNED = new Set(['left', 'center', 'right']);

function block(b: unknown, depth: number): unknown {
  if (!isObject(b) || depth > MAX_DEPTH) return nothing;
  if ('paragraph' in b) return html`<p>${inlines(b.paragraph)}</p>`;
  if ('heading' in b) return heading(inlines(b.heading), b.level, b.anchor);
  if ('list' in b) {
    const items = listOf(b.list).filter(isObject).map(item => (typeof item.checked === 'boolean'
      ? html`<li class="vb-task"><input type="checkbox" disabled .checked=${item.checked} aria-label=${item.checked ? 'done' : 'not done'}>${blocks(item.blocks, depth)}</li>`
      : html`<li>${blocks(item.blocks, depth)}</li>`));
    return b.ordered === true ? html`<ol start=${Number.isInteger(b.start) ? String(b.start) : nothing}>${items}</ol>` : html`<ul>${items}</ul>`;
  }
  if ('quote' in b) return html`<blockquote>${blocks(b.quote, depth)}</blockquote>`;
  if (typeof b.code === 'string') {
    const language = typeof b.language === 'string' ? b.language : '';
    return html`<figure class="vb-mdpre">${language ? html`<figcaption>${language}</figcaption>` : nothing}<pre data-language=${language || nothing}><code>${b.code}</code></pre></figure>`;
  }
  if (isObject(b.table)) {
    const align = listOf(b.table.align), at = (k: number) => (ALIGNED.has(String(align[k])) ? `vb-${String(align[k])}` : '');
    return html`<div class="vb-mdtable"><table><thead><tr>${listOf(b.table.head).map((c, k) => html`<th class=${at(k)}>${inlines(c)}</th>`)}</tr></thead><tbody>${
      listOf(b.table.rows).map(r => html`<tr>${listOf(r).map((c, k) => html`<td class=${at(k)}>${inlines(c)}</td>`)}</tr>`)}</tbody></table></div>`;
  }
  if (b.rule === true) return html`<hr>`;
  return nothing;
}
const blocks = (v: unknown, depth = 0) => listOf(v).map(b => block(b, depth + 1));
/** Blocks of Markdown, as a document draws them (a mail's body, say). */
export const markdownBlocks = (v: unknown) => blocks(v);

/** The section with this anchor, brought into view in its document. */
const goTo = (anchor: string) => (e: Event) => {
  const doc = (e.currentTarget as Element).closest('.vb-md');
  const target = [...(doc?.querySelectorAll<HTMLElement>('[data-anchor]') ?? [])].find(x => x.dataset.anchor === anchor);
  target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
};
/** The table of contents: each section's heading, indented by its level below the document's top one. */
function contents(props: RowBlockProps, titled: BlockRow[]) {
  const levels = titled.map(r => Number(fieldValue(props, r, 'level')) || 1), top = Math.min(...levels);
  return html`<nav class="vb-toc" aria-label="Contents"><div class="vb-tochead">Contents</div><ol>${titled.map((r, i) => {
    const anchor = fieldValue(props, r, 'anchor');
    return html`<li class=${`vb-toc${Math.min(3, levels[i] - top + 1)}`}><button type="button" @click=${typeof anchor === 'string' ? goTo(anchor) : nothing}>${said(fieldValue(props, r, 'heading'))}</button></li>`;
  })}</ol></nav>`;
}

/** A document of Markdown sections, with what it is drawn from: the file's name, and whether only its start is shown. */
export function markdownDocument(props: RowBlockProps) {
  const file = isObject(props.file) ? props.file : {};
  const titled = props.rows.filter(r => fieldValue(props, r, 'heading') !== undefined);
  const toc = titled.length > 2 ? contents(props, titled) : nothing;
  const sections = props.rows.map((row, index) => {
    const title = fieldValue(props, row, 'heading');
    const head = title === undefined ? nothing : heading(Array.isArray(row.__heading) ? inlines(row.__heading) : said(title), fieldValue(props, row, 'level'), fieldValue(props, row, 'anchor'));
    return rowContainer(props, index, 'vb-mdsec', html`${head}${blocks(row.__blocks)}`);
  });
  return html`<div class="vb-md"><div class=${toc === nothing ? 'vb-mdgrid' : 'vb-mdgrid vb-withtoc'}>${toc}<article class="vb-mdbody">${
    typeof file.name === 'string' ? html`<div class="vb-mdfile">${file.name}</div>` : nothing}${sections}${
    file.cut === true ? html`<p class="vb-mdcut">Only its start is shown.</p>` : nothing}</article></div></div>`;
}
