import { releaseSurface, rendered } from './surface-runtime.js';
import { updateSurface, type View, type VinduComponent } from './surface.js';
import type { HostPane } from './shell-options.js';

export type PaneEl = {
  el: HTMLElement;
  head: HTMLElement;
  title: HTMLElement;
  sub: HTMLElement;
  mark: HTMLElement;
  markKey?: string;
  tools: HTMLElement;
  max: HTMLButtonElement;
  maxed?: boolean; // whether max shows restore: its icon is set when that flips
  fold: HTMLButtonElement;
  stack: HTMLButtonElement;
  open: HTMLButtonElement;
  acts: Map<string, HTMLButtonElement>;
  body: HTMLElement;
  drawn: 'wide' | 'compact' | null;
  view: View | null;
  seen?: ResizeObserver;
  told?: string;
  host?: { kind: string; pane: HostPane | null; box: string };
};

type TabsElement = HTMLElement & { activeIndex?: number };
export const tabsIn = (body: HTMLElement) => body.querySelector<TabsElement>('a2ui-tabs');

export const tabTitle = (body: HTMLElement) => body.querySelector('.a2ui-tab-button-active')?.textContent?.trim();

export function showLoading(body: HTMLElement, label: string) {
  if (body.querySelector('.vindu-loading')) return;
  const doc = body.ownerDocument;
  const pending = doc.createElement('div');
  pending.className = 'vindu-loading';
  const status = doc.createElement('p');
  status.setAttribute('role', 'status');
  status.textContent = label;
  pending.append(status);
  for (let i = 0; i < 3; i++) {
    const line = doc.createElement('span');
    line.className = 'vindu-skeleton';
    line.setAttribute('aria-hidden', 'true');
    pending.append(line);
  }
  releaseSurface(body);
  body.replaceChildren(pending);
}

export function placeHost(pane: PaneEl, shown: boolean) {
  const host = pane.host;
  if (!host?.pane?.place) return;
  const bounds = shown ? pane.body.getBoundingClientRect() : null;
  const box = bounds && bounds.width > 0 && bounds.height > 0 ? {
    x: Math.round(bounds.left), y: Math.round(bounds.top),
    w: Math.round(bounds.width), h: Math.round(bounds.height),
  } : null;
  const key = box ? `${box.x},${box.y},${box.w},${box.h}` : 'hidden';
  if (key !== host.box) {
    host.box = key;
    host.pane.place(box);
  }
}

const pageFrame = (body: HTMLElement) => body.querySelector('vindu-page iframe');
const waitingForPage = new WeakSet<PaneEl>();

/** Pages that fill their panes get the space below the controls above them. Every pane's box is written before this:
 *  the panes are measured together, then set together, so a layout reflows once and not once a pane. A page not drawn
 *  yet is fitted once A2UI has drawn it. */
export function fitPages(fills: PaneEl[], stacked: () => boolean) {
  if (stacked()) {
    for (const pane of fills) pane.body.style.removeProperty('--vindu-page-h');
    return;
  }
  const heights = fills.map(({ body }) => {
    const frame = pageFrame(body);
    if (!frame) return undefined;
    const top = frame.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
    return `${Math.max(120, Math.floor(body.clientHeight - top))}px`;
  });
  fills.forEach((pane, i) => {
    const height = heights[i];
    if (height) pane.body.style.setProperty('--vindu-page-h', height);
    else if (!waitingForPage.has(pane)) {
      waitingForPage.add(pane);
      void rendered(pane.body, () => !!pageFrame(pane.body)).then(drawn => {
        waitingForPage.delete(pane);
        if (drawn && pane.body.isConnected) fitPages([pane], stacked); // a pane gone meanwhile has nothing to fit
      });
    }
  });
}

/** One page's pane, as fitPages fits them. */
export const fitPage = (pane: PaneEl, stacked: () => boolean) => fitPages([pane], stacked);

type Surface = 'wide' | 'compact';
type Rendering = {
  savedTab?: string;
  components?: VinduComponent[];
  missing: (component: string) => string;
  action: (event: unknown) => void;
  measure: () => void;
  verify: (surface: Surface) => void;
};

export function drawPaneSurface(pane: PaneEl, view: View, which: Surface, rendering: Rendering) {
  if (pane.view === view && pane.drawn === which) return;
  const keep = tabTitle(pane.body) ?? rendering.savedTab;
  const previousElement = pane.body.firstElementChild;
  const treeChanged = updateSurface(pane.body, view, which, {
    onAction: rendering.action, components: rendering.components, head: false, missing: rendering.missing,
  });
  pane.view = view;
  pane.drawn = which;
  pane.told = undefined;
  const surface = pane.body.firstElementChild as HTMLElement | null;
  if (surface !== previousElement || !pane.seen) {
    pane.seen?.disconnect();
    pane.seen = undefined;
  }
  if (surface && !pane.seen) {
    surface.style.display = 'block';
    pane.seen = new ResizeObserver(rendering.measure);
    pane.seen.observe(surface);
  }

  // A new tree opens on its first tab: the one the person had open is opened again once A2UI has drawn the tabs, and
  // what it shows is read back after (verify waits for that tab to be drawn).
  async function reopenTab(title: string) {
    const buttons = () => pane.body.querySelectorAll('.a2ui-tab-button');
    await rendered(pane.body, () => !!tabsIn(pane.body) && buttons().length > 0);
    if (pane.view !== view || !pane.body.isConnected) return;
    const tabs = tabsIn(pane.body);
    const index = [...buttons()].findIndex(button => button.textContent?.trim() === title);
    if (tabs && index > 0 && tabs.activeIndex !== index) tabs.activeIndex = index;
    if (view.probes) rendering.verify(pane.drawn!);
  }

  if (keep && treeChanged) void reopenTab(keep);
  else if (view.probes) rendering.verify(which);
}
