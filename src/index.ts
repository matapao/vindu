// Node provider for a web backend or Electron main process. The window entry is @matapao/vindu/renderer.
export {
  startVindu,
  type Vindu,
  type VinduSession,
  type VinduOptions,
  type VinduProcess,
  type VinduSessionOptions,
  type UiEndpoint,
} from './provider.js';
export {
  NOTE,
  type HeadText,
  type TemplateStart,
  type Shown,
  type OpenMore,
  type ReadProgress,
  type ViewCheckpoint,
  type ResultPointer,
  type KeptAnswer,
  type ViewSnapshot,
  type MessageDraft,
} from './server.js';
export type { ViewFormat } from './server/view-words.js'; // a window's locale and time zone: open's locale and timeZone, setViewWords' second argument
export { DRAFT_LIMITS, type SendResult } from './message-draft.js'; // a mail drafted for the person to send: what it takes at most, and how its send went
export { type ViewPresentation, type PanelPresentation, type PresentationKit } from './presentation.js';
export { panelSummaryOf, type PanelSummary, type SummaryKit } from './panel-summary.js'; // what a panel holds, in one line, for its card
export { viewSummaryOf, type ViewSummary, type ViewChange, type ViewSize } from './view-summary.js';
export { showsOf, PRESENTATION, type Presentation, type ShellPresentation, type Shows } from './shell-presentation.js'; // a window's views as cards or as their content
export { applyAction, ACTIONS, type ViewAction } from './actions.js';
export { rowKey } from './row-keys.js';
export { addDates, addTime, dayOf, parseDateExpr, today, type DateExpr } from './dates.js';
export {
  whenOf,
  instantOf,
  localOf,
  sayTime,
  remindersSurface,
  REMINDER_WORDS,
  DEFAULT_TIME,
  type Reminder,
  type ReminderWords,
} from './reminders.js';
export {
  formBinding,
  readAnswer,
  permissionDetails,
  lineDiff,
  confirms,
  HINTS,
  WORDS,
  type Operation,
  type Effect,
  type Form,
  type Detail,
  type Ask,
  type Binding,
  type Words,
} from './operations.js';
export {
  FieldSchema,
  fieldsOf,
  checkValue,
  checkDigits,
  FORMATS,
  CHECKS,
  type Format,
  type Check,
  type Field,
} from './field-values.js';
export { VIEW_WORDS, type ViewWords, type HookWords, type MessageWords, type PartialViewWords } from './view-words.js';
export {
  BLOCK_WORDS,
  wordWith,
  type BlockWords,
  type MoneyWords,
  type EventWords,
  type NoticeWords,
  type BatchWords,
  type MapWords,
  type TaskWords,
  type PdfWords,
  type SheetWords,
  type DocumentWords,
} from './block-words.js';
export { SUMMARY_WORDS, type SummaryWords } from './summary-words.js';
export { readableName } from './field-names.js';
export { VIEW_WORDS_NB, VIEW_WORDS_NN } from './view-words-norwegian.js';
export {
  fromApp,
  appHtml,
  resultFor,
  textOnly,
  appsOn,
  anyAppsOn,
  resourceOf,
  toolResourceUri,
  toolVisibleTo,
  type AppsProvider,
  type AppsSwitch,
  type AppPanel,
  type AppSubmission,
} from './apps.js';
export {
  memoryResults,
  brief,
  shapeOf,
  amountsOf,
  fileOf,
  readRef,
  refOf,
  dataOf,
  withOwn,
  type ResultSource,
  type Entry,
  type ResultEntry,
  type AttachmentEntry,
  type AnswerEntry,
  type Row,
} from './results.js';
export { showView } from './view.js';
export { Refusal, type ViewContext } from './view-context.js';
export {
  CARDS,
  MAX_ROWS,
  type CardDef,
  type CardAction,
  type CardFile,
  type CardFileRows,
  type Shaped,
  type PanelSpec,
  type ViewSpec,
  type Resolved,
} from './cards.js';
export { Panel, ShowView, panelSchema, showViewSchema, resultRef, panelOption } from './card-schema.js';
export { z } from 'zod'; // the zod a host's card fields are written with: Vindu's own, so they compose with its schemas
export { compile, probesFor, type Surface, type Component, type Probe } from './a2ui.js';
export { checkSurface } from './surface-check.js';
export { BASIC_CATALOG, VINDU_CATALOG } from './catalog-id.js';
export { account, type Account } from './account.js';
export {
  checkTemplate,
  fitSlot,
  pinTemplate,
  templateNote,
  withInputs,
  layoutNames,
  TemplateSchema,
  type Template,
  type Slot,
} from './templates.js';
export {
  previewOf,
  changeSet,
  changeSetForm,
  acceptedRows,
  describeChange,
  decisionOperation,
  type PreviewPanel,
  type PreviewRule,
} from './frames.js';
export { BLOCKS, MONEY_BLOCK, FILES, SHEET, SLIDES, SIGNATURE, DEVICES, CHANGES, DECISION } from './blocks.js';
export { MAP_BLOCK, CONTACTS, DIAGRAM, layered } from './blocks-drawn.js';
export { MESSAGE, DOCUMENT, TASKS, wordDiff } from './blocks-text.js';
export { BATCH, callLabel } from './block-batch.js';
export { EVENTS, freeSlots } from './block-events.js';
export { NOTICE } from './block-notice.js';
export { rolesOf } from './block-kit.js';
export {
  parse,
  rowValue,
  setValue,
  addFields,
  computedName,
  computedName as computeName,
  round,
  makeCompute,
  EXPRESSIONS,
  type Expr,
} from './compute.js';
export { cell, cellIn, cellIn as formatCell, CELL_RULE, whenIn, moneyIn, bytesIn } from './format.js';
export { startPageHost, inject, watchFolder, gitHead, LIBRARIES, type PageHost, type Library } from './pages.js';
export { appCsp, CSP, type Served, type AppCsp } from './page-serve.js';
export { pageNavigationAllowed, pageFrameSource, pageHost, appHost } from './page-guard.js'; // where a page's frame may go: for the window's CSP and Electron's navigation events
export {
  checkPage,
  type PageDriver,
  type DriverPage,
  type PageReport,
  type Step,
  type StepResult,
  type CheckOptions,
} from './page-check.js';
export { amountsIn } from './amounts.js';
export {
  Shell,
  type ShellState,
  type ShellEvent,
  type ViewMeta,
  type ShownMeta,
  type ViewRole,
  type ViewOwner,
  type ModelArrange,
  type Shelved,
} from './shell.js';
export {
  Views,
  isLocal,
  BROWSER_ACTIONS,
  type ViewsSetup,
  type TerminalSetup,
  type BrowserSetup,
  type ViewHost,
  type ReadArgs,
  type ActArgs,
} from './views/views.js';
export { Terminals, type TerminalInfo, type Command, type TerminalOptions, type PtyLike } from './views/terminal.js';
export { terminalEnvironment } from './views/terminal-environment.js';
export { shellSetup, unescapeLine } from './views/shells.js';
export {
  BrowserPage,
  webAddress,
  fieldNames,
  SECRET_FIELDS,
  type Cdp,
  type Snapshot,
  type PageNode,
  type LogEntry,
  type Failure,
  type Outgoing,
  type Sent,
  type Pointed,
} from './views/browser.js';
export { Browsers } from './views/browsers.js';
export {
  place,
  where,
  distribute,
  minExtent,
  minWindow,
  panesOf,
  viewsOf,
  nodeAt,
  isPane,
  layoutOptions,
  LAYOUT,
  type LayoutNode,
  type Pane,
  type Split,
  type Box,
  type Size,
  type Mode,
  type Placement,
  type PlacedPane,
  type PlacedSplit,
  type Line,
  type LayoutOptions,
  type Place,
  type Side,
} from './layout.js';
export { readLayout, shorthand } from './layout-read.js';
export {
  insert,
  remove,
  resize,
  tidy,
  fits,
  slotOf,
  restore,
  openView,
  type Slot as ShelfSlot,
} from './layout-edit.js'; // where a view was before the shelf (a template's slot is Slot)
export { resolvePoint, rowRef, groupsBehind, type PointItem } from './pointing.js';
