/**
 * MCP Tool Handlers — houki-nta-mcp
 *
 * Phase 1c で `nta_get_tsutatsu` を本実装。
 * Phase 1e で `nta_get_tax_answer` / `nta_get_qa` を本実装。
 * `nta_search_*` 系は Phase 2 (bulk DL + FTS5) で対応予定。
 */

import { resolveAbbreviation } from '@shuji-bonji/houki-abbreviations';

import {
  NTA_GENERAL_INFO_LEGAL_STATUS,
  NTA_HINT,
  QA_BASE_URL,
  QA_TOPICS,
  TAX_ANSWER_BASE_URL,
  TAX_ANSWER_FOLDER_MAP,
  TSUTATSU_LEGAL_STATUS,
  TSUTATSU_URL_ROOTS,
} from '../constants.js';
import type { QaTopic } from '../constants.js';
import { fetchNtaPage, NtaFetchError } from '../services/nta-scraper.js';
import { parseQaJirei } from '../services/qa-parser.js';
import { parseTaxAnswer } from '../services/tax-answer-parser.js';
import { renderQaMarkdown, renderTaxAnswerMarkdown } from '../services/tax-answer-render.js';
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
      error: `"${resolved.formal}" は houki-nta-mcp v0.1.x では未対応です`,
      hint:
        '他通達（所基通・法基通・相基通 等）は URL 規則と clause 番号体系（章-節-条 vs 条-項）' +
        'が消基通と異なるため、TOC 事前 DL を要する Phase 2 (bulk DL + SQLite) で一括対応予定。',
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
 * nta_search_qa — 質疑応答事例検索（スタブ）
 *
 * Phase 1e では検索インデックスを持たないため未実装。Phase 2 (FTS5) で対応。
 */
export async function handleNtaSearchQa(_args: SearchQaArgs) {
  return { ...NOT_IMPLEMENTED, tool: 'nta_search_qa' };
}

/**
 * nta_get_qa — 質疑応答事例取得（Phase 1e 本実装）
 */
export async function handleNtaGetQa(args: GetQaArgs) {
  return getQa(args);
}

/**
 * `handleNtaGetQa` のテスト容易な内部関数。
 */
export async function getQa(args: GetQaArgs, options: { fetchImpl?: typeof fetch } = {}) {
  const topic = args.topic;
  if (!QA_TOPICS.includes(topic as QaTopic)) {
    return {
      error: `topic "${topic}" は houki-nta-mcp では未対応です`,
      hint: '対応税目: shotoku, gensen, joto, sozoku, hyoka, hojin, shohi, inshi, hotei',
    };
  }
  if (!args.category || !args.id) {
    return {
      error: 'category と id を両方指定してください',
      hint: '/law/shitsugi/{topic}/01.htm の TOC ページで category 番号と事例番号を確認',
    };
  }

  // パディングを綺麗に: "2" → "02" に揃える（実 URL は 2 桁ゼロ埋めが多い）
  const category = args.category.padStart(2, '0');
  const id = args.id.padStart(2, '0');
  const url = `${QA_BASE_URL}${topic}/${category}/${id}.htm`;

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

  let qa;
  try {
    qa = parseQaJirei({
      html,
      sourceUrl,
      fetchedAt,
      topic: topic as QaTopic,
      category,
      id,
    });
  } catch (err) {
    if (err instanceof TsutatsuParseError) {
      return {
        error: `質疑応答事例ページのパースに失敗: ${err.message}`,
        url,
      };
    }
    throw err;
  }

  if (args.format === 'json') {
    return {
      qa,
      legal_status: NTA_GENERAL_INFO_LEGAL_STATUS,
    };
  }
  return renderQaMarkdown(qa);
}

/**
 * nta_search_tax_answer — タックスアンサー検索（スタブ）
 *
 * Phase 1e では検索インデックスを持たないため未実装。Phase 2 (FTS5) で対応。
 */
export async function handleNtaSearchTaxAnswer(_args: SearchTaxAnswerArgs) {
  return { ...NOT_IMPLEMENTED, tool: 'nta_search_tax_answer' };
}

/**
 * nta_get_tax_answer — タックスアンサー取得（Phase 1e 本実装）
 */
export async function handleNtaGetTaxAnswer(args: GetTaxAnswerArgs) {
  return getTaxAnswer(args);
}

/**
 * `handleNtaGetTaxAnswer` のテスト容易な内部関数。
 */
export async function getTaxAnswer(
  args: GetTaxAnswerArgs,
  options: { fetchImpl?: typeof fetch } = {}
) {
  const no = args.no?.trim();
  if (!no || !/^\d+$/.test(no)) {
    return {
      error: `タックスアンサー番号は数字で指定してください: "${args.no}" は不正`,
      hint: '例: "6101" (消費税の基本的なしくみ), "1120" (医療費控除)',
    };
  }
  const folder = TAX_ANSWER_FOLDER_MAP[no[0]];
  if (!folder) {
    return {
      error: `番号 "${no}" の先頭桁 "${no[0]}" は houki-nta-mcp v0.2.x では未対応`,
      hint: '対応番号帯: 1xxx=所得税, 2xxx=源泉, 3xxx=譲渡, 4xxx=相続・贈与, 5xxx=法人税, 6xxx=消費税, 7xxx=印紙税, 9xxx=お知らせ。8xxx 帯は未対応（Phase 2 で対応予定）',
    };
  }

  const url = `${TAX_ANSWER_BASE_URL}${folder}/${no}.htm`;

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

  let taxAnswer;
  try {
    taxAnswer = parseTaxAnswer(html, sourceUrl, fetchedAt);
  } catch (err) {
    if (err instanceof TsutatsuParseError) {
      return {
        error: `タックスアンサーページのパースに失敗: ${err.message}`,
        url,
      };
    }
    throw err;
  }

  if (args.format === 'json') {
    return {
      taxAnswer,
      legal_status: NTA_GENERAL_INFO_LEGAL_STATUS,
    };
  }
  return renderTaxAnswerMarkdown(taxAnswer);
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
