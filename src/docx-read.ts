// A Word document (.docx) read by the system into a document's blocks (markdown.ts's), from its parts (office-parts.ts):
// its paragraphs, headings by the Heading 1 to 6 styles, bold, italic and struck-through text, lists (numbered or
// bulleted, nested by level), tables, line breaks, and links to http, https and mailto addresses. A picture is a note in
// its place ([picture], with its description where it has one). Comments, tracked deletions, hidden text and the codes of
// fields are left out; tracked insertions, and what a field shows, are text like any other. Nothing is fetched or run.
import { isOn, listPlaceOf, valueOf, wordStyles, type ListPlace, type WordStyles } from './docx-styles.js';
import type { MarkdownBlock } from './markdown.js';
import { linkAddress, plainOf, type Inline } from './markdown-inline.js';
import { mainPart, partTree, refuseMacros, relatedPart, relationsOf, type Relation } from './office-parts.js';
import { attributeOf, elementOf, elementsOf, localName, type XmlElement, type XmlNode } from './xml-read.js';
import type { ZipArchive } from './zip-read.js';

/** What a document held, by kind, for its account: what is drawn, and what is left out. */
export type WordCounts = { paragraphs: number; lists: number; tables: number; links: number; pictures: number; insertions: number; deletions: number; comments: number; fields: number };
/** A piece of a paragraph's text, or a line break, with its marks and the address it links to. */
type Piece = { text?: string; br?: true; bold: boolean; italic: boolean; strike: boolean; link?: string };
type ListBlock = Extract<MarkdownBlock, { list: unknown }>;
/** Lists inside each other, at most: an item deeper than this is drawn at the deepest. */
const LIST_DEPTH = 6;
/** The hyphens Word writes as elements of their own: one a line never breaks at, and one it breaks at only where needed. */
const NO_BREAK_HYPHEN = String.fromCharCode(0x2011), SOFT_HYPHEN = String.fromCharCode(0xad);

const textIn = (e: XmlElement) => e.children.filter((x): x is string => typeof x === 'string').join('');
/** The first element under e, at any depth, with this name without a prefix. */
function findIn(e: XmlElement, local: string): XmlElement | undefined {
  for (const x of elementsOf(e)) { if (localName(x.name) === local) return x; const inner = findIn(x, local); if (inner) return inner; }
  return undefined;
}
/** Every text (t) under e, in order: a formula's, say. */
const allText = (e: XmlElement): string => elementsOf(e).map(x => (localName(x.name) === 't' ? textIn(x) : allText(x))).join('');

/** Inline text added at the end of a list: text joined to the text before it, anything else after it. */
function append(list: Inline[], x: Inline): void {
  const last = list.at(-1);
  if (typeof x === 'string' && typeof last === 'string') list[list.length - 1] = last + x;
  else list.push(x);
}
/** A paragraph's pieces as inline text: those of one link together, and each run of the same marks as one. */
function inlinesOf(pieces: Piece[]): Inline[] {
  const out: Inline[] = [];
  for (let i = 0; i < pieces.length;) {
    let j = i;
    while (j < pieces.length && pieces[j].link === pieces[i].link) j++;
    const marked = markedOf(pieces.slice(i, j)), link = pieces[i].link;
    if (link) out.push({ link, text: marked }); else for (const x of marked) append(out, x);
    i = j;
  }
  return out;
}
function markedOf(pieces: Piece[]): Inline[] {
  const out: Inline[] = [];
  const same = (a: Piece, b: Piece) => a.bold === b.bold && a.italic === b.italic && a.strike === b.strike;
  for (let i = 0; i < pieces.length;) {
    const content: Inline[] = [];
    let j = i;
    for (; j < pieces.length && same(pieces[j], pieces[i]); j++) append(content, pieces[j].text ?? { br: true });
    let node: Inline[] = content;
    if (pieces[i].strike) node = [{ del: node }];
    if (pieces[i].italic) node = [{ em: node }];
    if (pieces[i].bold) node = [{ strong: node }];
    for (const x of node) append(out, x);
    i = j;
  }
  return out;
}

