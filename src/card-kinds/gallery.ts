// A gallery: many pictures and videos at once, each one as media takes it (an attachment, a result's image, a file in
// the working folder), at most GALLERY_MOST. Every item is found before anything is shown, and each one that is not a
// picture or a video is refused with its own reason. The window draws them as tiles and opens any one large
// (renderer/blocks/gallery.ts); the account says how many there are and their names.
import { countIds, GALLERY_MOST, GUIDE, resultIds, type GalleryItem, type PanelSpec } from '../cards.js';
import { Refusal, type ViewContext } from '../view-context.js';
import { findMedia, mediaHad } from '../view-files.js';
import { drawnFrom, rowsAsTheyAre, type CardKind } from './kind.js';

/** What an item is, in a word: image or video. */
const kindOf = (item: GalleryItem) => item.mime.split('/')[0];
/** At most this many reasons in a refusal, then how many more there are. */
const REASONS = 8;
/** What a gallery shows, in words, for an item that is something else. */
const SHOWS = 'a gallery shows pictures and videos';

/** The gallery's items, in the order the panel lists them (a run of result ids, r5-r12, as each of its ids). */
function galleryOf(p: PanelSpec, ctx: ViewContext): GalleryItem[] {
  const given = p.media === undefined ? [] : [p.media].flat().map(String); // one item alone is a list of one
  if (!given.length) throw new Refusal(`panel ${p.id}: a gallery needs "media": a list of attachment ids, result ids that hold an image, or files in the working folder`);
  if (!ctx.pages) throw new Refusal(`panel ${p.id}: this host shows no media`);
  let wants: string[];
  try { wants = resultIds(given, GALLERY_MOST); } catch { throw new Refusal(`panel ${p.id}: ${countIds(given)} items: a gallery shows at most ${GALLERY_MOST}; show the rest in another gallery`); }
  const items: GalleryItem[] = [], bad: string[] = [];
  for (const [i, want] of wants.entries()) {
    const found = findMedia(want, ctx, SHOWS);
    if ('why' in found) bad.push(`item ${i + 1}: ${found.why}`);
    else if (kindOf(found) === 'image' || kindOf(found) === 'video') items.push(found);
    else bad.push(`item ${i + 1}: ${found.name} is ${kindOf(found)}; ${SHOWS}: play it with a media panel ("media": "${want}")`);
  }
  if (bad.length) {
    const more = bad.length > REASONS ? `; and ${bad.length - REASONS} more` : '';
    throw new Refusal(`panel ${p.id}: ${bad.length} of the ${wants.length} items cannot be shown in a gallery: ${bad.slice(0, REASONS).join('; ')}${more}. Media the task has: ${mediaHad(ctx)}`);
  }
  return items;
}

export const GALLERY: CardKind = {
  reads: GUIDE.gallery.fields, typed: false, origin: 'media', noGroup: rowsAsTheyAre,
  own: (p, _view, ctx) => ({ gallery: galleryOf(p, ctx) }),
  draw: (p, d, k) => {
    const items = drawnFrom(p, d, 'gallery');
    // each item with where it is of how many, in the view's words; and the words of the overlay that shows one large
    k.model.items = items.map((item, i) => ({ name: item.name, kind: kindOf(item), url: item.url, at: k.words.itemOf(i + 1, items.length) }));
    k.model.words = { previous: k.words.previous, next: k.words.next, close: k.words.close };
    return [k.add({ id: `${k.pid}__gallery`, component: 'VGallery', items: { path: `/panels/${k.pid}/items` }, words: { path: `/panels/${k.pid}/words` }, panel: p.id })];
  },
  account: (o, _p, d) => {
    const items = d.gallery!, videos = items.filter(item => kindOf(item) === 'video').length, images = items.length - videos;
    const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
    o.from = [...new Set(items.map(item => item.from))].join(', ');
    o.seen = 'the files themselves, served by the system';
    o.shows = `${count(items.length, 'item')}: ${[images ? count(images, 'image') : '', videos ? count(videos, 'video') : ''].filter(Boolean).join(', ')}`;
    o.items = items.map(item => item.name);
    o.opens = 'the person opens any one large, over the pane, and steps through them there, without you';
  },
};
