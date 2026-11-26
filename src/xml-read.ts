// XML as Office writes it (the parts of a workbook or a Word document), read by the system: its elements, their
// attributes and their text, as events or as a tree. It refuses any declaration (<!DOCTYPE, <!ENTITY and the rest), so no
// entity is ever defined: the five XML predefines (&amp; &lt; &gt; &quot; &apos;) and character references (&#65;
// &#x41;) are read, and any other reference is refused, never expanded. Comments and processing instructions are left
// out, and CDATA is text. Names keep their prefixes (w:p); localName gives a name without its prefix.

/** What a reader hears, in document order. */
export type XmlHandler = {
  open?: (name: string, attributes: Record<string, string>) => void;
  close?: (name: string) => void;
  text?: (text: string) => void;
};
export type XmlElement = { name: string; attributes: Record<string, string>; children: XmlNode[] };
export type XmlNode = XmlElement | string;

/** Elements inside each other, at most. */
const MAX_DEPTH = 256;
const PREDEFINED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const NAME = /[^\s/>=]+/y;
const ATTRIBUTE = /\s*([^\s/>=]+)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/y;
const TAG_END = /\s*(\/?)>/y;
const REFERENCE = /&([^;&\s]{0,32});?/g;

const malformed = (why: string) => new Error(`is not XML the system can read: ${why}`);

/** A character reference's character: U+FFFD for one that names no character. */
function character(code: number): string {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)
    ? String.fromCodePoint(code)
    : String.fromCharCode(0xfffd);
}
/** Text with its references read: the predefined entities and character references, and nothing else. */
function decoded(raw: string): string {
  if (!raw.includes('&')) return raw;
  return raw.replace(REFERENCE, (whole: string, ref: string) => {
    if (!whole.endsWith(';')) throw malformed(`an & that begins no reference (${JSON.stringify(whole.slice(0, 12))})`);
    if (Object.hasOwn(PREDEFINED, ref)) return PREDEFINED[ref];
    if (/^#x[0-9a-fA-F]{1,6}$/.test(ref)) return character(parseInt(ref.slice(2), 16));
    if (/^#[0-9]{1,7}$/.test(ref)) return character(Number(ref.slice(1)));
    throw new Error(
      `refers to an entity (&${ref.slice(0, 20)};) that XML does not define, and the system expands none`,
    );
  });
}

/** A declaration, refused for what it is. */
function declaration(xml: string, at: number): Error {
  const word = /^<!([A-Za-z]+)/.exec(xml.slice(at, at + 20))?.[1]?.toUpperCase();
  if (word === 'DOCTYPE')
    return new Error(
      'declares a document type (<!DOCTYPE), which the system never reads, so that no entity is defined',
    );
  if (word === 'ENTITY') return new Error('declares an entity (<!ENTITY), which the system never reads or expands');
  return new Error(`holds a declaration (<!${word ?? ''}) the system never reads`);
}

/** A start tag from at (its <): its name, attributes, whether it closes itself, and where it ends. */
function startTag(
  xml: string,
  at: number,
): { name: string; attributes: Record<string, string>; empty: boolean; end: number } {
  NAME.lastIndex = at + 1;
  const name = NAME.exec(xml)?.[0];
  if (!name) throw malformed(`a < with no name after it, at character ${at}`);
  const attributes: Record<string, string> = {};
  let i = NAME.lastIndex;
  for (;;) {
    TAG_END.lastIndex = i;
    const end = TAG_END.exec(xml);
    if (end) return { name, attributes, empty: end[1] === '/', end: TAG_END.lastIndex };
    ATTRIBUTE.lastIndex = i;
    const a = ATTRIBUTE.exec(xml);
    if (!a) throw malformed(`the tag <${name.slice(0, 40)}> is not closed or has an attribute without a quoted value`);
    if (Object.hasOwn(attributes, a[1]))
      throw malformed(`the tag <${name.slice(0, 40)}> has the attribute ${a[1].slice(0, 40)} twice`);
    attributes[a[1]] = decoded(a[2] ?? a[3]);
    i = ATTRIBUTE.lastIndex;
  }
}

/** Read XML from start to end, telling on what it holds as it goes. Throws, saying why, at what it does not read. */
export function readXml(xml: string, on: XmlHandler): void {
  const open: string[] = [];
  let i = 0,
    rooted = false;
  const text = (raw: string) => {
    if (open.length) {
      if (raw) on.text?.(raw);
    } else if (raw.trim()) throw malformed('text outside its root element');
  };
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) {
      text(decoded(xml.slice(i)));
      break;
    }
    if (lt > i) text(decoded(xml.slice(i, lt)));
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      if (end < 0) throw malformed('a comment that is never closed');
      i = end + 3;
    } else if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      if (end < 0) throw malformed('a CDATA section that is never closed');
      text(xml.slice(lt + 9, end));
      i = end + 3;
    } else if (xml[lt + 1] === '!') {
      throw declaration(xml, lt);
    } else if (xml[lt + 1] === '?') {
      const end = xml.indexOf('?>', lt + 2);
      if (end < 0) throw malformed('a processing instruction that is never closed');
      i = end + 2;
    } else if (xml[lt + 1] === '/') {
      const end = xml.indexOf('>', lt);
      if (end < 0) throw malformed('an end tag that is never closed');
      const name = xml.slice(lt + 2, end).trim(),
        was = open.pop();
      if (name !== was) throw malformed(`</${name.slice(0, 40)}> closes ${was ? `<${was.slice(0, 40)}>` : 'nothing'}`);
      on.close?.(name);
      i = end + 1;
    } else {
      const tag = startTag(xml, lt);
      if (!open.length && rooted) throw malformed('a second root element');
      rooted = true;
      on.open?.(tag.name, tag.attributes);
      if (tag.empty) on.close?.(tag.name);
      else if (open.push(tag.name) > MAX_DEPTH) throw malformed(`elements more than ${MAX_DEPTH} deep`);
      i = tag.end;
    }
  }
  if (open.length) throw malformed(`<${open.at(-1)!.slice(0, 40)}> is never closed`);
  if (!rooted) throw malformed('it holds no element');
}

