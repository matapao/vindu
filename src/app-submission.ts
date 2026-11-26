// Evidence that the person submitted an MCP App's form: a real click or Enter of theirs, in a control they could see, with
// the values the form showed them. The app's own script draws the form, so this is a hint for the host, never the
// person's approval: a host may let it stand in for a prompt only for a tool that only reads (MCP's readOnlyHint).
//
// Installed before a connector's scripts in its opaque document. Keep this function self-contained.
// The per-document key goes only to the host, in the first message. Provider messages cannot mint a submit.
// Everything it reads, it reads through what it took before the connector's scripts ran (getters, methods, regular
// expressions run by their own exec, an element's kind by its own getter rather than instanceof), so a script that
// redefines a prototype later (a DOMRect's width, an Event's type, RegExp's exec) changes nothing it sees.
function observeConnectorForm(tag: string, submitToken: string): void {
  document.currentScript?.remove();
  if (parent === window || parent !== top) return;
  const key = Array.from(crypto.getRandomValues(new Uint32Array(8))).join('-');
  const post = parent.postMessage.bind(parent);
  const later = window.setTimeout.bind(window);
  const apply = Reflect.apply;
  /* oxlint-disable typescript/unbound-method -- the originals, taken before the connector's scripts run: each is called only through apply, with its receiver */
  const getter = (proto: object, name: string) => Object.getOwnPropertyDescriptor(proto, name)!.get!;
  const own = (name: string) =>
    (Object.getOwnPropertyDescriptor(window, name) ?? Object.getOwnPropertyDescriptor(Window.prototype, name))!.get!;
  const viewWidth = own('innerWidth'),
    viewHeight = own('innerHeight');
  const target = getter(Event.prototype, 'target'),
    eventType = getter(Event.prototype, 'type');
  const rect = (name: string) =>
    (Object.getOwnPropertyDescriptor(DOMRect.prototype, name) ??
      Object.getOwnPropertyDescriptor(DOMRectReadOnly.prototype, name))!.get!;
  const rectSides = {
    width: rect('width'),
    height: rect('height'),
    left: rect('left'),
    top: rect('top'),
    right: rect('right'),
    bottom: rect('bottom'),
  };
  const keyboardKey = getter(KeyboardEvent.prototype, 'key');
  const pointX = getter(MouseEvent.prototype, 'clientX'),
    pointY = getter(MouseEvent.prototype, 'clientY');
  const controls = getter(HTMLFormElement.prototype, 'elements');
  const length = getter(HTMLCollection.prototype, 'length');
  const item = HTMLCollection.prototype.item;
  const closest = Element.prototype.closest;
  const matches = Element.prototype.matches;
  const visibility = Element.prototype.checkVisibility;
  const bounds = Element.prototype.getBoundingClientRect;
  const hit = Document.prototype.elementFromPoint,
    contains = Node.prototype.contains,
    doc = document;
  const computed = window.getComputedStyle,
    property = CSSStyleDeclaration.prototype.getPropertyValue;
  const parentOf = getter(Node.prototype, 'parentNode'),
    nodeType = getter(Node.prototype, 'nodeType');
  const slotOf = getter(Element.prototype, 'assignedSlot'),
    hostOf = getter(ShadowRoot.prototype, 'host');
  const Input = HTMLInputElement,
    Button = HTMLButtonElement,
    Select = HTMLSelectElement,
    Area = HTMLTextAreaElement;
  const inputType = getter(Input.prototype, 'type');
  const buttonType = getter(Button.prototype, 'type');
  const formOfInput = getter(Input.prototype, 'form'),
    formOfButton = getter(Button.prototype, 'form');
  const field = (proto: object) => ({ name: getter(proto, 'name'), value: getter(proto, 'value') });
  const input = field(Input.prototype),
    select = field(Select.prototype),
    area = field(Area.prototype);
  const multiple = getter(Select.prototype, 'multiple');
  const make = Object.create,
    keys = Object.keys,
    hasOwn = Object.hasOwn,
    number = parseFloat;
  const exec = RegExp.prototype.exec;
  /* oxlint-enable typescript/unbound-method */
  const matched = (re: RegExp, text: unknown) => apply(exec, re, [text]) !== null; // not RegExp.prototype.test, which asks for exec again
  // an element's kind, by a getter of that kind: it throws for any other, whatever the element's prototype says now
  const is = (get: () => unknown, el: unknown) => {
    try {
      apply(get, el, []);
      return true;
    } catch {
      return false;
    }
  };
  const measure = (el: Element) => {
    const box = apply(bounds, el, []);
    return {
      width: apply(rectSides.width, box, []) as number,
      height: apply(rectSides.height, box, []) as number,
      left: apply(rectSides.left, box, []) as number,
      top: apply(rectSides.top, box, []) as number,
      right: apply(rectSides.right, box, []) as number,
      bottom: apply(rectSides.bottom, box, []) as number,
    };
  };
  const textInput = /^(text|search|email|url|tel|number|date|time|datetime-local|month|week)$/;
  const rgba = /^rgba\((?:[^,]*,){3}\s*([\d.]+)(%?)\)$/,
    slashed = /\/\s*([\d.]+)(%?)\s*\)$/,
    filterOpacity = /opacity\(([\d.]+)(%?)\)/;
  // what the person could see: at least 12 px each way, at least half opaque (with what holds it), text likewise
  const MIN_SIDE = 12,
    MIN_ALPHA = 0.5;
  const css = (el: Element, name: string) => apply(property, apply(computed, window, [el]), [name]);
  const fraction = (m: RegExpExecArray | null, otherwise: number) => (m ? number(m[1]) / (m[2] ? 100 : 1) : otherwise);
  const opacity = (el: Element) => {
    // the element's and every box's it is drawn in, slots and shadow hosts too
    let seen = 1;
    for (let n: Node | null = el; n && seen >= MIN_ALPHA;) {
      const type = apply(nodeType, n, []) as number;
      if (type === 1) {
        seen *=
          number(css(n as Element, 'opacity')) * fraction(apply(exec, filterOpacity, [css(n as Element, 'filter')]), 1);
        n = (apply(slotOf, n, []) ?? apply(parentOf, n, [])) as Node | null;
      } else n = type === 11 ? apply(hostOf, n, []) : null;
    }
    return seen;
  };
  const colorAlpha = (color: string) => fraction(apply(exec, rgba, [color]) ?? apply(exec, slashed, [color]), 1);
  const legible = (el: Element) =>
    colorAlpha(css(el, 'color')) >= MIN_ALPHA && colorAlpha(css(el, '-webkit-text-fill-color')) >= MIN_ALPHA;
  const visible = (el: Element) => {
    const box = measure(el),
      width = apply(viewWidth, window, []),
      height = apply(viewHeight, window, []);
    return (
      box.width >= MIN_SIDE &&
      box.height >= MIN_SIDE &&
      box.right > 0 &&
      box.bottom > 0 &&
      box.left < width &&
      box.top < height &&
      apply(visibility, el, [{ checkOpacity: true, checkVisibilityCSS: true }]) &&
      opacity(el) >= MIN_ALPHA &&
      legible(el)
    );
  };
  // a click counts where it lands on the control itself: not through a label, not on a control most of the frame
  const pointed = (event: Event, el: Element) => {
    const at = apply(hit, doc, [apply(pointX, event, []), apply(pointY, event, [])]) as Element | null;
    const box = measure(el);
    return (
      !!at &&
      (at === el || apply(contains, el, [at])) &&
      box.width * box.height <= (apply(viewWidth, window, []) * apply(viewHeight, window, [])) / 2
    );
  };
  // the named text fields of a form, as they hold now; null where they are not all plain to see
  const read = (form: HTMLFormElement): Record<string, string> | null => {
    const list = apply(controls, form, []) as HTMLFormControlsCollection;
    const count = apply(length, list, []) as number;
    if (count > 64) return null;
    const values = make(null) as Record<string, string>;
    let total = 0;
    for (let i = 0; i < count; i++) {
      const control = apply(item, list, [i]);
      if (!control || apply(matches, control, [':disabled'])) continue;
      let kind: 'input' | 'area' | 'select' | null = null; // each kind by its own getter
      if (is(inputType, control)) kind = 'input';
      else if (is(area.name, control)) kind = 'area';
      else if (is(multiple, control)) kind = 'select';
      if (!kind) continue;
      let access = select;
      if (kind === 'input') access = input;
      else if (kind === 'area') access = area;
      const name = apply(access.name, control, []) as string;
      if (!name) continue;
      if (kind === 'input' && !matched(textInput, apply(inputType, control, []))) continue;
      if (kind === 'select' && apply(multiple, control, [])) return null;
      if (!visible(control) || name in values) return null;
      const value = apply(access.value, control, []) as string;
      total += name.length + value.length;
      if (total > 12_000) return null;
      values[name] = value;
    }
    return total ? values : null;
  };
  const same = (a: Record<string, string>, b: Record<string, string>) => {
    const names = keys(a);
    if (names.length !== keys(b).length) return false;
    for (let i = 0; i < names.length; i++)
      if (!apply(hasOwn, null, [b, names[i]]) || a[names[i]] !== b[names[i]]) return false;
    return true;
  };
  // the submit control a pointer pressed or clicked, with its form
  const submitter = (event: Event) => {
    const el = apply(closest, apply(target, event, []) as Element, ['input,button']) as
      HTMLInputElement | HTMLButtonElement | null;
    if (!el || !visible(el) || apply(matches, el, [':disabled']) || !pointed(event, el)) return null;
    const isButton = is(buttonType, el);
    if (apply(isButton ? buttonType : inputType, el, []) !== 'submit') return null;
    const form = apply(isButton ? formOfButton : formOfInput, el, []) as HTMLFormElement | null;
    return form ? { el, form } : null;
  };
  let sequence = 0;
  let pressed: { el: Element; form: HTMLFormElement; values: Record<string, string> } | null = null;
  const witness = (event: Event) => {
    if (!event.isTrusted) return;
    try {
      let values: Record<string, string> | null;
      const type = apply(eventType, event, []) as string;
      if (type === 'pointerdown') {
        // the values as they were before the app's own handlers could change them
        pressed = null;
        const press = submitter(event);
        const values = press && read(press.form);
        if (press && values) pressed = { ...press, values };
        return;
      }
      if (type === 'keydown') {
        pressed = null;
        const el = apply(closest, apply(target, event, []) as Element, ['input']) as HTMLInputElement | null;
        if (
          !el ||
          !visible(el) ||
          apply(matches, el, [':disabled']) ||
          apply(keyboardKey, event, []) !== 'Enter' ||
          !matched(textInput, apply(inputType, el, []))
        )
          return;
        const form = apply(formOfInput, el, []) as HTMLFormElement | null;
        values = form && read(form);
      } else {
        // a click: on the control pressed, unmoved, with the values unchanged since
        const press = pressed;
        pressed = null;
        const click = submitter(event);
        if (!click || !press || click.el !== press.el || click.form !== press.form) return;
        values = read(click.form);
        if (values && !same(values, press.values)) return;
      }
      if (!values) return;
      const serial = ++sequence;
      post({ tag, key, serial, values }, '*');
      // The connector may post the RPC from a microtask in its submit handler.
      later(() => post({ tag, key, serial, end: true }, '*'), 0);
    } catch {
      /* An unsupported control or browser follows the ordinary approval path. */
    }
  };
  post({ tag, key, submitToken, init: true }, '*');
  window.addEventListener('pointerdown', witness, true);
  window.addEventListener('click', witness, true);
  window.addEventListener('keydown', witness, true);
}

