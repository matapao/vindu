import { createHash } from 'node:crypto';
import path from 'node:path';
import type { CardFile, CardFileRead, GalleryItem, PanelSpec, Resolved, ViewSpec } from './cards.js';
import { codePage, languageOf, type CodeSpec } from './code.js';
import { extensionOf, MEDIA_EXTENSIONS, typeOfFile } from './file-types.js';
import { href, STATIC_QUERY } from './page-workspace.js';
import type { Entry, Row } from './results.js';
import { readTextStart, type TextStart } from './text-start.js';
import { Refusal, listing, type ViewContext } from './view-context.js';

/** The type of a media file, by its extension: an image, video or audio file; undefined for any other. */
const mediaType = (name: string) => (MEDIA_EXTENSIONS.includes(extensionOf(name)) ? typeOfFile(name) : undefined);
/** A frame's height in pixels: the panel's own, or the card's default, kept between 120 and 2000. */
const heightOf = (p: PanelSpec, fallback = 480) => Math.min(Math.max(p.height ?? fallback, 120), 2000);

/** Any image, video or audio the process has, as a panel names it: an attachment (by its id or its name), an image a
 *  result returned, or a file in the working folder; or why there is none. shows: what the card shows, in words, for an
 *  attachment that is something else. Served by the page host. */
