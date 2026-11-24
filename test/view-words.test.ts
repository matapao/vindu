// The words a view's own surface is drawn in: English by default, word for word as before; Bokmål and Nynorsk as
// whole sets; a host's own words over them, word by word, for the provider and for one window; and a switch while the
// window runs, which draws every view shown again where it is. What the model is told stays in English. All synthetic.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { compile, memoryResults, startVindu, VIEW_WORDS, VIEW_WORDS_NB, VIEW_WORDS_NN, type PartialViewWords, type Resolved, type Shown, type ShellState, type Surface, type ViewSpec, type ViewWords } from '../src/index.js';
import { chromium, mcpClient, sleep } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const until = async (f: () => boolean, ms = 8000) => { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error('timed out'); await sleep(20); } };
/** Every text a surface draws, in order. */
const texts = (s: Surface): string[] => ((s.find(m => m.updateComponents) as any).updateComponents.components as any[]).filter(c => c.component === 'Text').map(c => c.text);

// a view after a drill, at its second step, with what the system says of its panels, its suggestions and a hook in each state
const VIEW: ViewSpec = {
  name: 'chase', title: 'Chase', path: ['Customers', 'Havgap Media'], steps: true, step: { at: 2, of: 3 },
  panels: [{ id: 'note', card: 'text', title: 'Overdue', text: 'Call them.' }, { id: 'old', card: 'text', title: 'Invoices', from: 'r1' }, { id: 'later', card: 'text', text: 'Later.' }],
  suggestions: [{ label: 'What changed?', prompt: 'What changed?', by: 'system' }, { label: 'Ask Kari', prompt: 'Ask Kari.', by: 'model' }],
  hooks: [
    { label: 'Changes', when: { changed: 'old' }, do: { cue: { label: 'What changed?', prompt: 'What changed?' }, notify: 'It changed' } },
    { when: { crosses: { panel: 'note', above: 60000.5, below: 100 } }, do: { read: 'old' } },
    { when: { picked: 'note' }, do: { job: { prompt: 'Draft a reminder.' } } },
    { when: { answered: 'record_decision' }, do: { job: { prompt: 'Tell them.' } } },
    { when: { due: true }, do: { job: { prompt: 'Check again.' } } },
    { when: { changed: 'note' }, do: { job: { prompt: 'Look.' } } },
  ],
  hookStates: ['system', 'system', 'on', 'off', 'idle', 'unavailable'],
};
const DATA: Record<string, Resolved> = {
  note: { text: 'Call them.', typed: true, label: 'Confidential', inputs: { growth: 0.04 } },
  old: { text: 'As read before.', newer: 'r2' },
  later: { text: 'Later.', typed: true },
};
const drawn = (words?: ViewWords) => texts(compile(structuredClone(VIEW), DATA, { compact: false, ...(words ? { words } : {}) }));

test('English by default, word for word as before', () => {
  assert.deepEqual(drawn(), [
    'Chase', '‹ Back', 'Customers › Havgap Media',
    'Overdue', 'Confidential · classified by the host', 'Written by the model', 'Recompute', 'Call them.',
    'Invoices', 'Not up to date: this shows r1, and its source has changed since (r2)', 'As read before.',
    '‹ Back', 'Step 2 of 3', 'Next ›', 'What changed? (the system)', 'Ask Kari',
    'Changes: When Invoices changes, offer "What changed?"; tell you: It changed (the system)',
    'When Overdue is above 60000.5 or below 100, read Invoices again (the system)',
    'When you pick a row in Overdue, start a job: Draft a reminder. · on', 'Turn off',
    'When you answer "record decision", start a job: Tell them. · off', 'Turn on',
    'When a reminder about this comes due, start a job: Check again. · off: a job\'s own task runs no hooks',
    'When Overdue changes, start a job: Look. · off: jobs are off in this app',
  ]);
  assert.deepEqual(drawn(VIEW_WORDS), drawn());
});

