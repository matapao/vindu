// Bound first-party preflight and A2UI's renderer before either allocates graph or validation state.
export const MAX_SURFACE_NODES = 100_000;

export function withinSurfaceLimits(surface: unknown): boolean {
  let nodes = 0;

  function visit(value: unknown, depth: number): boolean {
    if (++nodes > MAX_SURFACE_NODES || depth > 64) return false;
    if (!value || typeof value !== 'object') return true;
    if (Array.isArray(value)) return value.length <= 8192 && value.every(item => visit(item, depth + 1));
    const record = value as Record<string, unknown>;
    for (const key in record) {
      if (Object.hasOwn(record, key) && !visit(record[key], depth + 1)) return false;
    }
    return true;
  }

  return visit(surface, 0);
}
