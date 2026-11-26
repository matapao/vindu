// A card of the host's own, on the server side: one bar per row, how far each has come. The model names it like any
// card ({ card: 'progress', from: 'r1', label, done, total }); Vindu resolves the rows exactly as for its own cards
// (from, pick, where, sort, limit), checks the fields the card shows, runs this card's own check, tells the model what
// rendered, and binds the rows to the component the window registers under the same name (progress-component.ts).
import { z, type CardDef } from '@matapao/vindu/server';

const num = (v: unknown) => (typeof v === 'number' ? v : Number.NaN);

export const progress: CardDef = {
  name: 'progress',
  about: 'one bar per row, done out of total; label names each row',
  component: 'Progress',
  // every panel shares one schema, so a card's own fields are optional there; its check asks for them
  fields: {
    done: z.string().optional().describe('progress: the field with how much is done'),
    total: z.string().optional().describe('progress: the field with the whole'),
  },
  shows: (p) => [p.label, p.done, p.total].filter((f): f is string => typeof f === 'string'),
  check: (rows, p) => {
    const need = (['label', 'done', 'total'] as const).filter((k) => typeof p[k] !== 'string');
    const { done, total } = p;
    if (need.length || typeof done !== 'string' || typeof total !== 'string')
      return `progress needs ${need.join(' and ')}: the fields that name each row, say how much is done, and give the whole`;
    const bad = rows.filter((r) => !Number.isFinite(num(r[done])) || !(num(r[total]) > 0)).length;
    return bad
      ? `"${done}" and "${total}" must be numbers, the whole above 0, in every row; ${bad} rows are not`
      : null;
  },
  props: (p) => ({ label: p.label, done: p.done, total: p.total }),
  account: (rows, p) => ({
    complete: rows.filter((r) => num(r[p.done as string]) >= num(r[p.total as string])).length,
  }),
};
