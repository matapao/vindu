import { expect, it } from 'vitest';
import { canSubmitApp } from '../src/apps.js';
import { resourceOf, toolResourceUri, toolVisibleTo } from '../src/index.js';

const uri = 'ui://connector/form';
const legacy = 'ui://connector/legacy';
const tool = (_meta: Record<string, unknown>) => ({ name: 'lookup', _meta });

it('reads current and legacy MCP App resource declarations and rejects malformed current URIs', () => {
  for (const [meta, expected] of [
    [{ ui: { resourceUri: uri }, 'ui/resourceUri': legacy }, uri],
    [{ 'ui/resourceUri': legacy }, legacy],
    [{ ui: { resourceUri: null }, 'ui/resourceUri': legacy }, undefined],
    [{ ui: { resourceUri: 'https://connector.test/form' } }, undefined],
    [{ 'ui/resourceUri': 42 }, undefined],
    [{}, undefined],
  ] as const) {
    const lookup = tool(meta);
    expect(toolResourceUri(lookup)).toBe(expected);
    expect(resourceOf([null, lookup], lookup.name)).toBe(expected);
  }
});

it('honors declared MCP audiences and denies malformed or empty declarations for both discovery and submission', () => {
  for (const [visibility, model, app] of [
    [undefined, true, true],
    [['app', 'model'], true, true],
    [['model'], true, false],
    [['app'], false, true],
    [[], false, false],
    ['app', false, false],
    [null, false, false],
    [['app', 'other'], false, false],
  ] as const) {
    const lookup = tool({ ui: { resourceUri: uri, visibility } });
    expect(toolVisibleTo(lookup, 'model')).toBe(model);
    expect(toolVisibleTo(lookup, 'app')).toBe(app);
    expect(canSubmitApp([lookup], lookup.name, uri)).toBe(app);
  }
});
