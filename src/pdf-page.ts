// Pdf panels: a PDF, an attachment or a file in the working folder, in pdf.js (Mozilla's PDF reader, pinned and served
// by the page host at /lib/pdfjs-dist/), on a page of Vindu's own that the page host serves like any page the model
// writes: in the window's sandboxed frame, on the process's origin, never the window's. The page reads the PDF from that
// origin (/media/<id>, or /work/<path>) and fetches nothing else but pdf.js's own files there. Pages are drawn as they
// come into view, as wide as the pane, with "page n of m" above them. pdf.js parses in its own worker, a module worker
// from /lib (worker-src 'self'), which the frame's sandbox allows, as it keeps the page host's origin; where a worker
// cannot start, pdf.js parses on the page itself, from the same file. How far the person has read it goes to the window
// (task.read), never to the model. A file in the working folder is read again when it changes, at the page shown.
import { BLOCK_WORDS, type PdfWords } from './block-words.js';
import { escapeText, scriptJson } from './escape.js';

/** The largest PDF a pdf panel shows. */
export const PDF_MAX = 50_000_000;
/** What the page is given: where the PDF is on the process's origin, its name, and for a file in the working folder,
 *  its path there, to follow it as it changes. */
export type PdfSpec = { url: string; name: string; path?: string };
/** How the page says where the person is and why a PDF is not shown: the view's words, and the locale its numbers are
 *  written in (English and en-GB by default). */
type PdfSaying = { words?: PdfWords; locale?: string };

