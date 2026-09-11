/**
 * MCP Tool Handlers — houki-nta-mcp
 *
 * Phase 1c で `nta_get_tsutatsu` を本実装。
 * Phase 1e で `nta_get_tax_answer` / `nta_get_qa` を本実装。
 * `nta_search_*` 系は Phase 2 (bulk DL + FTS5) で対応予定。
 */

import { resolveAbbreviation } from '@shuji-bonji/houki-abbreviations';
import type DatabaseT from 'better-sqlite3';
import type { QaTopic } from '../constants.js';
import {
  BUNSHOKAITOU_LEGAL_STATUS,
  bunshoMainTaxonomy,
  expandBunshoTaxonomy,
  LEGAL_STATUS_BY_DOCTYPE,
  NTA_GENERAL_INFO_LEGAL_STATUS,
  NTA_HINT,
  QA_BASE_URL,
  QA_TOPICS,
  TAX_ANSWER_BASE_URL,
  TAX_ANSWER_FOLDER_MAP,
  TSUTATSU_BASE_LAWS,
  TSUTATSU_LEGAL_STATUS,
  TSUTATSU_URL_ROOTS,
} from '../constants.js';
import { closeDb, defaultDbPath, openDb } from '../db/index.js';
import {
  isLawServiceError,
  type LawErrorCode,
  type LawServiceError,
  makeError,
  NEXT_ACTIONS,
  type NextAction,
} from '../errors.js';
import { writeBackLiveSection } from '../services/bulk-downloader.js';
import type { ClauseRow } from '../services/db-search.js';
import {
  countDocuments,
  describeExpansionNotes,
  describeSearchNotes,
  getClauseFromDb,
  hasAnyClause,
  listAvailableClauses,
  listDocumentTaxonomies,
  searchClauseFtsWithExpansion,
} from '../services/db-search.js';
import {
  type FreshnessRange,
  summarizeFreshnessFromDocument,
  summarizeFreshnessFromSection,
} from '../services/freshness.js';
import { fetchNtaPage, NtaFetchError } from '../services/nta-scraper.js';
import {
  buildReaderHintExamples,
  fillMissingKinds,
  renderAttachedPdfsMarkdown,
} from '../services/pdf-meta.js';
import { parseQaJirei } from '../services/qa-parser.js';
import type { RelatedLawRef, RelatedTsutatsuRef } from '../services/related-law-parser.js';
import { parseRelatedReferences } from '../services/related-law-parser.js';
import { parseTaxAnswer } from '../services/tax-answer-parser.js';
import { renderQaMarkdown, renderTaxAnswerMarkdown } from '../services/tax-answer-render.js';
import { parseTsutatsuSection, TsutatsuParseError } from '../services/tsutatsu-parser.js';
import { describeImageNotes, renderClauseMarkdown } from '../services/tsutatsu-render.js';
import type { DocType } from '../types/document.js';
import type {
  GetQaArgs,
  GetTaxAnswerArgs,
  GetTsutatsuArgs,
  InspectPdfMetaArgs,
  ResolveAbbreviationArgs,
  SearchQaArgs,
  SearchTaxAnswerArgs,
  SearchTsutatsuArgs,
} from '../types/index.js';
import { buildSectionUrl, parseClauseNumber } from '../utils/clause.js';
import {
  ntaGetBunshokaitouTool,
  ntaGetJimuUneiTool,
  ntaGetKaiseiTsutatsuTool,
  ntaGetQaTool,
  ntaGetTaxAnswerTool,
  ntaGetTsutatsuTool,
  ntaInspectPdfMetaTool,
  ntaSearchBunshokaitouTool,
  ntaSearchJimuUneiTool,
  ntaSearchKaiseiTsutatsuTool,
  ntaSearchQaTool,
  ntaSearchTaxAnswerTool,
  ntaSearchTsutatsuTool,
  resolveAbbreviationTool,
} from './definitions.js';
import { bindTool, type ToolHandler } from './tool-args.js';

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
    return makeError('INVALID_ARGUMENT', 'keyword を指定してください', {
      tool: 'nta_search_tsutatsu',
    });
  }

  const db = openDb(options.dbPath);
  try {
    if (!hasAnyClause(db)) {
      return makeError('TSUTATSU_NOT_FOUND', 'ローカル DB に検索対象がありません', {
        hint: '初回は `houki-nta-mcp --bulk-download` を実行して通達一式をローカル DB に投入してください（消費税法基本通達: 約 100 秒）',
        tool: 'nta_search_tsutatsu',
        next_actions: [NEXT_ACTIONS.bulkDownload()],
      });
    }

    const limit = Math.min(Math.max(args.limit ?? 10, 1), 50);
    const { hits, expansion } = searchClauseFtsWithExpansion(db, keyword, { limit });
    // Issue #18: 3 文字未満の語を LIKE で補完した / 外した ことを応答に明示する
    // Issue #21: 通称を 0 件のため法令名に広げたときも明示する
    const searchNotes = [...describeSearchNotes(keyword), ...describeExpansionNotes(expansion)];

    if (hits.length === 0) {
      return {
        keyword,
        hits: [],
        message: `"${keyword}" にマッチする clause はありません`,
        ...(searchNotes.length > 0 ? { search_notes: searchNotes } : {}),
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
        ...(h.score !== undefined ? { score: h.score } : {}),
        ...(h.scoreReasons?.length ? { scoreReasons: h.scoreReasons } : {}),
      })),
      ...(freshness ? { freshness } : {}),
      ...(searchNotes.length > 0 ? { search_notes: searchNotes } : {}),
      legal_status: TSUTATSU_LEGAL_STATUS,
      ...searchBaseLawFields(hits.map((h) => h.tsutatsu)),
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
    return makeError(
      'ABBREVIATION_NOT_FOUND',
      `辞書に該当なし: "${args.name}"。略称または正式名で指定してください`,
      {
        tool: 'nta_get_tsutatsu',
        next_actions: [NEXT_ACTIONS.searchTsutatsu(args.name)],
      }
    );
  }

  // 1b. 管轄判定
  if (resolved.source_mcp_hint !== NTA_HINT) {
    return makeError('OUT_OF_SCOPE', `"${args.name}" は ${resolved.source_mcp_hint} の管轄です`, {
      hint: `${resolved.source_mcp_hint}-mcp で取得してください`,
      resolved,
      next_actions: [NEXT_ACTIONS.delegateTo(resolved.source_mcp_hint ?? 'unknown')],
    });
  }

  // 2. clause 必須チェック
  if (!args.clause) {
    return makeError('INVALID_ARGUMENT', 'clause を指定してください', {
      hint: '例: "5-1-9" / "1-4-13の2"（消基通スタイル）/ "2-4の2"（所基通スタイル）',
      resolved,
    });
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
      return makeError(
        'ARTICLE_NOT_FOUND',
        `clause "${args.clause}" は DB 内の "${resolved.formal}" に見つかりません`,
        {
          hint: '別の clause 番号を試すか、`--bulk-download` で再取得してください（最新の改正反映用）',
          available_clauses: listAvailableClauses(db, resolved.formal, 50),
        }
      );
    }
  } finally {
    closeDb(db);
  }

  // 5. DB miss → ライブ取得経路へフォールバック
  const rootUrl = TSUTATSU_URL_ROOTS[resolved.formal];
  if (!rootUrl) {
    return makeError(
      'TSUTATSU_NOT_FOUND',
      `"${resolved.formal}" は DB にも未投入で、ライブ取得用 URL も未登録です`,
      {
        hint: `先に \`houki-nta-mcp --bulk-download --tsutatsu="${resolved.formal}"\` を実行して DB に投入してください（Phase 2d 以降は他通達も bulk DL 経由で対応）。`,
        next_actions: [NEXT_ACTIONS.bulkDownload(resolved.formal)],
        supported_for_live: Object.keys(TSUTATSU_URL_ROOTS),
        resolved,
        tool: 'nta_get_tsutatsu',
      }
    );
  }

  const parsed = parseClauseNumber(args.clause);
  if (!parsed) {
    return makeError('INVALID_ARGUMENT', `clause の形式が不正: "${args.clause}"`, {
      hint: 'ライブ取得には「章-節-条」形式（例: "5-1-9" / "1-4-13の2"）が必要です。他通達体系（条-項）の場合は `--bulk-download` で DB 投入してください',
    });
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
      return makeError('SOURCE_API_ERROR', `国税庁サイトからの取得に失敗: ${err.message}`, {
        url,
        retryable: true,
        next_actions: [NEXT_ACTIONS.retryLater()],
        detail: err.status !== undefined ? { status: err.status, url } : { url },
      });
    }
    throw err;
  }

  let section: ReturnType<typeof parseTsutatsuSection>;
  try {
    section = parseTsutatsuSection(html, sourceUrl, fetchedAt);
  } catch (err) {
    if (err instanceof TsutatsuParseError) {
      return makeError('INTERNAL_ERROR', `通達ページのパースに失敗: ${err.message}`, {
        url,
        hint: 'パーサのバグまたは国税庁ページの構造変更の可能性。報告してください',
        detail: { url, cause: err.message },
      });
    }
    throw err;
  }

  const clause = section.clauses.find((c) => c.clauseNumber === args.clause);
  if (!clause) {
    return makeError('ARTICLE_NOT_FOUND', `clause "${args.clause}" がページ内に見つかりません`, {
      url,
      available_clauses: section.clauses.map((c) => c.clauseNumber),
    });
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
      ...contentNotesFor(clause.paragraphs),
      legal_status: TSUTATSU_LEGAL_STATUS,
      ...baseLawFields(resolved.formal),
    };
  }
  return renderClauseMarkdown(clause, {
    sourceUrl: section.sourceUrl,
    fetchedAt: section.fetchedAt,
    baseLaws: TSUTATSU_BASE_LAWS[resolved.formal],
  });
}

