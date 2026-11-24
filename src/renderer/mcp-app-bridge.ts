// Each sandboxed MCP App has its own display bridge: a mount, one for each document that initializes in the frame. The
// window answers what is the display's own (ui/initialize, ping, ui/request-display-mode, the frame's size) as MCP Apps'
// AppBridge answers it, and carries every message to the host, which keeps the connector connection and answers the
// rest through send(). An app hears what changes in its host context (the theme, the window's language, its frame's
// width, the type sizes), and is asked to tear down (ui/resource-teardown) before its frame goes. Plain JSON-RPC 2.0
// (app-rpc.ts): no MCP SDK in the browser.
import type { ShellEvent } from '../shell.js';
import { FRAMES_LEAVING, viewOf } from './dom.js';
import { appFontVariables } from './metrics.js';
import { APPS_PROTOCOL, LEGACY_APPS_PROTOCOL, appRpcOf, isDisplayMode, isInitializeParams, isResponseTo, type AppRpc, type RpcId } from './app-rpc.js';

const hostInfo = { name: 'vindu', version: '0.3.0' };
const hostCapabilities = {
  serverTools: {}, serverResources: {}, logging: {}, updateModelContext: { text: {} }, message: { text: {} }, openLinks: {},
};
const INITIALIZE = 'ui/initialize', INITIALIZED = 'ui/notifications/initialized', SIZE_CHANGED = 'ui/notifications/size-changed';
const PING = 'ping', DISPLAY_MODE = 'ui/request-display-mode', HOST_CONTEXT_CHANGED = 'ui/notifications/host-context-changed';
const TEARDOWN = 'ui/resource-teardown';
const localRequests = new Set([PING, DISPLAY_MODE]);
const displayMethods = new Set([INITIALIZE, INITIALIZED, SIZE_CHANGED, ...localRequests]);
/** The tallest an app's frame is drawn, in CSS pixels: what its host context says, and the most its size-changed sets. */
const MAX_HEIGHT = 2000;
/** How long an app has to answer its teardown before its frame goes anyway, in milliseconds. */
const TEARDOWN_WAIT = 500;
/** A size an app reports: none, or a finite number. */
const isSize = (value: unknown) => value === undefined || (typeof value === 'number' && Number.isFinite(value));
/** To an app's frame. Its document's origin is opaque ('null') and cannot be named as a target, so the target is "*":
 *  the message goes to this frame's own Window and nowhere else, and its contents are not logged. */
const postToApp = (frame: HTMLIFrameElement, message: unknown) => {
  // nosemgrep: javascript.browser.security.wildcard-postmessage-configuration.wildcard-postmessage-configuration -- an app frame's origin is opaque ('null'), which cannot be named; the message goes to this frame's own window only
  frame.contentWindow?.postMessage(message, '*');
};
/** The window's language as an app hears it: a BCP 47 tag, in its canonical form; undefined for none, or for what is
 *  not a tag. */
function localeOf(tag: unknown): string | undefined {
  if (typeof tag !== 'string' || !tag) return undefined;
  try { return Intl.getCanonicalLocales(tag)[0]; } catch { return undefined; }
}

/** What an app is told of its host, as MCP Apps' McpUiHostContext has it. */
type HostContext = {
  styles?: { variables: Record<string, string> }; theme: 'light' | 'dark'; displayMode: 'inline'; availableDisplayModes: ['inline'];
  containerDimensions: { width: number; maxHeight: number }; locale?: string; timeZone: string; platform: 'desktop';
};

/** The app frames in root, as their MCP Apps bridge. locale: the window's language, a BCP 47 tag ('nb-NO'); without
 *  one, the browser's. */