export function findMedia(want: string, ctx: ViewContext, shows: string): GalleryItem | { why: string } {
  const { results, pages } = ctx;
  if (!pages) return { why: 'this host shows no media' };
  const url = (id: string) => `${pages.base}/media/${id}`; // http(s), the only media URLs an A2UI renderer loads
  const e = results.get(want) ?? results.all().find(x => x.kind === 'attachment' && x.name.toLowerCase() === path.basename(want).toLowerCase());
  if (e?.kind === 'attachment') {
    if (!/^(image|video|audio)\//.test(e.mime)) return { why: `${e.name} is ${e.mime}; ${shows}${e.mime.startsWith('text/') ? ` (show it with a text panel, "from": "${e.id}")` : ''}` };
    return { name: e.name, mime: e.mime, url: url(e.id), from: e.id };
  }
  if (e?.kind === 'result' && e.images.length) return { name: `${e.id} image`, mime: e.images[0].mime, url: url(e.id), from: e.id };
  if (e?.kind === 'result') return { why: `${e.id} holds no image: show it with a table or another card of rows` };
  const ext = extensionOf(want), mime = mediaType(want);
  const file = mime ? pages.workAny?.(want) : null;
  if (file && mime) return { name: path.basename(file), mime, url: `${pages.base}/work/${href(file)}`, from: `work/${file}` };
  if (mime) { const hit = results.all().find(x => x.kind === 'result' && x.images.length && JSON.stringify(x.input ?? '').includes(path.basename(want))); if (hit?.kind === 'result') return { name: path.basename(want), mime: hit.images[0].mime, url: url(hit.id), from: hit.id }; }
  let why = '';
  if (mime) why = ': no such file in the working folder';
  else if (ext) why = `: .${ext} is not an image, video or audio file (${MEDIA_EXTENSIONS.join(', ')})`;
  return { why: `nothing to show as "${want}"${why}` };
}
/** The media the process has, by id, for a refusal: its attachments and the results that hold an image. */
export const mediaHad = (ctx: ViewContext) =>
  ctx.results.all().filter(x => x.kind === 'attachment' || (x.kind === 'result' && x.images.length)).map(x => x.id).join(', ') || 'none';
/** The one image, video or audio a media panel shows (findMedia). */
export function mediaOf(p: PanelSpec, ctx: ViewContext): NonNullable<Resolved['media']> {
  if (!ctx.pages) throw new Refusal(`panel ${p.id}: this host shows no media`);
  if (Array.isArray(p.media)) throw new Refusal(`panel ${p.id}: media shows one item; for ${p.media.length} at once, send card "gallery" with the same list`);
  const found = findMedia(String(p.media ?? p.from ?? ''), ctx, 'media shows images, video and audio');
  if ('why' in found) throw new Refusal(`panel ${p.id}: ${found.why}; media the task has: ${mediaHad(ctx)}`);
  return { name: found.name, mime: found.mime, url: found.url };
}

/** A path with what may follow it in an address: "game/index.html?level=2#start" → the file, and "?level=2", "#start". */
export function splitPath(p: string): { file: string; query: string; hash: string } {
  const h = p.indexOf('#'), beforeHash = h >= 0 ? p.slice(0, h) : p, q = beforeHash.indexOf('?');
  return { file: q >= 0 ? beforeHash.slice(0, q) : beforeHash, query: q >= 0 ? beforeHash.slice(q + 1) : '', hash: h >= 0 ? p.slice(h) : '' };
}
/** An address on the page host: a path, its own query and the uses Vindu adds, then its hash. */
export const pageUrl = (base: string, query: string, uses: string[], hash = '') => {
  const q = [query, uses.length ? `uses=${uses.map(encodeURIComponent).join(',')}` : ''].filter(Boolean).join('&');
  return `${base}${q ? `${base.includes('?') ? '&' : '?'}${q}` : ''}${hash}`;
};
/** A static page's address: on the process's own origin, with its own query and STATIC_QUERY, then its hash. Its frame
 *  runs none of it, and neither does the policy it is served under. */
const staticUrl = (base: string, query = '', hash = '') => pageUrl(base, query ? `${query}&${STATIC_QUERY}` : STATIC_QUERY, [], hash);

/** The name of the file a panel's page is written to: its view's name and its id, letters, digits and dashes as they are
 *  and every other character as _ and its code (sales_q1 is sales_005fq1), joined by __, which neither holds; so two
 *  panels never share a file. A name longer than a page host keeps (120) ends in a digest of the whole of it instead. */
export function pageName(view: string, panel: string): string {
  const part = (s: string) => s.replace(/[^A-Za-z0-9-]/g, c => `_${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  const name = `p_${part(view)}__${part(panel)}`;
  return name.length <= 120 ? name : `${name.slice(0, 101)}_${createHash('sha256').update(name).digest('hex').slice(0, 18)}`;
}

/** A web page: a file in the working folder (live), or a page the model wrote. Data reaches it by id, exact. A static
 *  page runs nothing and reads no data: it is served as it is written, from the process's own origin. */
export function pageOf(p: PanelSpec, view: ViewSpec, ctx: ViewContext): NonNullable<Resolved['page']> {
  const pages = ctx.pages;
  if (!pages) throw new Refusal(`panel ${p.id}: this host shows no pages`);
  if (p.path && p.html) throw new Refusal(`panel ${p.id}: a page shows "path" (a file in the working folder) or "html" (a page you write), not both`);
  const uses = [...new Set([...(p.from ? [p.from] : []), ...(p.uses ?? [])])];
  if (p.static && uses.length) throw new Refusal(`panel ${p.id}: a static page runs nothing, so it reads no data: leave out ${p.from ? '"from" and ' : ''}"uses" (${uses.join(', ')}), or leave out "static" for a page that runs and reads them`);
  const unknown = uses.filter(id => ctx.results.get(id)?.kind !== 'result');
  if (unknown.length) throw new Refusal(`panel ${p.id}: no result ${unknown.map(x => `"${x}"`).join(', ')} to give the page. This task has: ${listing(ctx.results)}`);
  const height = heightOf(p), still = p.static ? { static: true as const } : {};
  if (p.path) {
    const at = splitPath(p.path), rel = pages.workFile(at.file);
    if (!rel) throw new Refusal(`panel ${p.id}: no page "${at.file}" in the working folder; pages there: ${pages.workPages().slice(0, 12).join(', ') || 'none'}`);
    const url = p.static ? staticUrl(`${pages.base}/work/${href(rel)}`, at.query, at.hash) : pages.workUrl(rel, at.query, uses, at.hash);
    return { url, label: `work/${rel}${at.query ? `?${at.query}` : ''}${at.hash}`, uses, height, ...still };
  }
  if (typeof p.html === 'string' && p.html.trim()) {
    const file = pages.writeView(pageName(view.name, p.id), p.html); // e.g. p_sales__chart.html?v=2
    const url = p.static ? staticUrl(`${pages.base}/view/${file}`) : pageUrl(`${pages.base}/view/${file}`, '', uses);
    return { url, label: p.static ? 'a static page you wrote' : 'a page you wrote', uses, height, ...still };
  }
  throw new Refusal(`panel ${p.id}: a page needs "path" (a file in the working folder, such as index.html) or "html" (a page you write)`);
}

/** A file as code, or what changed in it since the last commit (against): a page of Vindu's own, with Monaco, live. */
export function codeOf(p: PanelSpec, view: ViewSpec, ctx: ViewContext, against = false): Resolved {
  const pages = ctx.pages;
  if (!pages?.workText || !pages.headText) throw new Refusal(`panel ${p.id}: this host shows no files`);
  if (!p.path) throw new Refusal(`panel ${p.id}: a ${p.card} panel needs "path": a file in the working folder, e.g. "src/app.ts"`);
  const f = pages.workText(splitPath(p.path).file);
  if ('why' in f) throw new Refusal(`panel ${p.id}: ${f.why}`);
  const language = languageOf(f.rel), lines = f.text ? f.text.split('\n').length - (f.text.endsWith('\n') ? 1 : 0) : 0;
  const height = heightOf(p);
  let spec: CodeSpec = { path: f.rel, language }, code: NonNullable<Resolved['code']> = { path: f.rel, language, lines };
  if (against) {
    const head = pages.headText(f.rel);
    if ('why' in head) throw new Refusal(`panel ${p.id}: ${head.why}`);
    spec = { ...spec, original: head.text, against: head.commit };
    code = { ...code, against: `HEAD (${head.commit})`, added: head.added, removed: head.removed, ...(head.new ? { new: true } : {}) };
  } else if (p.line !== undefined) {
    if (p.line > Math.max(lines, 1)) throw new Refusal(`panel ${p.id}: "${f.rel}" has ${lines} lines, so there is no line ${p.line}`);
    spec = { ...spec, line: p.line }; code = { ...code, line: p.line };
  }
  const file = pages.writeView(pageName(view.name, p.id), codePage(spec));
  return { page: { url: pageUrl(`${pages.base}/view/${file}`, '', []), label: `work/${f.rel}`, uses: [], height }, code };
}

/** An MCP App's own UI for a result: only for a connection the host turned MCP Apps on for, and only for a tool that
 *  links a ui:// resource. What it draws is its own (the account says so); what it is sent is exact. */
export function appOf(p: PanelSpec, ctx: ViewContext): NonNullable<Resolved['app']> {
  const apps = ctx.apps;
  if (!apps) throw new Refusal(`panel ${p.id}: this host shows no MCP Apps; show the result with the cards`);
  const e = p.from ? ctx.results.get(p.from) : undefined;
  if (!e || e.kind !== 'result') throw new Refusal(`panel ${p.id}: an app panel needs "from": a result of a tool that has an MCP App`);
  if (!apps.allowed(e.server)) throw new Refusal(`panel ${p.id}: MCP Apps are off for "${e.server}" here; show ${e.id} with the cards`);
  const uri = apps.resourceOf(e.server, e.tool);
  if (!uri) throw new Refusal(`panel ${p.id}: ${e.server}.${e.tool} has no MCP App (its tool links no ui:// resource); show ${e.id} with the cards`);
  return { server: e.server, tool: e.tool, result: e.id, uri, url: apps.frame(e.server, uri, e.id), height: heightOf(p, 420) };
}

/** What else an attachment can be shown with, for a refusal: media for a picture or a recording, text for other text. */
function otherwise(mime: string, attachment: string): string {
  if (/^(image|video|audio)\//.test(mime)) return `; show it with a media panel ("media": "${attachment}")`;
  return mime.startsWith('text/') ? `; show it with a text panel ("from": "${attachment}")` : '';
}
/** A file a card shows as it is (CardFile), read by the system: the attachment from names, or path, a file in the
 *  working folder; at most how.most bytes of it. Undefined when the panel names neither, and its rows come as any do. */
export function cardFileOf(p: PanelSpec, e: Entry | undefined, ctx: ViewContext, how: CardFile): { rows: Row[]; file: CardFileRead } | undefined {
  if (!p.path && e?.kind !== 'attachment') return undefined;
  if (p.path && p.from) throw new Refusal(`panel ${p.id}: a ${p.card} shows "from" (an attachment) or "path" (a file in the working folder), not both`);
  let read: { name: string; from: string } & TextStart;
  if (e?.kind === 'attachment') {
    if (!how.takes(e.name, e.mime)) throw new Refusal(`panel ${p.id}: ${e.id} is ${e.name} (${e.mime}); a ${p.card} shows ${how.kinds}${otherwise(e.mime, e.id)}`);
    let start: TextStart | null;
    try { start = readTextStart(e.file, how.most); } catch { throw new Refusal(`panel ${p.id}: ${e.id} (${e.name}) could not be read`); }
    if (!start) throw new Refusal(`panel ${p.id}: ${e.name} is not text`);
    read = { name: e.name, from: e.id, ...start };
  } else {
    const rel = splitPath(p.path!).file;
    if (!how.takes(rel)) throw new Refusal(`panel ${p.id}: "${rel}" is not a file a ${p.card} shows: it shows ${how.kinds}; show another file with a code panel`);
    if (!ctx.pages?.workStart) throw new Refusal(`panel ${p.id}: this host shows no files`);
    const f = ctx.pages.workStart(rel, how.most);
    if ('why' in f) throw new Refusal(`panel ${p.id}: ${f.why}`);
    if (!how.takes(f.rel)) throw new Refusal(`panel ${p.id}: "${rel}" is a folder, and ${p.card} panels show files: ${how.kinds}`); // its index.html
    read = { ...f, name: path.basename(f.rel), from: `work/${f.rel}` };
  }
  if (!read.text.trim()) throw new Refusal(`panel ${p.id}: ${read.name} is empty, so there is nothing to show`);
  let made: ReturnType<CardFile['rows']>;
  try { made = how.rows(read.text, p); } catch (x) { throw new Refusal(`panel ${p.id}: ${(x as Error).message}`); }
  const cut = [read.bytes < read.size ? `the first ${read.bytes} of its ${read.size} bytes` : '', made.cut ?? ''].filter(Boolean).join('; ');
  return { rows: made.rows, file: { from: read.from, name: read.name, bytes: read.bytes, size: read.size, ...(cut ? { cut } : {}) } };
}
