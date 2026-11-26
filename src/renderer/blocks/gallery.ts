// A gallery in the window: square tiles, each with its name under it and marked with data-panel and data-row, so that
// pointing and sight find it by reference. Pictures load as they come near sight; videos are muted and still. A click,
// or Enter or Space on a tile, shows it large over its pane, in a modal dialog with Previous and Next and where it is of
// how many: Escape goes back to its tile, and focus stays in the dialog while it is open.
import { html, nothing } from 'lit';
import { keyed } from 'lit/directives/keyed.js';
import { VIEW_WORDS } from '../../view-words.js';
import { defineComponent } from '../define.js';
import { pictureSchemes } from '../picture-sources.js';
import { imageSource } from './shared.js';

type Item = { name?: unknown; kind?: unknown; url?: unknown; at?: unknown };
type Words = { previous: string; next: string; close: string };
/** The element a gallery draws in: A2UI's Lit element, which draws again when asked. */
type GalleryElement = HTMLElement & { requestUpdate(): void; updateComplete: Promise<unknown> };

/** The item each gallery shows large, by its element: none while its dialog is closed. */
const shownAt = new WeakMap<HTMLElement, number>();

/** The words it draws: the view's, where the surface gives them, and English for each one it does not. */
function wordsOf(given: unknown): Words {
  const words = (given && typeof given === 'object' ? given : {}) as Record<string, unknown>;
  const word = (name: keyof Words) => (typeof words[name] === 'string' ? words[name] : VIEW_WORDS[name]);
  return { previous: word('previous'), next: word('next'), close: word('close') };
}
const nameOf = (item: Item) => (typeof item.name === 'string' ? item.name : '');
/** Where an item loads from: http or https, and for a picture the host's own schemes and an image's data: URL too
 *  (imageSource). */
const sourceOf = (item: Item, schemes: readonly string[]) =>
  item.kind === 'video' ? imageSource(item.url, /^$/) : imageSource(item.url, undefined, schemes);
const dialogOf = (element: HTMLElement) => element.querySelector<HTMLDialogElement>('dialog.vb-viewer');

/** The dialog over the pane the gallery is in, or over the whole window outside a shell's pane. */
function place(element: HTMLElement, dialog: HTMLDialogElement) {
  const win = element.ownerDocument.defaultView!;
  const box = element.closest('.vindu-pane')?.getBoundingClientRect() ?? {
    left: 0,
    top: 0,
    width: win.innerWidth,
    height: win.innerHeight,
  };
  Object.assign(dialog.style, {
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
  });
}

/** Show an item large: the dialog drawn with it, then opened over the pane, kept there as the window is resized until
 *  it closes, or goes with its gallery (a view drawn anew). */
async function open(element: GalleryElement, index: number) {
  shownAt.set(element, index);
  element.requestUpdate();
  await element.updateComplete;
  const dialog = dialogOf(element);
  if (!dialog || dialog.open) return;
  const win = element.ownerDocument.defaultView!;
  const follow = () => {
    if (dialog.isConnected) place(element, dialog);
    else win.removeEventListener('resize', follow);
  };
  follow();
  win.addEventListener('resize', follow);
  dialog.addEventListener('close', () => win.removeEventListener('resize', follow), { once: true });
  dialog.showModal();
}

/** The item before or after the one shown large, going round from the last to the first. */
function step(element: GalleryElement, by: number, count: number) {
  const at = shownAt.get(element);
  if (at === undefined) return;
  shownAt.set(element, (at + by + count) % count);
  element.requestUpdate();
}

/** A dialog shut by the gallery: the item it showed, and where the browser put focus as it closed. */
const shutting = new WeakMap<HTMLDialogElement, { at: number | undefined; focus: Element | null }>();
const focusTile = (element: GalleryElement, at: number) =>
  element.querySelector<HTMLElement>(`.vb-tile[data-row="${at}"]`)?.focus();

/** Close a dialog: nothing is shown large from now on, before its close is heard, so an item opened in between stays. */
function shut(element: GalleryElement, dialog: HTMLDialogElement) {
  const at = shownAt.get(element);
  shownAt.delete(element);
  dialog.close();
  shutting.set(dialog, { at, focus: dialog.ownerDocument.activeElement });
  element.requestUpdate();
}

/** Its close heard, a moment after: focus on the tile of the item that was shown, unless the person has moved focus on
 *  since, or opened another item already. A dialog closed another way is let go here as it is closed. */
function closed(element: GalleryElement, dialog: HTMLDialogElement) {
  const was = shutting.get(dialog);
  shutting.delete(dialog);
  if (!was) {
    const at = shownAt.get(element);
    shownAt.delete(element);
    element.requestUpdate();
    if (at !== undefined) focusTile(element, at);
    return;
  }
  const doc = element.ownerDocument;
  const stayed = doc.activeElement === was.focus || doc.activeElement === doc.body;
  if (!shownAt.has(element) && was.at !== undefined && stayed) focusTile(element, was.at);
}