/**
 * Issue #20: 通達の応答に、解釈の対象になる法律（`base_laws`）と、その法律本文を
 * houki-egov-mcp の `get_law` で読むための `next_actions` を付ける。
 * 対応表に無い通達（将来の個別通達など）では何も付けない。
 */
function baseLawFields(formal: string) {
  const laws = TSUTATSU_BASE_LAWS[formal];
  if (!laws || laws.length === 0) return {};
  return { base_laws: laws, next_actions: [NEXT_ACTIONS.readBaseLaw(laws[0])] };
}

/**
 * Issue #20: 検索結果に現れた通達について、解釈の対象になる法律の対応表
 * （`base_laws_by_tsutatsu`）と、通達ごとに 1 件の `next_actions` を付ける。
 *
 * 対応は通達単位の事実なので、hit ごとではなく応答に 1 回だけ置く。hit ごとに置くと
 * 「その条項がこの法令に基づく」と読めてしまい、条単位の対応を持たない方針（#20）と食い違う。
 * `nta_get_tsutatsu` の `base_laws`（配列）と型が違うため、名前も分けている。
 * hits の出現順、同じ通達は 1 回だけ。対応表に無い通達しか無ければ何も付けない。
 */
function searchBaseLawFields(tsutatsuNames: string[]) {
  const byTsutatsu: Record<string, readonly string[]> = {};
  const actions: NextAction[] = [];
  for (const name of tsutatsuNames) {
    const laws = TSUTATSU_BASE_LAWS[name];
    if (!laws || laws.length === 0 || name in byTsutatsu) continue;
    byTsutatsu[name] = laws;
    actions.push(NEXT_ACTIONS.readBaseLaw(laws[0]));
  }
  return actions.length > 0 ? { base_laws_by_tsutatsu: byTsutatsu, next_actions: actions } : {};
}

