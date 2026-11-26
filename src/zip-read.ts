// A zip archive (a workbook or a Word document) read by the system, its parts inflated with fflate. Its central
// directory is read first, and the archive is refused, saying why, before anything is inflated: when it holds more than
// ZIP_LIMITS.entries entries, when its entries say they inflate to more than ZIP_LIMITS.total bytes in all, when an entry
// larger than ZIP_LIMITS.ratioFrom says it inflates to more than ZIP_LIMITS.ratio times its compressed size, when a name
// leaves the archive (a .. segment, or an absolute path), or when two entries share a name. Only the parts asked for are
// read, and each is inflated within the size its entry declares: a part that comes out larger, or shorter, or does not
// match its checksum, is refused, since declared sizes can lie.
import fs from 'node:fs';
import { Inflate } from 'fflate';

/** What the system reads of an archive, at most: the file's own bytes, its entries, the bytes they inflate to in all,
 *  and how many times its compressed size an entry larger than ratioFrom bytes inflates to. */
export const ZIP_LIMITS = { file: 64_000_000, entries: 1000, total: 64_000_000, ratio: 100, ratioFrom: 65_536 };
type ZipLimits = typeof ZIP_LIMITS;

/** Where an archive's bytes are read from: how many there are, and any run of them by where it starts. */
type ZipSource = { size: number; read: (at: number, length: number) => Uint8Array };
/** An archive's parts by name, of which only those asked for are inflated. */
export type ZipArchive = {
  names: readonly string[];
  /** Whether it has a part by this name (part names are matched without regard to case, as Office matches them). */
  has: (name: string) => boolean;
  /** A part's bytes, inflated and checked; undefined when there is no such part. */
  bytes: (name: string) => Uint8Array | undefined;
  /** A part as UTF-8 text, without its byte order mark; undefined when there is no such part. */
  text: (name: string) => string | undefined;
};
type Entry = {
  name: string;
  method: number;
  flags: number;
  crc: number;
  compressed: number;
  size: number;
  offset: number;
};

const END = 0x06054b50,
  CENTRAL = 0x02014b50,
  LOCAL = 0x04034b50;
const STORED = 0,
  DEFLATED = 8;
/** The compressed bytes given to the inflater at once: what one push makes is at most about 1,000 times as many. */
const CHUNK = 4096;
const megabytes = (n: number) => `${(n / 1e6).toLocaleString('en-GB', { maximumFractionDigits: 1 })} MB`;
const count = (n: number) => n.toLocaleString('en-GB');

const u16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
const damaged = (why: string) => new Error(`is damaged, or not a zip archive as .xlsx and .docx files are: ${why}`);

/** The CRC-32 of each byte value, as zip computes its checksums. */
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Whether a name leaves the archive: a .. segment, or a path from a root (/, \ or a drive such as C:). */
const escapes = (name: string) => /^[/\\]|^[A-Za-z]:/.test(name) || name.split(/[/\\]/).includes('..');

/** The end of the central directory: where the directory is, how long it is, and how many entries it lists. */
function endOf(source: ZipSource): { at: number; length: number; entries: number } {
  const tail = Math.min(source.size, 22 + 0xffff),
    start = source.size - tail,
    b = source.read(start, tail);
  for (let i = tail - 22; i >= 0; i--) {
    if (u32(b, i) !== END) continue;
    const entries = u16(b, i + 10),
      length = u32(b, i + 12),
      at = u32(b, i + 16);
    if (u16(b, i + 4) !== 0 || u16(b, i + 6) !== 0 || u16(b, i + 8) !== entries)
      throw new Error('is split over several files, which the system does not read');
    if (entries === 0xffff || length === 0xffffffff || at === 0xffffffff)
      throw new Error('is a ZIP64 archive, which the system does not read');
    if (at + length > start + i) throw damaged('its central directory runs past its end');
    return { at, length, entries };
  }
  throw damaged('it has no central directory');
}

