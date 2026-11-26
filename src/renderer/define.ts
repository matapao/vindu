// A component of vindu's catalog, on A2UI's Lit renderer: its own module, so the components (blocks.ts) and the surface
// that lists them (surface.ts) both import it, and neither imports the other.
import { nothing, type CSSResultGroup } from 'lit';
import { DynamicBooleanSchema, DynamicNumberSchema, DynamicStringListSchema, DynamicStringSchema, DynamicValueSchema } from '@a2ui/web_core/v0_9';
import { ColumnApi } from '@a2ui/web_core/v0_9/basic_catalog';
import { A2uiLitElement, type LitComponentApi } from '@a2ui/lit/v0_9';

/** How a prop arrives: a literal, or bound to the data model, as A2UI resolves it. "value" is any JSON (rows, objects). */
type Kind = 'string' | 'number' | 'boolean' | 'strings' | 'value';
/** What each kind of prop holds once A2UI has resolved it. */
type Resolved = { string: string; number: number; boolean: boolean; strings: string[]; value: unknown };
/** A component's props as its render gets them, each of its kind; one the surface leaves out comes as undefined. */
type PropsOf<P extends Record<string, Kind>> = { [K in keyof P]: Resolved[P[K]] };
const KINDS = { string: DynamicStringSchema, number: DynamicNumberSchema, boolean: DynamicBooleanSchema, strings: DynamicStringListSchema, value: DynamicValueSchema };
// Keep the basic catalog's validators for the two properties shared by its components.
const commonProps = ColumnApi.schema.pick({ weight: true, accessibility: true });

export type VinduComponent = { name: string; schema: unknown; tagName: string; element: CustomElementConstructor };

/** A component for vindu's catalog: its name in surfaces, its element's tag, its props, and how it draws them (given
 *  the element it draws in too, and so its document). Its styles are its own: A2UI scopes them to its tag. */
export function defineComponent<P extends Record<string, Kind>>(o: { name: string; tag: string; props: P; render: (props: PropsOf<P>, element: HTMLElement) => unknown; styles?: CSSResultGroup }): VinduComponent {
  const shape = Object.fromEntries(Object.entries(o.props).map(([key, kind]) => [key, KINDS[kind].optional()]));
  const api = { name: o.name, schema: commonProps.extend(shape) };
  class Element extends A2uiLitElement<typeof api, PropsOf<P>> {
    static tagName = o.tag;
    static override styles = o.styles;
    override createRenderRoot() { return this; } // light DOM, as A2UI's own components: the host's stylesheets reach inside
    override render() { return this.controller ? o.render(this.controller.props, this) : nothing; }
  }
  return { ...api, tagName: o.tag, element: Element } satisfies LitComponentApi;
}