test('Bokmål and Nynorsk: the steps, the way back, the system\'s suggestions, and each hook\'s line, state and switch', () => {
  assert.deepEqual(drawn(VIEW_WORDS_NB), [
    'Chase', '‹ Tilbake', 'Customers › Havgap Media',
    'Overdue', 'Confidential · klassifisert av appen', 'Skrevet av modellen', 'Regn ut på nytt', 'Call them.',
    'Invoices', 'Ikke oppdatert: dette viser r1, og kilden har endret seg siden (r2)', 'As read before.',
    '‹ Tilbake', 'Steg 2 av 3', 'Neste ›', 'What changed? (systemet)', 'Ask Kari',
    'Changes: Når Invoices endrer seg, foreslå «What changed?»; varsle deg: It changed (systemet)',
    'Når Overdue er over 60000,5 eller under 100, hent Invoices på nytt (systemet)',
    'Når du velger en rad i Overdue, start en jobb: Draft a reminder. · på', 'Slå av',
    'Når du svarer på «record decision», start en jobb: Tell them. · av', 'Slå på',
    'Når det er tid for en påminnelse om dette, start en jobb: Check again. · av: i oppgaven til en jobb skjer ingenting av seg selv',
    'Når Overdue endrer seg, start en jobb: Look. · av: jobber er slått av i denne appen',
  ]);
  assert.deepEqual(drawn(VIEW_WORDS_NN), [
    'Chase', '‹ Tilbake', 'Customers › Havgap Media',
    'Overdue', 'Confidential · klassifisert av appen', 'Skrive av modellen', 'Rekn ut på nytt', 'Call them.',
    'Invoices', 'Ikkje oppdatert: dette viser r1, og kjelda har endra seg sidan (r2)', 'As read before.',
    '‹ Tilbake', 'Steg 2 av 3', 'Neste ›', 'What changed? (systemet)', 'Ask Kari',
    'Changes: Når Invoices endrar seg, foreslå «What changed?»; varsle deg: It changed (systemet)',
    'Når Overdue er over 60000,5 eller under 100, hent Invoices på nytt (systemet)',
    'Når du vel ei rad i Overdue, start ein jobb: Draft a reminder. · på', 'Slå av',
    'Når du svarar på «record decision», start ein jobb: Tell them. · av', 'Slå på',
    'Når det er tid for ei påminning om dette, start ein jobb: Check again. · av: i oppgåva til ein jobb skjer ingenting av seg sjølv',
    'Når Overdue endrar seg, start ein jobb: Look. · av: jobbar er slått av i denne appen',
  ]);
});

const customers = [{ customer: 'Havgap Media', city: 'Bergen' }, { customer: 'Brattli Verksted', city: 'Voss' }];
const ONBOARD = { name: 'onboard', title: 'Onboarding', steps: true, panels: [
  { id: 'cust', card: 'table', title: 'Customers', from: 'r1' },
  { id: 'plan', card: 'text', title: 'Plan', text: 'Call the 48250 customers first.' },
  { id: 'three', card: 'text', text: 'Then send the welcome letter.' },
], hooks: [
  { label: 'Changes', when: { changed: 'cust' }, do: { notify: 'Customers changed' } },
  { label: 'Chase', when: { picked: 'cust' }, do: { job: { prompt: 'Draft a welcome letter.' } } },
] };

async function windowWith(provider?: PartialViewWords) {
  const vindu = await startVindu({ waitMs: 300, ...(provider ? { viewWords: provider } : {}) });
  const open = (words?: PartialViewWords) => {
    const dir = tmp('words-'), results = memoryResults(dir);
    results.add({ server: 'crm', tool: 'list_customers', value: customers }); // r1
    results.add({ server: 'devices', tool: 'list_devices', value: [{ name: 'Oven B', on: true, id: 'OB' }, { name: 'Line 3', on: false, id: 'L3' }] }); // r2
    const shown: Shown[] = []; const st: { s?: ShellState } = {};
    const ui = vindu.open({ results, dir }, { onJob: async () => ({ id: 'job-1' }), onView: v => shown.push(v), onState: s => { st.s = s; }, ...(words ? { viewWords: words } : {}) });
    const last = (name: string) => shown.filter(v => v.name === name).at(-1)!;
    return { ui, shown, st, last, said: (name: string) => texts(last(name).wide) };
  };
  const w = open();
  const c = await mcpClient(w.ui.url);
  return { vindu, open, ...w, ...c, close: async () => { await c.mcp.close(); w.ui.close(); await vindu.close(); } };
}

