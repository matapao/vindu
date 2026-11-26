// The start of a text file, as a document panel reads it: at most a given number of bytes, read through one descriptor
// so that the size is the size of what is read, and cut after the last whole line that fits (or the last whole
// character, in a line longer than that), as UTF-8 without its byte order mark.
import fs from 'node:fs';

/** What was read of a text file: its text, the bytes of it shown, and the size of the whole file. */
export type TextStart = { text: string; bytes: number; size: number };

/** The start of a text file, at most most bytes of it; null when it is not text (a NUL in its first 8,000 bytes). */
export function readTextStart(file: string, most: number): TextStart | null {
  const fd = fs.openSync(file, 'r');
  let buf: Buffer, size: number;
  try {
    size = fs.fstatSync(fd).size;
    buf = Buffer.alloc(Math.min(size, most) + 1); // one byte more than shown: a file that grew since is cut too
    buf = buf.subarray(0, fs.readSync(fd, buf, 0, buf.length, 0));
  } finally {
    fs.closeSync(fd);
  }
  if (buf.subarray(0, 8000).includes(0)) return null;
  let end = buf.length;
  if (end > most) {
    const line = buf.lastIndexOf(0x0a, most - 1);
    end = line >= 0 ? line + 1 : most;
    while (end > 0 && (buf[end] & 0xc0) === 0x80) end--; // never inside a character
  }
  return { text: new TextDecoder('utf-8').decode(buf.subarray(0, end)), bytes: end, size: Math.max(size, buf.length) };
}
