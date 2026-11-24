// Shared layout and light-DOM hooks. Low specificity lets ordinary host styles win.
import { captionSize, rhythm, space, typeSize } from './metrics.js';

const root = ':where(.vindu-workspace-styled)';
export const WORKSPACE_CSS = `
${root} {
  container-type: inline-size; display: grid; box-sizing: border-box;
  grid-template-columns: minmax(0, 1fr) auto; grid-template-rows: minmax(0, 1fr) auto;
  height: 100%; min-height: 0; min-width: 0;
  font-family: inherit; font-size: ${typeSize(14)}; color: var(--v-ink, CanvasText);
}
${root} > :where(.vindu-workspace-views) { position: relative; grid-area: 1 / 1; min-width: 0; min-height: 0; }
${root} > :where(.vindu-sidebar-element) {
  grid-area: 1 / 2 / 3; display: flex; flex-direction: column; box-sizing: border-box;
  width: min(var(--v-sidebar-width, 22.5rem), 45cqi); min-width: 0; min-height: 0; overflow: hidden;
  border-inline-start: 1px solid var(--v-line, #d5d5d5); background: var(--v-head, Canvas);
}
${root} :where(.vindu-sidebar-header) {
  display: flex; align-items: center; gap: ${space(8)}; padding: ${rhythm(10)} ${space(12)};
  border-block-end: 1px solid var(--v-line, #d5d5d5);
}
${root} :where(.vindu-sidebar-title) { margin: 0; font: inherit; font-weight: 600; overflow-wrap: anywhere; }
${root} :where(.vindu-sidebar-back, .vindu-task, .vindu-composer-send) {
  font: inherit; color: inherit; background: transparent; border: 0; cursor: pointer;
}
${root} :where(.vindu-sidebar-back) { font-size: 1.4em; min-width: 2rem; min-height: 2rem; }
${root} :where(.vindu-sidebar-list, .vindu-sidebar-thread) {
  flex: 1; min-height: 0; min-width: 0; overflow: auto; overscroll-behavior: contain;
  padding: ${rhythm(6)} ${space(10)};
}
${root} :where(.vindu-task) {
  width: 100%; display: flex; gap: ${space(6)}; flex-direction: column; text-align: start; align-items: start;
  padding: ${rhythm(9)} ${space(4)}; border-block-end: 1px solid var(--v-line, #d5d5d5); overflow-wrap: anywhere;
}
${root} :where(.vindu-task:hover) { background: var(--v-wash, color-mix(in srgb, currentColor 5%, transparent)); }
${root} :where(.vindu-task small) { color: var(--v-muted, currentColor); font-size: ${captionSize(12)}; }
${root} :where(.vindu-message) { margin-block: ${rhythm(8)}; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
${root} :where(.vindu-message[data-role="user"]) {
  width: fit-content; max-width: 90%; margin-inline-start: auto; padding: ${rhythm(6)} ${space(10)};
  border-radius: var(--v-radius, 8px); background: var(--v-wash, color-mix(in srgb, currentColor 6%, transparent));
}
${root} :where(.vindu-composer-element) {
  flex: none; display: flex; flex-direction: column; gap: ${rhythm(4)}; min-width: 0;
  margin: ${rhythm(8)} ${space(10)}; padding: ${rhythm(6)} ${space(8)};
  color: inherit; background: var(--v-pane, Canvas); border: 1px solid var(--v-line, #d5d5d5); border-radius: var(--v-radius, 8px);
}
${root} > :where(.vindu-composer-element) { grid-area: 2 / 1 / 3 / -1; }
${root} :where(.vindu-composer-context) { display: flex; flex-wrap: wrap; gap: ${space(4)}; }
${root} :where(.vindu-composer-context:empty) { display: none; }
${root} :where(.vindu-context-item) {
  display: inline-flex; align-items: center; gap: .35em; padding: .1em .45em; overflow-wrap: anywhere;
  border: 1px solid var(--v-line, #d5d5d5); border-radius: var(--v-radius, 6px); font-size: ${captionSize(12)};
}
${root} :where(.vindu-context-item button) { color: inherit; font: inherit; border: 0; background: none; cursor: pointer; }
${root} :where(.vindu-composer-input) {
  box-sizing: border-box; width: 100%; min-height: 2em; max-height: 10.5rem; overflow-y: auto; resize: none;
  padding: ${rhythm(4)} ${space(2)}; font: inherit; color: inherit; background: transparent; border: none;
}
${root} :where(.vindu-composer-tools) { display: flex; align-items: center; justify-content: end; gap: ${space(6)}; }
${root} :where(.vindu-composer-send) {
  min-height: 2em; padding: ${rhythm(4)} ${space(10)}; border-radius: var(--v-radius, 6px);
  background: var(--v-accent, #292929); color: var(--v-on-accent, white);
}
${root} :where(.vindu-composer-send:disabled) { opacity: .45; cursor: default; }
${root} :where(.vindu-sidebar-back, .vindu-composer-send, .vindu-task, .vindu-composer-input):focus-visible {
  outline: 2px solid var(--v-accent, Highlight); outline-offset: 1px;
}
${root} :where(.vindu-sidebar-element, .vindu-sidebar-list, .vindu-sidebar-thread, .vindu-sidebar-back, .vindu-composer-element)[hidden] { display: none; }
@container (max-width: 600px) {
  ${root} > :where(.vindu-workspace-views) { grid-column: 1 / -1; }
  ${root} > :where(.vindu-sidebar-element) {
    grid-area: 2 / 1 / 3 / -1; width: auto; max-height: min(55dvh, 28rem);
    border-inline-start: 0; border-block-start: 1px solid var(--v-line, #d5d5d5);
  }
  ${root} :where(.vindu-composer-input) { font-size: max(16px, 1em); }
}
`;
