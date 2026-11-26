import { html, svg, nothing } from 'lit';
import { BLOCK_WORDS, wordsGiven } from '../../block-words.js';
import { asText, bytesIn } from '../../format.js';
import { SERIES } from '../../series.js';
import {
  type BlockRow,
  fieldValue,
  formatCell,
  formatTime,
  rowContainer,
  displayNames,
  defineBlock,
} from './shared.js';

const ICON: [RegExp, string][] = [
  [/pdf/i, 'PDF'],
  [/image|png|jpe?g|gif|webp|svg/i, 'IMG'],
  [/video|mp4|mov/i, 'VID'],
  [/audio|mp3|wav|m4a/i, 'AUD'],
  [/sheet|excel|xlsx?|csv/i, 'XLS'],
  [/word|docx?|text|txt|md/i, 'DOC'],
  [/zip|tar|gz/i, 'ZIP'],
  [/folder|dir/i, 'DIR'],
];
export const VFiles = defineBlock(
  'VFiles',
  'vindu-files',
  {},
  (props) =>
    html`<div class="vb-list">${props.rows.map((row, index) => {
      const name = asText(fieldValue(props, row, 'name') ?? '');
      const type = asText(fieldValue(props, row, 'type') ?? name.split('.').pop() ?? '');
      return rowContainer(
        props,
        index,
        'vb-item vb-file',
        html`<span class="vb-icon">${
          ICON.find(([re]) => re.test(type))?.[1] ?? 'FILE'
        }</span><span class="vb-name">${name}</span><span class="vb-num">${
          fieldValue(props, row, 'size') !== undefined ? bytesIn(fieldValue(props, row, 'size'), props.locale) : ''
        }</span><span class="vb-when">${formatTime(props, fieldValue(props, row, 'modified'))}</span>${
          fieldValue(props, row, 'owner') !== undefined
            ? html`<span class="vb-muted">${displayNames(fieldValue(props, row, 'owner')).join(', ')}</span>`
            : nothing
        }`,
      );
    })}</div>`,
);

export const VMap = defineBlock('VMap', 'vindu-map', { frame: 'value', words: 'value' }, (props) => {
  const words = wordsGiven(props.words, BLOCK_WORDS.map);
  const frame = (props.frame ?? { width: 640, height: 320 }) as { width: number; height: number };
  const groups = [...new Set(props.rows.map((row) => asText(fieldValue(props, row, 'group') ?? '')))];
  const color = (row: BlockRow) =>
    SERIES.light[groups.indexOf(asText(fieldValue(props, row, 'group') ?? '')) % SERIES.light.length];
  const pts = (s: { points: number[][] }) => s.points.map((q) => q.join(',')).join(' ');
  return html`<div class="vb-map"><svg viewBox=${`0 0 ${frame.width} ${frame.height}`} role="img" aria-label="map">${svg`<rect width=${frame.width} height=${frame.height} class="vb-sea"/>${props.rows.map(
    (row, index) => {
      const s = row.__shape as { kind: string; points: number[][] } | undefined;
      if (!s?.points?.length) return svg``;
      const c = color(row);
      if (s.kind === 'area')
        return svg`<polygon points=${pts(s)} fill=${c} fill-opacity=".18" stroke=${
          c
        } stroke-width="1.5" data-panel=${props.panel ?? ''} data-row=${String(index)}/>`;
      if (s.kind === 'line')
        return svg`<polyline points=${pts(s)} fill="none" stroke=${c} stroke-width="2.5" stroke-linejoin="round" data-panel=${
          props.panel ?? ''
        } data-row=${String(index)}/>`;
      return svg`<circle cx=${s.points[0][0]} cy=${s.points[0][1]} r="5.5" fill=${c} stroke="var(--v-pane)" stroke-width="2" data-panel=${props.panel ?? ''} data-row=${String(index)}/>${
        props.rows.length <= 40 && fieldValue(props, row, 'label') !== undefined
          ? svg`<text x=${s.points[0][0] + 8} y=${s.points[0][1] + 4} class="vb-maplabel">${formatCell(
              props,
              fieldValue(props, row, 'label'),
            )}</text>`
          : svg``
      }`;
    },
  )}`}</svg>
${
  groups.length > 1
    ? html`<div class="vb-legend">${groups.map(
        (g, index) =>
          html`<span><i style=${`background:${SERIES.light[index % SERIES.light.length]}`}></i>${g || '(none)'}</span>`,
      )}</div>`
    : nothing
}<div class="vb-muted vb-small">${words.drawn}</div></div>`;
});

export const VContacts = defineBlock(
  'VContacts',
  'vindu-contacts',
  {},
  (props) =>
    html`<div class="vb-grid">${props.rows.map((row, index) =>
      rowContainer(
        props,
        index,
        'vb-card vb-contact',
        html`<div class="vb-title">${formatCell(props, fieldValue(props, row, 'name') ?? fieldValue(props, row, 'org'))}</div>${
          fieldValue(props, row, 'role') !== undefined ||
          (fieldValue(props, row, 'org') !== undefined && fieldValue(props, row, 'name') !== undefined)
            ? html`<div class="vb-muted">${[
                fieldValue(props, row, 'role'),
                fieldValue(props, row, 'name') !== undefined ? fieldValue(props, row, 'org') : undefined,
              ]
                .filter((x) => x !== undefined && x !== null && x !== '')
                .map((x) => formatCell(props, x))
                .join(' · ')}</div>`
            : nothing
        }${['email', 'phone', 'address'].map((k) =>
          fieldValue(props, row, k) !== undefined
            ? html`<div>${formatCell(props, fieldValue(props, row, k), k)}</div>`
            : nothing,
        )}`,
      ),
    )}</div>`,
);
