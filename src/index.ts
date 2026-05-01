#!/usr/bin/env node

/**
 * houki-nta-mcp Server / CLI エントリ
 *
 * 引数なしの場合は MCP サーバを stdio で起動。
 * `--bulk-download` 等のサブコマンドが指定された場合は CLI モードで動作（src/cli.ts）。
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { runCliIfRequested } from './cli.js';
import { tools } from './tools/definitions.js';
import { toolHandlers } from './tools/handlers.js';
import { PACKAGE_INFO } from './config.js';
import { logger } from './utils/logger.js';

// Server instance
const server = new Server(
  {
    name: PACKAGE_INFO.name,
    version: PACKAGE_INFO.version,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Execute tool
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const handler = toolHandlers[name];
    if (!handler) {
      throw new Error(`Unknown tool: ${name}`);
    }

    const result = await handler(args);
    return {
      content: [
        {
          type: 'text',
          text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }],
      isError: true,
    };
  }
});

// Start server (or run CLI subcommand)
async function main() {
  // CLI モード（--bulk-download / --version / --help）が指定されていればそちらに分岐
  const handled = await runCliIfRequested(process.argv.slice(2));
  if (handled) return;

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info(
    'server',
    `${PACKAGE_INFO.name} v${PACKAGE_INFO.version} started (Phase 2a/2b: bulk DL + SQLite ready)`
  );
}

main().catch((error) => {
  logger.error('server', 'fatal error', error instanceof Error ? error : new Error(String(error)));
  process.exit(1);
});