for (const [language, words, said] of [
  ['Bokmål', VIEW_WORDS_NB, { first: 'Steg 1 av 3', second: 'Steg 2 av 3', written: 'Skrevet av modellen', check: 'Check the typed numbers (systemet)',
    changes: 'Changes: Når Customers endrer seg, varsle deg: Customers changed (systemet)', chase: 'Chase: Når du velger en rad i Customers, start en jobb: Draft a welcome letter.' }],
  ['Nynorsk', VIEW_WORDS_NN, { first: 'Steg 1 av 3', second: 'Steg 2 av 3', written: 'Skrive av modellen', check: 'Check the typed numbers (systemet)',
    changes: 'Changes: Når Customers endrar seg, varsle deg: Customers changed (systemet)', chase: 'Chase: Når du vel ei rad i Customers, start ein jobb: Draft a welcome letter.' }],
] as const) {
  test(`a provider in ${language}: the person reads its words as they go through the steps and turn a job on, while the model is told in English`, async () => {
    const w = await windowWith(words);
    try {
      const acc = await w.json('show_view', ONBOARD);
      assert.ok(w.said('onboard').includes(said.first) && w.said('onboard').includes('Neste ›') && !w.said('onboard').includes('‹ Tilbake'));
      assert.ok(w.said('onboard').includes(said.changes));
      assert.ok(w.said('onboard').includes(`${said.chase} · av`) && w.said('onboard').includes('Slå på'));
      // the account is the model's, in English: the hooks, the mark, the suggestion
      assert.deepEqual(acc.hooks.map((h: any) => [h.does, h.state]), [
        ['Changes: When Customers changes, tell you: Customers changed', 'on: the system does it by itself'],
        ['Chase: When you pick a row in Customers, start a job: Draft a welcome letter.', 'off until the person turns it on, in the window'],
      ]);
      assert.equal(acc.panels.find((p: any) => p.id === 'plan').marked, 'Written by the model');
      assert.deepEqual(acc.typed_numbers_not_in_any_result, [48250]);
      assert.ok(acc.suggestions.some((s: any) => s.label === 'Check the typed numbers' && s.by === 'system'));
      w.ui.event({ type: 'action', view: 'onboard', name: 'step', context: { to: 2 } });
      await until(() => w.said('onboard').includes(said.second));
      assert.ok(['‹ Tilbake', 'Neste ›', said.written, said.check].every(t => w.said('onboard').includes(t)));
      w.ui.event({ type: 'action', view: 'onboard', name: 'hook', context: { n: 1, on: true } });
      await until(() => w.said('onboard').includes(`${said.chase} · på`));
      assert.ok(w.said('onboard').includes('Slå av'));
      assert.match(w.ui.delta(), /the person went to step 2 of 3 in Onboarding[\s\S]*the person turned on the job of hook 1 in Onboarding: Chase/);
    } finally { await w.close(); }
  });
}

test('a host\'s own words: word by word over the provider\'s, and theirs over English; one window\'s over the provider\'s', async () => {
  const w = await windowWith({ next: 'Videre ›', step: (at, of) => `${at}/${of}`, back: undefined, hook: { changed: panel => `Når ${panel} blir endra` } });
  try {
    await w.json('show_view', ONBOARD);
    assert.ok(w.said('onboard').includes('1/3') && w.said('onboard').includes('Videre ›'));
    assert.ok(w.said('onboard').includes('Changes: Når Customers blir endra, tell you: Customers changed (the system)')); // the rest of a hook's line in English
    assert.ok(w.said('onboard').includes('Chase: When you pick a row in Customers, start a job: Draft a welcome letter. · off') && w.said('onboard').includes('Turn on'));
    w.ui.event({ type: 'action', view: 'onboard', name: 'step', context: { to: 2 } });
    await until(() => w.said('onboard').includes('2/3'));
    assert.ok(w.said('onboard').includes('‹ Back') && w.said('onboard').includes('Written by the model')); // a word left undefined is English
    // another window of the same provider, with words of its own over the provider's
    const other = w.open({ next: 'Fram ›', hook: { picked: panel => `Når du peikar på ei rad i ${panel}` } });
    const c = await mcpClient(other.ui.url);
    try {
      await c.json('show_view', ONBOARD);
      assert.ok(other.said('onboard').includes('1/3') && other.said('onboard').includes('Fram ›') && !other.said('onboard').includes('Videre ›'));
      assert.ok(other.said('onboard').includes('Changes: Når Customers blir endra, tell you: Customers changed (the system)'));
      assert.ok(other.said('onboard').includes('Chase: Når du peikar på ei rad i Customers, start a job: Draft a welcome letter. · off'));
      assert.ok(w.said('onboard').includes('Videre ›')); // the first window's words as they were
    } finally { await c.mcp.close(); other.ui.close(); }
  } finally { await w.close(); }
});

