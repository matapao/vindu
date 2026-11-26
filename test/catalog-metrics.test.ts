// Exercise the public renderer with one real, populated A2UI surface for the whole catalog.
// Every entry declares a visible piece of its UI and the measurement a host can change.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { Page as BrowserPage } from 'playwright';
import { afterAll, test } from 'vitest';
import { chartSvg } from '../src/chart-svg.js';
import { Shell } from '../src/shell.js';
import { VINDU_CATALOG } from '../src/catalog-id.js';
import type { Surface, View } from '../src/renderer/index.js';
import { chromium } from './helpers.js';

const image = 'https://assets.test/image.svg';
const frameUrl = 'https://assets.test/frame';
const action = { event: { name: 'open', context: {} } };
const ref = (key: string) => ({ path: '/' + key });
type Example = { props?: Record<string, unknown>; part: string; property: string; intrinsic?: boolean };
const examples: Record<string, Example> = {
  AudioPlayer: {
    props: { url: 'https://assets.test/sound', description: 'Recording' },
    part: '.a2ui-audio-description',
    property: 'font-size',
  },
  Button: { props: { child: 'label', action }, part: 'button', property: 'padding-top' },
  Card: { props: { child: 'label' }, part: '.a2ui-card', property: 'padding-left' },
  CheckBox: { props: { label: 'Include', value: ref('included') }, part: 'label', property: 'font-size' },
  ChoicePicker: {
    props: { options: [{ label: 'First', value: '1' }], value: ref('selected') },
    part: '.a2ui-option-text',
    property: 'font-size',
  },
  Column: { props: { children: ['label', 'detail'] }, part: '', property: 'row-gap' },
  DateTimeInput: {
    props: { label: 'Day', value: ref('date'), enableDate: true },
    part: 'input',
    property: 'font-size',
  },
  Divider: { part: 'hr', property: 'margin-top' },
  Icon: { props: { name: 'home' }, part: '.a2ui-icon', property: 'font-size' },
  Image: { props: { url: image, variant: 'avatar' }, part: 'img', property: 'height' },
  List: { props: { children: ['label', 'detail'] }, part: '.a2ui-list-item-none', property: 'padding-top' },
  Modal: { props: { trigger: 'label', content: 'detail' }, part: '[role="dialog"]', property: 'padding-top' },
  Row: { props: { children: ['label', 'detail'] }, part: '', property: 'column-gap' },
  Slider: { props: { label: 'Volume', value: 3, max: 10 }, part: '.a2ui-slider-label', property: 'font-size' },
  Tabs: {
    props: {
      tabs: [
        { title: 'Overview', child: 'label' },
        { title: 'Details', child: 'detail' },
      ],
    },
    part: '.a2ui-tab-content',
    property: 'padding-top',
  },
  Text: { props: { text: 'Title', variant: 'h2' }, part: 'h2', property: 'font-size' },
  TextField: { props: { label: 'Name', value: ref('name') }, part: 'input', property: 'font-size' },
  Video: { props: { url: 'https://assets.test/video' }, part: 'video', property: 'width', intrinsic: true },
  VMessages: { part: '.vb-meta', property: 'column-gap' },
  VDocument: { part: '.vb-sec', property: 'padding-top' },
  VEvents: { part: '.vb-dayhead', property: 'font-size' },
  VNotice: { part: '.vb-notice', property: 'padding-left' },
  VTasks: { part: '.vb-item', property: 'padding-top' },
  VMoney: { part: 'td', property: 'padding-left' },
  VFiles: { part: '.vb-icon', property: 'font-size' },
  VMap: { part: '.vb-small', property: 'font-size' },
  VContacts: { part: '.vb-card', property: 'padding-left' },
  VSheet: { part: 'th', property: 'font-size' },
  VNotedTable: { props: { cells: ref('cells') }, part: 'td', property: 'padding-left' },
  VSlides: { part: '.vb-slidetitle', property: 'font-size' },
  VSignature: { part: '.vb-item', property: 'padding-top' },
  VDiagram: { props: { nodes: ref('nodes') }, part: '.vb-nodelabel', property: 'font-size' },
  VDevices: { part: '.vb-pill', property: 'font-size' },
  VBatch: { part: '.vb-meta', property: 'column-gap' },
  VChanges: { part: '.vb-anchor', property: 'font-size' },
  VDecision: { part: '.vb-title', property: 'font-size' },
  VMediaMarks: {
    props: { kind: 'image', url: image, marks: ref('marks') },
    part: '.vb-region span',
    property: 'font-size',
  },
  VGallery: { props: { items: ref('pictures'), panel: 'pictures' }, part: '.vb-tilename', property: 'font-size' },
  VChart: { props: { url: ref('chart'), bands: 2 }, part: 'img', property: 'width', intrinsic: true },
  Page: {
    props: { url: frameUrl, title: 'Document', height: 92 },
    part: 'iframe',
    property: 'height',
    intrinsic: true,
  },
  McpApp: {
    props: { url: frameUrl, title: 'Connector', height: 92, resource: 'ui://example/result', panel: 'connector' },
    part: 'iframe',
    property: 'height',
    intrinsic: true,
  },
};