/** A Word document's reader: its styles and relationships, what it has counted, and the fields it is inside. */
function documentReader(styles: WordStyles, relations: Map<string, Relation>) {
  const counts: WordCounts = { paragraphs: 0, lists: 0, tables: 0, links: 0, pictures: 0, insertions: 0, deletions: 0, comments: 0, fields: 0 };
  const fields: ('code' | 'result')[] = []; // a field's code is left out until its result begins; fields may nest
  const inCode = () => fields.includes('code');

  /** A run's pieces: its text, tabs, breaks and pictures, with its marks; its field characters move through fields. */
  function run(r: XmlElement, link: string | undefined, out: Piece[]) {
    const props = elementOf(r, 'rPr'), styled = styles.marks(valueOf(props, 'rStyle')), hidden = isOn(elementOf(props, 'vanish'));
    const marks = { bold: isOn(elementOf(props, 'b')) ?? styled.bold ?? false, italic: isOn(elementOf(props, 'i')) ?? styled.italic ?? false,
      strike: !!(isOn(elementOf(props, 'strike')) || isOn(elementOf(props, 'dstrike'))), ...(link ? { link } : {}) };
    const say = (text: string) => { if (!hidden && !inCode() && text) out.push({ text, ...marks }); };
    // what Word writes in two ways (a drawing, and a picture for older readers) is read once, the first way
    const contents = (e: XmlElement): XmlElement[] => elementsOf(e).flatMap(c => {
      if (localName(c.name) !== 'AlternateContent') return [c];
      const chosen = elementOf(c, 'Choice') ?? elementOf(c, 'Fallback');
      return chosen ? contents(chosen) : [];
    });
    for (const c of contents(r)) {
      switch (localName(c.name)) {
        case 't': say(textIn(c)); break;
        case 'tab': case 'ptab': say('\t'); break;
        case 'br': if (!/^(page|column)$/.test(attributeOf(c, 'type') ?? '') && !hidden && !inCode()) out.push({ br: true, ...marks }); break;
        case 'cr': if (!hidden && !inCode()) out.push({ br: true, ...marks }); break;
        case 'noBreakHyphen': say(NO_BREAK_HYPHEN); break;
        case 'softHyphen': say(SOFT_HYPHEN); break;
        case 'drawing': case 'pict': case 'object': {
          if (hidden || inCode()) break;
          counts.pictures++;
          const about = findIn(c, 'docPr'), said = about && (attributeOf(about, 'descr') || attributeOf(about, 'title'));
          say(said ? `[picture: ${said.trim()}]` : '[picture]');
          break;
        }
        case 'fldChar': {
          const type = attributeOf(c, 'fldCharType');
          if (type === 'begin') { fields.push('code'); counts.fields++; } else if (type === 'separate' && fields.length) fields[fields.length - 1] = 'result'; else if (type === 'end') fields.pop();
          break;
        }
        case 'commentReference': counts.comments++; break;
        default: // a field's code (instrText), deleted text, notes' references, symbols: nothing drawn
      }
    }
  }
  /** The pieces of a paragraph's content: its runs, links, tracked changes, fields and the containers around them. */
  function pieces(nodes: XmlNode[], link: string | undefined, out: Piece[]) {
    for (const n of nodes) {
      if (typeof n === 'string') continue;
      switch (localName(n.name)) {
        case 'r': run(n, link, out); break;
        case 'hyperlink': {
          const to = relations.get(attributeOf(n, 'id') ?? ''), href = to?.external ? linkAddress(to.target) : null;
          if (href && !link) counts.links++;
          pieces(n.children, link ?? href ?? undefined, out);
          break;
        }
        case 'ins': counts.insertions++; pieces(n.children, link, out); break;
        case 'moveTo': case 'smartTag': case 'customXml': case 'bdo': case 'dir': pieces(n.children, link, out); break;
        case 'del': case 'moveFrom': counts.deletions++; break;
        case 'fldSimple': counts.fields++; pieces(n.children, link, out); break;
        case 'sdt': pieces(elementOf(n, 'sdtContent')?.children ?? [], link, out); break;
        case 'AlternateContent': pieces((elementOf(n, 'Choice') ?? elementOf(n, 'Fallback'))?.children ?? [], link, out); break;
        case 'oMath': case 'oMathPara': if (!inCode()) out.push({ text: allText(n), bold: false, italic: false, strike: false, ...(link ? { link } : {}) }); break;
        default: // properties, bookmarks, comment ranges, proofing marks: nothing drawn
      }
    }
  }
  /** A paragraph: its text, its heading level by its style, and its place in a list. */
  function paragraph(p: XmlElement): { inlines: Inline[]; heading?: number; place?: ListPlace } {
    const props = elementOf(p, 'pPr'), style = valueOf(props, 'pStyle'), out: Piece[] = [];
    pieces(p.children, undefined, out);
    const place = listPlaceOf(props) ?? styles.list(style);
    return { inlines: inlinesOf(out), heading: styles.heading(style), ...(place && place.list !== '0' ? { place } : {}) };
  }
  /** The paragraphs of a table's cell, at any depth, as one text, each after a line break. */
  function cellText(tc: XmlElement): Inline[] {
    const out: Inline[] = [];
    const walk = (e: XmlElement) => {
      for (const x of elementsOf(e)) {
        if (localName(x.name) !== 'p') { walk(x); continue; }
        const text = paragraph(x).inlines;
        if (!plainOf(text).trim()) continue;
        if (out.length) out.push({ br: true });
        out.push(...text);
      }
    };
    walk(tc);
    return out;
  }
  /** A table: its first row its head; a cell that spans columns is followed by empty ones, so the columns line up. */
  function table(tbl: XmlElement): MarkdownBlock {
    const rows: Inline[][][] = [];
    const cellsOf = (e: XmlElement): XmlElement[] => elementsOf(e).flatMap(x => {
      const n = localName(x.name);
      if (n === 'tc') return [x];
      return n === 'sdt' || n === 'customXml' || n === 'sdtContent' ? cellsOf(x) : [];
    });
    for (const tr of elementsOf(tbl, 'tr')) {
      const cells: Inline[][] = [];
      for (const tc of cellsOf(tr)) {
        const span = Number(valueOf(elementOf(tc, 'tcPr'), 'gridSpan') ?? 1);
        cells.push(cellText(tc));
        for (let k = 1; k < Math.min(Number.isInteger(span) ? span : 1, 64); k++) cells.push([]);
      }
      rows.push(cells);
    }
    const width = Math.max(1, ...rows.map(r => r.length)), filled = rows.map(r => [...r, ...Array.from({ length: width - r.length }, () => [] as Inline[])]);
    counts.tables++;
    return { table: { align: Array.from({ length: width }, () => null), head: filled[0] ?? [], rows: filled.slice(1) } };
  }

  /** The blocks of the document's body: paragraphs, headings, lists by their paragraphs' places, and tables. */
  function body(nodes: XmlNode[]): MarkdownBlock[] {
    const out: MarkdownBlock[] = [];
    let open: { level: number; ordered: boolean; block: ListBlock }[] = [];
    const item = (inlines: Inline[], place: ListPlace) => {
      const { ordered, start } = styles.level(place), level = Math.min(place.level, LIST_DEPTH - 1);
      while (open.length && open.at(-1)!.level > level) open.pop();
      if (open.length && open.at(-1)!.level === level && open.at(-1)!.ordered !== ordered) open.pop();
      const top = open.at(-1);
      if (!top || top.level < level) {
        const block: ListBlock = { list: [], ...(ordered ? { ordered: true as const } : {}), ...(ordered && start !== 1 ? { start } : {}) };
        if (top) top.block.list.at(-1)!.blocks.push(block); else { out.push(block); counts.lists++; }
        open.push({ level, ordered, block });
      }
      open.at(-1)!.block.list.push({ blocks: [{ paragraph: inlines }] });
    };
    const walk = (list: XmlNode[]) => {
      for (const n of list) {
        if (typeof n === 'string') continue;
        const name = localName(n.name);
        if (name === 'p') {
          const p = paragraph(n);
          if (!plainOf(p.inlines).trim()) continue; // an empty paragraph is space between others
          if (p.heading) { open = []; out.push({ heading: p.inlines, level: p.heading }); continue; }
          counts.paragraphs++;
          if (p.place) item(p.inlines, p.place);
          else { open = []; out.push({ paragraph: p.inlines }); }
        } else if (name === 'tbl') { open = []; out.push(table(n)); }
        else if (name === 'sdt') walk(elementOf(n, 'sdtContent')?.children ?? []);
        else if (name === 'customXml') walk(n.children);
        else if (name === 'AlternateContent') walk((elementOf(n, 'Choice') ?? elementOf(n, 'Fallback'))?.children ?? []);
      }
    };
    walk(nodes);
    return out;
  }
  return { body, counts };
}

/** A Word document's blocks, and what it held. Throws, saying why, for a document the system does not read. */
export function readWordDocument(zip: ZipArchive): { blocks: MarkdownBlock[]; counts: WordCounts } {
  refuseMacros(zip);
  const main = mainPart(zip, 'word/document.xml');
  const root = partTree(zip, main);
  if (!root || localName(root.name) !== 'document') throw new Error('is not a Word document: it has no document part (word/document.xml)');
  const relations = relationsOf(zip, main);
  const styles = wordStyles(partTree(zip, relatedPart(relations, 'styles') ?? 'word/styles.xml'), partTree(zip, relatedPart(relations, 'numbering') ?? 'word/numbering.xml'));
  const reader = documentReader(styles, relations);
  const blocks = reader.body(elementOf(root, 'body')?.children ?? []);
  return { blocks, counts: reader.counts };
}
