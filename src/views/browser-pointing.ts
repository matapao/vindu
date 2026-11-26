// What the person pointed at in a browser view's page (browser.ts): the element, or what holds it, by its role and name
// in the accessibility tree, its reference in the model's latest snapshot, and whether it is a secret field.
import { asText } from '../format.js';
import { CONTAINER, SKIP, type ProtocolNode } from './browser-accessibility.js';
import { fieldPrivacy } from './browser-fields.js';
import { ask, type Cdp } from './browser-protocol.js';

/** An element the person pointed at in a page: its reference in the model's latest snapshot (if it has one there), its
 *  role and name as the accessibility tree says, and whether it is a secret field (its value never goes). */
export type Pointed = { element?: string; role: string; name: string; secret?: boolean; url: string };

/** The element at a node the person picked, or the nearest that holds it and has a role and a name. */
export async function pointedAt(
  cdp: Cdp,
  backendNodeId: number,
  refs: ReadonlyMap<string, number>,
  secretRefs: ReadonlySet<string>,
  url: string,
): Promise<Pointed> {
  const ax = await ask(cdp, 'Accessibility.getPartialAXTree', { backendNodeId, fetchRelatives: true }).catch(
    () => null,
  );
  const nodes = ax?.nodes ?? [];
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const refOf = new Map([...refs].map(([r, id]) => [id, r]));
  let at: ProtocolNode | undefined = nodes.find((n) => n.backendDOMNodeId === backendNodeId) ?? nodes[0];
  let named: ProtocolNode | undefined;
  let element: string | undefined;
  let secret = (await fieldPrivacy(cdp, { backendNodeId })) !== 'public';
  for (let n: ProtocolNode | undefined = at; n; n = n.parentId ? byId.get(n.parentId) : undefined) {
    // the element, then what holds it
    const role = String(n.role?.value ?? '');
    if (
      !named &&
      !n.ignored &&
      role &&
      !SKIP.has(role) &&
      role !== 'StaticText' &&
      (asText(n.name?.value ?? '').trim() || !CONTAINER.has(role))
    )
      named = n;
    if (!element && n.backendDOMNodeId && refOf.has(n.backendDOMNodeId)) {
      element = refOf.get(n.backendDOMNodeId);
      if (secretRefs.has(element!)) secret = true;
    }
    if (!secret && n.backendDOMNodeId && n.backendDOMNodeId !== backendNodeId)
      secret = (await fieldPrivacy(cdp, { backendNodeId: n.backendDOMNodeId })) !== 'public';
    if (named && element) break;
  }
  at = named ?? at;
  return {
    ...(element ? { element } : {}),
    role: String(at?.role?.value ?? 'element'),
    name: asText(at?.name?.value ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300),
    ...(secret ? { secret: true } : {}),
    url,
  };
}
