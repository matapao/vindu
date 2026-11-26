import { html, nothing } from 'lit';
import { changedFields } from '../../changes.js';
import { fieldValue, formatCell, formatTime, rowContainer, displayNames, defineBlock } from './shared.js';
import { sendBlockAction } from '../dom.js';
import { asText } from '../../format.js';
import { BLOCK_WORDS, wordsGiven, wordWith } from '../../block-words.js';
import { VIEW_WORDS } from '../../view-words.js';

const ON = /^(on|true|yes|enabled|running|active|open|1)$/i;
/** A call's outcome, as its mark: it went, it failed, or it is not known. */
const outcomeMark = (outcome: unknown) => {
  if (outcome === 'ok') return '✓';
  return outcome === 'failed' ? '✗' : '?';
};
type DeviceWords = Pick<typeof VIEW_WORDS, 'on' | 'off' | 'turnOn' | 'turnOff'>;
/** The words it draws: the view's, where the surface gives them, and English for each one it does not. */
const deviceWords = (given: unknown): DeviceWords => {
  const words = (given && typeof given === 'object' ? given : {}) as Record<string, unknown>;
  const word = (name: keyof DeviceWords) => (typeof words[name] === 'string' ? words[name] : VIEW_WORDS[name]);
  return { on: word('on'), off: word('off'), turnOn: word('turnOn'), turnOff: word('turnOff') };
};
export const VDevices = defineBlock('VDevices', 'vindu-devices', { operation: 'string', words: 'value' }, (props) => {
  const words = deviceWords(props.words);
  return html`<div class="vb-list">${props.rows.map((row, index) => {
    const state = fieldValue(props, row, 'state');
    const on = state === true || ON.test(asText(state ?? ''));
    const turn = on ? words.turnOff : words.turnOn;
    let said: unknown; // a yes or no in the view's words, any other state as written
    if (typeof state === 'boolean') said = state ? words.on : words.off;
    else said = formatCell(props, state);
    const act = (e: Event) =>
      sendBlockAction(e.currentTarget as HTMLElement, {
        type: 'operation',
        name: props.operation,
        input: { id: fieldValue(props, row, 'id') ?? fieldValue(props, row, 'name'), state: on ? 'off' : 'on' },
      });
    return rowContainer(
      props,
      index,
      'vb-item vb-device',
      html`<span class="vb-name">${formatCell(props, fieldValue(props, row, 'name'))}${
        fieldValue(props, row, 'kind') !== undefined
          ? html`<span class="vb-muted"> · ${formatCell(props, fieldValue(props, row, 'kind'))}</span>`
          : nothing
      }</span><span class=${`vb-pill ${on ? 'vb-on' : ''}`}>${said}</span>${
        props.operation
          ? html`<button class="vb-btn" aria-label=${`${turn} ${asText(fieldValue(props, row, 'name') ?? '')}`.trim()} @click=${act}>${
              turn
            }</button>`
          : nothing
      }`,
    );
  })}</div>`;
});

/** A batch: how many calls went how, of all of them, then a row per call: its outcome and what it was about (the
 *  system's label from its input, never its result id), and why it failed. */
export const VBatch = defineBlock('VBatch', 'vindu-batch', { words: 'value' }, (props) => {
  const rows = props.rows;
  const words = wordsGiven(props.words, BLOCK_WORDS.batch);
  const countOutcome = (o: string) => rows.filter((row) => row.outcome === o).length;
  const counted = (word: string, n: number) => wordWith(word, { count: formatCell(props, n) });
  return html`<div class="vb-batch"><div class="vb-meta"><b>${counted(words.ok, countOutcome('ok'))}</b>${
    countOutcome('failed')
      ? html` · <span class="vb-warn">${counted(words.failed, countOutcome('failed'))}</span>`
      : nothing
  }${
    countOutcome('missing') ? html` · ${counted(words.missing, countOutcome('missing'))}` : nothing
  } <span class="vb-muted">${counted(words.of, rows.length)}</span></div><div class="vb-list">${rows.map((row, index) =>
    rowContainer(
      props,
      index,
      'vb-item vb-call',
      html`<span class=${`vb-mark ${row.outcome === 'ok' ? '' : 'vb-warn'}`}>${outcomeMark(
        row.outcome,
      )}</span><span class="vb-name">${asText(row.for ?? '')}</span><span class="vb-muted">${row.detail}</span>`,
    ),
  )}</div></div>`;
});

export const VChanges = defineBlock(
  'VChanges',
  'vindu-changes',
  {},
  (props) =>
    html`<div class="vb-list">${props.rows.map((row, index) => {
      const before = fieldValue(props, row, 'before');
      const after = fieldValue(props, row, 'after');
      const pairs: [string, unknown, unknown][] = props.map?.field
        ? [[String(fieldValue(props, row, 'field')), before, after]]
        : changedFields(before, after);
      return rowContainer(
        props,
        index,
        'vb-item vb-change',
        html`<span class="vb-anchor">${formatCell(
          props,
          fieldValue(props, row, 'key') ?? index + 1,
        )}</span><span>${pairs.map(
          ([k, x, y]) =>
            html`<div><span class="vb-muted">${k}</span> <del>${formatCell(
              props,
              x,
              k,
            )}</del> → <ins>${formatCell(props, y, k)}</ins></div>`,
        )}</span>`,
      );
    })}</div>`,
);

export const VDecision = defineBlock(
  'VDecision',
  'vindu-decision',
  {},
  (props) =>
    html`${props.rows.map((row, index) =>
      rowContainer(
        props,
        index,
        'vb-decision',
        html`<div class="vb-title">${formatCell(
          props,
          fieldValue(props, row, 'outcome'),
        )}</div><div class="vb-body">${formatCell(props, fieldValue(props, row, 'grounds'))}</div>${
          displayNames(fieldValue(props, row, 'sources')).length
            ? html`<div class="vb-chips">${displayNames(fieldValue(props, row, 'sources')).map(
                (s) => html`<span class="vb-chip vb-src">${s}</span>`,
              )}</div>`
            : nothing
        }<div class="vb-muted">${[
          fieldValue(props, row, 'by') !== undefined
            ? `decided by ${displayNames(fieldValue(props, row, 'by')).join(', ')}`
            : '',
          fieldValue(props, row, 'at') !== undefined ? formatTime(props, fieldValue(props, row, 'at')) : '',
        ]
          .filter(Boolean)
          .join(' · ')}</div>${
          fieldValue(props, row, 'appeal') !== undefined
            ? html`<div class="vb-appeal">${formatCell(props, fieldValue(props, row, 'appeal'))}</div>`
            : nothing
        }`,
      ),
    )}`,
);
