// Form fields of each kind: a date, a time, a date and time, an e-mail address, a web address, an amount of money, a
// place, an id with its pattern and check digits, files the person picks. Drawn with the input that fits, checked by the
// system before an answer is taken, so the model only gets values that fit. All synthetic.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startVindu, memoryResults, fieldsOf, formBinding, checkValue, checkDigits, readAnswer, WORDS, type Shown, type Ask } from '../src/index.js';
import { sleep } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const until = async (f: () => boolean, ms = 8000) => { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error('timed out'); await sleep(20); } };

test('each kind of value is checked by the system: a real date, two decimals, a place on Earth, check digits that add up', () => {
  assert.equal(checkValue({ type: 'string', format: 'date' }, '2026-11-30'), undefined);
  assert.equal(checkValue({ type: 'string', format: 'date' }, '2026-02-30'), '2026-02-30 is not a day of the calendar');
  assert.equal(checkValue({ type: 'string', format: 'date' }, '30.11.2026'), 'a date, as YYYY-MM-DD');
  assert.equal(checkValue({ type: 'string', format: 'date', min: '2026-11-11' }, '2026-11-01'), 'a date 2026-11-11 or later');
  assert.equal(checkValue({ type: 'string', format: 'time' }, '24:00'), 'a time, as HH:MM');
  assert.equal(checkValue({ type: 'string', format: 'date-time' }, '2026-11-30T09:30'), undefined);
  assert.equal(checkValue({ type: 'string', format: 'email' }, 'kari@havgap'), 'an e-mail address, as name@example.com');
  assert.equal(checkValue({ type: 'string', format: 'uri' }, 'javascript:alert(1)'), 'a web address, http:// or https://');
  assert.equal(checkValue({ type: 'string', format: 'money', currency: 'NOK' }, '48 210,50'), undefined);
  assert.equal(checkValue({ type: 'string', format: 'money', currency: 'NOK' }, '12.345'), 'an amount in NOK, with at most two decimals');
  assert.equal(checkValue({ type: 'string', format: 'money', min: 0 }, '-5'), 'at least 0');
  assert.equal(checkValue({ type: 'string', format: 'place' }, '60.3913, 5.3221'), undefined);
  assert.equal(checkValue({ type: 'string', format: 'place' }, '95, 5'), 'latitude is -90 to 90, longitude -180 to 180');
  assert.equal(checkValue({ type: 'string', format: 'place' }, 'Bryggen 1, Bergen'), undefined);
  assert.equal(checkValue({ type: 'string', pattern: '^INV-\\d{4}-\\d{4}$', example: 'INV-2026-0412' }, 'INV-26-412'), 'in the form INV-2026-0412');
  assert.equal(checkValue({ type: 'string', check: 'orgnr' }, '974 760 673'), undefined);
  assert.match(checkValue({ type: 'string', check: 'orgnr' }, '974760674')!, /not an organisation number/);
  assert.equal(checkDigits('iban', 'NO93 8601 1117 947'), true); assert.equal(checkDigits('iban', 'NO93 8601 1117 948'), false);
  assert.equal(checkDigits('luhn', '79927398713'), true); assert.equal(checkDigits('luhn', '79927398710'), false);
  assert.equal(checkValue({ type: 'integer', min: 1, max: 31 }, '40'), 'at most 31');
});

test("a date and time is on a day of the calendar; a formatted field keeps its own rules; what is needed is said in the host's words", () => {
  assert.equal(checkValue({ type: 'string', format: 'date-time' }, '2026-02-31T10:00'), '2026-02-31 is not a day of the calendar');
  assert.equal(checkValue({ type: 'string', format: 'date-time' }, '2026-02-28T10:00'), undefined);
  assert.equal(checkValue({ type: 'string', format: 'email', maxLength: 12 }, 'kari@havgap.example'), 'at most 12 characters');
  assert.equal(checkValue({ type: 'string', format: 'email', minLength: 30 }, 'kari@havgap.example'), 'at least 30 characters');
  assert.equal(checkValue({ type: 'string', format: 'date', pattern: '^2026-' }, '2027-01-01'), 'in the form ^2026-');
  assert.equal(checkValue({ type: 'string', format: 'money', check: 'luhn' }, '19'), 'its check digit does not add up');
  const ask: Ask = { ticket: 'k1', title: 'Who', kind: 'question', op: 'ask', fields: { who: { type: 'string', title: 'Who' }, constructor: { type: 'string' as const } }, required: ['who'] };
  assert.deepEqual(readAnswer(ask, {}, undefined, { required: f => `Please fill in ${f}` }), { error: 'Please fill in Who' });
  assert.deepEqual(readAnswer(ask, {}), { error: 'Who is needed' });
  assert.deepEqual(readAnswer(ask, { who: 'Kari' }), { values: { who: 'Kari' } }); // a field named constructor holds what was sent: nothing
});

