// Hosts size their own mount. The arguments to these CSS helpers are the stock sizes in pixels.
export type ViewMetrics = {
  /** Base spacing step, in px or rem. Defaults to 8px. */
  spacing?: string;
  /** Base text size, in px or rem. Omit to keep the renderer's original type scale. */
  fontSize?: string;
  /** Independent reference size for headings (22px on the stock scale). */
  headingSize?: string;
  /** Independent reference size for captions and secondary labels (12px on the stock scale). */
  captionSize?: string;
  /** Multiplier for vertical gaps and padding. Defaults to 1. */
  density?: number;
};

export const space = (px: number) => `calc(var(--v-spacing, 8px) * ${px} / 8)`;
export const rhythm = (px: number) => `calc(var(--v-spacing, 8px) * ${px} / 8 * var(--v-density, 1))`;
export const typeSize = (px: number) => `calc(var(--v-font-size, 13px) * ${px} / 13)`;

export const headingSize = (px: number) => `calc(var(--v-heading-size, ${typeSize(22)}) * ${px} / 22)`;
export const captionSize = (px: number) => `calc(var(--v-caption-size, ${typeSize(12)}) * ${px} / 12)`;

const variables = {
  headingSize: '--v-heading-size',
  captionSize: '--v-caption-size',
  spacing: '--v-spacing',
  fontSize: '--v-font-size',
  density: '--v-density',
} as const;
const keys = Object.keys(variables) as (keyof ViewMetrics)[];

// Use CSSOM on this element. Preserve host-owned inline styles when a mount is reset or removed.
export function setMetrics(root: HTMLElement, metrics: ViewMetrics): () => void {
  const previousFlag = root.getAttribute('data-vindu-metrics');
  const previous = new Map<string, { value: string; priority: string }>();
  const enabled: string[] = [];
  for (const key of keys) {
    const value = metrics[key];
    if (key === 'density') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
    } else {
      // Element-relative units would resolve again inside every descendant.
      if (typeof value !== 'string' || !/^(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem)$/i.test(value.trim())) continue;
      if (key !== 'spacing' && parseFloat(value) === 0) continue;
    }

    const name = variables[key];
    previous.set(name, { value: root.style.getPropertyValue(name), priority: root.style.getPropertyPriority(name) });
    root.style.setProperty(name, String(value));
    enabled.push(key);
  }
  if (!enabled.length) return () => {};
  root.dataset.vinduMetrics = enabled.join(' ');
  return () => {
    for (const [name, { value, priority }] of previous) root.style.setProperty(name, value, priority);
    if (previousFlag === null) delete root.dataset.vinduMetrics;
    else root.setAttribute('data-vindu-metrics', previousFlag);
  };
}

// MCP Apps interpret rem against their own document. Send the host's resolved pixel sizes instead.
const appFonts = {
  fontSize: '--font-text-md-size',
  headingSize: '--font-heading-md-size',
  captionSize: '--font-text-sm-size',
} as const;
export function appFontVariables(root: HTMLElement): Record<string, string> {
  const result: Record<string, string> = {};
  const enabled = root.dataset.vinduMetrics?.split(' ') ?? [];
  for (const key of Object.keys(appFonts) as (keyof typeof appFonts)[]) {
    if (!enabled.includes(key)) continue;
    const value = root.style.getPropertyValue(variables[key]).trim().toLowerCase();
    const view = root.ownerDocument.defaultView ?? window;
    const unit = value.endsWith('rem')
      ? parseFloat(view.getComputedStyle(root.ownerDocument.documentElement).fontSize)
      : 1;
    const px = parseFloat(value) * unit;
    if (Number.isFinite(px)) result[appFonts[key]] = `${px}px`; // a variable the host cleared since says nothing
  }
  return result;
}
