/**
 * MCP サーバー本体（factory）。
 *
 * 低レベル `Server` を維持し、tools/call の family error contract
 * (UNKNOWN_TOOL / INVALID_ARGUMENT / INTERNAL_ERROR の JSON 化 + isError) はこのファイルに置く。
 * `src/index.ts`（bin エントリ）が `serveStdio(createServer)` で起動するほか、
 * テストからは `InMemoryTransport` で in-process 起動する。
 *
 * houki-egov-mcp v0.5.3 の src/server.ts と同じ構成。
 */

import { Server } from '@modelcontextprotocol/server';
import { PACKAGE_INFO } from './config.js';
import { isLawServiceError, makeError } from './errors.js';
import { tools } from './tools/definitions.js';
import { toolHandlers } from './tools/handlers.js';
import { logger } from './utils/logger.js';

/**
 * MCP サーバーを組み立てる factory。
 * `serveStdio` に渡すほか、テストから `InMemoryTransport` で in-process 起動するために export する。
 */
export function createServer(): Server {
  const server = new Server(
    {
      name: PACKAGE_INFO.name,
      version: PACKAGE_INFO.version,
    },
    {
      // SDK v2 の低レベル Server は capabilities を推論しない。
      // 省略すると setRequestHandler('tools/list') が throw する。
      capabilities: {
        tools: {},
      },
    }
  );

  // List tools
  server.setRequestHandler('tools/list', async () => {
    return { tools };
  });

  // Execute tool
  server.setRequestHandler('tools/call', async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const handler = toolHandlers[name];
      if (!handler) {
        // v0.23.0（T5）: houki-egov-mcp と同じ日本語の文と retryable: false（SPEC-NTA-COMMON-ERRORS-002）
        const err = makeError('UNKNOWN_TOOL', `存在しないツールです: ${name}`, {
          hint: `利用可能なツール: ${Object.keys(toolHandlers).join(', ')}`,
          retryable: false,
          next_actions: [
            {
              action: 'list_tools',
              reason: 'MCP の tools/list で利用可能ツールを確認できます',
            },
          ],
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(err, null, 2) }],
          isError: true,
        };
      }

      // 引数の検証は handler の中（src/tools/tool-args.ts の bindTool）で行う。
      // 検証に失敗すると INVALID_ARGUMENT の LawServiceError が返り、下で isError: true になる
      const result = await handler(args);

      // handler が LawServiceError を返した場合は isError: true を立てる
      // これにより MCP クライアント / LLM 側でエラーかどうかを判別しやすくする
      const isError = isLawServiceError(result);

      return {
        content: [
          {
            type: 'text',
            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
          },
        ],
        ...(isError ? { isError: true } : {}),
      };
    } catch (error) {
      // 想定外の例外（バグ等）。INTERNAL_ERROR として LLM 可読形に変換。
      // v0.23.0（T5）: 同じ呼び出しをやり直しても結果は変わらないので retryable: false にし、
      // 再試行の案内（retry_later）は付けない（SPEC-NTA-COMMON-ERRORS-006、houki-egov-mcp と同じ）
      const cause = error instanceof Error ? error.message : String(error);
      const err = makeError('INTERNAL_ERROR', `内部エラーが発生しました: ${cause}`, {
        hint: 'バグの可能性があります。再現手順を添えて GitHub issue でご報告ください',
        retryable: false,
        detail: { cause },
        tool: name,
      });
      logger.error('server', `tool ${name} threw`, error);
      return {
        content: [{ type: 'text', text: JSON.stringify(err, null, 2) }],
        isError: true,
      };
    }
  });

  return server;
}
