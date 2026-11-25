// Weather as the system reads it, wherever it comes from: a forecast is a time series of instants, each with a time
// and some of a temperature, precipitation, wind and a symbol; a warning has a level (yellow, orange or red), when it
// is from and to, and an area. Each is found by its role's usual names wherever it sits in an item (an item's own
// fields, or objects inside it), so the common shapes are read the same way, and no source's own field names are
// written here. What a day's weather is, worked out from its instants, is the system's: the events block draws it on
// the day (block-events.ts), and a card says it in a line (panel-summary.ts). The window draws the symbols too.
import { dayOf } from './dates.js';

/** One instant of a forecast. */
export type Instant = { time: string; temperature?: number; min?: number; max?: number; precipitation?: number; wind?: number; symbol?: string };
/** A warning's level, from the least to the most severe. */
export type WarningLevel = 'yellow' | 'orange' | 'red';
const LEVELS: readonly WarningLevel[] = ['yellow', 'orange', 'red'];
/** One warning: its level, when it is from and to, the area it is for, and what it is about. */
export type Warning = { level: WarningLevel; from?: string; to?: string; area?: string; title?: string };
/** A day's weather, worked out by the system from its instants: the symbol nearest midday, the lowest and highest
 *  temperature, the precipitation added up, and the strongest wind. */
export type DayWeather = { symbol?: string; min?: number; max?: number; precipitation?: number; wind?: number };

const INSTANT = {
  time: /^(time|valid_?time|date_?time|timestamp|time_?stamp|dt|from_?time|start_?time|when)$/i,
  temperature: /^(air_?temperature|temperature|temp|temperatur|t2m)$/i,
  min: /^(air_?temperature_?min|temperature_?min|min_?temp(erature)?|temp_?min|min_?temperatur)$/i,
  max: /^(air_?temperature_?max|temperature_?max|max_?temp(erature)?|temp_?max|max_?temperatur)$/i,
  precipitation: /^(precipitation(_?amount)?|precip(itation)?(_?mm)?|rain(fall)?|nedb[øo]r)$/i,
  wind: /^(wind_?speed|wind|vind(styrke)?|vind_?hastighet)$/i,
  symbol: /^(symbol(_?code)?|weather_?symbol|weather_?code|icon|condition|vær)$/i,
};
const WARNING = {
  level: /^(level|awareness_?level|warning_?level|severity|colou?r|risk_?level|farge|niv[åa])$/i,
  from: /^(from|onset|start|starts|effective|begins?|valid_?from|event_?start|fra)$/i,
  to: /^(to|until|expires|end|ends|valid_?to|event_?end|til)$/i,
  interval: /^(interval|period|valid|span)$/i,
  area: /^(area|area_?name|area_?desc|region|county|place|location|omr[åa]de)$/i,
  title: /^(title|headline|event|event_?type|awareness_?type|name)$/i,
};

/** An item's fields, its own first and then those of the objects inside it, breadth first: the first of a name wins. */
function fieldsOf(item: unknown, depth = 4): [string, unknown][] {
  const out: [string, unknown][] = [];
  let level: unknown[] = [item];
  for (let d = 0; d < depth && level.length; d++) {
    const next: unknown[] = [];
    for (const o of level) {
      if (!o || typeof o !== 'object' || Array.isArray(o)) continue;
      for (const [k, v] of Object.entries(o)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) next.push(v);
        else out.push([k, v]);
      }
    }
    level = next;
  }
  return out;
}
const found = (fields: [string, unknown][], role: RegExp) => fields.find(([k, v]) => role.test(k) && v !== null && v !== undefined && v !== '')?.[1];
/** A number, or one written as text (a decimal comma read as a point). */
function numberOf(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string' || v.trim() === '') return undefined;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}
/** Text, or a number as text; none for anything else, or for text that is blank. */
function textOf(v: unknown): string | undefined {
  if (typeof v === 'number') return String(v);
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}
const isTime = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) && Number.isFinite(Date.parse(v));

/** The lists in a value, breadth first: the value itself when it is one, then those inside its objects. */
export function listsIn(value: unknown, depth = 5): unknown[][] {
  const out: unknown[][] = [];
  let level: unknown[] = [value];
  for (let d = 0; d < depth && level.length; d++) {
    const next: unknown[] = [];
    for (const v of level) {
      if (Array.isArray(v)) { out.push(v); continue; }
      if (v && typeof v === 'object') next.push(...Object.values(v));
    }
    level = next;
  }
  return out;
}

/** One item as an instant of a forecast: its time, and a temperature, or a symbol with precipitation or wind. */
function instantOf(item: unknown): Instant | undefined {
  const f = fieldsOf(item), time = found(f, INSTANT.time);
  if (!isTime(time)) return undefined;
  const x: Instant = { time: time as string };
  for (const role of ['temperature', 'min', 'max', 'precipitation', 'wind'] as const) {
    const n = numberOf(found(f, INSTANT[role]));
    if (n !== undefined) x[role] = n;
  }
  const symbol = textOf(found(f, INSTANT.symbol));
  if (symbol) x.symbol = symbol;
  const warm = x.temperature !== undefined || x.min !== undefined || x.max !== undefined;
  return warm || (x.symbol !== undefined && (x.precipitation !== undefined || x.wind !== undefined)) ? x : undefined;
}
/** A forecast's instants, from a list of them or the first list inside a value that is one; none when it holds none. */
export function instantsOf(value: unknown): Instant[] {
  for (const list of listsIn(value)) {
    const instants = list.map(instantOf).filter((x): x is Instant => !!x);
    if (instants.length && instants.length >= list.length / 2) return instants;
  }
  return [];
}

