// Cards of one value: a kpi (one number, worked out by the system over the rows, or typed), a record (one object, a line
// per field) and text (plain short paragraphs).
import { GUIDE, recordFields } from '../cards.js';
import { aggregate, textOf } from '../view-rows.js';
import { drawnFrom, nested, rowsAsTheyAre, type CardKind } from './kind.js';
import { asText } from '../format.js';

export const KPI: CardKind = {
  reads: GUIDE.kpi.fields,
  one: true,
  sideBySide: true,
  noGroup: (p) =>
    `a kpi shows one number, and group makes one row per value of "${p.group}" with a number computed for each: send a table or a bar-chart with the same group and value, or keep one value with where`,
  direct: (p) => (typeof p.data === 'number' ? { value: p.data } : undefined),
  result: (rows, p, inputs) => ({
    rows,
    value: aggregate(p.value ?? 'count()', rows, p.id, inputs),
    step: { value: p.value ?? 'count()', over: rows.length },
  }),
  draw: (p, d, k) => {
    k.model.value = k.cell(d.value, (p.value ?? '').replace(/[()]/g, ' ').trim().replace(/\s+/g, '_'));
    return [k.text(`${k.pid}__value`, { path: `/panels/${k.pid}/value` }, 'h2')];
  },
  account: (o, _p, _d, kit) => {
    o.shows = kit.model.value;
  },
  probes: (p, _d, m, pid) => [{ component: `${pid}__value`, expect: asText(m.value ?? ''), panel: p.id }],
};

export const RECORD: CardKind = {
  reads: GUIDE.record.fields,
  one: true,
  keepsData: true,
  noGroup: rowsAsTheyAre,
  result: (rows) => ({ record: rows[0] }), // the first row, after where and sort
  check: (p, d) => {
    const rec = d.record ?? {};
    if (!Object.keys(rec).length) return 'the record is empty';
    const fields = recordFields(p, rec);
    const absent = fields.filter((f) => !(f in rec));
    if (absent.length > fields.length / 2)
      return `no field ${absent
        .slice(0, 4)
        .map((f) => `"${f}"`)
        .join(', ')} in this record; fields: ${Object.keys(rec).slice(0, 15).join(', ')}`;
    const held = fields.filter((f) => nested(rec[f]));
    if (held.length)
      return `field ${held.map((f) => `"${f}"`).join(', ')} holds rows or an object, not one value; show it in its own panel with "pick" and leave it out of "fields"`;
    return null;
  },
  draw: (p, d, k) => {
    const record = drawnFrom(p, d, 'record'),
      f = recordFields(p, record);
    k.model.record = Object.fromEntries(f.map((x, i) => [`f${i}`, k.cell(record[x], x)]));
    return f.map((x, i) =>
      k.add({
        id: `${k.pid}__f${i}`,
        component: 'Row',
        children: [
          k.text(`${k.pid}__k${i}`, x, 'caption', 1),
          k.text(`${k.pid}__v${i}`, { path: `/panels/${k.pid}/record/f${i}` }, undefined, 3),
        ],
      }),
    );
  },
  account: (o, _p, _d, kit) => {
    o.values = Object.values(kit.model.record as Record<string, string>)
      .slice(0, 6)
      .join(' · ');
  },
  probes: (p, d, m, pid) => {
    const rec = (m.record ?? {}) as Record<string, string>;
    return recordFields(p, d.record ?? {}).map((x, i) => ({
      component: `${pid}__v${i}`,
      expect: rec[`f${i}`] ?? '',
      panel: p.id,
      field: x,
    }));
  },
};

export const TEXT: CardKind = {
  reads: GUIDE.text.fields,
  noGroup: rowsAsTheyAre,
  direct: (p, e) => ({ text: p.text ?? (e ? textOf(e, p) : undefined) }),
  check: (_p, d) => (d.text ? null : 'a text panel needs text'),
  draw: (_p, d, k) => [k.text(`${k.pid}__text`, d.text, 'body')],
  account: (o, _p, d) => {
    o.characters = String(d.text ?? '').length;
  },
};