/** Issue #17: 画像を含む clause の JSON 応答に `content_notes` を付ける（無ければ何も付けない） */
function contentNotesFor(paragraphs: Parameters<typeof describeImageNotes>[0]) {
  const notes = describeImageNotes(paragraphs);
  return notes.length > 0 ? { content_notes: notes } : {};
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
      ...contentNotesFor(row.paragraphs),
      legal_status: TSUTATSU_LEGAL_STATUS,
      ...baseLawFields(tsutatsu),
    };
  }
  return renderClauseMarkdown(
    {
      clauseNumber: row.clauseNumber,
      title: row.title,
      paragraphs: row.paragraphs,
      fullText: row.fullText,
    },
    { sourceUrl: row.sourceUrl, fetchedAt: row.fetchedAt, baseLaws: TSUTATSU_BASE_LAWS[tsutatsu] }
  );
}

/* -------------------------------------------------------------------------- */
/* Issue #23 (v0.13.0): 文書系の検索が 0 件のときの判定                          */
/* -------------------------------------------------------------------------- */

/** 文書系の検索ツールごとの表示名・CLI フラグ・絞り込み引数の名前 */
interface DocSearchMeta {
  /** 応答の文に使う種別名。例: '質疑応答事例' */
  label: string;
  /** ツール名 */
  tool: string;
  /** 種別ごとの bulk download フラグ。例: '--bulk-download-qa' */
  flag: string;
  /** 税目で絞る引数の名前（ツールの inputSchema 上の名前） */
  taxonomyArg?: string;
  /** 税目を絞って bulk download するフラグ。例: '--qa-topic' */
  taxonomyFlag?: string;
  /**
   * taxonomyFlag に渡す値を返す（v0.14.0）。投入できない値なら undefined を返し、投入コマンドを案内しない。
   * 文書回答事例は国税局の表記（souzoku）を本庁の表記（sozoku）に直し、本庁の索引に無い値は案内しない
   */
  taxonomyFlagValue?: (taxonomy: string) => string | undefined;
}

const DOC_SEARCH_META: Record<DocType, DocSearchMeta> = {
  'qa-jirei': {
    label: '質疑応答事例',
    tool: 'nta_search_qa',
    flag: '--bulk-download-qa',
    taxonomyArg: 'topic',
    taxonomyFlag: '--qa-topic',
    // topic は inputSchema の enum（QA_TOPICS）で検証済みなので、そのまま渡せる
    taxonomyFlagValue: (topic) => topic,
  },
  'tax-answer': {
    label: 'タックスアンサー',
    tool: 'nta_search_tax_answer',
    flag: '--bulk-download-tax-answer',
  },
  kaisei: {
    label: '改正通達',
    tool: 'nta_search_kaisei_tsutatsu',
    flag: '--bulk-download-kaisei',
    taxonomyArg: 'taxonomy',
  },
  'jimu-unei': {
    label: '事務運営指針',
    tool: 'nta_search_jimu_unei',
    flag: '--bulk-download-jimu-unei',
    taxonomyArg: 'taxonomy',
  },
  bunshokaitou: {
    label: '文書回答事例',
    tool: 'nta_search_bunshokaitou',
    flag: '--bulk-download-bunshokaitou',
    taxonomyArg: 'taxonomy',
    taxonomyFlag: '--bunsho-taxonomy',
    taxonomyFlagValue: bunshoMainTaxonomy,
  },
};

/** 検索が 0 件でも、その種別の文書は DB にある場合に応答へ足すフィールド */
export interface DocZeroHitInfo {
  hint: string;
  /** 絞り込んだ税目に文書が無いとき: その種別の文書が持つ税目の一覧 */
  available_taxonomies?: string[];
  freshness?: FreshnessRange;
}

/**
 * 文書系の検索が 0 件だったときに、理由を 4 つに分ける。
 *
 * 1. その種別の文書が DB に 1 件も無い → エラー `DOC_NOT_FOUND`（「該当なし」とは違うことを応答の形で示す）
 * 2. 税目の絞り込み（topic / taxonomy）の範囲に文書が無い → 成功。絞り込みを外すよう案内し、税目の一覧を付ける
 * 3. `hasPdf` の条件に合う文書が無い → 成功。`hasPdf` を外すよう案内する
 * 4. 文書はあるが、キーワードに合わない → 成功。別のキーワードを案内し、`freshness` で DB の取得時点を示す
 *
 * 件数を数えるのは検索が 0 件のときだけなので、ヒットしたときの応答時間は変わらない。
 */
