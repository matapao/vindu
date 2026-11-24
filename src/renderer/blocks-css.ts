import { captionSize, headingSize, rhythm, space, typeSize } from './metrics.js';

/** How the blocks look: the theme's own tokens, so they sit in a pane as the cards do (light DOM: the theme reaches in). */
export const BLOCKS_CSS = `
.vindu-theme .vb-muted{color:var(--v-muted)} .vindu-theme .vb-small{font-size:${captionSize(11)};margin-top:${rhythm(4)}}
.vindu-theme .vb-warn{color:#b3261e} .vindu-theme .vb-title{font-weight:600;font-size:${headingSize(14)};margin:0 0 ${rhythm(2)}}
.vindu-theme .vb-list{display:flex;flex-direction:column;border-top:1px solid var(--v-hair)}
.vindu-theme .vb-item{display:flex;gap:${rhythm(10)} ${space(10)};align-items:baseline;padding:${rhythm(6)} 0;border-bottom:1px solid var(--v-hair)}
.vindu-theme .vb-item:last-child{border-bottom:0}
.vindu-theme .vb-inbox .vb-from{flex:0 0 28%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap} .vindu-theme .vb-inbox .vb-subj{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vindu-theme .vb-unread .vb-from,.vindu-theme .vb-unread .vb-subj{font-weight:600}
.vindu-theme .vb-when{margin-left:auto;color:var(--v-muted);white-space:nowrap;padding-left:${space(8)};font-size:${captionSize(12)}}
.vindu-theme .vb-meta{display:flex;gap:${rhythm(6)} ${space(6)};align-items:baseline;flex-wrap:wrap;margin-bottom:${rhythm(4)}}
.vindu-theme .vb-msg{display:block}.vindu-theme .vb-body{white-space:pre-line;max-width:75ch;overflow-wrap:anywhere}
.vindu-theme .vb-chips{display:flex;flex-wrap:wrap;gap:${rhythm(4)} ${space(4)};margin-top:${rhythm(4)}}
.vindu-theme .vb-chip{display:inline-block;border:1px solid var(--v-hair);border-radius:10px;padding:0 ${space(7)};font-size:${captionSize(11.5)};color:var(--v-ink-2);white-space:nowrap}
.vindu-theme .vb-src{font-family:var(--v-mono);font-size:${captionSize(11)}}
.vindu-theme .vb-doc .vb-sec{padding:${rhythm(6)} 0;border-bottom:1px solid var(--v-hair)} .vindu-theme .vb-h{font-weight:600;display:flex;gap:${rhythm(8)} ${space(8)};align-items:baseline}
.vindu-theme .vb-h1{font-size:${headingSize(15)}}.vindu-theme .vb-h2{font-size:${headingSize(13.5)}}.vindu-theme .vb-h3{font-size:${headingSize(13)};color:var(--v-ink-2)}
.vindu-theme .vb-anchor{font-family:var(--v-mono);font-size:${captionSize(11.5)};color:var(--v-muted);white-space:nowrap}
.vindu-theme ins{background:rgba(27,175,122,.16);text-decoration:none} .vindu-theme del{background:rgba(227,73,72,.13);color:var(--v-ink-2)}
.vindu-theme .vb-gone{opacity:.7}
.vindu-theme .vb-dayhead{font-weight:600;font-size:${headingSize(12)};color:var(--v-ink-2);padding:${rhythm(8)} 0 ${rhythm(3)}}
.vindu-theme .vb-ev .vb-time{flex:0 0 auto;font-variant-numeric:tabular-nums;color:var(--v-ink-2);min-width:88px}
.vindu-theme .vb-free{color:#12805a;font-weight:600}
.vindu-theme .vb-week{--vb-hour:${rhythm(30)};display:grid;grid-template-columns:44px repeat(var(--days),1fr);gap:0 ${space(4)};font-size:${typeSize(12)}}
.vindu-theme .vb-hours div{color:var(--v-muted);font-size:${captionSize(10.5)};border-top:1px solid var(--v-hair)} .vindu-theme .vb-hours{padding-top:${rhythm(28)}}
.vindu-theme[data-vindu-metrics] .vb-week{grid-auto-flow:column;grid-template-rows:auto auto;row-gap:0;overflow-x:auto}
.vindu-theme[data-vindu-metrics] .vb-day{display:grid;grid-row:span 2;grid-template-rows:subgrid}
.vindu-theme[data-vindu-metrics] .vb-hours{grid-row:span 2;align-self:end;padding-top:0}
.vindu-theme[data-vindu-metrics] .vb-hours div{box-sizing:border-box}
.vindu-theme .vb-daybody{position:relative;background:repeating-linear-gradient(var(--v-pane) 0 calc(var(--vb-hour) - 1px),var(--v-hair) calc(var(--vb-hour) - 1px) var(--vb-hour))}
.vindu-theme .vb-slot{position:absolute;left:1px;right:1px;background:rgba(42,120,214,.13);border-left:3px solid var(--v-accent);border-radius:3px;padding:${rhythm(1)} ${space(4)};overflow:hidden;font-size:${typeSize(11.5)};cursor:grab}
.vindu-theme .vb-slot.vb-moved{border-left-style:dashed;outline:1px dashed var(--v-accent)}
.vindu-theme .vb-slot.vb-clash{border-left-color:var(--v-bad,#c0392b);outline:1px solid var(--v-bad,#c0392b)}
.vindu-theme .vb-board{display:grid;grid-template-columns:repeat(var(--cols),minmax(140px,1fr));gap:${rhythm(8)} ${space(8)};overflow-x:auto}
.vindu-theme .vb-col{background:var(--v-wash);border-radius:6px;padding:${rhythm(4)} ${space(6)}}
.vindu-theme .vb-card{background:var(--v-pane);border:1px solid var(--v-hair);border-radius:6px;padding:${rhythm(6)} ${space(8)};margin:${rhythm(4)} 0}
.vindu-theme .vb-mark{min-width:18px;color:var(--v-ink-2)} .vindu-theme .vb-done{text-decoration:line-through;color:var(--v-muted)}
.vindu-theme .vb-head{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:${rhythm(2)} ${space(16)};margin-bottom:${rhythm(8)}}
.vindu-theme .vb-kv{display:flex;justify-content:space-between;gap:${rhythm(8)} ${space(8)};border-bottom:1px dotted var(--v-hair);padding:${rhythm(2)} 0}.vindu-theme .vb-kv span:first-child{color:var(--v-muted)}
.vindu-theme table{border-collapse:collapse;width:100%} .vindu-theme .vb-lines th,.vindu-theme .vb-sheet th{font-weight:600;font-size:${captionSize(11.5)};color:var(--v-muted);text-align:left;border-bottom:1px solid var(--v-line);padding:${rhythm(3)} ${space(6)}}
.vindu-theme .vb-lines td,.vindu-theme .vb-sheet td{padding:${rhythm(4)} ${space(6)};border-bottom:1px solid var(--v-hair)} .vindu-theme .vb-num{text-align:right;font-variant-numeric:tabular-nums}
.vindu-theme .vb-total{font-weight:600;font-size:${headingSize(14)};border-bottom:0!important}
.vindu-theme .vb-big{font-size:${headingSize(26)};font-weight:600;letter-spacing:-.01em}
.vindu-theme .vb-file .vb-icon,.vindu-theme .vb-sign .vb-icon{font:600 ${captionSize(9.5)} var(--v-mono);border:1px solid var(--v-line);border-radius:3px;padding:${rhythm(1)} ${space(3)};color:var(--v-ink-2);min-width:30px;text-align:center}
.vindu-theme .vb-file .vb-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
.vindu-theme .vb-map svg{width:100%;height:auto;display:block;border:1px solid var(--v-hair);border-radius:6px} .vindu-theme .vb-sea{fill:var(--v-wash)}
.vindu-theme[data-vindu-metrics] .vb-map svg{box-sizing:border-box}
.vindu-theme .vb-maplabel{font-size:${captionSize(11)};fill:var(--v-ink-2);paint-order:stroke;stroke:var(--v-pane);stroke-width:3px}
.vindu-theme .vb-legend{display:flex;gap:${rhythm(12)} ${space(12)};flex-wrap:wrap;margin-top:${rhythm(4)};font-size:${captionSize(12)}}.vindu-theme .vb-legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:${space(4)}}
.vindu-theme .vb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:${rhythm(8)} ${space(8)}}
.vindu-theme .vb-sheet{overflow-x:auto} .vindu-theme .vb-f{color:var(--v-accent)} .vindu-theme .vb-fx{font-style:italic;color:var(--v-accent)}
.vindu-theme .vb-totals{margin-top:${rhythm(8)};width:auto;min-width:50%} .vindu-theme .vb-totals td{font-weight:600}
.vindu-theme .vb-slide{aspect-ratio:16/9;border:1px solid var(--v-line);border-radius:8px;padding:max(0px,calc(6% + ${rhythm(8)} - 8px)) max(0px,calc(7% + ${space(8)} - 8px));background:var(--v-pane);display:flex;flex-direction:column;gap:${rhythm(12)} ${space(12)};overflow:hidden}
.vindu-theme .vb-slidetitle{font-size:${headingSize(22)};font-weight:600} .vindu-theme .vb-slide ul{margin:0;padding-left:${space(20)};font-size:${typeSize(15)};line-height:1.5}
.vindu-theme .vb-figure .vb-big{font-size:${headingSize(40)}}
.vindu-theme .vb-nav{display:flex;align-items:center;gap:${rhythm(8)} ${space(8)};margin-top:${rhythm(6)}} .vindu-theme .vb-nav button,.vindu-theme .vb-btn{border:1px solid var(--v-line);background:var(--v-pane);color:var(--v-ink);border-radius:5px;padding:${rhythm(1)} ${space(9)};font:inherit;cursor:pointer}
.vindu-theme .vb-notes{font-size:${captionSize(12)}} .vindu-theme .vb-sigimg{height:40px;background:#fff;border:1px solid var(--v-hair);border-radius:4px}
.vindu-theme .vb-diagram{overflow:auto} .vindu-theme .vb-node{fill:var(--v-pane);stroke:var(--v-line)} .vindu-theme .vb-nodelabel{font-size:${typeSize(12)};fill:var(--v-ink)}
.vindu-theme .vb-edge{fill:none;stroke:var(--v-muted);stroke-width:1.4} .vindu-theme .vb-arrowhead{fill:var(--v-muted)} .vindu-theme .vb-edgelabel{font-size:${captionSize(10.5)};fill:var(--v-muted)}
.vindu-theme .vb-device .vb-name{flex:1} .vindu-theme .vb-pill{border-radius:10px;padding:0 ${space(8)};font-size:${captionSize(11.5)};background:var(--v-wash)} .vindu-theme .vb-on{background:rgba(27,175,122,.18);color:#12805a}
.vindu-theme .vb-decision{border-left:3px solid var(--v-accent);padding:${rhythm(4)} ${space(10)};margin:${rhythm(4)} 0} .vindu-theme .vb-appeal{margin-top:${rhythm(6)};font-size:${captionSize(12)};color:var(--v-ink-2)}
.vindu-theme .vb-marked{position:relative;display:block} .vindu-theme .vb-marked img{display:block;max-width:100%}
.vindu-theme .vb-region{position:absolute;border:2px solid #eb6834;border-radius:3px;box-shadow:0 0 0 1px rgba(255,255,255,.7)}
.vindu-theme .vb-region span{position:absolute;left:-2px;top:${captionSize(-20)};background:#eb6834;color:#fff;font-size:${captionSize(11)};padding:0 ${space(5)};border-radius:3px;white-space:nowrap}
.vindu-theme .vb-chart{position:relative;display:block;max-width:100%} .vindu-theme .vb-chart img{display:block;max-width:100%;height:auto}
.vindu-theme .vb-strips{position:absolute;top:0;bottom:0;display:flex} .vindu-theme .vb-strip{flex:1 1 0} .vindu-theme .vb-strip[data-opens]{cursor:pointer}
.vindu-theme .vb-strip:hover{background:rgba(42,120,214,.07)} .vindu-theme .vb-strip:focus-visible{outline:2px solid var(--v-accent);outline-offset:-2px} .vindu-theme .vb-strip.vb-picked{background:rgba(42,120,214,.16);outline:2px solid var(--v-accent)}
.vindu-band{position:fixed;z-index:50;border:1.5px dashed var(--v-accent,#2a78d6);background:rgba(42,120,214,.08);pointer-events:none}
.vindu-theme .vindu-pane-tools .vindu-chat[aria-pressed="true"]{background:var(--v-accent);color:var(--v-pane)}
.vindu-theme .vindu-pane-tools .vindu-chat[aria-pressed="true"]:hover{background:var(--v-accent);color:var(--v-pane)}
.vindu-theme a2ui-list .vb-picked,.vindu-theme [data-row].vb-picked,.vindu-theme [data-node].vb-picked rect{outline:2px solid var(--v-accent);outline-offset:1px;background:rgba(42,120,214,.08)}
`;
