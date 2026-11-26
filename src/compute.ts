// Arithmetic by the system, so a computed value is as exact as a value read: an expression over one row's fields
// ("hours * rate"), or over a set of rows ("sum(hours * rate)", "sum(amount) - sum(paid)"), with inputs the person can
// change ("$growth"). Parsed, never evaluated as code. The same code runs in views (Node), in the window, and in pages:
// makeCompute is sent to a page as source, so it must stand alone (no imports, nothing from outside it).
//   numbers: 12, 0.25, 1e3          fields: hours, unit_price, "unit price" (quoted when not a plain name)
//   inputs: $growth                 operators: + - * / and parentheses, unary minus
//   over a row: round(x, n) abs floor ceil, min(a, b, …), max(a, b, …)
//   over rows: count(), sum(x), avg(x), median(x), min(x), max(x) — x any row expression; they combine: sum(a) / count()
// A missing or non-numeric field, or a division by zero, makes the value empty (null); sums and averages skip empty
// values, as SQL does, and a step says how many were empty. round(x, n) rounds half away from zero, to n decimals
// (default 0; a negative n rounds to tens, hundreds, …); every result is kept to 15 significant digits, what a double
// holds exactly (0.1 + 0.2 is 0.3 here).
export type Expr =
  | { k: 'num'; v: number }
  | { k: 'field'; f: string }
  | { k: 'input'; n: string }
  | { k: 'neg'; a: Expr }
  | { k: 'bin'; op: '+' | '-' | '*' | '/'; a: Expr; b: Expr }
  | { k: 'call'; fn: string; args: Expr[] };

