// A component of vindu's catalog, on A2UI's Lit renderer: its own module, so the components (blocks.ts) and the surface
// that lists them (surface.ts) both import it, and neither imports the other.
import { nothing, type CSSResultGroup } from 'lit';
import { DynamicBooleanSchema, DynamicNumberSchema, DynamicStringListSchema, DynamicStringSchema, DynamicValueSchema } from '@a2ui/web_core/v0_9';
import { ColumnApi } from '@a2ui/web_core/v0_9/basic_catalog';
import { A2uiLitElement, type LitComponentApi } from '@a2ui/lit/v0_9';

/** How a prop arrives: a literal, or bound to the data model, as A2UI resolves it. "value" is any JSON (rows, objects). */
type Kind = 'string' | 'number' | 'boolean' | 'strings' | 'value';
const KINDS = { string: DynamicStringSchema, number: DynamicNumberSchema, boolean: DynamicBooleanSchema, strings: DynamicStringListSchema, value: DynamicValueSchema };
// Keep the basic catalog's validators for the two properties shared by its components.
const commonProps = ColumnApi.schema.pick({ weight: true, accessibility: true });

/* eslint-disable @typescript-eslint/no-explicit-any */
export type VinduComponent = { name: string; schema: unknown; tagName: string; element: CustomElementConstructor };

/** A component for vindu's catalog: its name in surfaces, its element's tag, its props, and how it draws them (given
 *  the element it draws in too, and so its document). Its styles are its own: A2UI scopes them to its tag. */
export function defineComponent(o: { name: string; tag: string; props: Record<string, Kind>; render: (props: Record<string, any>, element: HTMLElement) => unknown; styles?: CSSResultGroup }): VinduComponent {
  const shape = Object.fromEntries(Object.entries(o.props).map(([key, kind]) => [key, KINDS[kind].optional()]));
  const api = { name: o.name, schema: commonProps.extend(shape) };
  class Element extends A2uiLitElement<typeof api, Record<string, unknown>> {
    static tagName = o.tag;
    static styles = o.styles;
    createRenderRoot() { return this; } // light DOM, as A2UI's own components: the host's stylesheets reach inside
    render() { return this.controller ? o.render(this.controller.props, this) : nothing; }
  }
  return { ...api, tagName: o.tag, element: Element } satisfies LitComponentApi;
}