test('the words switched while the window runs: every view shown is drawn again in them where it is, and the model is told nothing', async () => {
  const w = await windowWith();
  try {
    await w.json('show_view', ONBOARD);
    await w.json('show_view', { name: 'customers', title: 'Customers', panels: [{ id: 'all', card: 'table', from: 'r1' }, { id: 'note', card: 'text', text: 'Typed.' }], place: { beside: 'onboard' } });
    w.ui.event({ type: 'action', view: 'onboard', name: 'step', context: { to: 2 } });
    await until(() => w.said('onboard').includes('Step 2 of 3'));
    await w.json('show_view', { name: 'later', title: 'Later', panels: [{ id: 'note', card: 'text', text: 'Put away.' }], place: { beside: 'onboard' } });
    w.ui.event({ type: 'collapse', view: 'later' }); // the person puts one in the shelf
    assert.match(JSON.stringify(await w.json('look', {})), /collapsed \\"later\\" into the shelf/); // the model has heard all so far
    assert.match(w.ui.delta(), /the person went to step 2 of 3 in Onboarding/);
    const names = ['onboard', 'customers', 'later'];
    const where = () => JSON.stringify([w.st.s!.tree, Object.keys(w.st.s!.shelf)]), was = where(), counts = names.map(n => w.shown.filter(v => v.name === n).length);
    assert.ok(was.includes('"onboard"') && was.includes('"customers"') && Object.keys(w.st.s!.shelf).includes('later'));
    await w.ui.setViewWords(VIEW_WORDS_NN);
    assert.deepEqual(names.map(n => w.shown.filter(v => v.name === n).length), counts.map(n => n + 1)); // each drawn again, once
    assert.ok(['Steg 2 av 3', '‹ Tilbake', 'Neste ›', 'Skrive av modellen', 'Changes: Når Customers endrar seg, varsle deg: Customers changed (systemet)', 'Slå på'].every(t => w.said('onboard').includes(t)));
    assert.ok(w.said('customers').includes('Skrive av modellen') && w.said('later').includes('Skrive av modellen'));
    assert.equal(where(), was); // each pane where it was, the shelved one in the shelf
    assert.equal(w.ui.delta(), '');
    // what the model shows next is drawn in them too; its account is in English
    const acc = await w.json('show_view', { name: 'customers', title: 'Customers', panels: [{ id: 'note', card: 'text', text: 'Typed again.' }] });
    assert.equal(acc.panels[0].marked, 'Written by the model');
    assert.ok(w.said('customers').includes('Skrive av modellen'));
    // back to the provider's words, which are English here
    await w.ui.setViewWords();
    assert.ok(w.said('onboard').includes('Step 2 of 3') && w.said('onboard').includes('Turn on') && w.said('customers').includes('Written by the model'));
  } finally { await w.close(); }
});

test('the devices block takes its states and switch from the view\'s words: as it was in English, in Bokmål drawn in Chromium', async () => {
  const panel = { id: 'line', card: 'devices', from: 'r2', map: { state: 'on' }, operation: 'switch_device' };
  const english = await windowWith();
  try {
    await english.json('show_view', { name: 'kit', title: 'Kit', panels: [panel] });
    const custom = ((english.last('kit').wide.find(m => m.updateComponents) as any).updateComponents.components as any[]).find(c => c.component === 'VDevices');
    assert.equal(custom.words, undefined); // its component's own English: nothing more on the surface
  } finally { await english.close(); }
  const w = await windowWith(VIEW_WORDS_NB);
  const app = http.createServer((req, res) => {
    const f = req.url === '/app.bundle.js' ? path.join(import.meta.dirname, 'fixtures', 'app.bundle.js') : path.join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'shell.html');
    res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }).end(fs.readFileSync(f));
  });
  await new Promise<void>(r => app.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  try {
    await w.json('show_view', { name: 'kit', title: 'Kit', panels: [panel] });
    const model = (w.last('kit').wide.find(m => m.updateDataModel) as any).updateDataModel.value.panels;
    assert.deepEqual(model.p_line.props.words, { on: 'på', off: 'av', turnOn: 'Slå på', turnOff: 'Slå av' });
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const errors: string[] = []; page.on('pageerror', (e: Error) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${(app.address() as { port: number }).port}/shell.html`);
    await page.evaluate(() => (window as any).app.shell('light'));
    await page.evaluate((x: Shown) => (window as any).app.view(x), w.last('kit'));
    await page.evaluate((s: ShellState) => (window as any).app.state({ ...s, tree: { view: 'kit' }, maximized: null }), w.st.s!);
    const pane = page.locator('.vindu-pane[data-view="kit"]');
    await pane.locator('[data-panel="line"][data-row="1"] button').waitFor();
    assert.deepEqual(await pane.locator('.vb-pill').allInnerTexts(), ['på', 'av']);
    assert.deepEqual(await pane.locator('[data-panel="line"] button').allInnerTexts(), ['Slå av', 'Slå på']);
    assert.equal(await pane.locator('[data-panel="line"][data-row="0"] button').getAttribute('aria-label'), 'Slå av Oven B');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); await w.close(); }
});
