// Run the public provider on the consumer's Node, including versions older than our build tools.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { memoryResults, startVindu } from '@matapao/vindu/server';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

test('a host can show a tool result and read its layout over MCP', async t => {
  const provider = await startVindu();
  const dir = mkdtempSync(join(tmpdir(), 'vindu-runtime-'));
  const clients = [];
  t.after(async () => {
    try {
      await Promise.all(clients.map(client => client.close()));
    } finally {
      await provider.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  async function connect(endpoint) {
    const client = new Client({ name: 'runtime-check', version: '1' });
    clients.push(client);
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint.url), {
      requestInit: { headers: endpoint.headers },
    }));
    return client;
  }

  const results = memoryResults(dir);
  const views = [];
  const task = provider.open({ dir, results }, { onView: view => views.push(view) });
  const row = results.add({ server: 'inventory', tool: 'list', value: [{ quantity: 7 }] });
  task.result(row.id);
  const ui = await connect(task.mcpServer);
  const shown = await ui.callTool({
    name: 'show_view',
    arguments: { name: 'inventory', title: 'Inventory', panels: [{ card: 'table', from: row.id }] },
  });
  assert.ok(!shown.isError, JSON.stringify(shown.content));
  assert.equal(views.at(-1)?.name, 'inventory');

  const coordinator = await connect(task.layoutMcpServer);
  assert.deepEqual((await coordinator.listTools()).tools.map(tool => tool.name), ['read_layout']);
  const layout = await coordinator.callTool({ name: 'read_layout', arguments: {} });
  assert.ok(!layout.isError, JSON.stringify(layout.content));
  assert.equal(JSON.parse(layout.content[0].text).paneCount, 1);
});
