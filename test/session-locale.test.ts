// A window's own locale and time zone, over the provider's: given as it opens, and changed with its words while its
// views are shown, each view drawn again where it is with its numbers and dates in the new locale; the model told
// nothing, and each account saying the locale its view is drawn in. One that is none is refused. All synthetic.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CELL_RULE, memoryResults, startVindu, VIEW_WORDS_NN, type Shown } from '../src/index.js';
import { mcpClient } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const rows = [{ kunde: 'Havgap Media', beløp: 48250.5, forfall: '2026-12-04' }];
const VIEW = { name: 'owed', title: 'Owed', panels: [{ id: 'all', card: 'table', from: 'r1' }, { id: 'todo', card: 'tasks', from: 'r1', map: { title: 'kunde', due: 'forfall' } }] };

async function providerWith(more: Record<string, unknown> = {}) {
  const vindu = await startVindu({ waitMs: 300, locale: 'en-GB', timeZone: 'UTC' });
  const open = (options: Record<string, unknown> = {}) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'locale-')), results = memoryResults(dir);
    results.add({ server: 'accounts', tool: 'owed', value: rows });
    const shown: Shown[] = [];
    const ui = vindu.open({ results, dir }, { onView: v => shown.push(v), ...options });
    // the view of what is owed as last drawn: its data, and its tasks block
    const owed = () => shown.filter(v => v.name === 'owed').at(-1)!;
    const panels = () => (owed().wide.find(m => (m as any).updateDataModel) as any).updateDataModel.value.panels;
    const tasks = () => ((owed().wide.find(m => (m as any).updateComponents) as any).updateComponents.components as any[]).find(c => c.component === 'VTasks');
    return { ui, shown, amount: () => panels().p_all.rows[0].c1 as string, tasks, panels };
  };
  return { vindu, open, first: open(more) };
}

test('a window opened in its own locale writes its values in it, and its account says so; another keeps the provider\'s', async () => {
  const p = await providerWith({ locale: 'nb-NO', timeZone: 'Europe/Oslo' });
  const other = p.open();
  const [a, b] = await Promise.all([mcpClient(p.first.ui.url), mcpClient(other.ui.url)]);
  try {
    const own = await a.json('show_view', VIEW), plain = await b.json('show_view', VIEW);
    assert.equal(p.first.amount(), '48\u00a0250,5');
    assert.deepEqual([p.first.tasks().locale, p.first.tasks().timeZone], ['nb-NO', 'Europe/Oslo']); // the blocks' dates too
    assert.deepEqual(own.format, { locale: 'nb-NO', timeZone: 'Europe/Oslo', cells: CELL_RULE });
    assert.equal(other.amount(), '48,250.5');
    assert.deepEqual(plain.format, { locale: 'en-GB', timeZone: 'UTC', cells: CELL_RULE });
  } finally { await a.mcp.close(); await b.mcp.close(); p.first.ui.close(); other.ui.close(); await p.vindu.close(); }
});

test('the locale changed with the words while the window runs: every view drawn again in it, the model told nothing, the next account in it', async () => {
  const p = await providerWith(), w = p.first;
  const c = await mcpClient(w.ui.url);
  try {
    const before = await c.json('show_view', VIEW);
    await c.json('show_view', { name: 'note', title: 'Note', panels: [{ id: 'n', card: 'text', text: 'Call them.' }], place: { beside: 'owed' } });
    assert.equal(w.ui.delta(), '');
    const count = w.shown.length;
    await w.ui.setViewWords(VIEW_WORDS_NN, { locale: 'nn-NO' });
    assert.equal(w.shown.length, count + 2); // each view drawn again, once
    assert.equal(w.amount(), '48\u00a0250,5');
    assert.deepEqual([w.tasks().locale, w.tasks().timeZone, w.panels().p_todo.props.words], ['nn-NO', 'UTC', VIEW_WORDS_NN.tasks]); // in its words too
    assert.equal(w.ui.delta(), ''); // nothing for the model: what it is told is in English either way
    assert.equal(before.format.locale, 'en-GB'); // the account given before says the locale it was drawn in
    const after = await c.json('show_view', VIEW);
    assert.deepEqual(after.format, { locale: 'nn-NO', timeZone: 'UTC', cells: CELL_RULE }); // the time zone it had
    await w.ui.setViewWords(VIEW_WORDS_NN, { timeZone: 'Europe/Oslo' });
    assert.deepEqual((await c.json('show_view', VIEW)).format, { locale: 'nn-NO', timeZone: 'Europe/Oslo', cells: CELL_RULE });
    // a locale or time zone that is none is refused, and nothing changes
    const drawn = w.shown.length;
    await assert.rejects(w.ui.setViewWords(undefined, { locale: 'nb_NO' }), /locale: "nb_NO" is not a language tag/);
    await assert.rejects(w.ui.setViewWords(undefined, { timeZone: 'Oslo' }), /timeZone: "Oslo" is not a time zone/);
    assert.equal(w.shown.length, drawn);
    assert.deepEqual((await c.json('show_view', VIEW)).format, { locale: 'nn-NO', timeZone: 'Europe/Oslo', cells: CELL_RULE });
  } finally { await c.mcp.close(); w.ui.close(); await p.vindu.close(); }
});

test('a window opened in a locale or a time zone that is none is refused as it opens', async () => {
  const p = await providerWith();
  try {
    assert.throws(() => p.open({ locale: 'nb_NO' }), /locale: "nb_NO" is not a language tag \(BCP 47\), e\.g\. "nb-NO"/);
    assert.throws(() => p.open({ timeZone: 'Oslo' }), /timeZone: "Oslo" is not a time zone \(IANA\), e\.g\. "Europe\/Oslo"/);
  } finally { p.first.ui.close(); await p.vindu.close(); }
});
