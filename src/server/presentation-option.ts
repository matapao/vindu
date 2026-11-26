// The host's say in how a window shows what its views hold (open's presentation and narrow, and setPresentation):
// checked as it is given, so a way that is none is refused before anything is drawn.
import type { Presentation, ShellPresentation } from '../shell-presentation.js';

const WAYS: readonly Presentation[] = ['auto', 'cards', 'content'];

/** What the host gave, as the shell takes it: each part given, checked; those left out stay as they are. Throws a
 *  RangeError for a way that is none, or a narrow that is not true or false. */
export function presentationGiven(
  as: unknown,
  o: { narrow?: unknown } = {},
): Partial<Pick<ShellPresentation, 'as' | 'narrow'>> {
  if (as !== undefined && !WAYS.includes(as as Presentation))
    throw new RangeError(`presentation: ${JSON.stringify(as)} is none; give ${WAYS.join(', ')}`);
  if (o.narrow !== undefined && typeof o.narrow !== 'boolean') throw new RangeError('narrow: true or false');
  return {
    ...(as === undefined ? {} : { as: as as Presentation }),
    ...(o.narrow === undefined ? {} : { narrow: o.narrow }),
  };
}
