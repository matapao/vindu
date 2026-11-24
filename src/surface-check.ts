// Check a compiled Vindu view before recording it as shown. No DOM or renderer is required.
import { Catalog, ComponentModel, DataModel, SurfaceComponentsModel, type ComponentChildRefs } from '@a2ui/web_core/v0_9';
import { basicCatalog } from '@a2ui/web_core/v0_9/basic_catalog';
import type { Component, Surface } from './a2ui.js';
import { VINDU_CATALOG, componentsOf, dataModelOf } from './catalog-id.js';
import { MAX_SURFACE_NODES, withinSurfaceLimits } from './surface-limits.js';

// Host-defined schemas live in the renderer. Preserve their original child-slot convention here.
const hostCatalog = new Catalog(VINDU_CATALOG, '0.9');
const hostSlots: ComponentChildRefs = {
  singleRefs: new Set(['child']),
  listRefs: new Set(['children', 'tabs']),
  nestedRefs: { tabs: new Set(['child']) },
};

function checkBindings(graph: SurfaceComponentsModel, model: DataModel, errors: string[]) {
  const checked = new Map<string, Set<string>>();
  let count = 0;

  function visit(id: string, context: string) {
    // A small component graph can expand into many row contexts through shared templates.
    if (++count > MAX_SURFACE_NODES) throw new Error('surface exceeds the rendering limits');
    const node = graph.get(id);
    if (!node) {
      errors.push(`missing component ${id}`);
      return;
    }
    // A component shared by two lists must be checked in each different row context.
    const contexts = checked.get(id) ?? new Set<string>();
    if (contexts.has(context)) return;
    checked.set(id, contexts.add(context));

    const props = node.properties;
    for (const [key, value] of Object.entries(props)) {
      if (key === 'children' || !value || typeof value !== 'object' || !('path' in value)) continue;
      const path = value.path;
      if (typeof path !== 'string' || model.get(DataModel.resolvePath(path, context)) === undefined) {
        errors.push(`${id}.${key} reads ${path}, which is empty`);
      }
    }
    // A2UI renders the child template once for each item. Probe the same first row as probesFor().
    const template = props.children;
    let rowContext = context;
    if (template && typeof template === 'object' && typeof template.path === 'string') {
      const listPath = DataModel.resolvePath(template.path, context);
      if (!Array.isArray(model.get(listPath))) errors.push(`${id} lists ${template.path}, which is not a list`);
      rowContext = DataModel.resolvePath('0', listPath);
    }
    for (const [child, slot] of graph.getChildReferences(id)) {
      visit(child, slot === 'children.componentId' ? rowContext : context);
    }
  }
  visit('root', '/');
}

/** Check references and the data bindings a person will actually see. Returns diagnostics for the host. */
export function checkSurface(surface: Surface): string[] {
  if (!withinSurfaceLimits(surface)) return ['surface exceeds the rendering limits'];
  const components = componentsOf(surface) as Component[] | undefined;
  if (!Array.isArray(components)) return ['missing component update'];

  const errors: string[] = [];
  const hostRefs: Record<string, ComponentChildRefs> = Object.create(null);
  const graph = new SurfaceComponentsModel(hostRefs);
  try {
    for (const component of components) {
      const { id, component: type, ...props } = component;
      if (graph.has(id)) {
        errors.push(`duplicate id ${id}`);
        graph.removeComponent(id);
      }
      const catalog = basicCatalog.components.has(type) ? basicCatalog : hostCatalog;
      if (catalog === hostCatalog) hostRefs[type] = hostSlots;
      graph.addComponent(new ComponentModel(id, type, props, catalog));
    }
    const reachable = graph.detectCycles();
    const model = new DataModel(dataModelOf(surface));
    checkBindings(graph, model, errors);
    for (const id of graph.keys) if (!reachable.has(id)) errors.push(`unreached component ${id}`);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    graph.dispose();
  }
  return errors;
}