export function connectAppFrames(root: HTMLElement, emit: (event: ShellEvent) => void, options: { locale?: string } = {}) {
  const mounts = new Map<HTMLIFrameElement, ReturnType<typeof mountOf>>();
  const view = root.ownerDocument.defaultView;
  // What can change while an app runs: the theme (the shell's own, else the system's) and the language (the host's,
  // else the browser's). Its frame's width is the frame's own.
  const darkScheme = view?.matchMedia('(prefers-color-scheme: dark)');
  let locale = localeOf(options.locale), teardowns = 0;
  const themeNow = (): HostContext['theme'] => {
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : !!darkScheme?.matches;
    return dark ? 'dark' : 'light';
  };
  const localeNow = () => locale ?? view?.navigator.language;
  // A mount is the document's that initialized it. Each document in a frame ends its loading with a load event: how many
  // a frame has had, and the last that was a mounted document's own. A document that asks before it loads has its load
  // next; one that loads first has had it. A later load is another document's (a link the person followed, a reload),
  // which starts with no mount and initializes for one of its own. Its load is all the frame says of a new document:
  // what it sends before then still goes as the last one's. One order reads the same both ways, a document that
  // initializes again after its load and then leaves: its mount stays with the next, until that one initializes or loads.
  const seen = new WeakMap<HTMLIFrameElement, { loads: number; claimed: number }>();
  const seenOf = (frame: HTMLIFrameElement) => {
    let frameSeen = seen.get(frame);
    if (!frameSeen) seen.set(frame, frameSeen = { loads: 0, claimed: 0 });
    return frameSeen;
  };
  const onLoad = (event: Event) => {
    const frame = event.target as HTMLIFrameElement;
    if (frame.localName !== 'iframe' || frame.dataset.appPanel === undefined) return;
    const frameSeen = seenOf(frame), current = mounts.get(frame);
    frameSeen.loads++;
    if (current && frameSeen.loads === current.ownLoad) frameSeen.claimed = frameSeen.loads;
    else current?.close();
  };
  root.addEventListener('load', onLoad, true);

  function mountOf(frame: HTMLIFrameElement, requestedVersion: string) {
    const token = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
    const frameSeen = seenOf(frame), loadedFirst = frameSeen.loads > frameSeen.claimed;
    const ownLoad = loadedFirst ? frameSeen.loads : frameSeen.loads + 1;
    if (loadedFirst) frameSeen.claimed = ownLoad;
    const fonts = appFontVariables(root);
    // What the app was told last: at initialize, then as it changes.
    const hostContext: HostContext = {
      ...(Object.keys(fonts).length ? { styles: { variables: fonts } } : {}),
      theme: themeNow(), displayMode: 'inline', availableDisplayModes: ['inline'],
      containerDimensions: { width: frame.clientWidth, maxHeight: MAX_HEIGHT }, locale: localeNow(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, platform: 'desktop',
    };
    // Retain compatibility with deployed apps using the older inline display protocol.
    const protocolVersion = requestedVersion === LEGACY_APPS_PROTOCOL ? LEGACY_APPS_PROTOCOL : APPS_PROTOCOL;
    const active = () => root.contains(frame) && mounts.get(frame)?.token === token;
    const post = (message: unknown) => {
      if (active()) postToApp(frame, message);
    };
    const reply = (id: RpcId, result: unknown) => post({ jsonrpc: '2.0', id, result });
    const fail = (id: RpcId, code: number, message: string) => post({ jsonrpc: '2.0', id, error: { code, message } });
    // Its teardown: asked once, and over when it answers or its wait is.
    let tearingDown: Promise<void> | undefined, awaited: { id: string; over: () => void } | undefined;
    const mount = {
      token, ownLoad, post,
      close() {
        if (mounts.get(frame) !== mount) return;
        mounts.delete(frame);
        widths.unobserve(frame);
      },
      /** A display method: answered as AppBridge answers it. */
      receive({ id, method, params = {} }: AppRpc) {
        if (id === undefined) {
          const { width, height } = params;
          if (method !== SIZE_CHANGED || !isSize(width) || !isSize(height)) return; // other notifications ask nothing of the display
          if (active() && typeof height === 'number' && height > 0) frame.style.height = `${Math.min(MAX_HEIGHT, Math.max(80, height))}px`;
        } else if (method === INITIALIZE) reply(id, { protocolVersion, hostCapabilities, hostInfo, hostContext });
        else if (method === PING) reply(id, {});
        else if (method === DISPLAY_MODE) {
          if (isDisplayMode(params.mode)) reply(id, { mode: hostContext.displayMode }); // inline is the only mode here
          else fail(id, -32602, 'Invalid params for ui/request-display-mode: mode: Invalid input');
        } else fail(id, -32601, 'Method not found'); // a notification's method, sent as a request
      },
      setFonts: (variables: Record<string, string>) => post({ jsonrpc: '2.0', method: HOST_CONTEXT_CHANGED, params: { styles: { variables } } }),
      /** What has changed in its host context since it was told: those fields alone, in one notification. A frame out of
       *  sight has no width to tell; it tells its width again once it is back. */
      retell() {
        const changed: Partial<HostContext> = {};
        const theme = themeNow(), language = localeNow(), width = frame.clientWidth;
        if (theme !== hostContext.theme) changed.theme = theme;
        if (language !== hostContext.locale) changed.locale = language;
        if (width > 0 && width !== hostContext.containerDimensions.width) changed.containerDimensions = { width, maxHeight: MAX_HEIGHT };
        if (!Object.keys(changed).length) return;
        Object.assign(hostContext, changed);
        post({ jsonrpc: '2.0', method: HOST_CONTEXT_CHANGED, params: changed });
      },
      /** Asks it to tear down: over once it answers, or once the wait is over; undefined when its frame has gone already. */
      tearDown(): Promise<void> | undefined {
        if (!active()) return undefined;
        tearingDown ??= new Promise<void>(resolve => {
          const timer = setTimeout(over, TEARDOWN_WAIT);
          function over() { clearTimeout(timer); awaited = undefined; resolve(); }
          awaited = { id: `vindu-teardown-${++teardowns}`, over };
          post({ jsonrpc: '2.0', id: awaited.id, method: TEARDOWN, params: {} });
        });
        return tearingDown;
      },
      /** Whether data is its answer to the teardown it was asked: its wait is then over. */
      answered(data: unknown) {
        if (!awaited || !isResponseTo(data, awaited.id)) return false;
        awaited.over();
        return true;
      },
    };
    widths.observe(frame);
    return mount;
  }

  const retellAll = () => {
    for (const current of mounts.values()) current.retell();
  };
  darkScheme?.addEventListener('change', retellAll); // the system's theme, which the shell follows unless it has its own
  // An app frame's width, told once an animation frame at most. Its height is the app's own (size-changed): a change of
  // height alone tells the app nothing, as it is what the app asked for.
  const resized = new Set<HTMLIFrameElement>();
  let retelling = 0;
  const widths = new ResizeObserver(entries => {
    for (const entry of entries) resized.add(entry.target as HTMLIFrameElement);
    if (retelling) return;
    retelling = (view ?? window).requestAnimationFrame(() => {
      retelling = 0;
      for (const frame of resized) mounts.get(frame)?.retell();
      resized.clear();
    });
  });

  /** The teardowns of the initialized apps in within, asked now. */
  const tearDownIn = (within: Element) => {
    const waits: Promise<void>[] = [];
    for (const [frame, current] of mounts) {
      const wait = within.contains(frame) ? current.tearDown() : undefined;
      if (wait) waits.push(wait);
    }
    return waits;
  };
  // frames drawn over in place: they go at once, so their apps are asked and not waited for
  const onLeaving = (event: Event) => void tearDownIn(event.target as Element);
  root.addEventListener(FRAMES_LEAVING, onLeaving);

  const removals = new MutationObserver(records => {
    if (!mounts.size || !records.some(record => record.removedNodes.length)) return;
    for (const [frame, connection] of mounts) if (!root.contains(frame)) connection.close();
  });

  return {
    receive(event: MessageEvent) {
      // An app's frame has no same-origin rights, so its documents have an opaque origin; a message from any other is not an app's.
      if (event.origin !== 'null' || event.data?.jsonrpc !== '2.0') return;
      const frame = [...root.querySelectorAll<HTMLIFrameElement>('iframe[data-app-panel]')].find(candidate => candidate.contentWindow === event.source);
      const resource = frame?.dataset.appResource;
      if (!frame || !resource) return;
      if (mounts.get(frame)?.answered(event.data)) return; // its answer to the window's own request, which is the window's alone
      const rpc = appRpcOf(event.data);
      if (!rpc) return;
      if (rpc.method === INITIALIZE && rpc.id !== undefined) {
        // Early embedded views may omit appInfo or capabilities when asking only for host context.
        const params = { protocolVersion: APPS_PROTOCOL, appInfo: { name: 'app', version: 'unknown' }, appCapabilities: {}, ...rpc.params };
        rpc.params = params;
        if (!isInitializeParams(params)) {
          postToApp(frame, { jsonrpc: '2.0', id: rpc.id, error: { code: -32602, message: 'Invalid app initialization parameters' } });
          return;
        }
        mounts.get(frame)?.close();
        mounts.set(frame, mountOf(frame, params.protocolVersion));
        removals.observe(root, { childList: true, subtree: true }); // a frame taken out of the window takes its mount along
      }
      const current = mounts.get(frame);
      if (!current) return;
      if (displayMethods.has(rpc.method)) current.receive(rpc);
      if (localRequests.has(rpc.method)) return;
      emit({
        type: 'app', view: viewOf(frame) ?? '',
        panel: frame.dataset.appPanel ?? '', resource, mount: current.token, msg: rpc,
      });
    },
    setFonts(variables: Record<string, string>) {
      for (const current of mounts.values()) current.setFonts(variables);
    },
    /** The shell's theme changed: each app hears its new one. */
    themeChanged: retellAll,
    /** The window's language, a BCP 47 tag; none, or one that is not a tag: the browser's. Each app hears it. */
    setLocale(tag?: string) {
      locale = localeOf(tag);
      retellAll();
    },
    /** Asks each app in within whose document has initialized to tear down: over once each has answered or its wait is
     *  over; undefined when there is none. */
    tearDown(within: Element): Promise<unknown> | undefined {
      const waits = tearDownIn(within);
      return waits.length ? Promise.all(waits) : undefined;
    },
    send(view: string, panel: string, message: unknown) {
      if (!message || typeof message !== 'object' || !('vinduMount' in message) || typeof message.vinduMount !== 'string') return;
      const { vinduMount, ...rpc } = message;
      for (const [frame, current] of mounts) {
        if (current.token === vinduMount && frame.dataset.appPanel === panel && viewOf(frame) === view) {
          current.post(rpc);
          return;
        }
      }
    },
    destroy() {
      removals.disconnect();
      widths.disconnect();
      (view ?? window).cancelAnimationFrame(retelling);
      retelling = 0;
      darkScheme?.removeEventListener('change', retellAll);
      root.removeEventListener('load', onLoad, true);
      root.removeEventListener(FRAMES_LEAVING, onLeaving);
      for (const current of mounts.values()) current.close();
    },
  };
}
