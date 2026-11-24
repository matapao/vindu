// Where the page host puts its tags in a page: the import map and the boot script, first. Nothing else here.
import { scriptJson } from './escape.js';
import { IMPORT_MAP } from './page-libraries.js';

/** First thing in every page: the import map, then the boot script (the data it uses, the hooks a page check reads,
 *  live reload, WebRTC taken away). Both go before the page's first element, after only what runs nothing (white
 *  space, comments, the doctype), so nothing of the page runs before them, whatever its markup says: a "<head>" in a
 *  comment, or a script before its own <head>, cannot. They go on the doctype's line, so the page's own line numbers
 *  stay as written. A fragment (no doctype, no <html>, <head> or <body>) gets a doctype as well. */
export function inject(html: string, uses: string[], live: boolean, imports: Record<string, string> = IMPORT_MAP): string {
  const q = new URLSearchParams({ ...(uses.length ? { uses: uses.join(',') } : {}), ...(live ? { live: '1' } : {}) }).toString();
  const tags = `<script type="importmap">${scriptJson({ imports })}</script><script src="/__vindu/boot.js${q ? `?${q}` : ''}"></script>`;
  const { at, doctype } = prolog(html), rest = html.slice(at);
  if (doctype || /<(?:html|head|body)(?=[\s>/])/i.test(rest)) return html.slice(0, at) + tags + rest;
  return `${html.slice(0, at)}<!doctype html><head><meta charset="utf-8">${tags}</head>${rest}`;
}
/** Where a page's first element may start: after a byte order mark, white space, comments (ended as the HTML parser
 *  ends them: "-->", "--!>", and "<!-->" or "<!--->" at once), bogus comments ("<?…>", "<!…>") and the doctype. A
 *  comment never ended holds the rest of the page, which then runs nothing. */
function prolog(html: string): { at: number; doctype: boolean } {
  let at = html.startsWith('\uFEFF') ? 1 : 0;
  for (;;) {
    while (at < html.length && '\t\n\f\r '.includes(html[at])) at++;
    if (html.startsWith('<!--', at)) {
      const short = ['<!-->', '<!--->'].find(c => html.startsWith(c, at));
      if (short) { at += short.length; continue; }
      const ends = [html.indexOf('-->', at + 4), html.indexOf('--!>', at + 4)].filter(i => i >= 0);
      if (!ends.length) return { at: html.length, doctype: false };
      const end = Math.min(...ends); at = end + (html.startsWith('-->', end) ? 3 : 4);
    } else if (html.startsWith('<?', at) || (html.startsWith('<!', at) && !/^<!doctype/i.test(html.slice(at, at + 9)))) {
      const end = html.indexOf('>', at + 2);
      if (end < 0) return { at: html.length, doctype: false };
      at = end + 1;
    } else break;
  }
  const doctype = /^<!doctype[^>]*>/i.exec(html.slice(at, at + 1024));
  return doctype ? { at: at + doctype[0].length, doctype: true } : { at, doctype: false };
}
