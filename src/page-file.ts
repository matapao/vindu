// Disk-backed responses keep their file open until the client finishes or disconnects.
// Only HTML that needs the page bridge is assembled in memory.
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';
import type { Served } from './page-serve.js';

export type PageFile = { file: string; headers: Record<string, string>; inject?: (html: string) => string };
const HTML_LIMIT = 8 * 1024 * 1024;

function byteRange(header: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || !size || (!match[1] && !match[2])) return;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  return start <= end && start < size ? { start, end } : undefined;
}

async function withFile<T>(
  item: PageFile,
  use: (handle: fs.promises.FileHandle, size: number, headers: Record<string, string>) => Promise<T>,
) {
  const handle = await fs.promises.open(item.file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const st = await handle.stat({ bigint: true });
    if (!st.isFile()) throw new Error('Not a regular file');
    const revision = [st.ino, st.size, st.mtimeNs, st.ctimeNs].join('-');
    return await use(handle, Number(st.size), { ...item.headers, 'Server-Timing': `vindu;desc="${revision}"` });
  } finally {
    await handle.close();
  }
}

async function materialize(
  item: PageFile,
  handle: fs.promises.FileHandle,
  size: number,
  headers: Record<string, string>,
): Promise<Served> {
  if (!item.inject) return { status: 200, headers, body: await handle.readFile() };
  if (size > HTML_LIMIT)
    return {
      status: 413,
      headers: { ...headers, 'Content-Type': 'text/plain' },
      body: 'HTML pages may be up to 8 MiB.',
    };
  // Read only the size we checked, even when the producer is still writing to this file.
  const buffer = Buffer.allocUnsafe(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await handle.read(buffer, offset, size - offset, offset);
    if (!bytesRead) break;
    offset += bytesRead;
  }
  return { status: 200, headers, body: item.inject(buffer.toString('utf8', 0, offset)) };
}

/** The public in-process serve() API returns a complete body. */
export const readPageFile = (item: PageFile) =>
  withFile(item, (handle, size, headers) => materialize(item, handle, size, headers));

export async function sendPageFile(item: PageFile, req: IncomingMessage, res: ServerResponse) {
  await withFile(item, async (handle, size, headers) => {
    if (item.inject) {
      if (req.method === 'HEAD') {
        res.writeHead(size > HTML_LIMIT ? 413 : 200, headers).end();
        return;
      }
      const page = await materialize(item, handle, size, headers);
      res.writeHead(page.status, page.headers).end(page.body);
      return;
    }
    headers['Accept-Ranges'] = 'bytes';
    const range = req.headers.range ? byteRange(req.headers.range, size) : undefined;
    if (req.headers.range && !range) {
      res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` }).end();
      return;
    }
    if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
    headers['Content-Length'] = String(range ? range.end - range.start + 1 : size);
    res.writeHead(range ? 206 : 200, headers);
    if (!size || req.method === 'HEAD') {
      res.end();
      return;
    }
    await pipeline(handle.createReadStream({ start: range?.start ?? 0, end: range?.end ?? size - 1 }), res);
  });
}