function catalogView(): View {
  const surfaceId = 'catalog';
  const children = Object.keys(examples);
  const row = {
    title: 'Report',
    name: 'June',
    subject: 'Summary',
    body: 'Ready',
    start: '2026-06-01',
    amount: 3,
    state: 'on',
  };
  const data = {
    rows: [row],
    map: Object.fromEntries(Object.keys(row).map((k) => [k, k])),
    name: '',
    included: false,
    selected: [],
    date: '2026-06-01',
    marks: [{ x: 0.2, y: 0.3, w: 0.4, h: 0.1, label: 'Area' }],
    nodes: [{ id: 'Step', layer: 0, order: 0 }],
    pictures: [{ name: 'Cabin', kind: 'image', url: image, at: '1 of 1' }],
    cells: { fields: ['title'], notes: [{ n: 1, cell: 'A2', note: 'Checked', row: 0, column: 0 }] },
  };
  const blocks = children.map((name) => ({
    id: name,
    component: name,
    ...(name.startsWith('V') && !['Video', 'VChart', 'VMediaMarks', 'VGallery'].includes(name)
      ? { rows: ref('rows'), map: ref('map') }
      : {}),
    ...examples[name].props,
  }));
  const surface = (width: number): Surface => [
    { version: 'v0.9', createSurface: { surfaceId, catalogId: VINDU_CATALOG } },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId,
        components: [
          { id: 'root', component: 'Column', children },
          { id: 'label', component: 'Text', text: 'Summary' },
          { id: 'detail', component: 'Text', text: 'More details' },
          ...blocks,
        ],
      },
    },
    {
      version: 'v0.9',
      updateDataModel: {
        surfaceId,
        path: '/',
        value: { ...data, chart: chartSvg('bar-chart', [row], 'name', ['amount'], width) },
      },
    },
  ];
  return { name: surfaceId, wide: surface(640), compact: surface(320) };
}

const bundle = await readFile(new URL('./fixtures/app.bundle.js', import.meta.url), 'utf8');
const browser = await chromium.launch();
afterAll(() => browser.close());

async function open(page: BrowserPage) {
  // Intercept the host, media and embedded documents; the browser makes no external requests.
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/bundle.js') return route.fulfill({ contentType: 'text/javascript', body: bundle });
    if (url.pathname === '/image.svg')
      return route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40"/></svg>',
      });
    if (url.pathname === '/frame')
      return route.fulfill({ contentType: 'text/html', body: '<p style="font-size:17px">Provider text</p>' });
    if (url.hostname === 'assets.test') return route.fulfill({ status: 204 });
    return route.fulfill({
      contentType: 'text/html',
      body: '<meta name="viewport" content="width=device-width, initial-scale=1"><main id="stock"></main><main id="custom"></main><div id="shell"></div><script type="module" src="/bundle.js"></script>',
    });
  });
  await page.goto('https://host.test/');
}

