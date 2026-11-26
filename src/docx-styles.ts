// What a Word document's styles and numbering say of its paragraphs and runs: which paragraph style is a heading of
// which level (Heading 1 to 6, by the style's name, or a style based on one), which list a paragraph's style puts it in,
// which character styles are bold or italic, and whether a list's level is numbered or bulleted, and from what number.
import { attributeOf, elementOf, elementsOf, type XmlElement } from './xml-read.js';

/** A paragraph's place in a list: its list (numId, where "0" is none) and its level in it, from 0. */
export type ListPlace = { list: string; level: number };
/** How a list's level is drawn: numbered (from start) or bulleted. */
type ListLevel = { ordered: boolean; start: number };
type Style = { name: string; basedOn?: string; list?: ListPlace; bold?: boolean; italic?: boolean };
export type WordStyles = {
  /** A paragraph style's heading level, 1 to 6; undefined for a style that is no heading. */
  heading: (style: string | undefined) => number | undefined;
  /** The list a paragraph style puts its paragraphs in, if any. */
  list: (style: string | undefined) => ListPlace | undefined;
  /** Whether a character style is bold, and italic. */
  marks: (style: string | undefined) => { bold?: boolean; italic?: boolean };
  /** How a list's level is drawn. */
  level: (place: ListPlace) => ListLevel;
};

/** The value (w:val) of a child element, such as w:pStyle in a paragraph's properties. */
export const valueOf = (e: XmlElement | undefined, child: string): string | undefined => {
  const c = elementOf(e, child);
  return c && attributeOf(c, 'val');
};
/** Whether a toggle (w:b, w:i) is on: present, and not set to 0, false, off or none; undefined when it is not there. */
export const isOn = (e: XmlElement | undefined): boolean | undefined =>
  e ? !/^(0|false|off|none)$/i.test(attributeOf(e, 'val') ?? 'true') : undefined;
const whole = (v: string | undefined, fallback: number) =>
  v !== undefined && /^-?\d{1,9}$/.test(v) ? Number(v) : fallback;

/** A paragraph's numbering properties (w:numPr): its list and level. */
export function listPlaceOf(properties: XmlElement | undefined): ListPlace | undefined {
  const numbering = elementOf(properties, 'numPr'),
    list = valueOf(numbering, 'numId');
  return list === undefined
    ? undefined
    : { list, level: Math.min(Math.max(whole(valueOf(numbering, 'ilvl'), 0), 0), 8) };
}

/** The styles and numbering of a document, from their parts' trees (either may be missing). */
export function wordStyles(styles: XmlElement | undefined, numbering: XmlElement | undefined): WordStyles {
  const byId = new Map<string, Style>();
  for (const s of styles ? elementsOf(styles, 'style') : []) {
    const id = attributeOf(s, 'styleId'),
      runs = elementOf(s, 'rPr');
    if (id)
      byId.set(id, {
        name: (valueOf(s, 'name') ?? '').toLowerCase(),
        basedOn: valueOf(s, 'basedOn'),
        list: listPlaceOf(elementOf(s, 'pPr')),
        bold: isOn(elementOf(runs, 'b')),
        italic: isOn(elementOf(runs, 'i')),
      });
  }
  /** A style and those it is based on, nearest first, at most ten deep. */
  const chain = (id: string | undefined): Style[] => {
    const out: Style[] = [];
    for (let at = id, n = 0; at && n < 10; n++) {
      const s = byId.get(at);
      if (!s || out.includes(s)) break;
      out.push(s);
      at = s.basedOn;
    }
    return out;
  };
  const abstract = new Map<string, Map<number, ListLevel>>();
  for (const a of numbering ? elementsOf(numbering, 'abstractNum') : []) {
    const levels = new Map<number, ListLevel>();
    for (const l of elementsOf(a, 'lvl')) {
      const format = valueOf(l, 'numFmt') ?? 'decimal';
      levels.set(whole(attributeOf(l, 'ilvl'), 0), {
        ordered: format !== 'bullet' && format !== 'none',
        start: whole(valueOf(l, 'start'), 1),
      });
    }
    abstract.set(attributeOf(a, 'abstractNumId') ?? '', levels);
  }
  const lists = new Map<string, Map<number, ListLevel> | undefined>();
  for (const n of numbering ? elementsOf(numbering, 'num') : []) {
    const id = attributeOf(n, 'numId');
    if (id) lists.set(id, abstract.get(valueOf(n, 'abstractNumId') ?? ''));
  }
  return {
    heading: (style) => {
      for (const s of chain(style)) {
        const m = /^heading ([1-6])$/.exec(s.name);
        if (m) return Number(m[1]);
      }
      const id = /^heading([1-6])$/i.exec(style ?? ''); // a document without a styles part
      return id && !byId.size ? Number(id[1]) : undefined;
    },
    list: (style) => chain(style).find((s) => s.list)?.list,
    marks: (style) => {
      const own = chain(style);
      return {
        bold: own.find((s) => s.bold !== undefined)?.bold,
        italic: own.find((s) => s.italic !== undefined)?.italic,
      };
    },
    level: (place) => lists.get(place.list)?.get(place.level) ?? { ordered: false, start: 1 },
  };
}
