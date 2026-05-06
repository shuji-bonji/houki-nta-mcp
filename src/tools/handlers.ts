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
import { closeDb, openDb } from '../db/index.js';
import {
  getClauseFromDb,
  hasAnyClause,
  listAvailableClauses,
  searchClauseFts,
} from '../services/db-search.js';
import type { ClauseRow } from '../services/db-search.js';
import { writeBackLiveSection } from '../services/bulk-downloader.js';
import {
  summarizeFreshnessFromDocument,
  summarizeFreshnessFromSection,
} from '../services/freshness.js';
import { fetchNtaPage, NtaFetchError } from '../services/nta-scraper.js';
import { parseQaJirei } from '../services/qa-parser.js';
import { parseTaxAnswer } from '../services/tax-answer-parser.js';
import { renderAttachedPdfsMarkdown } from '../services/pdf-meta.js';
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

// NOT_IMPLEMENTED は v0.5.0-alpha.1 で全 search 系ハンドラが本実装になり、未使用に。
// 将来また「未実装スタブ」を作る際は復活させる。

/**
 * nta_search_tsutatsu — 通達検索（Phase 2c 本実装）
 *
 * ローカル DB の FTS5 (trigram) で全文検索する。事前に
 * `houki-nta-mcp --bulk-download` で DB を構築しておく必要がある。
 */
export async function handleNtaSearchTsutatsu(args: SearchTsutatsuArgs) {
  return searchTsutatsu(args);
}

/**
 * `handleNtaSearchTsutatsu` のテスト容易な内部関数。
 *
 * `dbPath` を `:memory:` などにしてテストから呼べる。
 */