export function explainDocZeroHits(
  db: DatabaseT.Database,
  docType: DocType,
  args: {
    keyword: string;
    /** 利用者が指定した税目（hint の文に使う） */
    taxonomy?: string;
    /** 実際に探した税目（文書回答事例は別表記を含む。省略時は taxonomy だけ） */
    taxonomies?: readonly string[];
    hasPdf?: boolean;
  },
  options: { dbPath?: string } = {}
): LawServiceError | DocZeroHitInfo {
  const meta = DOC_SEARCH_META[docType];
  const total = countDocuments(db, { docType });
  if (total === 0) {
    const dbPath = options.dbPath ?? defaultDbPath();
    return makeError(
      'DOC_NOT_FOUND',
      `ローカル DB に${meta.label}が 1 件も無いため、検索できません（「該当なし」という結果ではありません）`,
      {
        hint: `MCP サーバーが開いている DB（${dbPath}）に${meta.label}（doc_type="${docType}"）が入っていません。\`houki-nta-mcp ${meta.flag}\` で投入してください。投入したはずの場合は、bulk download を実行した環境と MCP サーバーとで、環境変数 HOUKI_NTA_DB_PATH / XDG_CACHE_HOME が同じか確認してください`,
        next_actions: [NEXT_ACTIONS.bulkDownloadDocs(meta.flag)],
        tool: meta.tool,
      }
    );
  }

  // 数えるときの税目。文書回答事例は別表記（sozoku と souzoku など）をまとめて数える
  const taxonomies = args.taxonomy !== undefined ? (args.taxonomies ?? [args.taxonomy]) : undefined;
  const fresh = (filter?: readonly string[]) =>
    summarizeFreshnessFromDocument(db, docType, filter, `\`${meta.flag}\``) ?? undefined;

  const argName = meta.taxonomyArg ?? 'taxonomy';
  if (args.taxonomy !== undefined && countDocuments(db, { docType, taxonomy: taxonomies }) === 0) {
    const flagValue = meta.taxonomyFlagValue?.(args.taxonomy);
    const addCommand =
      meta.taxonomyFlag && flagValue !== undefined
        ? `税目を絞って投入した場合は、\`houki-nta-mcp ${meta.flag} ${meta.taxonomyFlag}=${flagValue}\` で追加できます`
        : '';
    return {
      hint: `DB の${meta.label} ${formatCount(total)} 件のうち、${argName}="${args.taxonomy}" の文書はありません。${argName} を外すか、available_taxonomies の値を指定してください。${addCommand}`,
      available_taxonomies: listDocumentTaxonomies(db, docType),
      ...withFreshness(fresh()),
    };
  }

  if (
    args.hasPdf !== undefined &&
    countDocuments(db, { docType, taxonomy: taxonomies, hasPdf: args.hasPdf }) === 0
  ) {
    const scoped = countDocuments(db, { docType, taxonomy: taxonomies });
    const scopeLabel = args.taxonomy !== undefined ? `（${argName}="${args.taxonomy}"）` : ' ';
    const which = args.hasPdf ? 'PDF 付き' : 'PDF 無し';
    return {
      hint: `DB の${meta.label}${scopeLabel}${formatCount(scoped)} 件に、${which}の文書はありません。hasPdf を外して検索してください`,
      ...withFreshness(fresh(taxonomies)),
    };
  }

  const searched = countDocuments(db, { docType, taxonomy: taxonomies, hasPdf: args.hasPdf });
  const conditions = [
    ...(args.taxonomy !== undefined ? [`${argName}="${args.taxonomy}"`] : []),
    ...(args.hasPdf !== undefined ? [`hasPdf=${args.hasPdf}`] : []),
  ];
  const scopeLabel = conditions.length > 0 ? `（${conditions.join('、')}）` : ' ';
  return {
    hint: `該当なし。DB の${meta.label}${scopeLabel}${formatCount(searched)} 件に「${args.keyword}」に合う文書はありません。別のキーワードで試してください`,
    ...withFreshness(fresh(taxonomies)),
  };
}

/**
 * 取得系（改正通達・事務運営指針・文書回答事例）で、指定した docId が DB に無いときのエラー（v0.14.1）。
 *
 * v0.14.0 までは、その種別の文書が DB に入っていても「DB に未投入です」と返し、bulk download を案内していた。
 * docId を打ち間違えただけの利用者にも投入を勧めることになるため、2 つに分ける。
 *
 * 1. その種別の文書が DB に 1 件も無い → 投入を案内する（`next_actions` は `cli_bulk_download`。検索ツールの DOC_NOT_FOUND と同じ）
 * 2. 文書はあるが、その docId が無い → 「見つかりません」。`available_doc_ids` と、検索ツールへの `next_actions` を付ける
 *
 * `code` は v0.14.0 から変えない（改正通達・事務運営指針は TSUTATSU_NOT_FOUND、文書回答事例は DOC_NOT_FOUND）。
 */
export function explainDocIdNotFound(
  db: DatabaseT.Database,
  docType: 'kaisei' | 'jimu-unei' | 'bunshokaitou',
  docId: string,
  code: LawErrorCode,
  getTool: string,
  options: { dbPath?: string } = {}
): LawServiceError {
  const meta = DOC_SEARCH_META[docType];
  const total = countDocuments(db, { docType });
  if (total === 0) {
    const dbPath = options.dbPath ?? defaultDbPath();
    return makeError(
      code,
      `ローカル DB に${meta.label}が 1 件も無いため、docId="${docId}" を取得できません`,
      {
        hint: `MCP サーバーが開いている DB（${dbPath}）に${meta.label}（doc_type="${docType}"）が入っていません。\`houki-nta-mcp ${meta.flag}\` で投入してください。投入したはずの場合は、bulk download を実行した環境と MCP サーバーとで、環境変数 HOUKI_NTA_DB_PATH / XDG_CACHE_HOME が同じか確認してください`,
        next_actions: [NEXT_ACTIONS.bulkDownloadDocs(meta.flag)],
        tool: getTool,
      }
    );
  }
  return makeError(code, `${meta.label} docId="${docId}" は見つかりません`, {
    hint: `DB の${meta.label} ${formatCount(total)} 件に、この docId はありません。available_doc_ids（新しい順に 30 件）から選ぶか、${meta.tool} で検索して docId を確かめてください。DB を投入した後に国税庁が公開した文書は、\`houki-nta-mcp ${meta.flag}\` をもう一度実行すると取り込めます`,
    available_doc_ids: listAvailableDocIds(db, docType, 30),
    next_actions: [
      {
        action: meta.tool,
        reason: 'キーワード検索で正しい docId を探せます',
      },
    ],
    tool: getTool,
  });
}

