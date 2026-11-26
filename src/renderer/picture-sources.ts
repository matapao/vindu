// The schemes a host serves pictures from besides http and https (its own media: scheme, say), given to drawSurface,
// mountView or mountShell for the element it draws in: the blocks inside it draw a picture from such an address as
// from http(s) (a photo with marks, a gallery's tiles, a signature). Sound and video keep their own rule, and data:
// stays as imageSource has it: an image's own data, in base64, alone.
const given = new WeakMap<Element, readonly string[]>();
/** A URL scheme as the URL parser writes it: a letter, then letters, digits, "+", "-" or ".", and ":". */
const SCHEME = /^[a-z][a-z0-9+.-]*:$/;
/** Schemes that are never a source of pictures: code to run, or data that is not checked as an image. */
const NEVER = new Set(['javascript:', 'vbscript:', 'data:']);

/** The schemes, checked: each lowercase and ending in ":", and none that runs code or is data. Throws otherwise. */
export function checkedSources(sources: readonly string[]): readonly string[] {
  if (!Array.isArray(sources))
    throw new TypeError('sources: a list of schemes the host serves pictures from, e.g. ["media:"]');
  for (const scheme of sources as unknown[]) {
    if (typeof scheme !== 'string' || !SCHEME.test(scheme))
      throw new TypeError(
        `sources: ${JSON.stringify(scheme)} is not a scheme: lowercase, a letter then letters, digits, "+", "-" or ".", ending in ":", e.g. "media:"`,
      );
    if (NEVER.has(scheme)) throw new TypeError(`sources: ${scheme} is never a source of pictures`);
  }
  return Object.freeze([...new Set(sources)]);
}

/** Pictures drawn inside host may come from these schemes too; with none, from http(s) and data alone again. */
export function setPictureSources(host: Element, sources?: readonly string[]): void {
  if (sources === undefined) given.delete(host);
  else given.set(host, checkedSources(sources));
}

/** The schemes a picture drawn in element may come from besides http(s): those of the host it is drawn in. */
export function pictureSchemes(element: Element): readonly string[] {
  for (let at: Element | null = element; at; at = at.parentElement ?? (at.getRootNode() as ShadowRoot).host ?? null) {
    const sources = given.get(at);
    if (sources) return sources;
  }
  return [];
}
