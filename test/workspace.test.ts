// Exercise the public browser import with a host's own messages and actions, as any host uses it.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { afterAll, test } from 'vitest';
import type { Browser, Page } from 'playwright';
import type { mountWorkspace, WorkspaceHandle } from '../src/renderer/index.js';
import { chromium } from './helpers.js';

type WindowUnderTest = Window & {
  app: { mountWorkspace: typeof mountWorkspace };
  workspace: WorkspaceHandle;
  events: string[];
  finishSend: () => void;
};
const browser: Browser = await chromium.launch();
afterAll(() => browser.close());

async function page(): Promise<Page> {
  const p = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await p.setContent('<main style="height:640px;--v-sidebar-width:300px;--v-pane:rgb(0,40,60)"></main>');
  await p.addScriptTag({ type: 'module', path: fileURLToPath(new URL('fixtures/app.bundle.js', import.meta.url)) });
  await p.waitForFunction(() => !!(window as unknown as WindowUnderTest).app);
  return p;
}

test('default workspace selects tasks, presents plain messages and submits exactly the host draft', async () => {
  const p = await page();
  try {
    await p.evaluate(() => {
      const w = window as unknown as WindowUnderTest;
      w.events = [];
      w.workspace = w.app.mountWorkspace(document.querySelector('main')!, {
        onSelectTask: (id) => {
          w.events.push('task:' + id);
          w.workspace.setMessages([{ id: 'message-1', role: 'assistant', text: '<script>literal text</script>' }]);
        },
        onBack: () => w.events.push('back'),
        onRemoveContext: (id) => {
          w.events.push('remove:' + id);
          w.workspace.setContext([]);
        },
        onSend: async (text) => {
          w.events.push('send:' + text);
          await new Promise<void>((done) => {
            w.finishSend = done;
          });
          throw new Error('Please retry');
        },
      });
      w.workspace.setTasks([{ id: 't1', title: 'Review', status: 'Ready' }]);
      w.workspace.setContext([{ id: 'row:5', label: 'Row 5' }]);
    });
    const send = p.getByRole('button', { name: 'Send', exact: true });
    assert.ok(await send.isDisabled());
    const task = p.getByRole('button', { name: 'Review Ready' });
    await task.press('Enter');
    assert.ok(
      await p.getByRole('button', { name: 'Back to activity' }).evaluate((el) => el === document.activeElement),
    );
    assert.equal(await p.getByRole('log').innerText(), '<script>literal text</script>');
    await p.getByRole('button', { name: 'Remove Row 5' }).click();
    const input = p.getByRole('textbox', { name: 'Message' });
    await input.fill('  first');
    await input.press('Shift+Enter');
    await input.press('B');
    await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
    const draft = await input.inputValue();
    assert.equal(draft, '  first\nB');
    assert.deepEqual(await p.evaluate(() => (window as unknown as WindowUnderTest).events), [
      'task:t1',
      'remove:row:5',
    ]);
    await input.press('Enter');
    await input.press('Enter');
    assert.ok(await send.isDisabled());
    await p.evaluate(() => (window as unknown as WindowUnderTest).finishSend());
    await p.getByRole('alert').waitFor();
    assert.equal(await input.inputValue(), draft);
    assert.ok(await send.isEnabled());
    await input.press('Escape');
    assert.ok(await task.evaluate((el) => el === document.activeElement));
    assert.deepEqual(await p.evaluate(() => (window as unknown as WindowUnderTest).events), [
      'task:t1',
      'remove:row:5',
      'send:' + draft,
      'back',
    ]);
  } finally {
    await p.close();
  }
});

test('sidebar and composer can be styled, independently toggled or omitted on desktop and phone', async () => {
  const p = await page();
  try {
    await p.evaluate(() => {
      const w = window as unknown as WindowUnderTest;
      w.workspace = w.app.mountWorkspace(document.querySelector('main')!);
      w.workspace.setDraft('keep me');
    });
    const sidebar = p.getByRole('complementary');
    const form = p.locator('form');
    const views = p.locator('.vindu-workspace-views');
    assert.equal((await sidebar.boundingBox())!.width, 300);
    assert.equal((await sidebar.boundingBox())!.x, (await views.boundingBox())!.x + (await views.boundingBox())!.width);
    assert.equal(await form.evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(0, 40, 60)');
    await p.setViewportSize({ width: 390, height: 700 });
    assert.ok((await sidebar.boundingBox())!.y >= (await views.boundingBox())!.y + (await views.boundingBox())!.height);
    assert.ok(await p.getByRole('textbox').isVisible());
    await p.getByRole('textbox').focus();
    await p.evaluate(() => (window as unknown as WindowUnderTest).workspace.setVisible({ sidebar: false }));
    assert.ok(await sidebar.isHidden());
    assert.ok(await form.isVisible());
    assert.equal(await p.getByRole('textbox').inputValue(), 'keep me');
    assert.ok(await p.getByRole('textbox').evaluate((el) => el === document.activeElement));
    await p.evaluate(() =>
      (window as unknown as WindowUnderTest).workspace.setVisible({ sidebar: true, composer: false }),
    );
    assert.ok(await sidebar.isVisible());
    assert.ok(await form.isHidden());
    await p.evaluate(() => {
      const w = window as unknown as WindowUnderTest;
      w.workspace.destroy();
      w.workspace = w.app.mountWorkspace(document.querySelector('main')!, { sidebar: false, composer: false });
    });
    assert.equal(await p.locator('form,aside,textarea').count(), 0);
    assert.ok(await views.isVisible());
  } finally {
    await p.close();
  }
});

test('mounted forms can adopt host markup and release their handlers on teardown', async () => {
  const p = await page();
  try {
    await p.evaluate(() => {
      const w = window as unknown as WindowUnderTest;
      const host = document.querySelector('main')!;
      host.innerHTML = '<section></section><form><textarea></textarea><footer><button>Publish</button></footer></form>';
      w.events = [];
      w.workspace = w.app.mountWorkspace(host, {
        sidebar: false,
        styles: false,
        elements: {
          views: host.querySelector('section')!,
          composer: {
            element: host.querySelector('form')!,
            input: host.querySelector('textarea')!,
            tools: host.querySelector('footer')!,
            send: host.querySelector('button')!,
          },
        },
        canSend: () => true,
        onSend: (text) => {
          w.events.push(text);
        },
      });
    });
    await p.getByRole('button', { name: 'Publish' }).click();
    assert.deepEqual(await p.evaluate(() => (window as unknown as WindowUnderTest).events), ['']);
    assert.equal(await p.locator('form').count(), 1);
    assert.equal(await p.locator('main style').count(), 0);
    await p.evaluate(() => {
      const w = window as unknown as WindowUnderTest;
      w.workspace.destroy();
      document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    });
    assert.equal(await p.locator('form').count(), 1);
    assert.deepEqual(await p.evaluate(() => (window as unknown as WindowUnderTest).events), ['']);
  } finally {
    await p.close();
  }
});
