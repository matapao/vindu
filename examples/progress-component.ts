// The window's side of the progress card: a component in Vindu's catalog, drawn with Lit from the exact rows Vindu
// binds to it. It uses the shell's tokens (--v-accent, --v-hair, …), so it follows whatever look the host gives the shell.
import { css, defineComponent, html } from '@matapao/vindu';

export const Progress = defineComponent({
  name: 'Progress', tag: 'x-progress',
  props: { rows: 'value', label: 'string', done: 'string', total: 'string' },
  styles: css` /* scoped to x-progress by Lit */
    :host { display: block; }
    .row { display: grid; grid-template-columns: minmax(0, 16ch) 1fr 11ch; gap: 12px; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--v-hair); }
    .row:last-child { border-bottom: 0; }
    .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .track { display: block; height: 6px; border-radius: 3px; background: var(--v-wash); overflow: hidden; }
    .fill { display: block; height: 100%; border-radius: 3px; background: var(--v-accent); }
    .n { text-align: right; font-variant-numeric: tabular-nums; color: var(--v-ink-2); font-size: 12px; }
  `,
  render: p => html`${(p.rows as Record<string, unknown>[]).map(r => {
    const done = Number(r[p.done]), total = Number(r[p.total]), share = Math.max(0, Math.min(1, done / total));
    return html`<div class="row" role="meter" aria-label=${String(r[p.label])} aria-valuemin="0" aria-valuemax=${total} aria-valuenow=${done}>
      <span class="name">${String(r[p.label])}</span>
      <span class="track"><span class="fill" style="width:${(share * 100).toFixed(1)}%"></span></span>
      <span class="n">${done.toLocaleString('en-GB')} / ${total.toLocaleString('en-GB')}</span>
    </div>`;
  })}`,
});
