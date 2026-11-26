// sparkline 1.0.0: a host's own library for the pages a model writes. MIT licence; a synthetic example.
// import { sparkline } from 'sparkline'; element.innerHTML = sparkline([3, 5, 4, 8], { width: 320, height: 64 });
// It returns markup for innerHTML, so every option is written into it as a number or a colour, and nothing else.
const size = (n, fallback) => (Number.isFinite(Number(n)) && Number(n) > 0 ? Math.min(Number(n), 4096) : fallback);
const paint = (c) =>
  typeof c === 'string' && /^(#[0-9a-f]{3,8}|[a-z]+|(rgb|hsl)a?\([\d\s.,%/]+\))$/i.test(c.trim())
    ? c.trim()
    : 'currentColor';

export function sparkline(values, { width = 320, height = 64, stroke = 'currentColor' } = {}) {
  const v = values.map(Number).filter(Number.isFinite);
  if (v.length < 2) return '';
  const w = size(width, 320),
    h = size(height, 64),
    colour = paint(stroke);
  const lo = Math.min(...v),
    hi = Math.max(...v),
    span = hi - lo || 1,
    pad = 4;
  const x = (i) => pad + (i * (w - 2 * pad)) / (v.length - 1);
  const y = (n) => pad + (1 - (n - lo) / span) * (h - 2 * pad);
  const pts = v.map((n, i) => `${x(i).toFixed(1)},${y(n).toFixed(1)}`).join(' ');
  const [lx, ly] = [x(v.length - 1), y(v[v.length - 1])];
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<polyline fill="none" stroke="${colour}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${pts}"/>` +
    `<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="4" fill="${colour}"/></svg>`
  );
}
