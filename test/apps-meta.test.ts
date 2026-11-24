import assert from 'node:assert/strict';
import { test } from 'vitest';
import { getToolUiResourceUri, McpUiToolMetaSchema } from '@modelcontextprotocol/ext-apps/app-bridge';
import { toolResourceUri, toolVisibleTo } from '../src/apps.js';

// The SDK reads a tool's MCP Apps metadata itself, so it ships no app runtime; it must read it as the spec's own code does.
const metas: unknown[] = [
  undefined, null, [], 'x', {}, { ui: undefined }, { ui: null }, { ui: [] }, { ui: 'ui://s' },
  { ui: { resourceUri: 'ui://server/app.html' } }, { 'ui/resourceUri': 'ui://legacy/app.html' },
  { ui: { resourceUri: 'ui://new' }, 'ui/resourceUri': 'ui://old' }, { ui: {}, 'ui/resourceUri': 'ui://old' },
  { ui: 'str', 'ui/resourceUri': 'ui://old' }, { ui: { resourceUri: 'https://not-an-app' } }, { ui: { resourceUri: 5 } },
  { 'ui/resourceUri': 'http://x' }, { ui: { visibility: ['app'] } }, { ui: { visibility: ['model'] } },
  { ui: { visibility: ['model', 'app'] } }, { ui: { visibility: [] } }, { ui: { visibility: ['other'] } },
  { ui: { visibility: 'app' } }, { ui: { visibility: undefined, resourceUri: 'ui://v' } }, { other: 1 },
];
const visibility = McpUiToolMetaSchema.pick({ visibility: true });
const specVisibleTo = (meta: unknown, audience: 'model' | 'app') => {
  if (meta === undefined) return true;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return false;
  const ui = (meta as { ui?: unknown }).ui;
  if (ui === undefined) return true;
  const r = visibility.safeParse(ui);
  return r.success && (r.data.visibility?.includes(audience) ?? true);
};

test('a tool\'s app resource and visibility are read exactly as the ext-apps spec code reads them', () => {
  for (const _meta of metas) {
    const tool = { name: 't', _meta } as never;
    let spec: string | undefined;
    try { spec = getToolUiResourceUri(tool); } catch { spec = undefined; }
    if (_meta !== null && typeof _meta === 'object' && !Array.isArray(_meta)) assert.equal(toolResourceUri(tool), spec, JSON.stringify(_meta));
    for (const audience of ['model', 'app'] as const) assert.equal(toolVisibleTo(tool, audience), specVisibleTo(_meta, audience), `${audience} ${JSON.stringify(_meta)}`);
  }
});