export const APP_SUBMIT_OBSERVER = 'vindu:form-submit-v1';

function permitsInlineObserver(policy: string): boolean {
  // A blocked bootstrap would leave its per-document token in the DOM. Accept an explicit
  // inline script policy only. Multiple policies and unusual combinations use normal approvals.
  if (!policy || policy.includes(',')) return false;
  const directives = new Map<string, string[]>();
  for (const segment of policy.split(';')) {
    const [directive, ...sources] = segment.trim().toLowerCase().split(/\s+/);
    if (!directive) continue;
    if (directives.has(directive)) return false;
    directives.set(directive, sources);
  }
  const scripts = directives.get('script-src-elem') ?? directives.get('script-src') ?? directives.get('default-src');
  return (
    !directives.has('sandbox') &&
    !!scripts?.includes("'unsafe-inline'") &&
    !scripts.some((source) => /^'(?:nonce-|sha(?:256|384|512)-|strict-dynamic'|none')/.test(source))
  );
}

/** Install the observer before any connector script. Use the exact response CSP, and serve
 * the returned document with its original headers. Unknown policies or markup leave the app alone. */
export function appSubmitDocument(html: string, submitToken: string, contentSecurityPolicy = ''): string {
  if (
    !/^[A-Za-z0-9_-]{32,128}$/.test(submitToken) ||
    !permitsInlineObserver(contentSecurityPolicy) ||
    /\bhttp-equiv\b/i.test(html)
  )
    return html;
  let prefix = html.startsWith('\uFEFF') ? 1 : 0;
  const whitespace = /[\t\n\f\r ]/;
  // Ordinary leading comments and whitespace may precede a standards-mode doctype.
  for (;;) {
    while (prefix < html.length && whitespace.test(html[prefix])) prefix++;
    if (!html.startsWith('<!--', prefix)) break;
    const end = html.indexOf('-->', prefix + 4);
    if (end < 0 || /[<>]|--/.test(html.slice(prefix + 4, end))) return html;
    prefix = end + 3;
  }
  const rest = html.slice(prefix);
  const doctype = /^<!doctype[\t\n\f\r ]+html[\t\n\f\r ]*>/i.exec(rest);
  if (doctype) prefix += doctype[0].length;
  else if (/<!doctype/i.test(html) || rest.startsWith('<?')) return html;
  const script = `<script>(${observeConnectorForm.toString()})(${JSON.stringify(APP_SUBMIT_OBSERVER)},${JSON.stringify(submitToken)})</script>`;
  return html.slice(0, prefix) + script + html.slice(prefix);
}

// A resource gets a fresh iframe. Remember the first document even if React reattaches a listener.
const documents = new WeakMap<HTMLIFrameElement, string>();

/** Watch an app's frame (served by appSubmitDocument with the same token) for the person's own submit of its form. The
 *  evidence says that the person clicked a submit control they could see, or pressed Enter in a field, and what the
 *  fields showed then. It does not say the app drew an honest form: its script decides which fields there are and what
 *  they hold, and a layer that lets clicks through is not seen. So it never replaces the person's approval of a tool
 *  that changes anything; at most it spares them a prompt for one that only reads. */
export function observeAppSubmit(frame: HTMLIFrameElement, submitToken?: string) {
  let pending: { serial: number; values: Record<string, unknown>; arrived: number } | undefined;
  const receive = (event: MessageEvent) => {
    if (event.origin !== 'null' || event.source !== frame.contentWindow) return;
    const data = event.data;
    if (!submitToken || data?.tag !== APP_SUBMIT_OBSERVER || typeof data.key !== 'string') return;
    if (data.init === true) {
      if (data.submitToken === submitToken && !documents.has(frame) && /^\d{1,10}(?:-\d{1,10}){7}$/.test(data.key))
        documents.set(frame, data.key);
      return;
    }
    if (documents.get(frame) !== data.key || !Number.isSafeInteger(data.serial)) return;
    if (data.end) {
      if (pending?.serial === data.serial) pending = undefined;
    } else if (data.values && typeof data.values === 'object' && !Array.isArray(data.values)) {
      pending = { serial: data.serial, values: data.values, arrived: performance.now() };
    }
  };
  window.addEventListener('message', receive);
  return {
    /** Whether a tool call's args are what the person submitted in this frame just now (within 1.5 s, the frame
     *  focused); each submit answers one call. annotations: the called tool's (MCP's tool.annotations, undefined when it
     *  has none). Passed, only a tool its server marks as read-only (readOnlyHint) can match, so a match may spare the
     *  person a prompt. Left out, a match is evidence to show the person, never an approval. */
    matches(args: unknown, ...annotations: [tool?: { readOnlyHint?: boolean }]) {
      const evidence = pending;
      pending = undefined;
      if (annotations.length && annotations[0]?.readOnlyHint !== true) return false;
      if (
        !evidence ||
        performance.now() - evidence.arrived > 1500 ||
        !frame.isConnected ||
        document.activeElement !== frame ||
        !args ||
        typeof args !== 'object' ||
        Array.isArray(args)
      )
        return false;
      const fields = Object.entries(args);
      return (
        fields.length > 0 &&
        fields.length === Object.keys(evidence.values).length &&
        fields.every(([name, value]) => {
          const input = Object.hasOwn(evidence.values, name) ? evidence.values[name] : undefined;
          if (typeof input !== 'string') return false;
          if (typeof value === 'number') return Number.isFinite(value) && String(value) === input;
          return typeof value === 'string' && (value === input || value === input.trim());
        })
      );
    },
    close() {
      pending = undefined;
      window.removeEventListener('message', receive);
    },
  };
}
