// Drawing one view, on the A2UI Lit renderer: the basic catalog, plus Page and the components a host adds.
// Runs in a browser (an Electron window, a web app); the host bundles it with its own renderer code.
import { css, html } from 'lit';
import { keyed } from 'lit/directives/keyed.js';
import type { Catalog } from '@a2ui/web_core/v0_9';
import { basicCatalog, type LitComponentApi } from '@a2ui/lit/v0_9';
import type { Surface } from '../a2ui.js';
import { withinSurfaceLimits } from '../surface-limits.js';
import { guardA2uiArrays } from './a2ui-limits.js';
import { framesLeaving } from './dom.js';
import { renderSnapshot, releaseSurface } from './surface-runtime.js';
import { VINDU_CATALOG } from '../catalog-id.js';
import { useTheme, useMetricStyles } from './theme.js';
import { setMetrics, type ViewMetrics } from './metrics.js';
import { setPictureSources } from './picture-sources.js';

export { VINDU_CATALOG };
export type { Surface };
/** Where a shown value is, for the window to read back after drawing (vindu's a2ui.ts makes these): in a list at a row's
 *  data path, in a tab (tab: its place), or a page's or app's frame (frame), whose size and load are read, not its text. */
import type { Probe } from '../window-reports.js'; // one shape, the compiler's and the window's
export type { Probe };
/** What the window read back for one probe: the text (null where nothing was found), whether it is in sight in the pane,
 *  and for a frame its size as drawn and whether it has loaded. */
export type ReadBack = { i: number; text: string | null; visible: boolean; frame?: { w: number; h: number; loaded: boolean } };
export type View = { name: string; wide: Surface; compact: Surface; seq?: number; probes?: { wide: Probe[]; compact: Probe[] } };

import { defineComponent, type VinduComponent } from './define.js';
export { defineComponent, type VinduComponent };
import { BLOCK_COMPONENTS } from './blocks.js';

/** A frame's address: http or https, and one the browser can read; undefined otherwise. */
function frameUrl(value: unknown): URL | undefined {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return undefined;
  try { return new URL(value); } catch { return undefined; }
}
const SAME_ORIGIN_PAGE = 'This page has the window\'s own origin, so it is not shown: it would have the window\'s rights.';

/** A web page in a frame of its own origin (the page host's), sandboxed: scripts run, nothing reaches the app. Never a
 *  page of the window's own origin, whose script could lift its frame's sandbox. What it sends (task.send) goes through
 *  the shell, which knows the frame by its panel. A static page (static) is drawn in a frame of its own where nothing
 *  runs at all (sandbox=""), made with its sandbox before its address is set, so it holds from its first load. */
export const Page = defineComponent({
  name: 'Page', tag: 'vindu-page', props: { url: 'string', height: 'number', title: 'string', panel: 'string', static: 'boolean' },
  styles: css`:host { display: block; } iframe { background: var(--v-pane, #fff); }`,
  render: (p, element) => {
    const address = frameUrl(p.url), own = !!address && address.origin === element.ownerDocument.defaultView?.origin;
    const url = address && !own ? String(p.url) : undefined;
    if (!url) return html`<p>${own ? SAME_ORIGIN_PAGE : 'No page to show.'}</p>`;
    const style = `display:block;width:100%;border:0;height:var(--vindu-page-h, ${Number(p.height) || 480}px)`;
    return p.static === true
      ? html`<iframe sandbox="" src=${url} title=${String(p.title ?? 'page')} data-page-panel=${String(p.panel ?? '')} style=${style} allow="fullscreen" referrerpolicy="no-referrer"></iframe>`
      : html`<iframe src=${url} title=${String(p.title ?? 'page')} data-page-panel=${String(p.panel ?? '')} style=${style} sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock" allow="fullscreen; gamepad; autoplay" referrerpolicy="origin"></iframe>`;
  },
});

/** An MCP App: its server's own HTML, in a frame of its own origin with no same-origin rights; it talks to the host
 *  only through postMessage, which the shell carries to the UI server and back. */
