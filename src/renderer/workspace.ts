// A host supplies task data and handles the effects. The same controls can enhance an existing layout.
import { html, nothing, render } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { WORKSPACE_CSS } from './workspace-css.js';
import { guardA2uiArrays } from './a2ui-limits.js';

export type WorkspaceSidebar = {
  element: HTMLElement;
  header: HTMLElement;
  back: HTMLButtonElement;
  title: HTMLElement;
  list: HTMLElement;
  thread: HTMLElement;
};

export type WorkspaceComposer = {
  element: HTMLFormElement;
  input: HTMLTextAreaElement;
  tools: HTMLElement;
  send: HTMLButtonElement;
  context?: HTMLElement;
};

export type WorkspaceTask = { id: string; title: string; status?: string };
export type WorkspaceMessage = { id: string; role: 'user' | 'assistant'; text: string };
export type WorkspaceContextItem = { id: string; label: string };
export type WorkspaceVisibility = { sidebar?: boolean; composer?: boolean };

export type WorkspaceOptions = WorkspaceVisibility & {
  /** Keep the DOM and behavior while using the host's stylesheet. */
  styles?: boolean;
  /** Adopt existing controls instead of creating them. Their labels, markup and children stay host-owned. */
  elements?: { views?: HTMLElement; sidebar?: WorkspaceSidebar; composer?: WorkspaceComposer };
  labels?: { activity?: string; back?: string; message?: string; send?: string };
  onSelectTask?: (id: string) => void;
  onBack?: () => void;
  onInput?: (draft: string) => void;
  onRemoveContext?: (id: string) => void;
  /** The host owns the draft and clears it when the message is accepted. */
  onSend?: (draft: string) => void | Promise<void>;
  canSend?: (draft: string) => boolean;
  onSendError?: (error: unknown) => void;
};

export type WorkspaceHandle = {
  views: HTMLElement;
  sidebar?: WorkspaceSidebar;
  composer?: WorkspaceComposer & { resize(): void; refresh(): void };
  setTasks(tasks: readonly WorkspaceTask[]): void;
  showThread(title: string | null): void;
  setMessages(messages: readonly WorkspaceMessage[]): void;
  /** Labels for the host's selected rows, attachments or panes. Sending their references is the host's decision. */
  setContext(items: readonly WorkspaceContextItem[]): void;
  setDraft(value: string): void;
  setVisible(options: WorkspaceVisibility): void;
  destroy(): void;
};

function makeSidebar(doc: Document, labels: NonNullable<WorkspaceOptions['labels']>): WorkspaceSidebar {
  const element = doc.createElement('aside');
  const header = doc.createElement('header');
  const back = doc.createElement('button');
  const title = doc.createElement('h2');
  const list = doc.createElement('nav');
  const thread = doc.createElement('div');
  title.textContent = labels.activity ?? 'Activity';
  back.type = 'button';
  back.textContent = '‹';
  back.setAttribute('aria-label', labels.back ?? 'Back to activity');
  element.setAttribute('aria-label', title.textContent);
  list.setAttribute('aria-label', title.textContent);
  thread.setAttribute('role', 'log');
  thread.setAttribute('aria-label', 'Conversation');
  back.hidden = thread.hidden = true;
  header.append(back, title);
  element.append(header, list, thread);
  return { element, header, back, title, list, thread };
}

function makeComposer(doc: Document, labels: NonNullable<WorkspaceOptions['labels']>): WorkspaceComposer {
  const element = doc.createElement('form');
  const input = doc.createElement('textarea');
  const tools = doc.createElement('div');
  const send = doc.createElement('button');
  const context = doc.createElement('div');
  context.setAttribute('aria-live', 'polite');
  input.rows = 1;
  input.placeholder = labels.message ?? 'Message…';
  input.setAttribute('aria-label', labels.message ?? 'Message');
  element.autocomplete = 'off';
  send.type = 'submit';
  send.textContent = labels.send ?? 'Send';
  tools.append(send);
  element.append(context, input, tools);
  return { element, input, tools, send, context };
}

