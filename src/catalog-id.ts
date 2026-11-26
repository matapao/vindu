// The catalog ids a surface names, and the messages a surface is made of. Shared by the compiler (Node) and the
// renderer (browser), so nothing else here.
export const BASIC_CATALOG = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';
/** The basic catalog plus Page and the components a host adds (the renderer registers them). */
export const VINDU_CATALOG = 'urn:vindu:catalog:0.1';
/** The A2UI version every message Vindu writes says it is. */
const A2UI_VERSION = 'v0.9';

type Message = Record<string, unknown>;
type Created = { version: typeof A2UI_VERSION; createSurface: { surfaceId: string; catalogId: string } };
type Components<C> = { version: typeof A2UI_VERSION; updateComponents: { surfaceId: string; components: C[] } };
type Modelled<M> = { version: typeof A2UI_VERSION; updateDataModel: { surfaceId: string; path: '/'; value: M } };

/** A whole surface: created with its catalog, its components, and the data they read (when they read any). */
export function surfaceOf<C extends Message>(id: string, catalog: string, components: C[]): [Created, Components<C>];
export function surfaceOf<C extends Message, M>(
  id: string,
  catalog: string,
  components: C[],
  model: M,
): [Created, Components<C>, Modelled<M>];
export function surfaceOf<C extends Message, M>(id: string, catalog: string, components: C[], model?: M): Message[] {
  return [
    { version: A2UI_VERSION, createSurface: { surfaceId: id, catalogId: catalog } },
    { version: A2UI_VERSION, updateComponents: { surfaceId: id, components } },
    ...(model === undefined
      ? []
      : [{ version: A2UI_VERSION, updateDataModel: { surfaceId: id, path: '/', value: model } }]),
  ];
}
/** The components a surface's update holds; undefined when it has none. */
export const componentsOf = (surface: readonly Message[]): Message[] | undefined => {
  const update = surface.find((m) => m.updateComponents)?.updateComponents as { components?: unknown } | undefined;
  return Array.isArray(update?.components) ? (update.components as Message[]) : undefined;
};
/** The data model a surface sets at its root; undefined when it sets none. */
export const dataModelOf = (surface: readonly Message[]): Record<string, unknown> | undefined =>
  (surface.find((m) => m.updateDataModel)?.updateDataModel as { value?: Record<string, unknown> } | undefined)?.value;

/** Components written in order: any component, a text, and a button whose click sends an action with its context. */
export function componentList() {
  const components: Message[] = [];
  const add = (c: Message) => {
    components.push(c);
    return c.id as string;
  };
  const text = (id: string, t: string, variant?: string) =>
    add({ id, component: 'Text', text: t, ...(variant ? { variant } : {}) });
  const button = (id: string, label: string, name: string, context: Message, primary = false) =>
    add({
      id,
      component: 'Button',
      child: text(`${id}_label`, label),
      ...(primary ? { variant: 'primary' } : {}),
      action: { event: { name, context } },
    });
  return { components, add, text, button };
}
