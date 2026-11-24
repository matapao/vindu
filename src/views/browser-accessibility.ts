import { asText, ellipsis } from '../format.js';

export type PageNode = { ref?: string; role: string; name?: string; value?: string; description?: string; url?: string; level?: number; secret?: true;
  checked?: boolean | 'mixed'; pressed?: boolean | 'mixed'; selected?: boolean; expanded?: boolean; disabled?: boolean; focused?: boolean; required?: boolean; children?: PageNode[] };

export type Snapshot = { page: string; url: string; title: string; tree: PageNode[]; refs: number; nodes: number; cut?: string };

type ProtocolValue = { value?: unknown };
type ProtocolNode = {
  nodeId: string;
  parentId?: string;
  childIds?: string[];
  backendDOMNodeId?: number;
  ignored?: boolean;
  role?: { value?: string };
  name?: ProtocolValue;
  value?: ProtocolValue;
  description?: ProtocolValue;
  properties?: { name: string; value?: ProtocolValue }[];
};

type Privacy = 'public' | 'secret' | 'unknown';

// roles a person acts on: each gets a reference
const ACT = new Set(['button', 'link', 'textbox', 'searchbox', 'combobox', 'listbox', 'option', 'checkbox', 'radio', 'switch', 'slider', 'spinbutton',
  'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'treeitem', 'gridcell', 'columnheader', 'rowheader', 'textField', 'TextField']);
export const SKIP = new Set(['InlineTextBox', 'LineBreak', 'none', 'presentation']);
export const CONTAINER = new Set(['generic', 'group', 'Section', 'div', 'LayoutTable', 'LayoutTableRow', 'LayoutTableCell', 'paragraph', 'Pre']);
const STATES = ['checked', 'pressed', 'selected', 'expanded', 'disabled', 'focused', 'required'] as const;
const FIELD_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'listbox', 'spinbutton', 'textField', 'TextField']);
/** However a page is made, what is read of it is bounded: so many elements (texts too), so deep, so much text. */
export const TREE_LIMITS = { nodes: 5000, depth: 200, text: 1000, chars: 200_000 };

/** Convert Chromium's accessibility tree to the nodes and action references the model may see. Each element is counted
 *  before what it holds, so nothing past max is walked; a node is read once, however the tree loops back to it. */
export async function readAccessibleTree(
  nodes: ProtocolNode[],
  inspect: (id: number | undefined) => Promise<Privacy>,
  max: number,
  signal?: AbortSignal,
) {
  max = Math.max(1, Math.min(Math.floor(max) || 1, TREE_LIMITS.nodes));
  const byId = new Map(nodes.map(node => [node.nodeId, node]));
  const root = nodes.find(node => !node.parentId) ?? nodes[0];
  const fields = nodes.filter(node => !node.ignored && (
    node.value || node.properties?.some(p => p.name === 'editable') || FIELD_ROLES.has(node.role?.value ?? '')
  ));
  // Backend ids also reach fields inside shadow roots. Fields past what can be shown are not asked about: unknown.
  const privacy = new Map<string, Privacy>(await Promise.all(fields.slice(0, max).map(async node =>
    [node.nodeId, await inspect(node.backendDOMNodeId)] as const
  )));
  for (const node of fields.slice(max)) privacy.set(node.nodeId, 'unknown');
  signal?.throwIfAborted();
  const references = new Map<string, number>();
  const secretReferences = new Set<string>();
  const seen = new Set<string>();
  let count = 0;
  let cut = 0;
  let chars = 0;
  /** A text as the model reads it: one line, cut to TREE_LIMITS.text, and counted toward TREE_LIMITS.chars. */
  const said = (v: unknown) => {
    const s = ellipsis(asText(v ?? '').slice(0, TREE_LIMITS.text * 8).replace(/\s+/g, ' ').trim(), TREE_LIMITS.text);
    chars += s.length; return s;
  };
  /** What is left out under a node once the budget is spent: its elements counted, without recursion. */
  const leftOut = (start: ProtocolNode) => {
    for (const stack = [start]; stack.length;) {
      const n = stack.pop()!;
      if (seen.has(n.nodeId)) continue;
      seen.add(n.nodeId);
      const role = n.role?.value ?? '', named = !!asText(n.name?.value ?? '').trim();
      if (!n.ignored && !SKIP.has(role) && (named || (role !== 'StaticText' && !CONTAINER.has(role)) || privacy.has(n.nodeId))) cut++;
      for (const id of n.childIds ?? []) { const c = byId.get(id); if (c) stack.push(c); }
    }
  };

  function reference(id: number): string {
    const ref = `e${references.size + 1}`;
    references.set(ref, id);
    return ref;
  }

  function walk(n: ProtocolNode | undefined, depth: number): PageNode[] {
    if (!n || seen.has(n.nodeId)) return [];
    if (depth > TREE_LIMITS.depth || count >= max || chars >= TREE_LIMITS.chars) { leftOut(n); return []; }
    seen.add(n.nodeId);
    const role = n.role?.value ?? '';
    const name = said(n.name?.value);
    const field = privacy.get(n.nodeId);
    const inner = () => field && field !== 'public' ? [] : (n.childIds ?? []).flatMap(id => walk(byId.get(id), depth + 1));
    if (n.ignored || SKIP.has(role)) return inner();
    if (role === 'StaticText') { if (!name) return []; count++; return [{ role: 'text', name }]; }
    if (CONTAINER.has(role) && !name && !field) return inner();
    count++;
    if (field === 'unknown') return [{ role }];
    const node: PageNode = { role, ...(name ? { name } : {}) };
    const value = n.value?.value;
    const property = (key: string) => n.properties?.find(p => p.name === key)?.value?.value;
    if (field === 'secret') {
      node.secret = true;
      node.value = value !== undefined && value !== '' ? 'filled' : 'empty';
      if (name === String(value)) delete node.name;
      if (n.backendDOMNodeId && !property('disabled')) {
        node.ref = reference(n.backendDOMNodeId);
        secretReferences.add(node.ref);
      }
      return [node];
    }
    if (value !== undefined && value !== '' && asText(value) !== name) node.value = said(value);
    if (n.description?.value) node.description = said(n.description.value);
    const url = property('url');
    if (url && role === 'link') node.url = said(url);
    const level = property('level');
    if (typeof level === 'number') node.level = level;
    for (const state of STATES) {
      const value = property(state);
      if (value === true || value === 'mixed' || value === 'true') {
        Object.assign(node, { [state]: value === 'true' ? true : value });
      }
    }
    if (ACT.has(role) && n.backendDOMNodeId && !node.disabled) node.ref = reference(n.backendDOMNodeId);
    const merged = mergeText(inner()).filter(child => !(child.role === 'text' && child.name === name));
    if (merged.length) node.children = merged;
    return [node];
  }

  const top = walk(root, 0);
  const tree = top.length === 1 && (top[0].role === 'RootWebArea' || top[0].role === 'WebArea')
    ? top[0].children ?? [] : top;
  return { tree, title: top[0]?.name, references, secretReferences, count, cut };
}

/** Neighbouring texts, as one, up to TREE_LIMITS.text again. */
function mergeText(nodes: PageNode[]): PageNode[] {
  const out: PageNode[] = [];
  for (const n of nodes) {
    const prev = out[out.length - 1];
    if (n.role === 'text' && prev?.role === 'text' && (prev.name?.length ?? 0) < TREE_LIMITS.text) prev.name = `${prev.name} ${n.name}`.slice(0, TREE_LIMITS.text);
    else if (!(n.role === 'text' && prev?.role === 'text')) out.push(n);
  }
  return out;
}
