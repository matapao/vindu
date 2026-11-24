import { html, svg, nothing } from 'lit';
import { asText, moneyIn, bytesIn } from '../../format.js';
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

export const VMoney = defineBlock(
  'VMoney',
  'vindu-money',
  { currency: 'string', head: 'value', totals: 'value' },
  (props) => {
    const rows = props.rows;
    const currencyOf = (row?: BlockRow) =>
      asText((row && fieldValue(props, row, 'currency')) || props.currency || '') || undefined;
    const money = (v: unknown, row?: BlockRow) => moneyIn(v, currencyOf(row), props.locale);
    const header = Object.entries((props.head ?? {}) as BlockRow).filter(([k]) => !/^total$/i.test(k));
    const totals = (props.totals ?? {}) as BlockRow;
    if (props.layout === 'payment') {
      const row = rows[0];
      if (!row) return nothing; // no payment to show
      return rowContainer(
        props,
        0,
        'vb-pay',
        html`<div class="vb-big">${money(fieldValue(props, row, 'amount'), row)}</div>${Object.entries(row)
          .filter(([k]) => k !== props.map?.amount && !k.startsWith('__'))
          .map(
            ([k, v]) =>
              html`<div class="vb-kv"><span>${k}</span><span>${formatCell(props, v, k)}</span></div>`,
          )}`,
      );
    }
    return html`<div class="vb-money">${
      header.length
        ? html`<div class="vb-head">${
            header.map(
              ([k, v]) =>
                html`<div class="vb-kv"><span>${k}</span><span>${
                  /date|due/i.test(k) ? formatTime(props, v, false) : formatCell(props, v, k)
                }</span></div>`,
            )
          }</div>`
        : nothing
    }
<table class="vb-lines"><thead><tr><th>${props.map?.description ?? 'item'}</th>${
      props.map?.quantity
        ? html`<th class="vb-num">${
            props.map.quantity
          }</th>`
        : nothing
    }${
      props.map?.price
        ? html`<th class="vb-num">${
            props.map.price
          }</th>`
        : nothing
    }<th class="vb-num">${props.map?.amount ?? 'amount'}</th></tr></thead>
<tbody>${
      rows.map(
        (row, index) =>
          html`<tr data-panel=${props.panel ?? ''} data-row=${String(index)}><td>${
            formatCell(props, fieldValue(props, row, 'description'))
          }</td>${
            props.map?.quantity
              ? html`<td class="vb-num">${
                  formatCell(props, fieldValue(props, row, 'quantity'))
                }</td>`
              : nothing
          }${
            props.map?.price
              ? html`<td class="vb-num">${
                  money(fieldValue(props, row, 'price'), row)
                }</td>`
              : nothing
          }<td class="vb-num">${
            money(fieldValue(props, row, 'amount'), row)
          }</td></tr>`,
      )
    }</tbody>
<tfoot>${
      totals.vat !== undefined
        ? html`<tr><td colspan="9" class="vb-num">Lines ${money(totals.lines)} · VAT ${
            money(totals.vat)
          }</td></tr>`
        : nothing
    }<tr><td colspan="9" class="vb-num vb-total">Total ${money(totals.total)}</td></tr>${
      totals.stated !== undefined
        ? html`<tr><td colspan="9" class="vb-num ${
            totals.agrees ? 'vb-muted' : 'vb-warn'
          }">${
            totals.agrees
              ? `✓ the document's own total, ${money(totals.stated)}, is what its lines add up to`
              : `⚠ the document says ${money(totals.stated)}; its lines add up to ${money(totals.total)}`
          }</td></tr>`
        : nothing
    }</tfoot></table></div>`;
  },
);

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
          fieldValue(props, row, 'size') !== undefined
            ? bytesIn(fieldValue(props, row, 'size'), props.locale)
            : ''
        }</span><span class="vb-when">${
          formatTime(props, fieldValue(props, row, 'modified'))
        }</span>${
          fieldValue(props, row, 'owner') !== undefined
            ? html`<span class="vb-muted">${
                displayNames(fieldValue(props, row, 'owner')).join(', ')
              }</span>`
            : nothing
        }`,
      );
    })}</div>`,
);

