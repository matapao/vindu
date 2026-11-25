// The notice block: something the person should know (a warning, a closure, a change of plan), one strip per row,
// coloured by its level (yellow, orange or red; anything else is a plain note), with when it is from and to and the
// area it is for. Its rows' fields are found by their roles; warnings in a shape whose level, times and area sit
// inside each item are read by those roles wherever they are (weather.ts). A view of notices alone is drawn as a
// strip, without a title bar, and never fullscreen (view-summary.ts).
import { block, needOne } from './block-kit.js';
import { asText } from './format.js';
import { levelOf, warningsOf } from './weather.js';

export const NOTICE = block({
  name: 'notice', component: 'VNotice',
  about: 'a notice: something the person should know (a warning, a closure, a change of plan), one strip per row, coloured by its level (yellow, orange or red; anything else is a plain note), with from, to and the area it is for; warnings whose level, times and area sit inside each item are read as they are. A view of notices alone is a strip, never fullscreen',
  roles: { text: /^(text|title|headline|message|description|summary|event|name)$/i, level: /^(level|severity|awareness_?level|warning_?level|colou?r|risk_?level)$/i,
    from: /^(from|onset|start|effective|begins?|valid_?from)$/i, to: /^(to|until|expires|end|ends|valid_?to)$/i, area: /^(area|area_?name|area_?desc|region|county|place|location)$/i },
  rows: (rows, _p, m) => {
    if (m.text || m.level) return rows.map(r => ({ ...r, __level: levelOf(m.level ? r[m.level] : undefined) ?? 'note' }));
    const read = warningsOf(rows); // the level, times and area inside each item
    if (!read.length) return rows; // its check says what it needs
    Object.assign(m, { text: 'title', level: 'level', from: 'from', to: 'to', area: 'area' });
    return read.map(w => ({ title: w.title ?? '', level: w.level, from: w.from ?? '', to: w.to ?? '', area: w.area ?? '', __level: w.level }));
  },
  check: (rows, _p, m) => needOne(m, ['text', 'level'], 'a notice', rows),
  derived: ['__level'],
  words: w => ({ ...w.notice }),
  account: rows => ({ notices: rows.length, levels: Object.fromEntries(rows.reduce((a, r) => a.set(asText(r.__level ?? 'note'), (a.get(asText(r.__level ?? 'note')) ?? 0) + 1), new Map<string, number>())) }),
});
