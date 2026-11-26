// MCP Apps, hosted: the UI a server ships for one of its tools (a ui:// resource), in a frame of its own origin, with
// no fetch from the network unless the host allows the domains it declares. Off unless the host turns it on, overall or per connection:
// what an app draws is its own, so a view of it is opaque to the model, while what it is sent is exact.
// The window carries the app's postMessage JSON-RPC; this side answers it:
//   ui/notifications/initialized   → the tool's input and its exact result, as ui/notifications/tool-input and -result
//   tools/call                     → asked of the person first, then sent to the app's own server through the host
//   ui/update-model-context        → kept as what the app reported (images and other media left out: no pixels to the model)
//   ui/message, ui/open-link       → only through the host's own hooks, which put them before the person
//   resources/read                 → the app's own server's ui:// resources only
import type { AnswerEntry, Entry, ResultSource } from './results.js';
import { asText } from './format.js';

/** The exact request from a trusted host control for the currently mounted MCP App. */
export type AppSubmission = { view: string; panel: string; frame: string; name: string; arguments: Record<string, unknown> };

/** What a host gives Vindu to host apps: the app's server, reached on the processor's own connection (the host's tap or proxy). */
export type AppsProvider = {
  tools(server: string): unknown[] | undefined;                    // what the server listed, with each tool's _meta
  read(server: string, uri: string): Promise<{ contents?: { uri: string; mimeType?: string; text?: string; blob?: string; _meta?: unknown }[] }>;
  call(server: string, tool: string, args: unknown): Promise<unknown>; // a CallToolResult
  result?(entry: string): unknown;                                 // the exact CallToolResult of a recorded result, where the host keeps it
};
export type AppsSwitch = 'off' | 'on' | { default?: 'off' | 'on'; servers?: Record<string, 'off' | 'on'> };
export const appsOn = (s: AppsSwitch | undefined, server: string) =>
  s === 'on' || (typeof s === 'object' && (s.servers?.[server] ?? s.default ?? 'off') === 'on');
export const anyAppsOn = (s: AppsSwitch | undefined) => s === 'on' || (typeof s === 'object' && (s.default === 'on' || Object.values(s.servers ?? {}).includes('on')));

// What MCP Apps (the ext-apps spec) says on a listed tool, read here so the SDK carries no app runtime of its own: the
// app's resource (_meta.ui.resourceUri, or the older flat _meta["ui/resourceUri"]) and who may call the tool.
/** Who a tool is for: the model, the app, or both (the default). */
export type McpUiToolVisibility = 'model' | 'app';
type ListedTool = { name: string; _meta?: { [key: string]: unknown } };
const RESOURCE_URI_META_KEY = 'ui/resourceUri';
/** A ui:// resource, or nothing: one that is not a ui:// address is no app's. */
const getToolUiResourceUri = (tool: ListedTool): string | undefined => {
  const ui = tool._meta?.ui as { resourceUri?: unknown } | undefined;
  const uri = ui?.resourceUri !== undefined ? ui.resourceUri : tool._meta?.[RESOURCE_URI_META_KEY];
  return typeof uri === 'string' && uri.startsWith('ui://') ? uri : undefined;
};
/** A tool's ui metadata, as the spec's schema reads it: an object whose visibility, if said, lists model and/or app. */
const visibilityOf = (ui: unknown): { ok: false } | { ok: true; visibility?: McpUiToolVisibility[] } => {
  if (!ui || typeof ui !== 'object' || Array.isArray(ui)) return { ok: false };
  const said = (ui as { visibility?: unknown }).visibility;
  if (said === undefined) return { ok: true };
  return Array.isArray(said) && said.every(v => v === 'model' || v === 'app') ? { ok: true, visibility: said as McpUiToolVisibility[] } : { ok: false };
};

function findTool(tools: unknown[] | undefined, name: string) {
  return (tools as ListedTool[] | undefined)?.find(tool => tool?.name === name);
}

/** Read a single tool's advertised MCP App URI, including the legacy metadata form. */
export function toolResourceUri(tool: ListedTool): string | undefined {
  return getToolUiResourceUri(tool);
}

export function resourceOf(tools: unknown[] | undefined, name: string): string | undefined {
  const tool = findTool(tools, name);
  return tool && toolResourceUri(tool);
}

/** Both audiences are allowed by default. A malformed or empty visibility declaration grants neither. */
export function toolVisibleTo(tool: ListedTool, audience: McpUiToolVisibility): boolean {
  const meta = tool._meta;
  if (meta === undefined) return true;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return false;
  if (meta.ui === undefined) return true;
  const read = visibilityOf(meta.ui);
  return read.ok && (read.visibility?.includes(audience) ?? true);
}

function forApp(tools: unknown[] | undefined, name: string): boolean {
  const tool = findTool(tools, name);
  return !!tool && toolVisibleTo(tool, 'app');
}

/** A host submit is tied to the tool whose resource is mounted here. Recheck current discovery on every call. */
export function canSubmitApp(tools: unknown[] | undefined, tool: string, uri: string): boolean {
  return resourceOf(tools, tool) === uri && !!uri && forApp(tools, tool);
}

