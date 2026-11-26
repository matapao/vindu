// A chart drawn by the system as a small SVG image, the same for the same rows and width: one axis, round ticks, its
// own light and dark colours. A bar chart and a line chart, of one numeric field or several. Its numbers and dates
// are the view's locale's, and its legend names each series as a person reads it. Drawn by the UI server, and again
// by the window at the width of its pane (renderer/blocks/media.ts), so nothing here is Node's alone.
import { escapeText as esc } from './escape.js';
import { readableName } from './field-names.js';
import { asText, ellipsis, isCalendarDay } from './format.js';
import type { Row } from './results.js';
import { SERIES } from './series.js';

/** The room left of the plot, for the axis's numbers, and right of it. */
export const CHART_LEFT = 56;
export const CHART_RIGHT = 24;
/** An ISO date, or a date and time. */
const ISO_DATE = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})?)?$/;
/** A category as a person reads it: a date in the locale's short date (with its time, when it has one, in the time
 *  zone), anything else as written. */
function categoryOf(v: unknown, locale: string, timeZone: string): string {
  const text = asText(v ?? ''),
    iso = ISO_DATE.exec(text);
  if (!iso || !isCalendarDay(iso[1])) return text;
  const at = new Date(iso[2] ? text : `${iso[1]}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) return text;
  return new Intl.DateTimeFormat(
    locale,
    iso[2] ? { dateStyle: 'short', timeStyle: 'short', timeZone } : { dateStyle: 'short', timeZone: 'UTC' },
  ).format(at);
}
/** SVG text as a data: URL, in base64 of its UTF-8, the same in Node and in a browser. */
function svgImage(svg: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(svg)) binary += String.fromCharCode(byte);
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}
/** Round ticks: about five, at 1, 2, 2.5 or 5 times a power of ten. */
export function niceScale(min: number, max: number): { lo: number; hi: number; ticks: number[] } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) [min, max] = [0, 1]; // nothing to scale: an axis from 0 to 1
  if (!(max > min)) max = min + (Math.abs(min) / 10 || 1); // one value: room around it, at any size (1e16 + 1 is 1e16)
  const raw = (max - min) / 4,
    mag = 10 ** Math.floor(Math.log10(raw)),
    f = raw / mag;
  const step = ([1, 2, 2.5, 5].find((n) => f <= n) ?? 10) * mag; // the least of them at or above f
  const lo = Math.floor(min / step) * step,
    hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let k = 0; lo + k * step <= hi + step / 2; k++) ticks.push(Number((lo + k * step).toPrecision(12)));
  return { lo, hi, ticks };
}

/** A small deterministic SVG chart: one axis, thin marks (bars at most 24 px with 4 px rounded ends, 2 px lines with
 *  8 px end markers), hairline grid, ticks in full below 10,000 and compact above, a legend for two or more series,
 *  one direct label (the highest bar, the last point). Its own light and dark colours. Labels too long end in an
 *  ellipsis, and only as many categories are labelled as there is room for, each label as wide as it needs. */
export function chartSvg(
  kind: string,
  rows: Row[],
  x: string,
  ys: string[],
  W = 640,
  locale = 'en-GB',
  timeZone = 'UTC',
): string {
  const H = W < 500 ? 240 : 260,
    L = CHART_LEFT,
    R = CHART_RIGHT,
    B = 34,
    T = ys.length > 1 ? 40 : 22,
    size = W < 500 ? 12 : 11;
  const n = Math.max(1, rows.length),
    band = (W - L - R) / n;
  const compactNumber = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }); // 10K, 1.2M; 10k, 1,2 mill.
  const categories = rows.map((r) => categoryOf(r[x], locale, timeZone));
  const widest = Math.min(24, Math.max(0, ...categories.map((c) => c.length))); // characters; a longer label is cut
  const vals = rows.flatMap((r) => ys.map((y) => Number(r[y]))).filter(Number.isFinite);
  const max = Math.max(0, ...vals),
    min = Math.min(0, ...vals);
  const { lo, hi, ticks } = niceScale(min, max + (max - min) * 0.08); // room for the direct label
  const sy = (v: number) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const fmt = (v: number) =>
    Math.abs(hi) >= 10000 || Math.abs(lo) >= 10000
      ? compactNumber.format(v)
      : v.toLocaleString(locale, { maximumFractionDigits: 2 });
  const series = (m: 'light' | 'dark') =>
    ys.map((_, i) => `.f${i}{fill:${SERIES[m][i % 8]}}.l${i}{stroke:${SERIES[m][i % 8]}}`).join('');
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="${size}">`,
    `<style>.g{stroke:#e1e0d9}.b{stroke:#c3c2b7}.t{fill:#898781}.k{fill:#52514e}.ring{stroke:#fcfcfb}${series('light')}@media (prefers-color-scheme: dark){.g{stroke:#2c2c2a}.b{stroke:#383835}.k{fill:#c3c2b7}.ring{stroke:#1a1a19}${series('dark')}}</style>`,
  ];
  for (const t of ticks) {
    const y = Math.round(sy(t)) + 0.5;
    out.push(
      `<line class="${t === 0 ? 'b' : 'g'}" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke-width="1"/>`,
      `<text class="t" x="${L - 8}" y="${y + 4}" text-anchor="end">${fmt(t)}</text>`,
    );
  }
  // thin the category labels so they never collide: each gets at least 64 px, or the room its widest label needs
  const room = Math.max(64, widest * size * 0.6 + 12),
    every = Math.ceil(n / Math.max(1, Math.floor((W - L - R) / room)));
  categories.forEach((c, i) => {
    if (i % every === 0)
      out.push(
        `<text class="t" x="${r1(L + band * (i + 0.5))}" y="${H - B + 18}" text-anchor="middle">${esc(chartLabel(c, band * every))}</text>`,
      );
  });
  if (ys.length > 1) {
    let lx = L;
    ys.forEach((y, i) => {
      const name = readableName(y);
      out.push(
        `<rect class="f${i}" x="${lx}" y="8" width="10" height="10" rx="2"/>`,
        `<text class="k" x="${lx + 15}" y="17">${esc(name)}</text>`,
      );
      lx += 30 + name.length * 6.5;
    });
  }
  let label: { x: number; y: number; v: number } | undefined;
  if (kind === 'bar-chart') {
    const k = ys.length,
      bw = Math.max(2, Math.min(24, (band * 0.72 - (k - 1) * 2) / k));
    ys.forEach((y, s) =>
      rows.forEach((r, i) => {
        const v = Number(r[y]);
        if (!Number.isFinite(v) || v === 0) return;
        const x0 = L + band * (i + 0.5) - (k * bw + (k - 1) * 2) / 2 + s * (bw + 2),
          top = sy(v),
          base = sy(0);
        const rr = Math.min(4, bw / 2, Math.abs(base - top));
        out.push(
          `<path class="f${s}" d="${
            v > 0
              ? `M${r1(x0)},${r1(base)}V${r1(top + rr)}Q${r1(x0)},${r1(top)} ${r1(x0 + rr)},${r1(top)}H${r1(x0 + bw - rr)}Q${r1(x0 + bw)},${r1(top)} ${r1(x0 + bw)},${r1(top + rr)}V${r1(base)}Z`
              : `M${r1(x0)},${r1(base)}V${r1(top - rr)}Q${r1(x0)},${r1(top)} ${r1(x0 + rr)},${r1(top)}H${r1(x0 + bw - rr)}Q${r1(x0 + bw)},${r1(top)} ${r1(x0 + bw)},${r1(top - rr)}V${r1(base)}Z`
          }"/>`,
        );
        if (k === 1 && (!label || v > label.v)) label = { x: x0 + bw / 2, y: top - 6, v };
      }),
    );
  } else {
    ys.forEach((y, s) => {
      const pts = rows
        .map((r, i) => [L + band * (i + 0.5), Number(r[y])] as const)
        .filter(([, v]) => Number.isFinite(v));
      if (!pts.length) return;
      out.push(
        `<polyline class="l${s}" fill="none" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${pts.map(([px, v]) => `${r1(px)},${r1(sy(v))}`).join(' ')}"/>`,
      );
      const [lx, lv] = pts[pts.length - 1];
      out.push(`<circle class="f${s} ring" cx="${r1(lx)}" cy="${r1(sy(lv))}" r="4" stroke-width="2"/>`);
      if (ys.length === 1) label = { x: lx, y: sy(lv) - 10, v: lv };
    });
  }
  if (label)
    out.push(
      `<text class="k" x="${r1(Math.min(W - R - 4, Math.max(L + 4, label.x)))}" y="${r1(Math.max(12, label.y))}" text-anchor="middle">${label.v.toLocaleString(locale, { maximumFractionDigits: 2 })}</text>`,
    );
  return svgImage(out.join('') + '</svg>');
}
const chartLabel = (label: string, bw: number) => ellipsis(label, Math.max(6, Math.floor(bw / 7)));
