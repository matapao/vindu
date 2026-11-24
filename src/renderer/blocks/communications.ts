import { html, nothing } from 'lit';
import {
  type BlockRow,
  fieldValue,
  formatCell,
  formatTime,
  plainText,
  rowContainer,
  displayNames,
  defineBlock,
} from './shared.js';
import { markdownDocument } from './markdown.js';
import { messageDraft } from './message-draft.js';
import { asText } from '../../format.js';

export const VMessages = defineBlock('VMessages', 'vindu-messages', { draft: 'value', words: 'value' }, (props, element) => {
  if (props.layout === 'draft') return messageDraft(props, element); // a mail for the person to send
  const rows = props.rows;
  const header = (row: BlockRow) =>
    html`<div class="vb-meta"><b>${
      displayNames(fieldValue(props, row, 'from')).join(', ')
    }</b>${
      fieldValue(props, row, 'to') !== undefined
        ? html` → ${
            displayNames(fieldValue(props, row, 'to')).join(', ')
          }`
        : nothing
    }${
      fieldValue(props, row, 'cc') !== undefined
        ? html` · cc ${
            displayNames(fieldValue(props, row, 'cc')).join(', ')
          }`
        : nothing
    }<span class="vb-when">${
      formatTime(props, fieldValue(props, row, 'time'))
    }</span></div>`;
  const files = (row: BlockRow) => {
    const names = displayNames(fieldValue(props, row, 'attachments'));
    return names.length
      ? html`<div class="vb-chips">${names.map((x) => html`<span class="vb-chip">${x}</span>`)}</div>`
      : nothing;
  };
  if (props.layout === 'inbox')
    return html`<div class="vb-list">${
      rows.map((row, index) =>
        rowContainer(
          props,
          index,
          'vb-item vb-inbox',
          html`<span class="vb-from">${
            displayNames(fieldValue(props, row, 'from')).join(', ')
          }</span><span class="vb-subj">${
            formatCell(
              props,
              fieldValue(props, row, 'subject') ?? plainText(fieldValue(props, row, 'body')).slice(0, 90),
            )
          }</span><span class="vb-when">${
            formatTime(props, fieldValue(props, row, 'time'))
          }</span>`,
          /unread|new|false/i.test(asText(fieldValue(props, row, 'state') ?? '')) ? 'vb-unread' : '',
        ),
      )
    }</div>`;
  if (props.layout === 'thread')
    return html`<div class="vb-list">${
      rows.map((row, index) =>
        rowContainer(
          props,
          index,
          'vb-item vb-msg',
          html`${header(row)}<div class="vb-body">${
            plainText(fieldValue(props, row, 'body'))
          }</div>${files(row)}`,
        ),
      )
    }</div>`;
  const row = rows[0];
  return rowContainer(
    props,
    0,
    'vb-msg',
    html`${
      fieldValue(props, row, 'subject') !== undefined
        ? html`<div class="vb-title">${
            formatCell(props, fieldValue(props, row, 'subject'))
          }</div>`
        : nothing
    }${header(row)}<div class="vb-body">${
      plainText(fieldValue(props, row, 'body'))
    }</div>${files(row)}`,
  );
});

// a document of sections, or one read from a Markdown file, which is drawn from its blocks (markdown.ts)
export const VDocument = defineBlock(
  'VDocument',
  'vindu-document',
  { file: 'value' },
  (props) =>
    props.rows.some((row) => Array.isArray(row.__blocks)) ? markdownDocument(props) : html`<div class="vb-doc">${props.rows.map((row, index) => {
      const level = Number(fieldValue(props, row, 'level') ?? 1);
      const anchor = fieldValue(props, row, 'anchor');
      const heading = fieldValue(props, row, 'heading');
      const changes = row.__changes as { op: string; t: string }[] | undefined;
      const body = changes
        ? changes.map((c) =>
            c.op === '+' ? html`<ins>${c.t}</ins>` : c.op === '-' ? html`<del>${c.t}</del>` : c.t,
          )
        : formatCell(props, fieldValue(props, row, 'text'));
      const sources = displayNames(fieldValue(props, row, 'sources'));
      return rowContainer(
        props,
        index,
        'vb-sec',
        html`${
          heading !== undefined || anchor !== undefined
            ? html`<div class=${
                `vb-h vb-h${Math.min(3, Math.max(1, level))}`
              }>${
                anchor !== undefined
                  ? html`<span class="vb-anchor">§ ${
                      formatCell(props, anchor)
                    }</span>`
                  : nothing
              }${
                heading !== undefined ? formatCell(props, heading) : nothing
              }${
                fieldValue(props, row, 'page') !== undefined
                  ? html`<span class="vb-when">p. ${
                      formatCell(props, fieldValue(props, row, 'page'))
                    }</span>`
                  : nothing
              }</div>`
            : nothing
        }<div class="vb-body">${body}</div>${
          sources.length
            ? html`<div class="vb-chips">${
                sources.map(
                  (s) =>
                    html`<span class="vb-chip vb-src">${
                      s
                    }</span>`,
                )
              }</div>`
            : nothing
        }`,
        row.__gone ? 'vb-gone' : row.__new ? 'vb-new' : '',
      );
    })}</div>`,
);
