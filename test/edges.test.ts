// Values at the edges of what is drawn: two panels whose ids differ only in punctuation, an input's name with a slash
// in it, a chart of one very large value, a size that is not there, a sort over numbers with blanks among them, and
// resolved data without what a card draws. Each comes out as it should, or is refused, never drawn wrong. All
// synthetic; no window.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { BLOCKS, bytesIn, compile, Refusal, type ViewSpec } from '../src/index.js';
import type { PanelSpec, Resolved } from '../src/cards.js';
import { niceScale } from '../src/chart-svg.js';
import { shape } from '../src/view-rows.js';
import { componentIn, type SurfaceComponent } from './helpers.js';

test("each panel has a place of its own in the window: ids that would share one are refused; an input's name is one step of its path", () => {
  const two: ViewSpec = {
    name: 'v',
    title: 'V',
    panels: [
      { id: 'a-b', card: 'text' },
      { id: 'a_b', card: 'text' },
    ] as PanelSpec[],
  };
  const data: Record<string, Resolved> = { 'a-b': { text: 'one' }, a_b: { text: 'two' } };
  assert.throws(
    () => compile(two, data, { compact: false }),
    /panels "a-b" and "a_b" go by the same id in the window \(p_a_b\)/,
  );
  const view: ViewSpec = {
    name: 'v',
    title: 'V',
    panels: [{ id: 'k', card: 'text', inputs: { 'a/b': 2 } }] as PanelSpec[],
  };
  const field = componentIn<SurfaceComponent & { value: { path: string } }>(
    compile(view, { k: { text: 'what if', inputs: { 'a/b': 2 } } }, { compact: false }),
    (c) => c.id === 'p_k__in0',
  );
  assert.equal(field.value.path, '/panels/p_k/inputs/a~1b');
});

test('a chart of one value, at any size, has an axis around it; a size that is not there is not 0 B', () => {
  for (const [lo, hi] of [
    [1e16, 1e16],
    [0, 0],
    [-5, -5],
    [Infinity, 3],
  ]) {
    const s = niceScale(lo, hi);
    assert.ok(Number.isFinite(s.lo) && Number.isFinite(s.hi) && s.hi > s.lo && s.ticks.length > 1, `${lo}..${hi}`);
  }
  assert.deepEqual(
    [bytesIn(null), bytesIn(undefined), bytesIn(''), bytesIn(0), bytesIn(2048)],
    ['', '', '', '0 B', '2 KB'],
  );
});

test('a sort by numbers puts blanks below every number, never as 0, and keeps two blanks even', () => {
  const rows = [{ n: 2 }, { n: '' }, { n: -1 }, { n: null }, { n: 10 }, {}];
  const by = (sort: string) => shape(rows, { id: 't', card: 'table', sort }, []).map((r) => (r as { n?: unknown }).n);
  assert.deepEqual(by('n asc'), ['', null, undefined, -1, 2, 10]);
  assert.deepEqual(by('n desc'), [10, 2, -1, '', null, undefined]);
});

test('a host that compiles data of another shape is refused with what the card needs, never a TypeError from inside its drawing', () => {
  const cards = new Map(BLOCKS.map((b) => [b.name, b]));
  const view = (card: string): ViewSpec => ({
    name: 'v',
    title: 'V',
    panels: [{ id: 'x', card, x: 'a', y: 'b', label: 'a', time: 'a' }] as PanelSpec[],
  });
  const refused = (card: string, data: Record<string, Resolved>) => {
    try {
      compile(view(card), data, { compact: false, cards });
    } catch (e) {
      assert.ok(e instanceof Refusal, `${card}: ${String(e)}`);
      return e.message;
    }
    return assert.fail(`${card}: drawn`);
  };
  const needs = {
    table: 'rows',
    list: 'rows',
    timeline: 'rows',
    'bar-chart': 'rows',
    'line-chart': 'rows',
    record: 'record',
    media: 'media',
    gallery: 'gallery',
    page: 'page',
    code: 'page',
    diff: 'page',
    pdf: 'page',
    app: 'app',
    sheet: 'rows',
    message: 'rows',
    document: 'rows',
  };
  for (const [card, part] of Object.entries(needs))
    assert.match(
      refused(card, { x: {} }),
      new RegExp(`^panel x: a ${card} needs "${part}" in its resolved data: `),
      card,
    );
  assert.equal(
    refused('gallery', { x: { gallery: { name: 'a.png' } as never } }),
    'panel x: a gallery needs "gallery" in its resolved data: its pictures and videos, a list of {name, mime, url}',
  );
  assert.equal(
    refused('pdf', { x: { page: { url: 'http://127.0.0.1/pdf', label: 'a.pdf', uses: [], height: 600 } } }),
    'panel x: a pdf needs "pdf" in its resolved data: the PDF it shows, {name, bytes}',
  );
  assert.equal(
    refused('code', { x: { page: { url: 'http://127.0.0.1/code', label: 'a.ts', uses: [], height: 600 } } }),
    'panel x: a code needs "code" in its resolved data: the file it shows, {path, language, lines}',
  );
  assert.equal(refused('table', {}), 'panel x: a table needs its resolved data: there is none under "x"');
});