test("an elicitation's schema keeps its kinds; the form draws a date picker, an amount, a file to pick", () => {
  const { fields, required } = fieldsOf({ type: 'object', required: ['due', 'amount'], properties: {
    due: { type: 'string', format: 'date', title: 'Due' }, at: { type: 'string', format: 'date-time' }, mail: { type: 'string', format: 'email', maxLength: 120 },
    amount: { type: 'number', minimum: 0, maximum: 1000000 }, code: { type: 'string', pattern: '^[A-Z]{3}$' } } });
  assert.deepEqual(fields.due, { type: 'string', title: 'Due', format: 'date' });
  assert.deepEqual(fields.mail, { type: 'string', format: 'email', maxLength: 120 });
  assert.deepEqual(fields.amount, { type: 'number', min: 0, max: 1000000 });
  assert.deepEqual(fields.code, { type: 'string', pattern: '^[A-Z]{3}$' }); assert.deepEqual(required, ['due', 'amount']);
  const ask: Ask = { ticket: 'k1', kind: 'elicitation', op: 'a form', title: 'Follow-up', required: ['due'], fields: {
    due: { type: 'string', format: 'date', title: 'Due', min: '2026-11-11' }, sum: { type: 'string', format: 'money', currency: 'NOK', title: 'Sum' },
    note: { type: 'string', format: 'file', title: 'Delivery note' } }, files: { note: { ids: ['a1'], names: ['delivery-note.pdf'] } } };
  const comps = (formBinding(ask, WORDS)[1] as any).updateComponents.components as any[];
  const by = (id: string) => comps.find(c => c.id === id);
  assert.deepEqual([by('f0').component, by('f0').enableDate, by('f0').enableTime, by('f0').min], ['DateTimeInput', true, false, '2026-11-11']);
  assert.equal(by('f1').variant, 'number'); assert.equal(by('f1_form').text, 'an amount in NOK');
  assert.equal(by('f2_got').text, 'Delivery note: delivery-note.pdf');
  assert.deepEqual(by('f2').action.event, { name: 'pick_file', context: { ticket: 'k1', field: 'note' } });
});

test('in the window: a wrong date goes back to the person, an amount comes as a number, files come as attachments', async () => {
  const dir = tmp('fields-'), shown: Shown[] = []; const results = memoryResults(dir);
  fs.writeFileSync(path.join(dir, 'note.pdf'), '%PDF-1.4 synthetic');
  const vindu = await startVindu({ waitMs: 300 });
  const ui = vindu.open({ results, dir }, { onView: v => shown.push(v), capture: async () => [results.attach('delivery-note.pdf', 'application/pdf', path.join(dir, 'note.pdf')).id] });
  try {
    const answer = ui.ask({ message: 'When, how much, and the note', schema: { type: 'object', required: ['due', 'sum', 'note'], properties: {
      due: { type: 'string', format: 'date', title: 'Due' }, sum: { type: 'number', title: 'Sum' }, iban: { type: 'string', title: 'Account' }, note: { type: 'string', format: 'file', title: 'Delivery note' } } } }, new AbortController().signal);
    await until(() => shown.some(v => v.ask));
    const a = shown.filter(v => v.ask).at(-1)!;
    ui.event({ type: 'action', view: a.name, name: 'answer', context: { ticket: a.ask!.ticket, 'f:due': '2026-02-30', 'f:sum': '1500' } });
    await until(() => shown.filter(v => v.ask).at(-1)!.ask!.error !== undefined);
    assert.equal(shown.filter(v => v.ask).at(-1)!.ask!.error, 'Due: 2026-02-30 is not a day of the calendar');
    ui.event({ type: 'action', view: a.name, name: 'pick_file', context: { ticket: a.ask!.ticket, field: 'note' } });
    await until(() => !!shown.filter(v => v.ask).at(-1)!.ask!.files?.note);
    ui.event({ type: 'action', view: a.name, name: 'answer', context: { ticket: a.ask!.ticket, 'f:due': '2026-11-30', 'f:sum': '1500,50', 'f:iban': '' } });
    const got = await answer;
    assert.deepEqual(got, { action: 'accept', content: { due: '2026-11-30', sum: 1500.5, note: ['a1'] } });
  } finally { ui.close(); await vindu.close(); }
});