/** The app's HTML from its resource: text, or base64 in blob. */
export async function appHtml(p: AppsProvider, server: string, uri: string) {
  const r = await p.read(server, uri); const c = r.contents?.find(x => x.uri === uri) ?? r.contents?.[0];
  if (!c) throw new Error(`${server} has no resource ${uri}`);
  const html = c.text ?? (c.blob ? Buffer.from(c.blob, 'base64').toString('utf8') : '');
  return { html, csp: (c._meta as { ui?: { csp?: Record<string, string[]> } } | undefined)?.ui?.csp };
}

/** The CallToolResult an app is given: the host's exact copy, or the recorded result as content and structured content. */
export function resultFor(p: AppsProvider | undefined, e: Entry): unknown {
  const exact = p?.result?.(e.id); if (exact !== undefined) return exact;
  if (e.kind !== 'result') return { content: [] };
  const data = e.rows ?? e.value;
  if (data === undefined) return { content: [{ type: 'text', text: e.text }] };
  // structured content is an object: a list goes in one, as its rows
  return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: typeof data === 'object' && !Array.isArray(data) ? data : { rows: data } };
}

/** Only what words and data say: images, audio and embedded files an app reports never reach the model. */
export function textOnly(blocks: unknown): { text: string; dropped: number } {
  const xs = Array.isArray(blocks) ? blocks as { type?: string; text?: string }[] : [];
  return { text: xs.filter(b => b.type === 'text' && typeof b.text === 'string').map(b => b.text!).join('\n').slice(0, 4000), dropped: xs.filter(b => b.type !== 'text').length };
}

export type AppPanel = { server: string; tool: string; uri: string; result: string };
export type AppHooks = {
  ask(title: string, message: string): Promise<boolean>;            // the person's yes or no, in the window
  record(e: Omit<AnswerEntry, 'id' | 'kind' | 'at'>): AnswerEntry;
  send(msg: Record<string, unknown>): void;                         // back to the app's frame
  onMessage?: (text: string) => Promise<void> | void;               // a message the app wants sent: the person decides
  onOpenLink?: (url: string) => Promise<void> | void;               // a link the app wants opened: the person decides
};

/** One message from an app's frame, answered as the protocol asks. */
export async function fromApp(a: AppPanel, msg: Record<string, unknown>, results: ResultSource, p: AppsProvider | undefined, h: AppHooks): Promise<void> {
  const id = msg.id; const method = asText(msg.method ?? '');
  const reply = (result: unknown) => { if (id !== undefined) h.send({ jsonrpc: '2.0', id, result }); };
  const fail = (code: number, message: string) => { if (id !== undefined) h.send({ jsonrpc: '2.0', id, error: { code, message } }); };
  const params = (msg.params ?? {}) as Record<string, unknown>;
  const e = results.get(a.result);
  switch (method) {
    case 'ui/initialize': return; // the window answered it: it knows the theme, the size and the locale
    case 'ui/notifications/initialized':
      if (!e || e.kind !== 'result') return;
      h.send({ jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: { arguments: e.input ?? {} } });
      h.send({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: resultFor(p, e) });
      return;
    case 'ping': return reply({});
    case 'ui/request-display-mode': return reply({ mode: 'inline' });
    case 'tools/call': {
      const name = asText(params.name ?? ''); const args = params.arguments ?? {};
      if (!p) return fail(-32603, 'this host reaches no servers for apps');
      if (!forApp(p.tools(a.server), name)) return fail(-32602, `${name} is not a tool the app may call`);
      const yes = await h.ask(`The ${a.server} app wants to run ${name}`, `with ${JSON.stringify(args)}`);
      if (!yes) return fail(-32001, 'the person said no');
      if (!forApp(p.tools(a.server), name)) return fail(-32602, `${name} is no longer available to the app`);
      try { const r = await p.call(a.server, name, args); h.record({ to: `${a.server}.${name}, called by its app`, by: 'app', values: { arguments: args }, output: r }); return reply(r); }
      catch (err) { return fail(-32603, (err as Error).message); }
    }
    case 'ui/update-model-context': {
      const t = textOnly(params.content);
      const values = { ...(params.structuredContent && typeof params.structuredContent === 'object' ? params.structuredContent as Record<string, unknown> : {}), ...(t.text ? { text: t.text } : {}) };
      h.record({ to: `the ${a.server} app's context (on ${a.result})`, by: 'app', values: { ...values, ...(t.dropped ? { left_out: `${t.dropped} non-text block${t.dropped > 1 ? 's' : ''}` } : {}) } });
      return reply({});
    }
    case 'ui/message': {
      const t = textOnly(params.content);
      if (!h.onMessage) return fail(-32601, 'this host takes no messages from apps');
      await h.onMessage(t.text); return reply({});
    }
    case 'ui/open-link': {
      const url = asText(params.url ?? '');
      if (!h.onOpenLink || !/^https?:\/\//.test(url)) return fail(-32601, 'this host opens no links for apps');
      await h.onOpenLink(url); return reply({});
    }
    case 'resources/read': {
      const uri = asText(params.uri ?? '');
      if (!p || !uri.startsWith('ui://')) return fail(-32602, 'an app reads its own ui:// resources only');
      try { return reply(await p.read(a.server, uri)); } catch (err) { return fail(-32603, (err as Error).message); }
    }
    default:
      if (id !== undefined && method) return fail(-32601, `no method ${method}`);
  }
}
