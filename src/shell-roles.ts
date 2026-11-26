// Whose each view in the window is, and what the window does with it. The model's views (show_view) are its own: a
// checkpoint and a template keep them, the person points at them and puts them in the chat. The window's own panes (the
// reminders, an ask's preview and its receipt) are the system's; an ask's pane is the ask's; terminals, browser pages
// and the host's own kinds are the host's. A view's role is said where it is shown, and read wherever the server
// decides by it, so nothing is worked out from a view's name. The one thing a name says is what the window keeps for
// an ask: its panes are named by its ticket, which the model is told, so those names are the window's from the start.

/** Who shows a view: the model (show_view, and the panes it reserved), the system, the host, or an ask to the person. */
export type ViewOwner = 'model' | 'system' | 'host' | 'ask';
/** Whose a view is; whether a checkpoint and a template keep it; whether what the person points at in it is kept; and
 *  whether its pane has a button that puts it in the chat. */
export type ViewRole = { owner: ViewOwner; checkpointed: boolean; pointable: boolean; chat: boolean };

export const ROLES: Readonly<Record<ViewOwner, ViewRole>> = {
  model: { owner: 'model', checkpointed: true, pointable: true, chat: true },
  system: { owner: 'system', checkpointed: false, pointable: true, chat: true },
  host: { owner: 'host', checkpointed: false, pointable: true, chat: true },
  ask: { owner: 'ask', checkpointed: false, pointable: false, chat: false },
};
/** A pane the model reserved for content still to come: its own, with nothing in it yet to keep, point at or chat about. */
export const RESERVED: ViewRole = { owner: 'model', checkpointed: false, pointable: false, chat: false };

/** A view's role from what it is, when whoever shows it does not say: an ask, a pane of the host's (it has a kind of
 *  its own), a reservation, or the model's. */
export const roleFor = (meta: { ask?: boolean; kind?: string; loading?: boolean }): ViewRole => {
  if (meta.ask) return ROLES.ask;
  if (meta.kind) return ROLES.host;
  return meta.loading ? RESERVED : ROLES.model;
};

/** The names the window keeps for an ask's panes, by their shape, and what each is: its own (ask-k3) and exactly what
 *  it will send (preview-k3), then its receipt. No one else shows or reserves a view under either, ever. */
const KEPT: readonly (readonly [RegExp, string])[] = [
  [/^ask-k\d+$/, 'it asks the person'],
  [/^preview-k\d+$/, 'exactly what an ask will send, then its receipt'],
];
export const keptFor = (name: string): string | undefined => KEPT.find(([shape]) => shape.test(name))?.[1];
