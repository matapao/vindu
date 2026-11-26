// How many pages a PDF has, where the file says so where the system can read it: the count of its page tree's root, in
// its first megabyte, written plainly (not in a compressed object stream). Unknown otherwise: the viewer counts them.
import fs from 'node:fs';

/** The most of a PDF read to count its pages. */
const READ = 1_000_000;

/** A PDF's pages, as its page tree's root counts them: the largest /Count of a /Type /Pages object in its first
 *  megabyte; undefined when none is written there. */
export function pdfPages(file: string): number | undefined {
  let text: string;
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buffer = Buffer.alloc(Math.min(fs.fstatSync(fd).size, READ));
      fs.readSync(fd, buffer, 0, buffer.length, 0);
      text = buffer.toString('latin1');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return undefined;
  }
  let most: number | undefined;
  for (const pages of text.matchAll(/\/Type\s*\/Pages\b/g)) {
    // the dictionary it is in: from the last << before it to the first >> after it
    const start = text.lastIndexOf('<<', pages.index),
      end = text.indexOf('>>', pages.index);
    if (start < 0 || end < 0) continue;
    const count = /\/Count\s+(\d{1,6})\b/.exec(text.slice(start, end));
    if (count) most = Math.max(most ?? 0, Number(count[1]));
  }
  return most;
}
