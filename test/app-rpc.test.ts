// The window's plain JSON-RPC for MCP App frames (src/renderer/app-rpc.ts) takes exactly what the MCP SDK's own schemas
// take, which the window no longer loads: every message here is checked both ways, and what passes is the same. Of the
// responses, the window takes only an app's answer to the one request it sends it itself (ui/resource-teardown).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { JSONRPCMessageSchema, JSONRPCResponseSchema } from '@modelcontextprotocol/core';
import { LATEST_PROTOCOL_VERSION, McpUiInitializeRequestSchema } from '@modelcontextprotocol/ext-apps/app-bridge';
import { APPS_PROTOCOL, appRpcOf, isDisplayMode, isInitializeParams, isResponseTo } from '../src/renderer/app-rpc.js';

const json = (value: unknown) => JSON.parse(JSON.stringify(value));
const each = <T>(lists: T[][]): T[][] => lists.reduce<T[][]>((all, list) => all.flatMap(a => list.map(b => [...a, b])), [[]]);
const MISSING = Symbol('missing');
const build = (entries: [string, unknown][]) => Object.fromEntries(entries.filter(([, v]) => v !== MISSING));

test('the protocol version is the one MCP Apps names', () => {
  assert.equal(APPS_PROTOCOL, LATEST_PROTOCOL_VERSION);
  assert.deepEqual(['inline', 'fullscreen', 'pip', 'popup', undefined].map(isDisplayMode), [true, true, true, false, false]);
});

test('a message is a request or a notification exactly when the SDK says so, and reads the same', () => {
  const ids = [MISSING, 1, 0, -3, 'a', '', 1.5, 2 ** 60, NaN, Infinity, null, undefined, true, {}];
  const methods = [MISSING, 'tools/call', '', 5, null];
  const metas = [MISSING, undefined, {}, { progressToken: 'p' }, { progressToken: 2 }, { progressToken: 1.5 }, { progressToken: null },
    { 'io.modelcontextprotocol/related-task': { taskId: 't', extra: 1 } }, { 'io.modelcontextprotocol/related-task': { taskId: 3 } },
    { 'io.modelcontextprotocol/related-task': null }, { other: { deep: [1] } }, [], 'meta', null];
  const params = [MISSING, undefined, null, [], 'x', 3, new Date(0), new Map(), { a: 1 }, ...metas.filter(m => m !== MISSING).map(m => ({ _meta: m, b: 2 }))];
  const versions = [MISSING, '2.0', '1.0', 2];
  const extras = [MISSING, 1];
  let checked = 0;
  for (const [jsonrpc, id, method, param, extra] of each<unknown>([versions, ids, methods, params, extras])) {
    const message = build([['jsonrpc', jsonrpc], ['id', id], ['method', method], ['params', param], ['result', extra]]);
    const sdk = JSONRPCMessageSchema.safeParse(message);
    const expected = sdk.success && 'method' in sdk.data ? sdk.data : undefined;
    const ours = appRpcOf(message);
    assert.equal(ours !== undefined, expected !== undefined, JSON.stringify(message, (_k, v) => (v === undefined ? '(undefined)' : v)));
    if (ours) assert.deepEqual(json(ours), json(expected));
    checked++;
  }
  assert.ok(checked > 10_000);
  // a key that would set the prototype is not copied, as the SDK drops it too
  const proto = JSON.parse('{"jsonrpc":"2.0","id":1,"method":"x","params":{"__proto__":{"polluted":true},"a":1}}');
  assert.deepEqual(json(appRpcOf(proto)), json(JSONRPCMessageSchema.parse(proto)));
  assert.equal(Object.getPrototypeOf(appRpcOf(proto)!.params), Object.prototype);
});

test('a response is the answer to the window\'s request exactly when the SDK reads it as a response with its id', () => {
  const sent = 'vindu-teardown-1';
  const ids = [MISSING, sent, 'vindu-teardown-2', 1, null];
  const results = [MISSING, undefined, {}, { saved: true }, { _meta: {} }, { _meta: { other: 1 } }, { _meta: null }, { _meta: [] }, null, [], 'done', 1, new Date(0)];
  const errors = [MISSING, undefined, { code: -32601, message: 'Method not found' }, { code: 1, message: 'm', data: [1], extra: 2 }, { code: 1.5, message: 'm' },
    { code: 1 }, { message: 'm' }, { code: 1, message: 2 }, null, [], 'error'];
  const versions = [MISSING, '2.0', '1.0'];
  const methods = [MISSING, 'ui/resource-teardown'];
  let answers = 0;
  for (const [jsonrpc, id, result, error, method] of each<unknown>([versions, ids, results, errors, methods])) {
    const message = build([['jsonrpc', jsonrpc], ['id', id], ['result', result], ['error', error], ['method', method]]);
    const response = JSONRPCResponseSchema.safeParse(message).success;
    const shown = JSON.stringify(message, (_k, v) => (v === undefined ? '(undefined)' : v));
    assert.equal(isResponseTo(message, sent), response && message.id === sent, shown);
    if (response) assert.equal(appRpcOf(message), undefined, shown); // every response, the answer among them, is no app's request
    if (response && message.id === sent) answers++;
  }
  assert.ok(answers > 5);
  assert.equal(isResponseTo({ jsonrpc: '2.0', id: 1, result: {} }, 1), true);
  assert.equal(isResponseTo(null, sent), false);
});

test('ui/initialize params are valid exactly when MCP Apps says so', () => {
  const infos = [undefined, null, [], {}, { name: 'a' }, { name: 'a', version: '1' }, { name: 'a', version: 1 }, { name: 'a', version: '1', title: 't', websiteUrl: 'u', description: 'd', extra: 1 },
    { name: 'a', version: '1', title: 2 }, { name: 'a', version: '1', icons: [] }, { name: 'a', version: '1', icons: [{ src: 's', mimeType: 'image/png', sizes: ['16x16'], theme: 'dark' }] },
    { name: 'a', version: '1', icons: [{ src: 's', theme: 'blue' }] }, { name: 'a', version: '1', icons: [{ src: 's', sizes: [1] }] }, { name: 'a', version: '1', icons: {} }];
  const capabilities = [undefined, null, [], {}, { other: 1 }, { experimental: {} }, { experimental: { x: {} } }, { experimental: { x: { y: 1 } } }, { experimental: { x: 1 } },
    { experimental: { x: [] } }, { experimental: { x: new Date(0) } }, { experimental: [] }, { experimental: new Map() }, { tools: {} }, { tools: { listChanged: true } },
    { tools: { listChanged: 'yes' } }, { tools: null }, { availableDisplayModes: [] }, { availableDisplayModes: ['inline', 'pip'] }, { availableDisplayModes: ['tab'] },
    { availableDisplayModes: 'inline' }, { availableDisplayModes: [undefined, 'inline'] }];
  const versions = [undefined, APPS_PROTOCOL, '2025-11-21', '', 5];
  for (const [protocolVersion, appInfo, appCapabilities] of each<unknown>([versions, infos, capabilities])) {
    const params = { protocolVersion, appInfo, appCapabilities };
    const sdk = McpUiInitializeRequestSchema.safeParse({ jsonrpc: '2.0', id: 1, method: 'ui/initialize', params }).success;
    assert.equal(isInitializeParams(params), sdk, JSON.stringify(params));
  }
  assert.equal(isInitializeParams(null), false);
});
