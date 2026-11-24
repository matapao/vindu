// The window's own elements: made in the host's document (an Electron window, a frame of a web app), never the global
// one, and the view a drawn element is in, read from its pane.

/** Makes an element of the document's: its tag, its class and its text. */
export type ElementMaker = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => HTMLElementTagNameMap[K];

export function elementsOf(doc: Document): ElementMaker {
  return (tag, cls, text) => {
    const element = doc.createElement(tag);
    if (cls) element.className = cls;
    if (text) element.textContent = text;
    return element;
  };
}

/** A host's pane's switch for whether the model may read it: a labelled checkbox, as a terminal and a browser show it. */
export function shareToggle(make: ElementMaker, text: string): { label: HTMLLabelElement; box: HTMLInputElement } {
  const label = make('label', 'vindu-share'), box = make('input');
  box.type = 'checkbox';
  label.append(box, ` ${text}`);
  return { label, box };
}

/** The pane an element is drawn in, and its view's name. */
export const paneOf = (element: Element | null | undefined) => element?.closest<HTMLElement>('.vindu-pane') ?? null;
export const viewOf = (element: Element | null | undefined) => paneOf(element)?.dataset.view;

/** What a block asks the window to do (a device's switch, a slide, a task moved): an event from where it is drawn,
 *  which the shell carries to the UI server (pointing.ts). */
export const BLOCK_ACTION = 'vindu-action';
export function sendBlockAction(from: Element, detail: Record<string, unknown>): void {
  from.dispatchEvent(new CustomEvent(BLOCK_ACTION, { bubbles: true, composed: true, detail }));
}

const SVG = 'http://www.w3.org/2000/svg';
/** What an icon may draw with: shapes, groups, gradients and masks. Never a script, a foreign object, a link or an image. */
const DRAWING = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'rect', 'title', 'desc',
  'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask']);
/** A value that loads something: a url() that is not a fragment of the icon's own. */
const LOADS = /url\s*\(\s*['"]?\s*[^#\s'")]/i;

/** A host's icon, from its SVG markup: the drawing alone, without what could run or load (scripts, handlers, links,
 *  styles, images), made in the document it is shown in; or null when the markup is not one SVG. */
export function iconOf(doc: Document, markup: string): SVGSVGElement | null {
  // Parsed as HTML parses an svg in a page (so it needs no xmlns), into a document that runs and loads nothing.
  const Parser = (doc.defaultView ?? window).DOMParser;
  const { body } = new Parser().parseFromString(`<!doctype html><body>${markup}`, 'text/html');
  const icon = body.firstElementChild;
  if (body.childElementCount !== 1 || !icon || icon.localName !== 'svg' || icon.namespaceURI !== SVG) return null;
  const keep = (element: Element) => {
    // oxlint-disable-next-line unicorn/no-useless-spread -- a copy: children is live, and a child removed from it would skip the next
    for (const child of [...element.children]) {
      if (child.namespaceURI === SVG && DRAWING.has(child.localName)) keep(child); else child.remove();
    }
    // oxlint-disable-next-line unicorn/no-useless-spread -- a copy: attributes is live, and one removed from it would skip the next
    for (const { name, value } of [...element.attributes]) {
      if (/^on/i.test(name) || /href$/i.test(name) || name === 'style' || LOADS.test(value)) element.removeAttribute(name);
    }
  };
  keep(icon);
  return doc.importNode(icon, true) as unknown as SVGSVGElement;
}
