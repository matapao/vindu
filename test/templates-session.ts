// What the template tests share (templates.test.ts, templates-pin.test.ts): invoices, the operations a template offers,
// one provider for every session, which sources only read, and the invoice follow-up template.
import { afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { startVindu, type Operation } from '../src/index.js';
import { sleep } from './helpers.js';

export const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
export const until = async (f: () => boolean, ms = 8000) => { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error('timed out'); await sleep(20); } };
export const invoices = [{ number: 'INV-2026-0412', due: '2026-09-15', amount: 31050, status: 'overdue' }, { number: 'INV-2026-0431', due: '2026-09-30', amount: 17160, status: 'overdue' }];
const reminder: Operation = { name: 'send_reminder', description: 'Send a payment reminder.', effect: 'external', input: { to: z.string() }, run: () => ({ sent: true }) };
const writeOff: Operation = { name: 'write_off', description: 'Write an invoice off.', effect: 'destructive', input: { number: z.string() }, run: () => ({ written_off: true }) };
export const vindu = await startVindu({ waitMs: 300, operations: [reminder, writeOff] });
afterAll(async () => { await vindu.close(); });
export const isRead = (server: string, tool: string) => (server === 'accounts' ? tool.startsWith('list_') || tool.startsWith('get_') : undefined);
export const TEMPLATE = {
  name: 'Invoice follow-up', about: 'One customer\'s overdue invoices, what happened, and the next step', version: 3,
  inputs: { customer: { type: 'string', title: 'Customer' } },
  slots: {
    overdue: { title: 'Overdue', block: 'kpi', needs: 'the total overdue, in the invoices\' currency', required: true },
    invoices: { title: 'Invoices', block: 'table', columns: ['number', 'due', 'amount'], sort: 'due', source: { server: 'accounts', tool: 'list_invoices', args: { customer: '$customer', status: 'overdue' } } },
    next: { title: 'Next step', block: 'free', needs: 'whatever helps decide what to do next' },
    photos: { title: 'Photos', block: 'media', by: 'person', ask: { capture: 'photo', min: 1 } },
    // oxlint-disable-next-line unicorn/no-thenable -- a slot's then, as templates take it: an object, never a function
    letter: { title: 'Letter', block: 'text', needs: 'the reminder letter', then: { by: 'person', edit: true } },
  },
  layout: { column: [{ row: [{ slot: 'overdue', size: 0.3 }, 'next'] }, 'invoices', { row: ['photos', 'letter'] }] },
  operations: ['send_reminder'],
};
