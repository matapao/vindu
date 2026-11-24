import { html, nothing } from 'lit';
import { defineComponent } from '../define.js';
import { chartFontGauge } from '../chart-source.js';
import { type BlockProps, type BlockRow, rowContainer, imageSource } from './shared.js';

export const VMediaMarks = defineComponent({
  name: 'VMediaMarks',
  tag: 'vindu-media-marks',
  props: { url: 'string', kind: 'string', marks: 'value', panel: 'string' },
  render: (props: Record<string, unknown>) => {
    const marks = (props.marks ?? []) as BlockRow[];
    const url = imageSource(props.url, props.kind === 'image' ? undefined : /^$/); // sound and video: from an address only
    if (props.kind === 'image')
      return html`<div class="vb-marked"><img src=${url} alt="">${
        marks.map((mark, index) =>
          'x' in mark
            ? html`<div class="vb-region" data-panel=${props.panel ?? ''} data-row=${String(index)} style=${
                `left:${Number(mark.x) * 100}%;top:${Number(mark.y) * 100}%;width:${Number(mark.w ?? 0) * 100}%;height:${Number(mark.h ?? 0) * 100}%`
              }><span>${mark.label ?? index + 1}</span></div>`
            : nothing,
        )
      }</div>`;
    const playFrom = (e: Event, t: number) => {
      const media = (e.currentTarget as HTMLElement)
        .closest('.vb-marked')
        ?.querySelector('audio,video') as HTMLMediaElement | null;
      if (media && Number.isFinite(t)) { // a mark with no start has nowhere to play from
        media.currentTime = t;
        void media.play().catch(() => undefined);
      }
    };
    return html`<div class="vb-marked">${
      props.kind === 'video'
        ? html`<video src=${
            url
          } controls></video>`
        : html`<audio src=${
            url
          } controls></audio>`
    }<div class="vb-list">${
      marks.map(
        (mark, index) =>
          rowContainer(
            props as BlockProps,
            index,
            'vb-item',
            html`<button class="vb-btn" @click=${
              (e: Event) => playFrom(e, Number(mark.start))
            }>${clockOf(Number(mark.start))}${
              mark.end !== undefined ? `–${clockOf(Number(mark.end))}` : ''
            }</button><span>${mark.label ?? ''}</span>`,
          ),
      )
    }</div></div>`;
  },
});
const clockOf = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** A chart: its image, with a strip over each category to point at (and, when the chart is of groups, to open). */
export const VChart = defineComponent({
  name: 'VChart',
  tag: 'vindu-chart',
  props: {
    url: 'string',
    bands: 'number',
    left: 'number',
    right: 'number',
    panel: 'string',
    opens: 'boolean',
  },
  render: (props: Record<string, unknown>) => {
    const bandCount = Math.max(0, Number(props.bands) || 0);
    const url = imageSource(props.url);
    return html`<div class="vb-chart"><img src=${url} alt="chart">${chartFontGauge(url)}<div class="vb-strips" style=${
      `left:${(Number(props.left) || 0) * 100}%;right:${(Number(props.right) || 0) * 100}%`
    }>${
      Array.from(
        { length: bandCount },
        (_, index) =>
          html`<div class="vb-strip" data-panel=${props.panel ?? ''} data-row=${String(index)} ?data-opens=${!!props.opens} title=${
            props.opens ? 'Open the rows behind it' : ''
          } role=${props.opens ? 'button' : nothing} tabindex=${props.opens ? '0' : nothing} aria-label=${
            props.opens ? `Open the rows behind category ${index + 1} of ${bandCount}` : nothing
          }></div>`,
      )
    }</div></div>`;
  },
});
