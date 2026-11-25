// The parts of an Office file (a workbook or a Word document) as the system reads them from its zip archive: a part's
// XML, its relationships to other parts, the package's main part, and the refusal of one with macros. An error says
// which part it is about, for the panel's refusal to name.
import { readXml, xmlTree, attributeOf, elementsOf, type XmlElement, type XmlHandler } from './xml-read.js';
import type { ZipArchive } from './zip-read.js';

/** A relationship of a part: what kind it is (the end of its type, such as worksheet or hyperlink), and where it goes:
 *  another part of the package, by its name, or an address outside it (external). */
export type Relation = { kind: string; target: string; external: boolean };

/** An error about a part, saying which. */
const aboutPart = (name: string, x: unknown) => new Error(`has a part (${name}) that ${(x as Error).message}`);

/** A part's XML as a tree, or undefined when there is no such part. What the archive refuses (zip-read.ts) names the
 *  part itself. */
export function partTree(zip: ZipArchive, name: string): XmlElement | undefined {
  const text = zip.text(name);
  if (text === undefined) return undefined;
  try { return xmlTree(text); } catch (x) { throw aboutPart(name, x); }
}
/** A part's XML read as it goes (a worksheet, which may be large); false when there is no such part. */
export function readPart(zip: ZipArchive, name: string, on: XmlHandler): boolean {
  const text = zip.text(name);
  if (text === undefined) return false;
  try { readXml(text, on); } catch (x) { throw aboutPart(name, x); }
  return true;
}

/** A part named from another, as a relationship's target names it: from the package's root (/xl/styles.xml), or from
 *  the folder of the part (worksheets/sheet1.xml); null for one that leaves the package. */
function partPath(from: string, target: string): string | null {
  const segments = target.startsWith('/') ? [] : from.split('/').slice(0, -1);
  for (const s of target.replace(/^\/+/, '').split('/')) {
    if (s === '..') { if (!segments.length) return null; segments.pop(); } else if (s && s !== '.') segments.push(s);
  }
  return segments.length ? segments.join('/') : null;
}

/** A part's relationships, by their ids: kept in _rels/<its name>.rels beside it. */
export function relationsOf(zip: ZipArchive, part: string): Map<string, Relation> {
  const at = part.lastIndexOf('/');
  const root = partTree(zip, `${part.slice(0, at + 1)}_rels/${part.slice(at + 1)}.rels`);
  const out = new Map<string, Relation>();
  for (const r of root ? elementsOf(root, 'Relationship') : []) {
    const id = attributeOf(r, 'Id'), target = attributeOf(r, 'Target') ?? '', external = attributeOf(r, 'TargetMode') === 'External';
    const kind = (attributeOf(r, 'Type') ?? '').split('/').at(-1)!;
    const resolved = external ? target : partPath(part, target);
    if (id && resolved !== null) out.set(id, { kind, target: resolved, external });
  }
  return out;
}
/** The part a relationship of this kind goes to, the first of them; undefined when there is none. */
export const relatedPart = (relations: Map<string, Relation>, kind: string): string | undefined =>
  [...relations.values()].find(r => r.kind === kind && !r.external)?.target;

/** The package's main part (its officeDocument), or the usual one when the package does not say. */
export const mainPart = (zip: ZipArchive, usual: string): string => relatedPart(relationsOf(zip, ''), 'officeDocument') ?? usual;

/** Refuse a package with macros: a vbaProject.bin part (VBA), wherever it is. */
export function refuseMacros(zip: ZipArchive): void {
  const macros = zip.names.find(n => /(^|\/)vbaProject\.bin$/i.test(n));
  if (macros) throw new Error(`holds macros (its part ${macros}); the system reads workbooks and documents without them: .xlsx and .docx`);
}
