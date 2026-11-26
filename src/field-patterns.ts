// The pattern a field's value must match (JSON Schema's pattern, from a host's operation or a server's elicitation),
// tested only when that is safe. A backtracking engine can take seconds, or longer than anyone waits, to say that a
// value does not fit a pattern whose parts can match the same text in many ways, so a pattern is tested only when:
//   - it is at most 200 characters long, and compiles in Unicode mode;
//   - it has no backreference (\1, \k<name>);
//   - no group that repeats holds a choice of its own: no nested quantifiers ((a+)+, (\d{1,3})*, (x?){3}) and no
//     repeated alternatives ((a|ab)*), the shapes whose backtracking grows exponentially with the value;
//   - it has at most 3 choices: quantifiers that may match more or less (*, +, ?, {n,}, {n,m}) and groups of
//     alternatives (a|b), whose backtracking grows as the value's length to the power of their number;
//   - the value tested is at most 500 characters: what is longer is refused, never tested.
// Within these the worst a value can do is about the cube of 500 steps: milliseconds. A pattern outside them is not
// checked here, as a broken one is not; the server or host that set it still checks what it gets.
const LONGEST = 200, CHOICES = 3;
/** The longest value a pattern is tested on. */
export const PATTERN_VALUE_MAX = 500;

type Quantifier = { length: number; choice: boolean; repeats: boolean };
/** The quantifier at the start of the text: its length, whether it leaves a choice, whether it repeats; or null. */
function quantifierAt(text: string): Quantifier | null {
  const m = /^(?:([*+?])|\{(\d+)(,(\d*))?\})\??/.exec(text);
  if (!m) return null;
  let lo: number, hi: number; // how many times at least, and at most
  if (m[1]) { lo = m[1] === '+' ? 1 : 0; hi = m[1] === '?' ? 1 : Infinity; }
  else if (m[3] === undefined) hi = lo = Number(m[2]); // {n}
  else { lo = Number(m[2]); hi = m[4] ? Number(m[4]) : Infinity; } // {n,} and {n,m}
  return { length: m[0].length, choice: hi > lo, repeats: hi > 1 };
}

/** Where the atom starting at i ends: an escape, a class, or one character. A group is read by the caller. */
function atomEnd(src: string, i: number): number {
  if (src[i] === '\\') return /[pPu]/.test(src[i + 1] ?? '') && src[i + 2] === '{' ? src.indexOf('}', i) + 1 : i + 2;
  if (src[i] === '[') { let j = i + 1; while (j < src.length && src[j] !== ']') j += src[j] === '\\' ? 2 : 1; return j + 1; }
  return i + 1;
}
/** Where a group's own pattern starts, after its opening: (?: (?= (?! (?<= (?<! (?<name>, or none of them. */
function groupStart(src: string, i: number): number {
  if (src[i] !== '?') return i;
  if (src[i + 1] !== '<') return i + 2;
  return src[i + 2] === '=' || src[i + 2] === '!' ? i + 3 : src.indexOf('>', i) + 1;
}

/** A field's pattern as a regular expression (Unicode mode), when it is safe to test; undefined when it is not. */
export function patternOf(src: string): RegExp | undefined {
  if (typeof src !== 'string' || src.length > LONGEST) return undefined;
  let re: RegExp;
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- what this module is for: an untrusted pattern, bounded first (length, no backreferences, no nested quantifiers)
  try { re = new RegExp(src, 'u'); } catch { return undefined; }
  // each open group: whether it holds a choice anywhere inside it, and whether it has alternatives of its own
  const groups: { holds: boolean; alternatives: boolean }[] = [{ holds: false, alternatives: false }];
  const top = () => groups[groups.length - 1];
  let choices = 0, i = 0;
  /** The quantifier after what was just read (a group holding a choice, or not): false when it makes the pattern unsafe. */
  const quantified = (holdsChoice: boolean): boolean => {
    const q = quantifierAt(src.slice(i, i + 24));
    if (!q) return true;
    if (holdsChoice && q.repeats) return false;
    if (q.choice) { choices++; top().holds = true; }
    i += q.length;
    return true;
  };
  while (i < src.length) {
    const c = src[i];
    if (c === '\\' && /[1-9k]/.test(src[i + 1] ?? '')) return undefined; // a backreference
    if (c === '(') { groups.push({ holds: false, alternatives: false }); i = groupStart(src, i + 1); continue; }
    if (c === '|') { top().holds = true; top().alternatives = true; i++; continue; }
    if (c === ')') {
      const group = groups.pop()!; i++;
      if (group.alternatives) choices++;
      if (!quantified(group.holds)) return undefined;
      if (group.holds) top().holds = true;
    } else {
      i = atomEnd(src, i);
      if (!quantified(false)) return undefined;
    }
    if (choices > CHOICES) return undefined;
  }
  return groups[0].alternatives && choices + 1 > CHOICES ? undefined : re;
}
