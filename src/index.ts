// Node provider for a web backend or Electron main process. The window entry is @matapao/vindu/renderer.
export { startVindu, type Vindu, type VinduSession, type VinduOptions, type VinduProcess, type VinduSessionOptions, type UiEndpoint } from './provider.js';
export { NOTE, type HeadText, type TemplateStart, type Shown, type OpenMore, type ReadProgress, type ViewCheckpoint, type ViewSnapshot } from './server.js';
export { type ViewPresentation, type PanelPresentation } from './presentation.js';
export { applyAction, ACTIONS, type ViewAction } from './actions.js';
export { rowKey } from './row-keys.js';
export { addDates, addTime, dayOf, parseDateExpr, today, type DateExpr } from './dates.js';
export { whenOf, instantOf, localOf, sayTime, remindersSurface, REMINDER_WORDS, DEFAULT_TIME, type Reminder, type ReminderWords } from './reminders.js';
export { FieldSchema, formBinding, readAnswer, fieldsOf, checkValue, checkDigits, FORMATS, CHECKS, permissionDetails, lineDiff, confirms, HINTS, WORDS, type Format, type Check, type Operation, type Effect, type Field, type Form, type Detail, type Ask, type Binding, type Words } from './operations.js';
export { VIEW_WORDS, type ViewWords, type HookWords, type PartialViewWords } from './view-words.js';
export { VIEW_WORDS_NB, VIEW_WORDS_NN } from './view-words-norwegian.js';
export { fromApp, appHtml, resultFor, textOnly, appsOn, anyAppsOn, resourceOf, toolResourceUri, toolVisibleTo, type AppsProvider, type AppsSwitch, type AppPanel, type AppSubmission } from './apps.js';
export { memoryResults, brief, shapeOf, amountsOf, fileOf, readRef, refOf, dataOf, withOwn, type ResultSource, type Entry, type ResultEntry, type AttachmentEntry, type AnswerEntry, type Row } from './results.js';
export { showView } from './view.js';
export { Refusal, type ViewContext } from './view-context.js';
export { CARDS, MAX_ROWS, Panel, ShowView, panelSchema, showViewSchema, resultRef, panelOption, type CardDef, type CardAction, type CardFile, type Shaped, type PanelSpec, type ViewSpec, type Resolved } from './cards.js';
export { z } from 'zod'; // the zod a host's card fields are written with: Vindu's own, so they compose with its schemas
export { compile, probesFor, type Surface, type Component, type Probe } from './a2ui.js';
export { checkSurface } from './surface-check.js';
export { BASIC_CATALOG, VINDU_CATALOG } from './catalog-id.js';
export { account, type Account } from './account.js';
export { checkTemplate, fitSlot, pinTemplate, templateNote, withInputs, layoutNames, TemplateSchema, type Template, type Slot } from './templates.js';
export { previewOf, changeSet, changeSetForm, acceptedRows, describeChange, decisionOperation, type PreviewPanel, type PreviewRule } from './frames.js';
export { BLOCKS, MESSAGE, DOCUMENT, TASKS, MONEY_BLOCK, FILES, MAP_BLOCK, CONTACTS, SHEET, SLIDES, SIGNATURE, DIAGRAM, DEVICES, BATCH, CHANGES, DECISION, wordDiff, layered } from './blocks.js';
export { EVENTS, freeSlots } from './block-events.js';
export { rolesOf } from './block-kit.js';
export { parse, rowValue, setValue, addFields, computedName, computedName as computeName, round, makeCompute, EXPRESSIONS, type Expr } from './compute.js';
export { cell, cellIn, cellIn as formatCell, CELL_RULE, whenIn, moneyIn, bytesIn } from './format.js';
export { startPageHost, inject, watchFolder, appCsp, gitHead, LIBRARIES, CSP, type PageHost, type Served, type Library, type AppCsp } from './pages.js';
export { pageNavigationAllowed, pageFrameSource, pageHost, appHost } from './page-guard.js'; // where a page's frame may go: for the window's CSP and Electron's navigation events
export { checkPage, type PageDriver, type DriverPage, type PageReport, type Step, type StepResult, type CheckOptions } from './page-check.js';
export { amountsIn } from './amounts.js';
export { Shell, type ShellState, type ShellEvent, type ViewMeta, type ShownMeta, type ViewRole, type ViewOwner, type ModelArrange, type Shelved } from './shell.js';
export { Views, isLocal, BROWSER_ACTIONS, type ViewsSetup, type TerminalSetup, type BrowserSetup, type ViewHost, type ReadArgs, type ActArgs } from './views/views.js';
export { Terminals, type TerminalInfo, type Command, type TerminalOptions, type PtyLike } from './views/terminal.js';
export { terminalEnvironment } from './views/terminal-environment.js';
export { shellSetup, unescapeLine } from './views/shells.js';
export { BrowserPage, Browsers, webAddress, fieldNames, SECRET_FIELDS, type Cdp, type Snapshot, type PageNode, type LogEntry, type Failure, type Outgoing, type Sent, type Pointed } from './views/browser.js';
export { place, insert, remove, resize, readLayout, shorthand, where, tidy, fits, slotOf, restore, openView, distribute, minExtent, minWindow, panesOf, viewsOf, nodeAt, isPane, layoutOptions, LAYOUT, type LayoutNode, type Pane, type Split, type Box, type Size, type Mode, type Placement, type PlacedPane, type PlacedSplit, type Line, type LayoutOptions, type Place, type Side, type Slot as ShelfSlot } from './layout.js'; // where a view was before the shelf (a template's slot is Slot)
export { resolvePoint, rowRef, groupsBehind, type PointItem } from './pointing.js';
