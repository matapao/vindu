// Charts: a bar chart and a line chart, drawn by the system as an image (chart-svg.ts), with a strip over each
// category to point at, or to open when it stands for a group.
import { GUIDE, MAX_CHART_ROWS, type CardName } from '../cards.js';
import { CHART_LEFT, CHART_RIGHT, chartSvg } from '../chart-svg.js';
import { asText } from '../format.js';
import { drawnFrom, type CardKind } from './kind.js';

const chart = (name: CardName): CardKind => ({
  reads: GUIDE[name].fields, maxRows: MAX_CHART_ROWS,
  check: (p, d) => { for (const y of [p.y!].flat()) if (!(d.rows ?? []).some(r => Number.isFinite(Number(r[y])))) return `"${y}" has no numbers to chart`; return null; },
  // after grouping there is one number per group: that is what the chart shows
  grouped: (p, group, field, notes) => {
    if (p.y && [p.y].flat().join() !== field) notes.push(`panel ${p.id}: charted ${field} (the computed value) for y`);
    p.x = group; p.y = field;
  },
  // drawn here narrower when narrow, so its text stays readable; the window draws it again from the same rows at the
  // width of its pane (spec), so that it fills it
  draw: (p, d, k) => {
    const rows = drawnFrom(p, d, 'rows').slice(0, MAX_CHART_ROWS), W = k.compact ? 360 : 640, x = p.x!, ys = [p.y!].flat();
    k.model.chart = chartSvg(p.card, rows, x, ys, W, k.locale, k.timeZone);
    k.model.spec = { kind: p.card, x, ys, locale: k.locale, timeZone: k.timeZone, rows: rows.map(r => Object.fromEntries([x, ...ys].map(f => [f, r[f] ?? null]))) };
    return [k.add({ id: `${k.pid}__chart`, component: 'VChart', url: { path: `/panels/${k.pid}/chart` }, spec: { path: `/panels/${k.pid}/spec` }, bands: rows.length, left: CHART_LEFT / W, right: CHART_RIGHT / W, panel: p.id, ...(p.group ? { opens: true } : {}) })];
  },
  account: (o, p, d) => { o.shows = d.rows!.slice(0, 12).map(r => `${asText(r[p.x!])} ${[p.y!].flat().map(y => r[y]).join('/')}`).join(' · '); },
  present: (out, p) => { if (p.x && p.y) out.chart = { x: p.x, y: [p.y].flat() }; },
});
export const BAR_CHART = chart('bar-chart');
export const LINE_CHART = chart('line-chart');