/**
 * 文書回答事例の税目を別表記まで広げて探したことを search_notes に書く（v0.14.0）。
 * 広げなかったとき（別表記の無い税目・指定なし）は空配列。
 */
function describeTaxonomyAliasNotes(
  taxonomy: string | undefined,
  taxonomies: readonly string[] | undefined
): string[] {
  if (taxonomy === undefined || taxonomies === undefined || taxonomies.length <= 1) return [];
  const others = taxonomies.filter((t) => t !== taxonomy).map((t) => `"${t}"`);
  return [
    `taxonomy="${taxonomy}" は、同じ税目の別表記 ${others.join('・')} の文書もまとめて検索しました（国税局のページは本庁と違う税目フォルダ名を使うことがあるため）`,
  ];
}

/** hint に書く件数。3 桁ごとにカンマを入れる（例: 1,841） */
function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

function withFreshness(freshness: FreshnessRange | undefined): { freshness?: FreshnessRange } {
  return freshness ? { freshness } : {};
}

/**
 * nta_search_qa — 質疑応答事例の FTS5 検索。事前に `--bulk-download-qa` で DB 投入が必要。
 */
export async function handleNtaSearchQa(args: SearchQaArgs, options: { dbPath?: string } = {}) {
  const limit = args.limit ?? 10;
  // Issue #23: v0.12.0 までは domain（tax / labor / …）を taxonomy（shotoku / shohi / …）と比べていたため、
  // domain を付けると必ず 0 件だった。質疑応答事例はすべて税務なので、"tax" は絞り込まず、
  // それ以外は DB を開かずに 0 件を返す。税目での絞り込みは topic で行う
  if (args.domain !== undefined && args.domain !== 'tax') {
    return {
      results: [],
      keyword: args.keyword,
      hint: `質疑応答事例はすべて税務（domain="tax"）の資料のため、domain="${args.domain}" に当たる文書はありません。税目で絞り込むときは topic を使ってください`,
      legal_status: NTA_GENERAL_INFO_LEGAL_STATUS,
    };
  }
  const db = openDb(options.dbPath);
  try {
    const opts: { docType: 'qa-jirei'; limit: number; taxonomy?: string; hasPdf?: boolean } = {
      docType: 'qa-jirei',
      limit,
    };
    if (args.topic) opts.taxonomy = args.topic;
    if (args.hasPdf !== undefined) opts.hasPdf = args.hasPdf;
    const { hits, expansion } = searchDocumentFtsWithExpansion(db, args.keyword, opts);
    // Issue #18 (短い語) / Issue #21 (通称を 0 件のため法令名に広げた)
    const searchNotes = [
      ...describeSearchNotes(args.keyword),
      ...describeExpansionNotes(expansion),
    ];
    if (hits.length === 0) {
      const zero = explainDocZeroHits(
        db,
        'qa-jirei',
        { keyword: args.keyword, taxonomy: args.topic, hasPdf: args.hasPdf },
        options
      );
      if (isLawServiceError(zero)) return zero;
      return {
        results: [],
        keyword: args.keyword,
        ...(searchNotes.length > 0 ? { search_notes: searchNotes } : {}),
        ...zero,
        legal_status: NTA_GENERAL_INFO_LEGAL_STATUS,
      };
    }
    const taxonomyFilter = args.topic ? [args.topic] : undefined;
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
        ...(h.score !== undefined ? { score: h.score } : {}),
        ...(h.scoreReasons?.length ? { scoreReasons: h.scoreReasons } : {}),
      })),
      ...(freshness ? { freshness } : {}),
      ...(searchNotes.length > 0 ? { search_notes: searchNotes } : {}),
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
    return makeError('INVALID_ARGUMENT', `topic "${topic}" は houki-nta-mcp では未対応です`, {
      hint: '対応税目: shotoku, gensen, joto, sozoku, hyoka, hojin, shohi, inshi, hotei',
    });
  }
  if (!args.category || !args.id) {
    return makeError('INVALID_ARGUMENT', 'category と id を両方指定してください', {
      hint: '/law/shitsugi/{topic}/01.htm の TOC ページで category 番号と事例番号を確認',
    });
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
      return makeError('SOURCE_API_ERROR', `国税庁サイトからの取得に失敗: ${err.message}`, {
        url,
        retryable: true,
        next_actions: [NEXT_ACTIONS.retryLater()],
        detail: err.status !== undefined ? { status: err.status, url } : { url },
      });
    }
    throw err;
  }

  let qa: ReturnType<typeof parseQaJirei>;
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
      return makeError('INTERNAL_ERROR', `質疑応答事例ページのパースに失敗: ${err.message}`, {
        url,
        hint: 'パーサのバグまたは国税庁ページの構造変更の可能性。報告してください',
        detail: { url, cause: err.message },
      });
    }
    throw err;
  }

  if (args.format === 'json') {
    // Issue #22: 【関係法令通達】を法令と通達の参照に分け、houki-egov-mcp / nta_get_tsutatsu へ案内する
    const { related_laws, related_tsutatsu } = parseRelatedReferences(qa.relatedLaws);
    const next_actions = relatedNextActions(related_laws, related_tsutatsu);
    return {
      qa,
      legal_status: NTA_GENERAL_INFO_LEGAL_STATUS,
      ...(related_laws.length > 0 ? { related_laws } : {}),
      ...(related_tsutatsu.length > 0 ? { related_tsutatsu } : {}),
      ...(next_actions.length > 0 ? { next_actions } : {}),
    };
  }
  return renderQaMarkdown(qa);
}

