import { html, svg, nothing } from 'lit';
import { asText, ellipsis } from '../../format.js';
import { fieldValue, formatCell, formatTime, rowContainer, defineBlock, imageSource } from './shared.js';
import { sendBlockAction } from '../dom.js';
import { pictureSchemes } from '../picture-sources.js';

const slideByRows = new WeakMap<object, number>();
const arrows = new WeakMap<object, string>();
let arrowCount = 0;
const arrowOf = (nodes: object) => { let id = arrows.get(nodes); if (!id) arrows.set(nodes, id = `vb-arrow-${++arrowCount}`); return id; };
export const VSlides = defineBlock('VSlides', 'vindu-slides', { at: 'number' }, (props) => {
  // the slide shown is the view's own (at), the same in every window: a step here is an action inside the view
  const rows = props.rows;
  if (!rows.length) return nothing; // no slides to step through
  const index = Math.max(
    0,
    Math.min(
      slideByRows.get(rows) ?? (typeof props.at === 'number' && Number.isInteger(props.at) ? props.at : 0),
      rows.length - 1,
    ),
  );
  const row = rows[index];
  const go = (e: Event, to: number) => {
    const n = Math.max(0, Math.min(rows.length - 1, to));
    slideByRows.set(rows, n);
    sendBlockAction(e.currentTarget as HTMLElement, { type: 'view', action: 'slide', panel: props.panel, to: n });
    (e.currentTarget as HTMLElement).closest<Element & { requestUpdate?(): void }>('vindu-slides')?.requestUpdate?.();
  };
  const points = (v: unknown) =>
    Array.isArray(v)
      ? v.map(String)
      : asText(v ?? '')
          .split(/\n+/)
          .filter(Boolean);
  const slide = html`<div class="vb-slidetitle">${
    formatCell(props, fieldValue(props, row, 'title'))
  }</div>
${
  fieldValue(props, row, 'figure') !== undefined
    ? html`<div class="vb-figure"><div class="vb-big">${
        formatCell(props, fieldValue(props, row, 'figure'))
      }</div>${
        fieldValue(props, row, 'label') !== undefined
          ? html`<div class="vb-muted">${
              formatCell(props, fieldValue(props, row, 'label'))
            }</div>`
          : nothing
      }</div>`
    : nothing
}
<ul>${points(fieldValue(props, row, 'points')).map((x) => html`<li>${x}</li>`)}</ul>`;
  return html`<div class="vb-slides">${rowContainer(props, index, 'vb-slide', slide)}
<div class="vb-nav"><button aria-label="Previous slide" ?disabled=${index === 0} @click=${(e: Event) => go(e, index - 1)}>‹</button><span>${index + 1} / ${rows.length}</span><button aria-label="Next slide" ?disabled=${index === rows.length - 1} @click=${(e: Event) => go(e, index + 1)}>›</button>${
    fieldValue(props, row, 'notes') !== undefined
      ? html`<span class="vb-muted vb-notes">${
          formatCell(props, fieldValue(props, row, 'notes'))
        }</span>`
      : nothing
  }</div></div>`;
});

export const VSignature = defineBlock(
  'VSignature',
  'vindu-signature',
  {},
  (props, element) =>
    html`<div class="vb-list">${props.rows.map((row, index) => {
      const img = imageSource(fieldValue(props, row, 'image'), /^data:image\/(png|svg\+xml);base64,/, pictureSchemes(element));
      return rowContainer(
        props,
        index,
        'vb-item vb-sign',
        html`${
          img
            ? html`<img src=${
                img
              } alt="signature" class="vb-sigimg">`
            : html`<span class="vb-icon">✍</span>`
        }<span><b>${
          formatCell(props, fieldValue(props, row, 'who'))
        }</b>${
          fieldValue(props, row, 'what') !== undefined
            ? html` signed ${
                formatCell(props, fieldValue(props, row, 'what'))
              }`
            : nothing
        }<div class="vb-muted">${
          formatTime(props, fieldValue(props, row, 'when'))
        }${
          fieldValue(props, row, 'digest') !== undefined
            ? html` · ${
                String(fieldValue(props, row, 'digest')).slice(0, 19)
              }…`
            : nothing
        }</div></span>`,
      );
    })}</div>`,
);

export const VDiagram = defineBlock('VDiagram', 'vindu-diagram', { nodes: 'value' }, (props) => {
  const nodes = (props.nodes ?? []) as { id: string; layer: number; order: number }[];
  if (!nodes.length) return nothing; // nothing to draw edges between
  const arrow = arrowOf(nodes); // each diagram's own marker: ids in the light DOM are the whole document's
  const nodeWidth = 150,
    nodeHeight = 34,
    columnGap = 70,
    rowGap = 22;
  const positions = new Map(nodes.map((n) => [n.id, { x: 10 + n.layer * (nodeWidth + columnGap), y: 10 + n.order * (nodeHeight + rowGap) }]));
  const w = Math.max(...nodes.map((n) => positions.get(n.id)!.x)) + nodeWidth + 10,
    h = Math.max(...nodes.map((n) => positions.get(n.id)!.y)) + nodeHeight + 10;
  return html`<div class="vb-diagram"><svg viewBox=${`0 0 ${w} ${h}`} width=${w} height=${h} role="img" aria-label="diagram">${
    svg`<defs><marker id=${arrow} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,1 L10,5 L0,9 z" class="vb-arrowhead"/></marker></defs>
${props.rows.map((row, index) => {
  const a = positions.get(String(fieldValue(props, row, 'from'))),
    b = positions.get(String(fieldValue(props, row, 'to')));
  if (!a || !b) return svg``;
  const x1 = a.x + nodeWidth,
    y1 = a.y + nodeHeight / 2,
    x2 = b.x,
    y2 = b.y + nodeHeight / 2;
  const middleX = (x1 + x2) / 2;
  return svg`<path d=${
    `M${x1},${y1} C${middleX},${y1} ${middleX},${y2} ${x2 - 2},${y2}`
  } class="vb-edge" marker-end=${`url(#${arrow})`} data-panel=${props.panel ?? ''} data-row=${String(index)}/>${
    fieldValue(props, row, 'label') !== undefined
      ? svg`<text x=${middleX} y=${(y1 + y2) / 2 - 4} class="vb-edgelabel" text-anchor="middle">${
          formatCell(props, fieldValue(props, row, 'label'))
        }</text>`
      : svg``
  }`;
})}
${nodes.map((n) => {
  const position = positions.get(n.id)!;
  return svg`<g data-panel=${props.panel ?? ''} data-node=${n.id}><rect x=${position.x} y=${position.y} width=${nodeWidth} height=${nodeHeight} rx="6" class="vb-node"/><text x=${position.x + nodeWidth / 2} y=${position.y + nodeHeight / 2 + 4} text-anchor="middle" class="vb-nodelabel">${
    ellipsis(n.id, 22)
  }</text></g>`;
})}`
  }</svg></div>`;
});
