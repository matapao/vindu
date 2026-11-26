// What a page check reads of a page once it has settled (page-check.ts): its title, text and headings, what it fetched
// and sent, its errors, what its charts plot, its 3D scenes and canvases. It runs in the page, so it stands alone.
import type { Measures, TaskRecord } from './page-measures.js';

export type Collected = {
  title: string; text: string; texts: string[]; characters: number; headings: string[]; fetched: string[]; sent: string[];
  counts: { errors: number; warnings: number; charts: number; three: number; canvases: number; headings: number; sent: number }; errors: string[]; warnings: string[]; failed: string[]; blocked: string[]; computed: number[]; libraries: string[];
  charts: { library: string; type?: string; labels?: string[]; series?: { name?: string; count: number; values: number[] }[]; error?: string }[];
  three: Record<string, unknown>[]; canvases: Record<string, unknown>[];
};

// Runs in the page after it settles. It must stand alone: it is sent as source.
export function collect(withTexts: boolean, measure: Measures): Collected {
  const w: Window & { __task?: TaskRecord } = window;
  const t: TaskRecord = w.__task ?? { errors: [], warnings: [], failed: [], blocked: [], charts: [], three: [], chartjs: null, computed: [], libraries: [], fetched: [], sent: [], contexts: new WeakMap(), counts: { errors: 0, warnings: 0, charts: 0, three: 0, sent: 0 } };
  // a point's number: a number, the last of a list ([x, y]), or an object's value (or y)
  const num = (v: unknown): number => {
    if (typeof v === 'number') return v;
    if (Array.isArray(v)) return num(v[v.length - 1]);
    if (v && typeof v === 'object') { const p: { value?: unknown; y?: unknown } = v; return num(p.value ?? p.y); }
    return Number(v);
  };
  // a label: an object's value, anything else as it is
  const label = (x: unknown) => { const own: { value?: unknown } = x && typeof x === 'object' ? x : {}; return String(own.value ?? x); };
  const charts: Collected['charts'] = [];
  for (const { chart } of t.charts.slice(0, 12)) {
    try {
      const o = chart.getOption();
      let axis: { data?: unknown[] } | undefined;
      if (o.xAxis?.[0]?.data) axis = o.xAxis[0]; else if (o.yAxis?.[0]?.data) axis = o.yAxis[0];
      charts.push({ library: 'echarts', type: [...new Set((o.series ?? []).map(s => s.type))].join(', '), labels: (axis?.data ?? []).slice(0, 12).map(label), series: (o.series ?? []).slice(0, 12).map(s => ({ name: s.name, count: (s.data ?? []).length, values: (s.data ?? []).slice(0, 5000).map(num) })) });
    } catch (e) { charts.push({ library: 'echarts', error: String(e) }); }
  }
  if (t.chartjs) for (const c of Object.values(t.chartjs.instances).slice(0, 12)) charts.push({ library: 'chart.js', type: c.config.type, labels: (c.data.labels ?? []).slice(0, 12).map(String), series: c.data.datasets.slice(0, 12).map(d => ({ name: d.label, count: (d.data ?? []).length, values: (d.data ?? []).slice(0, 5000).map(num) })) });
  // each renderer's main scene, the one with the most in it: a post-processing pass draws a quad of its own after it
  const three = t.three.slice(0, 4).map(r => {
    const s = measure.scene(r, 12), f = s.frame;
    return { frames: s.frames, draw_calls: f?.calls ?? r.info.render.calls, triangles: f?.triangles ?? r.info.render.triangles, objects: s.objects, ...(s.named.length ? { named: s.named } : {}), ...(s.camera ? { camera: String(s.camera.type).slice(0, 40) } : {}),
      ...((f?.renders ?? 0) > 1 ? { renders_per_frame: f?.renders } : {}), ...(s.scenes > 1 ? { scenes: s.scenes, note: 'the scene with the most objects is described; the others are drawn too, such as post-processing passes. draw_calls and triangles are for one frame, all renders together' } : {}) };
  });
  const all = [...document.querySelectorAll('canvas')];
  const canvases = all.slice(0, 8).map(c => {
    const k = t.contexts.get(c); const o: Record<string, unknown> = { size: `${c.width}×${c.height}`, context: k?.type ?? 'none' };
    if (k?.type === '2d') {
      try { const p = measure.paint(k.ctx as CanvasRenderingContext2D, c.width, c.height); o.painted = `${p.painted}%`; o.colors = p.colors; } catch { o.painted = 'unreadable'; }
    }
    if (k?.draws !== undefined) o.draw_calls = k.draws;
    return o;
  });
  const text = (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim();
  // the text of each element on its own, as drawn, for its numbers: labels side by side are separate numbers
  const texts: string[] = []; let total = 0;
  const walk = withTexts && document.body ? document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT) : null; // only a check of the data reads them
  for (let n = walk?.nextNode(); n && total < 200_000; n = walk!.nextNode()) {
    const el = n.parentElement, t = (n.textContent ?? '').trim();
    if (!t || !el || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(el.tagName) || (el.checkVisibility && !el.checkVisibility())) continue;
    texts.push(t.slice(0, 4000)); total += t.length;
  }
  return {
    title: document.title.slice(0, 200), text: text.slice(0, 161), texts, characters: text.length, // the report shows the first 160; the numbers in up to 200,000 characters of texts are checked
    headings: [...document.querySelectorAll('h1, h2, h3')].map(h => (h.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)).filter(Boolean).slice(0, 8), fetched: t.fetched,
    errors: t.errors, warnings: t.warnings, failed: t.failed, blocked: t.blocked, computed: t.computed, libraries: t.libraries, charts, three, canvases, sent: t.sent,
    counts: { errors: t.counts.errors, warnings: t.counts.warnings, charts: t.counts.charts + (t.chartjs ? Object.keys(t.chartjs.instances).length : 0), three: t.counts.three, canvases: all.length, headings: [...document.querySelectorAll('h1, h2, h3')].filter(h => (h.textContent ?? '').trim()).length, sent: t.counts.sent },
  };
}