/**
 * Issue #22: 関係法令・通達の参照から next_actions を作る。
 *
 * - 法令: 条まで読めたもので、houki-egov-mcp の get_law で引ける見込みがあるもの。
 *   条約（「日米租税条約」のような通称で e-Gov の法令名と一致しない）と、改正前の法令
 *   （「旧所得税法」「改正前厚生年金保険法」。get_law は現行の条文を返す）は案内しない
 * - 通達: nta_get_tsutatsu が扱う基本通達 4 種で、番号まで読めたもの。番号の後ろの「(4)」のような
 *   細目は nta_get_tsutatsu の clause に含めない
 * - 同じ案内は 1 回だけ
 */
function relatedNextActions(laws: RelatedLawRef[], tsutatsu: RelatedTsutatsuRef[]): NextAction[] {
  const actions: NextAction[] = [];
  const seen = new Set<string>();
  const push = (a: NextAction) => {
    const key = JSON.stringify(a.example);
    if (seen.has(key)) return;
    seen.add(key);
    actions.push(a);
  };
  for (const l of laws) {
    if (!l.article) continue;
    if (!/(法|令|規則|法律)$/.test(l.law_name)) continue;
    if (/改正前|^旧/.test(l.law_name)) continue;
    push(
      NEXT_ACTIONS.readRelatedLaw({
        law_name: l.law_name,
        article: l.article,
        paragraph: l.paragraph,
        item: l.item,
      })
    );
  }
  for (const t of tsutatsu) {
    if (!t.clause || !TSUTATSU_URL_ROOTS[t.name]) continue;
    const clause = t.clause.replace(/\([^)]*\)$/, '');
    if (!clause) continue;
    push(NEXT_ACTIONS.readRelatedTsutatsu(t.name, clause));
  }
  return actions;
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
    const opts: { docType: 'tax-answer'; limit: number; hasPdf?: boolean } = {
      docType: 'tax-answer',
      limit,
    };
    if (args.hasPdf !== undefined) opts.hasPdf = args.hasPdf;
    const { hits, expansion } = searchDocumentFtsWithExpansion(db, args.keyword, opts);
    // Issue #18 (短い語) / Issue #21 (通称を 0 件のため法令名に広げた)
    const searchNotes = [
      ...describeSearchNotes(args.keyword),
      ...describeExpansionNotes(expansion),
    ];
    if (hits.length === 0) {
      const zero = explainDocZeroHits(
        db,
        'tax-answer',
        { keyword: args.keyword, hasPdf: args.hasPdf },
        options
      );
      if (isLawServiceError(zero)) return zero;
      return {
        results: [],
        keyword: args.keyword,
        ...(searchNotes.length > 0 ? { search_notes: searchNotes } : {}),
        ...zero,
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
        ...(h.score !== undefined ? { score: h.score } : {}),
        ...(h.scoreReasons?.length ? { scoreReasons: h.scoreReasons } : {}),
      })),
      ...(freshness ? { freshness } : {}),
      ...(searchNotes.length > 0 ? { search_notes: searchNotes } : {}),
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
    return makeError(
      'INVALID_ARGUMENT',
      `タックスアンサー番号は数字で指定してください: "${args.no}" は不正`,
      {
        hint: '例: "6101" (消費税の基本的なしくみ), "1120" (医療費控除)',
      }
    );
  }
  const folder = TAX_ANSWER_FOLDER_MAP[no[0]];
  if (!folder) {
    return makeError(
      'INVALID_ARGUMENT',
      `番号 "${no}" の先頭桁 "${no[0]}" は houki-nta-mcp v0.2.x では未対応`,
      {
        hint: '対応番号帯: 1xxx=所得税, 2xxx=源泉, 3xxx=譲渡, 4xxx=相続・贈与, 5xxx=法人税, 6xxx=消費税, 7xxx=印紙税, 9xxx=お知らせ。8xxx 帯は未対応（Phase 2 で対応予定）',
      }
    );
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
      return makeError('SOURCE_API_ERROR', `国税庁サイトからの取得に失敗: ${err.message}`, {
        url,
        retryable: true,
        next_actions: [NEXT_ACTIONS.retryLater()],
        detail: err.status !== undefined ? { status: err.status, url } : { url },
      });
    }
    throw err;
  }

  let taxAnswer: ReturnType<typeof parseTaxAnswer>;
  try {
    taxAnswer = parseTaxAnswer(html, sourceUrl, fetchedAt);
  } catch (err) {
    if (err instanceof TsutatsuParseError) {
      return makeError('INTERNAL_ERROR', `タックスアンサーページのパースに失敗: ${err.message}`, {
        url,
        hint: 'パーサのバグまたは国税庁ページの構造変更の可能性。報告してください',
        detail: { url, cause: err.message },
      });
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
export async function handleResolveAbbreviation(args: ResolveAbbreviationArgs) {
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
  getDocumentFromDb,
  listAvailableDocIds,
  searchDocumentFtsWithExpansion,
} from '../services/db-search.js';
import type {
  GetBunshokaitouArgs,
  GetJimuUneiArgs,
  GetKaiseiTsutatsuArgs,
  SearchBunshokaitouArgs,
  SearchJimuUneiArgs,
  SearchKaiseiTsutatsuArgs,
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
    const opts: { docType: 'kaisei'; limit: number; taxonomy?: string; hasPdf?: boolean } = {
      docType: 'kaisei',
      limit,
    };
    if (args.taxonomy !== undefined) opts.taxonomy = args.taxonomy;
    if (args.hasPdf !== undefined) opts.hasPdf = args.hasPdf;
    const { hits, expansion } = searchDocumentFtsWithExpansion(db, args.keyword, opts);
    // Issue #18 (短い語) / Issue #21 (通称を 0 件のため法令名に広げた)
    const searchNotes = [
      ...describeSearchNotes(args.keyword),
      ...describeExpansionNotes(expansion),
    ];

    if (hits.length === 0) {
      const zero = explainDocZeroHits(
        db,
        'kaisei',
        { keyword: args.keyword, taxonomy: args.taxonomy, hasPdf: args.hasPdf },
        options
      );
      if (isLawServiceError(zero)) return zero;
      return {
        results: [],
        keyword: args.keyword,
        ...(searchNotes.length > 0 ? { search_notes: searchNotes } : {}),
        ...zero,
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
        ...(h.score !== undefined ? { score: h.score } : {}),
        ...(h.scoreReasons?.length ? { scoreReasons: h.scoreReasons } : {}),
      })),
      ...(freshness ? { freshness } : {}),
      ...(searchNotes.length > 0 ? { search_notes: searchNotes } : {}),
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
      return explainDocIdNotFound(
        db,
        'kaisei',
        args.docId,
        'TSUTATSU_NOT_FOUND',
        'nta_get_kaisei_tsutatsu',
        options
      );
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
    const opts: { docType: 'jimu-unei'; limit: number; taxonomy?: string; hasPdf?: boolean } = {
      docType: 'jimu-unei',
      limit,
    };
    if (args.taxonomy !== undefined) opts.taxonomy = args.taxonomy;
    if (args.hasPdf !== undefined) opts.hasPdf = args.hasPdf;
    const { hits, expansion } = searchDocumentFtsWithExpansion(db, args.keyword, opts);
    // Issue #18 (短い語) / Issue #21 (通称を 0 件のため法令名に広げた)
    const searchNotes = [
      ...describeSearchNotes(args.keyword),
      ...describeExpansionNotes(expansion),
    ];

    if (hits.length === 0) {
      const zero = explainDocZeroHits(
        db,
        'jimu-unei',
        { keyword: args.keyword, taxonomy: args.taxonomy, hasPdf: args.hasPdf },
        options
      );
      if (isLawServiceError(zero)) return zero;
      return {
        results: [],
        keyword: args.keyword,
        ...(searchNotes.length > 0 ? { search_notes: searchNotes } : {}),
        ...zero,
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
        ...(h.score !== undefined ? { score: h.score } : {}),
        ...(h.scoreReasons?.length ? { scoreReasons: h.scoreReasons } : {}),
      })),
      ...(freshness ? { freshness } : {}),
      ...(searchNotes.length > 0 ? { search_notes: searchNotes } : {}),
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
      return explainDocIdNotFound(
        db,
        'jimu-unei',
        args.docId,
        'TSUTATSU_NOT_FOUND',
        'nta_get_jimu_unei',
        options
      );
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
  // v0.9.1: kind 別の footer 文言 (Issue #1, #2)
  if (kind === '文書回答事例') {
    lines.push(
      '*文書回答事例は照会者・国税庁双方の合意に基づく個別事案回答であり、一般的な法的拘束力はない（実務判断は通達・法令本文に基づく必要あり）*'
    );
  } else {
    lines.push(
      '*通達・事務運営指針は行政内部文書であり、納税者・裁判所への直接的拘束力なし（最高裁 昭和43.12.24）*'
    );
  }
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
    // v0.14.0: 国税局のページは本庁と違う税目フォルダ名を使うことがある（sozoku と souzoku など）ので、
    // 同じ税目の別表記もまとめて探す
    const taxonomies =
      args.taxonomy !== undefined ? expandBunshoTaxonomy(args.taxonomy) : undefined;
    const opts: {
      docType: 'bunshokaitou';
      limit: number;
      taxonomy?: readonly string[];
      hasPdf?: boolean;
    } = {
      docType: 'bunshokaitou',
      limit,
    };
    if (taxonomies !== undefined) opts.taxonomy = taxonomies;
    if (args.hasPdf !== undefined) opts.hasPdf = args.hasPdf;
    const { hits, expansion } = searchDocumentFtsWithExpansion(db, args.keyword, opts);
    // Issue #18 (短い語) / Issue #21 (通称を 0 件のため法令名に広げた)
    const searchNotes = [
      ...describeSearchNotes(args.keyword),
      ...describeExpansionNotes(expansion),
      ...describeTaxonomyAliasNotes(args.taxonomy, taxonomies),
    ];
    if (hits.length === 0) {
      const zero = explainDocZeroHits(
        db,
        'bunshokaitou',
        { keyword: args.keyword, taxonomy: args.taxonomy, taxonomies, hasPdf: args.hasPdf },
        options
      );
      if (isLawServiceError(zero)) return zero;
      return {
        results: [],
        keyword: args.keyword,
        ...(searchNotes.length > 0 ? { search_notes: searchNotes } : {}),
        ...zero,
        // v0.9.1: 文書回答事例固有の文言に修正 (Issue #2)
        legal_status: BUNSHOKAITOU_LEGAL_STATUS,
      };
    }
    const freshness = summarizeFreshnessFromDocument(
      db,
      'bunshokaitou',
      taxonomies,
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
        ...(h.score !== undefined ? { score: h.score } : {}),
        ...(h.scoreReasons?.length ? { scoreReasons: h.scoreReasons } : {}),
      })),
      ...(freshness ? { freshness } : {}),
      ...(searchNotes.length > 0 ? { search_notes: searchNotes } : {}),
      // v0.9.1: 文書回答事例固有の文言に修正 (Issue #2)
      legal_status: BUNSHOKAITOU_LEGAL_STATUS,
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
      return explainDocIdNotFound(
        db,
        'bunshokaitou',
        args.docId,
        'DOC_NOT_FOUND',
        'nta_get_bunshokaitou',
        options
      );
    }
    if (args.format === 'json') {
      return {
        document: doc,
        // v0.9.1: 文書回答事例固有の文言に修正 (Issue #2)
        legal_status: BUNSHOKAITOU_LEGAL_STATUS,
        source: 'db' as const,
      };
    }
    return renderDocumentMarkdown(doc, '文書回答事例');
  } finally {
    closeDb(db);
  }
}

