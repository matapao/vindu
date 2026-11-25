// Workbooks (.xlsx) and Word documents (.docx) made here, from XML written out in the tests and zipped with fflate, so
// that no binary file is kept with them. All their data is synthetic.
import { strToU8, zipSync, type Zippable } from 'fflate';

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const DOC = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const relation = (id: string, kind: string, target: string, external = false) =>
  `<Relationship Id="${id}" Type="${DOC}/${kind}" Target="${target}"${external ? ' TargetMode="External"' : ''}/>`;
const relations = (inner: string) => `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${inner}</Relationships>`;
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A zip archive of these parts, each XML text or bytes. */
export const zipOf = (parts: Record<string, string | Uint8Array>): Uint8Array =>
  zipSync(Object.fromEntries(Object.entries(parts).map(([name, part]) => [name, typeof part === 'string' ? strToU8(part) : part])) as Zippable, { level: 6 });

/** A worksheet's XML: its rows of cells, each written as Excel writes them, and its merged cells. */
export const sheetXml = (rows: string, merges: string[] = []) =>
  `${XML}<worksheet xmlns="${MAIN}" xmlns:r="${DOC}"><sheetData>${rows}</sheetData>${merges.length ? `<mergeCells count="${merges.length}">${merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : ''}</worksheet>`;
/** The shared strings part of these strings. */
export const stringsXml = (strings: string[]) =>
  `${XML}<sst xmlns="${MAIN}" count="${strings.length}" uniqueCount="${strings.length}">${strings.map(s => `<si><t xml:space="preserve">${escape(s)}</t></si>`).join('')}</sst>`;
/** A styles part: its own number formats, and a cell style for each number format id given, in order. */
export const stylesXml = (own: Record<number, string>, styles: number[]) => `${XML}<styleSheet xmlns="${MAIN}">${
  Object.keys(own).length ? `<numFmts>${Object.entries(own).map(([id, code]) => `<numFmt numFmtId="${id}" formatCode="${escape(code)}"/>`).join('')}</numFmts>` : ''}<cellStyleXfs count="1"><xf numFmtId="0"/></cellStyleXfs><cellXfs count="${styles.length}">${
  styles.map(id => `<xf numFmtId="${id}" applyNumberFormat="1"/>`).join('')}</cellXfs></styleSheet>`;

export type SheetPart = { name: string; xml: string; state?: 'hidden' | 'veryHidden' };
/** A workbook of these sheets, in order, with shared strings and styles; more: other parts, or parts in place of its own. */
export function workbook(sheets: SheetPart[], o: { strings?: string[]; styles?: string; more?: Record<string, string | Uint8Array> } = {}): Uint8Array {
  const parts: Record<string, string | Uint8Array> = {
    '[Content_Types].xml': `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
    '_rels/.rels': relations(relation('rId1', 'officeDocument', 'xl/workbook.xml')),
    'xl/workbook.xml': `${XML}<workbook xmlns="${MAIN}" xmlns:r="${DOC}"><workbookPr/><sheets>${sheets.map((s, i) =>
      `<sheet name="${escape(s.name)}" sheetId="${i + 1}"${s.state ? ` state="${s.state}"` : ''} r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': relations([...sheets.map((_, i) => relation(`rId${i + 1}`, 'worksheet', `worksheets/sheet${i + 1}.xml`)),
      relation('rIdS', 'sharedStrings', 'sharedStrings.xml'), relation('rIdT', 'styles', 'styles.xml')].join('')),
    'xl/sharedStrings.xml': stringsXml(o.strings ?? []),
    'xl/styles.xml': o.styles ?? stylesXml({}, [0]),
    ...Object.fromEntries(sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, s.xml])),
    ...o.more,
  };
  return zipOf(parts);
}

/** A Word document of this body (its w:body's XML), with its styles, numbering and relationships (hyperlinks). */
export function wordDocument(body: string, o: { styles?: string; numbering?: string; links?: Record<string, string>; more?: Record<string, string | Uint8Array> } = {}): Uint8Array {
  return zipOf({
    '[Content_Types].xml': `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
    '_rels/.rels': relations(relation('rId1', 'officeDocument', 'word/document.xml')),
    'word/document.xml': `${XML}<w:document xmlns:w="${WORD}" xmlns:r="${DOC}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body}</w:body></w:document>`,
    'word/_rels/document.xml.rels': relations([relation('rIdStyles', 'styles', 'styles.xml'), relation('rIdNumbering', 'numbering', 'numbering.xml'),
      ...Object.entries(o.links ?? {}).map(([id, target]) => relation(id, 'hyperlink', escape(target), true))].join('')),
    ...(o.styles ? { 'word/styles.xml': `${XML}<w:styles xmlns:w="${WORD}">${o.styles}</w:styles>` } : {}),
    ...(o.numbering ? { 'word/numbering.xml': `${XML}<w:numbering xmlns:w="${WORD}">${o.numbering}</w:numbering>` } : {}),
    ...o.more,
  });
}
/** A paragraph style, as Word writes Heading 1 to 6 (heading 1 is its name, Heading1 its id) and others. */
export const paragraphStyle = (id: string, name: string, more = '') => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/>${more}</w:style>`;
