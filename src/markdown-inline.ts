// The text of a Markdown block marked up inline, by the system: emphasis, strong emphasis, strikethrough, code, links
// and hard line breaks. What it makes is data, never markup: raw HTML is text like any other, an image is its
// description, and a link is kept only when it goes to http or https (anything else is its text alone). Code spans and
// brackets are paired once for the whole text, and a search for a closing mark that found none is not made again, so a
// long paragraph never takes long.

/** Text as Markdown marks it: plain text, or a part of it marked. */
export type Inline =
  | string
  | { em: Inline[] }
  | { strong: Inline[] }
  | { del: Inline[] }
  | { code: string }
  | { link: string; text: Inline[] }
  | { br: true };

const PUNCTUATION = /^[!-/:-@[-`{-~]$/; // ASCII punctuation: what a backslash escapes
const SPACE = /\s/;
const WORD = /[\p{L}\p{N}]/u;
const MAX_NESTING = 4; // marks inside marks, at most: deeper ones are text
const LINK_TAIL = 2048; // the characters a link's destination and title may take, at most
const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™', hellip: '…',
  mdash: '—', ndash: '–', laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', times: '×', deg: '°',
  euro: '€', middot: '·', bull: '•',
};
const ENTITY = /&(?:#(\d{1,7})|#[xX]([\da-fA-F]{1,6})|([a-z]{2,8}));/y;
const AUTOLINK = /<(https?:\/\/[^\s<>]*)>/y;
const BARE_URL = /https?:\/\/[^\s<]+/y;

/** An address a document links to: http or https, as the URL standard writes it; null for anything else (javascript:,
 *  data:, mailto:, a path of the document's own). */
export function webAddress(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
/** An address a Word document links to, and the window draws a link to: one webAddress takes, or a mail address
 *  (mailto:); null for anything else. Markdown's links are only web addresses. */
export function linkAddress(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    return url.protocol === 'mailto:' ? url.href : webAddress(raw);
  } catch {
    return null;
  }
}

/** The text alone, without its marks: what a heading says, for its anchor and the account. */
export function plainOf(inlines: readonly Inline[]): string {
  return inlines.map(plainPart).join('');
}
function plainPart(x: Inline): string {
  if (typeof x === 'string') return x;
  if ('code' in x) return x.code;
  if ('br' in x) return ' ';
  if ('link' in x) return plainOf(x.text);
  if ('em' in x) return plainOf(x.em);
  if ('strong' in x) return plainOf(x.strong);
  return plainOf(x.del);
}

/** The opening marks a run of n characters of c may be, longest first: emphasis and strong at once (3), strong (2),
 *  emphasis (1); a strikethrough is exactly 2. */
function opens(c: string, n: number): number[] {
  if (c === '~') return n === 2 ? [2] : [];
  return [3, 2, 1].filter(k => k <= n);
}
/** Whether a run of this length closes an opening mark of n characters of c: emphasis closes with 1 or with 3 or more,
 *  strong with 2 or more, a strikethrough with exactly 2. */
function closes(c: string, n: number, run: number): boolean {
  if (c === '~') return run === 2;
  return n === 1 ? run !== 2 : run >= n;
}
/** Text marked by an opening mark of k characters of c. */
function marked(c: string, k: number, content: Inline[]): Inline {
  if (c === '~') return { del: content };
  if (k === 3) return { em: [{ strong: content }] };
  return k === 2 ? { strong: content } : { em: content };
}

/** Each code span (a run of backticks to the next run of the same length), by where it starts: where its content
 *  ends, and the length of its runs. Runs inside a span are its text (a backslash there is too), and a run with no
 *  partner is text. */
function codeSpans(s: string): Map<number, { end: number; run: number }> {
  const runs: [number, number, boolean][] = []; // where, how long, and whether a backslash escapes it (it opens nothing)
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '`') continue;
    let j = i; while (s[j] === '`') j++;
    let slashes = 0; while (s[i - 1 - slashes] === '\\') slashes++;
    runs.push([i, j - i, slashes % 2 === 1]); i = j - 1;
  }
  const byLength = new Map<number, number[]>();
  runs.forEach(([, n], r) => { const list = byLength.get(n); if (list) list.push(r); else byLength.set(n, [r]); });
  const searched = new Map<number, number>(); // by length: how far into its runs the pairing has gone
  const spans = new Map<number, { end: number; run: number }>();
  for (let r = 0; r < runs.length; r++) {
    const [start, n, escaped] = runs[r], list = byLength.get(n)!;
    if (escaped) continue;
    let k = searched.get(n) ?? 0; while (k < list.length && list[k] <= r) k++;
    searched.set(n, k + 1);
    if (k === list.length) continue;
    spans.set(start, { end: runs[list[k]][0], run: n });
    r = list[k];
  }
  return spans;
}

