// Dependency lockfiles belong to the host, so some hosts load stock Zod 3 through A2UI, whose bounded arrays check
// every member before their bound (GHSA-mrhx-c7xc-m3w5; this workspace patches its own copy, patches/). Vindu's own
// drawing needs no more than surface-limits.ts: every surface is bounded before A2UI parses it, and neither A2UI's
// schemas nor Vindu's components bound an array. A host that extends the shared catalog with bounded schemas of its
// own does, and the renderer backports the gate to the array parser of A2UI's Zod when it starts (mountShell,
// mountWorkspace, and every draw), not when it is imported: importing the renderer leaves the host's Zod as it is.
// A2UI 0.15 represents JSON collections as arrays and never constructs a Zod Set schema.
import { DynamicStringSchema } from '@a2ui/web_core/v0_9';
import { addIssueToContext, INVALID, type ParseContext, type ParseInput, type ParseReturnType } from 'zod/v3';

type Bound = { value: number; message?: string };
interface ArrayParser {
  _def: { exactLength: Bound | null; maxLength: Bound | null };
  _getOrReturnCtx(input: ParseInput): ParseContext;
  _parse: (this: ArrayParser, input: ParseInput) => ParseReturnType<unknown>;
}
/** A schema of the Zod 3 whose arrays are guarded. */
type Member = { transform(f: (value: unknown) => unknown): { array(): { max(bound: number): { safeParse(data: unknown): unknown } } } };

/** Check an array's bound before its members, in the Zod 3 that member's schema comes from. Changes nothing where
 *  that Zod does so already, or was guarded before. */
export function guardArrays(member: Member) {
  let visited = false;
  const sample = member.transform(value => { visited = true; return value; }).array().max(0);
  sample.safeParse(['item']);
  if (!visited) return; // The installed parser already stops at its bound.

  const parser: ArrayParser = Object.getPrototypeOf(sample);
  const parse = parser._parse;
  parser._parse = function (input) {
    if (Array.isArray(input.data)) {
      const length = input.data.length;
      const exact = this._def.exactLength;
      const bound = exact && length > exact.value ? exact : this._def.maxLength;
      if (bound && length > bound.value) {
        addIssueToContext(this._getOrReturnCtx(input), {
          code: 'too_big', type: 'array', maximum: bound.value, inclusive: true, exact: bound === exact, message: bound.message,
        });
        return INVALID;
      }
    }
    return parse.call(this, input);
  };
}

let guarded = false;
/** The renderer's guard for A2UI's own Zod, the one a host's catalog shares: installed once. */
export function guardA2uiArrays() {
  if (guarded) return;
  guarded = true;
  guardArrays(DynamicStringSchema);
}
