// What the person's window says of a page it shows, as the page runs there (its boot script posts it: pages.ts), kept to
// the page itself: whether it loaded, its size and overflow, its errors by kind and the place in its own code they came
// from, what failed to load or was blocked by kind, its canvases and 3D scene, its pinned libraries. Never text, values,
// messages, or the addresses of what it was given: the person's window may hold what they typed, and what is shown
// there for them alone. Whatever a page posts, only this shape is kept, each part checked; anything else is dropped.
import { asText } from './format.js';

export type WindowReport = {
  by: "the person's window";
  loaded: boolean;
  ms?: number;
  visible?: boolean;
  width: number;
  height: number;
  overflow: { x: number; y: number };
  elements: number;
  errors: number;
  places?: { kind: string; at?: string }[];
  warnings: number;
  failed?: { tag: string; in: string; path?: string; ext?: string }[];
  blocked?: { directive: string; what: string }[];
  canvases?: { context: string; width: number; height: number; drawn?: boolean | null; painted?: number }[];
  three?: { frames: number; draw_calls: number; triangles: number; objects: Record<string, number> }[];
  charts: number;
  libraries?: string[];
  dialogs: number;
};

const int = (x: unknown, max = 1e9) => {
  const n = Number(x);
  return Number.isFinite(n) ? Math.max(0, Math.min(max, Math.round(n))) : 0;
};
const obj = (x: unknown): Record<string, unknown> =>
  x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {};
const list = <T>(x: unknown, n: number, f: (v: Record<string, unknown>) => T | undefined): T[] =>
  Array.isArray(x)
    ? x
        .slice(0, n)
        .map((v) => f(obj(v)))
        .filter((v): v is T => v !== undefined)
    : [];
/** A name in code: an error's class, a three.js object's type. */
const NAME = /^[A-Za-z_$][\w$]{0,40}$/;
const KIND = /^(?:[A-Za-z_$][\w$]{0,40}|console\.error|unhandled rejection(?:: [A-Za-z_$][\w$]{0,40})?)$/;
/** A place in the page's own code: its file's name and a line. */
const AT = /^[\w.-]{1,80}:\d{1,7}$/;
/** A pinned library's file, the one address told whole: the page imports it by a name the model wrote. */
const LIB = /^\/lib\/[\w@.\-/]{1,150}$/;
const LIBRARY = /^[\w@.\-/]{1,40} \d[\w.\-+]{0,20}$/;
const FOLDERS = ['lib', 'work', 'view', 'data', 'media', 'page', 'elsewhere'];
const WHAT = ['inline', 'eval', 'its own', 'elsewhere', 'data', 'blob', 'other'];
const CONTEXTS = ['2d', 'webgl', 'webgl2', 'bitmaprenderer', 'webgpu', 'none'];

/** A window's report as it may be kept and told to the model, or nothing when it is not one. */
export function windowReport(x: unknown): WindowReport | undefined {
  const r = obj(x);
  if (!Object.keys(r).length) return undefined;
  const o = obj(r.overflow);
  const places = list(r.places, 10, (q) => {
    const kind = asText(q.kind ?? '');
    if (!KIND.test(kind)) return undefined;
    return typeof q.at === 'string' && AT.test(q.at) ? { kind, at: q.at } : { kind };
  });
  const failed = list(r.failed, 10, (q) => {
    const tag = asText(q.tag ?? ''),
      folder = asText(q.in ?? '');
    if (!/^[a-z]{1,12}$/.test(tag) || !FOLDERS.includes(folder)) return undefined;
    return {
      tag,
      in: folder,
      ...(folder === 'lib' && typeof q.path === 'string' && LIB.test(q.path) ? { path: q.path } : {}),
      ...(typeof q.ext === 'string' && /^[a-z0-9]{1,8}$/.test(q.ext) ? { ext: q.ext } : {}),
    };
  });
  const blocked = list(r.blocked, 10, (q) => {
    const directive = asText(q.directive ?? ''),
      what = asText(q.what ?? '');
    return /^[a-z-]{1,30}$/.test(directive) && WHAT.includes(what) ? { directive, what } : undefined;
  });
  const canvases = list(r.canvases, 8, (q) => {
    const context = asText(q.context ?? '');
    if (!CONTEXTS.includes(context)) return undefined;
    return {
      context,
      width: int(q.width, 1e5),
      height: int(q.height, 1e5),
      ...(typeof q.drawn === 'boolean' || q.drawn === null ? { drawn: q.drawn } : {}),
      ...(q.painted !== undefined ? { painted: int(q.painted, 100) } : {}),
    };
  });
  const three = list(r.three, 4, (q) => {
    const objects: Record<string, number> = {};
    for (const [k, v] of Object.entries(obj(q.objects)).slice(0, 16)) if (NAME.test(k)) objects[k] = int(v, 1e7);
    return { frames: int(q.frames), draw_calls: int(q.draw_calls), triangles: int(q.triangles), objects };
  });
  const libraries = Array.isArray(r.libraries)
    ? r.libraries.slice(0, 8).filter((l): l is string => typeof l === 'string' && LIBRARY.test(l))
    : [];
  return {
    by: "the person's window",
    loaded: r.loaded === true,
    ...(r.ms !== undefined ? { ms: int(r.ms, 6e5) } : {}),
    ...(typeof r.visible === 'boolean' ? { visible: r.visible } : {}),
    width: int(r.width, 1e5),
    height: int(r.height, 1e5),
    overflow: { x: int(o.x, 1e6), y: int(o.y, 1e7) },
    elements: int(r.elements, 1e7),
    errors: int(r.errors),
    ...(places.length ? { places } : {}),
    warnings: int(r.warnings),
    ...(failed.length ? { failed } : {}),
    ...(blocked.length ? { blocked } : {}),
    ...(canvases.length ? { canvases } : {}),
    ...(three.length ? { three } : {}),
    charts: int(r.charts, 1e5),
    ...(libraries.length ? { libraries } : {}),
    dialogs: int(r.dialogs, 1e5),
  };
}