/* -------------------------------------------------------------------------- */
/* Phase 4-2 (v0.7.1): nta_inspect_pdf_meta — PDF メタだけを返す軽量 API       */
/* -------------------------------------------------------------------------- */

/**
 * 指定文書の添付 PDF メタ一覧 + pdf-reader-mcp 呼び出し例だけを返す。
 * 本文は含まないので軽量。`nta_get_*` で全文取得すると重い場合に便利。
 *
 * 質疑応答事例 (qa-jirei) は PDF を持たないため対象外（tool definition で enum 制限済）。
 */
export async function handleNtaInspectPdfMeta(
  args: InspectPdfMetaArgs,
  options: { dbPath?: string } = {}
) {
  const db = openDb(options.dbPath);
  try {
    const doc = getDocumentFromDb(db, args.docType, args.docId);
    if (!doc) {
      return makeError(
        'DOC_NOT_FOUND',
        `${args.docType} の docId="${args.docId}" は DB に未登録です`,
        {
          hint: `\`--bulk-download-${args.docType === 'tax-answer' ? 'tax-answer' : args.docType}\` で投入済みか確認してください。docId が正しいかも \`nta_search_*\` で検証可能`,
        }
      );
    }

    // v0.7.2: kind 未設定（v0.6.0 期に投入された DB レコード）はタイトルから動的補完。
    const filled = fillMissingKinds(doc.attachedPdfs);

    // kind 優先度（Phase 4-1 と同じ並び順）
    const kindOrder: Record<string, number> = {
      comparison: 0,
      attachment: 1,
      'qa-pdf': 2,
      related: 3,
      notice: 4,
      unknown: 5,
    };
    const sorted = [...filled].sort(
      (a, b) => (kindOrder[a.kind ?? 'unknown'] ?? 5) - (kindOrder[b.kind ?? 'unknown'] ?? 5)
    );

    // v0.7.2: 含まれる kind ごとに代表例 1 件ずつを生成。
    // comparison / attachment は pdf-reader-mcp v0.3.0+ の `extract_tables` を最優先推奨。
    const examples = buildReaderHintExamples(sorted);

    return {
      docType: doc.docType,
      docId: doc.docId,
      title: doc.title,
      sourceUrl: doc.sourceUrl,
      attachedPdfs: sorted,
      reader_hints: {
        tool: '@shuji-bonji/pdf-reader-mcp',
        // 主軸 action は kind ごとに変わるが、レスポンスでは「最も多い」傾向に合わせて
        // 表組み中心 → extract_tables、それ以外 → read_text を hint として置く。
        primary_action: examples.some((e) => e.tool === 'extract_tables')
          ? 'extract_tables'
          : 'read_text',
        min_pdf_reader_version: '0.3.0',
        note: '本文取得は pdf-reader-mcp に委譲（責務分離）。comparison / attachment は extract_tables (v0.3.0+) で表構造を保持したまま抽出するのが最優先。それ以外は read_text。examples を kind 別に参考にしてください。',
        examples,
      },
      // v0.9.1: docType 別の legal_status を返す (Issue #1)
      legal_status: LEGAL_STATUS_BY_DOCTYPE[doc.docType] ?? TSUTATSU_LEGAL_STATUS,
    };
  } finally {
    closeDb(db);
  }
}