/** The page for a pdf panel. Everything it needs is in the page or on the process's own origin. */
export function pdfPage(spec: PdfSpec, { words = BLOCK_WORDS.pdf, locale = 'en-GB' }: PdfSaying = {}): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><title>${escapeText(spec.name)}</title>
<style>
html,body{margin:0;background:#e6e6e6;color:#1f1f1f;font:13px/1.4 system-ui,sans-serif}
@media (prefers-color-scheme:dark){html,body{background:#2a2a2a;color:#e6e6e6}#at{background:#1f1f1f}}
#at{position:sticky;top:0;z-index:1;padding:4px 12px;background:#f7f7f7;border-bottom:1px solid #0002;min-height:18px}
#pages{padding:8px 8px 16px}
.page{position:relative;margin:0 auto 8px;background:#fff;box-shadow:0 1px 3px #0003}
.page canvas{position:absolute;inset:0;width:100%;height:100%}
</style></head>
<body><div id="at" role="status">${escapeText(words.loading)}</div><div id="pages"></div>
<script>task.read(0); // the page says how far it is read itself, once its pages are laid out, and not its scroll before</script>
<script type="module">
import { getDocument, GlobalWorkerOptions, PasswordException } from '/lib/pdfjs-dist/build/pdf.min.mjs';
const spec = ${scriptJson(spec)};
const words = ${scriptJson(words)}, locale = ${scriptJson(locale)};
const lib = new URL('/lib/pdfjs-dist/', location.href).href;
GlobalWorkerOptions.workerSrc = lib + 'build/pdf.worker.min.mjs';
const at = document.getElementById('at'), list = document.getElementById('pages');
let doc, boxes = [], first = null, width = 0, shown = 0;
const drawing = new Map(); // a page drawn, or being drawn: its render task and the width it is drawn at
const say = text => { at.textContent = text; };
// the view's words, a slot's value put in it; a page's number as the locale writes it
const word = (w, values) => w.replace(/[{](\\w+)[}]/g, (slot, name) => values[name] ?? slot);
const count = new Intl.NumberFormat(locale), pageOf = (n, of) => word(words.page, { at: count.format(n), of: count.format(of) });

// a page is drawn once it comes near the view, at the width of the pane, and again when that width changes
const near = new IntersectionObserver(entries => { for (const e of entries) if (e.isIntersecting) draw(boxes.indexOf(e.target) + 1); }, { rootMargin: '100% 0px' });
async function draw(n) {
  const box = boxes[n - 1], w = list.clientWidth - 16;
  if (!box || !doc || drawing.get(n)?.width === w) return;
  drawing.get(n)?.task?.cancel();
  const mine = { width: w, task: null }; drawing.set(n, mine);
  try {
    const page = await doc.getPage(n), plain = page.getViewport({ scale: 1 });
    if (drawing.get(n) !== mine) return;
    const viewport = page.getViewport({ scale: w / plain.width });
    const ratio = Math.min(devicePixelRatio || 1, Math.sqrt(16e6 / (viewport.width * viewport.height)));
    box.style.aspectRatio = plain.width + ' / ' + plain.height;
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width * ratio); canvas.height = Math.floor(viewport.height * ratio);
    mine.task = page.render({ canvas, viewport, transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0] });
    await mine.task.promise;
    if (drawing.get(n) !== mine) return;
    box.replaceChildren(canvas);
    if (!document.body.dataset.ready) document.body.dataset.ready = '1';
    place();
  } catch (e) { if (e?.name !== 'RenderingCancelledException') console.warn('page ' + n + ': ' + String(e?.message || e)); }
}

// "page n of m": the page in the middle of the view; and how far the person has read it, as the window is told
let fitTimer;
function place() {
  if (!boxes.length) return;
  const middle = innerHeight / 2;
  shown = Math.max(1, boxes.findIndex(b => b.getBoundingClientRect().bottom > middle) + 1 || boxes.length);
  say(pageOf(shown, boxes.length));
  const r = list.getBoundingClientRect(), view = innerHeight - at.offsetHeight;
  if (r.height <= view + 1) { // all of it in view: read once it has been in view 2.5 s
    fitTimer ??= setTimeout(() => { fitTimer = undefined; if (list.getBoundingClientRect().height <= innerHeight - at.offsetHeight + 1 && document.visibilityState === 'visible') task.read(1); }, 2500);
    return;
  }
  task.read(Math.min(1, Math.max(0, (innerHeight - r.top) / r.height)));
}
addEventListener('scroll', place, { passive: true });
new ResizeObserver(() => { const w = list.clientWidth; if (w === width) return; width = w; for (const n of drawing.keys()) if (boxes[n - 1]?.getBoundingClientRect().bottom > -innerHeight && boxes[n - 1]?.getBoundingClientRect().top < 2 * innerHeight) draw(n); else drawing.delete(n); place(); }).observe(list);

// the PDF, opened; opened again when its file changes, at the page the person was at
async function open(keep) {
  let next;
  try {
    next = await getDocument({ url: spec.url, cMapUrl: lib + 'cmaps/', cMapPacked: true, standardFontDataUrl: lib + 'standard_fonts/', wasmUrl: lib + 'wasm/', iccUrl: lib + 'iccs/', enableXfa: false }).promise;
  } catch (e) {
    say(e instanceof PasswordException ? words.locked : word(words.unreadable, { why: String(e?.message || e) }));
    document.body.dataset.ready = 'failed';
    return;
  }
  const old = doc; doc = next; first = (await doc.getPage(1)).getViewport({ scale: 1 });
  for (const d of drawing.values()) d.task?.cancel();
  drawing.clear(); near.disconnect();
  boxes = Array.from({ length: doc.numPages }, (_, i) => {
    const box = document.createElement('div'); box.className = 'page';
    const named = pageOf(i + 1, doc.numPages);
    box.setAttribute('role', 'img'); box.setAttribute('aria-label', named.charAt(0).toUpperCase() + named.slice(1));
    box.style.aspectRatio = first.width + ' / ' + first.height; near.observe(box); return box;
  });
  list.replaceChildren(...boxes);
  document.body.dataset.pages = String(doc.numPages);
  if (keep > 1) boxes[Math.min(keep, boxes.length) - 1].scrollIntoView();
  place();
  void old?.loadingTask.destroy(); // the document read before, and its worker
}
await open(1);
if (spec.path) task.on('change', paths => { if (paths.includes('*') || paths.includes(spec.path)) void open(shown); });
</script></body></html>`;
}
