// A notice, drawn: one strip per row in its level's colour (a warning's yellow, orange or red, or a plain note), its
// level in the view's words, its text, its area and from when to when.
import { html, nothing } from 'lit';
import { BLOCK_WORDS, wordsGiven, wordWith, type NoticeWords } from '../../block-words.js';
import { asText } from '../../format.js';
import { defineBlock, fieldValue, formatCell, formatTime, rowContainer, type BlockProps } from './shared.js';

const LEVELS = new Set(['yellow', 'orange', 'red']);

/** When a notice holds: from one time to another, from a time on, or until a time. */
function whenOf(props: BlockProps, words: NoticeWords, from: unknown, to: unknown): string {
  if (from && to) return `${formatTime(props, from)} \u2013 ${formatTime(props, to)}`;
  if (from) return wordWith(words.from, { when: formatTime(props, from) });
  return to ? wordWith(words.until, { when: formatTime(props, to) }) : '';
}

export const VNotice = defineBlock('VNotice', 'vindu-notice', { words: 'value' }, (props) => {
  const words = wordsGiven(props.words, BLOCK_WORDS.notice);
  return html`<div class="vb-notices">${props.rows.map((row, index) => {
    const level = asText(row.__level ?? 'note'), known = LEVELS.has(level);
    const said = (role: string) => { const v = fieldValue(props, row, role); return v === undefined || v === '' ? '' : formatCell(props, v); };
    const when = whenOf(props, words, fieldValue(props, row, 'from'), fieldValue(props, row, 'to'));
    const body = html`${known ? html`<b>${words[level as 'yellow' | 'orange' | 'red']}</b> ` : nothing}<span>${said('text')}</span>${
      said('area') ? html`<span class="vb-muted"> · ${said('area')}</span>` : nothing}${when ? html`<span class="vb-muted"> · ${when}</span>` : nothing}`;
    return rowContainer(props, index, `vb-notice ${known ? `vb-level-${level}` : 'vb-level-note'}`, body);
  })}</div>`;
});
