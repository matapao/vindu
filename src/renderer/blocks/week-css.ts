// How a week that carries its weather is drawn (calendar-week.ts), and a notice (notice.ts): the weather and the tasks
// due under each day's date, the hours lined up with the days below the heads however tall they are, and the warnings
// and notices as strips in their level's colour, in light and dark.
import { captionSize, rhythm, space, typeSize } from '../metrics.js';

export const WEEK_CSS = `
.vindu-theme .vb-week.vb-carries{grid-template-columns:44px repeat(var(--days),minmax(0,1fr));grid-auto-flow:column;grid-template-rows:auto auto;row-gap:0;overflow-x:auto}
.vindu-theme .vb-week.vb-carries .vb-day{display:grid;grid-row:span 2;grid-template-rows:subgrid;min-width:0}
.vindu-theme .vb-week.vb-carries .vb-hours{grid-row:span 2;align-self:end;padding-top:0}
.vindu-theme .vb-week.vb-carries .vb-hours div{box-sizing:border-box}
.vindu-theme .vb-weather{display:flex;flex-wrap:wrap;align-items:baseline;gap:0 ${space(6)};font-weight:400;font-size:${captionSize(11.5)};color:var(--v-ink-2);margin-top:${rhythm(2)}}
.vindu-theme .vb-wsign{font-size:${typeSize(16)};line-height:1}
.vindu-theme .vb-temps{font-variant-numeric:tabular-nums;color:var(--v-ink);white-space:nowrap}
.vindu-theme .vb-rain,.vindu-theme .vb-wind{white-space:nowrap;color:var(--v-muted)}
.vindu-theme .vb-duetasks{list-style:none;margin:${rhythm(3)} 0 0;padding:0;font-weight:400;font-size:${captionSize(11.5)};color:var(--v-ink)}
.vindu-theme .vb-duetasks li{overflow-wrap:break-word}
.vindu-theme .vb-duetasks .vb-done{color:var(--v-muted);text-decoration:line-through}
.vindu-theme .vb-warnband{display:grid;grid-template-columns:44px repeat(var(--days),minmax(0,1fr));gap:${rhythm(2)} ${space(4)};margin-bottom:${rhythm(4)}}
.vindu-theme .vb-warn,.vindu-theme .vb-notice{box-sizing:border-box;min-width:0;padding:${rhythm(3)} ${space(8)};border-left:4px solid var(--v-line);border-radius:3px;background:var(--v-wash);color:var(--v-ink);font-size:${captionSize(11.5)};overflow-wrap:break-word}
.vindu-theme .vb-warn{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vindu-theme .vb-agenda .vb-warn{white-space:normal;margin:${rhythm(2)} 0}
.vindu-theme .vb-notices{display:flex;flex-direction:column;gap:${rhythm(4)}}
.vindu-theme .vb-notice{font-size:${typeSize(13)};padding:${rhythm(6)} ${space(12)}}
.vindu-theme .vb-level-yellow{border-left-color:#d4a300;background:color-mix(in srgb,#f5c518 20%,var(--v-pane))}
.vindu-theme .vb-level-orange{border-left-color:#d96c00;background:color-mix(in srgb,#f39200 20%,var(--v-pane))}
.vindu-theme .vb-level-red{border-left-color:#c62828;background:color-mix(in srgb,#e53935 18%,var(--v-pane))}
`;