/** Keys in the dialog: Escape goes back, the arrows step (but in a video, whose own they are), and Tab goes round its
 *  buttons and video, never out of it. None of them reaches the shell, whose own Escape would act too. */
function onKey(element: GalleryElement, e: KeyboardEvent, count: number) {
  const dialog = e.currentTarget as HTMLDialogElement;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    shut(element, dialog);
    return;
  }
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !(e.target as Element).closest('video')) {
    e.preventDefault();
    e.stopPropagation();
    step(element, e.key === 'ArrowLeft' ? -1 : 1, count);
    return;
  }
  if (e.key !== 'Tab') return;
  const stops = [...dialog.querySelectorAll<HTMLElement>('button, video[controls]')];
  const now = element.ownerDocument.activeElement,
    first = stops[0],
    last = stops.at(-1);
  if (!first || !last) return;
  const outside = !dialog.contains(now);
  if (e.shiftKey && (now === first || outside)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (now === last || outside)) {
    e.preventDefault();
    first.focus();
  }
}

/** A tile's picture: an image that loads as it comes near sight, or a video's first frame, muted and still. */
const thumbOf = (item: Item, schemes: readonly string[]) =>
  item.kind === 'video'
    ? html`<span class="vb-thumb"><video src=${sourceOf(item, schemes)} muted .muted=${true} preload="metadata" playsinline tabindex="-1" aria-hidden="true"></video><span class="vb-play" aria-hidden="true">▶</span></span>`
    : html`<span class="vb-thumb"><img src=${sourceOf(item, schemes)} alt="" loading="lazy" decoding="async"></span>`;

/** The item shown large: where it is of how many, its name and the way back; it, marked as its tile is; and the steps. */
function viewer(element: GalleryElement, item: Item, at: number, count: number, words: Words, panel: string) {
  const src = sourceOf(item, pictureSchemes(element)),
    name = nameOf(item);
  const close = (e: Event) => {
    const dialog = (e.currentTarget as HTMLElement).closest('dialog');
    if (dialog) shut(element, dialog);
  };
  const media =
    item.kind === 'video' ? html`<video src=${src} controls playsinline></video>` : html`<img src=${src} alt=${name}>`;
  return html`<div class="vb-viewerbar"><span class="vb-viewerat" aria-live="polite">${
    typeof item.at === 'string' ? item.at : VIEW_WORDS.itemOf(at + 1, count)
  }</span><span class="vb-viewername">${name}</span><button type="button" class="vb-btn" @click=${close}>${words.close}</button></div>
<div class="vb-stage" data-panel=${panel} data-row=${String(at)}>${keyed(src, media)}</div>${
    count > 1
      ? html`<div class="vb-nav"><button type="button" class="vb-btn" @click=${() => step(element, -1, count)}>${
          words.previous
        }</button><button type="button" class="vb-btn" @click=${() => step(element, 1, count)}>${words.next}</button></div>`
      : nothing
  }`;
}

export const VGallery = defineComponent({
  name: 'VGallery',
  tag: 'vindu-gallery',
  props: { items: 'value', words: 'value', panel: 'string' },
  render: (props: Record<string, unknown>, element: HTMLElement) => {
    const items = (Array.isArray(props.items) ? props.items : []) as Item[];
    if (!items.length) return nothing;
    const host = element as GalleryElement,
      words = wordsOf(props.words),
      panel = typeof props.panel === 'string' ? props.panel : '';
    const at = shownAt.get(host),
      index = at === undefined ? undefined : Math.min(at, items.length - 1);
    const schemes = pictureSchemes(host);
    const tile = (item: Item, i: number) =>
      html`<li><button type="button" class="vb-tile" data-panel=${panel} data-row=${String(i)} @click=${(
        e: MouseEvent,
      ) => {
        if (!e.altKey) void open(host, i); // Alt and a click marks it, as any row: pointing's, not an opening
      }}>${thumbOf(item, schemes)}<span class="vb-tilename">${nameOf(item)}</span></button></li>`;
    return html`<ul class="vb-gallery">${items.map(tile)}</ul><dialog class="vb-viewer" aria-label=${index === undefined ? nothing : nameOf(items[index])}
      @keydown=${(e: KeyboardEvent) => onKey(host, e, items.length)} @close=${(e: Event) => closed(host, e.currentTarget as HTMLDialogElement)}
      @click=${(e: MouseEvent) => {
        if (e.target === e.currentTarget) shut(host, e.currentTarget as HTMLDialogElement);
      }}>${index === undefined ? nothing : viewer(host, items[index], index, items.length, words, panel)}</dialog>`;
  },
});
