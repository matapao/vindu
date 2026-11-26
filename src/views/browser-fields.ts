// Secrets are the person's: fields for passwords, card numbers and one-time codes show the model only whether they are
// filled, and the model never types in them. Each check reads the field's own attributes over CDP, without running the
// page's code; a field it cannot read counts as one that may hold a secret. A field is an input, a select, a textarea
// or an element the person can edit (contenteditable), each marked by type="password" or a secret autocomplete.
import { SECRET_AUTOCOMPLETE, SECRET_FIELDS } from './browser-requests.js';
import { ask, type Cdp } from './browser-protocol.js';

export type FieldReference = { backendNodeId: number } | { objectId: string };
const FIELD_INSPECTION_FAILED = 'The browser could not verify whether this field contains private information.';
export const SECRET_REFUSED = 'this is a secret field (a password, card number or code): the person fills it in themselves; ask them to, in the chat';

/** The names (or ids) of the secret fields on the page now. */
export async function secretFieldNames(cdp: Cdp): Promise<string[]> {
  const r = await ask(cdp, 'Runtime.evaluate', { expression: `[...document.querySelectorAll(${JSON.stringify(SECRET_FIELDS)})].map(e => e.name || e.id || e.getAttribute('autocomplete') || e.type)`, returnByValue: true }).catch(() => null);
  if (!Array.isArray(r?.result?.value)) throw new Error(FIELD_INSPECTION_FAILED);
  return r.result.value.map(String);
}

/** Read native element attributes without running page code. A missing or detached field has unknown sensitivity. */
export async function fieldPrivacy(cdp: Cdp, reference: FieldReference): Promise<'public' | 'secret' | 'unknown'> {
  if ('backendNodeId' in reference && !reference.backendNodeId) return 'unknown';
  const response = await ask(cdp, 'DOM.describeNode', reference).catch(() => undefined);
  const node = response?.node;
  if (!node || typeof node.nodeName !== 'string') return 'unknown';
  const tag = node.nodeName.toLowerCase(), attributes = node.attributes;
  const named = (name: string) => Array.isArray(attributes) && attributes.some((a, i) => i % 2 === 0 && a === name);
  if (tag !== 'input' && tag !== 'select' && tag !== 'textarea' && !named('contenteditable')) return 'public';
  if (!Array.isArray(attributes) || attributes.length % 2 !== 0) return 'unknown';
  for (let i = 0; i < attributes.length; i += 2) {
    const value = String(attributes[i + 1]).toLowerCase();
    if (tag === 'input' && attributes[i] === 'type' && value === 'password') return 'secret';
    if (attributes[i] === 'autocomplete' && value.split(/\s+/).some(token => SECRET_AUTOCOMPLETE.includes(token))) return 'secret';
  }
  return 'public';
}

/** Refuse a field that holds a secret, or one that can't be told; secret: known to be one already (from a snapshot). */
export async function checkField(cdp: Cdp, reference: FieldReference, secret = false): Promise<void> {
  const field = secret ? 'secret' : await fieldPrivacy(cdp, reference);
  if (field === 'secret') throw new Error(SECRET_REFUSED);
  if (field === 'unknown') throw new Error(FIELD_INSPECTION_FAILED);
}

/** Keystrokes go to the focused field, which a page can change after the original reference was checked. */
export async function checkFocusedField(cdp: Cdp): Promise<void> {
  const expression = `(() => {
    let element = document.activeElement;
    while (element) {
      if (element.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
      else if (element.tagName === 'IFRAME' || element.tagName === 'FRAME') element = element.contentDocument?.activeElement;
      else return element;
    }
  })()`;
  const focused = await ask(cdp, 'Runtime.evaluate', { expression }).catch(() => undefined);
  const objectId = focused?.result?.objectId;
  if (!objectId) throw new Error(FIELD_INSPECTION_FAILED);
  try {
    await checkField(cdp, { objectId });
  } finally {
    await cdp.send('Runtime.releaseObject', { objectId }).catch(() => undefined);
  }
}
