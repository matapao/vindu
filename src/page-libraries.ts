import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
/** Where a package is: its real folder, so a package beside it in the layout of any package manager is found from there. */
function pkgDir(name: string, from = require): string | undefined {
  for (const dir of from.resolve.paths(name) ?? []) { const p = path.join(dir, name); if (fs.existsSync(path.join(p, 'package.json'))) return fs.realpathSync(p); }
  return undefined;
}

/** Pinned libraries a page imports by name; the import map resolves them here, and nothing comes from the web. Monaco
 *  (the VS Code editor) loads with its own script loader instead: <script src="/lib/monaco-editor/vs/loader.js">.
 *  pdf.js, for pdf panels, is imported by its path, and of its package only the files a viewer needs are served
 *  (only): its module build and worker, the character maps and standard fonts text needs, and its image decoders.
 *  Each is found when first asked for, not when Vindu loads: one that is not installed is refused alone (its /lib
 *  paths are not found, its name is not in the import map), and everything else works. @kurkle/color is Chart.js's
 *  own, found beside it. */
const PINNED = [
  { name: 'three', license: 'MIT', imports: ['three', 'three/addons/…'], dirs: [['three/addons', 'examples/jsm'], ['three', 'build']], map: { three: '/lib/_vindu/three.js', 'three/addons/': '/lib/three/addons/' } },
  { name: 'echarts', license: 'Apache-2.0', imports: ['echarts'], dirs: [['echarts', 'dist']], map: { echarts: '/lib/_vindu/echarts.js' } },
  { name: 'chart.js', license: 'MIT', imports: ['chart.js', 'chart.js/auto', 'chart.js/helpers'], dirs: [['chart.js', 'dist']],
    map: { 'chart.js': '/lib/_vindu/chart.js', 'chart.js/auto': '/lib/_vindu/chart.js', 'chart.js/helpers': '/lib/chart.js/helpers.js', '@kurkle/color': '/lib/@kurkle/color/color.esm.js' } },
  { name: 'monaco-editor', license: 'MIT', imports: ['/lib/monaco-editor/vs/loader.js, then require([\'vs/editor/editor.main\'])'], dirs: [['monaco-editor', 'min']], map: {} },
  { name: 'pdfjs-dist', license: 'Apache-2.0', imports: ['/lib/pdfjs-dist/build/pdf.min.mjs, with its worker /lib/pdfjs-dist/build/pdf.worker.min.mjs'], dirs: [['pdfjs-dist', '.']], map: {},
    only: /^(?:build\/pdf(?:\.worker)?\.min\.mjs|cmaps\/[\w-]+\.bcmap|standard_fonts\/[\w-]+\.(?:pfb|ttf)|wasm\/(?:openjpeg|jbig2|qcms_bg)\.wasm|iccs\/[\w-]+\.icc)$/ },
] as const satisfies readonly { name: string; license: string; imports: readonly string[]; dirs: readonly (readonly [string, string])[]; map: Record<string, string>; only?: RegExp }[];
type PinnedName = (typeof PINNED)[number]['name'];

const found = new Map<string, { dir: string; version: string } | null>();
/** A pinned library's folder and version, found once; null when it is not installed. */
function installed(name: PinnedName | '@kurkle/color'): { dir: string; version: string } | null {
  if (!found.has(name)) {
    let at: { dir: string; version: string } | null = null;
    try {
      const chartjs = name === '@kurkle/color' ? installed('chart.js') : undefined;
      const dir = name === '@kurkle/color' ? chartjs && pkgDir(name, createRequire(path.join(chartjs.dir, 'package.json'))) : pkgDir(name);
      if (dir) at = { dir, version: String((JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as { version: unknown }).version) };
    } catch { at = null; } // unreadable: as if not installed
    found.set(name, at);
  }
  return found.get(name)!;
}

/** The pinned libraries, each with the version installed here ("not installed" for one that is not). */
export const LIBRARIES = PINNED.map(({ name, license, imports }) => ({
  name, license, imports: [...imports],
  get version(): string { return installed(name)?.version ?? 'not installed'; },
}));
const real = (dir: string) => { try { return fs.realpathSync(dir); } catch { return undefined; } };
/** Each pinned library's prefix under /lib/, its folder's real path once found (found once: it never moves), and which
 *  of the files under it are served, where not all of them are. */
const LIB_DIRS: { prefix: string; dir: () => string | undefined; only?: RegExp }[] = [...PINNED.flatMap((l): readonly (readonly [string, string])[] => l.dirs), ['@kurkle/color', 'dist'] as const].map(([prefix, sub]) => {
  const lib = PINNED.find(l => l.dirs.some(([p]) => p === prefix)), name = lib?.name ?? '@kurkle/color';
  let dir: string | null | undefined;
  return { prefix, dir: () => { if (dir === undefined) { const at = installed(name); dir = (at && real(path.join(at.dir, sub))) ?? null; } return dir ?? undefined; },
    ...(lib && 'only' in lib ? { only: lib.only } : {}) };
});
/** Every pinned name a page imports, installed or not (what inject maps by default). */
export const IMPORT_MAP: Record<string, string> = Object.assign({}, ...PINNED.map(l => l.map));

/** A library a host adds, served here like the built-in ones: from `dir` at /lib/<name>/…, and mapped by name in every
 *  page's import map. `imports` maps a bare specifier to a file in dir ("d3": "d3.js"), or a prefix ending in "/" to a folder ("d3/": ""). */
export type Library = { name: string; version: string; license: string; dir: string; imports: Record<string, string> };

