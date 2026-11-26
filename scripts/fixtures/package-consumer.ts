import { mountWorkspace } from '@matapao/vindu';
import { browserPane } from '@matapao/vindu/renderer/browser';
import { terminalPane } from '@matapao/vindu/renderer/terminal';
import { playwrightDriver } from '@matapao/vindu/playwright';
import { DynamicStringSchema } from '@a2ui/web_core/v0_9';

export async function check() {
  for (const factory of [browserPane, terminalPane, playwrightDriver]) {
    if (typeof factory !== 'function') throw new Error('A public SDK entry point is missing');
  }
  const workspace = mountWorkspace(document.body);
  const mounted = workspace.views.isConnected;
  workspace.destroy();

  // A host extending the shared catalog uses the same parser as Vindu's renderer.
  let visited = 0;
  const schema = DynamicStringSchema.transform((value) => {
    visited++;
    return value;
  })
    .array()
    .max(1);
  const valid = schema.safeParse(['item']).success;
  const overLimit = (await schema.safeParseAsync(['one', 'two'])).success;
  return { mounted, valid, overLimit, visited };
}
