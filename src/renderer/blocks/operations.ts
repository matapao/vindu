import { html, nothing } from 'lit';
import { changedFields } from '../../changes.js';
import { fieldValue, formatCell, formatTime, rowContainer, displayNames, defineBlock } from './shared.js';
import { sendBlockAction } from '../dom.js';
import { asText } from '../../format.js';

const ON = /^(on|true|yes|enabled|running|active|open|1)$/i;
export const VDevices = defineBlock(
  'VDevices',
  'vindu-devices',
  { operation: 'string' },
  (props) =>
    html`<div class="vb-list">${props.rows.map((row, index) => {
      const state = fieldValue(props, row, 'state');
      const on = state === true || ON.test(asText(state ?? ''));
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
        html`<span class="vb-name">${
          formatCell(props, fieldValue(props, row, 'name'))
        }${
          fieldValue(props, row, 'kind') !== undefined
            ? html`<span class="vb-muted"> · ${
                formatCell(props, fieldValue(props, row, 'kind'))
              }</span>`
            : nothing
        }</span><span class=${`vb-pill ${on ? 'vb-on' : ''}`}>${
          typeof state === 'boolean' ? (state ? 'on' : 'off') : formatCell(props, state)
        }</span>${
          props.operation
            ? html`<button class="vb-btn" aria-label=${`${on ? 'Turn off' : 'Turn on'} ${asText(fieldValue(props, row, 'name') ?? '')}`.trim()} @click=${act}>${
                on ? 'Turn off' : 'Turn on'
              }</button>`
            : nothing
        }`,
      );
    })}</div>`,
);

export const VBatch = defineBlock('VBatch', 'vindu-batch', {}, (props) => {
  const rows = props.rows;
  const countOutcome = (o: string) => rows.filter((row) => row.outcome === o).length;
  return html`<div class="vb-batch"><div class="vb-meta"><b>${countOutcome('ok')} ok</b>${
    countOutcome('failed')
      ? html` · <span class="vb-warn">${
          countOutcome('failed')
        } failed</span>`
      : nothing
  }${
    countOutcome('missing')
      ? html` · ${
          countOutcome('missing')
        } missing`
      : nothing
  } <span class="vb-muted">of ${rows.length}</span></div><div class="vb-list">${
    rows.map((row, index) =>
      rowContainer(
        props,
        index,
        'vb-item vb-call',
        html`<span class=${
          `vb-mark ${row.outcome === 'ok' ? '' : 'vb-warn'}`
        }>${
          row.outcome === 'ok' ? '✓' : row.outcome === 'failed' ? '✗' : '?'
        }</span><span class="vb-anchor">${row.id}</span><span>${row.for || row.call}</span><span class="vb-muted">${row.detail}</span>`,
      ),
    )
  }</div></div>`;
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
        html`<span class="vb-anchor">${
          formatCell(props, fieldValue(props, row, 'key') ?? index + 1)
        }</span><span>${
          pairs.map(
            ([k, x, y]) =>
              html`<div><span class="vb-muted">${k}</span> <del>${
                formatCell(props, x, k)
              }</del> → <ins>${formatCell(props, y, k)}</ins></div>`,
          )
        }</span>`,
      );
    })}</div>`,
);

export const VDecision = defineBlock(
  'VDecision',
  'vindu-decision',
  {},
  (props) =>
    html`${
      props.rows.map((row, index) =>
        rowContainer(
          props,
          index,
          'vb-decision',
          html`<div class="vb-title">${
            formatCell(props, fieldValue(props, row, 'outcome'))
          }</div><div class="vb-body">${
            formatCell(props, fieldValue(props, row, 'grounds'))
          }</div>${
            displayNames(fieldValue(props, row, 'sources')).length
              ? html`<div class="vb-chips">${
                  displayNames(fieldValue(props, row, 'sources')).map(
                    (s) =>
                      html`<span class="vb-chip vb-src">${
                        s
                      }</span>`,
                  )
                }</div>`
              : nothing
          }<div class="vb-muted">${
            [
              fieldValue(props, row, 'by') !== undefined
                ? `decided by ${displayNames(fieldValue(props, row, 'by')).join(', ')}`
                : '',
              fieldValue(props, row, 'at') !== undefined
                ? formatTime(props, fieldValue(props, row, 'at'))
                : '',
            ]
              .filter(Boolean)
              .join(' · ')
          }</div>${
            fieldValue(props, row, 'appeal') !== undefined
              ? html`<div class="vb-appeal">${
                  formatCell(props, fieldValue(props, row, 'appeal'))
                }</div>`
              : nothing
          }`,
        ),
      )
    }`,
);
