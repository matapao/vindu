// A header row's names as the fields of the rows under it, for a data file or a worksheet: each once, an empty one
// named by its place (c3), one written twice with its count ("total (2)"), and what was renamed said.

/** The header's names, each once; what was renamed is said in said. */
export function headerOf(names: string[], said: string[]): string[] {
  const seen = new Map<string, number>();
  const out: string[] = [];
  for (const [i, raw] of names.entries()) {
    const base = raw.trim() === '' ? `c${i + 1}` : raw;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.push(n > 1 ? `${base} (${n})` : base);
  }
  const renamed = out.filter((x, i) => x !== names[i]);
  if (renamed.length)
    said.push(
      `named ${renamed.length} column${renamed.length > 1 ? 's' : ''} of the header that ${renamed.length > 1 ? 'were' : 'was'} empty or written twice: ${renamed.slice(0, 6).join(', ')}`,
    );
  return out;
}
