import { html, nothing } from 'lit';
import { ref } from 'lit/directives/ref.js';
import { CHART_LEFT, CHART_RIGHT, chartSvg } from '../../chart-svg.js';
import { defineComponent } from '../define.js';
import { chartFontGauge } from '../chart-source.js';
import { localeHere } from '../locale-here.js';
import { pictureSchemes } from '../picture-sources.js';
import { type BlockProps, type BlockRow, rowContainer, imageSource } from './shared.js';

export const VMediaMarks = defineComponent({
  name: 'VMediaMarks',
  tag: 'vindu-media-marks',
  props: { url: 'string', kind: 'string', marks: 'value', panel: 'string' },
  render: (props: Record<string, unknown>, element: HTMLElement) => {
    const marks = (props.marks ?? []) as BlockRow[];
    // a picture from http(s), the host's own schemes or its data; sound and video from an http(s) address only
    const url =
      props.kind === 'image'
        ? imageSource(props.url, undefined, pictureSchemes(element))
        : imageSource(props.url, /^$/);
    if (props.kind === 'image')
      return html`<div class="vb-marked"><img src=${url} alt="">${marks.map((mark, index) =>
        'x' in mark
          ? html`<div class="vb-region" data-panel=${props.panel ?? ''} data-row=${String(index)} style=${`left:${Number(mark.x) * 100}%;top:${Number(mark.y) * 100}%;width:${Number(mark.w ?? 0) * 100}%;height:${Number(mark.h ?? 0) * 100}%`}><span>${mark.label ?? index + 1}</span></div>`
          : nothing,
      )}</div>`;
    const playFrom = (e: Event, t: number) => {
      const media = (e.currentTarget as HTMLElement)
        .closest('.vb-marked')
        ?.querySelector('audio,video') as HTMLMediaElement | null;
      if (media && Number.isFinite(t)) {
        // a mark with no start has nowhere to play from
        media.currentTime = t;
        void media.play().catch(() => undefined);
      }
    };
    return html`<div class="vb-marked">${
      props.kind === 'video' ? html`<video src=${url} controls></video>` : html`<audio src=${url} controls></audio>`
    }<div class="vb-list">${marks.map((mark, index) =>
      rowContainer(
        props as BlockProps,
        index,
        'vb-item',
        html`<button class="vb-btn" @click=${(e: Event) =>
          playFrom(e, Number(mark.start))}>${clockOf(Number(mark.start))}${
          mark.end !== undefined ? `–${clockOf(Number(mark.end))}` : ''
        }</button><span>${mark.label ?? ''}</span>`,
      ),
    )}</div></div>`;
  },
});
const clockOf = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** What the window draws a chart again from: the card, its rows (x and the series alone), and the view's locale. */
type ChartSpec = { kind: string; rows: BlockRow[]; x: string; ys: string[]; locale?: string; timeZone?: string };
const specOf = (v: unknown): ChartSpec | undefined => {
  const s = v as Partial<ChartSpec> | undefined;
  return s &&
    typeof s.kind === 'string' &&
    typeof s.x === 'string' &&
    Array.isArray(s.rows) &&
    Array.isArray(s.ys) &&
    s.ys.every((y) => typeof y === 'string')
    ? (s as ChartSpec)
    : undefined;
};
/** The width of each chart's box, by its element, once measured; and the boxes measured. */
const widths = new WeakMap<HTMLElement, number>();
const measuring = new WeakSet<Element>();
/** Measure a chart's box, and draw the chart again on the frame after its width changes (never inside the observer's
 *  own delivery), once for the last width it had in that frame. */
const measured = (element: HTMLElement) =>
  ref((box) => {
    const win = box?.ownerDocument.defaultView;
    if (!box || !win || measuring.has(box)) return;
    measuring.add(box);
    let frame = 0;
    new win.ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      win.cancelAnimationFrame(frame);
      if (!width || width === widths.get(element)) return;
      frame = win.requestAnimationFrame(() => {
        widths.set(element, width);
        (element as HTMLElement & { requestUpdate(): void }).requestUpdate();
      });
    }).observe(box);
  });

/** A chart: its image, as wide as its box (drawn again here at that width, from the rows the system charted, once it is
 *  measured), with a strip over each category to point at (and, when the chart is of groups, to open). */
export const VChart = defineComponent({
  name: 'VChart',
  tag: 'vindu-chart',
  props: {
    url: 'string',
    spec: 'value',
    bands: 'number',
    left: 'number',
    right: 'number',
    panel: 'string',
    opens: 'boolean',
  },
  render: (props: Record<string, unknown>, element: HTMLElement) => {
    const bandCount = Math.max(0, Number(props.bands) || 0);
    const spec = specOf(props.spec),
      width = widths.get(element);
    const drawn =
      spec && width
        ? chartSvg(spec.kind, spec.rows, spec.x, spec.ys, width, localeHere(spec.locale ?? 'en-GB'), spec.timeZone)
        : undefined;
    const url = drawn ?? imageSource(props.url);
    const [left, right] =
      drawn && width ? [CHART_LEFT / width, CHART_RIGHT / width] : [Number(props.left) || 0, Number(props.right) || 0];
    return html`<div class="vb-chart" ${measured(element)}><img src=${url} alt="chart">${chartFontGauge(url)}<div class="vb-strips" style=${`left:${left * 100}%;right:${right * 100}%`}>${Array.from(
      { length: bandCount },
      (_, index) =>
        html`<div class="vb-strip" data-panel=${props.panel ?? ''} data-row=${String(index)} ?data-opens=${!!props.opens} title=${
          props.opens ? 'Open the rows behind it' : ''
        } role=${props.opens ? 'button' : nothing} tabindex=${props.opens ? '0' : nothing} aria-label=${
          props.opens ? `Open the rows behind category ${index + 1} of ${bandCount}` : nothing
        }></div>`,
    )}</div></div>`;
  },
});
