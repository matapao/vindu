// Two rules in browser pages, with a real Chromium over real MCP (the simulation's probes P1 to P3, now held):
//   - nothing leaves unasked: the model's click that makes a page post a form is held until the person says yes, and
//     the model is told what was sent, or that it was not; what the person does in a page on their own is never held;
//   - secrets are the person's: the model never types in a password, card or code field, and reads only whether one
//     is filled, never what it holds (not even its length).
// The checkout is served on this machine, so it opens without an ask, as a site the person allowed earlier would.
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { BrowserType, Page } from 'playwright';
import { startVindu, memoryResults, fieldNames, type PageNode, type Shown } from '../src/index.js';
import { cdpOf, mcpClient, sleep } from './helpers.js';

const chromium: BrowserType = createRequire(import.meta.url)('playwright').chromium;
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const until = async (f: () => boolean, ms = 8000) => { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error('timed out'); await sleep(20); } };
const posts: { path: string; fields: string[] }[] = [];
const PAGE = `<!doctype html><title>Checkout (synthetic)</title><h1>Flights, 4 people, 12 400 kr</h1>
<form method="post" action="/pay">
<label>Name on card <input name="holder" autocomplete="cc-name"></label>
<label>Card number <input name="card" autocomplete="cc-number" inputmode="numeric"></label>
<label>Password <input name="password" type="password" autocomplete="current-password"></label>
<button type="submit">Pay 12 400 kr</button></form>
<button id="save" onclick="fetch('/save',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({trip:'July',people:4})}).then(r=>r.text()).then(t=>document.getElementById('out').textContent=t)">Save the trip</button><p id="out"></p>`;
const site = http.createServer((q, res) => {
  if (q.method === 'POST') {
    let b = ''; q.on('data', c => { b += c; });
    q.on('end', () => { posts.push({ path: q.url ?? '', fields: fieldNames(b, String(q.headers['content-type'] ?? '')) }); res.writeHead(200, { 'Content-Type': 'text/html' }).end(q.url === '/save' ? 'saved' : '<!doctype html><title>Paid</title><h1>Paid: booking 7Q2K</h1>'); });
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAGE);
});
await new Promise<void>(r => site.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(site.address() as { port: number }).port}/`;
const browser = await chromium.launch();
const vindu = await startVindu({ waitMs: 400 });
afterAll(async () => { await browser.close(); site.close(); await vindu.close(); });

function window() {
  const dir = tmp('task-'), work = tmp('work-'), shown: Shown[] = [], tabs: Page[] = [];
  const ui = vindu.open({ results: memoryResults(dir), dir, work }, { onView: v => shown.push(v),
    views: { terminal: false, browser: { open: async () => { const tab = await browser.newPage(); tabs.push(tab); const s = await tab.context().newCDPSession(tab); return cdpOf(s); } } },
    record: () => `r${Date.now() % 100000}`,
  });
  const askShown = async () => { await until(() => shown.some(v => v.ask)); return shown.splice(0).filter(v => v.ask).at(-1)!; };
  const answer = (a: Shown, yes: boolean) => ui.event({ type: 'action', view: a.name, name: yes ? 'answer' : 'decline', context: { ticket: a.ask!.ticket } });
  return { ui, shown, tabs, askShown, answer };
}
/** The node of a page's snapshot with the role and a name that includes the name: the test fails if it has none. */
const find = (snap: { tree: PageNode[] }, role: string, name: string): PageNode => {
  const walk = (ns: PageNode[] = []): PageNode | undefined => { for (const n of ns) { if (n.role === role && (n.name ?? '').includes(name)) return n; const k = walk(n.children); if (k) return k; } return undefined; };
  const found = walk(snap.tree);
  assert.ok(found, `no ${role} named ${name}`);
  return found;
};

test('the names of the fields a page sends, never their values: a form, JSON, multipart', () => {
  assert.deepEqual(fieldNames('holder=Kari+N&card=4111&password=x', 'application/x-www-form-urlencoded'), ['holder', 'card', 'password']);
  assert.deepEqual(fieldNames('{"trip":"July","people":4}', 'application/json'), ['trip', 'people']);
  assert.deepEqual(fieldNames('--b\r\nContent-Disposition: form-data; name="file"; filename="a.pdf"\r\n\r\n%PDF\r\n--b--', 'multipart/form-data; boundary=b'), ['file']);
  assert.deepEqual(fieldNames(undefined), []);
});

test('the model clicks Pay: the post waits for the person; a no sends nothing and the model is told; a yes sends it, once', async () => {
  const w = window(); const { mcp, json } = await mcpClient(w.ui.url);
  try {
    posts.length = 0;
    const opened = await json('show_view', { name: 'shop', title: 'Airline checkout', browser: { url: base } });
    const pay = find(opened.snapshot, 'button', 'Pay');
    await w.tabs[0].fill('input[name=holder]', 'Kari Nordmann'); // the person fills in what is theirs
    await w.tabs[0].fill('input[name=card]', '4111 1111 1111 1111');
    const first = json('act_in_view', { view: 'shop', action: 'click', ref: pay.ref });
    const a1 = await w.askShown();
    assert.match(a1.ask!.title, /^Let the page send this to 127\.0\.0\.1:\d+\?$/);
    assert.deepEqual(a1.ask!.details, [{ label: 'to', text: `POST ${base}pay` }, { label: 'fields', text: 'holder, card (secret: the model never sees it), password (secret: the model never sees it)' }]);
    await sleep(300); assert.equal(posts.length, 0); // held: nothing left while the person decides
    w.answer(a1, false);
    const r1 = await first;
    assert.equal(posts.length, 0);
    assert.deepEqual(r1.sent, [{ to: `POST ${base}pay`, fields: ['holder', 'card', 'password'], secret_fields: ['card', 'password'], sent: false, note: 'the person did not let the page send it' }]);
    assert.equal(r1.snapshot.title, 'Checkout (synthetic)'); // still the checkout
    const second = json('act_in_view', { view: 'shop', action: 'click', ref: find(r1.snapshot, 'button', 'Pay').ref });
    w.answer(await w.askShown(), true);
    const r2 = await second;
    assert.deepEqual(posts, [{ path: '/pay', fields: ['holder', 'card', 'password'] }]);
    assert.equal(r2.sent[0].sent, true);
    assert.equal(r2.snapshot.title, 'Paid'); // the model reads the page the post led to
  } finally { await mcp.close(); w.ui.close(); }
});

test('a fetch that writes is held too; a plain read is not; what the person clicks on their own is never held', async () => {
  const w = window(); const { mcp, json } = await mcpClient(w.ui.url);
  try {
    posts.length = 0;
    const opened = await json('show_view', { name: 'shop', title: 'Airline checkout', browser: { url: base } }); // its GET: no ask
    assert.equal(w.shown.some(v => v.ask), false);
    const save = json('act_in_view', { view: 'shop', action: 'click', ref: find(opened.snapshot, 'button', 'Save the trip').ref });
    const a = await w.askShown();
    assert.deepEqual(a.ask!.details?.[1], { label: 'fields', text: 'trip, people' });
    w.answer(a, true);
    const r = await save;
    assert.deepEqual(r.sent, [{ to: `POST ${base}save`, fields: ['trip', 'people'], sent: true }]);
    await until(() => posts.length === 1);
    await sleep(3200); // the model's doing has passed
    await w.tabs[0].click('#save'); // the person's own click
    await until(() => posts.length === 2);
    assert.equal(w.shown.some(v => v.ask), false);
  } finally { await mcp.close(); w.ui.close(); }
});

test('secret fields: the model reads only whether one is filled, never types in one, not even key by key', async () => {
  const w = window(); const { mcp, call, json } = await mcpClient(w.ui.url);
  try {
    const opened = await json('show_view', { name: 'shop', title: 'Airline checkout', browser: { url: base } });
    const pw = find(opened.snapshot, 'textbox', 'Password'), card = find(opened.snapshot, 'textbox', 'Card number');
    assert.deepEqual({ secret: pw.secret, value: pw.value }, { secret: true, value: 'empty' });
    const typed = await call('act_in_view', { view: 'shop', action: 'type', ref: pw.ref, text: 'synthetic-pass-1234' });
    assert.equal(typed.ok, false); assert.match(typed.text, /a secret field \(a password, card number or code\): the person fills it in themselves/);
    assert.equal(await w.tabs[0].inputValue('input[name=password]'), '');
    await json('act_in_view', { view: 'shop', action: 'click', ref: card.ref }); // focus may be given; typing may not
    const key = await call('act_in_view', { view: 'shop', action: 'press', key: '4' });
    assert.equal(key.ok, false); assert.match(key.text, /a secret field/);
    assert.equal(await w.tabs[0].inputValue('input[name=card]'), '');
    await w.tabs[0].fill('input[name=card]', '4111 1111 1111 1111'); // the person types them
    await w.tabs[0].fill('input[name=password]', 'synthetic-pass-1234');
    const read = await call('read_view', { view: 'shop' });
    assert.doesNotMatch(read.text, /4111|synthetic-pass|•/);
    const snap = JSON.parse(read.text).snapshot;
    assert.deepEqual([find(snap, 'textbox', 'Card number').value, find(snap, 'textbox', 'Password').value], ['filled', 'filled']);
    assert.equal(find(snap, 'textbox', 'Name on card').secret, undefined); // a name on a card is not a secret
  } finally { await mcp.close(); w.ui.close(); }
});

test('the person points at an element of a page: the click picks it and never reaches the page; a secret field is said to be one, nothing more; the model\'s references stay', async () => {
  const w = window(); const { mcp, json } = await mcpClient(w.ui.url);
  try {
    posts.length = 0;
    const opened = await json('show_view', { name: 'shop', title: 'Airline checkout', browser: { url: base } });
    const pay = find(opened.snapshot, 'button', 'Pay');
    await w.tabs[0].fill('input[name=card]', '4111 1111 1111 1111'); // the person's
    const at = async (sel: string) => { const b = await w.tabs[0].locator(sel).boundingBox(); if (!b) throw new Error(`${sel} is not drawn`); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const pointAt = async (sel: string) => {
      const picked = w.ui.pointInPage('shop'); await sleep(250); const p = await at(sel);
      await w.tabs[0].mouse.click(p.x, p.y); return picked;
    };
    const button = await pointAt('button[type=submit]');
    assert.deepEqual(button, { view: 'shop', kind: 'browser', url: base, element: pay.ref, role: 'button', name: 'Pay 12 400 kr', note: 'its reference in your latest snapshot of the page' });
    await sleep(300); assert.equal(posts.length, 0); // the click picked the button; the page never got it
    const card = (await pointAt('input[name=card]'))!;
    assert.equal(card.secret, true); assert.equal(card.role, 'textbox'); assert.equal(card.name, 'Card number');
    assert.match(String(card.note), /a secret field: the person fills it in themselves/); assert.doesNotMatch(JSON.stringify(card), /4111/);
    const heading = (await pointAt('h1'))!;
    assert.deepEqual([heading.role, heading.name, heading.element], ['heading', 'Flights, 4 people, 12 400 kr', undefined]);
    assert.match(String(heading.note), /not in your latest snapshot of the page: read_view, then find it by its role and name/);
    assert.equal(w.ui.selection().length, 3);
    const off = w.ui.pointInPage('shop'); await sleep(150); w.ui.stopPointing('shop'); assert.equal(await off, null); // called off
    const again = await json('read_view', { view: 'shop' });
    assert.equal(find(again.snapshot, 'button', 'Pay').ref, pay.ref); // pointing changed none of the model's references
  } finally { await mcp.close(); w.ui.close(); }
});
