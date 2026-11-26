// What a page holds that a check and the window's report read (page-runtime.ts): the record the page and its libraries
// keep (window.__task), and how much of a canvas is painted and what a three.js scene holds. The measures stand alone:
// they are sent to the page as source.

/** What three.js's objects tell of themselves: a scene, a camera, anything in a scene. */
type ThreeObject = { type?: string; name?: string; traverse?: (visit: (o: ThreeObject) => void) => void };
/** A frame's draw calls, triangles and renders, as the wrapper in page-libraries.ts counts them. */
type FrameCounts = { calls: number; triangles: number; renders: number };
/** A three.js renderer, wrapped by page-libraries.ts: the scenes it drew (each with its camera), its frames, and
 *  three's own counts of the last render. */
type ThreeRenderer = {
  __vindu?: {
    scenes: Map<ThreeObject, { camera?: ThreeObject }>;
    frames: number;
    frame?: FrameCounts | null;
    last?: FrameCounts | null;
  };
  info: { render: { calls: number; triangles: number } };
};
/** An ECharts axis or series, as much as a check reads: its data. */
type EChartsData = { type?: string; name?: string; data?: unknown[] };
/** An ECharts chart, wrapped by page-libraries.ts: its option, as a check reads it. */
type EChart = { getOption(): { xAxis?: EChartsData[]; yAxis?: EChartsData[]; series?: EChartsData[] } };
/** Chart.js, as page-libraries.ts hands it over: its charts, each with its type, labels and datasets. */
type ChartJs = {
  instances: Record<
    string,
    { config: { type: string }; data: { labels?: unknown[]; datasets: { label?: string; data?: unknown[] }[] } }
  >;
};
/** A canvas's context, as the page took it: its kind ("2d", "webgl", …) and, for WebGL, its draw calls. */
export type CanvasUse = { type: string; ctx: RenderingContext; draws?: number };
/** What the page and its libraries record for the check and the window (window.__task): kept, never swapped. */
export type TaskRecord = {
  errors: string[];
  warnings: string[];
  failed: string[];
  blocked: string[];
  computed: number[];
  libraries: string[];
  fetched: string[];
  sent: string[];
  charts: { chart: EChart }[];
  three: ThreeRenderer[];
  chartjs: ChartJs | null;
  contexts: WeakMap<HTMLCanvasElement, CanvasUse>;
  counts: { errors: number; warnings: number; charts: number; three: number; sent: number };
};

/** How much of a 2D canvas is painted, from about 4,096 of its pixels spread evenly: the share in percent, whether any
 *  is, and how many colours (up to 64, at 4 bits a channel). Shared by the boot script and a page check; it stands
 *  alone: sent as source. */
function canvasPaint(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): { painted: number; any: boolean; colors: number } {
  const d = ctx.getImageData(0, 0, width, height).data,
    colors = new Set<number>(),
    stride = Math.max(1, Math.floor(d.length / 4 / 4096));
  let painted = 0,
    n = 0;
  for (let i = 0; i < d.length; i += 4 * stride) {
    n++;
    if (d[i + 3]) {
      painted++;
      if (colors.size < 64) colors.add(((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4));
    }
  }
  return { painted: Math.round((painted / Math.max(1, n)) * 100), any: painted > 0, colors: colors.size };
}
/** A three.js renderer's main scene, the one with the most in it (a post-processing pass draws a quad of its own after
 *  it): its objects by type (up to `types` of them, each name cut to 40), up to 8 names, its camera, and the renderer's
 *  frames and last whole frame (see the wrapper in page-libraries.ts). Shared, and sent as source, as canvasPaint. */
function sceneOf(renderer: ThreeRenderer, types: number) {
  const v: NonNullable<ThreeRenderer['__vindu']> = renderer.__vindu ?? { scenes: new Map(), frames: 0 };
  const scenes = [...v.scenes]
    .map(([scene, s]) => {
      let size = 0;
      scene?.traverse?.(() => {
        size++;
      });
      return { scene, camera: s.camera, size };
    })
    .sort((a, b) => b.size - a.size);
  const main = scenes[0],
    objects: Record<string, number> = Object.create(null),
    named: string[] = [];
  main?.scene?.traverse?.((o) => {
    if (o === main.scene) return;
    const type = String(o.type).slice(0, 40);
    if (type in objects || Object.keys(objects).length < types) objects[type] = (objects[type] ?? 0) + 1;
    if (o.name && named.length < 8) named.push(String(o.name).slice(0, 40));
  });
  return { frames: v.frames, frame: v.last ?? v.frame, objects, named, camera: main?.camera, scenes: scenes.length };
}
/** Both, as the source a page is sent: the boot script's fourth argument, and a check's. */
export const MEASURES = `{ paint: ${canvasPaint.toString()}, scene: ${sceneOf.toString()} }`;
export type Measures = { paint: typeof canvasPaint; scene: typeof sceneOf };
