// Cards that draw something other than rows: media (a picture, a video or a recording, with marks on it), and the
// framed ones, each in a frame of its own: a page (a file in the working folder, or one the model wrote; a static one
// runs nothing), code and a diff (a file in Monaco, a page of Vindu's own), a PDF (in pdf.js, a page of Vindu's own
// too) and an MCP App. What each shows is read before any result. A gallery of many pictures is gallery.ts.
import { GUIDE, type CardName, type PanelSpec } from '../cards.js';
import { refOf, type Row } from '../results.js';
import { Refusal, type ViewContext } from '../view-context.js';
import { appOf, codeOf, mediaOf, pageOf, pdfOf } from '../view-files.js';
import { rowsOf } from '../view-rows.js';
import { drawnFrom, rowsAsTheyAre, type CardKind, type CardProbe } from './kind.js';

/** Marks on a picture (regions as fractions of its size) or a recording (times in seconds), each with a label: from a
 *  result, or typed. Checked here: a region must lie in the picture, a time must run forward. */
function marksOf(p: PanelSpec, ctx: ViewContext): Row[] {
  const m = p.marks as unknown;
  let rows: Row[];
  if (typeof m === 'string') {
    const e = ctx.results.get(m);
    if (!e) throw new Refusal(`panel ${p.id}: marks: no result "${m}"`);
    rows = rowsOf(e, { ...p, card: 'table', pick: undefined }, []).rows;
  } else if (Array.isArray(m)) rows = m as Row[];
  else throw new Refusal(`panel ${p.id}: marks are a result id or a list of marks`);
  const bad = rows
    .map((r, i) => {
      const n = (k: string) => Number(r[k]);
      if ('x' in r || 'y' in r) {
        const [x, y, w, h] = ['x', 'y', 'w', 'h'].map(n);
        return [x, y, w ?? 0, h ?? 0].every(Number.isFinite) &&
          x >= 0 &&
          y >= 0 &&
          x + (w || 0) <= 1.0001 &&
          y + (h || 0) <= 1.0001
          ? null
          : `mark ${i + 1}: x, y, w, h are fractions of the picture (0 to 1)`;
      }
      if ('start' in r) {
        const a = n('start'),
          b = 'end' in r ? n('end') : a;
        return Number.isFinite(a) && Number.isFinite(b) && b >= a && a >= 0
          ? null
          : `mark ${i + 1}: start and end are seconds, start first`;
      }
      return `mark ${i + 1}: a region (x, y, w, h) or a time (start, end)`;
    })
    .filter(Boolean);
  if (bad.length) throw new Refusal(`panel ${p.id}: ${bad.slice(0, 3).join('; ')}`);
  return rows.slice(0, 200);
}

export const MEDIA: CardKind = {
  reads: GUIDE.media.fields,
  typed: false,
  origin: 'attachment',
  noGroup: rowsAsTheyAre,
  own: (p, _view, ctx) => ({ media: mediaOf(p, ctx), ...(p.marks ? { marks: marksOf(p, ctx) } : {}) }),
  draw: (p, d, k) => {
    const media = drawnFrom(p, d, 'media');
    k.model.url = media.url;
    const kind = media.mime.split('/')[0];
    const url = { path: `/panels/${k.pid}/url` };
    if (d.marks?.length) {
      k.model.marks = d.marks;
      return [
        k.add({
          id: `${k.pid}__marked`,
          component: 'VMediaMarks',
          url,
          kind,
          marks: { path: `/panels/${k.pid}/marks` },
          panel: p.id,
        }),
      ];
    }
    let component = 'Image'; // A2UI's own: a video, a sound or a picture
    if (kind === 'video') component = 'Video';
    else if (kind === 'audio') component = 'AudioPlayer';
    return [k.add({ id: `${k.pid}__media`, component, url, ...(kind === 'image' ? { fit: 'contain' } : {}) })];
  },
  account: (o, _p, d) => {
    o.shows = `${d.media!.mime.split('/')[0]} ${d.media!.name}`;
  },
};

/** A frame's height: its own, or shorter on a narrow window. */
const frameHeight = (height: number, compact: boolean) => (compact ? Math.min(height, 560) : height);
/** Whether its frame loaded and how big it is, read back by the window. */
const frameProbe = (p: PanelSpec, _d: unknown, _m: unknown, pid: string): CardProbe[] => [
  { component: `${pid}__${p.card}`, expect: '', panel: p.id, frame: true },
];
const framed = { typed: false, framed: true, noGroup: rowsAsTheyAre, probes: frameProbe } as const;

