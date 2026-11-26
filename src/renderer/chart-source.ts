import { html, nothing } from 'lit';
import { guard } from 'lit/directives/guard.js';
import { ref } from 'lit/directives/ref.js';
import { captionSize } from './metrics.js';

const SVG_IMAGE = 'data:image/svg+xml;base64,';
// chartSvg's own image header, including its first style rule. Other images keep their source.
const CHART_HEADER = /^(<svg\b[^>]{1,256} font-size=")(11|12)("><style>\.g\{stroke:)/;

function chartAtSize(source: string, size: number): string {
  if (size === 13) return source;
  try {
    const encoded = source.slice(SVG_IMAGE.length);
    if (!CHART_HEADER.test(atob(encoded.slice(0, 512)))) return source;
    const svg = atob(encoded).replace(
      CHART_HEADER,
      (_, before: string, font: string, after: string) => before + (Number(font) * size) / 13 + after,
    );
    return SVG_IMAGE + btoa(svg);
  } catch {
    return source;
  }
}

// An SVG in an img has its own document. Measure the host's font unit whenever its CSS changes
// and keep the chart an image, including on restored surfaces produced by older versions.
export function chartFontGauge(source: string) {
  if (!source.startsWith(SVG_IMAGE)) return nothing;
  return html`<span aria-hidden="true" style=${`position:absolute;width:${captionSize(13)};height:0;visibility:hidden;pointer-events:none`}
    ${guard([source], () => {
      let observer: ResizeObserver | undefined;
      return ref((gauge) => {
        observer?.disconnect();
        if (!gauge) return;
        observer = new ResizeObserver(([entry]) => {
          const width = entry.contentRect.width;
          const image = gauge.previousElementSibling;
          if (!width || !(image instanceof HTMLImageElement)) return;
          const url = chartAtSize(source, width);
          if (url !== image.getAttribute('src')) image.src = url;
        });
        observer.observe(gauge);
      });
    })}></span>`;
}