export async function searchTsutatsu(args: SearchTsutatsuArgs, options: { dbPath?: string } = {}) {
  const keyword = args.keyword?.trim();
  if (!keyword) {
    return { error: 'keyword を指定してください' };
  }

  const db = openDb(options.dbPath);
  try {
    if (!hasAnyClause(db)) {
      return {
        error: 'ローカル DB に検索対象がありません',
        hint: '初回は `houki-nta-mcp --bulk-download` を実行して通達一式をローカル DB に投入してください（消費税法基本通達: 約 100 秒）',
        tool: 'nta_search_tsutatsu',
      };
    }

    const limit = Math.min(Math.max(args.limit ?? 10, 1), 50);
    const hits = searchClauseFts(db, keyword, { limit });

    if (hits.length === 0) {
      return {
        keyword,
        hits: [],
        message: `"${keyword}" にマッチする clause はありません`,
      };
    }

    // Phase 5 Resilience: section テーブルから freshness を取得（4 通達横断、tsutatsu 絞り込みなし）
    const freshness = summarizeFreshnessFromSection(db, undefined, '`--bulk-download-all`');
    return {
      keyword,
      count: hits.length,
      hits: hits.map((h) => ({
        tsutatsu: h.tsutatsu,
        abbr: h.abbr,
        clauseNumber: h.clauseNumber,
        title: h.title,
        snippet: h.snippet,
        sourceUrl: h.sourceUrl,
      })),
      ...(freshness ? { freshness } : {}),
      legal_status: TSUTATSU_LEGAL_STATUS,
    };
  } finally {
    closeDb(db);
  }
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
 *
 * フロー（Phase 2d 以降）:
 *   1. 略称解決 + 管轄判定
 *   2. **DB lookup**: bulk DL 済みなら DB から即時応答（fetch なし）
 *   3. DB miss なら **ライブ取得**: TSUTATSU_URL_ROOTS にあれば fetch + parse
 *   4. どちらも無ければ、bulk DL を促す hint を返す
 *
 * `fetchImpl` を差し替えてユニットテストできる。`dbPath` で in-memory DB 注入も可。
 */
export async function getTsutatsu(
  args: GetTsutatsuArgs,
  options: { fetchImpl?: typeof fetch; dbPath?: string } = {}
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

  // 2. clause 必須チェック
  if (!args.clause) {
    return {
      error: 'clause を指定してください',
      hint: '例: "5-1-9" / "1-4-13の2"（消基通スタイル）/ "2-4の2"（所基通スタイル）',
      resolved,
    };
  }

  // 3. DB lookup を試みる（bulk DL 済みなら即時応答）
  const db = openDb(options.dbPath);
  try {
    const dbHit = getClauseFromDb(db, resolved.formal, args.clause);
    if (dbHit) {
      return renderDbHit(dbHit, args.format, resolved.formal);
    }

    // 4. DB に formal_name エントリ自体があるが該当 clause が無い場合は available_clauses を返す
    if (hasAnyClause(db, resolved.formal)) {
      return {
        error: `clause "${args.clause}" は DB 内の "${resolved.formal}" に見つかりません`,
        hint: '別の clause 番号を試すか、`--bulk-download` で再取得してください（最新の改正反映用）',
        available_clauses: listAvailableClauses(db, resolved.formal, 50),
      };
    }
  } finally {
    closeDb(db);
  }

  // 5. DB miss → ライブ取得経路へフォールバック
  const rootUrl = TSUTATSU_URL_ROOTS[resolved.formal];
  if (!rootUrl) {
    return {
      error: `"${resolved.formal}" は DB にも未投入で、ライブ取得用 URL も未登録です`,
      hint:
        `先に \`houki-nta-mcp --bulk-download --tsutatsu="${resolved.formal}"\` を実行して ` +
        'DB に投入してください（Phase 2d 以降は他通達も bulk DL 経由で対応）。',
      supported_for_live: Object.keys(TSUTATSU_URL_ROOTS),
      resolved,
      tool: 'nta_get_tsutatsu',
    };
  }

  const parsed = parseClauseNumber(args.clause);
  if (!parsed) {
    return {
      error: `clause の形式が不正: "${args.clause}"`,
      hint:
        'ライブ取得には「章-節-条」形式（例: "5-1-9" / "1-4-13の2"）が必要です。' +
        '他通達体系（条-項）の場合は `--bulk-download` で DB 投入してください',
    };
  }

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

  const clause = section.clauses.find((c) => c.clauseNumber === args.clause);
  if (!clause) {
    return {
      error: `clause "${args.clause}" がページ内に見つかりません`,
      url,
      available_clauses: section.clauses.map((c) => c.clauseNumber),
    };
  }

  // Write-through cache: ライブ取得した section の clauses 一式を DB に書き戻す。
  // 次回以降の同 section に対する get/search が DB lookup でヒットする。
  // best effort で動作するため、失敗してもこの応答経路には影響しない。
  try {
    const writeBackDb = openDb(options.dbPath);
    try {
      writeBackLiveSection(writeBackDb, {
        formalName: resolved.formal,
        abbr: resolved.abbr,
        rootUrl,
        chapterNumber: parsed.chapter,
        sectionNumber: parsed.section,
        sectionUrl: section.sourceUrl,
        fetchedAt: section.fetchedAt,
        sectionTitle: section.sectionTitle,
        chapterTitle: section.chapterTitle,
        clauses: section.clauses,
      });
    } finally {
      closeDb(writeBackDb);
    }
  } catch {
    // best effort: write-through cache 失敗は無視（応答に影響なし）
  }

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
      source: 'live' as const,
      legal_status: TSUTATSU_LEGAL_STATUS,
    };
  }
  return renderClauseMarkdown(clause, {
    sourceUrl: section.sourceUrl,
    fetchedAt: section.fetchedAt,
  });
}

/**
 * DB ヒットを既存の Markdown / JSON レンダラに合わせて返す。
 * fullText / paragraphs を持っているので renderClauseMarkdown にそのまま渡せる。
 */
