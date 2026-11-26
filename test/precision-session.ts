// One task's session over real MCP, with no browser, for the precision tests (precision.test.ts, precision-host.test.ts):
// a result of three invoices, seen exactly and with its digest, and operations that approve a payment, send a reminder
// and count what is open. Each test file that imports it gets a session of its own.
import { afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { startVindu, memoryResults, type Operation, type Shown } from '../src/index.js';
import { mcpClient, sleep } from './helpers.js';


export const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
export const invoices = [
  { id: 'INV-2026-0398', customer: 'Brattli Verksted', days_overdue: 12, amount_nok: 18400, status: 'overdue' },
  { id: 'INV-2026-0405', customer: 'Lysvik Retail', days_overdue: 0, amount_nok: 9900, status: 'open' },
  { id: 'INV-2026-0412', customer: 'Havgap Media', days_overdue: 53, amount_nok: 48200, status: 'overdue' },
];
export const paid: unknown[] = [];
const OPS: Operation[] = [
  { name: 'approve_payment', description: 'Ask the person to approve paying an invoice; returns their decision and any note.', effect: 'write',
    input: { invoice: z.string().describe('the invoice id') },
    ask: input => ({ title: `Pay ${String(input.invoice)}?`, fields: { decision: { type: 'string', enum: ['pay', 'hold'] }, note: { type: 'string' } }, required: ['decision'] }),
    run: (input, answer) => { if (answer?.decision === 'pay') paid.push(input.invoice); return { paid: answer?.decision === 'pay' }; } },
  { name: 'send_reminder', description: 'Send the customer a payment reminder by email.', effect: 'external', input: { invoice: z.string() }, run: input => ({ sent: input.invoice }) },
  { name: 'count_open', description: 'How many invoices are open.', effect: 'read', run: () => ({ open: 1 }) },
];

const dir = tmp('prec-');
export const results = memoryResults(dir);
results.add({ tool: 'query', server: 'db', value: invoices });
(results.all()[0] as { fidelity?: string; digest?: string }).fidelity = 'exact'; // as a host's record says it
(results.all()[0] as { fidelity?: string; digest?: string }).digest = 'sha256:4f2a9c1d0e7b3a5c';
const vindu = await startVindu({ operations: OPS, locale: 'nb-NO', timeZone: 'Europe/Oslo', waitMs: 400 });
export const shown: Shown[] = [];
export const ui = vindu.open({ results, dir }, { onView: v => shown.push(v) });
export const { mcp, call, json } = await mcpClient(ui.url);
afterAll(async () => { await mcp.close(); ui.close(); await vindu.close(); });
export const askShown = async () => { for (let i = 0; i < 100 && !shown.some(v => v.ask); i++) await sleep(10); return shown.splice(0).filter(v => v.ask).at(-1)!; };
