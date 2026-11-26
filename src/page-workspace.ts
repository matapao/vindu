import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

/** Names that hold secrets by convention, never served, read or watched, like dot names (.env, .ssh, .aws): private
 *  keys and key stores (id_rsa, id_ed25519, *.pem, *.key, *.p12, *.pfx, *.p8, *.ppk, *.jks, *.keystore), password
 *  databases (*.kdbx), _netrc, and data files named for credentials or secrets (credentials, credentials.json,
 *  client_secret.json, secrets.yaml, aws-credentials.ini). Source code is not data: credentials.ts and secret-santa.html
 *  are served. A small list, not a scan of what a file holds. */
const KEY_FILE = /^(?:id_(?:rsa|dsa|ecdsa|ed25519)(?:_sk)?|_netrc)$|\.(?:pem|key|p12|pfx|p8|ppk|jks|keystore|kdbx)$/i;
const NAMED_SECRET = /(?:^|[^a-z])(?:credentials?|secrets?)(?:[^a-z]|$)/i;
const DATA_EXTENSION = /^(?:|json|ya?ml|toml|ini|txt|env|conf|cfg|xml|properties)$/i;
export function secretName(name: string): boolean {
  if (KEY_FILE.test(name)) return true;
  const dot = name.lastIndexOf('.'),
    stem = dot > 0 ? name.slice(0, dot) : name,
    extension = dot > 0 ? name.slice(dot + 1) : '';
  return NAMED_SECRET.test(stem) && DATA_EXTENSION.test(extension);
}
/** A name nothing here reads: a dot name, or one that holds secrets by convention. */
const hidden = (name: string) => name.startsWith('.') || secretName(name);

/** A real path t, kept when it is a file under the real root and no part of it under the root is hidden. */
const within = (root: string, t: string, isFile: boolean) =>
  t.startsWith(root + path.sep) && isFile && !path.relative(root, t).split(path.sep).some(hidden) ? t : null;

/** The real path of a file under base, or null: nothing outside the root, through .. or a link, and no dotfile, dot
 *  folder (.env, .git) or file of secrets (id_rsa, server.key), whatever name a link gives it. */
export function inside(base: string, rel: string): string | null {
  const real = fs.realpathSync(base);
  const target = path.resolve(real, rel);
  if (!fs.existsSync(target)) return null;
  let t = fs.realpathSync(target);
  if (fs.statSync(t).isDirectory()) {
    t = path.join(t, 'index.html');
    if (!fs.existsSync(t)) return null;
    t = fs.realpathSync(t);
  }
  return within(real, t, fs.statSync(t).isFile());
}
/** inside, without blocking: the page host shares its event loop with the MCP endpoint. root is base's real path,
 *  for a folder found once because it never moves; without it, base is found again. */
export async function insideAsync(base: string, rel: string, root?: string): Promise<string | null> {
  try {
    const real = root ?? (await fsp.realpath(base));
    let t = await fsp.realpath(path.resolve(real, rel));
    let st = await fsp.stat(t);
    if (st.isDirectory()) {
      t = await fsp.realpath(path.join(t, 'index.html'));
      st = await fsp.stat(t);
    }
    return within(real, t, st.isFile());
  } catch {
    return null;
  } // not there, or not readable: not served
}
/** A path under a folder as an address path: each part encoded. */
export const href = (rel: string) => rel.split('/').map(encodeURIComponent).join('/');
/** The query a static page is asked for with, on the process's own origin: the page host serves it as it is written,
 *  with nothing put in it, under a policy that runs none of it (pages.ts). */
export const STATIC_QUERY = 'static=1';
/** Whether an address's query asks for a static page, wherever in it STATIC_QUERY is. */
export const asksStatic = (query: URLSearchParams) => query.getAll('static').includes('1');
/** A page in the working folder: an HTML file, or a folder with an index.html. */
export const page = (work: string, rel: string) => {
  const f = inside(work, rel.replace(/^\/+/, '') || 'index.html');
  return f && /\.html?$/i.test(f) ? f : null;
};
export function pagesIn(root: string, dir = root, out: string[] = []): string[] {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (out.length >= 40 || hidden(d.name) || d.name === 'node_modules') continue;
    const p = path.join(dir, d.name);
    if (d.isDirectory()) pagesIn(root, p, out);
    else if (/\.html?$/i.test(d.name)) out.push(path.relative(root, p).split(path.sep).join('/'));
  }
  return out;
}

/** Changes in a folder, debounced, without node_modules, dot names or files of secrets (a project can hold many thousands
 *  of those), and never through a link: a link to / or to a home folder would watch what is outside the folder. */
export function watchFolder(root: string, onChange: (paths: string[]) => void, debounceMs = 100): () => void {
  const watchers = new Map<string, fs.FSWatcher>();
  let pending = new Set<string>();
  let timer: NodeJS.Timeout | undefined;
  const skip = (name: string) => name === 'node_modules' || hidden(name);
  const flush = () => {
    const paths = [...pending];
    pending = new Set();
    if (paths.length) onChange(paths);
  };
  const add = (dir: string) => {
    if (watchers.size >= 2000 || watchers.has(dir)) return;
    try {
      const w = fs.watch(dir, (_event, name) => {
        if (!name || skip(String(name))) return;
        const full = path.join(dir, String(name));
        pending.add(path.relative(root, full).split(path.sep).join('/'));
        clearTimeout(timer);
        timer = setTimeout(flush, debounceMs);
        fs.lstat(full, (err, st) => {
          if (!err && st.isDirectory()) add(full);
        }); // a link is not followed
      });
      w.on('error', () => {
        w.close();
        watchers.delete(dir);
      });
      watchers.set(dir, w);
      for (const d of fs.readdirSync(dir, { withFileTypes: true }))
        if (d.isDirectory() && !skip(d.name)) add(path.join(dir, d.name));
    } catch {
      /* the folder went away */
    }
  };
  add(root);
  return () => {
    clearTimeout(timer);
    for (const w of watchers.values()) w.close();
    watchers.clear();
  };
}