test("a template's inputs may be dates, amounts and ids: the start asks for them with the input that fits", async () => {
  const dir = tmp('tin-'), shown: Shown[] = []; const results = memoryResults(dir);
  const vindu = await startVindu({ waitMs: 300 });
  const ui = vindu.open({ results, dir }, { onView: v => shown.push(v) });
  try {
    const t = { name: 'Payment', inputs: { due: { type: 'string', format: 'date', title: 'Due' }, orgnr: { type: 'string', check: 'orgnr', title: 'Organisation number', example: '974 760 673' } },
      slots: { note: { title: 'Note', block: 'text' } } };
    void ui.useTemplate(t).catch(() => undefined);
    await until(() => shown.some(v => v.ask));
    const a = shown.filter(v => v.ask).at(-1)!;
    const comps = (a.wide.find((m: any) => m.updateComponents) as any).updateComponents.components as any[];
    assert.ok(comps.some(c => c.component === 'DateTimeInput'));
    ui.event({ type: 'action', view: a.name, name: 'answer', context: { ticket: a.ask!.ticket, 'f:due': '2026-12-01', 'f:orgnr': '974760674' } });
    await until(() => shown.filter(v => v.ask).at(-1)!.ask!.error !== undefined);
    assert.match(shown.filter(v => v.ask).at(-1)!.ask!.error!, /^Organisation number: not an organisation number/);
  } finally { ui.close(); await vindu.close(); }
});

test('dismissed and closed file questions ignore late picker results', async () => {
  const dir = tmp('closed-file-ask-'), shown: Shown[] = [];
  const server = await startVindu();
  let rejectPicker: ((error: Error) => void) | undefined;
  const ui = server.open({ results: memoryResults(dir), dir }, { onView: view => shown.push(view),
    capture: () => new Promise((_resolve, reject) => { rejectPicker = reject; }),
  });
  try {
    for (const close of [false, true]) {
      const answer = ui.ask({ message: 'Choose a file', schema: { type: 'object', properties: { file: { type: 'string', format: 'file' } } } });
      const ask = shown.at(-1)!, ticket = ask.ask!.ticket;
      const pick = { type: 'action', name: 'pick_file', view: ask.name, context: { ticket, field: 'file' } };
      assert.equal(ui.event(pick), true);
      assert.ok(rejectPicker);
      if (close) ui.close();
      else ui.event({ type: 'action', name: 'decline', view: ask.name, context: { ticket } });
      const drawn = shown.length;
      assert.deepEqual(ui.provideFiles(ticket, 'file', () => assert.fail('stale file registered')), []);
      assert.equal(ui.event(pick), false);
      rejectPicker(new Error('picker was dismissed'));
      await answer;
      await sleep(0);
      assert.equal(shown.length, drawn);
    }
  } finally { ui.close(); await server.close(); }
});

test('a file answer refers to exactly the selection seen by the person submitting it', async () => {
  const dir = tmp('form-files-'), shown: Shown[] = [], results = memoryResults(dir);
  const server = await startVindu();
  const ui = server.open({ results, dir }, { onView: view => shown.push(view) });
  try {
    const answer = ui.ask({ message: 'Choose documents', schema: { type: 'object', properties: {
      main: { type: 'string', format: 'file' }, extra: { type: 'string', format: 'file' },
    } } });
    const { name: view, ask } = shown.at(-1)!, ticket = ask!.ticket;
    const register = (name: string) => {
      const file = path.join(dir, name); fs.writeFileSync(file, name);
      return ui.provideFiles(ticket, 'main', () => [results.attach(name, 'text/plain', file).id]);
    };
    const first = register('first.txt'), replacement = register('replacement.txt');
    for (const stale of [{ main: first, extra: [] }, { main: replacement }, { main: ['unregistered'], extra: [] }]) {
      assert.equal(ui.event({ type: 'action', view, name: 'answer', context: { ticket, fileSelection: stale } }), true);
      assert.match(shown.at(-1)!.ask!.error!, /files changed/);
      assert.deepEqual(shown.at(-1)!.ask!.files!.main.ids, replacement);
    }
    ui.event({ type: 'action', view, name: 'answer', context: { ticket, fileSelection: { main: replacement, extra: [] } } });
    assert.deepEqual(await answer, { action: 'accept', content: { main: replacement } });
  } finally { ui.close(); await server.close(); }
});
