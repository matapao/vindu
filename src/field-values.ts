// A field the person fills in, as an ask holds it: the plain JSON Schema MCP elicitation uses, read from a server's
// schema (fieldsOf), and each value checked by the system against its format and its own rules (checkValue), so the
// model gets only values that fit.
import { z } from 'zod';
import { PATTERN_VALUE_MAX, patternOf } from './field-patterns.js';
import { isCalendarDay } from './format.js';

/** A field the person fills in: the plain JSON Schema MCP elicitation uses. enum holds the values; labels and hints, when
 *  the schema titles and describes them, what the person reads for each; multi: pick any number of them. */
export const FORMATS = ['date', 'date-time', 'time', 'email', 'uri', 'money', 'place', 'file'] as const;
/** Check digits a field's value must have: an IBAN (mod 97), a Norwegian organisation number (orgnr, mod 11), Luhn (mod 10). */
export const CHECKS = ['iban', 'orgnr', 'luhn'] as const;
export type Format = (typeof FORMATS)[number];
export type Check = (typeof CHECKS)[number];
export const FieldSchema = z.object({
  type: z.enum(['string', 'number', 'integer', 'boolean']),
  title: z.string().optional(),
  description: z.string().optional(),
  format: z.enum(FORMATS).optional(),
  check: z.enum(CHECKS).optional(),
  enum: z.array(z.string()).optional(),
  labels: z.array(z.string()).optional(),
  hints: z.array(z.string().optional()).optional(),
  multi: z.boolean().optional(),
  long: z.boolean().optional(),
  default: z.unknown().optional(),
  pattern: z.string().optional(),
  min: z.union([z.number(), z.string()]).optional(),
  max: z.union([z.number(), z.string()]).optional(),
  minLength: z.number().int().min(0).optional(),
  maxLength: z.number().int().min(1).optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  accept: z.string().optional(),
  example: z.string().optional(),
});
export type Field = z.infer<typeof FieldSchema>;
type Choice = { const?: unknown; title?: string; description?: string };
type Prop = {
  type?: string;
  title?: string;
  description?: string;
  enum?: unknown[];
  enumNames?: string[];
  oneOf?: Choice[];
  anyOf?: Choice[];
  items?: { type?: string; enum?: unknown[]; anyOf?: Choice[]; oneOf?: Choice[] };
  default?: unknown;
  format?: string;
  maxLength?: number;
  minLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
};
/** An elicitation's schema (MCP's: an object of plain fields) as the fields of an ask, keeping what the schema says the
 *  person reads: each field's title and description, each choice's title and description (titled enums, the older
 *  enumNames), and lists to pick several from. */
export function fieldsOf(schema: unknown): { fields: Record<string, Field>; required: string[] } {
  const s = (schema ?? {}) as { properties?: Record<string, Prop>; required?: string[] };
  const entries: [string, Field][] = []; // made into an object at once: a field named __proto__ is a field like any other
  const choices = (list: Choice[]) => ({
    enum: list.map((o) => String(o.const)),
    labels: list.map((o) => o.title ?? String(o.const)),
    ...(list.some((o) => o.description) ? { hints: list.map((o) => o.description) } : {}),
  });
  // a list's choices: titled (anyOf, oneOf) or plain (enum); none, it is free text
  const itemChoices = (it: NonNullable<Prop['items']>) => {
    const titled = it.anyOf ?? it.oneOf;
    if (titled?.length) return choices(titled);
    return it.enum?.length ? { enum: it.enum.map(String) } : undefined;
  };
  // a field's choices: titled (oneOf, anyOf), or plain (enum) with the older enumNames as their labels
  const propChoices = (p: Prop) => {
    const titled = p.oneOf ?? p.anyOf;
    if (titled?.length) return choices(titled);
    return p.enum?.length
      ? { enum: p.enum.map(String), ...(p.enumNames?.length === p.enum.length ? { labels: p.enumNames } : {}) }
      : {};
  };
  for (const [k, p] of Object.entries(s.properties ?? {})) {
    const base = {
      ...(p.title ? { title: p.title } : {}),
      ...(p.description ? { description: p.description } : {}),
      ...(p.default !== undefined ? { default: p.default } : {}),
    };
    if (p.type === 'array') {
      const en = itemChoices(p.items ?? {});
      entries.push([k, en ? { type: 'string', multi: true, ...base, ...en } : { type: 'string', long: true, ...base }]); // a list of free text is written one per line
      continue;
    }
    const type = p.type === 'number' || p.type === 'integer' || p.type === 'boolean' ? p.type : 'string';
    const en = propChoices(p);
    const kind =
      type === 'string' && p.format && (FORMATS as readonly string[]).includes(p.format)
        ? { format: p.format as Format }
        : {};
    const limits = {
      ...(p.minLength !== undefined ? { minLength: p.minLength } : {}),
      ...(p.maxLength !== undefined ? { maxLength: p.maxLength } : {}),
      ...(p.minimum !== undefined ? { min: p.minimum } : {}),
      ...(p.maximum !== undefined ? { max: p.maximum } : {}),
      ...(typeof p.pattern === 'string' && patternOf(p.pattern) ? { pattern: p.pattern } : {}),
    }; // a pattern not safe to test is left out, as the server's to check
    entries.push([
      k,
      {
        type,
        ...base,
        ...en,
        ...kind,
        ...limits,
        ...(type === 'string' && !('enum' in en) && (p.maxLength ?? 0) > 200 ? { long: true } : {}),
      },
    ]);
  }
  const fields: Record<string, Field> = Object.fromEntries(entries);
  return { fields, required: (Array.isArray(s.required) ? s.required : []).filter((k) => Object.hasOwn(fields, k)) };
}