/** The entries the central directory lists, checked against the limits before any part is inflated. */
function entriesOf(source: ZipSource, limits: ZipLimits): Entry[] {
  if (source.size > limits.file)
    throw new Error(
      `is ${megabytes(source.size)}; the system reads .xlsx and .docx files up to ${megabytes(limits.file)}`,
    );
  if (source.size < 22) throw damaged('it is too short to be one');
  const end = endOf(source);
  if (end.entries > limits.entries)
    throw new Error(`holds ${count(end.entries)} parts; the system reads archives of at most ${count(limits.entries)}`);
  const b = source.read(end.at, end.length),
    out: Entry[] = [],
    names = new Set<string>();
  let i = 0,
    total = 0;
  for (let n = 0; n < end.entries; n++) {
    if (i + 46 > b.length || u32(b, i) !== CENTRAL) throw damaged('its central directory is cut short');
    const flags = u16(b, i + 8),
      method = u16(b, i + 10),
      crc = u32(b, i + 16),
      compressed = u32(b, i + 20),
      size = u32(b, i + 24);
    const nameLength = u16(b, i + 28),
      extra = u16(b, i + 30),
      comment = u16(b, i + 32),
      offset = u32(b, i + 42);
    if (i + 46 + nameLength > b.length) throw damaged('its central directory is cut short');
    const name = new TextDecoder('utf-8').decode(b.subarray(i + 46, i + 46 + nameLength));
    if (compressed === 0xffffffff || size === 0xffffffff || offset === 0xffffffff)
      throw new Error('is a ZIP64 archive, which the system does not read');
    if (escapes(name) || name.includes('\0'))
      throw new Error(
        `holds a part whose name leaves the archive (${JSON.stringify(name.slice(0, 80))}), so it is not read`,
      );
    const key = name.toLowerCase();
    if (names.has(key))
      throw new Error(`holds two parts named ${JSON.stringify(name.slice(0, 80))}, so it is not read`);
    names.add(key);
    total += size;
    if (total > limits.total)
      throw new Error(
        `says its parts inflate to more than ${megabytes(limits.total)} in all; the system reads archives up to ${megabytes(limits.total)} inflated`,
      );
    if (size > limits.ratioFrom && size > limits.ratio * Math.max(compressed, 1)) {
      throw new Error(
        `holds a part (${JSON.stringify(name.slice(0, 80))}) that says it inflates to ${Math.floor(size / Math.max(compressed, 1))} times its compressed size; the system reads parts of at most ${limits.ratio} times`,
      );
    }
    out.push({ name, method, flags, crc, compressed, size, offset });
    i += 46 + nameLength + extra + comment;
  }
  return out;
}

/** A part's compressed bytes, where its local header says they start. */
function dataOf(source: ZipSource, e: Entry): Uint8Array {
  if (e.offset + 30 > source.size) throw damaged(`its part "${e.name}" starts past its end`);
  const head = source.read(e.offset, 30);
  if (u32(head, 0) !== LOCAL) throw damaged(`its part "${e.name}" has no header where the directory says it is`);
  const start = e.offset + 30 + u16(head, 26) + u16(head, 28);
  if (start + e.compressed > source.size) throw damaged(`its part "${e.name}" runs past its end`);
  return source.read(start, e.compressed);
}

/** A part inflated, never past the size its entry declares: one that comes out larger or shorter is refused. */
function inflated(data: Uint8Array, e: Entry): Uint8Array {
  if (e.method === STORED) {
    if (data.length !== e.size) throw damaged(`its part "${e.name}" is not the size it says`);
    return data;
  }
  if (e.method !== DEFLATED)
    throw new Error(`holds a part ("${e.name}") compressed in a way the system does not read (method ${e.method})`);
  const out = new Uint8Array(e.size);
  let made = 0;
  const inflater = new Inflate((chunk) => {
    if (made + chunk.length > e.size)
      throw new Error(
        `holds a part ("${e.name}") that inflates to more than the ${count(e.size)} bytes it says, so it is not read`,
      );
    out.set(chunk, made);
    made += chunk.length;
  });
  try {
    if (!data.length) inflater.push(data, true);
    for (let i = 0; i < data.length; i += CHUNK) inflater.push(data.subarray(i, i + CHUNK), i + CHUNK >= data.length);
  } catch (x) {
    if (/inflates to more/.test((x as Error).message)) throw x;
    throw damaged(`its part "${e.name}" could not be inflated (${(x as Error).message})`);
  }
  if (made !== e.size) throw damaged(`its part "${e.name}" is shorter than it says`);
  return out;
}

/** An archive, its central directory read and checked; its parts are inflated as they are asked for, once each. */
function openZip(source: ZipSource, limits: ZipLimits = ZIP_LIMITS): ZipArchive {
  const entries = entriesOf(source, limits);
  const byName = new Map(entries.map((e) => [e.name.toLowerCase(), e]));
  const read = new Map<Entry, Uint8Array>();
  const bytes = (name: string) => {
    const e = byName.get(name.toLowerCase());
    if (!e) return undefined;
    const kept = read.get(e);
    if (kept) return kept;
    if (e.flags & 1)
      throw new Error(`is protected by a password (its part "${e.name}" is encrypted), so it is not read`);
    const out = inflated(dataOf(source, e), e);
    if (crc32(out) !== e.crc) throw damaged(`its part "${e.name}" does not match its checksum`);
    read.set(e, out);
    return out;
  };
  return {
    names: entries.map((e) => e.name),
    has: (name) => byName.has(name.toLowerCase()),
    bytes,
    text: (name) => {
      const b = bytes(name);
      if (!b) return undefined;
      try {
        return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(b);
      } catch {
        throw new Error(`holds a part ("${name}") that is not UTF-8 text`);
      }
    },
  };
}

/** An archive in memory. */
export const bytesZip = (b: Uint8Array, limits?: ZipLimits) =>
  openZip({ size: b.length, read: (at, length) => b.subarray(at, at + length) }, limits);

/** An archive on disk, read through one descriptor while use reads it: only its directory and the parts asked for. */
export function withZipFile<T>(file: string, use: (zip: ZipArchive) => T): T {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const read = (at: number, length: number) => {
      const b = Buffer.alloc(length),
        n = fs.readSync(fd, b, 0, length, at);
      if (n !== length) throw damaged('it is shorter than its directory says');
      return b;
    };
    return use(openZip({ size, read }));
  } finally {
    fs.closeSync(fd);
  }
}