/**
 * tools/call の受け口の表。
 *
 * 引数は unknown で受け、`bindTool()` が inputSchema で検証してから型付きで各 handler に渡す
 * （v0.14.0。v0.13.0 までは `(args: any) => …` の表で、検証は server.ts が行っていた）。
 * handler の第 2 引数（テスト用の dbPath など）を渡さないよう、`(args) => handler(args)` で包む。
 */
export const toolHandlers: Record<string, ToolHandler> = {
  nta_search_tsutatsu: bindTool(ntaSearchTsutatsuTool, (args) => handleNtaSearchTsutatsu(args)),
  nta_get_tsutatsu: bindTool(ntaGetTsutatsuTool, (args) => handleNtaGetTsutatsu(args)),
  nta_search_qa: bindTool(ntaSearchQaTool, (args) => handleNtaSearchQa(args)),
  nta_get_qa: bindTool(ntaGetQaTool, (args) => handleNtaGetQa(args)),
  nta_search_tax_answer: bindTool(ntaSearchTaxAnswerTool, (args) => handleNtaSearchTaxAnswer(args)),
  nta_get_tax_answer: bindTool(ntaGetTaxAnswerTool, (args) => handleNtaGetTaxAnswer(args)),
  nta_search_kaisei_tsutatsu: bindTool(ntaSearchKaiseiTsutatsuTool, (args) =>
    handleNtaSearchKaiseiTsutatsu(args)
  ),
  nta_get_kaisei_tsutatsu: bindTool(ntaGetKaiseiTsutatsuTool, (args) =>
    handleNtaGetKaiseiTsutatsu(args)
  ),
  nta_search_jimu_unei: bindTool(ntaSearchJimuUneiTool, (args) => handleNtaSearchJimuUnei(args)),
  nta_get_jimu_unei: bindTool(ntaGetJimuUneiTool, (args) => handleNtaGetJimuUnei(args)),
  nta_search_bunshokaitou: bindTool(ntaSearchBunshokaitouTool, (args) =>
    handleNtaSearchBunshokaitou(args)
  ),
  nta_get_bunshokaitou: bindTool(ntaGetBunshokaitouTool, (args) => handleNtaGetBunshokaitou(args)),
  nta_inspect_pdf_meta: bindTool(ntaInspectPdfMetaTool, (args) => handleNtaInspectPdfMeta(args)),
  resolve_abbreviation: bindTool(resolveAbbreviationTool, (args) =>
    handleResolveAbbreviation(args)
  ),
};
