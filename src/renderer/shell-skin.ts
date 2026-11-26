// The shell's own look (shell.ts): the host's tokens as a stylesheet scoped to this shell, and its metrics (sizes and
// fonts) on its root, given again at any time; the fonts its frames are told of when they change.
import { appFontVariables, setMetrics, type ViewMetrics } from './metrics.js';
import { skinCss, type ShellSkin } from './shell-options.js';
import { useMetricStyles } from './theme.js';
import type { elementsOf } from './dom.js';

/** The skin of one shell: its tokens (again with tokens), its metrics (again with metrics, which says the fonts its
 *  frames are to be told of when they changed, an empty value for one taken away), and its stylesheet removed. */
export function shellSkin(d: {
  doc: Document;
  make: ReturnType<typeof elementsOf>;
  root: HTMLElement;
  skinId: string;
  css: boolean;
  tokens?: ShellSkin;
  metrics: ViewMetrics;
}) {
  const { doc, make, root, skinId } = d;
  const skin = make('style');
  skin.dataset.vindu = 'skin';
  const tokens = (t: ShellSkin = {}) => {
    skin.textContent = skinCss(`.vindu-shell.vindu-theme[data-vindu-skin="${skinId}"]`, t);
  };
  tokens(d.tokens);
  doc.head.append(skin);
  const applyMetrics = (value: ViewMetrics) => {
    const reset = setMetrics(root, value);
    if (root.dataset.vinduMetrics && d.css) useMetricStyles(doc);
    return reset;
  };
  let resetMetrics = applyMetrics(d.metrics);
  return {
    tokens,
    metrics(value: ViewMetrics): Record<string, string> | undefined {
      const previous = appFontVariables(root);
      resetMetrics();
      resetMetrics = applyMetrics(value);
      const variables = appFontVariables(root);
      // An empty CSS value removes an override from an already initialized frame.
      for (const key of Object.keys(previous)) if (!(key in variables)) variables[key] = '';
      return Object.keys(variables).some((key) => variables[key] !== previous[key]) ? variables : undefined;
    },
    remove: () => skin.remove(),
  };
}