export const PAGE: CardKind = {
  // a web page in a frame of its own origin; a static one in a frame where nothing runs
  ...framed,
  reads: GUIDE.page.fields,
  own: (p, view, ctx) => ({ page: pageOf(p, view, ctx) }),
  draw: (p, d, k) => {
    const page = drawnFrom(p, d, 'page');
    k.model.url = page.url;
    return [
      k.add({
        id: `${k.pid}__page`,
        component: 'Page',
        url: { path: `/panels/${k.pid}/url` },
        height: frameHeight(page.height, k.compact),
        title: p.title ?? 'page',
        panel: p.id,
        ...(page.static ? { static: true } : {}),
      }),
    ];
  },
  account: (o, _p, d) => {
    o.from = d.page!.label;
    if (d.page!.uses.length) o.uses = d.page!.uses;
    if (d.page!.static)
      o.static =
        'nothing runs in it: no script, no task API and no data, and it does not reload as its files change; its images, styles, media and fonts load. Its check says only that it loaded, and its size';
  },
};
const file = (name: CardName, shows: string, against = false): CardKind => ({
  // a file in Monaco: a page of Vindu's own, on the process's origin
  ...framed,
  reads: GUIDE[name].fields,
  own: (p, view, ctx) => codeOf(p, view, ctx, against),
  draw: (p, d, k) => {
    const page = drawnFrom(p, d, 'page'),
      code = drawnFrom(p, d, 'code');
    k.model.url = page.url;
    return [
      k.add({
        id: `${k.pid}__${p.card}`,
        component: 'Page',
        url: { path: `/panels/${k.pid}/url` },
        height: frameHeight(page.height, k.compact),
        title: p.title ?? code.path,
        panel: p.id,
      }),
    ];
  },
  account: (o, _p, d) => {
    o.from = d.page!.label;
    o.seen = 'the file itself';
    Object.assign(o, d.code);
    o.shows = shows;
  },
});
export const CODE = file('code', 'the file, read-only; it follows the file as it changes');
export const DIFF = file(
  'diff',
  'the file now against the last commit, side by side, read-only; it follows the file as it changes',
  true,
);
export const PDF: CardKind = {
  // a PDF in pdf.js: a page of Vindu's own, on the process's origin
  ...framed,
  reads: GUIDE.pdf.fields,
  own: (p, view, ctx) => pdfOf(p, view, ctx),
  draw: (p, d, k) => {
    const page = drawnFrom(p, d, 'page'),
      pdf = drawnFrom(p, d, 'pdf');
    k.model.url = page.url;
    return [
      k.add({
        id: `${k.pid}__pdf`,
        component: 'Page',
        url: { path: `/panels/${k.pid}/url` },
        height: frameHeight(page.height, k.compact),
        title: p.title ?? pdf.name,
        panel: p.id,
      }),
    ];
  },
  account: (o, _p, d) => {
    o.from = d.page!.label;
    o.seen = 'the file itself';
    o.file = { name: d.pdf!.name, bytes: d.pdf!.bytes };
    o.shows = 'the PDF inline, in its own viewer in the window: the person sees it page by page, as wide as the pane';
  },
};
export const APP: CardKind = {
  // an MCP App, in a frame of its own origin, talking to the host over postMessage
  ...framed,
  reads: GUIDE.app.fields,
  own: (p, _view, ctx) => ({ app: appOf(p, ctx) }),
  draw: (p, d, k) => {
    const app = drawnFrom(p, d, 'app');
    k.model.url = app.url;
    return [
      k.add({
        id: `${k.pid}__app`,
        component: 'McpApp',
        resource: new URL(app.url).hostname,
        url: { path: `/panels/${k.pid}/url` },
        height: frameHeight(app.height, k.compact),
        title: p.title ?? app.uri,
        panel: p.id,
      }),
    ];
  },
  account: (o, p, d) => {
    o.app = d.app!.uri;
    o.server = d.app!.server;
    o.seen =
      'opaque: the app draws itself; what it is sent is exact (the result, by reference), what it draws is not known';
    o.ref = refOf(p.from!);
  },
};