/** Why a value does not fit its field, or nothing: the system checks each kind itself, so the model gets only values
 *  that fit (a real date, an amount with at most two decimals, an IBAN whose check digits add up). The field's own rules
 *  (its length, its pattern, its check digits) hold whatever its format. */
export function checkValue(f: Field, v: unknown): string | undefined {
  const t = String(v);
  return formatWrong(f, t) ?? rulesWrong(f, t);
}
/** name@domain.tld, as /^[^\s@]+@[^\s@]+\.[^\s@]+$/ says, without its backtracking over every dot of the domain: one "@"
 *  with no space anywhere, something before it, and a dot in the domain with something on either side. */
export const isEmail = (t: string): boolean =>
  /^[^\s@]+@[^\s@]+$/.test(t) && t.slice(t.indexOf('@') + 2, -1).includes('.');
/** Why a value is not what its format says (a date, a time, an e-mail address, an amount, a place), or nothing. */
function formatWrong(f: Field, t: string): string | undefined {
  const between = (x: number | string, kind: string) => {
    if (f.min !== undefined && x < f.min) return `${kind} ${f.min} or later`;
    return f.max !== undefined && x > f.max ? `${kind} ${f.max} or earlier` : undefined;
  };
  switch (f.format) {
    case 'date': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return 'a date, as YYYY-MM-DD';
      return isCalendarDay(t) ? between(t, 'a date') : `${t} is not a day of the calendar`;
    }
    case 'time':
      return /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(t) ? between(t, 'a time') : 'a time, as HH:MM';
    case 'date-time': {
      if (!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/.test(t))
        return 'a date and time, as YYYY-MM-DDTHH:MM';
      return isCalendarDay(t.slice(0, 10)) ? between(t, 'a time') : `${t.slice(0, 10)} is not a day of the calendar`;
    }
    case 'email':
      return isEmail(t) ? undefined : 'an e-mail address, as name@example.com';
    case 'uri':
      try {
        const u = new URL(t);
        return /^(https?|mailto|tel):$/.test(u.protocol) ? undefined : 'a web address, http:// or https://';
      } catch {
        return 'a web address, http:// or https://';
      }
    case 'money': {
      const s = t.replace(/\s/g, '').replace(',', '.');
      if (!/^-?\d+(\.\d{1,2})?$/.test(s))
        return `an amount${f.currency ? ` in ${f.currency}` : ''}, with at most two decimals`;
      const n = Number(s);
      if (f.min !== undefined && n < Number(f.min)) return `at least ${f.min}`;
      return f.max !== undefined && n > Number(f.max) ? `at most ${f.max}` : undefined;
    }
    case 'place': {
      const m = /^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/.exec(t);
      if (m && (Math.abs(+m[1]) > 90 || Math.abs(+m[2]) > 180)) return 'latitude is -90 to 90, longitude -180 to 180';
      if (!m && t.length < 3) return 'an address, or latitude, longitude';
      return undefined;
    }
    case 'file': // the person picks files: no text to check
    case undefined:
      return undefined;
  }
}
/** Why a value breaks its field's own rules (a number's bounds, its length, its pattern, its check digits), or nothing. */
function rulesWrong(f: Field, t: string): string | undefined {
  if (f.type === 'number' || f.type === 'integer') {
    const n = Number(t.replace(',', '.'));
    if (f.min !== undefined && n < Number(f.min)) return `at least ${f.min}`;
    if (f.max !== undefined && n > Number(f.max)) return `at most ${f.max}`;
  }
  if (f.minLength !== undefined && t.length < f.minLength) return `at least ${f.minLength} characters`;
  if (f.maxLength !== undefined && t.length > f.maxLength) return `at most ${f.maxLength} characters`;
  const re = f.pattern ? patternOf(f.pattern) : undefined; // a pattern broken or not safe to test is not held against the person
  if (re && t.length > PATTERN_VALUE_MAX) return `at most ${PATTERN_VALUE_MAX} characters`;
  if (re && !re.test(t)) return f.example ? `in the form ${f.example}` : `in the form ${f.pattern}`;
  if (f.check && !checkDigits(f.check, t)) return CHECK_WRONG[f.check];
  return undefined;
}
/** What the person reads when a value's check digits do not add up. */
const CHECK_WRONG: Record<Check, string> = {
  iban: 'not an IBAN: its check digits do not add up',
  orgnr: "not an organisation number (Norway's orgnr): nine digits whose check digit adds up",
  luhn: 'its check digit does not add up',
};

/** Whether a number's check digits add up: an IBAN (mod 97), a Norwegian organisation number (mod 11), Luhn (mod 10). */
export function checkDigits(c: Check, raw: string): boolean {
  const s = raw.replace(/[\s-]/g, '').toUpperCase();
  if (c === 'iban') {
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
    const moved = s.slice(4) + s.slice(0, 4);
    let rem = 0;
    for (const ch of moved) {
      const d = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
      for (const x of d) rem = (rem * 10 + Number(x)) % 97;
    }
    return rem === 1;
  }
  if (c === 'orgnr') {
    if (!/^\d{9}$/.test(s)) return false;
    const sum = [3, 2, 7, 6, 5, 4, 3, 2].reduce((a, w, i) => a + w * Number(s[i]), 0);
    const r = sum % 11;
    const k = r === 0 ? 0 : 11 - r;
    return k !== 10 && k === Number(s[8]);
  }
  if (!/^\d{2,}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < s.length; i++) {
    let d = Number(s[s.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}
