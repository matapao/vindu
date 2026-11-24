import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { HINTS } from '../operations.js';
import { Shell } from '../shell.js';
import { registerArrange, registerInspectionTools } from './inspection-tools.js';
import { hasOf, INSTRUCTIONS, viewsText } from './instructions.js';
import { registerOperationTools } from './operation-tools.js';
import { registerPageCheck } from './page-checks.js';
import { json } from './records.js';
import { registerShowTools } from './show-tools.js';
import type { Session } from './state.js';

export const serverFor = (session: Session): McpServer => {
  const has = hasOf(session.live); // the model is told of terminals and pages only where this window has them
  const server = new McpServer(
    { name: 'ui', version: '0.3.0' },
    { instructions: INSTRUCTIONS + viewsText(has) },
  );

  registerShowTools(server, session, has);
  registerPageCheck(server, session);
  registerArrange(server, session);
  registerInspectionTools(server, session, has);
  registerOperationTools(server, session);
  return server;
};

export const layoutServerFor = (shell: Shell): McpServer => {
  const server = new McpServer({ name: 'ui_layout', version: '0.3.0' });
  server.registerTool(
    'read_layout',
    {
      inputSchema: z.strictObject({}),
      annotations: HINTS.read,
    },
    () => json(shell.layoutGeometry()),
  );
  return server;
};
