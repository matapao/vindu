import { html, nothing } from 'lit';
import { asText, cellIn, whenIn } from '../../format.js';
import { defineComponent, type VinduComponent } from '../define.js';

export type BlockRow = Record<string, unknown>;
export type BlockProps = {
  rows?: BlockRow[];
  map?: Record<string, string>;
  layout?: string;
  locale?: string;
  timeZone?: string;
  panel?: string;
  at?: number;
  [key: string]: unknown;
};
export type RowBlockProps = BlockProps & { rows: BlockRow[] };

const ROW_PROPS = {
  rows: 'value',
  map: 'value',
  layout: 'string',
  locale: 'string',
  timeZone: 'string',
  panel: 'string',
} as const;
export const fieldValue = (props: BlockProps, row: BlockRow, role: string) =>
  props.map?.[role] ? row?.[props.map[role]] : undefined;
export const formatCell = (props: BlockProps, v: unknown, field?: string) => cellIn(v, field, props.locale);
export const formatTime = (props: BlockProps, v: unknown, withTime = true) =>
  whenIn(v, props.locale, props.timeZone, withTime);
export const plainText = (v: unknown): string => {
  // mail bodies may be HTML: shown as text, never run or fetched
  const s = v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  if (!/<[a-z][\s\S]*>/i.test(s)) return s;
  const d = new DOMParser().parseFromString(s, 'text/html');
  d.querySelectorAll('script,style').forEach((e) => e.remove());
  return (d.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
};
export const rowContainer = (
  props: BlockProps,
  index: number,
  className: string,
  body: unknown,
  extra = '',
) =>
  html`<div class=${extra ? `${className} ${extra}` : className} data-panel=${props.panel ?? ''} data-row=${String(index)}>${body}</div>`;
/** A person or a thing by its name, email or title (an object), or as it is written. */
const displayName = (x: unknown): string => {
  if (!x || typeof x !== 'object') return asText(x);
  const o = x as Record<string, unknown>;
  return asText(o.name ?? o.email ?? o.title ?? JSON.stringify(x));
};
/** The people or things a field names: a list of them, or one alone (a sender, an owner). */
export const displayNames = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(displayName) : v === null || v === undefined || v === '' ? [] : [displayName(v)];
/** An address a block draws media from: http or https, or a data: URL of the kinds given (images, base64); '' otherwise. */
export function imageSource(v: unknown, data: RegExp = /^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,/): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (data.test(s)) return s;
  try { return /^https?:$/.test(new URL(s).protocol) ? s : ''; } catch { return ''; }
}
export const emptyMessage = (what: string) => html`<p class="vb-muted">${what}</p>`;
export const defineBlock = (
  name: string,
  tag: string,
  props: Parameters<typeof defineComponent>[0]['props'],
  render: (props: RowBlockProps) => unknown,
): VinduComponent =>
  defineComponent({
    name,
    tag,
    props: { ...ROW_PROPS, ...props },
    render: (x: Record<string, unknown>) => {
      const props = x as BlockProps;
      return props.rows ? render(props as RowBlockProps) : nothing;
    },
  });