/** Mount a workspace into a sized element. Pass views to mountShell or draw them yourself.
 *  Omit a control with false at mount, or temporarily hide it with setVisible. */
export function mountWorkspace(host: HTMLElement, options: WorkspaceOptions = {}): WorkspaceHandle {
  guardA2uiArrays(); // the window starts: a host's own cards are drawn by A2UI's Zod from here on
  const doc = host.ownerDocument;
  const existing = options.elements;
  const labels = options.labels ?? {};
  const views = existing?.views ?? doc.createElement('div');
  const sidebar = options.sidebar === false ? undefined : existing?.sidebar ?? makeSidebar(doc, labels);
  const form = options.composer === false ? undefined : existing?.composer ?? makeComposer(doc, labels);
  const abort = new AbortController();
  const listen = { signal: abort.signal };
  const originalParent = form?.element.parentNode;
  const originalNext = form?.element.nextSibling;
  const activityTitle = labels.activity ?? sidebar?.title.textContent ?? 'Activity';
  const classes: [HTMLElement, string][] = [];
  const rendered = new Set<HTMLElement>();

  function tag(el: HTMLElement, name: string) {
    if (el.classList.contains(name)) return;
    el.classList.add(name);
    classes.push([el, name]);
  }
  tag(host, 'vindu-workspace');
  tag(views, 'vindu-workspace-views');
  // a host's own controls may leave a part out (a composer without context, given as undefined)
  if (sidebar) {
    for (const [part, el] of Object.entries(sidebar)) if (el) tag(el, 'vindu-sidebar-' + part);
  }
  if (form) {
    for (const [part, el] of Object.entries(form)) if (el) tag(el, 'vindu-composer-' + part);
  }
  let style: HTMLStyleElement | undefined;
  if (options.styles !== false) {
    tag(host, 'vindu-workspace-styled');
    style = doc.createElement('style');
    style.textContent = WORKSPACE_CSS;
    host.append(style);
  }
  if (!existing?.views) host.append(views);
  if (sidebar && !existing?.sidebar) host.append(sidebar.element);
  if (form && !existing?.composer) (sidebar?.element ?? host).append(form.element);

  let selectedTask: HTMLButtonElement | undefined;
  /** The keyboard back on the list: on the task it came from, or the first, or the message box. */
  function focusTasks() {
    const target = selectedTask?.isConnected ? selectedTask : sidebar?.list.querySelector<HTMLButtonElement>('button');
    (target ?? form?.input)?.focus();
  }
  function showThread(title: string | null) {
    if (!sidebar) return;
    // what has the keyboard (Back, or something in the thread) is hidden with the thread: the keyboard goes to the list
    const active = doc.activeElement, hiding = title === null && !!active && (active === sidebar.back || sidebar.thread.contains(active));
    sidebar.list.hidden = title !== null;
    sidebar.thread.hidden = sidebar.back.hidden = title === null;
    sidebar.title.textContent = title ?? activityTitle;
    if (hiding) focusTasks();
  }
  function back() {
    showThread(null);
    if (selectedTask) focusTasks();
    options.onBack?.();
  }
  sidebar?.back.addEventListener('click', back, listen);
  sidebar?.element.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || e.isComposing || e.defaultPrevented || sidebar.thread.hidden ||
        (e.target as Element | null)?.closest('select')) return;
    e.preventDefault();
    back();
  }, listen);

  let pending = false;
  let errorLine: HTMLElement | undefined;
  function resize() {
    if (!form || form.element.hidden || !form.input.getClientRects().length) return;
    form.input.style.height = 'auto';
    form.input.style.height = Math.min(form.input.scrollHeight, 168) + 'px';
  }
  function available() {
    return !!form && !form.element.hidden && !pending && !!options.onSend &&
      (options.canSend?.(form.input.value) ?? !!form.input.value.trim());
  }
  function refresh() {
    if (!form) return;
    form.send.disabled = !available();
    resize();
  }
  async function submit() {
    if (!form || !available() || form.send.hidden || form.send.disabled || !options.onSend) return;
    errorLine?.remove();
    pending = true;
    try {
      const sent = options.onSend(form.input.value);
      if (sent) {
        form.send.disabled = true;
        await sent;
      }
    } catch (error) {
      if (abort.signal.aborted) return;
      if (options.onSendError) options.onSendError(error);
      else {
        errorLine ??= doc.createElement('p');
        errorLine.setAttribute('role', 'alert');
        errorLine.textContent = error instanceof Error ? error.message : String(error);
        form.element.append(errorLine);
      }
    } finally {
      pending = false;
      if (!abort.signal.aborted) refresh();
    }
  }
  form?.element.addEventListener('submit', e => { e.preventDefault(); void submit(); }, listen);
  form?.input.addEventListener('input', () => {
    options.onInput?.(form.input.value);
    refresh();
  }, listen);
  form?.input.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229 || e.defaultPrevented) return;
    e.preventDefault();
    form.element.requestSubmit();
  }, listen);

  // Custom host layouts can carry stateful elements alongside these, so only move the
  // composer when its parent actually changes, and only while the sidebar is toggled.
  function setVisible({ sidebar: showSide, composer: showForm }: WorkspaceVisibility) {
    if (sidebar && showSide !== undefined && sidebar.element.hidden === showSide) {
      const active = doc.activeElement;
      sidebar.element.hidden = !showSide;
      if (form) {
        const destination = showSide ? sidebar.element : host;
        if (form.element.parentElement !== destination) {
          destination.append(form.element);
          if (showForm !== false && active instanceof HTMLElement && form.element.contains(active)) active.focus({ preventScroll: true });
        }
      }
    }
    if (form && showForm !== undefined) form.element.hidden = !showForm;
    refresh();
  }
  refresh();
  return {
    views, sidebar, composer: form && { ...form, resize, refresh },
    showThread, setVisible,
    setTasks(tasks) {
      if (!sidebar) return;
      rendered.add(sidebar.list);
      render(repeat(tasks, task => task.id, task => html`<button type="button" class="vindu-task" @click=${(event: MouseEvent) => {
        selectedTask = event.currentTarget as HTMLButtonElement;
        showThread(task.title);
        sidebar.back.focus();
        options.onSelectTask?.(task.id);
      }}><span>${task.title}</span>${task.status ? html`<small>${task.status}</small>` : nothing}</button>`), sidebar.list);
    },
    setMessages(messages) {
      if (!sidebar) return;
      rendered.add(sidebar.thread);
      const atEnd = sidebar.thread.scrollHeight - sidebar.thread.clientHeight - sidebar.thread.scrollTop < 80;
      render(repeat(messages, message => message.id, message => html`<div class="vindu-message" role="article" data-role=${message.role}
        aria-label=${message.role}>${message.text}</div>`), sidebar.thread);
      if (atEnd) sidebar.thread.scrollTop = sidebar.thread.scrollHeight;
    },
    setContext(items) {
      if (!form?.context) return;
      rendered.add(form.context);
      render(repeat(items, item => item.id, item => html`<span class="vindu-context-item">
        ${item.label}${options.onRemoveContext ? html`<button type="button" aria-label=${'Remove ' + item.label}
          @click=${() => options.onRemoveContext?.(item.id)}>×</button>` : nothing}</span>`), form.context);
    },
    setDraft(value) {
      if (form) { form.input.value = value; refresh(); }
    },
    destroy() {
      if (abort.signal.aborted) return;
      abort.abort();
      for (const part of rendered) render(nothing, part);
      errorLine?.remove();
      if (form && !existing?.composer) form.element.remove();
      else if (form && originalParent && form.element.parentNode !== originalParent)
        originalParent.insertBefore(form.element, originalNext?.parentNode === originalParent ? originalNext : null);
      if (sidebar && !existing?.sidebar) sidebar.element.remove();
      if (!existing?.views) views.remove();
      style?.remove();
      for (const [el, name] of classes) el.classList.remove(name);
    },
  };
}
