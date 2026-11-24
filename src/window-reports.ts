// What the window and the UI server tell each other about what was drawn, as types only, so the renderer (in the
// browser) and the server (in Node) share one definition: where each shown value is, to be read back after it is
// drawn; and what the person pointed at.

/** Where a shown value of a surface is, for the window to read back after it draws: a component (in a list, at the
 *  first row's data path), the text Vindu put there, which panel and field it is, and the tab it is in (A2UI draws only
 *  the tab that is open, so the rest are read when the person opens them). Charts and media draw things no text check
 *  can read, so they have none; a page or an app has its frame read: its size, and whether it loaded. */
export type Probe = { component: string; path?: string; expect: string; panel: string; field?: string; tab?: number; frame?: boolean };

/** What the window says was pointed at: a view, and inside it a panel (by id, or by its surface id pid) and a row, a
 *  node, a field, a span of text, a region; or a browser element, terminal lines, what a page or app reported. */
export type PointItem = {
  view: string;
  panel?: string;
  pid?: string;
  row?: number;
  node?: string;
  field?: number;
  value?: boolean;
  chart?: boolean;
  text?: string;
  start?: number;
  end?: number;
  region?: { x: number; y: number; w: number; h: number };
  time?: { start: number; end?: number };
  element?: string;
  role?: string;
  name?: string;
  url?: string;
  secret?: boolean;
  shared?: boolean;
  lines?: [number, number];
  command?: { n: number; command: string };
  page?: unknown;
  note?: string;
};
