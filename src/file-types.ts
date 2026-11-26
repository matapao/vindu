// The types of the files Vindu serves and shows, by their extension: one list for the page host (pages.ts) and for
// media panels (view-files.ts). Kept in a Map, so a name such as "constructor" is no extension.
export const FILE_TYPES: ReadonlyMap<string, string> = new Map(
  Object.entries({
    html: 'text/html; charset=utf-8',
    htm: 'text/html; charset=utf-8',
    js: 'text/javascript',
    mjs: 'text/javascript',
    css: 'text/css',
    json: 'application/json',
    map: 'application/json',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    ico: 'image/x-icon',
    wasm: 'application/wasm',
    mp3: 'audio/mpeg',
    ogg: 'audio/ogg',
    wav: 'audio/wav',
    mp4: 'video/mp4',
    webm: 'video/webm',
    glb: 'model/gltf-binary',
    gltf: 'model/gltf+json',
    bin: 'application/octet-stream',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    txt: 'text/plain; charset=utf-8',
    csv: 'text/csv; charset=utf-8',
    tsv: 'text/tab-separated-values; charset=utf-8',
    md: 'text/markdown; charset=utf-8',
    pdf: 'application/pdf',
  }),
);

/** A file's extension, lowercase, as path.extname reads it (without its dot): "" for none, or a name that starts with one. */
export function extensionOf(name: string): string {
  const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1),
    dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}
/** A file's type by its extension, or undefined when Vindu does not know it. */
export const typeOfFile = (name: string): string | undefined => FILE_TYPES.get(extensionOf(name));
/** The extensions of the files a media panel shows or plays: images, video and audio. */
export const MEDIA_EXTENSIONS: readonly string[] = [...FILE_TYPES]
  .filter(([, type]) => /^(image|video|audio)\//.test(type))
  .map(([ext]) => ext);
