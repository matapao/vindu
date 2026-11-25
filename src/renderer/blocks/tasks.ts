import { html, nothing } from 'lit';
import {
  type BlockRow,
  fieldValue,
  formatCell,
  formatTime,
  rowContainer,
  displayNames,
  defineBlock,
} from './shared.js';
import { sendBlockAction } from '../dom.js';
import { BLOCK_WORDS, wordsGiven, wordWith } from '../../block-words.js';
import { asText } from '../../format.js';

/** What a dragged task carries: its own type, so an event dropped on a task is not taken for one. */
const TASK_ROW = 'text/x-vindu-task';

const DONE = /^(done|completed?|closed|resolved|true|yes|✓|ferdig|finished)$/i;
export const VTasks = defineBlock('VTasks', 'vindu-tasks', { order: 'value', words: 'value' }, (props) => {
  const rows = props.rows;
  const words = wordsGiven(props.words, BLOCK_WORDS.tasks);
  const stateOf = (row: BlockRow) => asText(fieldValue(props, row, 'state') ?? '');
  const meta = (row: BlockRow) =>
    html`${
      fieldValue(props, row, 'who') !== undefined
        ? html`<span class="vb-muted"> · ${
            displayNames(fieldValue(props, row, 'who')).join(', ')
          }</span>`
        : nothing
    }${
      fieldValue(props, row, 'due') !== undefined
        ? html`<span class="vb-muted"> · ${
            wordWith(words.due, { date: formatTime(props, fieldValue(props, row, 'due'), false) })
          }</span>`
        : nothing
    }${
      fieldValue(props, row, 'priority') !== undefined
        ? html`<span class="vb-chip">${
            formatCell(props, fieldValue(props, row, 'priority'))
          }</span>`
        : nothing
    }`;
  if (props.layout === 'board') {
    const columns = [
      ...new Set([...(Array.isArray(props.order) ? props.order.map(String) : []), ...rows.map(stateOf)]),
    ];
    return html`<div class="vb-board" style=${`--cols:${columns.length}`}>${
      columns.map(
        (column) =>
          html`<div class="vb-col"><div class="vb-dayhead">${column || '(no state)'} <span class="vb-muted">${
            rows.filter((row) => stateOf(row) === column).length
          }</span></div>${
            rows.map((row, index) =>
              stateOf(row) === column
                ? rowContainer(
                    props,
                    index,
                    'vb-card',
                    html`<div>${
                      formatCell(props, fieldValue(props, row, 'title'))
                    }</div><div>${meta(row)}</div>`,
                  )
                : nothing,
            )
          }</div>`,
      )
    }</div>`;
  }
  // a task is moved by hand: dragged, or Alt and an arrow key; the window sends it as an action inside the view (actions.ts)
  const move = (e: Event, from: number, to: number) =>
    sendBlockAction(e.currentTarget as HTMLElement, { type: 'view', action: 'move', panel: props.panel, from, to });
  const drag = (index: number) => ({
    start: (e: DragEvent) => {
      e.dataTransfer?.setData(TASK_ROW, String(index));
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    },
    over: (e: DragEvent) => {
      if (e.dataTransfer?.types.includes(TASK_ROW)) e.preventDefault();
    },
    drop: (e: DragEvent) => {
      const from = Number(e.dataTransfer?.getData(TASK_ROW));
      e.preventDefault();
      if (Number.isInteger(from) && from !== index) move(e, from, index);
    },
    key: (e: KeyboardEvent) => {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      const to = index + (e.key === 'ArrowUp' ? -1 : 1);
      if (to >= 0 && to < rows.length) move(e, index, to);
    },
  });
  return html`<div class="vb-list">${rows.map((row, index) => {
    const handlers = drag(index);
    const state = stateOf(row);
    const completed = DONE.test(state) || fieldValue(props, row, 'state') === true;
    const mark = props.layout === 'steps' ? `${index + 1}.` : completed ? '☑' : '☐';
    return html`<div class="vb-item vb-task" data-panel=${props.panel ?? ''} data-row=${String(index)} draggable="true" tabindex="0" role="group" aria-roledescription="task you can move" @dragstart=${
      handlers.start
    } @dragover=${handlers.over} @drop=${handlers.drop} @keydown=${handlers.key}>${
      html`<span class="vb-mark">${
        mark
      }</span><span class=${
        completed ? 'vb-done' : ''
      }>${
        formatCell(props, fieldValue(props, row, 'title'))
      }${meta(row)}</span>${
        props.layout === 'steps' && stateOf(row)
          ? html`<span class="vb-chip">${
              stateOf(row)
            }</span>`
          : nothing
      }`
    }</div>`;
  })}</div>`;
});