async function readParts(page: BrowserPage, id: string, tags: Record<string, string>) {
  return page.locator('#' + id).evaluate(
    async (host, { tags, examples }) => {
      const modal = host.querySelector<HTMLElement>('a2ui-modal')!;
      modal.querySelector<HTMLElement>('.a2ui-modal-trigger')!.click();
      await (modal as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
      const result: Record<string, number> = {};
      for (const [name, spec] of Object.entries(examples)) {
        const part = host.querySelector([tags[name], spec.part].filter(Boolean).join(' '));
        if (!part || !part.getBoundingClientRect().width) throw new Error(name + ' has no rendered ' + spec.part);
        result[name] = parseFloat(getComputedStyle(part).getPropertyValue(spec.property));
      }
      modal.querySelector<HTMLElement>('.a2ui-modal-overlay')!.click();
      return result;
    },
    { tags, examples },
  );
}

for (const [name, width, height] of [
  ['desktop', 1280, 850],
  ['phone', 390, 844],
] as const) {
  test('all catalog components render with stock and host metrics on ' + name, async () => {
    const page: BrowserPage = await browser.newPage({
      viewport: { width, height },
      isMobile: name === 'phone',
      hasTouch: name === 'phone',
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await open(page);
      const view = catalogView();
      const tags: Record<string, string> = await page.evaluate(
        (view) => window.app.catalog('stock', view, { theme: true }),
        view,
      );
      assert.deepEqual(
        Object.keys(examples).sort(),
        Object.keys(tags).sort(),
        'every registered catalog element needs a rendered example',
      );
      const stock = await readParts(page, 'stock', tags);
      await page.evaluate(
        (view) =>
          window.app.catalog('custom', view, {
            theme: true,
            metrics: { spacing: '16px', fontSize: '19px', density: 0.75 },
          }),
        view,
      );
      const custom = await readParts(page, 'custom', tags);
      const chartFont = name === 'phone' ? 12 : 11;
      await page.waitForFunction(
        ({ chartFont }) => {
          const image = document.querySelector<HTMLImageElement>('#custom vindu-chart img')!;
          const svg = atob(image.src.split(',')[1]); // read as text, never parsed as markup: only the root's font size is wanted
          const size = / font-size="([\d.]+)"/.exec(svg.slice(0, svg.indexOf('>')))?.[1];
          return Math.abs(Number(size) - (chartFont * 19) / 13) < 0.01;
        },
        { chartFont },
        { timeout: 3000 },
      );
      const failures = Object.entries(examples)
        .filter(([name, spec]) => (spec.intrinsic ? custom[name] !== stock[name] : !(custom[name] > stock[name])))
        .map(([name, spec]) => ({
          component: name,
          property: spec.property,
          stock: stock[name],
          custom: custom[name],
        }));
      assert.deepEqual(failures, [], 'host sizing applies to adjustable parts and preserves intrinsic media geometry');
      assert.deepEqual(await readParts(page, 'stock', tags), stock, 'the second host cannot change the first');
      const host = page.locator('#custom');
      assert.ok(
        await host.evaluate((el) => el.scrollWidth <= el.clientWidth),
        'wide tables scroll within their block; the host fits the viewport',
      );
      await host.getByRole('button', { name: 'Details', exact: true }).click();
      assert.equal(await host.locator('.a2ui-tab-content').innerText(), 'More details');
      assert.equal(await host.locator('vindu-app iframe').evaluate((f: HTMLIFrameElement) => f.contentDocument), null);
      for (const tag of [tags.Page, tags.McpApp]) {
        const doc = host.frameLocator(tag + ' iframe');
        assert.equal(await doc.locator('p').evaluate((p) => getComputedStyle(p).fontSize), '17px');
      }
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });
}

test('a live shell updates and resets type roles and density without remounting', async () => {
  const page: BrowserPage = await browser.newPage();
  try {
    await open(page);
    const read = () =>
      page.locator('#shell vindu-tasks .vb-item').evaluate((row) => {
        const style = getComputedStyle(row);
        return { padding: style.paddingTop, gap: style.columnGap, type: style.fontSize };
      });
    const view = catalogView();
    const shell = new Shell();
    shell.show(view.name, { title: 'Catalog', panels: 'Catalog', fill: false });
    await page.evaluate(
      ({ view, state }) => {
        const shellHost = document.getElementById('shell')!;
        shellHost.style.cssText = 'position:fixed;inset:0';
        window.app.shell('light', false, { fontSize: '19px' });
        window.app.view(view);
        window.app.state(state);
      },
      { view, state: shell.state() },
    );
    const provider = page.frameLocator('#shell vindu-app iframe').locator('body');
    const received = await provider.evaluate(
      () =>
        new Promise<string | undefined>((resolve, reject) => {
          const timer = setTimeout(() => reject(Error('No initialization reply')), 3000);
          addEventListener('message', (e) => {
            if (e.source !== parent) return;
            if (e.data.id === 17 && e.data.result) {
              clearTimeout(timer);
              resolve(e.data.result.hostContext.styles?.variables?.['--font-text-md-size']);
            }
            if (e.data.method === 'ui/notifications/host-context-changed') {
              const variables = e.data.params.styles.variables;
              for (const [attr, key] of [
                ['font', '--font-text-md-size'],
                ['heading', '--font-heading-md-size'],
                ['caption', '--font-text-sm-size'],
              ]) {
                if (key in variables) document.body.dataset[attr] = variables[key];
              }
            }
          });
          parent.postMessage({ jsonrpc: '2.0', id: 17, method: 'ui/initialize', params: {} }, '*');
        }),
    );
    assert.equal(received, '19px');
    await page.evaluate(() => window.app.metrics({}));
    await page.frameLocator('#shell vindu-app iframe').locator('body[data-font=""]').waitFor();
    const stock = await read();
    const roles = () =>
      page.locator('#shell').evaluate((host) => {
        const size = (selector: string) => getComputedStyle(host.querySelector(selector)!).fontSize;
        return [size('.a2ui-text h2'), size('.vb-slidetitle'), size('vindu-messages .vb-when')];
      });
    const stockRoles = await roles();
    const frame = page.frameLocator('#shell vindu-app iframe');
    await page.evaluate(() => window.app.metrics({ headingSize: '2rem' }));
    assert.deepEqual(await roles(), ['32px', '32px', stockRoles[2]]);
    await frame.locator('body[data-heading="32px"]').waitFor();
    await page.evaluate(() => window.app.metrics({ captionSize: '17px' }));
    assert.deepEqual(await roles(), [stockRoles[0], stockRoles[1], '17px']);
    await frame.locator('body[data-heading=""][data-caption="17px"]').waitFor();
    assert.deepEqual(await read(), stock, 'body text, row spacing and density keep their defaults');
    const field = page.locator('#shell a2ui-basic-textfield input');
    await field.fill('Draft input');
    await page.evaluate(() => window.app.metrics({ density: 0.5 }));
    await frame.locator('body[data-caption=""]').waitFor();
    assert.deepEqual(await roles(), stockRoles);
    const compact = await read();
    assert.ok(parseFloat(compact.padding) < parseFloat(stock.padding));
    assert.equal(compact.gap, stock.gap);
    assert.equal(compact.type, stock.type);
    await page.evaluate(() => window.app.metrics({}));
    assert.deepEqual(await read(), stock);
    assert.equal(await field.inputValue(), 'Draft input');
    assert.ok(
      await field.evaluate((input) => input === document.activeElement),
      'the focused input survives both changes',
    );
  } finally {
    await page.close();
  }
});

test('a standalone host can set spacing in rem and bring its own stylesheet', async () => {
  const page: BrowserPage = await browser.newPage();
  try {
    await open(page);
    const view = catalogView();
    await page.evaluate((view) => {
      document.documentElement.style.fontSize = '20px';
      const host = document.getElementById('custom')!;
      host.style.setProperty('--v-spacing', '7px', 'important');
      host.style.color = 'rgb(40, 20, 10)';
      window.app.catalog('custom', view, {});
    }, view);
    const field = page.locator('#custom a2ui-basic-textfield input');
    const read = () =>
      field.evaluate((input) => {
        const style = getComputedStyle(input);
        return { padding: style.paddingLeft, font: style.fontSize };
      });
    const stock = await read();
    await page.evaluate((view) => window.app.catalog('custom', view, { metrics: { spacing: '0.5rem' } }), view);
    assert.deepEqual(await read(), { padding: '10px', font: stock.font });
    assert.ok(
      await page
        .locator('#custom')
        .evaluate(
          (el) =>
            getComputedStyle(el).color === 'rgb(40, 20, 10)' &&
            !el.classList.contains('vindu-theme') &&
            !document.querySelector('style[data-vindu="theme"]'),
        ),
    );
    await page.evaluate((view) => window.app.catalog('custom', view, {}), view);
    assert.deepEqual(await read(), stock);
    const host = page.locator('#custom');
    assert.deepEqual(
      await host.evaluate((el) => [
        el.style.getPropertyValue('--v-spacing'),
        el.style.getPropertyPriority('--v-spacing'),
        el.hasAttribute('data-vindu-metrics'),
      ]),
      ['7px', 'important', false],
    );
  } finally {
    await page.close();
  }
});
