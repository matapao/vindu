// The locale the window writes a view's values in. A browser's Intl may lack a language the provider has (Chromium
// has Norwegian, "no", but not Nynorsk, "nn"), and would write its numbers and dates in its own default instead: such a
// locale is written as its macrolanguage, in the same region, where the window has that.
const MACROLANGUAGES: Record<string, string> = { nb: 'no', nn: 'no' };
const resolved = new Map<string, string>();

/** A locale the window has: the one given, or its macrolanguage's where it lacks it; the one given when neither. */
export function localeHere(locale: string): string {
  const known = resolved.get(locale);
  if (known) return known;
  let here = locale;
  try {
    if (!Intl.DateTimeFormat.supportedLocalesOf([locale]).length) {
      const { language, region } = new Intl.Locale(locale), macro = MACROLANGUAGES[language];
      const fallback = macro && (region ? `${macro}-${region}` : macro);
      if (fallback && Intl.DateTimeFormat.supportedLocalesOf([fallback]).length) here = fallback;
    }
  } catch { /* not a language tag: Intl writes it in its own default, as before */ }
  resolved.set(locale, here);
  return here;
}
