/**
 * MCP Tool Handlers — houki-nta-mcp Phase 0 (スタブ)
 *
 * Phase 1 で本実装。現状は `resolve_abbreviation` のみ houki-abbreviations 経由で
 * 動作する。それ以外のツールは「未実装」レスポンスを返す。
 */

import { resolveAbbreviation } from '@shuji-bonji/houki-abbreviations';
import { NTA_HINT } from '../constants.js';
import type {
  SearchTsutatsuArgs,
  GetTsutatsuArgs,
  SearchQaArgs,
  GetQaArgs,
  SearchTaxAnswerArgs,
  GetTaxAnswerArgs,
} from '../types/index.js';

const NOT_IMPLEMENTED = {
  error: 'Phase 0 では未実装。Phase 1 で本実装予定。',
  status: 'not_implemented',
  see_also: 'https://github.com/shuji-bonji/houki-nta-mcp',
};

/**
 * nta_search_tsutatsu — 通達検索（Phase 0 スタブ）
 */
export async function handleNtaSearchTsutatsu(_args: SearchTsutatsuArgs) {
  return { ...NOT_IMPLEMENTED, tool: 'nta_search_tsutatsu' };
}

/**
 * nta_get_tsutatsu — 通達取得（Phase 0 スタブ）
 */
export async function handleNtaGetTsutatsu(_args: GetTsutatsuArgs) {
  return { ...NOT_IMPLEMENTED, tool: 'nta_get_tsutatsu' };
}

/**
 * nta_search_qa — 質疑応答事例検索（Phase 0 スタブ）
 */
export async function handleNtaSearchQa(_args: SearchQaArgs) {
  return { ...NOT_IMPLEMENTED, tool: 'nta_search_qa' };
}

/**
 * nta_get_qa — 質疑応答事例取得（Phase 0 スタブ）
 */
export async function handleNtaGetQa(_args: GetQaArgs) {
  return { ...NOT_IMPLEMENTED, tool: 'nta_get_qa' };
}

/**
 * nta_search_tax_answer — タックスアンサー検索（Phase 0 スタブ）
 */
export async function handleNtaSearchTaxAnswer(_args: SearchTaxAnswerArgs) {
  return { ...NOT_IMPLEMENTED, tool: 'nta_search_tax_answer' };
}

/**
 * nta_get_tax_answer — タックスアンサー取得（Phase 0 スタブ）
 */
export async function handleNtaGetTaxAnswer(_args: GetTaxAnswerArgs) {
  return { ...NOT_IMPLEMENTED, tool: 'nta_get_tax_answer' };
}

/**
 * resolve_abbreviation — 略称解決（houki-abbreviations 経由）
 *
 * 自分の管轄（source_mcp_hint === 'houki-nta'）以外のエントリは、
 * 「正しい MCP に誘導するヒント」と共に返す。
 */
export async function handleResolveAbbreviation(args: { abbr: string }) {
  const result = resolveAbbreviation(args.abbr);

  if (!result) {
    return {
      abbr: args.abbr,
      resolved: null,
      note: '辞書に該当なし。フル法令名でお試しください',
    };
  }

  // 自分の管轄か判定
  const isInScope = result.source_mcp_hint === NTA_HINT;
  return {
    abbr: args.abbr,
    resolved: result,
    in_scope: isInScope,
    ...(isInScope
      ? {}
      : {
          hint: `このエントリは ${result.source_mcp_hint} の管轄です。${result.source_mcp_hint}-mcp で取得してください。`,
        }),
  };
}

/**
 * Tool handlers map
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const toolHandlers: Record<string, (args: any) => Promise<unknown>> = {
  nta_search_tsutatsu: handleNtaSearchTsutatsu,
  nta_get_tsutatsu: handleNtaGetTsutatsu,
  nta_search_qa: handleNtaSearchQa,
  nta_get_qa: handleNtaGetQa,
  nta_search_tax_answer: handleNtaSearchTaxAnswer,
  nta_get_tax_answer: handleNtaGetTaxAnswer,
  resolve_abbreviation: handleResolveAbbreviation,
};
