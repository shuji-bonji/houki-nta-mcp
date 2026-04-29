/**
 * MCP Tool Handlers — houki-nta-mcp
 *
 * Phase 1c で `nta_get_tsutatsu` を本実装。`nta_search_*` / `nta_*_qa` /
 * `nta_*_tax_answer` は引き続きスタブ（Phase 1c 後半 / 1d で実装）。
 */

import { resolveAbbreviation } from '@shuji-bonji/houki-abbreviations';

import { NTA_HINT, TSUTATSU_LEGAL_STATUS, TSUTATSU_URL_ROOTS } from '../constants.js';
import { fetchNtaPage, NtaFetchError } from '../services/nta-scraper.js';
import { parseTsutatsuSection, TsutatsuParseError } from '../services/tsutatsu-parser.js';
import { renderClauseMarkdown } from '../services/tsutatsu-render.js';
import { buildSectionUrl, parseClauseNumber } from '../utils/clause.js';
import type {
  SearchTsutatsuArgs,
  GetTsutatsuArgs,
  SearchQaArgs,
  GetQaArgs,
  SearchTaxAnswerArgs,
  GetTaxAnswerArgs,
} from '../types/index.js';

const NOT_IMPLEMENTED = {
  error: '未実装。後続フェーズで本実装予定。',
  status: 'not_implemented',
  see_also: 'https://github.com/shuji-bonji/houki-nta-mcp',
};

/**
 * nta_search_tsutatsu — 通達検索（スタブ）
 *
 * Phase 1c では検索インデックスを持たないため未実装。
 * Phase 2 (bulk DL + SQLite FTS5) で本実装予定。
 */
export async function handleNtaSearchTsutatsu(_args: SearchTsutatsuArgs) {
  return { ...NOT_IMPLEMENTED, tool: 'nta_search_tsutatsu' };
}

/**
 * nta_get_tsutatsu — 通達取得
 *
 * フロー:
 *   1. `name` を houki-abbreviations で resolve（管轄外なら誘導 hint）
 *   2. formal 名から通達ルート URL を引く（未対応なら supported list を返す）
 *   3. `clause` をパース → `${root}{章}/{節}.htm` の URL を組み立て
 *   4. fetchNtaPage → parseTsutatsuSection
 *   5. 該当 clauseNumber を抽出（無ければページ内の利用可能 clause を返す）
 *   6. format=markdown / json に応じてレンダリング、`legal_status` を付与
 */
export async function handleNtaGetTsutatsu(args: GetTsutatsuArgs) {
  return getTsutatsu(args);
}

/**
 * `handleNtaGetTsutatsu` のテスト容易な内部関数。
 * `fetchImpl` を差し替えてユニットテストできるようにする。
 */
export async function getTsutatsu(
  args: GetTsutatsuArgs,
  options: { fetchImpl?: typeof fetch } = {}
) {
  // 1. 略称解決
  const resolved = resolveAbbreviation(args.name);
  if (!resolved) {
    return {
      error: `辞書に該当なし: "${args.name}"。略称または正式名で指定してください`,
      tool: 'nta_get_tsutatsu',
    };
  }

  // 1b. 管轄判定
  if (resolved.source_mcp_hint !== NTA_HINT) {
    return {
      error: `"${args.name}" は ${resolved.source_mcp_hint} の管轄です`,
      hint: `${resolved.source_mcp_hint}-mcp で取得してください`,
      resolved,
    };
  }

  // 2. 通達ルート URL の解決
  const rootUrl = TSUTATSU_URL_ROOTS[resolved.formal];
  if (!rootUrl) {
    return {
      error: `"${resolved.formal}" は houki-nta-mcp v0.0.x ではまだ未対応です`,
      supported: Object.keys(TSUTATSU_URL_ROOTS),
      resolved,
      tool: 'nta_get_tsutatsu',
    };
  }

  // 3. clause 必須チェック
  if (!args.clause) {
    return {
      error: 'clause を指定してください',
      hint: '例: "5-1-9" / "1-4-13の2" のような「章-節-条」形式で指定',
      resolved,
    };
  }
  const parsed = parseClauseNumber(args.clause);
  if (!parsed) {
    return {
      error: `clause の形式が不正: "${args.clause}"`,
      hint: '"5-1-9" / "1-4-13の2" のような「章-節-条」形式で指定してください',
    };
  }

  // 4. URL 組み立て + fetch + parse
  const url = buildSectionUrl(rootUrl, parsed.chapter, parsed.section);
  let html: string;
  let sourceUrl: string;
  let fetchedAt: string;
  try {
    const fetched = await fetchNtaPage(url, { fetchImpl: options.fetchImpl });
    html = fetched.html;
    sourceUrl = fetched.sourceUrl;
    fetchedAt = fetched.fetchedAt;
  } catch (err) {
    if (err instanceof NtaFetchError) {
      return {
        error: `国税庁サイトからの取得に失敗: ${err.message}`,
        url,
        ...(err.status !== undefined ? { status: err.status } : {}),
      };
    }
    throw err;
  }

  let section;
  try {
    section = parseTsutatsuSection(html, sourceUrl, fetchedAt);
  } catch (err) {
    if (err instanceof TsutatsuParseError) {
      return {
        error: `通達ページのパースに失敗: ${err.message}`,
        url,
      };
    }
    throw err;
  }

  // 5. 該当 clause を抽出
  const clause = section.clauses.find((c) => c.clauseNumber === args.clause);
  if (!clause) {
    return {
      error: `clause "${args.clause}" がページ内に見つかりません`,
      url,
      available_clauses: section.clauses.map((c) => c.clauseNumber),
    };
  }

  // 6. レンダリング
  if (args.format === 'json') {
    return {
      tsutatsu: resolved.formal,
      clause: {
        clauseNumber: clause.clauseNumber,
        title: clause.title,
        paragraphs: clause.paragraphs,
        fullText: clause.fullText,
      },
      sourceUrl: section.sourceUrl,
      fetchedAt: section.fetchedAt,
      legal_status: TSUTATSU_LEGAL_STATUS,
    };
  }
  // default: markdown
  return renderClauseMarkdown(clause, {
    sourceUrl: section.sourceUrl,
    fetchedAt: section.fetchedAt,
  });
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