/** A level as a warning says it: a colour (in English or Norwegian), a severity as alerts write it, or a number from 2
 *  to 4; none when it is not one. */
export function levelOf(v: unknown): WarningLevel | undefined {
  const s = textOf(v)?.toLowerCase() ?? '';
  if (/\bred\b|rød|raud|extreme|^4$/.test(s)) return 'red';
  if (/orange|oransje|severe|^3$/.test(s)) return 'orange';
  if (/yellow|\bgul|moderate|^2$/.test(s)) return 'yellow';
  return undefined;
}
function warningOf(item: unknown): Warning | undefined {
  const f = fieldsOf(item), level = levelOf(found(f, WARNING.level));
  if (!level) return undefined;
  const interval = (item && typeof item === 'object' ? fieldsOfLists(item) : []).find(([k, v]) => WARNING.interval.test(k) && Array.isArray(v) && v.length === 2 && v.every(isTime))?.[1] as string[] | undefined;
  const from = found(f, WARNING.from) ?? interval?.[0], to = found(f, WARNING.to) ?? interval?.[1];
  const area = textOf(found(f, WARNING.area)), title = textOf(found(f, WARNING.title));
  if (!isTime(from) && !area) return undefined; // a level alone is a status, not a warning: a warning holds from a time, or for an area
  return { level, ...(isTime(from) ? { from: from as string } : {}), ...(isTime(to) ? { to: to as string } : {}), ...(area ? { area } : {}), ...(title ? { title } : {}) };
}
/** An item's lists, its own and those of the objects inside it: where a warning keeps its from and to together. */
const fieldsOfLists = (item: object): [string, unknown][] => {
  const out: [string, unknown][] = [];
  const walk = (o: unknown, depth: number) => {
    if (!o || typeof o !== 'object' || Array.isArray(o) || depth > 3) return;
    for (const [k, v] of Object.entries(o)) { if (Array.isArray(v)) out.push([k, v]); else walk(v, depth + 1); }
  };
  walk(item, 0);
  return out;
};
/** The warnings in a value: the first list in it of which most items have a level. */
export function warningsOf(value: unknown): Warning[] {
  for (const list of listsIn(value)) {
    const warnings = list.map(warningOf).filter((x): x is Warning => !!x);
    if (warnings.length && warnings.length >= list.length / 2) return warnings;
  }
  return [];
}
/** The most severe of these warnings, the earliest of them where several are as severe. */
export function worstWarning(warnings: readonly Warning[]): Warning | undefined {
  return [...warnings].sort((a, b) => LEVELS.indexOf(b.level) - LEVELS.indexOf(a.level) || String(a.from ?? '').localeCompare(String(b.from ?? '')))[0];
}

/** The hour of a time in a time zone, with its minutes as a fraction. */
const hourIn = (time: string, timeZone: string) => {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(new Date(time)).split(':').map(Number);
  return h + m / 60;
};
/** Each day's weather, by day (YYYY-MM-DD in the time zone), worked out from the forecast's instants. */
export function dailyWeather(instants: readonly Instant[], timeZone: string): Map<string, DayWeather> {
  const byDay = new Map<string, Instant[]>();
  for (const x of instants) { const day = dayOf(x.time, timeZone); if (day) byDay.set(day, [...(byDay.get(day) ?? []), x]); }
  const out = new Map<string, DayWeather>();
  for (const [day, xs] of byDay) {
    const lows = xs.flatMap(x => [x.min, x.temperature].filter((n): n is number => n !== undefined));
    const highs = xs.flatMap(x => [x.max, x.temperature].filter((n): n is number => n !== undefined));
    const rain = xs.map(x => x.precipitation).filter((n): n is number => n !== undefined);
    const winds = xs.map(x => x.wind).filter((n): n is number => n !== undefined);
    const symbols = xs.filter(x => x.symbol).sort((a, b) => Math.abs(hourIn(a.time, timeZone) - 12) - Math.abs(hourIn(b.time, timeZone) - 12));
    out.set(day, {
      ...(symbols.length ? { symbol: symbols[0].symbol } : {}),
      ...(lows.length ? { min: Math.min(...lows) } : {}), ...(highs.length ? { max: Math.max(...highs) } : {}),
      ...(rain.length ? { precipitation: Number(rain.reduce((a, b) => a + b, 0).toFixed(1)) } : {}),
      ...(winds.length ? { wind: Math.max(...winds) } : {}),
    });
  }
  return out;
}

/** A weather symbol as a sign to draw, from the words its code is made of (clear sky, partly cloudy, rain, …); the
 *  code itself says what it is, for a screen reader. */
export function weatherSign(code: string): string {
  const c = code.toLowerCase();
  if (/thunder|lightning|torden/.test(c)) return '⛈';
  if (/sleet|sludd/.test(c)) return '\u{1F328}';
  if (/snow|snø/.test(c)) return '❄';
  if (/shower|byge/.test(c)) return '\u{1F326}';
  if (/rain|drizzle|regn/.test(c)) return '\u{1F327}';
  if (/fog|mist|tåke/.test(c)) return '\u{1F32B}';
  if (/partly|fair|lettskyet|delvis/.test(c)) return '⛅';
  if (/cloud|overcast|skyet/.test(c)) return '☁';
  if (/night|natt/.test(c)) return '☾';
  if (/clear|sun|sol|klar/.test(c)) return '☀';
  return '•';
}
/** A symbol's code as words: "partlycloudy_day" is "partly cloudy, day". */
export const symbolWords = (code: string) => code.replace(/partly/i, 'partly ').replace(/light(?!ning)/i, 'light ').replace(/heavy/i, 'heavy ').replace(/_/g, ', ').replace(/\s+/g, ' ').trim();
