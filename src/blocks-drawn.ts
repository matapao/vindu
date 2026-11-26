// Blocks the system draws itself from their rows (blocks.ts): places on a map without tiles, people and organisations,
// and a diagram of nodes and links laid out in layers.
import type { Row } from './results.js';
import { block, needOne } from './block-kit.js';
import { num } from './compute.js';
import { rowFields } from './cards.js';

// ── map: places as points, lines or areas, drawn without map tiles (nothing is fetched from the network for it) ─────
type Geo = { type: string; coordinates: unknown };
const lonlats = (g: Geo): number[][] => {
  const out: number[][] = [];
  const walk = (c: unknown) => {
    if (Array.isArray(c) && typeof c[0] === 'number') out.push(c as number[]);
    else if (Array.isArray(c)) c.forEach(walk);
  };
  walk(g.coordinates);
  return out;
};
/** What a GeoJSON geometry draws as: an area, a line, or a point. */
const shapeKind = (type: string) => {
  if (/Polygon/.test(type)) return 'area';
  return /LineString/.test(type) ? 'line' : 'point';
};
const merc = (lon: number, lat: number) => [
  lon,
  (Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * Math.PI) / 360)) * 180) / Math.PI,
];
export const MAP_BLOCK = block({
  name: 'map',
  component: 'VMap',
  about:
    'places on a map: points (lat, lon) or shapes (GeoJSON geometry), with labels; drawn by the system without map tiles',
  roles: {
    lat: /^(lat|latitude)$/i,
    lon: /^(lon|lng|long|longitude)$/i,
    geometry: /^(geometry|geojson|shape|area|route|line)$/i,
    label: /^(label|name|title|address|place|stop)$/i,
    group: /^(group|category|kind|type|status|truck|vehicle)$/i,
  },
  check: (rows, _p, m) =>
    m.geometry || (m.lat && m.lon)
      ? null
      : `a map needs lat and lon, or a geometry (GeoJSON); fields here: ${rowFields(rows).slice(0, 15).join(', ')}; say which with map`,
  rows: (rows, _p, m) => {
    const geometry = (r: Row) =>
      m.geometry && r[m.geometry] && typeof r[m.geometry] === 'object' ? (r[m.geometry] as Geo) : null;
    const shapes = rows.map((r) => {
      const g = geometry(r);
      if (g) return lonlats(g);
      return num(r[m.lat]) !== null && num(r[m.lon]) !== null ? [[num(r[m.lon])!, num(r[m.lat])!]] : [];
    });
    const all = shapes.flat().map(([lon, lat]) => merc(lon, lat));
    if (!all.length) throw new Error('no place has numbers for lat and lon, or a geometry');
    const xs = all.map((a) => a[0]),
      ys = all.map((a) => a[1]);
    let [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const span = Math.max(x1 - x0, y1 - y0, 0.01);
    x0 -= span * 0.12;
    x1 += span * 0.3;
    y0 -= span * 0.08;
    y1 += span * 0.08; // room for labels, right of each point
    const W = 640,
      H = Math.round(Math.min(380, Math.max(220, (W * (y1 - y0)) / Math.max(x1 - x0, 1e-9))));
    const s = Math.min(W / (x1 - x0), H / (y1 - y0)),
      ox = (W - s * (x1 - x0)) / 2,
      oy = (H - s * (y1 - y0)) / 2;
    const at = (lon: number, lat: number) => {
      const [x, y] = merc(lon, lat);
      return [Math.round((ox + (x - x0) * s) * 10) / 10, Math.round((H - oy - (y - y0) * s) * 10) / 10];
    };
    return {
      rows: rows.map((r, i) => {
        const g = geometry(r),
          kind = g ? shapeKind(g.type) : 'point';
        return { ...r, __shape: { kind, points: shapes[i].map(([lon, lat]) => at(lon, lat)) } };
      }),
      props: { frame: { width: W, height: H, bounds: [x0, y0, x1, y1] } },
    };
  },
  props: () => ({ frame: { width: 640, height: 320 } }),
  derived: ['__shape'],
  words: (w) => ({ ...w.map }),
  account: (rows) => ({
    places: rows.length,
    drawn: 'positions computed by the system (Web Mercator, fitted to the places); no map tiles',
  }),
});

export const CONTACTS = block({
  name: 'contacts',
  component: 'VContacts',
  about: 'people and organizations as contact cards',
  roles: {
    name: /^(name|full_?name|display_?name|contact)$/i,
    role: /^(role|title|job_?title|position)$/i,
    org: /^(org|organi[sz]ation|company|employer|department)$/i,
    email: /^(e_?mail|mail)$/i,
    phone: /^(phone|mobile|tel|telephone)$/i,
    address: /^(address|street|location)$/i,
  },
  check: (rows, _p, m) => needOne(m, ['name', 'org'], 'a contact', rows),
  account: (rows) => ({ contacts: rows.length }),
});

// ── a diagram: nodes and links, laid out in layers by the system ─────────────────────────────────────────────────
/** Layers by the longest path from a root, ordered within a layer by their parents' places (a few sweeps). */
export function layered(nodes: string[], links: [string, string][]): Map<string, { layer: number; order: number }> {
  const parents = new Map(nodes.map((n) => [n, [] as string[]]));
  for (const [a, b] of links) if (a !== b) parents.get(b)?.push(a);
  const layer = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (n: string): number => {
    if (layer.has(n)) return layer.get(n)!;
    if (visiting.has(n)) return 0;
    visiting.add(n);
    const d = Math.max(-1, ...(parents.get(n) ?? []).map(depth)) + 1;
    visiting.delete(n);
    layer.set(n, d);
    return d;
  };
  nodes.forEach(depth);
  const byLayer: string[][] = [];
  for (const n of nodes) (byLayer[layer.get(n)!] ??= []).push(n);
  const pos = new Map<string, number>();
  byLayer.forEach((l) => l.forEach((n, i) => pos.set(n, i)));
  for (let sweep = 0; sweep < 4; sweep++)
    for (const l of byLayer.slice(1)) {
      const bary = (n: string) => {
        const ps = parents.get(n)!.filter((x) => pos.has(x));
        return ps.length ? ps.reduce((a, x) => a + pos.get(x)!, 0) / ps.length : pos.get(n)!;
      };
      l.sort((a, b) => bary(a) - bary(b)).forEach((n, i) => pos.set(n, i));
    }
  return new Map(nodes.map((n) => [n, { layer: layer.get(n)!, order: pos.get(n)! }]));
}
export const DIAGRAM = block({
  name: 'diagram',
  component: 'VDiagram',
  about:
    'a diagram: links between things (from, to, label), laid out in layers by the system: a flow, a hierarchy, a network',
  roles: {
    from: /^(from|source|parent|a|sender)$/i,
    to: /^(to|target|child|b|receiver)$/i,
    label: /^(label|relation|kind|amount|via)$/i,
  },
  check: (rows, _p, m) =>
    m.from && m.to
      ? null
      : `a diagram needs from and to (one link per row); fields here: ${rowFields(rows).slice(0, 15).join(', ')}`,
  rows: (rows, _p, m) => {
    const nodes = [...new Set(rows.flatMap((r) => [String(r[m.from]), String(r[m.to])]))];
    const place = layered(
      nodes,
      rows.map((r) => [String(r[m.from]), String(r[m.to])]),
    );
    return { rows, props: { nodes: nodes.map((n) => ({ id: n, ...place.get(n)! })) } };
  },
  props: () => ({ nodes: [] }),
  account: (rows, _p, _m, props) => ({
    links: rows.length,
    nodes: (props.nodes as unknown[]).length,
    laid_out: 'by the system, in layers from the first in each chain',
  }),
});
