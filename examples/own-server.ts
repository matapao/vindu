// A host's own UI server: its card, a library the pages a model writes may import by name, and panes sized for its
// screens. Vindu serves the task's MCP tools and reports what the person can see.
import path from 'node:path';
import { startVindu, type Library, type PageDriver } from '@matapao/vindu/server';
import { progress } from './progress-card.js';

// pinned and served here like Vindu's own: the files come from this folder, since a page cannot fetch from the network
export const SPARKLINE: Library = {
  name: 'sparkline',
  version: '1.0.0',
  license: 'MIT',
  dir: path.join(import.meta.dirname, 'lib'),
  imports: { sparkline: 'sparkline.js' },
};

export function startFjord(o: { driver?: PageDriver } = {}) {
  return startVindu({
    driver: o.driver,
    cards: [progress],
    libraries: [SPARKLINE],
    layout: { min: { w: 340, h: 200 }, single: 1120 }, // the panes' smallest size, and how wide a lone view may be
  });
}
