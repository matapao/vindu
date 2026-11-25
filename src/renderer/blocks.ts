// vindu's blocks in the window: one component each, for the cards of blocks.ts, and one for a table with notes. Each
// draws the exact rows it is sent, written by the same rules as the cards (format.ts), in the process's locale and time
// zone. Every row it draws carries data-panel and data-row, so what the person points at is found by reference, never
// read from the screen. A block that lets the person act (a device's switch, a table's head) sends a vindu-action
// event; the shell carries it to the UI server.
import type { VinduComponent } from './define.js';
import { VMessages, VDocument } from './blocks/communications.js';
import { VEvents } from './blocks/calendar.js';
import { VNotice } from './blocks/notice.js';
import { VTasks } from './blocks/tasks.js';
import { VFiles, VMap, VContacts } from './blocks/records.js';
import { VMoney } from './blocks/money.js';
import { VSheet } from './blocks/sheet.js';
import { VNotedTable } from './blocks/table.js';
import { VSlides, VSignature, VDiagram } from './blocks/presentation.js';
import { VDevices, VBatch, VChanges, VDecision } from './blocks/operations.js';
import { VMediaMarks, VChart } from './blocks/media.js';
import { VGallery } from './blocks/gallery.js';
/** vindu's blocks, for the window's catalog: drawSurface and mountShell include them unless a host leaves them out. */
export const BLOCK_COMPONENTS: VinduComponent[] = [
  VChart,
  VMessages,
  VDocument,
  VEvents,
  VNotice,
  VTasks,
  VMoney,
  VFiles,
  VMap,
  VContacts,
  VSheet,
  VSlides,
  VSignature,
  VDiagram,
  VDevices,
  VBatch,
  VChanges,
  VDecision,
  VMediaMarks,
  VGallery,
  VNotedTable,
];
