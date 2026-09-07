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
import { PACKAGE_INFO } from './config.js';
import { createServer } from './server.js';
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
  logger.info(
    'server',
    `${PACKAGE_INFO.name} v${PACKAGE_INFO.version} started (MCP SDK v2 / Phase 4 self-feedback: kind 別 reader_hints + extract_tables 推奨 + 「新旧対応表」表記ゆれ対応 / Phase 4-2: has_pdf filter / nta_inspect_pdf_meta / Phase 4-1: PDF kind classification / Phase 5: Resilience + Lv-3a soft-404 detection + Lv-3b menu.htm baseline drift)`
  );
}

main().catch((error) => {
  logger.error('server', 'fatal error', error instanceof Error ? error : new Error(String(error)));
  process.exit(1);
});