/** Each bracket that opens, by where it is: where the bracket that closes it is. Escaped brackets and brackets in code
 *  spans pair with nothing. */
function bracketPairs(s: string, spans: Map<number, { end: number; run: number }>): Map<number, number> {
  const open: number[] = [], pairs = new Map<number, number>();
  for (let i = 0; i < s.length; i++) {
    const c = s[i], span = spans.get(i);
    if (c === '\\') i++;
    else if (span) i = span.end + span.run - 1;
    else if (c === '[') open.push(i);
    else if (c === ']' && open.length) pairs.set(open.pop()!, i);
  }
  return pairs;
}

/** What a code span holds: its line breaks as spaces, and one space trimmed from each end when both ends have one. */
const spanText = (t: string) => {
  const one = t.replace(/\n/g, ' ');
  return one.length > 2 && one.startsWith(' ') && one.endsWith(' ') && /[^ ]/.test(one) ? one.slice(1, -1) : one;
};

/** A run of one character from i, up to to. */
const runOf = (s: string, i: number, to: number) => { let j = i; while (j < to && s[j] === s[i]) j++; return j - i; };

/** Markdown's inline marks in a block's text, as data. */
export function parseInline(s: string): Inline[] {
  const spans = codeSpans(s), brackets = bracketPairs(s, spans);
  const missing = new Map<string, number>(); // a search for a closing mark that found none: from where, by mark and scope
  let linkBudget = 2 * s.length + 10_000; // the characters read after "](" in all, so that text full of them stays quick

  const canOpen = (i: number, n: number, to: number) => {
    const next = i + n < to ? s[i + n] : ' ';
    return !SPACE.test(next) && (s[i] !== '_' || !WORD.test(s[i - 1] ?? ' '));
  };
  const canClose = (k: number, n: number) => !SPACE.test(s[k - 1] ?? ' ') && (s[k] !== '_' || !WORD.test(s[k + n] ?? ' '));
  /** The closing run for an opening mark of n characters of c, from where its text starts, up to to. */
  const closer = (c: string, n: number, from: number, to: number): { at: number; run: number } | null => {
    const key = `${c}${n}:${to}`;
    if (from >= (missing.get(key) ?? Infinity)) return null;
    for (let k = from; k < to;) {
      const ch = s[k], span = spans.get(k);
      if (ch === '\\') { k += 2; continue; }
      if (span) { k = span.end + span.run; continue; }
      if (ch !== c) { k++; continue; }
      const run = runOf(s, k, to);
      if (k > from && closes(c, n, run) && canClose(k, run)) return { at: k, run };
      k += run;
    }
    missing.set(key, Math.min(from, missing.get(key) ?? Infinity));
    return null;
  };

  /** A link's destination and title after its text, from just after "(": the address, and where the link ends. What
   *  it reads is taken from the budget, whether it is a link or not. */
  const destination = (from: number, to: number): { href: string; end: number } | null => {
    const stop = Math.min(to, from + LINK_TAIL, from + linkBudget);
    if (stop <= from) return null;
    const read = (at: number, link: { href: string; end: number } | null) => { linkBudget -= at - from; return link; };
    let i = from; while (i < stop && SPACE.test(s[i])) i++;
    let href: string;
    if (s[i] === '<') {
      const j = s.slice(i + 1, stop).search(/[<>\n]/);
      if (j < 0 || s[i + 1 + j] !== '>') return read(stop, null);
      href = s.slice(i + 1, i + 1 + j); i += j + 2;
    } else {
      let depth = 0; const start = i;
      for (; i < stop; i++) {
        const c = s[i];
        if (c === '\\' && PUNCTUATION.test(s[i + 1] ?? '')) { i++; continue; }
        if (SPACE.test(c) || (c === ')' && !depth)) break;
        if (c === '(') depth++; else if (c === ')') depth--;
      }
      href = s.slice(start, i).replace(/\\([!-/:-@[-`{-~])/g, '$1');
    }
    while (i < stop && SPACE.test(s[i])) i++;
    if (s[i] === '"' || s[i] === "'" || s[i] === '(') {
      const close = s.slice(i + 1, stop).indexOf(s[i] === '(' ? ')' : s[i]);
      if (close < 0) return read(stop, null);
      i += close + 2; while (i < stop && SPACE.test(s[i])) i++;
    }
    return read(i, s[i] === ')' ? { href, end: i + 1 } : null);
  };
  /** An entity at i (&amp;, &#65;, &#x41;) and how long it is; one Vindu does not know is text. */
  const entityAt = (i: number, to: number): { text: string; length: number } | null => {
    ENTITY.lastIndex = i; const m = ENTITY.exec(s);
    if (!m || i + m[0].length > to) return null;
    if (m[3]) return Object.hasOwn(ENTITIES, m[3]) ? { text: ENTITIES[m[3]], length: m[0].length } : null;
    const code = m[1] ? Number(m[1]) : parseInt(m[2], 16);
    return { text: code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : '\ufffd', length: m[0].length };
  };
  /** A web address written out in the text, without what ends its sentence: its length, and the address. */
  const bareUrlAt = (i: number, to: number): { url: string; href: string } | null => {
    BARE_URL.lastIndex = i; const m = BARE_URL.exec(s); if (!m) return null;
    let url = m[0].slice(0, to - i).replace(/[?!.,:;*_~'"]+$/, '');
    while (url.endsWith(')') && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) url = url.slice(0, -1);
    const href = url.length > 'https://'.length ? webAddress(url) : null;
    return href ? { url, href } : null;
  };

  const parse = (from: number, to: number, depth: number, inLink: boolean): Inline[] => {
    const out: Inline[] = [];
    let text = '', run = from; // the text so far, and where the characters taken as they are since then start
    /** The characters as they are up to at, then the text so far, into the output. */
    const take = (at: number) => { if (at > run) text += s.slice(run, at); };
    const push = (x: Inline) => { if (text) out.push(text); text = ''; out.push(x); };
    const marks = depth < MAX_NESTING;
    let i = from;
    const next = (at: number) => { i = run = at; };
    while (i < to) {
      const c = s[i];
      if (c === '\\' || c === '\n') { // an escape, or a line break: two spaces or a backslash before it make it a hard one
        const escaped = c === '\\' && i + 1 < to ? s[i + 1] : '';
        if (c === '\\' && PUNCTUATION.test(escaped)) { take(i); text += escaped; next(i + 2); continue; }
        if (c === '\\' && escaped !== '\n') { i++; continue; }
        let end = i; while (end > run && s[end - 1] === ' ') end--;
        take(end);
        if (c === '\\' || i - end >= 2) push({ br: true }); else text += '\n';
        let after = c === '\\' ? i + 2 : i + 1; while (after < to && s[after] === ' ') after++;
        next(after); continue;
      }
      const span = spans.get(i);
      if (span && span.end + span.run <= to) { take(i); push({ code: spanText(s.slice(i + span.run, span.end)) }); next(span.end + span.run); continue; }
      if (c === '`') { i += runOf(s, i, to); continue; }
      const entity = c === '&' ? entityAt(i, to) : null;
      if (entity) { take(i); text += entity.text; next(i + entity.length); continue; }
      // [text](address), and ![description](address), which shows its description: never a picture fetched
      const image = c === '!' && s[i + 1] === '[';
      const open = image ? i + 1 : i, close = s[open] === '[' ? brackets.get(open) : undefined;
      const dest = close !== undefined && close < to && s[close + 1] === '(' && (marks || image) ? destination(close + 2, to) : null;
      if (dest) {
        const label = marks ? parse(open + 1, close!, depth + 1, true) : [s.slice(open + 1, close)]; // too deep: as written
        const href = image || inLink ? null : webAddress(dest.href);
        take(i);
        if (href) push({ link: href, text: label }); else for (const x of label) if (typeof x === 'string') text += x; else push(x);
        next(dest.end); continue;
      }
      AUTOLINK.lastIndex = i;
      const auto = c === '<' && !inLink ? AUTOLINK.exec(s) : null, autoHref = auto && i + auto[0].length <= to ? webAddress(auto[1]) : null;
      if (auto && autoHref) { take(i); push({ link: autoHref, text: [auto[1]] }); next(i + auto[0].length); continue; }
      const bare = c === 'h' && !inLink && !WORD.test(s[i - 1] ?? ' ') ? bareUrlAt(i, to) : null;
      if (bare) { take(i); push({ link: bare.href, text: [bare.url] }); next(i + bare.url.length); continue; }
      if ((c === '*' || c === '_' || c === '~') && marks) {
        const n = runOf(s, i, to);
        let found: { k: number; end: { at: number; run: number } } | undefined;
        if (canOpen(i, n, to)) for (const k of opens(c, n)) { const end = closer(c, k, i + k, to); if (end) { found = { k, end }; break; } }
        if (!found) { i += n; continue; } // a mark that closes nowhere is text, the whole of its run
        const { k, end } = found;
        const content = parse(i + k, end.at + end.run - k, depth + 1, inLink); // a longer closing run closes with its last characters
        take(i); push(marked(c, k, content));
        next(end.at + end.run); continue;
      }
      i++;
    }
    take(to); if (text) out.push(text);
    return out;
  };
  return parse(0, s.length, 0, false);
}
