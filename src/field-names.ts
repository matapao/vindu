// A field's name as a person reads it: its words apart, as snake_case and camelCase run them together, and a unit it
// ends in written as that unit is ("vind_ms" is "vind (m/s)"). Shared by the chart compiler (Node) and the blocks
// (browser), so no imports.

/** Units a name commonly ends in, each as it is written. */
const UNITS: Record<string, string> = {
  ms: 'm/s', kmh: 'km/h', kph: 'km/h', mph: 'mph', mm: 'mm', cm: 'cm', m: 'm', km: 'km', kg: 'kg', g: 'g', l: 'l', ml: 'ml',
  c: '°C', pct: '%', percent: '%', prosent: '%', kwh: 'kWh', mwh: 'MWh', kw: 'kW', mw: 'MW', w: 'W', hpa: 'hPa',
  s: 's', h: 'h', min: 'min', nok: 'NOK', eur: 'EUR', usd: 'USD', sek: 'SEK', dkk: 'DKK', gbp: 'GBP',
};

/** The words of a name: apart at underscores, hyphens and spaces, and where camelCase starts a word. A word that only
 *  camelCase gave a capital is written in lower case; an abbreviation in capitals is kept. */
export function nameWords(name: string): string[] {
  const apart = name.replace(/([\p{Ll}\d])(\p{Lu})/gu, '$1 $2').replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2');
  return apart.split(/[_\s-]+/).filter(Boolean).map((word, i) => (i > 0 && /^\p{Lu}\p{Ll}*$/u.test(word) ? word.toLowerCase() : word));
}

/** A name as a person reads it: its words, and the unit it ends in, if any, in parentheses: "nedbør (mm)". */
export function readableName(name: string): string {
  const words = nameWords(name);
  const unit = words.length > 1 ? UNITS[words[words.length - 1].toLowerCase()] : undefined;
  return unit ? `${words.slice(0, -1).join(' ')} (${unit})` : words.join(' ') || name;
}
