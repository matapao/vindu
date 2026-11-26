import type { McpServer } from '@modelcontextprotocol/server';
import { anyAppsOn } from '../apps.js';
import { BLOCKS } from '../blocks.js';
import { offeredKinds, showViewSchema } from '../card-schema.js';
import { decisionOperation } from '../frames.js';
import { type Binding, formBinding, type Operation, type Words, WORDS } from '../operations.js';
import type { startPageHost } from '../pages.js';
import { REMINDER_WORDS, type ReminderWords } from '../reminders.js';
import { VIEW_WORDS, viewWordsOver } from '../view-words.js';
import type { UiServerOptions } from './contracts.js';

export type ServerRuntime = ReturnType<typeof configureServer> & {
  host: Awaited<ReturnType<typeof startPageHost>>;
};
export type Endpoints = Map<string, () => McpServer>;

export function configureServer(options: UiServerOptions) {
  const operations: Operation[] = [
    ...(options.operations ?? []),
    ...(options.decisions ? [decisionOperation(typeof options.decisions === 'object' ? options.decisions : {})] : []),
  ];
  const offered = [
    ...(options.blocks === false
      ? []
      : BLOCKS.filter((b) => !Array.isArray(options.blocks) || options.blocks.includes(b.name))),
    ...(options.cards ?? []),
  ];
  const cards = new Map(offered.map((c) => [c.name, c]));
  const showView = showViewSchema(offered, { kinds: options.kinds, apps: anyAppsOn(options.apps) });
  const showViewPlain = showView.omit({ browser: true }); // a window without browser pages
  const kinds = offeredKinds({ kinds: options.kinds, apps: anyAppsOn(options.apps) });
  const words: Words = { ...WORDS, ...options.words };
  const viewWords = viewWordsOver(VIEW_WORDS, options.viewWords);
  const bindings: Record<string, Binding> = { form: formBinding, ...options.bindings };
  const waitMs = options.waitMs ?? 45_000; // under a minute: what MCP clients commonly give a tool call before they give up
  const format = {
    locale: options.locale ?? 'en-GB',
    timeZone: options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
  };

  const reminders = typeof options.reminders === 'object' ? options.reminders : {};
  const reminderWords: ReminderWords = { ...REMINDER_WORDS, ...reminders.words };
  const reminderLimit = reminders.max ?? 20; // the model's, set and not yet due, at most

  return {
    options,
    operations,
    cards,
    showView,
    showViewPlain,
    kinds,
    words,
    viewWords,
    bindings,
    waitMs,
    format,
    reminderWords,
    reminderLimit,
    pageCheckCount: 0,
  };
}
