import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, vi } from 'vitest';
import { memoryResults, startVindu } from '../src/index.js';
import { getRaw, mcpClient } from './helpers.js';

test('a failed MCP bind rejects startup and closes the page listener', async () => {
  const error = new Error('Local listener unavailable');
  const listeners: Server[] = [];
  // the original, called below with each server as this: read as a function of the server it is called on
  const prototype: { listen: (this: Server, ...args: Parameters<Server['listen']>) => Server } = Server.prototype;
  const listen = prototype.listen;
  const spy = vi.spyOn(Server.prototype, 'listen').mockImplementation(function (
    this: Server,
    ...args: Parameters<typeof listen>
  ) {
    listeners.push(this);
    if (listeners.length === 1) return listen.apply(this, args);
    queueMicrotask(() => this.emit('error', error));
    return this;
  });
  try {
    await assert.rejects(startVindu(), error);
    assert.equal(listeners.length, 2);
    assert.equal(listeners[0].listening, false);
  } finally {
    spy.mockRestore();
  }
});

test('the local MCP endpoint checks its host, browser origin and session path before dispatch', async () => {
  const provider = await startVindu();
  const dir = mkdtempSync(join(tmpdir(), 'vindu-mcp-'));
  try {
    const session = provider.open({ dir, results: memoryResults(dir) });
    const { origin, pathname, port } = new URL(session.url);
    assert.equal(await getRaw(origin, pathname, { host: `other.example:${port}` }), 403);
    assert.equal(await getRaw(origin, pathname, { origin: 'https://other.example' }), 403);
    assert.equal(await getRaw(origin, pathname, { origin: 'null' }), 403);
    assert.equal(await getRaw(origin, '//invalid'), 400);
    assert.equal(await getRaw(origin, pathname + '/extra'), 404);
    for (const requestInit of [undefined, { headers: { origin } }]) {
      const { mcp } = await mcpClient(session.url, requestInit);
      try {
        assert.ok((await mcp.listTools()).tools.some((tool) => tool.name === 'look'));
      } finally {
        await mcp.close();
      }
    }
    session.close();
    assert.equal(await getRaw(origin, pathname), 404);
  } finally {
    await provider.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a layout client learns only geometry and leaves the task’s private context unread', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vindu-layout-client-'));
  const provider = await startVindu();
  const results = memoryResults(dir);
  const about = vi.fn<() => { text: string }>(() => ({ text: 'private pane contents' }));
  const task = provider.open({ dir, results });
  const otherDir = mkdtempSync(join(dir, 'other-'));
  const other = provider.open({ dir: otherDir, results: memoryResults(otherDir) });
  const clients = [];
  try {
    task.pane({ name: 'private-id', title: 'private title', kind: 'private kind', about });
    task.tell('private pending selection');
    const geometry = await mcpClient(task.layoutMcpServer.url);
    clients.push(geometry.mcp);
    assert.notEqual(task.layoutMcpServer.url, task.mcpServer.url);
    assert.deepEqual(
      (await geometry.mcp.listTools()).tools.map((tool) => tool.name),
      ['read_layout'],
    );
    assert.equal(geometry.mcp.getInstructions(), undefined);
    const initial = await geometry.json('read_layout', {});
    assert.equal(initial.paneCount, 1);
    assert.equal(initial.viewport.source, 'estimated');
    assert.doesNotMatch(JSON.stringify(initial), /private/i);
    results.add({ server: 'private connector', tool: 'private tool', value: { account: 'private account' } });
    assert.deepEqual(await geometry.json('read_layout', {}), initial);
    assert.equal(about.mock.calls.length, 0);
    assert.match(task.delta(), /private pending selection/);

    // Read permissions are properties of the endpoint, even if a client requests another tool directly.
    await assert.rejects(geometry.json('ctx_read', { ref: 'ctx:r1' }), /tool|method/i);
    const taskClient = await mcpClient(task.mcpServer.url);
    clients.push(taskClient.mcp);
    assert.match(JSON.stringify(await taskClient.json('ctx_read', { ref: 'ctx:r1' })), /private account/);
    const otherClient = await mcpClient(other.layoutMcpServer.url);
    clients.push(otherClient.mcp);
    assert.equal((await otherClient.json('read_layout', {})).paneCount, 0);
    task.close();
    assert.equal((await fetch(task.layoutMcpServer.url)).status, 404);
    assert.equal((await otherClient.json('read_layout', {})).paneCount, 0);
  } finally {
    await Promise.all(clients.map((client) => client.close()));
    await provider.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a session can carry its MCP token as Authorization: Bearer, out of the URL; the path form keeps working', async () => {
  const provider = await startVindu({ mcpTokenIn: 'header' });
  const dir = mkdtempSync(join(tmpdir(), 'vindu-mcp-'));
  try {
    const session = provider.open({ dir, results: memoryResults(dir) });
    const { url, headers } = session.mcpServer;
    assert.match(url, /\/mcp$/);
    assert.match(headers.Authorization ?? '', /^Bearer [a-f0-9]{32}$/);
    const { origin } = new URL(url);
    assert.equal(await getRaw(origin, '/mcp'), 404); // no token, no session
    assert.equal(await getRaw(origin, '/mcp', { authorization: `Bearer ${'0'.repeat(32)}` }), 404); // not a session's token
    const { mcp } = await mcpClient(url, { headers });
    try {
      assert.ok((await mcp.listTools()).tools.some((tool) => tool.name === 'look'));
    } finally {
      await mcp.close();
    }
    const { mcp: byPath } = await mcpClient(session.url); // the path form, as before
    try {
      assert.ok((await byPath.listTools()).tools.some((tool) => tool.name === 'look'));
    } finally {
      await byPath.close();
    }
    session.close();
  } finally {
    await provider.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
