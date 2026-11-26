// vindu's renderer, on the A2UI Lit renderer: draw one view (mountView), or a whole shell of them (mountShell):
// panes with 1 px lines between, placed by the same layout code the UI server tells the model about.
// Runs in a browser (an Electron window, a web app); the host bundles it with its own renderer code.
export { defineComponent, Page, McpApp, vinduCatalog, drawSurface, withoutHead, withKnown, readBack, MISSING, mountView, VINDU_CATALOG, type Surface, type View, type VinduComponent, type Probe, type ReadBack } from './surface.js';
export { mountShell, skinCss, sideAt, SHELL_LABELS, type ShellHandle, type ShellOptions, type ShellTokens, type ShellSkin, type ShellLabels, type ShellAction, type ShellCommand, type ShownView, type PaneDrawer, type HostPane } from './shell.js';
export type { ViewMetrics } from './metrics.js';
export type { PanelPresentation, ViewPresentation } from '../presentation.js';
export type { PanelSummary } from '../panel-summary.js';
export type { ViewSummary, ViewChange, ViewSize } from '../view-summary.js';
export { showsOf, PRESENTATION, type Presentation, type ShellPresentation, type Shows } from '../shell-presentation.js'; // for a host that draws the cards itself
export type { PointItem } from '../pointing.js';
export { useTheme, THEME_CSS } from './theme.js';
export { guardA2uiArrays } from './a2ui-limits.js'; // for a host that checks with A2UI's schemas before the window starts
export { pageMessageGuard, REPORT_MAX, type PageAsk, type PageMessageCheck } from '../page-message-guard.js'; // for a host that relays a page's messages itself
export { checkSend, SEND_MAX } from '../page-send.js';
export { html, css, nothing } from 'lit'; // the Lit a host's components render with: vindu's own, so there is one
export { place, where, LAYOUT, type LayoutNode, type Placement, type LayoutOptions, type Box, type Size, type Place, type Side } from '../layout.js';
export { readLayout, shorthand } from '../layout-read.js';
export { insert, remove, resize, openView, restore, slotOf, type Slot } from '../layout-edit.js';
export { Shell, type ShellState, type ShellEvent, type Shelved, type ShownMeta, type ViewRole, type ViewOwner } from '../shell.js';
export { moveLine } from './shell.js';
export { mountWorkspace, type WorkspaceOptions, type WorkspaceHandle, type WorkspaceVisibility,
  type WorkspaceSidebar, type WorkspaceComposer, type WorkspaceTask, type WorkspaceMessage,
  type WorkspaceContextItem } from './workspace.js';
