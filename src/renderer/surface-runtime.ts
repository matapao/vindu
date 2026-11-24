// Vindu supplies complete view snapshots. Keep a compatible A2UI surface mounted and let
// its processor apply updates, so Lit retains live elements, focus and component state.
import { A2uiMessageListSchema, MessageProcessor, type A2uiMessage, type Catalog } from '@a2ui/web_core/v0_9';
import type { A2uiSurface, LitComponentApi } from '@a2ui/lit/v0_9';
import type { Surface } from '../a2ui.js';
import { framesLeaving } from './dom.js';

type Action = (action: unknown) => void;
type Snapshot = {
  creation: string;
  components: Extract<A2uiMessage, { updateComponents: unknown }>;
  componentKey: string;
  data: unknown;
  dataKey: string;
};
type Mount = {
  element: A2uiSurface;
  processor: MessageProcessor<LitComponentApi>;
  catalogs: Catalog<LitComponentApi>[];
  snapshot?: Snapshot;
  onAction?: Action;
};
const mounts = new WeakMap<HTMLElement, Mount>();

// These are the snapshots the Vindu compiler emits. Other supported message sequences
// pass through the processor exactly as supplied, starting from a fresh surface.
function snapshotOf(messages: A2uiMessage[], name: string): Snapshot | undefined {
  if (messages.length < 2 || messages.length > 3) return;
  const parsed = A2uiMessageListSchema.safeParse(messages);
  if (!parsed.success) return;
  const [create, components, data] = parsed.data;
  if (!('createSurface' in create) || create.createSurface.surfaceId !== name ||
      !('updateComponents' in components) || components.updateComponents.surfaceId !== name ||
      (data && (!('updateDataModel' in data) || data.updateDataModel.surfaceId !== name ||
        (data.updateDataModel.path ?? '/') !== '/'))) return;
  const value = data?.updateDataModel.value ?? {};
  // Only serializable JSON participates in snapshot comparison. Let the regular
  // processor handle other renderer inputs in isolation from the displayed view.
  try {
    return {
      creation: JSON.stringify(create),
      components,
      componentKey: JSON.stringify(components),
      data: structuredClone(value),
      dataKey: JSON.stringify(value),
    };
  } catch {
    return;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** An unchanged server binding keeps its edited value. Only fields still in the snapshot
 * survive, and a changed server value takes precedence. Arrays are a single bound value. */
function updatedData(before: unknown, next: unknown, live: unknown): unknown {
  if (Object.is(before, next)) return live;
  if (Array.isArray(next) && Array.isArray(before) && JSON.stringify(before) === JSON.stringify(next)) return live;
  if (!record(before) || !record(next) || !record(live)) return next;
  return Object.fromEntries(Object.entries(next).map(([key, value]) => [
    key, Object.hasOwn(before, key) && Object.hasOwn(live, key) ? updatedData(before[key], value, live[key]) : value,
  ]));
}

export function releaseSurface(host: HTMLElement) {
  const mount = mounts.get(host);
  if (!mount) return;
  mounts.delete(host);
  mount.onAction = undefined;
  mount.processor.dispose();
}

type Updating = Element & { isUpdatePending?: boolean; updateComplete?: Promise<unknown> };
/** The updates pending in host: each Lit element's that has one, as the promise it keeps of it. */
const updating = (host: HTMLElement) =>
  [...host.querySelectorAll<Updating>('*')].flatMap(element => (element.isUpdatePending && element.updateComplete ? [element.updateComplete] : []));

/** Resolves true once what A2UI draws in host is drawn: no Lit element there has an update pending (the surface's,
 *  and those its updates add), and ready() holds; or false at the cap, in milliseconds. A2UI's elements render in
 *  microtasks, and a component may draw later (a tab opened, a frame added): a change in host checks again. */
export function rendered(host: HTMLElement, ready: () => boolean = () => true, cap = 1000): Promise<boolean> {
  return new Promise(resolve => {
    let done = false, checking = false, again = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true; changes.disconnect(); clearTimeout(timer); resolve(ok);
    };
    const settle = async () => {
      // An element whose updates keep asking for more would never let the cap's timer run: a round has a bound too.
      for (let round = 0, pending = updating(host); pending.length && round < 100 && !done; round++, pending = updating(host)) {
        await Promise.allSettled(pending);
      }
      if (!done && ready()) finish(true);
    };
    const check = () => {
      if (checking) { again = true; return; }
      checking = true;
      void settle().finally(() => {
        checking = false;
        if (again && !done) { again = false; check(); }
      });
    };
    const changes = new MutationObserver(check);
    const timer = setTimeout(() => finish(false), cap);
    changes.observe(host, { childList: true, subtree: true, characterData: true });
    check();
  });
}

/** Returns true if a fresh component tree was mounted or the component definitions changed. */
export function renderSnapshot(
  host: HTMLElement, name: string, surface: Surface, catalogs: Catalog<LitComponentApi>[], onAction?: Action,
): boolean {
  // The public Surface accepts host-provided JSON. MessageProcessor validates it at the wire boundary.
  const messages = surface as A2uiMessage[];
  const next = snapshotOf(messages, name);
  const mount = mounts.get(host);
  const previous = mount?.snapshot;
  if (mount && previous && next && mount.element.parentNode === host &&
      mount.catalogs === catalogs && previous.creation === next.creation) {
    const model = mount.element.surface!;
    const componentsChanged = next.componentKey !== previous.componentKey;
    const updates: A2uiMessage[] = [];
    if (componentsChanged) updates.push(next.components);
    if (next.dataKey !== previous.dataKey) {
      const value = updatedData(previous.data, next.data, model.dataModel.get('/'));
      updates.push({
        version: next.components.version,
        updateDataModel: { surfaceId: name, path: '/', value: structuredClone(value) },
      });
    }
    // The complete component batch is validated by A2UI before it applies edits;
    // the remaining operation can only replace the already-checked root model.
    mount.processor.processMessages(updates);
    if (componentsChanged) {
      // A2UI component updates are additive. A full Vindu snapshot also retires omitted IDs.
      const activeIds = new Set(next.components.updateComponents.components.map(component => component.id));
      for (const id of model.componentsModel.keys) {
        if (!activeIds.has(id)) model.componentsModel.removeComponent(id);
      }
    }
    mount.snapshot = next;
    mount.onAction = onAction;
    return componentsChanged;
  }

  const element = host.ownerDocument.createElement('a2ui-surface') as A2uiSurface;
  const fresh: Mount = {
    element, catalogs, snapshot: next, onAction,
    processor: new MessageProcessor(catalogs, action => fresh.onAction?.(action)),
  };
  try {
    fresh.processor.processMessages(structuredClone(messages));
    element.surface = fresh.processor.getSurface(name);
  } catch (error) {
    fresh.processor.dispose();
    throw error;
  }
  releaseSurface(host);
  framesLeaving(host);
  host.replaceChildren(element);
  mounts.set(host, fresh);
  return true;
}
