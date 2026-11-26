// One task's session for the blocks tests (blocks.test.ts, blocks-drawn.test.ts): synthetic results for every block,
// the UI server and the model's client, and a panel of an account by its id.
import { afterAll } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startVindu, memoryResults, type Shown, type ShellState } from '../src/index.js';
import { mcpClient, type AccountPanel } from './helpers.js';

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
export const dir = tmp('blocks-');
export const results = memoryResults(dir);
export const add = (tool: string, value: unknown, input: unknown = {}) =>
  results.add({ server: 'synthetic', tool, input, value }).id;
export const R = {
  inbox: add('search_mail', [
    {
      from: 'ingrid@havgap.example',
      subject: 'Re: INV-2026-0412',
      time: '2026-11-10T09:12:00Z',
      state: 'unread',
      body: 'We will pay after our board meeting.',
    },
    {
      from: 'kari@nordlys.example',
      subject: 'Reminder: INV-2026-0412',
      time: '2026-11-09T14:40:00Z',
      state: 'read',
      body: '<p>Following up on the <b>September</b> invoice.</p>',
    },
  ]),
  v1: add(
    'read_contract',
    [
      { id: '4.1', heading: 'Guardrail ends', text: 'Ends shall be ramped down over 12 m.' },
      { id: '4.2', heading: 'Inspection', text: 'The contractor inspects weekly.' },
      { id: '4.3', heading: 'Old', text: 'A clause that goes.' },
    ],
    { version: 1 },
  ),
  v2: add(
    'read_contract',
    [
      { id: '4.1', heading: 'Guardrail ends', text: 'Ends shall be ramped down over 16 m and anchored.' },
      { id: '4.2', heading: 'Inspection', text: 'The contractor inspects weekly.' },
      { id: '4.4', heading: 'Deviations', text: 'Deviations are reported within 3 days.' },
    ],
    { version: 2 },
  ),
  events: add('list_events', [
    {
      title: 'Theatre 2: hip replacement',
      start: '2026-11-16T09:00:00Z',
      end: '2026-11-16T10:00:00Z',
      location: 'Theatre 2',
    },
    { title: 'Theatre 2: knee', start: '2026-11-16T10:15:00Z', end: '2026-11-16T11:00:00Z', location: 'Theatre 2' },
    {
      title: 'Theatre 3: emergency',
      start: '2026-11-16T12:00:00Z',
      end: '2026-11-16T13:30:00Z',
      location: 'Theatre 3',
    },
  ]),
  tasks: add('list_tasks', [
    { title: 'Stop batch 2026-311', status: 'done', assignee: 'Line lead' },
    { title: 'Find the cause', status: 'doing', assignee: 'Quality', due: '2026-11-13' },
    { title: '8D report', status: 'todo', assignee: 'Quality' },
  ]),
  invoice: add('get_invoice', {
    number: 'INV-2026-0520',
    customer: 'Havgap Media',
    date: '2026-11-11',
    due: '2026-12-11',
    currency: 'NOK',
    total: 37475,
    lines: [
      { description: 'Design work', hours: 32.5, rate: 950 },
      { description: 'Workshop', hours: 6, rate: 1100 },
    ],
  }),
  wrong: add('get_invoice', {
    number: 'INV-2026-0521',
    customer: 'Lysvik Retail',
    currency: 'NOK',
    total: 38000,
    lines: [
      { description: 'Design work', hours: 32.5, rate: 950 },
      { description: 'Workshop', hours: 6, rate: 1100 },
    ],
  }),
  files: add('list_files', [
    {
      name: 'contract-v2.pdf',
      mime: 'application/pdf',
      size: 248_312,
      modified: '2026-11-10T08:00:00Z',
      owner: 'Legal',
    },
    { name: 'site-photos.zip', mime: 'application/zip', size: 18_874_368, modified: '2026-11-09T15:30:00Z' },
  ]),
  places: add('fleet_now', [
    { name: 'Truck 7 (broken)', lat: 59.9139, lon: 10.7522, status: 'stopped' },
    { name: 'Truck 3', lat: 59.95, lon: 10.8, status: 'driving' },
    { name: 'Drammen depot', lat: 59.7439, lon: 10.2045, status: 'depot' },
  ]),
  contacts: add('directory', [
    {
      name: 'Ingrid Havgap',
      title: 'CFO',
      company: 'Havgap Media',
      email: 'ingrid@havgap.example',
      phone: '+47 400 00 000',
    },
  ]),
  sends: ['k1', 'k2', 'k3', 'k4', 'k5'].map((to, i) =>
    add('send_reply', i === 2 ? { status: 'failed', error: 'mailbox full' } : { status: 'sent', id: `m${i}` }, {
      to: `${to}@kunde.example`,
    }),
  ),
  changes: add('propose_refunds', [
    { order: 'O-1001', before: { status: 'late', refund: 0 }, after: { status: 'refunded', refund: 149 } },
    { order: 'O-1002', before: { status: 'late', refund: 0 }, after: { status: 'late', refund: 0 } },
  ]),
  links: add('accounts_graph', [
    { from: 'ACC-1', to: 'ACC-2', label: '9 500' },
    { from: 'ACC-2', to: 'ACC-3', label: '9 400' },
    { from: 'ACC-1', to: 'ACC-4', label: '200' },
  ]),
  budget: add('actuals', [
    { dept: 'Sales', actual: 1_200_000 },
    { dept: 'Ops', actual: 800_000 },
  ]),
  dropped: add('propose_changes', [
    { key: 'C-7', before: { status: 'open', note: 'call back' }, after: { status: 'open' } },
  ]),
  typo: add('list_events', [
    { title: 'Board meeting', start: '2026-03-02T09:00:00Z' },
    { title: 'Typed on no day', start: '2026-02-30T10:00:00Z' },
  ]),
};
const vindu = await startVindu({ waitMs: 400, timeZone: 'UTC' });
export const shown: Shown[] = [];
export let state: ShellState | undefined;
export const ui = vindu.open(
  { results, dir },
  {
    onView: (v) => shown.push(v),
    onState: (s) => {
      state = s;
    },
  },
);
const { mcp, json, call } = await mcpClient(ui.url);
export { json, call };
afterAll(async () => {
  await mcp.close();
  ui.close();
  await vindu.close();
});
/** A panel of a view's account, by its id: the test fails if the account has none. */
export const panel = (a: { panels: AccountPanel[] }, id: string): AccountPanel => {
  const found = a.panels.find((p) => p.id === id);
  assert.ok(found, `no panel ${id}`);
  return found;
};