function renderDbHit(row: ClauseRow, format: GetTsutatsuArgs['format'], tsutatsu: string) {
  if (format === 'json') {
    return {
      tsutatsu,
      clause: {
        clauseNumber: row.clauseNumber,
        title: row.title,
        paragraphs: row.paragraphs,
        fullText: row.fullText,
      },
      sourceUrl: row.sourceUrl,
      fetchedAt: row.fetchedAt,
      source: 'db' as const,
      legal_status: TSUTATSU_LEGAL_STATUS,
    };
  }
  return renderClauseMarkdown(
    {
      clauseNumber: row.clauseNumber,
      title: row.title,
      paragraphs: row.paragraphs,
      fullText: row.fullText,
    },
    { sourceUrl: row.sourceUrl, fetchedAt: row.fetchedAt }
  );
}

/**
 * nta_search_qa — 質疑応答事例検索（スタブ）
 *
 * Phase 1e では検索インデックスを持たないため未実装。Phase 2 (FTS5) で対応。
 */
export async function handleNtaSearchQa(args: SearchQaArgs, options: { dbPath?: string } = {}) {
  const limit = args.limit ?? 10;
  const db = openDb(options.dbPath);
  try {
    const opts: { docType: 'qa-jirei'; limit: number; taxonomy?: string } = {
      docType: 'qa-jirei',
      limit,
    };
    if (args.domain) opts.taxonomy = args.domain;
    const hits = searchDocumentFts(db, args.keyword, opts);
    if (hits.length === 0) {
      return {
        results: [],
        keyword: args.keyword,
        hint: '該当なし。`--bulk-download-qa` で DB 投入済みか確認してください',
        legal_status: NTA_GENERAL_INFO_LEGAL_STATUS,
      };
    }
    const taxonomyFilter = args.domain ? [args.domain] : undefined;
    const freshness = summarizeFreshnessFromDocument(
      db,
      'qa-jirei',
      taxonomyFilter,
      '`--bulk-download-qa`'
    );
    return {
      keyword: args.keyword,
      results: hits.map((h) => ({
        docType: h.docType,
        docId: h.docId,
        taxonomy: h.taxonomy,
        title: h.title,
        sourceUrl: h.sourceUrl,
        snippet: h.snippet,
      })),
      ...(freshness ? { freshness } : {}),
      legal_status: NTA_GENERAL_INFO_LEGAL_STATUS,
    };
  } finally {
    closeDb(db);
  }
  // 旧スタブ参考: NOT_IMPLEMENTED;
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
export async function handleNtaSearchTaxAnswer(
  args: SearchTaxAnswerArgs,
  options: { dbPath?: string } = {}
) {
  const limit = args.limit ?? 10;
  const db = openDb(options.dbPath);
  try {
    const hits = searchDocumentFts(db, args.keyword, {
      docType: 'tax-answer',
      limit,
    });
    if (hits.length === 0) {
      return {
        results: [],
        keyword: args.keyword,
        hint: '該当なし。`--bulk-download-tax-answer` で DB 投入済みか確認してください',
        legal_status: NTA_GENERAL_INFO_LEGAL_STATUS,
      };
    }
    const freshness = summarizeFreshnessFromDocument(
      db,
      'tax-answer',
      undefined,
      '`--bulk-download-tax-answer`'
    );
    return {
      keyword: args.keyword,
      results: hits.map((h) => ({
        docType: h.docType,
        docId: h.docId,
        taxonomy: h.taxonomy,
        title: h.title,
        sourceUrl: h.sourceUrl,
        snippet: h.snippet,
      })),
      ...(freshness ? { freshness } : {}),
      legal_status: NTA_GENERAL_INFO_LEGAL_STATUS,
    };
  } finally {
    closeDb(db);
  }
  // 旧スタブ参考: NOT_IMPLEMENTED;
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

/* -------------------------------------------------------------------------- */
/* Phase 3b: 改正通達ハンドラ                                                  */
/* -------------------------------------------------------------------------- */

import {
  searchDocumentFts,
  getDocumentFromDb,
  listAvailableDocIds,
} from '../services/db-search.js';
import type {
  GetKaiseiTsutatsuArgs,
  SearchKaiseiTsutatsuArgs,
  GetJimuUneiArgs,
  SearchJimuUneiArgs,
  GetBunshokaitouArgs,
  SearchBunshokaitouArgs,
} from '../types/index.js';

/**
 * 改正通達の FTS5 検索。事前に `--bulk-download-kaisei` で DB 投入が必要。
 */
export async function handleNtaSearchKaiseiTsutatsu(
  args: SearchKaiseiTsutatsuArgs,
  options: { dbPath?: string } = {}
) {
  const limit = args.limit ?? 10;
  const db = openDb(options.dbPath);
  try {
    const opts: { docType: 'kaisei'; limit: number; taxonomy?: string } = {
      docType: 'kaisei',
      limit,
    };
    if (args.taxonomy !== undefined) opts.taxonomy = args.taxonomy;
    const hits = searchDocumentFts(db, args.keyword, opts);

    if (hits.length === 0) {
      return {
        results: [],
        keyword: args.keyword,
        hint:
          '該当なし。`--bulk-download-kaisei` で DB 投入済みか確認してください。' +
          ' 別キーワードで再試行も推奨',
        legal_status: TSUTATSU_LEGAL_STATUS,
      };
    }

    const taxonomyFilter = args.taxonomy !== undefined ? [args.taxonomy] : undefined;
    const freshness = summarizeFreshnessFromDocument(
      db,
      'kaisei',
      taxonomyFilter,
      '`--bulk-download-kaisei`'
    );
    return {
      keyword: args.keyword,
      results: hits.map((h) => ({
        docType: h.docType,
        docId: h.docId,
        taxonomy: h.taxonomy,
        title: h.title,
        issuedAt: h.issuedAt,
        sourceUrl: h.sourceUrl,
        snippet: h.snippet,
      })),
      ...(freshness ? { freshness } : {}),
      legal_status: TSUTATSU_LEGAL_STATUS,
    };
  } finally {
    closeDb(db);
  }
}

/**
 * 改正通達を docId で取得する（DB 経由）。
 */
export async function handleNtaGetKaiseiTsutatsu(
  args: GetKaiseiTsutatsuArgs,
  options: { dbPath?: string } = {}
) {
  const db = openDb(options.dbPath);
  try {
    const doc = getDocumentFromDb(db, 'kaisei', args.docId);
    if (!doc) {
      return {
        error: `改正通達 docId="${args.docId}" は DB に未投入です`,
        hint: '`houki-nta-mcp --bulk-download-kaisei` で 4 通達分の改正通達を投入してください',
        available_doc_ids: listAvailableDocIds(db, 'kaisei', 30),
      };
    }

    if (args.format === 'json') {
      return {
        document: doc,
        legal_status: TSUTATSU_LEGAL_STATUS,
        source: 'db' as const,
      };
    }
    // markdown
    return renderKaiseiMarkdown(doc);
  } finally {
    closeDb(db);
  }
}

/** 改正通達の Markdown レンダラ。本文 + 添付 PDF を kind ラベル付き表で列挙 */
function renderKaiseiMarkdown(doc: import('../types/document.js').NtaDocument): string {
  const lines: string[] = [];
  lines.push(`# ${doc.title}`);
  lines.push('');
  if (doc.issuedAt) lines.push(`- **発出日**: ${doc.issuedAt}`);
  if (doc.taxonomy) lines.push(`- **税目**: ${doc.taxonomy}`);
  lines.push(`- **docId**: \`${doc.docId}\``);
  lines.push(`- **出典**: ${doc.sourceUrl}`);
  lines.push(`- **取得**: ${doc.fetchedAt}`);
  if (doc.issuer) {
    lines.push('');
    lines.push('## 宛先・発出者');
    for (const ln of doc.issuer.split('\n')) lines.push(`> ${ln}`);
  }
  lines.push('');
  lines.push('## 本文');
  lines.push(doc.fullText);
  if (doc.attachedPdfs.length > 0) {
    lines.push('');
    lines.push(...renderAttachedPdfsMarkdown(doc.attachedPdfs));
  }
  lines.push('');
  lines.push('---');
  lines.push(
    '*通達は行政内部文書であり、納税者・裁判所への直接的拘束力なし（最高裁 昭和43.12.24）*'
  );
  return lines.join('\n');
}

/* -------------------------------------------------------------------------- */
/* Phase 3b alpha.2: 事務運営指針ハンドラ                                       */
/* -------------------------------------------------------------------------- */

/**
 * 事務運営指針の FTS5 検索。事前に `--bulk-download-jimu-unei` で DB 投入が必要。
 */
export async function handleNtaSearchJimuUnei(
  args: SearchJimuUneiArgs,
  options: { dbPath?: string } = {}
) {
  const limit = args.limit ?? 10;
  const db = openDb(options.dbPath);
  try {
    const opts: { docType: 'jimu-unei'; limit: number; taxonomy?: string } = {
      docType: 'jimu-unei',
      limit,
    };
    if (args.taxonomy !== undefined) opts.taxonomy = args.taxonomy;
    const hits = searchDocumentFts(db, args.keyword, opts);

    if (hits.length === 0) {
      return {
        results: [],
        keyword: args.keyword,
        hint: '該当なし。`--bulk-download-jimu-unei` で DB 投入済みか確認してください',
        legal_status: TSUTATSU_LEGAL_STATUS,
      };
    }

    const taxonomyFilter = args.taxonomy !== undefined ? [args.taxonomy] : undefined;
    const freshness = summarizeFreshnessFromDocument(
      db,
      'jimu-unei',
      taxonomyFilter,
      '`--bulk-download-jimu-unei`'
    );
    return {
      keyword: args.keyword,
      results: hits.map((h) => ({
        docType: h.docType,
        docId: h.docId,
        taxonomy: h.taxonomy,
        title: h.title,
        issuedAt: h.issuedAt,
        sourceUrl: h.sourceUrl,
        snippet: h.snippet,
      })),
      ...(freshness ? { freshness } : {}),
      legal_status: TSUTATSU_LEGAL_STATUS,
    };
  } finally {
    closeDb(db);
  }
}

/**
 * 事務運営指針を docId で取得する（DB 経由）。
 */
export async function handleNtaGetJimuUnei(
  args: GetJimuUneiArgs,
  options: { dbPath?: string } = {}
) {
  const db = openDb(options.dbPath);
  try {
    const doc = getDocumentFromDb(db, 'jimu-unei', args.docId);
    if (!doc) {
      return {
        error: `事務運営指針 docId="${args.docId}" は DB に未投入です`,
        hint: '`houki-nta-mcp --bulk-download-jimu-unei` で投入してください',
        available_doc_ids: listAvailableDocIds(db, 'jimu-unei', 30),
      };
    }
    if (args.format === 'json') {
      return {
        document: doc,
        legal_status: TSUTATSU_LEGAL_STATUS,
        source: 'db' as const,
      };
    }
    // Markdown は kaisei と同じレンダラを流用
    return renderDocumentMarkdown(doc, '事務運営指針');
  } finally {
    closeDb(db);
  }
}

/**
 * 共通 document Markdown レンダラ（kaisei / jimu-unei で共有）。
 * `kind` でドキュメント種別の和名を表示する（タイトル下のメタに含まれる）。
 */
function renderDocumentMarkdown(
  doc: import('../types/document.js').NtaDocument,
  kind: '改正通達' | '事務運営指針' | '文書回答事例'
): string {
  const lines: string[] = [];
  lines.push(`# ${doc.title}`);
  lines.push('');
  lines.push(`- **種別**: ${kind}`);
  if (doc.issuedAt) lines.push(`- **発出日**: ${doc.issuedAt}`);
  if (doc.taxonomy) lines.push(`- **税目**: ${doc.taxonomy}`);
  lines.push(`- **docId**: \`${doc.docId}\``);
  lines.push(`- **出典**: ${doc.sourceUrl}`);
  lines.push(`- **取得**: ${doc.fetchedAt}`);
  if (doc.issuer) {
    lines.push('');
    lines.push('## 宛先・発出者');
    for (const ln of doc.issuer.split('\n')) lines.push(`> ${ln}`);
  }
  lines.push('');
  lines.push('## 本文');
  lines.push(doc.fullText);
  if (doc.attachedPdfs.length > 0) {
    lines.push('');
    lines.push(...renderAttachedPdfsMarkdown(doc.attachedPdfs));
  }
  lines.push('');
  lines.push('---');
  lines.push(
    '*通達・事務運営指針は行政内部文書であり、納税者・裁判所への直接的拘束力なし（最高裁 昭和43.12.24）*'
  );
  return lines.join('\n');
}

/* -------------------------------------------------------------------------- */
/* Phase 3b alpha.3: 文書回答事例ハンドラ                                       */
/* -------------------------------------------------------------------------- */

/**
 * 文書回答事例の FTS5 検索。事前に `--bulk-download-bunshokaitou` で DB 投入が必要。
 */
export async function handleNtaSearchBunshokaitou(
  args: SearchBunshokaitouArgs,
  options: { dbPath?: string } = {}
) {
  const limit = args.limit ?? 10;
  const db = openDb(options.dbPath);
  try {
    const opts: { docType: 'bunshokaitou'; limit: number; taxonomy?: string } = {
      docType: 'bunshokaitou',
      limit,
    };
    if (args.taxonomy !== undefined) opts.taxonomy = args.taxonomy;
    const hits = searchDocumentFts(db, args.keyword, opts);
    if (hits.length === 0) {
      return {
        results: [],
        keyword: args.keyword,
        hint: '該当なし。`--bulk-download-bunshokaitou` で DB 投入済みか確認してください',
        legal_status: NTA_GENERAL_INFO_LEGAL_STATUS,
      };
    }
    const taxonomyFilter = args.taxonomy !== undefined ? [args.taxonomy] : undefined;
    const freshness = summarizeFreshnessFromDocument(
      db,
      'bunshokaitou',
      taxonomyFilter,
      '`--bulk-download-bunshokaitou`'
    );
    return {
      keyword: args.keyword,
      results: hits.map((h) => ({
        docType: h.docType,
        docId: h.docId,
        taxonomy: h.taxonomy,
        title: h.title,
        issuedAt: h.issuedAt,
        sourceUrl: h.sourceUrl,
        snippet: h.snippet,
      })),
      ...(freshness ? { freshness } : {}),
      legal_status: NTA_GENERAL_INFO_LEGAL_STATUS,
    };
  } finally {
    closeDb(db);
  }
}

/**
 * 文書回答事例を docId で取得する（DB 経由）。
 */
export async function handleNtaGetBunshokaitou(
  args: GetBunshokaitouArgs,
  options: { dbPath?: string } = {}
) {
  const db = openDb(options.dbPath);
  try {
    const doc = getDocumentFromDb(db, 'bunshokaitou', args.docId);
    if (!doc) {
      return {
        error: `文書回答事例 docId="${args.docId}" は DB に未投入です`,
        hint: '`houki-nta-mcp --bulk-download-bunshokaitou` で投入してください（全税目で約 30 分）',
        available_doc_ids: listAvailableDocIds(db, 'bunshokaitou', 30),
      };
    }
    if (args.format === 'json') {
      return {
        document: doc,
        legal_status: NTA_GENERAL_INFO_LEGAL_STATUS,
        source: 'db' as const,
      };
    }
    return renderDocumentMarkdown(doc, '文書回答事例');
  } finally {
    closeDb(db);
  }
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
  nta_search_kaisei_tsutatsu: handleNtaSearchKaiseiTsutatsu,
  nta_get_kaisei_tsutatsu: handleNtaGetKaiseiTsutatsu,
  nta_search_jimu_unei: handleNtaSearchJimuUnei,
  nta_get_jimu_unei: handleNtaGetJimuUnei,
  nta_search_bunshokaitou: handleNtaSearchBunshokaitou,
  nta_get_bunshokaitou: handleNtaGetBunshokaitou,
  resolve_abbreviation: handleResolveAbbreviation,
};
