// vindu's theme: tokens for light and dark, the shell's chrome, and A2UI's own variables mapped onto them, so a view's
// cards sit flat in their pane (hairlines, no shadows, tight spacing, aligned figures). Everything is scoped to
// .vindu-theme; the shell has it, and mountView adds it with { theme: true }. data-theme="light" or "dark" pins a mode;
// without it the system's preference decides. Every token is a CSS variable (--v-accent, --v-font, …): a host changes
// them with mountShell's tokens, or with its own CSS.
const LIGHT = '--v-desk:#f1f0ec;--v-pane:#fcfcfb;--v-head:#f6f5f1;--v-line:#d6d5cf;--v-hair:#e7e6e0;--v-ink:#0b0b0b;--v-ink-2:#52514e;--v-muted:#898781;--v-accent:#2a78d6;--v-wash:rgba(11,11,11,.055);color-scheme:light;';
const DARK = '--v-desk:#0d0d0d;--v-pane:#1a1a19;--v-head:#151514;--v-line:#353533;--v-hair:#2a2a28;--v-ink:#f0efec;--v-ink-2:#c3c2b7;--v-muted:#898781;--v-accent:#3987e5;--v-wash:rgba(255,255,255,.07);color-scheme:dark;';

import { captionSize, headingSize, rhythm, space, typeSize } from './metrics.js';
import { PRIMITIVE_METRICS_CSS } from './primitive-metrics.js';
import { BLOCKS_CSS } from './blocks-css.js';
import { CARDS_CSS } from './shell-cards-css.js';
import { WEEK_CSS } from './blocks/week-css.js';
export const THEME_CSS = `
.vindu-theme{${LIGHT}
  --a2ui-color-background:var(--v-pane);--a2ui-color-on-background:var(--v-ink);--a2ui-color-surface:var(--v-pane);--a2ui-color-on-surface:var(--v-ink);
  --a2ui-color-primary:var(--v-accent);--a2ui-color-border:var(--v-hair);--a2ui-text-caption-color:var(--v-muted);
  --a2ui-font-size:${typeSize(13)};--a2ui-font-scale:1.18;--a2ui-spacing-m:${space(8)};
  --a2ui-card-padding:${rhythm(10)} ${space(12)};--a2ui-card-margin:0;--a2ui-card-box-shadow:none;--a2ui-card-border-radius:var(--v-radius);--a2ui-card-border:1px solid var(--v-hair);--a2ui-card-background:var(--v-pane);
  --a2ui-list-padding:0;--a2ui-list-gap:0;--a2ui-column-gap:${rhythm(10)};--a2ui-row-gap:${space(10)};--a2ui-tabs-border:1px solid var(--v-hair);
  --v-font:system-ui,-apple-system,"Segoe UI",sans-serif;--v-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--v-radius:6px;
  --a2ui-font-family-title:var(--v-font);
  font:${typeSize(13)}/1.45 var(--v-font);color:var(--v-ink);
}
.vindu-theme[data-theme="dark"]{${DARK}}
@media (prefers-color-scheme: dark){.vindu-theme:not([data-theme="light"]){${DARK}}}
.vindu-theme .a2ui-text-caption em{font-style:normal}
.vindu-theme .a2ui-text h4{font-size:${headingSize(12)};font-weight:600;color:var(--v-ink-2);letter-spacing:.01em}
.vindu-theme .a2ui-text h2{font-size:${headingSize(22)};font-weight:600;letter-spacing:-.01em}
.vindu-theme .a2ui-text-body{max-width:75ch;white-space:pre-line}
.vindu-theme a2ui-surface{font-variant-numeric:tabular-nums}
.vindu-theme a2ui-list .a2ui-list{border-top:1px solid var(--v-hair)}
.vindu-theme a2ui-list .a2ui-list-item-none{padding:${rhythm(5)} 0;border-bottom:1px solid var(--v-hair)}
.vindu-theme a2ui-list .a2ui-list-item-none:last-child{border-bottom:0}
.vindu-theme a2ui-basic-row>a2ui-basic-text>.a2ui-text{min-width:0;overflow-wrap:anywhere}
@supports (min-width:calc-size(min-content, size)){ /* a cell keeps its longest word whole, up to 12 characters; longer ones may break */
  .vindu-theme a2ui-basic-row>a2ui-basic-text>.a2ui-text{overflow-wrap:break-word;min-width:calc-size(min-content, min(size, 12ch))}}
.vindu-theme a2ui-image .a2ui-image{width:100%;max-width:760px}

.vindu-shell{--vindu-bar-height:max(${rhythm(24)},${typeSize(18)});position:relative;width:100%;height:100%;overflow:hidden;background:var(--v-pane)}
.vindu-desk{position:absolute;inset:0 0 var(--vindu-bar-height) 0;background:var(--v-line)}
.vindu-shell[data-mode="single"] .vindu-desk,.vindu-shell[data-mode="empty"] .vindu-desk{background:var(--v-desk)}
.vindu-shell[data-mode="single"] .vindu-desk{display:flex;align-items:center;justify-content:flex-start}
.vindu-shell[data-mode="stacked"] .vindu-desk{overflow-y:auto;background:var(--v-pane)}
.vindu-pane{position:absolute;box-sizing:border-box;display:flex;flex-direction:column;background:var(--v-pane);overflow:clip;min-width:0}
.vindu-pane[hidden]{display:none}
.vindu-shell[data-mode="single"] .vindu-pane{position:relative;border:1px solid var(--v-line);border-radius:calc(var(--v-radius) + 2px)}
.vindu-shell[data-mode="stacked"] .vindu-pane{position:relative;border-bottom:1px solid var(--v-line)}
.vindu-pane-head{flex:none;height:max(${rhythm(28)},${typeSize(20)});box-sizing:border-box;display:flex;align-items:center;gap:${space(8)};padding:0 ${space(4)} 0 ${space(12)};background:var(--v-head);border-bottom:1px solid var(--v-hair);font-size:${typeSize(12)};user-select:none;-webkit-user-select:none}
.vindu-shell[data-mode="stacked"] .vindu-pane-head{position:sticky;top:0;z-index:1}
.vindu-pane-title{flex:none;max-width:70%;font-weight:600;color:var(--v-ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vindu-pane[data-focus] .vindu-pane-title{color:var(--v-ink)}
.vindu-pane[data-focus] .vindu-pane-head{box-shadow:inset 0 2px 0 var(--v-accent)}
.vindu-pane-sub{flex:1;min-width:0;color:var(--v-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vindu-pane-mark{display:inline-flex;align-items:center;gap:${space(4)};min-width:0;font-size:${captionSize(11.5)};color:var(--v-ink-2)}.vindu-pane-mark[hidden]{display:none}
.vindu-mark-text{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:28ch}
.vindu-pane-mark button.vindu-act-text{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;height:max(${rhythm(20)},${typeSize(16)});padding:0 ${space(7)};border-radius:4px;border:1px solid var(--v-line);color:var(--v-ink);cursor:pointer;white-space:nowrap}
.vindu-pane-mark button.vindu-act-text:hover{background:var(--v-wash)}
.vindu-pane-mark button.vindu-act-text:focus-visible{outline:2px solid var(--v-accent);outline-offset:-2px}
.vindu-pane-tools{flex:none;display:flex;gap:${space(2)};opacity:0;transition:opacity .12s}
.vindu-pane:hover .vindu-pane-tools,.vindu-pane:focus-within .vindu-pane-tools{opacity:1}
@media (hover:none){.vindu-pane-tools{opacity:1}}
.vindu-pane-tools button{all:unset;box-sizing:border-box;width:max(${space(22)},${typeSize(17)});height:max(${rhythm(22)},${typeSize(17)});display:grid;place-items:center;border-radius:4px;color:var(--v-muted);cursor:pointer}
.vindu-pane-tools button:hover{background:var(--v-wash);color:var(--v-ink)}
.vindu-pane-tools button:focus-visible{outline:2px solid var(--v-accent);outline-offset:-2px}
.vindu-pane-tools svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.vindu-pane-body{flex:1;min-height:0;overflow:auto;padding:${rhythm(12)} ${space(14)} ${rhythm(16)};scrollbar-width:thin;scrollbar-color:var(--v-line) transparent}
.vindu-pane-body:focus{outline:none}
.vindu-pane-body[data-fill]{padding:0;overflow:hidden}
.vindu-pane-body[data-host]{display:flex;flex-direction:column}
.vindu-shell[data-mode="stacked"] .vindu-pane-body[data-host]{height:60vh}
.vindu-viewbar{flex:none;display:flex;gap:${space(6)};align-items:center;flex-wrap:wrap;padding:${rhythm(4)} ${space(8)};border-bottom:1px solid var(--v-hair);font-size:${typeSize(12)};color:var(--v-ink-2)}
.vindu-viewbar button{font:inherit;min-width:28px}
.vindu-share{display:inline-flex;gap:${space(4)};align-items:center;white-space:nowrap}
.vindu-address{flex:1;min-width:140px;font:inherit}
.vindu-note{color:var(--v-muted)}
.vindu-viewbar .vindu-point{margin-left:auto}
.vindu-viewbar .vindu-point[aria-pressed="true"]{background:var(--v-accent);color:var(--v-pane);border-color:var(--v-accent)}
.vindu-term,.vindu-slot{flex:1;min-height:0;position:relative}
.vindu-slot:focus{outline:none}.vindu-slot:focus-visible{outline:2px solid var(--v-accent);outline-offset:-2px}
.vindu-term{padding:${rhythm(4)} 0 0 ${space(6)}}
.vindu-term .xterm{height:100%}
.vindu-term .xterm .xterm-viewport{background-color:transparent;scrollbar-width:none}
.vindu-pane-body[data-fill] .a2ui-card{border:0;border-radius:0;padding:0}
.vindu-pane-body[data-fill] .a2ui-tab-bar{padding:0 ${space(12)}}
.vindu-shell[data-mode="stacked"] .vindu-pane-body{overflow:visible}
.vindu-pane-wait{color:var(--v-muted)}
.vindu-loading{display:flex;flex-direction:column;gap:${rhythm(12)};padding:${rhythm(9)} 0 ${rhythm(16)};color:var(--v-ink-2)}
.vindu-loading p{margin:0;font-size:${typeSize(12)}}
.vindu-skeleton{height:${typeSize(12)};width:min(38ch,90%);border-radius:4px;background:var(--v-wash)}
.vindu-skeleton:nth-of-type(2){width:min(30ch,75%)}
.vindu-skeleton:nth-of-type(3){width:min(22ch,60%)}
.vindu-stack-tabs{flex:1;min-width:0;display:flex;align-items:stretch}
.vindu-stack{position:absolute;box-sizing:border-box;display:flex;align-items:stretch;background:var(--v-head);border-bottom:1px solid var(--v-hair);font-size:${typeSize(12)};user-select:none;-webkit-user-select:none}
.vindu-tab{all:unset;box-sizing:border-box;flex:1 1 0;min-width:0;display:flex;align-items:center;gap:${space(6)};padding:0 ${space(10)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--v-muted);cursor:pointer;border-right:1px solid var(--v-hair)}
.vindu-tab:hover{background:var(--v-wash);color:var(--v-ink)}
.vindu-tab[aria-selected="true"]{background:var(--v-pane);color:var(--v-ink);font-weight:600;box-shadow:inset 0 2px 0 var(--v-accent)}
.vindu-tab[data-changed]::after,.vindu-tab[data-asks]::after{content:"";flex:none;width:6px;height:6px;border-radius:50%;background:var(--v-accent)}
.vindu-tab[data-asks]{color:var(--v-ink)}
.vindu-tab:focus-visible,.vindu-spread:focus-visible{outline:2px solid var(--v-accent);outline-offset:-2px}
.vindu-spread{all:unset;box-sizing:border-box;flex:none;padding:0 ${space(10)};display:flex;align-items:center;color:var(--v-muted);cursor:pointer}
.vindu-spread:hover{background:var(--v-wash);color:var(--v-ink)}
.vindu-pane-tools button[hidden]{display:none}
.vindu-line{position:absolute;z-index:2;outline:none;touch-action:none;transition:background-color .1s}
.vindu-line::before{content:"";position:absolute;inset:0 -3px}
.vindu-line[data-dir="column"]::before{inset:-3px 0}
.vindu-line[data-dir="row"]{cursor:col-resize}
.vindu-line[data-dir="column"]{cursor:row-resize}
.vindu-line:hover{background:var(--v-accent);transition-delay:.25s}
.vindu-line:focus-visible,.vindu-line.is-drag{background:var(--v-accent);transition-delay:0s}
.vindu-shell.is-dragging{user-select:none;-webkit-user-select:none}
.vindu-shell.is-dragging iframe{pointer-events:none}
.vindu-empty{position:absolute;inset:0 0 var(--vindu-bar-height) 0;display:grid;place-items:center;color:var(--v-muted)}
.vindu-empty[hidden]{display:none}
.vindu-bar{position:absolute;left:0;right:0;bottom:0;height:var(--vindu-bar-height);box-sizing:border-box;display:flex;align-items:center;gap:${space(12)};padding:0 ${space(6)};background:var(--v-head);border-top:1px solid var(--v-line);font:${typeSize(11)}/1 var(--v-mono);color:var(--v-muted)}
.vindu-bar-views{flex:0 1 auto;min-width:0;display:flex;gap:${space(2)};overflow-x:auto;scrollbar-width:none}
.vindu-bar-space{flex:1}
.vindu-bar-view{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;gap:${space(6)};height:max(${rhythm(20)},${typeSize(16)});max-width:240px;padding:0 ${space(8)};border-radius:4px;white-space:nowrap;cursor:pointer;color:var(--v-ink-2)}
.vindu-bar-view::before{content:"";flex:none;width:6px;height:6px;border-radius:1px;background:var(--v-muted)}
.vindu-bar-view>span{overflow:hidden;text-overflow:ellipsis}
.vindu-bar-view:hover{background:var(--v-wash)}
.vindu-bar-view:focus-visible{outline:2px solid var(--v-accent);outline-offset:-2px}
.vindu-bar-view.is-focus{background:var(--v-wash);color:var(--v-ink)}
.vindu-bar-view.is-focus::before{background:var(--v-accent)}
.vindu-bar-views:empty{display:none}
.vindu-bar-shelf{flex:0 1 auto;min-width:0;display:flex;gap:${space(2)};overflow-x:auto;scrollbar-width:none;padding-left:${space(8)};border-left:1px solid var(--v-line)}
.vindu-bar-views:empty+.vindu-bar-shelf{padding-left:0;border-left:0}
.vindu-bar-shelf:empty{display:none}
.vindu-bar-view.is-collapsed::before{background:transparent;box-shadow:inset 0 0 0 1px var(--v-muted)}
.vindu-bar-view.is-updated::after{content:"";flex:none;width:5px;height:5px;border-radius:50%;background:var(--v-accent)}
.vindu-bar.is-drop{background:color-mix(in srgb,var(--v-accent) 12%,var(--v-head))}
.vindu-bar-mode{flex:none;white-space:nowrap}
.vindu-shell .vindu-pane.is-peek{position:absolute;margin-left:0;z-index:5;border:1px solid color-mix(in srgb,var(--v-ink) 22%,var(--v-pane));border-radius:calc(var(--v-radius) + 2px);box-shadow:0 16px 40px rgba(0,0,0,.24),0 2px 6px rgba(0,0,0,.1)}
.vindu-pane.is-peek .vindu-pane-head{cursor:pointer}
.vindu-pane.is-peek .vindu-pane-tools{display:none}
.vindu-pane.is-peek .vindu-pane-open{all:unset;display:inline-flex;align-items:center;flex:none;height:max(${rhythm(20)},${typeSize(16)});padding:0 ${space(9)};border-radius:4px;color:var(--v-accent);font-weight:600;cursor:pointer}
.vindu-pane.is-peek .vindu-pane-open:hover{background:var(--v-wash)}
.vindu-pane.is-peek .vindu-pane-open:focus-visible{outline:2px solid var(--v-accent);outline-offset:-2px}
.vindu-drop{position:absolute;z-index:4;box-sizing:border-box;pointer-events:none;background:color-mix(in srgb,var(--v-accent) 14%,transparent);border:1px solid var(--v-accent);border-radius:2px}
.vindu-drop[hidden]{display:none}
.vindu-ghost{position:absolute;left:0;top:0;z-index:6;pointer-events:none;max-width:240px;padding:${rhythm(3)} ${space(8)};border:1px solid var(--v-line);border-radius:4px;background:var(--v-head);color:var(--v-ink);font:${typeSize(11)}/1.4 var(--v-font);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 4px 14px rgba(0,0,0,.14)}
.vindu-shell.is-docking{cursor:grabbing;user-select:none;-webkit-user-select:none}
.vindu-shell.is-docking iframe{pointer-events:none}
.vindu-bar-rem{all:unset;box-sizing:border-box;flex:none;display:inline-flex;align-items:center;gap:${space(6)};height:max(${rhythm(20)},${typeSize(16)});padding:0 ${space(8)};border-radius:4px;white-space:nowrap;cursor:pointer;color:var(--v-ink-2)}
.vindu-bar-rem[hidden]{display:none}
.vindu-bar-rem::before{content:"";flex:none;width:6px;height:6px;border-radius:50%;box-shadow:inset 0 0 0 1px var(--v-muted)}
.vindu-bar-rem:hover{background:var(--v-wash);color:var(--v-ink)}
.vindu-bar-rem:focus-visible{outline:2px solid var(--v-accent);outline-offset:-2px}
.vindu-bar-rem.is-due{background:var(--v-accent);color:var(--v-pane)}
.vindu-bar-rem.is-due::before{background:var(--v-pane);box-shadow:none}
.vindu-bar-actions{flex:none;display:flex;gap:${space(2)}}
.vindu-bar-actions button,.vindu-pane-tools button.vindu-act-text{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;gap:${space(5)};height:max(${rhythm(20)},${typeSize(16)});padding:0 ${space(8)};border-radius:4px;color:var(--v-ink-2);cursor:pointer;white-space:nowrap}
.vindu-pane-tools button.vindu-act-text{height:max(${rhythm(22)},${typeSize(17)});font-size:${typeSize(11.5)}}
.vindu-bar-actions button:hover,.vindu-pane-tools button.vindu-act-text:hover{background:var(--v-wash);color:var(--v-ink)}
.vindu-bar-actions button:focus-visible{outline:2px solid var(--v-accent);outline-offset:-2px}
.vindu-bar-actions svg{width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:1.5;vertical-align:-2px}
`;

/** Styles belong to the document containing the mount (including a host iframe). */
function stylesheet(doc: Document, name: string, css: string): void {
  if (doc.head.querySelector(`style[data-vindu="${name}"]`)) return;
  const style = doc.createElement('style');
  style.dataset.vindu = name;
  style.textContent = css;
  doc.head.append(style);
}

export function useTheme(doc: Document = document): void {
  stylesheet(doc, 'theme', THEME_CSS + BLOCKS_CSS + WEEK_CSS + CARDS_CSS);
}

/** Standalone views can opt into sizing without loading the shell's theme. */
export function useMetricStyles(doc: Document): void {
  stylesheet(doc, 'metrics', PRIMITIVE_METRICS_CSS);
}