/** XML as a tree: its root element, with its attributes and children (elements, and text). */
export function xmlTree(xml: string): XmlElement {
  const root: XmlElement = { name: '', attributes: {}, children: [] };
  const stack: XmlElement[] = [root];
  readXml(xml, {
    open: (name, attributes) => {
      const e: XmlElement = { name, attributes, children: [] };
      stack.at(-1)!.children.push(e);
      stack.push(e);
    },
    close: () => {
      stack.pop();
    },
    text: (t) => {
      const kids = stack.at(-1)!.children,
        last = kids.at(-1);
      if (typeof last === 'string') kids[kids.length - 1] = last + t;
      else kids.push(t);
    },
  });
  return root.children.find((x): x is XmlElement => typeof x !== 'string')!;
}

/** A name without its prefix: p for w:p. */
export const localName = (name: string) => name.slice(name.indexOf(':') + 1);
/** An attribute by its name without a prefix (val for w:val, id for r:id). */
export function attributeOf(e: XmlElement, local: string): string | undefined {
  for (const [k, v] of Object.entries(e.attributes)) if (localName(k) === local) return v;
  return undefined;
}
/** The child elements of e, with this name without a prefix, or all of them. */
export const elementsOf = (e: XmlElement, local?: string): XmlElement[] =>
  e.children.filter(
    (x): x is XmlElement => typeof x !== 'string' && (local === undefined || localName(x.name) === local),
  );
/** The first child element of e with this name without a prefix. */
export const elementOf = (e: XmlElement | undefined, local: string): XmlElement | undefined =>
  e ? elementsOf(e, local)[0] : undefined;
