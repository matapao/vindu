import { captionSize, headingSize, rhythm, space, typeSize } from './metrics.js';

const font = '[data-vindu-metrics~="fontSize"]';
const heading = '[data-vindu-metrics~="headingSize"] a2ui-basic-text .a2ui-text';
const caption = '[data-vindu-metrics~="captionSize"]';
const spacing = '[data-vindu-metrics~="spacing"]';
// Use A2UI's live steps when only density changes, including a host's rem base.
const step = (size: string) => `var(--a2ui-spacing-${size})`;
const vertical = (size: string) => `calc(${step(size)} * var(--v-density, 1))`;
const layout = `:is(${spacing}, [data-vindu-metrics~="density"])`;

// A2UI defines its derived sizes on :root. CSS resolves those variables there, so
// a host with its own base sizes needs to derive them again at the mount.
export const PRIMITIVE_METRICS_CSS = `
${font} {
  --a2ui-font-size: var(--v-font-size);
  --a2ui-font-size-m: var(--a2ui-font-size);
  --a2ui-font-size-s: calc(var(--a2ui-font-size-m) / var(--a2ui-font-scale, 1.2));
  --a2ui-font-size-xs: calc(var(--a2ui-font-size-s) / var(--a2ui-font-scale, 1.2));
  --a2ui-font-size-l: calc(var(--a2ui-font-size-m) * var(--a2ui-font-scale, 1.2));
  --a2ui-font-size-xl: calc(var(--a2ui-font-size-l) * var(--a2ui-font-scale, 1.2));
  --a2ui-font-size-2xl: calc(var(--a2ui-font-size-xl) * var(--a2ui-font-scale, 1.2));
  --a2ui-icon-size: ${typeSize(24)};
  --a2ui-checkbox-size: ${typeSize(16)};
  --a2ui-choicepicker-checkbox-size: ${typeSize(16)};
  font-size: var(--v-font-size);
}
${font} :is(.a2ui-button, .a2ui-textfield, .a2ui-filter-input, .a2ui-date-time-input, .a2ui-tab-button) {
  font-size: var(--v-font-size);
}
${font} .a2ui-modal-close { font-size: ${typeSize(24)}; }

${heading} h1 { font-size: ${headingSize(28)}; }
${heading} h2 { font-size: ${headingSize(22)}; }
${heading} h3 { font-size: ${headingSize(16)}; }
${heading} h4 { font-size: ${headingSize(12)}; }
${heading} h5 { font-size: ${headingSize(11)}; }
${heading} h6 { font-size: ${headingSize(10)}; }
${caption} .a2ui-text.a2ui-text-caption,
${caption} :is(.a2ui-audio-description, .a2ui-error-message) { font-size: ${captionSize(12)}; }

${spacing} {
  --a2ui-spacing-xs: ${space(2)};
  --a2ui-spacing-s: ${space(4)};
  --a2ui-spacing-m: ${space(8)};
  --a2ui-spacing-l: ${space(16)};
  --a2ui-spacing-xl: ${space(32)};
  --a2ui-image-icon-size: ${space(24)};
  --a2ui-image-avatar-size: ${space(40)};
}

${layout} {
  --a2ui-button-padding: ${vertical('m')} ${step('l')};
  --a2ui-button-margin: ${vertical('m')} ${step('m')};
  --a2ui-checkbox-margin: ${vertical('m')} ${step('m')};
  --a2ui-choicepicker-chip-padding: ${vertical('s')} ${step('m')};
  --a2ui-choicepicker-filter-padding: ${vertical('xs')} ${step('s')};
  --a2ui-choicepicker-filter-margin-bottom: ${vertical('s')};
  --a2ui-datetimeinput-padding: ${rhythm(8)} ${space(8)};
  --a2ui-modal-padding: ${vertical('xl')} ${step('xl')};
  --a2ui-slider-margin: ${vertical('m')} ${step('m')};
  --a2ui-tabs-content-padding: ${vertical('m')} 0;
  --a2ui-textfield-padding: ${vertical('m')} ${step('m')};
}
${layout}:not(.vindu-theme) {
  --a2ui-card-padding: ${vertical('m')} ${step('m')};
  --a2ui-card-margin: ${vertical('m')} ${step('m')};
  --a2ui-column-gap: ${vertical('m')};
}
${layout}:not(.vindu-theme) .a2ui-list-vertical { row-gap: var(--a2ui-list-gap, ${vertical('s')}); }
${layout} .a2ui-divider:not(.a2ui-divider-vertical) { margin-block: var(--a2ui-divider-spacing, ${vertical('m')}); }
${layout} :is(a2ui-basic-textfield, .a2ui-audio-player, .a2ui-slider-container, .a2ui-date-time-container) {
  row-gap: ${vertical('xs')};
}
${layout} :is(a2ui-choicepicker, .a2ui-choice-picker, .a2ui-options-group, .a2ui-chips-group) {
  row-gap: var(--a2ui-choicepicker-gap, ${vertical('xs')});
}
${layout} .a2ui-tab-button { padding-block: ${vertical('s')}; }
${layout} .a2ui-modal-close { top: ${rhythm(10)}; right: ${space(15)}; }
${spacing} .a2ui-modal-content { box-sizing: border-box; min-width: min(300px, 80vw); }
${spacing} .a2ui-slider-container { width: auto; }
`;
