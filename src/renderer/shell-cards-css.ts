// How the shell draws the views as cards (shell-cards.ts): the panes drawn whole one after another, full width, above a
// grid of cards (a list when the window is narrow), the card opened alone as tall as the window, and the shelf's switch
// between cards and content. And a notice: a strip, its title bar left out but for its buttons.
import { captionSize, rhythm, space, typeSize } from './metrics.js';

export const CARDS_CSS = `
.vindu-shell[data-mode="cards"] .vindu-desk{overflow-y:auto;background:var(--v-desk)}
.vindu-shell[data-mode="cards"] .vindu-pane{position:relative;border-bottom:1px solid var(--v-line)}
.vindu-shell[data-mode="cards"] .vindu-pane-head{position:sticky;top:0;z-index:1}
.vindu-shell[data-mode="cards"] .vindu-pane.is-alone{min-height:100%}
.vindu-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,${space(240)}),1fr));gap:${space(12)};padding:${space(16)};align-content:start}
.vindu-cards[hidden]{display:none}
.vindu-cards.is-list{grid-template-columns:1fr;gap:0;padding:0}
.vindu-card-item{display:flex;min-width:0}
.vindu-card{all:unset;box-sizing:border-box;display:flex;flex-direction:column;gap:${rhythm(4)};width:100%;min-width:0;padding:${rhythm(12)} ${space(14)};background:var(--v-pane);border:1px solid var(--v-line);border-radius:calc(var(--v-radius) + 2px);color:var(--v-ink);font-size:${typeSize(13)};cursor:pointer}
.vindu-card:hover{background:var(--v-wash)}
.vindu-card:focus-visible{outline:2px solid var(--v-accent);outline-offset:2px}
.vindu-cards.is-list .vindu-card{border-width:0 0 1px;border-radius:0}
.vindu-card-kind{font-size:${captionSize(11)};color:var(--v-muted);letter-spacing:.03em}
.vindu-card-title{font-weight:600;overflow-wrap:break-word}
.vindu-card-lines{display:flex;flex-direction:column;gap:${rhythm(2)};color:var(--v-ink-2)}
.vindu-card-line{overflow-wrap:break-word}
.vindu-card-pictures{display:flex;gap:${space(4)};margin-top:${rhythm(4)}}
.vindu-card-pictures img{width:${space(56)};height:${space(56)};object-fit:cover;border-radius:4px;background:var(--v-wash)}
.vindu-card-back{margin-right:${space(4)}}
.vindu-bar-present{display:inline-flex;gap:${space(2)};margin-right:${space(8)}}
.vindu-bar-present[hidden]{display:none}
.vindu-bar-present button[aria-pressed="true"]{background:var(--v-wash);font-weight:600}
.vindu-pane.is-strip{background:var(--v-pane)}
.vindu-pane.is-strip>.vindu-pane-head{position:absolute;top:0;right:0;z-index:2;height:auto;padding:${space(2)};background:none;border:0;box-shadow:none}
.vindu-pane.is-strip>.vindu-pane-head>:not(.vindu-pane-tools){display:none}
`;
