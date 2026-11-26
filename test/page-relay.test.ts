// What a host that relays a page's messages itself takes from Vindu, so it keeps the window's bounds without copying
// them: the page guard, and where a host's results are written. All synthetic; no window.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pageMessageGuard, REPORT_MAX, SEND_MAX } from '../src/renderer/index.js';
import { memoryResults } from '../src/index.js';

test("a page's sends, picks and asks: only while the person uses it, from a view, each kind counted on its own", () => {
  const guard = pageMessageGuard(),
    at = 1_000_000;
  const send = (n: number, o: Partial<Parameters<typeof guard>[0]> = {}) =>
    guard({ kind: 'send', view: 'v', panel: 'p', value: { n }, using: true, now: at + n, ...o });
  assert.equal(
    guard({ kind: 'send', view: 'v', panel: 'p', value: 1, using: false, now: at }),
    'a page sends only while the person is using it: on their click or key in it',
  );
  assert.equal(
    guard({ kind: 'send', view: '', panel: 'p', value: 1, using: true, now: at }),
    'this page is in no view',
  );
  assert.equal(
    guard({ kind: 'send', view: 'v', panel: '', value: 1, using: true, now: at }),
    'this page is in no view',
  );
  for (let n = 1; n <= 5; n++) assert.equal(send(n), undefined);
  assert.equal(send(6), 'too many: 5 sends in 10 seconds at most');
  assert.equal(
    guard({ kind: 'select', view: 'v', panel: 'p', value: { items: [] }, using: true, now: at + 6 }),
    undefined,
  ); // a pick counts apart
  assert.equal(send(7, { view: 'w' }), undefined); // another view counts apart
  assert.equal(send(10_007), undefined); // the window has moved on
  assert.equal(send(10_008, { value: 'x'.repeat(SEND_MAX) }), `not a value of at most ${SEND_MAX} characters as JSON`);
  assert.equal(guard({ kind: 'ask', view: 'v', panel: '', value: 'Why?', using: true, now: at }), undefined); // an ask needs its view, not a panel
});

test("a page's report: from a view's page panel, small, and never counted", () => {
  const guard = pageMessageGuard();
  for (let n = 0; n < 30; n++)
    assert.equal(guard({ kind: 'report', view: 'v', panel: 'p', value: { n }, using: false }), undefined);
  assert.equal(guard({ kind: 'report', view: 'v', panel: '', value: {}, using: true }), 'this page is in no view');
  assert.equal(
    guard({ kind: 'report', view: 'v', panel: 'p', value: 'x'.repeat(REPORT_MAX), using: true }),
    `not a report of at most ${REPORT_MAX} characters as JSON`,
  );
});

test("how far a page is read: from a view's page panel, a share from 0 to 1, and never counted", () => {
  const guard = pageMessageGuard();
  for (let n = 0; n <= 30; n++)
    assert.equal(guard({ kind: 'read', view: 'v', panel: 'p', value: n / 30, using: false }), undefined);
  assert.equal(guard({ kind: 'read', view: 'v', panel: '', value: 0.5, using: true }), 'this page is in no view');
  for (const value of [-0.1, 1.01, Number.NaN, '0.5', null, { share: 1 }])
    assert.equal(
      guard({ kind: 'read', view: 'v', panel: 'p', value, using: true }),
      'a read is a share of the page, from 0 to 1',
      JSON.stringify(value),
    );
});

test.skipIf(process.platform === 'win32')(
  "a host's result pictures are its own: written readable by this user only, in any folder",
  () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vindu-pictures-'));
    try {
      fs.chmodSync(dir, 0o755); // a folder others may read
      fs.writeFileSync(path.join(dir, 'r1-1.png'), 'before', { mode: 0o644 }); // left from an earlier run
      const r = memoryResults(dir).add({
        server: 'photos',
        tool: 'thumbnail',
        images: [
          { data: new Uint8Array([1, 2, 3]), mime: 'image/png' },
          { data: new Uint8Array([4]), mime: 'image/jpeg' },
        ],
      });
      assert.deepEqual(
        r.images.map((im) => fs.statSync(im.file).mode & 0o777),
        [0o600, 0o600],
      );
      assert.deepEqual([...fs.readFileSync(r.images[0].file)], [1, 2, 3]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