export function libraryTable(extra: Library[]) {
  const taken = new Set(['_vindu', ...LIB_DIRS.map(({ prefix }) => prefix.split('/')[0])]); const specs = new Set(Object.keys(IMPORT_MAP));
  for (const l of extra) {
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(l.name) || taken.has(l.name)) throw new Error(`library name "${l.name}" is not a plain name, or is taken`);
    for (const spec of Object.keys(l.imports)) { if (specs.has(spec)) throw new Error(`"${spec}" is already pinned`); specs.add(spec); }
    taken.add(l.name);
  }
  // a host's folder is found once if it is there at the start; if not, again on each request (insideAsync)
  const dirs: { prefix: string; dir: () => string | undefined; root: () => string | undefined; only?: RegExp }[] = [...LIB_DIRS.map(d => ({ ...d, root: d.dir })),
    ...extra.map(l => { const root = real(l.dir); return { prefix: l.name, dir: () => l.dir, root: () => root }; })].sort((a, b) => b.prefix.length - a.prefix.length);
  let pinned: string[] | undefined, importMap: Record<string, string> | undefined;
  return {
    /** The library whose prefix under /lib/ starts rel (the longest), its folder, and that folder's real path when
     *  known. A pinned library that is not installed has none, and nor has a file of one that serves only some. */
    dirOf(rel: string): [string, string, string | undefined] | undefined {
      const hit = dirs.find(({ prefix }) => rel === prefix || rel.startsWith(`${prefix}/`)), dir = hit?.dir();
      if (hit?.only && !hit.only.test(rel.slice(hit.prefix.length + 1))) return undefined;
      return hit && dir ? [hit.prefix, dir, hit.root()] : undefined;
    },
    /** What each page's import map holds: the pinned libraries installed here, and the host's. */
    get importMap(): Record<string, string> {
      return importMap ??= { ...Object.assign({}, ...PINNED.filter(l => installed(l.name)).map(l => l.map)) as Record<string, string>,
        ...Object.fromEntries(extra.flatMap(l => Object.entries(l.imports).map(([spec, f]) => [spec, `/lib/${l.name}/${f}`]))) };
    },
    /** What a page can import by name, for a report that needs to say so. */
    get pinned(): string[] {
      return pinned ??= [...LIBRARIES.filter(l => installed(l.name)).map(l => `${l.imports.join(', ')}: ${l.name} ${l.version}`), ...extra.map(l => `${Object.keys(l.imports).map(k => k.endsWith('/') ? `${k}…` : k).join(', ')}: ${l.name} ${l.version}`)];
    },
  };
}
export type Libraries = ReturnType<typeof libraryTable>;

// Thin wrappers that note what each library drew, so a page check can say what it plotted. The Chart.js wrapper also
// registers every chart type and exports Chart as default, so "chart.js" works as "chart.js/auto" does. The three.js
// one keeps every scene a renderer draws (a post-processing pass draws a quad of its own, after the scene), and adds up
// the draw calls and triangles of all its renders in one frame of the page.
const lib = (name: PinnedName) => `${name} ${installed(name)?.version}`;
const WRAPPERS: Record<string, { of: PinnedName; source: () => string }> = {
  'three.js': { of: 'three', source: () => `import * as T from '/lib/three/three.module.js';
export * from '/lib/three/three.module.js';
window.__task?.libraries.push('${lib('three')}');
export class WebGLRenderer extends T.WebGLRenderer {
  constructor(...a) {
    super(...a); const render = this.render.bind(this), info = this.info;
    const v = this.__vindu = { scenes: new Map(), frames: 0, frame: null, last: null };
    let tick = 0; const step = () => { if (v.disposed) return; tick++; requestAnimationFrame(step); }; requestAnimationFrame(step);
    this.render = (scene, camera) => {
      if (v.frame?.tick !== tick) { if (v.frame) v.last = v.frame; v.frame = { tick, renders: 0, calls: 0, triangles: 0 }; v.frames++; }
      const r = render(scene, camera), f = v.frame; f.renders++;
      if (info.autoReset) { f.calls += info.render.calls; f.triangles += info.render.triangles; } else { f.calls = info.render.calls; f.triangles = info.render.triangles; }
      const s = v.scenes.get(scene); if (s) { s.camera = camera; s.renders++; } else if (v.scenes.size < 8) v.scenes.set(scene, { camera, renders: 1 });
      return r;
    };
    const t = window.__task; if (t) { t.counts.three++; if (t.three.length < 200) t.three.push(this); }
  }
  dispose() { this.__vindu.disposed = true; super.dispose(); } // its frame count stops with it
}
` },
  'echarts.js': { of: 'echarts', source: () => `import * as E from '/lib/echarts/echarts.esm.min.mjs';
export * from '/lib/echarts/echarts.esm.min.mjs';
window.__task?.libraries.push('${lib('echarts')}');
export function init(...a) { const chart = E.init(...a); const t = window.__task; if (t) { t.counts.charts++; if (t.charts.length < 200) t.charts.push({ chart }); } return chart; }
` },
  'chart.js': { of: 'chart.js', source: () => `import { Chart, registerables } from '/lib/chart.js/chart.js';
export * from '/lib/chart.js/chart.js';
Chart.register(...registerables);
if (window.__task) { window.__task.chartjs = Chart; window.__task.libraries.push('${lib('chart.js')}'); }
export default Chart;
` },
};
/** The wrapper /lib/_vindu/<file> serves, or undefined: no such file, or its library is not installed here. */
export const wrapperFor = (file: string): string | undefined => {
  const w = Object.hasOwn(WRAPPERS, file) ? WRAPPERS[file] : undefined;
  return w && installed(w.of) ? w.source() : undefined;
};