export const VMap = defineBlock('VMap', 'vindu-map', { frame: 'value' }, (props) => {
  const frame = (props.frame ?? { width: 640, height: 320 }) as { width: number; height: number };
  const groups = [...new Set(props.rows.map((row) => asText(fieldValue(props, row, 'group') ?? '')))];
  const color = (row: BlockRow) =>
    SERIES.light[groups.indexOf(asText(fieldValue(props, row, 'group') ?? '')) % SERIES.light.length];
  const pts = (s: { points: number[][] }) => s.points.map((q) => q.join(',')).join(' ');
  return html`<div class="vb-map"><svg viewBox=${`0 0 ${frame.width} ${frame.height}`} role="img" aria-label="map">${
    svg`<rect width=${frame.width} height=${frame.height} class="vb-sea"/>${
      props.rows.map((row, index) => {
        const s = row.__shape as { kind: string; points: number[][] } | undefined;
        if (!s?.points?.length) return svg``;
        const c = color(row);
        return s.kind === 'area'
          ? svg`<polygon points=${pts(s)} fill=${c} fill-opacity=".18" stroke=${
              c
            } stroke-width="1.5" data-panel=${props.panel ?? ''} data-row=${String(index)}/>`
          : s.kind === 'line'
            ? svg`<polyline points=${pts(s)} fill="none" stroke=${c} stroke-width="2.5" stroke-linejoin="round" data-panel=${
                props.panel ?? ''
              } data-row=${String(index)}/>`
            : svg`<circle cx=${s.points[0][0]} cy=${s.points[0][1]} r="5.5" fill=${c} stroke="var(--v-pane)" stroke-width="2" data-panel=${props.panel ?? ''} data-row=${String(index)}/>${
                props.rows.length <= 40 && fieldValue(props, row, 'label') !== undefined
                  ? svg`<text x=${s.points[0][0] + 8} y=${s.points[0][1] + 4} class="vb-maplabel">${
                      formatCell(props, fieldValue(props, row, 'label'))
                    }</text>`
                  : svg``
              }`;
      })
    }`
  }</svg>
${
  groups.length > 1
    ? html`<div class="vb-legend">${
        groups.map(
          (g, index) =>
            html`<span><i style=${
              `background:${SERIES.light[index % SERIES.light.length]}`
            }></i>${g || '(none)'}</span>`,
        )
      }</div>`
    : nothing
}<div class="vb-muted vb-small">Positions drawn by the system; no map tiles.</div></div>`;
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
        }${
          ['email', 'phone', 'address'].map((k) =>
            fieldValue(props, row, k) !== undefined
              ? html`<div>${
                  formatCell(props, fieldValue(props, row, k), k)
                }</div>`
              : nothing,
          )
        }`,
      ),
    )}</div>`,
);

export const VSheet = defineBlock('VSheet', 'vindu-sheet', { sheet: 'value' }, (props) => {
  const rows = props.rows;
  const sheet = (props.sheet ?? {}) as {
    formulas?: Record<string, string>;
    totals?: { label: string; expr: string; values: { scenario: string | null; value: number | null }[] }[];
    scenarios?: string[];
  };
  const cols = [...new Set(rows.flatMap((row) => Object.keys(row).filter((k) => !k.startsWith('__'))))];
  const formulas = sheet.formulas ?? {};
  return html`<div class="vb-sheet"><table><thead><tr>${
    cols.map(
      (c) =>
        html`<th class=${
          formulas[c] ? 'vb-num vb-f' : typeof rows[0]?.[c] === 'number' ? 'vb-num' : ''
        } title=${
          formulas[c] ? `= ${formulas[c]}, computed by the system` : c
        }>${
          formulas[c] ? html`<span class="vb-fx">ƒ</span> ` : nothing
        }${c}</th>`,
    )
  }</tr></thead>
<tbody>${
    rows.map(
      (row, index) =>
        html`<tr data-panel=${props.panel ?? ''} data-row=${String(index)}>${
          cols.map(
            (c) =>
              html`<td class=${
                typeof row[c] === 'number' ? 'vb-num' : ''
              } data-col=${c} title=${formulas[c] ? `= ${formulas[c]}` : ''}>${formatCell(props, row[c], c)}</td>`,
          )
        }</tr>`,
    )
  }</tbody></table>
${
  sheet.totals?.length
    ? html`<table class="vb-totals"><thead><tr><th></th>${
        (sheet.scenarios?.length ? sheet.scenarios : ['']).map(
          (s) =>
            html`<th class="vb-num">${
              s
            }</th>`,
        )
      }</tr></thead><tbody>${
        sheet.totals.map(
          (t) =>
            html`<tr><td title=${`= ${t.expr}`}><span class="vb-fx">ƒ</span> ${t.label}</td>${
              t.values.map(
                (v) =>
                  html`<td class="vb-num">${
                    formatCell(props, v.value)
                  }</td>`,
              )
            }</tr>`,
        )
      }</tbody></table>`
    : nothing
}</div>`;
});
