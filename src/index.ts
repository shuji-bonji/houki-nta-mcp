#!/usr/bin/env node

/**
 * houki-nta-mcp Server / CLI エントリ
 *
 * 引数なしの場合は MCP サーバを stdio で起動。
 * `--bulk-download` 等のサブコマンドが指定された場合は CLI モードで動作（src/cli.ts）。
 *
 * v0.10.0 で MCP SDK v2 (`@modelcontextprotocol/server`) に移行。
 * サーバー本体は `src/server.ts` の `createServer()`。
 */

import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { runCliIfRequested } from './cli.js';
import { createServer } from './server.js';
import { logServerStarted } from './startup-log.js';
import { logger } from './utils/logger.js';

// Start server (or run CLI subcommand)
async function main() {
  // CLI モード（--bulk-download / --version / --help）が指定されていればそちらに分岐
  const handled = await runCliIfRequested(process.argv.slice(2));
  if (handled) return;

  // MCP server モード。serveStdio が transport を所有し、protocol version の交渉も行う。
  // factory は接続ごとに呼ばれる（stdio では 1 プロセス 1 接続）。stdin が閉じると exit 0。
  const handle = serveStdio(createServer);
  const shutdown = () => {
    void handle.close();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // 起動時のログ（started の行と、DB の場所の行。SPEC-NTA-CLI-ENTRY-009）
  logServerStarted();
}

main().catch((error) => {
  logger.error('server', 'fatal error', error);
  process.exit(1);
});