export function makeCompute() {
  const AGG = ['count', 'sum', 'avg', 'median', 'min', 'max'];
  const FN = ['round', 'abs', 'floor', 'ceil', 'min', 'max'];
  const TIMES = { '*': '*', '/': '/', '×': '*', '÷': '/' } as const; // × and ÷ read as * and /
  const LONGEST = 2000,
    DEEPEST = 64; // the longest expression read, and how deep its parentheses and functions go
  const fail = (msg: string): never => {
    throw new Error(msg);
  };
  /** Why a function cannot take this many values, or null: count takes none or one, round one or two, min and max one
   *  or more (one: over rows; more: of a row's values), the others one. */
  const arityWrong = (fn: string, n: number): string | null => {
    if (fn === 'count') return n > 1 ? 'count() takes no value, or one' : null;
    if (fn === 'round') return n < 1 || n > 2 ? 'round(x, n) takes a value and, if you like, the decimals' : null;
    if (fn === 'min' || fn === 'max') return n < 1 ? `${fn}(…) needs a value` : null;
    return n === 1 ? null : `${fn}(…) takes one value`;
  };
  function parse(src: string): Expr {
    const s = String(src);
    let i = 0,
      depth = 0;
    if (s.length > LONGEST) fail(`an expression of at most ${LONGEST} characters; this one has ${s.length}`);
    const nested = (f: () => Expr): Expr => {
      if (++depth > DEEPEST) fail(`"${s.slice(0, 40)}…" goes more than ${DEEPEST} levels deep`);
      const e = f();
      depth--;
      return e;
    };
    const ws = () => {
      while (i < s.length && /\s/.test(s[i])) i++;
    };
    const peek = () => {
      ws();
      return s[i];
    };
    const expr = (): Expr => {
      let a = term();
      for (;;) {
        const c = peek();
        if (c === '+' || c === '-') {
          i++;
          a = { k: 'bin', op: c, a, b: term() };
        } else return a;
      }
    };
    const term = (): Expr => {
      let a = unary();
      for (;;) {
        const c = peek();
        if (c === '*' || c === '/' || c === '×' || c === '÷') {
          i++;
          a = { k: 'bin', op: TIMES[c], a, b: unary() };
        } else return a;
      }
    };
    const unary = (): Expr => {
      const c = peek();
      if (c === '-' || c === '−') {
        i++;
        return { k: 'neg', a: nested(unary) };
      }
      if (c === '+') {
        i++;
        return nested(unary);
      }
      return atom();
    };
    const atom = (): Expr => {
      const c = peek();
      if (c === undefined) return fail(`"${s}" ends too soon`);
      if (c === '(') {
        i++;
        const e = nested(expr);
        if (peek() !== ')') fail(`"${s}": a ( is not closed`);
        i++;
        return e;
      }
      if (/[0-9.]/.test(c)) {
        const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
        if (!m) fail(`"${s}": a number is not written right at ${i}`);
        i += m![0].length;
        return { k: 'num', v: Number(m![0]) };
      }
      if (c === '$') {
        i++;
        const m = /^[A-Za-z_]\w*/.exec(s.slice(i));
        if (!m) fail(`"${s}": $ needs an input's name`);
        i += m![0].length;
        return { k: 'input', n: m![0] };
      }
      if (c === '"' || c === '`') {
        const end = s.indexOf(c, i + 1);
        if (end < 0) fail(`"${s}": a quoted field is not closed`);
        const f = s.slice(i + 1, end);
        i = end + 1;
        return { k: 'field', f };
      }
      const m = /^[A-Za-z_][\w.]*/.exec(s.slice(i));
      if (!m)
        return fail(
          `"${s}": "${c}" is not something it can compute with (fields, numbers, $inputs, + - * / and functions)`,
        );
      i += m[0].length;
      if (peek() === '(') {
        const fn = m[0].toLowerCase();
        i++;
        if (!AGG.includes(fn) && !FN.includes(fn))
          fail(`"${s}": no function ${m[0]}; there are ${[...new Set([...AGG, ...FN])].join(', ')}`);
        const args: Expr[] = [];
        if (peek() !== ')')
          for (;;) {
            args.push(nested(expr));
            const d = peek();
            if (d === ',') {
              i++;
              continue;
            }
            if (d === ')') break;
            fail(`"${s}": expected , or ) in ${fn}(…)`);
          }
        i++;
        const wrong = arityWrong(fn, args.length);
        if (wrong) fail(`"${s}": ${wrong}`);
        return { k: 'call', fn, args };
      }
      return { k: 'field', f: m[0] };
    };
    const e = expr();
    if (peek() !== undefined) fail(`"${s}": something is left over at "${s.slice(i)}"`);
    return e;
  }
  const isAgg = (e: Expr): boolean =>
    e.k === 'call' &&
    (e.fn === 'count' ||
      e.fn === 'sum' ||
      e.fn === 'avg' ||
      e.fn === 'median' ||
      ((e.fn === 'min' || e.fn === 'max') && e.args.length === 1));
  const walk = (e: Expr, f: (x: Expr) => void): void => {
    f(e);
    if (e.k === 'neg') walk(e.a, f);
    else if (e.k === 'bin') {
      walk(e.a, f);
      walk(e.b, f);
    } else if (e.k === 'call') e.args.forEach((a) => walk(a, f));
  };
  const fieldsIn = (e: Expr) => {
    const out: string[] = [];
    walk(e, (x) => {
      if (x.k === 'field' && !out.includes(x.f)) out.push(x.f);
    });
    return out;
  };
  const inputsIn = (e: Expr) => {
    const out: string[] = [];
    walk(e, (x) => {
      if (x.k === 'input' && !out.includes(x.n)) out.push(x.n);
    });
    return out;
  };
  const hasAggregate = (e: Expr) => {
    let y = false;
    walk(e, (x) => {
      if (isAgg(x)) y = true;
    });
    return y;
  };
  const num = (v: unknown): number | null => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
    return null;
  };
  const clean = (x: number) => Number(x.toPrecision(15)) + 0; // + 0: no -0, which a locale writes as "-0"
  // x × 10ⁿ, exact, by moving the decimal point in x's own digits (which may be written as 1e-7 or 1e+21 already)
  const shift = (x: number, n: number) => {
    const [m, e = '0'] = String(x).split('e');
    return Number(`${m}e${Number(e) + n}`);
  };
  const round = (x: number, n = 0): number | null => {
    if (!Number.isInteger(n)) return null;
    const a = Math.abs(clean(x)),
      up = shift(a, n);
    const r = Number.isFinite(up) ? shift(Math.round(up), -n) : a; // n past what a double holds: nothing to round
    return x < 0 && r !== 0 ? -r : r; // what rounds to nothing is 0, never -0
  };
  const arith = (op: string, a: number | null, b: number | null): number | null => {
    if (a === null || b === null) return null;
    let v: number;
    if (op === '+') v = a + b;
    else if (op === '-') v = a - b;
    else if (op === '*') v = a * b;
    else if (b === 0) return null;
    else v = a / b;
    return !Number.isFinite(v) ? null : clean(v);
  };
  const own = (o: Record<string, unknown> | undefined, k: string) => (o && Object.hasOwn(o, k) ? o[k] : undefined); // never what objects inherit
  const least = (xs: number[]) => xs.reduce((a, b) => (b < a ? b : a)),
    most = (xs: number[]) => xs.reduce((a, b) => (b > a ? b : a)); // any number of them
  const input = (n: string, inputs: Record<string, unknown>) => {
    const v = num(own(inputs, n));
    return v === null
      ? fail(
          `no input $${n}; inputs: ${
            Object.keys(inputs)
              .map((k) => `$${k}`)
              .join(', ') || 'none'
          }`,
        )
      : v;
  };
  const scalar = (fn: string, xs: (number | null)[]): number | null => {
    if (xs.some((x) => x === null)) return null;
    const v = xs as number[];
    if (fn === 'round') return round(v[0], v[1] ?? 0);
    if (fn === 'abs') return Math.abs(v[0]);
    if (fn === 'floor') return clean(Math.floor(v[0]));
    if (fn === 'ceil') return clean(Math.ceil(v[0]));
    return fn === 'min' ? least(v) : most(v);
  };
  /** One row's value. Aggregates are for sets of rows, not here. */
  function rowValue(e: Expr, row: Record<string, unknown>, inputs: Record<string, unknown> = {}): number | null {
    switch (e.k) {
      case 'num':
        return e.v;
      case 'field':
        return num(own(row, e.f));
      case 'input':
        return input(e.n, inputs);
      case 'neg': {
        const a = rowValue(e.a, row, inputs);
        return a === null ? null : clean(-a);
      }
      case 'bin':
        return arith(e.op, rowValue(e.a, row, inputs), rowValue(e.b, row, inputs));
      case 'call':
        if (isAgg(e))
          return fail(`${e.fn}(…) is over rows; for each row, write the row's own arithmetic (e.g. hours * rate)`);
        return arityWrong(e.fn, e.args.length)
          ? fail(arityWrong(e.fn, e.args.length)!)
          : scalar(
              e.fn,
              e.args.map((a) => rowValue(a, row, inputs)),
            );
    }
  }
  /** A set of rows' value: aggregates over row expressions, combined with arithmetic. A field outside an aggregate is refused. */
  function setValue(e: Expr, rows: Record<string, unknown>[], inputs: Record<string, unknown> = {}): number | null {
    switch (e.k) {
      case 'num':
        return e.v;
      case 'input':
        return input(e.n, inputs);
      case 'field':
        return fail(
          `"${e.f}" is a field of each row: over rows, say how to combine it, e.g. sum(${e.f}) or avg(${e.f})`,
        );
      case 'neg': {
        const a = setValue(e.a, rows, inputs);
        return a === null ? null : clean(-a);
      }
      case 'bin':
        return arith(e.op, setValue(e.a, rows, inputs), setValue(e.b, rows, inputs));
      case 'call': {
        const wrong = arityWrong(e.fn, e.args.length);
        if (wrong) return fail(wrong); // an expression made by hand, not parsed
        if (!isAgg(e))
          return scalar(
            e.fn,
            e.args.map((a) => setValue(a, rows, inputs)),
          );
        if (e.fn === 'count')
          return e.args.length ? rows.filter((r) => rowValue(e.args[0], r, inputs) !== null).length : rows.length;
        const xs = rows.map((r) => rowValue(e.args[0], r, inputs)).filter((x): x is number => x !== null);
        if (!xs.length) return null;
        if (e.fn === 'median') {
          const o = [...xs].sort((a, b) => a - b),
            mid = o.length >> 1;
          return o.length % 2 ? o[mid] : clean((o[mid - 1] + o[mid]) / 2);
        }
        const sum = clean(xs.reduce((a, b) => a + b, 0));
        if (e.fn === 'sum') return sum;
        if (e.fn === 'avg') return clean(sum / xs.length);
        return e.fn === 'min' ? least(xs) : most(xs);
      }
    }
  }
  /** The name a computed value goes by, the same everywhere: sum(amount) → sum_amount, sum(hours * rate) → sum_hours_rate. */
  const computedName = (expr: string) =>
    String(expr)
      .replace(/\$/g, '')
      .replace(/[^A-Za-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'count';
  /** Rows with computed fields added, each computed by the system; and how many came out empty, by field. */
  function addFields(
    rows: Record<string, unknown>[],
    fields: Record<string, string>,
    inputs: Record<string, unknown> = {},
  ): { rows: Record<string, unknown>[]; empty: Record<string, number> } {
    const parsed = Object.entries(fields).map(([k, src]) => {
      if (k === '__proto__') fail('a computed field cannot be named __proto__');
      const e = parse(src);
      if (hasAggregate(e)) fail(`${k} = ${src}: a field of each row can't sum over rows; use value for that`);
      return [k, e] as const;
    });
    const empty: Record<string, number> = {};
    const out = rows.map((r) => {
      const o = { ...r };
      for (const [k, e] of parsed) {
        const v = rowValue(e, o, inputs);
        o[k] = v;
        if (v === null) empty[k] = (empty[k] ?? 0) + 1;
      }
      return o;
    });
    return { rows: out, empty };
  }
  return { parse, rowValue, setValue, fieldsIn, inputsIn, hasAggregate, computedName, addFields, round, num };
}

export const { parse, rowValue, setValue, computedName, addFields, round, num } = makeCompute();
/** What the model is told the expressions can be. */
export const EXPRESSIONS =
  'fields, numbers, $inputs, + - * / ( ); per row round(x, n), abs, floor, ceil, min(a, b), max(a, b); over rows count(), sum(x), avg(x), median(x), min(x), max(x), where x is any row expression, and they combine, e.g. sum(amount) - sum(paid)';