export const McpApp = defineComponent({
  name: 'McpApp', tag: 'vindu-app', props: { resource: 'string', url: 'string', height: 'number', title: 'string', panel: 'string' },
  styles: css`:host { display: block; }`,
  render: p => {
    const url = frameUrl(p.url) ? String(p.url) : undefined;
    return url
      ? keyed(url, html`<iframe src=${url} title=${String(p.title ?? 'app')} data-app-resource=${String(p.resource)} data-app-panel=${String(p.panel ?? '')} style=${`display:block;width:100%;border:0;height:var(--vindu-page-h, ${Number(p.height) || 420}px)`} sandbox="allow-scripts allow-forms" referrerpolicy="no-referrer"></iframe>`)
      : html`<p>No app to show.</p>`;
  },
});

export const vinduCatalog = (components: VinduComponent[] = []) =>
  basicCatalog.derive({
    catalogId: VINDU_CATALOG,
    components: [...basicCatalog.components.keys(), ...[Page, McpApp, ...BLOCK_COMPONENTS, ...components] as LitComponentApi[]],
  });
const catalogs = new WeakMap<VinduComponent[], Catalog<LitComponentApi>[]>();
const knownNames = new WeakMap<VinduComponent[], Set<string>>();
const NONE: VinduComponent[] = [];

/** A surface without the view's own title and subtitle: in a shell, the pane's title bar shows them. */
export function withoutHead(surface: Surface): Surface {
  const drop = new Set(['title', 'subtitle']);
  return surface.map(m => {
    const u = (m as { updateComponents?: { components: { id: string; children?: unknown }[] } })?.updateComponents;
    return Array.isArray(u?.components) && u.components.every(c => c && typeof c === 'object') ? { ...m, updateComponents: { ...u, components: u.components.filter(c => !drop.has(c.id)).map(c => (c.id === 'root' && Array.isArray(c.children) ? { ...c, children: c.children.filter(x => !drop.has(x)) } : c)) } } : m;
  });
}

/** A component this window has not registered (a host card whose component the host left out) would draw as nothing:
 *  it is drawn as a line that says which component is missing instead, so the gap is seen and not silent. */
export const MISSING = (component: string) => `This card needs the component "${component}", which this window has not registered.`;
export function withKnown(surface: Surface, known: Set<string>, say: (component: string) => string = MISSING): Surface {
  return surface.map(m => {
    const u = (m as { updateComponents?: { components: { id: string; component?: string }[] } })?.updateComponents;
    if (!Array.isArray(u?.components) || !u.components.every(c => c && typeof c === 'object') ||
        u.components.every(c => !c.component || known.has(c.component))) return m;
    return { ...m, updateComponents: { ...u, components: u.components.map(c => (!c.component || known.has(c.component) ? c
      : { id: c.id, component: 'Text', variant: 'caption', text: say(c.component) })) } };
  });
}

/** How a view is drawn. sources: the schemes the host serves pictures from besides http(s), e.g. ['media:'], each
 *  lowercase and ending in ':' (never javascript: or data:; picture-sources.ts): the blocks draw a picture from them. */
type DrawOptions = { onAction?: (a: unknown) => void; components?: VinduComponent[]; head?: boolean; missing?: (component: string) => string; sources?: readonly string[] };

/** Apply a complete view snapshot. Returns true when the component tree may have changed. */
export function updateSurface(host: HTMLElement, view: View, which: 'wide' | 'compact', o: DrawOptions): boolean {
  guardA2uiArrays();
  if (o.sources) setPictureSources(host, o.sources);
  const surface = view[which];
  if (!withinSurfaceLimits(surface)) {
    releaseSurface(host);
    framesLeaving(host);
    host.textContent = 'This view is too large to display. Select fewer fields or split it into smaller panels.';
    return true;
  }
  const key = o.components ?? NONE;
  if (!catalogs.has(key)) catalogs.set(key, [vinduCatalog(key), basicCatalog]);
  if (!knownNames.has(key)) knownNames.set(key, new Set(catalogs.get(key)![0].components.keys()));
  const messages = withKnown(o.head === false ? withoutHead(surface) : surface, knownNames.get(key)!, o.missing);
  return renderSnapshot(host, view.name, messages, catalogs.get(key)!, o.onAction);
}

