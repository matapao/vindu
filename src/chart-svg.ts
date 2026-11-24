// A chart drawn by the system as a small SVG image, the same for the same rows: one axis, round ticks, its own light
// and dark colours. A bar chart and a line chart, of one numeric field or several.
import { escapeText as esc } from './escape.js';
import { asText, ellipsis } from './format.js';
import type { Row } from './results.js';
import { SERIES } from './series.js';

const compactNumber = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }); // 10K, 1.2M
/** Round ticks: about five, at 1, 2, 2.5 or 5 times a power of ten. */
export function niceScale(min: number, max: number): { lo: number; hi: number; ticks: number[] } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) [min, max] = [0, 1]; // nothing to scale: an axis from 0 to 1
  if (!(max > min)) max = min + (Math.abs(min) / 10 || 1); // one value: room around it, at any size (1e16 + 1 is 1e16)
  const raw = (max - min) / 4, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks: number[] = []; for (let k = 0; lo + k * step <= hi + step / 2; k++) ticks.push(Number((lo + k * step).toPrecision(12)));
  return { lo, hi, ticks };
}

/** A small deterministic SVG chart: one axis, thin marks (bars at most 24 px with 4 px rounded ends, 2 px lines with
 *  8 px end markers), hairline grid, ticks in full below 10,000 and compact above, a legend for two or more series,
 *  one direct label (the highest bar, the last point). Its own light and dark colours. Labels too long end in an ellipsis. */
export function chartSvg(kind: string, rows: Row[], x: string, ys: string[], W = 640, locale = 'en-GB'): string {
  const H = W < 500 ? 240 : 260, L = 56, R = 24, B = 34, T = ys.length > 1 ? 40 : 22;
  const n = Math.max(1, rows.length), band = (W - L - R) / n;
  const vals = rows.flatMap(r => ys.map(y => Number(r[y]))).filter(Number.isFinite);
  const max = Math.max(0, ...vals), min = Math.min(0, ...vals);
  const { lo, hi, ticks } = niceScale(min, max + (max - min) * 0.08); // room for the direct label
  const sy = (v: number) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const fmt = (v: number) => (Math.abs(hi) >= 10000 || Math.abs(lo) >= 10000 ? compactNumber.format(v) : v.toLocaleString(locale, { maximumFractionDigits: 2 }));
  const series = (m: 'light' | 'dark') => ys.map((_, i) => `.f${i}{fill:${SERIES[m][i % 8]}}.l${i}{stroke:${SERIES[m][i % 8]}}`).join('');
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="${W < 500 ? 12 : 11}">`,
    `<style>.g{stroke:#e1e0d9}.b{stroke:#c3c2b7}.t{fill:#898781}.k{fill:#52514e}.ring{stroke:#fcfcfb}${series('light')}@media (prefers-color-scheme: dark){.g{stroke:#2c2c2a}.b{stroke:#383835}.k{fill:#c3c2b7}.ring{stroke:#1a1a19}${series('dark')}}</style>`];
  for (const t of ticks) {
    const y = Math.round(sy(t)) + 0.5;
    out.push(`<line class="${t === 0 ? 'b' : 'g'}" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke-width="1"/>`, `<text class="t" x="${L - 8}" y="${y + 4}" text-anchor="end">${fmt(t)}</text>`);
  }
  const every = Math.ceil(n / Math.max(1, Math.floor((W - L - R) / 64))); // thin the category labels so they never collide
  rows.forEach((r, i) => { if (i % every === 0) out.push(`<text class="t" x="${r1(L + band * (i + 0.5))}" y="${H - B + 18}" text-anchor="middle">${esc(chartLabel(r[x], band * every))}</text>`); });
  if (ys.length > 1) {
    let lx = L;
    ys.forEach((y, i) => { out.push(`<rect class="f${i}" x="${lx}" y="8" width="10" height="10" rx="2"/>`, `<text class="k" x="${lx + 15}" y="17">${esc(y)}</text>`); lx += 30 + y.length * 6.5; });
  }
  let label: { x: number; y: number; v: number } | undefined;
  if (kind === 'bar-chart') {
    const k = ys.length, bw = Math.max(2, Math.min(24, (band * 0.72 - (k - 1) * 2) / k));
    ys.forEach((y, s) => rows.forEach((r, i) => {
      const v = Number(r[y]); if (!Number.isFinite(v) || v === 0) return;
      const x0 = L + band * (i + 0.5) - (k * bw + (k - 1) * 2) / 2 + s * (bw + 2), top = sy(v), base = sy(0);
      const rr = Math.min(4, bw / 2, Math.abs(base - top));
      out.push(`<path class="f${s}" d="${v > 0
        ? `M${r1(x0)},${r1(base)}V${r1(top + rr)}Q${r1(x0)},${r1(top)} ${r1(x0 + rr)},${r1(top)}H${r1(x0 + bw - rr)}Q${r1(x0 + bw)},${r1(top)} ${r1(x0 + bw)},${r1(top + rr)}V${r1(base)}Z`
        : `M${r1(x0)},${r1(base)}V${r1(top - rr)}Q${r1(x0)},${r1(top)} ${r1(x0 + rr)},${r1(top)}H${r1(x0 + bw - rr)}Q${r1(x0 + bw)},${r1(top)} ${r1(x0 + bw)},${r1(top - rr)}V${r1(base)}Z`}"/>`);
      if (k === 1 && (!label || v > label.v)) label = { x: x0 + bw / 2, y: top - 6, v };
    }));
  } else {
    ys.forEach((y, s) => {
      const pts = rows.map((r, i) => [L + band * (i + 0.5), Number(r[y])] as const).filter(([, v]) => Number.isFinite(v));
      if (!pts.length) return;
      out.push(`<polyline class="l${s}" fill="none" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${pts.map(([px, v]) => `${r1(px)},${r1(sy(v))}`).join(' ')}"/>`);
      const [lx, lv] = pts[pts.length - 1];
      out.push(`<circle class="f${s} ring" cx="${r1(lx)}" cy="${r1(sy(lv))}" r="4" stroke-width="2"/>`);
      if (ys.length === 1) label = { x: lx, y: sy(lv) - 10, v: lv };
    });
  }
  if (label) out.push(`<text class="k" x="${r1(Math.min(W - R - 4, Math.max(L + 4, label.x)))}" y="${r1(Math.max(12, label.y))}" text-anchor="middle">${label.v.toLocaleString(locale, { maximumFractionDigits: 2 })}</text>`);
  return `data:image/svg+xml;base64,${Buffer.from(out.join('') + '</svg>').toString('base64')}`;
}
const chartLabel = (v: unknown, bw: number) => ellipsis(asText(v ?? ''), Math.max(6, Math.floor(bw / 7)));
