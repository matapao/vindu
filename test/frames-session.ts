// What the frames tests share (frames.test.ts, frames-people.test.ts): the host's operations that send a reply, approve a
// transfer and refund orders as a change set, a provider that keeps decisions and classifies a tax result, and a session
// of its own for each test.
import { afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { startVindu, memoryResults, changeSet, type Shown, type Operation } from '../src/index.js';
import { sleep } from './helpers.js';

export const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
export const until = async (f: () => boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (!f()) {
    if (Date.now() > end) throw new Error('timed out');
    await sleep(20);
  }
};
const sent: unknown[] = [];
export const refunded: unknown[] = [];
const sendReply: Operation = {
  name: 'send_reply',
  description: 'Send a reply to a customer.',
  effect: 'external',
  input: { to: z.string(), subject: z.string(), body: z.string() },
  run: (input) => {
    sent.push(input);
    return { sent: true };
  },
};
const transfer: Operation = {
  name: 'approve_transfer',
  description: 'Approve a transfer.',
  effect: 'external',
  approve: 2,
  input: { amount: z.number(), currency: z.string(), to: z.string() },
  run: (input) => ({ transferred: input.amount }),
};
const refunds = changeSet({
  name: 'refund_orders',
  description: 'Refund orders: the person ticks which.',
  rows: 'orders',
  run: (rows) => {
    refunded.push(...rows);
    return rows.length;
  },
});
export const vindu = await startVindu({
  waitMs: 300,
  operations: [sendReply, transfer, refunds],
  decisions: true,
  classify: (e) => (e.kind === 'result' && e.server === 'tax' ? 'Confidential' : undefined),
});
afterAll(async () => {
  await vindu.close();
});

export function session() {
  const dir = tmp('frames-'),
    shown: Shown[] = [],
    all: Shown[] = [];
  const results = memoryResults(dir);
  results.add({
    server: 'tax',
    tool: 'assessment',
    value: [
      { line: 'Income', amount: 612_000 },
      { line: 'Deductions', amount: -38_500 },
    ],
  });
  const ui = vindu.open(
    { results, dir },
    {
      onView: (v) => {
        shown.push(v);
        all.push(v);
      },
    },
  );
  const ask = async () => {
    await until(() => shown.some((v) => v.ask));
    return shown
      .splice(0)
      .filter((v) => v.ask)
      .at(-1)!;
  };
  return { ui, shown, all, ask };
}