export function drawSurface(host: HTMLElement, view: View, which: 'wide' | 'compact', o: DrawOptions = {}): void {
  updateSurface(host, view, which, o);
}

/** Draw a view in the layout the host's width fits. A2UI has no breakpoints, so both surfaces are kept and switched.
 *  theme: dress it in vindu's theme (the shell always is). */
export function mountView(host: HTMLElement, view: View, o: { onAction?: (a: unknown) => void; components?: VinduComponent[]; compactBelow?: number; theme?: boolean; metrics?: ViewMetrics; missing?: (component: string) => string; sources?: readonly string[] } = {}): () => void {
  setPictureSources(host, o.sources); // checked before anything is drawn
  let current: 'wide' | 'compact' | null = null;
  const addedTheme = o.theme && !host.classList.contains('vindu-theme');
  if (o.theme) { useTheme(host.ownerDocument); host.classList.add('vindu-theme'); }
  const resetMetrics = o.metrics && setMetrics(host, o.metrics);
  if (o.metrics && host.dataset.vinduMetrics) useMetricStyles(host.ownerDocument);
  const draw = () => {
    const want = host.clientWidth < (o.compactBelow ?? 600) ? 'compact' : 'wide';
    if (want === current) return;
    current = want;
    drawSurface(host, view, want, o);
  };
  draw();
  const watch = new ResizeObserver(draw);
  watch.observe(host);
  return () => {
    watch.disconnect();
    releaseSurface(host);
    resetMetrics?.();
    setPictureSources(host); // the next view drawn here names its own
    if (addedTheme) host.classList.remove('vindu-theme');
  };
}

/** An element A2UI drew, with its component's id and, in a list, its row's data path. */
type Drawn = HTMLElement & { context?: { componentModel?: { id?: string }; dataContext?: { path?: string } } };

/** Read back what a surface drew: for each probe, the text of its component (in a list, at its row's data path) and
 *  whether it is in sight in the pane; for a frame, its size and whether it has loaded (the shell marks frames that
 *  have, data-loaded). null where nothing was found: in a tab that is not open, A2UI draws nothing. Read from A2UI's own
 *  elements, never from pixels. The elements are walked once, into the probes' components in document order. */
export function readBack(body: HTMLElement, probes: readonly Pick<Probe, 'component' | 'path' | 'frame'>[]): ReadBack[] {
  const wanted = new Set(probes.map(p => p.component));
  const drawn = new Map<string, Drawn[]>();
  for (const element of body.querySelectorAll<Drawn>('*')) {
    const id = element.context?.componentModel?.id;
    if (id === undefined || !wanted.has(id)) continue;
    const same = drawn.get(id);
    if (same) same.push(element); else drawn.set(id, [element]);
  }
  const box = body.getBoundingClientRect();
  const seen = (r: DOMRect) => r.width > 0 && r.height > 0 && r.bottom > box.top && r.top < box.bottom && r.right > box.left && r.left < box.right;
  return probes.map((p, i) => {
    const same = drawn.get(p.component) ?? [];
    const el = same.find(e => !p.path || e.context?.dataContext?.path === p.path) ?? same[0];
    if (!el) return { i, text: null, visible: false };
    if (p.frame) {
      const f = el.querySelector('iframe'); if (!f) return { i, text: null, visible: false };
      const r = f.getBoundingClientRect();
      return { i, text: null, visible: seen(r), frame: { w: Math.round(r.width), h: Math.round(r.height), loaded: f.dataset.loaded === '1' } };
    }
    const range = el.ownerDocument.createRange(); range.selectNodeContents(el); // the text's own box: A2UI's elements may lay out as their contents
    return { i, text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(), visible: seen(range.getBoundingClientRect()) };
  });
}
