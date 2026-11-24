// The JSON-RPC 2.0 an MCP App's frame speaks with the window (MCP Apps, as ext-apps 2026-01-26 has it), checked as the
// MCP SDK's own schemas check it, in plain code: the window carries an app's messages without the SDK, and so without
// Zod, in the browser. Only requests and notifications: the window sends an app no requests, so it takes no responses.

/** The MCP Apps protocol the window speaks, and the older one it still answers in, for apps made before it. */
export const APPS_PROTOCOL = '2026-01-26';
export const LEGACY_APPS_PROTOCOL = '2025-11-21';

export type RpcId = string | number;
/** A request (it has an id) or a notification, as an app sent it. */
export type AppRpc = { jsonrpc: '2.0'; id?: RpcId; method: string; params?: Record<string, unknown> };

const RELATED_TASK = 'io.modelcontextprotocol/related-task';
const DISPLAY_MODES: readonly unknown[] = ['inline', 'fullscreen', 'pip'];

/** An object, as a JSON-RPC object is one: not null, not an array. */
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
/** A record of keys, as Zod takes one: an object made as a literal is, a Date or a Map is not. */
function isRecord(value: unknown): value is Record<string, unknown> {
  if (!isObject(value)) return false;
  const made = value.constructor;
  if (typeof made !== 'function') return true;
  return isObject(made.prototype) && Object.hasOwn(made.prototype, 'isPrototypeOf');
}
const isString = (value: unknown): value is string => typeof value === 'string';
const isStrings = (value: unknown) => Array.isArray(value) && Array.from(value).every(isString);
const optional = (value: unknown, check: (value: unknown) => boolean) => value === undefined || check(value);
/** A request's id: a string, or an integer JSON holds exactly. */
const isId = (value: unknown): value is RpcId => isString(value) || Number.isSafeInteger(value);

/** An object's own keys and values, as a fresh object: never a key that would set its prototype. */
const copyOf = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== '__proto__'));

/** MCP's _meta on params: an object, its progress token an id, its related task a task's id. */
function metaOf(value: unknown): Record<string, unknown> | null {
  if (!isObject(value) || !optional(value.progressToken, isId)) return null;
  const task = value[RELATED_TASK];
  if (task !== undefined && !(isObject(task) && isString(task.taskId))) return null;
  const meta = copyOf(value);
  if (task !== undefined) meta[RELATED_TASK] = { taskId: (task as { taskId: string }).taskId };
  return meta;
}

/** A message's params: none, or an object (copied) whose _meta is MCP's; null when they are neither. */
function paramsOf(value: unknown): Record<string, unknown> | undefined | null {
  if (value === undefined) return undefined;
  if (!isObject(value)) return null;
  const params = copyOf(value);
  if (params._meta !== undefined) {
    const meta = metaOf(params._meta);
    if (!meta) return null;
    params._meta = meta;
  }
  return params;
}

/** An app's message as the window takes it: a JSON-RPC 2.0 request or notification with nothing else in it, copied;
 *  undefined for anything else (a response among them). */
export function appRpcOf(data: unknown): AppRpc | undefined {
  if (!isObject(data) || data.jsonrpc !== '2.0' || !isString(data.method)) return undefined;
  const request = Object.hasOwn(data, 'id');
  if (request && !isId(data.id)) return undefined;
  for (const key of Object.keys(data)) {
    if (key !== 'jsonrpc' && key !== 'method' && key !== 'params' && !(request && key === 'id')) return undefined;
  }
  const params = paramsOf(data.params);
  if (params === null) return undefined;
  return { jsonrpc: '2.0', ...(request ? { id: data.id as RpcId } : {}), method: data.method, ...(params ? { params } : {}) };
}

const isIcon = (value: unknown) => isObject(value) && isString(value.src) && optional(value.mimeType, isString) &&
  optional(value.sizes, isStrings) && optional(value.theme, theme => theme === 'light' || theme === 'dark');
/** Who the app is: MCP's Implementation. */
const isImplementation = (value: unknown) => isObject(value) && isString(value.name) && isString(value.version) &&
  optional(value.title, isString) && optional(value.websiteUrl, isString) && optional(value.description, isString) &&
  optional(value.icons, icons => Array.isArray(icons) && Array.from(icons).every(isIcon));
/** What the app can do: MCP Apps' McpUiAppCapabilities. */
const isAppCapabilities = (value: unknown) => isObject(value) &&
  optional(value.experimental, features => isRecord(features) && Object.values(features).every(isRecord)) &&
  optional(value.tools, tools => isObject(tools) && optional(tools.listChanged, on => typeof on === 'boolean')) &&
  optional(value.availableDisplayModes, modes => Array.isArray(modes) && Array.from(modes).every(mode => DISPLAY_MODES.includes(mode)));

/** The params of ui/initialize, as MCP Apps' McpUiInitializeRequest has them. */
export type InitializeParams = { protocolVersion: string; appInfo: Record<string, unknown>; appCapabilities: Record<string, unknown> };
export function isInitializeParams(params: unknown): params is InitializeParams {
  return isObject(params) && isString(params.protocolVersion) && isImplementation(params.appInfo) && isAppCapabilities(params.appCapabilities);
}

/** A display mode MCP Apps names. */
export const isDisplayMode = (mode: unknown) => DISPLAY_MODES.includes(mode);
