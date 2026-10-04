/**
 * MCP Tool Handlers — houki-nta-mcp
 *
 * Phase 1c で `nta_get_tsutatsu` を本実装。
 * Phase 1e で `nta_get_tax_answer` / `nta_get_qa` を本実装。
 * `nta_search_*` 系は Phase 2 (bulk DL + FTS5) で対応予定。
 */

import { resolveAbbreviation } from '@shuji-bonji/houki-abbreviations';
import type DatabaseT from 'better-sqlite3';
import type { QaTopic, TsutatsuTocStyle } from '../constants.js';
import {
  BUNSHOKAITOU_LEGAL_STATUS,
  bunshoMainTaxonomy,
  expandBunshoTaxonomy,
  JIMU_UNEI_LEGAL_STATUS,
  LEGAL_STATUS_BY_DOCTYPE,
  NTA_GENERAL_INFO_LEGAL_STATUS,
  NTA_HINT,
  QA_BASE_URL,
  QA_TOPICS,
  TSUTATSU_BASE_LAWS,
  TSUTATSU_LEGAL_STATUS,
  TSUTATSU_LIVE_FETCH,
  TSUTATSU_TOC_STYLES,
  TSUTATSU_URL_ROOTS,
} from '../constants.js';
import {
  bareCommand,
  closeDb,
  type DbLocation,
  type DbState,
  dbLocationForEnvPath,
  displayDbPath,
  guideCommand,
  isVersionProblem,
  openReadDb,
  openWriteBackDb,
  probeDbState,
  resolveDbLocation,
} from '../db/index.js';
import { SCHEMA_VERSION } from '../db/schema.js';
import {
  isLawServiceError,
  type LawServiceError,
  makeError,
  NEXT_ACTIONS,
  type NextAction,
} from '../errors.js';
import type { ClauseRow, DocumentSearchHit } from '../services/db-search.js';
import {
  countDocuments,
  describeExpansionNotes,
  describeSearchNotes,
  getClauseFromDb,
  hasAnyClause,
  isBulkCompleted,
  listAvailableClauses,
  listDocumentTaxonomies,
  searchClauseFtsWithExpansion,
} from '../services/db-search.js';
import { writeBackLiveDocument } from '../services/document-writeback.js';
import {
  type FreshnessRange,
  type FreshnessSummary,
  summarizeFreshnessFromDocument,
  summarizeFreshnessFromSection,
  toFreshnessRange,
  UnreadableFetchedAtError,
} from '../services/freshness.js';
import {
  indexMarkFields,
  indexStatusFields,
  REMOVED_FROM_INDEX,
  REMOVED_FROM_INDEX_NOTICE,
} from '../services/index-status.js';
import { type FetchNtaPageOptions, fetchNtaPage, NtaFetchError } from '../services/nta-scraper.js';
import { pdfFileNamesForUrls, type SavedPdf, savePdf } from '../services/pdf-files.js';
import {
  buildPdfNextActions,
  fillMissingKinds,
  refinePdfKindsForDoc,
  renderAttachedPdfsMarkdown,
  withPdfReading,
} from '../services/pdf-meta.js';
import { buildQaFullText, parseQaJirei } from '../services/qa-parser.js';
import type { RelatedLawRef, RelatedTsutatsuRef } from '../services/related-law-parser.js';
import { parseRelatedReferences } from '../services/related-law-parser.js';
import {
  extractPdfs,
  parseEffectiveDate,
  parseTaxAnswerIndex,
  TAX_ANSWER_INDEX_URL,
} from '../services/tax-answer-bulk-downloader.js';
import {
  readStoredTaxAnswerIndex,
  saveTaxAnswerIndex,
  type TaxAnswerIndexPage,
  type TaxAnswerIndexRow,
  taxAnswerFolderOf,
  touchTaxAnswerIndexPage,
} from '../services/tax-answer-index.js';
import { buildTaxAnswerFullText, parseTaxAnswer } from '../services/tax-answer-parser.js';
import {
  type DocumentSource,
  renderQaMarkdown,
  renderTaxAnswerMarkdown,
  SOURCE_LABEL,
} from '../services/tax-answer-render.js';
import { normalizeClauseNumber, normalizeJpText } from '../services/text-normalize.js';
import {
  describeClauseForm,
  fetchTsutatsuClauseLive,
  type LiveFetchOptions,
  type LiveFetchResult,
  parseLiveClause,
} from '../services/tsutatsu-live.js';
import { TsutatsuParseError } from '../services/tsutatsu-parser.js';
import { describeImageNotes, renderClauseMarkdown } from '../services/tsutatsu-render.js';
import type {
  DocType,
  NtaDocument,
  StoredQaStructure,
  StoredTaxAnswerStructure,
} from '../types/document.js';
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
import type { QaJirei } from '../types/qa.js';
import type { TaxAnswer } from '../types/tax-answer.js';
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
import { sourceFetchError } from './source-errors.js';
import {
  badFormArgument,
  bindTool,
  blankArgument,
  isBlank,
  type ToolHandler,
} from './tool-args.js';

/* -------------------------------------------------------------------------- */
/* 引数の検査のうち、inputSchema では書けないもの（v0.22.0、T1）                  */
/* -------------------------------------------------------------------------- */

/** 空白だけの keyword のときの hint（検索 6 ツール。SPEC-NTA-COMMON-ERRORS-014） */
const BLANK_KEYWORD_HINT =
  '探したい語を keyword に渡してください。例: "軽減税率"、"医療費控除"。空白だけでは検索できません';

/** inputSchema の検査のエラーと同じ next_actions（nta_search_tsutatsu の空白だけの keyword。SPEC-NTA-SEARCH-TSUTATSU-002） */
const LIST_TOOLS_ACTION: NextAction = {
  action: 'list_tools',
  reason: 'inputSchema で引数の型と必須項目を確認できます',
};

/** 取得系 3 ツールの docId の形（SPEC-NTA-COMMON-ERRORS-015 と各ツールの 010） */
interface DocIdForm {
  tool: string;
  pattern: RegExp;
  message: string;
  blankHint: string;
  formHint: string;
}

const KAISEI_DOC_ID: DocIdForm = {
  tool: 'nta_get_kaisei_tsutatsu',
  // 国税庁サイトの URL の `/kaisei/<フォルダー名>/index.htm` のフォルダー名。桁数と `-` の位置は見ない
  pattern: /^[a-z0-9-]+$/,
  message: '英小文字・数字・- だけで指定してください（例: 0026003-067、240401）',
  blankHint: 'nta_search_kaisei_tsutatsu の結果の docId を渡してください',
  formHint:
    'nta_search_kaisei_tsutatsu の結果の docId（例: "0026003-067"、"240401"）をそのまま渡してください',
};

const JIMU_UNEI_DOC_ID: DocIdForm = {
  tool: 'nta_get_jimu_unei',
  // `/law/jimu-unei/<フォルダー>/…/index.htm` のフォルダーの並び。先頭は税目フォルダー
  pattern: /^[a-z0-9-]+(\/[a-z0-9_-]+)+$/,
  message:
    '税目/…/フォルダー名 の形で、英小文字・数字・-・_ だけで指定してください（例: shotoku/shinkoku/170331）',
  blankHint: 'nta_search_jimu_unei の結果か available_doc_ids の docId を渡してください',
  formHint:
    'nta_search_jimu_unei の結果か available_doc_ids の docId（例: "shotoku/shinkoku/170331"、"sozoku/170111_1"）をそのまま渡してください',
};

const BUNSHOKAITOU_DOC_ID: DocIdForm = {
  tool: 'nta_get_bunshokaitou',
  // 本庁は `税目/フォルダー名`、国税局は `局/税目/フォルダー名`
  pattern: /^([a-z0-9_-]+\/)?[a-z0-9_-]+\/[a-z0-9_-]+$/,
  message:
    '税目/フォルダー名 か 局/税目/フォルダー名 の形で、英小文字・数字・-・_ だけで指定してください（例: shotoku/250416、tokyo/shotoku/260218）',
  blankHint: 'nta_search_bunshokaitou の結果の docId を渡してください',
  formHint:
    'nta_search_bunshokaitou の結果の docId（例: "shotoku/250416"、"tokyo/shotoku/260218"）をそのまま渡してください',
};

/**
 * DB の取得時点を読めなかったときのエラー（SPEC-NTA-COMMON-ERRORS-017）。その種別の投入をやり直す案内を付ける。
 * UnreadableFetchedAtError でない例外は undefined を返す（呼び出し側が投げ直す）
 *
 * @param flag その種別の投入フラグ。例: `--bulk-download-qa`（基本通達は `--bulk-download-all`）
 */
function unreadableFetchedAt(
  err: unknown,
  tool: string,
  flag: string,
  location: DbLocation
): LawServiceError | undefined {
  if (!(err instanceof UnreadableFetchedAtError)) return undefined;
  // v0.25.0（SPEC-NTA-DB-SCHEMA-027）: 案内のコマンドは npx の形。v0.24.x までは `houki-nta-mcp <フラグ>`
  const command = guideCommand(flag, location);
  return makeError('INTERNAL_ERROR', `取得時点を読めません: ${err.value}`, {
    hint: `ローカル DB の取得時点（fetched_at）が日付・時刻の形ではないため、鮮度を判定できません。\`${command}\` で取り込みをやり直すと、取得時点が書き直されます`,
    retryable: false,
    next_actions: [
      {
        action: 'cli_bulk_download',
        reason: '取り込みをやり直すと、DB の取得時点が日付・時刻の形で書き直されます',
        example: { command },
      },
    ],
    detail: { cause: err.causeMessage },
    tool,
  });
}

/**
 * ツールが開く DB の場所（SPEC-NTA-DB-SCHEMA-026）。MCP サーバーでは環境変数で決まる（`--db-path` は当てはまらない）。
 * ハンドラーに `dbPath` を渡したとき（テスト用）は、`HOUKI_NTA_DB_PATH` にそのパスを指定したときと同じに扱う
 */
function toolLocation(dbPath?: string): DbLocation {
  return dbPath !== undefined ? dbLocationForEnvPath(dbPath) : resolveDbLocation();
}

/**
 * 検索 6 ツールの応答の `freshness`（SPEC-NTA-SEARCH-RULES-017・022）。範囲に文書が無くても付け、
 * `db_path` に引いた DB のパス（ホームディレクトリの部分は `~`。SPEC-NTA-DB-SCHEMA-028）を入れる
 */
function freshnessOf(summary: FreshnessSummary | null, location: DbLocation): FreshnessRange {
  return toFreshnessRange(summary, displayDbPath(location.absolutePath));
}

/** `freshness.warning` に入れるコマンド（SPEC-NTA-SEARCH-RULES-017）。案内のコマンドを `` ` `` で囲む */
function warningCommand(flag: string, location: DbLocation): string {
  return `\`${guideCommand(flag, location)}\``;
}

/** 「DB に 1 件も無い」ときの hint の `<種別>` と投入のフラグ（SPEC-NTA-DB-SCHEMA-029 の下の表） */
interface DbTarget {
  label: string;
  flag: string;
}

/**
 * DB は使えるが、その種別が 1 件も無いときの hint（SPEC-NTA-DB-SCHEMA-029 の表の最後の行。文書系の 8 ツール）。
 * `--status` のコマンドは、投入したシェルの設定で開く DB を確かめるためのものなので、変数も `--db-path` も付けない
 */
function kindMissingHint(target: DbTarget, docType: DocType, location: DbLocation): string {
  return `ローカル DB（${displayDbPath(location.absolutePath)}）に${target.label}（doc_type="${docType}"）が入っていません。\`${guideCommand(target.flag, location)}\` で投入してください。投入したはずの場合は、投入したシェルで \`${bareCommand('--status')}\` を実行し、表示される DB がこの DB と同じか確かめてください（MCP クライアントから起動したサーバーは、シェルの環境変数 HOUKI_NTA_DB_PATH・XDG_CACHE_HOME を受け継がないことがあります）`;
}

/**
 * DB のファイルが無い・版の記録が無いときの hint（SPEC-NTA-DB-SCHEMA-029 の表の 1〜3 行目）。
 * どれも開こうとした DB のパス（ホームディレクトリの部分は `~`）を含む
 */
function dbAbsenceHint(
  kind: 'missing' | 'unversioned',
  location: DbLocation,
  target: DbTarget
): string {
  const path = displayDbPath(location.absolutePath);
  const command = guideCommand(target.flag, location);
  if (kind === 'unversioned') {
    return `ローカル DB（${path}）にはまだ何も投入されていません。\`${command}\` で${target.label}を投入してください`;
  }
  if (location.setting === 'HOUKI_NTA_DB_PATH') {
    return `HOUKI_NTA_DB_PATH が指すファイル（${path}）がありません。HOUKI_NTA_DB_PATH を投入した DB のファイルに直すか、\`${command}\` でこのパスに${target.label}を投入してください`;
  }
  return `ローカル DB（${path}）がありません。\`${command}\` で${target.label}を投入してください`;
}

/**
 * 取得系 3 ツールの docId を確かめる。空白だけなら SPEC-NTA-COMMON-ERRORS-014、形が合わなければ 015 のエラーを返し、
 * 合えば DB を引く値を返す。DB を開く前に呼ぶ。
 *
 * 形は、houki-abbreviations の `normalizeJpText`（全角英数字・ダッシュ類を半角にし、前後の空白を除く）を
 * 通した値で確かめる（v0.22.0、T3。SPEC-NTA-GET-*-011、SPEC-NTA-SEARCH-RULES-019）
 */
function guardDocId(form: DocIdForm, docId: string): LawServiceError | { docId: string } {
  if (isBlank(docId)) return blankArgument(form.tool, 'docId', form.blankHint);
  const value = normalizeJpText(docId);
  if (!form.pattern.test(value)) {
    return badFormArgument(form.tool, 'docId', docId, form.message, form.formHint);
  }
  return { docId: value };
}

/**
 * `nta_get_tsutatsu` の `ARTICLE_NOT_FOUND` で返す `available_clauses` の上限。
 * DB の経路（SPEC-NTA-GET-TSUTATSU-005）と国税庁サイトの経路（010、v0.23.0 の T4）で同じ件数にする
 */
const AVAILABLE_CLAUSES_LIMIT = 50;

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
/**
 * `searchTsutatsuInner` を呼び、DB の版が合わないときは「DB に 1 件も無い」応答の hint を DB の状態の文にする
 * （v0.24.0、SPEC-NTA-DB-SCHEMA-021 の注 2）
 */
export async function searchTsutatsu(...a: Parameters<typeof searchTsutatsuInner>) {
  return explainDbState(await searchTsutatsuInner(...a), a[1]?.dbPath, {
    label: '基本通達',
    flag: '--bulk-download-all',
  });
}

async function searchTsutatsuInner(args: SearchTsutatsuArgs, options: { dbPath?: string } = {}) {
  if (isBlank(args.keyword)) {
    return blankArgument('nta_search_tsutatsu', 'keyword', BLANK_KEYWORD_HINT, [LIST_TOOLS_ACTION]);
  }
  const keyword = args.keyword.trim();

  const location = toolLocation(options.dbPath);
  const db = openReadDb(location.path).db;
  try {
    if (!hasAnyClause(db)) {
      // v0.23.0（T5）: このツールは基本通達 4 種をまとめて検索するので、説明文と freshness.warning と同じく
      // --bulk-download-all を案内する（SPEC-NTA-SEARCH-TSUTATSU-003）
      // v0.25.0（#138）: 開こうとした DB のパスを入れる。ファイルが無い・版の記録が無い・版が合わないときは、
      // explainDbState が SPEC-NTA-DB-SCHEMA-029 の文に置き換える
      return makeError('TSUTATSU_NOT_FOUND', 'ローカル DB に検索対象がありません', {
        hint: `ローカル DB（${displayDbPath(location.absolutePath)}）に基本通達の条項が入っていません。\`${guideCommand('--bulk-download-all', location)}\` を実行して、基本通達 4 種を投入してください。1 つの通達だけを先に入れるときは \`${guideCommand('--bulk-download --tsutatsu=<正式名>', location)}\` でも投入できます`,
        tool: 'nta_search_tsutatsu',
        next_actions: [NEXT_ACTIONS.bulkDownloadAll(guideCommand('--bulk-download-all', location))],
      });
    }

    // limit の範囲は inputSchema で確かめてある（SPEC-NTA-SEARCH-TSUTATSU-011）。丸めない
    const limit = args.limit ?? 10;
    const { hits, expansion } = searchClauseFtsWithExpansion(db, keyword, { limit });
    // Issue #18: 3 文字未満の語を LIKE で補完した / 外した ことを応答に明示する
    // Issue #21: 通称を 0 件のため法令名に広げたときも明示する
    const searchNotes = [
      ...describeSearchNotes(keyword, expansion),
      ...describeExpansionNotes(expansion),
    ];

    // Phase 5 Resilience: section テーブルから freshness を取得（4 通達横断、tsutatsu 絞り込みなし）
    const freshness = freshnessOf(
      summarizeFreshnessFromSection(db, undefined, warningCommand('--bulk-download-all', location)),
      location
    );

    if (hits.length === 0) {
      // v0.23.0（T4）: 文書系 5 ツールの 0 件と同じく count・freshness・legal_status を付ける
      // （SPEC-NTA-SEARCH-TSUTATSU-005・010）。base_laws_by_tsutatsu と next_actions は hits から作るので付けない
      return {
        keyword,
        count: 0,
        hits: [],
        message: `"${keyword}" にマッチする clause はありません`,
        freshness,
        ...(searchNotes.length > 0 ? { search_notes: searchNotes } : {}),
        legal_status: TSUTATSU_LEGAL_STATUS,
      };
    }

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
      freshness,
      ...(searchNotes.length > 0 ? { search_notes: searchNotes } : {}),
      legal_status: TSUTATSU_LEGAL_STATUS,
      ...searchBaseLawFields(hits.map((h) => h.tsutatsu)),
    };
  } catch (err) {
    const unreadable = unreadableFetchedAt(
      err,
      'nta_search_tsutatsu',
      '--bulk-download-all',
      location
    );
    if (unreadable) return unreadable;
    throw err;
  } finally {
    closeDb(db);
  }
}

/**
 * nta_get_tsutatsu — 通達取得
 *
 * フロー:
 *   1. `name` を houki-abbreviations で resolve（管轄外なら誘導 hint）
 *   2. `clause` の全角の数字・ハイフンを半角に揃え、DB にあれば DB から返す
 *   3. DB に無ければ、bulk download 済みの通達は available_clauses を返す
 *   4. それ以外の基本通達 4 種は国税庁サイトから候補ページを選んで取る（Issue #54、
 *      `services/tsutatsu-live.ts`）
 *   5. format=markdown / json に応じてレンダリング、`legal_status` を付与
 */
export async function handleNtaGetTsutatsu(args: GetTsutatsuArgs) {
  return getTsutatsu(args);
}

/**
 * `handleNtaGetTsutatsu` のテスト容易な内部関数。
 *
 * フロー（Issue #54 以降）:
 *   1. 略称解決 + 管轄判定
 *   2. **DB lookup**: 条項が DB にあれば即時応答（fetch なし）
 *   3. 条項が DB に無く、通達が bulk download 済み（`tsutatsu.bulk_completed_at`）なら ARTICLE_NOT_FOUND
 *   4. それ以外は **国税庁サイトから取る**: 目次から候補ページを選び、順に取得して DB に書き戻す
 *   5. 基本通達 4 種以外で DB にも無ければ、bulk DL を促す hint を返す
 *
 * `fetchImpl` を差し替えてユニットテストできる。`dbPath` で in-memory DB 注入も可。
 * 国税庁サイトから取るときの上限・間隔・再試行は `LiveFetchOptions` で短くできる（テスト用）。
 */
export async function getTsutatsu(
  args: GetTsutatsuArgs,
  options: LiveFetchOptions & { dbPath?: string } = {}
) {
  // 0. 空白だけの name は略称辞書を引かずに返す（SPEC-NTA-GET-TSUTATSU-017）
  if (isBlank(args.name)) {
    return blankArgument(
      'nta_get_tsutatsu',
      'name',
      '通達名（略称の "消基通" か正式名の "消費税法基本通達" など）を渡してください'
    );
  }

  // 1. 略称解決。全角英数字・ダッシュ類・全角空白は半角に揃えてから引く（SPEC-NTA-GET-TSUTATSU-018）
  const resolved = resolveAbbreviation(args.name, { normalize: true });
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

  // 3. DB lookup を試みる。clause の全角の数字・ハイフンは、DB の経路でも
  //    国税庁サイトの経路でも半角に揃えてから読む（Issue #54）
  const clauseInput = normalizeClauseNumber(args.clause);
  const rootUrl = TSUTATSU_URL_ROOTS[resolved.formal];
  // v0.24.0（SPEC-NTA-DB-SCHEMA-021）: 書き戻すツールの入口で DB を開く。ファイルが無ければ、書き戻したときに作る。
  // 版の合わない DB は使わず、書かない
  const access = openWriteBackDb(options.dbPath);
  const db = access.db;
  try {
    const dbHit = getClauseFromDb(db, resolved.formal, clauseInput);
    if (dbHit) {
      return renderDbHit(dbHit, args.format, resolved.formal);
    }

    // 4. 条項が DB に無く、その通達を bulk download で全節取り込んである（Issue #54）なら、
    //    国税庁サイトには取りに行かず available_clauses を返す。国税庁サイトから取れない通達も同じ。
    //    書き戻した節しか無い通達は、国税庁サイトへ進む
    if (hasAnyClause(db, resolved.formal) && (!rootUrl || isBulkCompleted(db, resolved.formal))) {
      return makeError(
        'ARTICLE_NOT_FOUND',
        `clause "${args.clause}" は DB 内の "${resolved.formal}" に見つかりません`,
        {
          hint: '別の clause 番号を試すか、`--bulk-download` で再取得してください（最新の改正反映用）',
          available_clauses: listAvailableClauses(db, resolved.formal, AVAILABLE_CLAUSES_LIMIT),
        }
      );
    }

    // 5. DB miss → 国税庁サイトから取る経路（基本通達 4 種）
    if (!rootUrl) {
      // 案内のコマンド（SPEC-NTA-DB-SCHEMA-027）。v0.24.x までは `houki-nta-mcp --bulk-download --tsutatsu="<正式名>"`
      const bulkCommand = guideCommand(
        `--bulk-download --tsutatsu="${resolved.formal}"`,
        toolLocation(options.dbPath)
      );
      return makeError(
        'TSUTATSU_NOT_FOUND',
        `"${resolved.formal}" は DB にも未投入で、ライブ取得用 URL も未登録です`,
        {
          hint: `先に \`${bulkCommand}\` を実行して DB に投入してください。`,
          next_actions: [NEXT_ACTIONS.bulkDownload(bulkCommand)],
          supported_for_live: Object.keys(TSUTATSU_URL_ROOTS),
          resolved,
          tool: 'nta_get_tsutatsu',
        }
      );
    }

    const style = TSUTATSU_TOC_STYLES[resolved.formal] ?? 'shohi';
    const key = parseLiveClause(style, clauseInput);
    if (!key) {
      return makeError('INVALID_ARGUMENT', `clause の形式が不正: "${args.clause}"`, {
        hint: `${resolved.formal}の${describeClauseForm(style)}。全角の数字・ハイフンは半角に揃えて読みます`,
        resolved,
      });
    }

    const live = await fetchTsutatsuClauseLive(
      db,
      {
        formalName: resolved.formal,
        abbr: resolved.abbr,
        rootUrl,
        style,
        clause: clauseInput,
        key,
      },
      options
    );
    return renderLiveResult(live, args, resolved.formal, style, toolLocation(options.dbPath));
  } finally {
    access.persist();
    closeDb(db);
  }
}

/**
 * Issue #54: 国税庁サイトから取った結果を応答にする。
 * 見つかれば DB の経路と同じ形（`source: 'live'`）、見つからなければ通達の番号の形と
 * 見たページの番号・URL を付けたエラーにする
 */
function renderLiveResult(
  live: LiveFetchResult,
  args: GetTsutatsuArgs,
  formal: string,
  style: TsutatsuTocStyle,
  location: DbLocation
) {
  // 案内のコマンド（SPEC-NTA-DB-SCHEMA-027）。v0.24.x までは `houki-nta-mcp --bulk-download --tsutatsu="<正式名>"`
  const bulkCommand = guideCommand(`--bulk-download --tsutatsu="${formal}"`, location);
  switch (live.kind) {
    case 'fetch_error':
      // v0.24.0（SPEC-NTA-GET-TSUTATSU-009・SPEC-NTA-COMMON-ERRORS-018）: 失敗の種類ごとの SOURCE_* にし、tool を付ける。
      // 候補ページの 404 は次の候補へ進むので、ここに来る 404・410 は目次のページ（このサーバーが決めた URL）
      return sourceFetchError(live.error, live.url, 'nta_get_tsutatsu', {
        missingPageHint: `${formal}の目次のページ（${live.url}）が国税庁サイトに見つかりません（HTTP ${live.error.status}）。国税庁サイトの構成が変わった可能性があります。報告してください`,
      });
    case 'parse_error':
      return makeError('INTERNAL_ERROR', `通達ページのパースに失敗: ${live.error.message}`, {
        url: live.url,
        // v0.23.0（T5）: ページの構造の変更かパーサの不具合で、時間をおいても結果は変わらない（SPEC-NTA-COMMON-ERRORS-009）
        retryable: false,
        hint: 'パーサのバグまたは国税庁ページの構造変更の可能性。報告してください',
        detail: { url: live.url, cause: live.error.message },
      });
    case 'no_candidates':
      return makeError(
        'INVALID_ARGUMENT',
        `clause "${args.clause}" に当たるページを "${formal}" の目次から決められません`,
        {
          hint: `${formal}の${describeClauseForm(style)}。番号の形が合っていれば、\`nta_search_tsutatsu\` で条項を検索してください`,
          next_actions: [NEXT_ACTIONS.searchTsutatsu(args.clause ?? '')],
        }
      );
    case 'not_found': {
      const hints = [
        `${formal}の${describeClauseForm(style)}。番号の形を確かめてください`,
        `\`nta_search_tsutatsu\` で条項を検索するか、\`${bulkCommand}\` で全節を DB に入れると、国税庁サイトに取りに行かずに引けます`,
      ];
      if (live.skippedByLimit > 0) {
        hints.push(
          `1 回の呼び出しで国税庁サイトから取るページの上限（${TSUTATSU_LIVE_FETCH.maxPages}）に達したため、残りの候補ページ ${live.skippedByLimit} 件は見ていません`
        );
      }
      const message = live.allMissing
        ? `clause "${args.clause}" の候補ページは国税庁サイトにありませんでした（${live.searchedUrls.length} ページ）`
        : `clause "${args.clause}" は国税庁サイトの候補ページ（${live.searchedUrls.length} ページ）に見つかりません`;
      return makeError('ARTICLE_NOT_FOUND', message, {
        url: live.searchedUrls[0],
        hint: hints.join('。'),
        // v0.23.0（T4）: DB の経路と同じく最大 50 件にする（SPEC-NTA-GET-TSUTATSU-010）
        available_clauses: live.availableClauses.slice(0, AVAILABLE_CLAUSES_LIMIT),
        searched_urls: live.searchedUrls,
        next_actions: [
          NEXT_ACTIONS.searchTsutatsu(args.clause ?? ''),
          NEXT_ACTIONS.bulkDownload(bulkCommand),
        ],
      });
    }
    case 'found': {
      const { clause, section } = live;
      if (args.format === 'json') {
        return {
          tsutatsu: formal,
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
          ...baseLawFields(formal),
        };
      }
      return renderClauseMarkdown(clause, {
        sourceUrl: section.sourceUrl,
        fetchedAt: section.fetchedAt,
        baseLaws: TSUTATSU_BASE_LAWS[formal],
      });
    }
  }
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
  /** v0.25.0 から常に付ける（SPEC-NTA-SEARCH-RULES-022） */
  freshness: FreshnessRange;
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
  const location = toolLocation(options.dbPath);
  const total = countDocuments(db, { docType });
  if (total === 0) {
    // ファイルが無い・版の記録が無い・版が合わないときは、explainDbState が hint を DB の状態の文に置き換える
    return makeError(
      'DOC_NOT_FOUND',
      `ローカル DB に${meta.label}が 1 件も無いため、検索できません（「該当なし」という結果ではありません）`,
      {
        hint: kindMissingHint(meta, docType, location),
        next_actions: [NEXT_ACTIONS.bulkDownloadDocs(guideCommand(meta.flag, location))],
        tool: meta.tool,
      }
    );
  }

  // 数えるときの税目。文書回答事例は別表記（sozoku と souzoku など）をまとめて数える
  const taxonomies = args.taxonomy !== undefined ? (args.taxonomies ?? [args.taxonomy]) : undefined;
  const fresh = (filter?: readonly string[]) =>
    freshnessOf(
      summarizeFreshnessFromDocument(db, docType, filter, warningCommand(meta.flag, location)),
      location
    );

  const argName = meta.taxonomyArg ?? 'taxonomy';
  if (args.taxonomy !== undefined && countDocuments(db, { docType, taxonomy: taxonomies }) === 0) {
    const flagValue = meta.taxonomyFlagValue?.(args.taxonomy);
    const addCommand =
      meta.taxonomyFlag && flagValue !== undefined
        ? `税目を絞って投入した場合は、\`${guideCommand(`${meta.flag} ${meta.taxonomyFlag}=${flagValue}`, location)}\` で追加できます`
        : '';
    return {
      hint: `DB の${meta.label} ${formatCount(total)} 件のうち、${argName}="${args.taxonomy}" の文書はありません。${argName} を外すか、available_taxonomies の値を指定してください。${addCommand}`,
      available_taxonomies: listDocumentTaxonomies(db, docType),
      freshness: fresh(),
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
      freshness: fresh(taxonomies),
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
    freshness: fresh(taxonomies),
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
 * どちらも DB を引いて 0 件なので、`code` は 3 ツールとも `DOC_NOT_FOUND`。見分けは `error` の文・
 * `available_doc_ids`・`next_actions` で付ける（v0.22.0、houki-nta-mcp #64、SPEC-NTA-COMMON-ERRORS-016。
 * v0.21.3 までは改正通達・事務運営指針が TSUTATSU_NOT_FOUND だった）。
 */
export function explainDocIdNotFound(
  db: DatabaseT.Database,
  docType: 'kaisei' | 'jimu-unei' | 'bunshokaitou',
  docId: string,
  getTool: string,
  options: { dbPath?: string } = {}
): LawServiceError {
  const meta = DOC_SEARCH_META[docType];
  const location = toolLocation(options.dbPath);
  const total = countDocuments(db, { docType });
  if (total === 0) {
    // ファイルが無い・版の記録が無い・版が合わないときは、explainDbState が hint を DB の状態の文に置き換える
    return makeError(
      'DOC_NOT_FOUND',
      `ローカル DB に${meta.label}が 1 件も無いため、docId="${docId}" を取得できません`,
      {
        hint: kindMissingHint(meta, docType, location),
        next_actions: [NEXT_ACTIONS.bulkDownloadDocs(guideCommand(meta.flag, location))],
        tool: getTool,
      }
    );
  }
  return makeError('DOC_NOT_FOUND', `${meta.label} docId="${docId}" は見つかりません`, {
    hint: `DB の${meta.label} ${formatCount(total)} 件に、この docId はありません。available_doc_ids（新しい順に 30 件）から選ぶか、${meta.tool} で検索して docId を確かめてください。DB を投入した後に国税庁が公開した文書は、\`${guideCommand(meta.flag, location)}\` をもう一度実行すると取り込めます`,
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

/**
 * Issue #30: 検索結果に、国税庁の索引から消えた文書が混ざっていることを 1 行で伝える。
 *
 * 除外はしない。過去の課税期間を調べたい利用者が引けなくなるため。件数と注記だけを足す。
 */
function describeIndexStatusNotes(
  hits: ReadonlyArray<{ orphanedAt: string | null }>,
  searchNotes: readonly string[]
): { search_notes?: string[] } {
  const removed = hits.filter((h) => h.orphanedAt).length;
  const notes = [...searchNotes];
  if (removed > 0) {
    notes.push(
      `検索結果 ${hits.length} 件のうち ${removed} 件は国税庁の索引から外れています（\`index_status: "${REMOVED_FROM_INDEX}"\`）。${REMOVED_FROM_INDEX_NOTICE}`
    );
  }
  return notes.length > 0 ? { search_notes: notes } : {};
}

/** 発出日（`issuedAt`）を DB の値で返す種別。質疑応答事例とタックスアンサーは発出日を持たない */
const DOC_TYPES_WITH_ISSUED_AT: ReadonlySet<DocType> = new Set([
  'kaisei',
  'jimu-unei',
  'bunshokaitou',
]);

/**
 * 文書系 5 ツールの `results[]` の要素を作る（SPEC-NTA-SEARCH-RULES-015）。キーは種別によらず同じで、
 * 値の無いフィールドは `null` にする（v0.23.0 の T4）。
 *
 * - `issuedAt`: 改正通達・事務運営指針・文書回答事例は DB の発出日。質疑応答事例とタックスアンサーは常に `null`
 * - `basisDate`: タックスアンサーは DB の `issued_at`（bulk download が「法令時点」から読んだ日付）。ほかは常に `null`
 */
function docSearchResult(h: DocumentSearchHit) {
  return {
    docType: h.docType,
    docId: h.docId,
    taxonomy: h.taxonomy,
    title: h.title,
    issuedAt: DOC_TYPES_WITH_ISSUED_AT.has(h.docType) ? (h.issuedAt ?? null) : null,
    basisDate: h.docType === 'tax-answer' ? (h.issuedAt ?? null) : null,
    sourceUrl: h.sourceUrl,
    snippet: h.snippet,
    ...(h.score !== undefined ? { score: h.score } : {}),
    ...(h.scoreReasons?.length ? { scoreReasons: h.scoreReasons } : {}),
    ...indexStatusFields(h.orphanedAt),
  };
}

/**
 * 改正通達・事務運営指針・文書回答事例の json の `document`。値の無いフィールドを `null` にする
 * （v0.23.0 の T4。SPEC-NTA-GET-KAISEI-TSUTATSU-006・SPEC-NTA-GET-JIMU-UNEI-005・SPEC-NTA-GET-BUNSHOKAITOU-006）
 */
function documentJson(doc: NtaDocument) {
  return {
    ...doc,
    taxonomy: doc.taxonomy ?? null,
    issuedAt: doc.issuedAt ?? null,
    issuer: doc.issuer ?? null,
    orphanedAt: doc.orphanedAt ?? null,
  };
}

/**
 * nta_search_qa — 質疑応答事例の FTS5 検索。事前に `--bulk-download-qa` で DB 投入が必要。
 */
/**
 * `handleNtaSearchQaInner` を呼び、DB の版が合わないときは「DB に 1 件も無い」応答の hint を DB の状態の文にする
 * （v0.24.0、SPEC-NTA-DB-SCHEMA-021 の注 2）
 */
export async function handleNtaSearchQa(...a: Parameters<typeof handleNtaSearchQaInner>) {
  return explainDbState(
    await handleNtaSearchQaInner(...a),
    a[1]?.dbPath,
    DOC_SEARCH_META['qa-jirei']
  );
}

async function handleNtaSearchQaInner(args: SearchQaArgs, options: { dbPath?: string } = {}) {
  if (isBlank(args.keyword)) return blankArgument('nta_search_qa', 'keyword', BLANK_KEYWORD_HINT);
  const limit = args.limit ?? 10;
  // v0.24.0（SPEC-NTA-SEARCH-QA-010、#72）: domain は inputSchema から外した。税目での絞り込みは topic で行う
  const location = toolLocation(options.dbPath);
  const db = openReadDb(location.path).db;
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
      ...describeSearchNotes(args.keyword, expansion),
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
    const freshness = freshnessOf(
      summarizeFreshnessFromDocument(
        db,
        'qa-jirei',
        taxonomyFilter,
        warningCommand('--bulk-download-qa', location)
      ),
      location
    );
    return {
      keyword: args.keyword,
      results: hits.map(docSearchResult),
      freshness,
      ...describeIndexStatusNotes(hits, searchNotes),
      legal_status: NTA_GENERAL_INFO_LEGAL_STATUS,
    };
  } catch (err) {
    const unreadable = unreadableFetchedAt(err, 'nta_search_qa', '--bulk-download-qa', location);
    if (unreadable) return unreadable;
    throw err;
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
 *
 * Issue #29 で `nta_get_tsutatsu` と同じ流れに揃えた。
 *   1. 引数の検証
 *   2. **DB を先に引く**: `--bulk-download-qa` 済みなら国税庁サイトへ行かずに返す
 *   3. DB に無ければ国税庁サイトから取得し、DB へ書き戻す
 *
 * 応答の `source` が `"db"` か `"live"` かで、どちらから返したかが分かる。
 */
export async function getQa(args: GetQaArgs, options: LiveDocumentFetchOptions = {}) {
  const topic = args.topic;
  if (!QA_TOPICS.includes(topic as QaTopic)) {
    return makeError('INVALID_ARGUMENT', `topic "${topic}" は houki-nta-mcp では未対応です`, {
      hint: '対応税目: shotoku, gensen, joto, sozoku, hyoka, hojin, shohi, inshi, hotei',
    });
  }
  // category と id は空白だけ（SPEC-NTA-GET-QA-002）と形（013）を、DB と国税庁サイトを引く前に確かめる
  const tocHint = `税目の目次ページ（/law/shitsugi/${topic}/01.htm）でカテゴリ番号と事例番号を確かめてください`;
  const pairs = [
    ['category', args.category],
    ['id', args.id],
  ] as const;
  for (const [path, value] of pairs) {
    if (isBlank(value)) return blankArgument('nta_get_qa', path, tocHint);
  }
  for (const [path, value] of pairs) {
    // 全角の数字は半角に揃えてから形を確かめる（SPEC-NTA-GET-QA-016）
    if (!/^[0-9]{1,2}$/.test(normalizeJpText(value))) {
      return badFormArgument(
        'nta_get_qa',
        path,
        value,
        '1 桁か 2 桁の数字で指定してください',
        `category と id は "02"、"19" のような 1 桁か 2 桁の数字です。${tocHint}`
      );
    }
  }

  // パディングを綺麗に: "2" → "02" に揃える（実 URL は 2 桁ゼロ埋めが多い）
  const category = normalizeJpText(args.category).padStart(2, '0');
  const id = normalizeJpText(args.id).padStart(2, '0');
  const url = `${QA_BASE_URL}${topic}/${category}/${id}.htm`;
  const docId = `${topic}/${category}/${id}`;

  // v0.24.0（SPEC-NTA-DB-SCHEMA-021）: 書き戻すツールの入口で DB を開く。ファイルが無ければ、書き戻したときに作る。
  // 版の合わない DB は使わず、書かない
  const access = openWriteBackDb(options.dbPath);
  try {
    return await getQaWithDb(access.db, { args, options, topic, category, id, url, docId });
  } finally {
    access.persist();
    closeDb(access.db);
  }
}

/** `getQa` の DB を引いた後の処理。db は openWriteBackDb が開いたもの */
async function getQaWithDb(
  db: DatabaseT.Database,
  ctx: {
    args: GetQaArgs;
    options: LiveDocumentFetchOptions;
    topic: string;
    category: string;
    id: string;
    url: string;
    docId: string;
  }
) {
  const { args, options, topic, category, id, url, docId } = ctx;
  // Issue #29: DB を先に引く。bulk DL 済みなら国税庁サイトへ行かない
  const fromDb = readQaFromDb(docId, db);
  if (fromDb) return qaResponse(fromDb.qa, args.format, 'db', fromDb.orphanedAt);

  let html: string;
  let sourceUrl: string;
  let fetchedAt: string;
  try {
    const fetched = await fetchNtaPage(url, fetchOptionsOf(options));
    html = fetched.html;
    sourceUrl = fetched.sourceUrl;
    fetchedAt = fetched.fetchedAt;
  } catch (err) {
    if (err instanceof NtaFetchError) {
      return liveFetchError(err, url, {
        tool: 'nta_get_qa',
        missing: `質疑応答事例 topic="${topic}", category="${category}", id="${id}" のページは国税庁サイトにありません`,
        searchTool: 'nta_search_qa',
        example: { topic, keyword: '<探したい語>' },
        hint: 'topic・category・id の組み合わせを確かめてください。番号が分からないときは nta_search_qa でキーワードから探せます',
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
        // v0.23.0（T5）: ページの構造の変更かパーサの不具合で、時間をおいても結果は変わらない（SPEC-NTA-COMMON-ERRORS-009）
        retryable: false,
        hint: 'パーサのバグまたは国税庁ページの構造変更の可能性。報告してください',
        detail: { url, cause: err.message },
      });
    }
    throw err;
  }

  // Issue #29: 取得した 1 件を DB に入れる。次回は DB から返せる。
  // best effort で、失敗してもこの応答には影響しない
  writeBackQa(docId, qa, db);

  return qaResponse(qa, args.format, 'live');
}

/**
 * SPEC-NTA-DB-SCHEMA-021 の注 2: 版の合わない DB を開いた読むだけのツールの hint
 */
function dbStateHint(
  state: Extract<DbState, { kind: 'too-old' | 'too-new' | 'unreadable' }>,
  location: DbLocation
): string {
  // v0.25.0（#138）: 先頭を「ローカル DB（<パス>）」に揃え、パスのホームディレクトリの部分を ~ にし、
  // コマンドを npx の形にする。v0.24.x では「MCP サーバーが開いている DB（<絶対パス>）」と `houki-nta-mcp --quickstart`
  const path = displayDbPath(location.absolutePath);
  const quickstart = guideCommand('--quickstart', location);
  switch (state.kind) {
    case 'too-old':
      return `ローカル DB（${path}）の版 (${state.version}) は古く移行できないため、使っていません。\`${quickstart}\` などの投入のフラグを実行すると作り直します（取り込んだ中身は消えます）`;
    case 'too-new':
      return `ローカル DB（${path}）の版 (${state.version}) がこの houki-nta-mcp の版 (${SCHEMA_VERSION}) より新しいため、使っていません（DB は変更しません）。houki-nta-mcp を新しい版に更新してください`;
    case 'unreadable':
      return `ローカル DB（${path}）の版を読めないため (schema_version: ${state.raw})、使っていません（DB は変更しません）。DB ファイルを消してから \`${quickstart}\` などの投入のフラグを実行してください`;
  }
}

/**
 * 読むだけのツールの応答を、DB の状態に合わせる（v0.24.0、SPEC-NTA-DB-SCHEMA-021）。
 *
 * 版の合わない DB のとき、ツールは空の DB を引いて「DB に 1 件も無い」ときの応答（TSUTATSU_NOT_FOUND / DOC_NOT_FOUND）を作る。
 * code はそのままにし、hint を DB の状態の文にする。新しい版・読めない版では、投入しても終了コード 1 になるので、
 * next_actions から投入の案内（cli_bulk_download）を外す。
 *
 * v0.25.0（#138、SPEC-NTA-DB-SCHEMA-029）から、ファイルが無い・版の記録が無いときも hint をその状態の文にする
 * （v0.24.x では応答を変えず、「その種別が入っていません」の文のままだった）。`target` は hint の `<種別>` と投入のフラグ
 */
function explainDbState<T>(result: T, dbPath: string | undefined, target: DbTarget): T {
  if (!isLawServiceError(result)) return result;
  if (result.code !== 'DOC_NOT_FOUND' && result.code !== 'TSUTATSU_NOT_FOUND') return result;
  const location = toolLocation(dbPath);
  const state = probeDbState(location.path);
  // v0.25.0（SPEC-NTA-DB-SCHEMA-029）: ファイルが無い・版の記録が無いときも、事実に合う文にする
  if (state.kind === 'missing' || state.kind === 'unversioned') {
    return { ...result, hint: dbAbsenceHint(state.kind, location, target) } as T;
  }
  if (!isVersionProblem(state)) return result;
  const { next_actions, ...rest } = result;
  const kept =
    state.kind === 'too-old'
      ? next_actions
      : next_actions?.filter((a) => a.action !== 'cli_bulk_download');
  return {
    ...rest,
    hint: dbStateHint(state, location),
    ...(kept && kept.length > 0 ? { next_actions: kept } : {}),
  } as T;
}

/**
 * `nta_get_qa` / `nta_get_tax_answer` の国税庁サイトの経路の options。
 * `fetchImpl`・`retryBaseMs`・`timeoutMs`・`maxRetries` はテスト用（`fetchNtaPage` にそのまま渡す）
 */
export interface LiveDocumentFetchOptions {
  fetchImpl?: typeof fetch;
  dbPath?: string;
  retryBaseMs?: number;
  timeoutMs?: number;
  maxRetries?: number;
}

function fetchOptionsOf(options: LiveDocumentFetchOptions): FetchNtaPageOptions {
  const o: FetchNtaPageOptions = {};
  if (options.fetchImpl) o.fetchImpl = options.fetchImpl;
  if (options.retryBaseMs !== undefined) o.retryBaseMs = options.retryBaseMs;
  if (options.timeoutMs !== undefined) o.timeoutMs = options.timeoutMs;
  if (options.maxRetries !== undefined) o.maxRetries = options.maxRetries;
  return o;
}

/**
 * 国税庁サイトから 1 件を取るときの失敗を code に分ける（v0.22.0、houki-nta-mcp #65、SPEC-NTA-COMMON-ERRORS-016）。
 *
 * - ページが無い（HTTP 404・410、`/error/404.htm` への転送。転送は nta-scraper が status 404 の NtaFetchError にする）
 *   → `DOC_NOT_FOUND`・`retryable: false`。番号の誤りなので、検索ツールを案内する（SPEC-NTA-GET-QA-014、SPEC-NTA-GET-TAX-ANSWER-013）
 * - それ以外 → 失敗の種類ごとの `SOURCE_*`（v0.24.0、SPEC-NTA-COMMON-ERRORS-018・019。`sourceFetchError`）
 */
function liveFetchError(
  err: NtaFetchError,
  url: string,
  o: {
    tool: string;
    missing: string;
    searchTool: string;
    example: Record<string, unknown>;
    hint: string;
  }
): LawServiceError {
  const detail = err.status !== undefined ? { status: err.status, url } : { url };
  if (err.status === 404 || err.status === 410) {
    return makeError('DOC_NOT_FOUND', `${o.missing}（HTTP ${err.status}）`, {
      url,
      hint: o.hint,
      retryable: false,
      next_actions: [
        {
          action: o.searchTool,
          reason: 'キーワード検索で正しい番号を探せます',
          example: o.example,
        },
      ],
      detail,
      tool: o.tool,
    });
  }
  // v0.24.0（SPEC-NTA-COMMON-ERRORS-018・019）: 429・時間切れ・5xx・403/400・接続できない・そのほかを分ける
  return sourceFetchError(err, url, o.tool);
}

/**
 * DB から質疑応答事例 1 件を読む（Issue #29）。
 *
 * `structured_json` を持つ行だけを返す。v0.16.0 より前に投入した行は構造を持たないので、
 * `null` を返して呼び出し側に国税庁サイトから取り直させる。
 */
function readQaFromDb(
  docId: string,
  db: DatabaseT.Database
): { qa: QaJirei; orphanedAt?: string } | null {
  try {
    const doc = getDocumentFromDb(db, 'qa-jirei', docId);
    if (!doc?.structured) return null;
    const structured = doc.structured as StoredQaStructure;
    return {
      qa: { ...structured, sourceUrl: doc.sourceUrl, fetchedAt: doc.fetchedAt },
      ...(doc.orphanedAt ? { orphanedAt: doc.orphanedAt } : {}),
    };
  } catch {
    return null;
  }
}

/** 取得した質疑応答事例を DB に書き戻す（Issue #29）。失敗は無視する */
function writeBackQa(docId: string, qa: QaJirei, db: DatabaseT.Database): void {
  try {
    {
      const { sourceUrl: _s, fetchedAt: _f, ...structured } = qa;
      writeBackLiveDocument(db, {
        docType: 'qa-jirei',
        docId,
        taxonomy: qa.topic,
        // bulk download と同じ行になるように、題名にも同じ正規化を通す（content_hash が揃う）
        title: normalizeJpText(qa.title),
        issuedAt: undefined,
        issuer: '国税庁',
        sourceUrl: qa.sourceUrl,
        fetchedAt: qa.fetchedAt,
        fullText: buildQaFullText(qa),
        attachedPdfs: [],
        structured,
      });
    }
  } catch {
    // best effort: 書き戻しに失敗しても応答は返せる
  }
}

/** 質疑応答事例 1 件を応答の形にする（DB / live で同じ形にするため共有する） */
function qaResponse(
  qa: QaJirei,
  format: GetQaArgs['format'],
  source: DocumentSource,
  orphanedAt?: string
) {
  if (format === 'json') {
    // Issue #22: 【関係法令通達】を法令と通達の参照に分け、houki-egov-mcp / nta_get_tsutatsu へ案内する
    const { related_laws, related_tsutatsu } = parseRelatedReferences(qa.relatedLaws);
    const next_actions = relatedNextActions(related_laws, related_tsutatsu);
    return {
      // v0.23.0（T4）: 注記の無い事例でも notice / basisDate のキーを null で置く（SPEC-NTA-GET-QA-008）
      qa: { ...qa, notice: qa.notice ?? null, basisDate: qa.basisDate ?? null },
      source,
      ...indexMarkFields(orphanedAt),
      legal_status: NTA_GENERAL_INFO_LEGAL_STATUS,
      ...(related_laws.length > 0 ? { related_laws } : {}),
      ...(related_tsutatsu.length > 0 ? { related_tsutatsu } : {}),
      ...(next_actions.length > 0 ? { next_actions } : {}),
    };
  }
  return renderQaMarkdown(qa, source, orphanedAt);
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
/**
 * `handleNtaSearchTaxAnswerInner` を呼び、DB の版が合わないときは「DB に 1 件も無い」応答の hint を DB の状態の文にする
 * （v0.24.0、SPEC-NTA-DB-SCHEMA-021 の注 2）
 */
export async function handleNtaSearchTaxAnswer(
  ...a: Parameters<typeof handleNtaSearchTaxAnswerInner>
) {
  return explainDbState(
    await handleNtaSearchTaxAnswerInner(...a),
    a[1]?.dbPath,
    DOC_SEARCH_META['tax-answer']
  );
}

async function handleNtaSearchTaxAnswerInner(
  args: SearchTaxAnswerArgs,
  options: { dbPath?: string } = {}
) {
  if (isBlank(args.keyword)) {
    return blankArgument('nta_search_tax_answer', 'keyword', BLANK_KEYWORD_HINT);
  }
  const limit = args.limit ?? 10;
  const location = toolLocation(options.dbPath);
  const db = openReadDb(location.path).db;
  try {
    const opts: { docType: 'tax-answer'; limit: number; hasPdf?: boolean } = {
      docType: 'tax-answer',
      limit,
    };
    if (args.hasPdf !== undefined) opts.hasPdf = args.hasPdf;
    const { hits, expansion } = searchDocumentFtsWithExpansion(db, args.keyword, opts);
    // Issue #18 (短い語) / Issue #21 (通称を 0 件のため法令名に広げた)
    const searchNotes = [
      ...describeSearchNotes(args.keyword, expansion),
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
    const freshness = freshnessOf(
      summarizeFreshnessFromDocument(
        db,
        'tax-answer',
        undefined,
        warningCommand('--bulk-download-tax-answer', location)
      ),
      location
    );
    return {
      keyword: args.keyword,
      results: hits.map(docSearchResult),
      freshness,
      ...describeIndexStatusNotes(hits, searchNotes),
      legal_status: NTA_GENERAL_INFO_LEGAL_STATUS,
      // v0.23.0（T5）: 先頭の記事の本文を読む案内。docId は 4 桁の記事番号で、no にそのまま渡せる
      // （SPEC-NTA-SEARCH-TAX-ANSWER-006）
      next_actions: [
        {
          action: 'nta_get_tax_answer',
          reason: '記事の本文を読めます',
          example: { no: hits[0].docId },
        },
      ],
    };
  } catch (err) {
    const unreadable = unreadableFetchedAt(
      err,
      'nta_search_tax_answer',
      '--bulk-download-tax-answer',
      location
    );
    if (unreadable) return unreadable;
    throw err;
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
 *
 * Issue #29 で `nta_get_tsutatsu` と同じ流れに揃えた。
 *   1. 引数の検証
 *   2. **DB を先に引く**: `--bulk-download-tax-answer` 済みなら国税庁サイトへ行かずに返す
 *   3. DB に無ければ国税庁サイトから取得し、DB へ書き戻す
 *
 * 応答の `source` が `"db"` か `"live"` かで、どちらから返したかが分かる。
 */
export async function getTaxAnswer(args: GetTaxAnswerArgs, options: LiveDocumentFetchOptions = {}) {
  // 空白だけ（SPEC-NTA-GET-TAX-ANSWER-001）、数字以外（001）、4 桁でない（012）は、DB と索引を引く前に返す
  if (isBlank(args.no)) {
    return blankArgument(
      'nta_get_tax_answer',
      'no',
      'タックスアンサー番号（"6101"、"1120" のような 4 桁の数字）を渡してください'
    );
  }
  // 全角の数字は半角に揃えてから形を確かめる（SPEC-NTA-GET-TAX-ANSWER-015）
  const no = normalizeJpText(args.no);
  if (!/^[0-9]{4}$/.test(no)) {
    return badFormArgument(
      'nta_get_tax_answer',
      'no',
      args.no,
      '半角の数字 4 桁で指定してください',
      'タックスアンサー番号は "6101"（消費税の基本的なしくみ）、"1120"（医療費控除）のような 4 桁の数字です。番号が分からないときは nta_search_tax_answer で探してください'
    );
  }
  // v0.24.0（#128）: 先頭の桁では断らない（SPEC-NTA-GET-TAX-ANSWER-002 は REMOVED）。URL は DB の行 → 国税庁の索引で決める

  // v0.24.0（SPEC-NTA-DB-SCHEMA-021）: 書き戻すツールの入口で DB を開く。ファイルが無ければ、書き戻したときに作る。
  // 版の合わない DB は使わず、書かない
  const access = openWriteBackDb(options.dbPath);
  try {
    return await getTaxAnswerWithDb(access.db, { args, options, no });
  } finally {
    access.persist();
    closeDb(access.db);
  }
}

/** `getTaxAnswer` の DB を引いた後の処理。db は openWriteBackDb が開いたもの */
async function getTaxAnswerWithDb(
  db: DatabaseT.Database,
  ctx: { args: GetTaxAnswerArgs; options: LiveDocumentFetchOptions; no: string }
) {
  const { args, options, no } = ctx;
  // Issue #29: DB を先に引く。bulk DL 済みなら国税庁サイトへ行かない
  const fromDb = readTaxAnswerFromDb(no, db);
  if (fromDb && 'taxAnswer' in fromDb) {
    return taxAnswerResponse(fromDb.taxAnswer, args.format, 'db', fromDb.orphanedAt);
  }

  // SPEC-NTA-GET-TAX-ANSWER-003: 節の構造を持たない行があればその行の出典 URL、無ければ国税庁の索引で決める
  let url: string;
  if (fromDb) {
    url = fromDb.sourceUrl;
  } else {
    const resolved = await resolveTaxAnswerUrl(no, db, options);
    if (resolved.kind === 'error') return resolved.error;
    if (resolved.kind === 'not_in_index') return taxAnswerNotInIndex(no);
    url = resolved.url;
    // SPEC-NTA-GET-TAX-ANSWER-016: 索引を取ったときは、索引と記事のページのあいだを 0.3 秒あける
    if (resolved.fetchedIndex) await sleepMs(TSUTATSU_LIVE_FETCH.pageIntervalMs);
  }

  let html: string;
  let sourceUrl: string;
  let fetchedAt: string;
  try {
    const fetched = await fetchNtaPage(url, fetchOptionsOf(options));
    html = fetched.html;
    sourceUrl = fetched.sourceUrl;
    fetchedAt = fetched.fetchedAt;
  } catch (err) {
    if (err instanceof NtaFetchError) {
      return liveFetchError(err, url, {
        tool: 'nta_get_tax_answer',
        missing: `タックスアンサー no="${no}" のページは国税庁サイトにありません`,
        searchTool: 'nta_search_tax_answer',
        example: { keyword: '<探したい語>' },
        hint: '番号を確かめてください。番号が分からないときは nta_search_tax_answer でキーワードから探せます',
      });
    }
    throw err;
  }

  let taxAnswer: ReturnType<typeof parseTaxAnswer>;
  try {
    // #73: 記事番号は引数の no で決める。ページの見出しが `No.<番号> <題名>` の形でないとき、
    // 見出しから読んだ番号は空文字になり、DB に文書 ID が空の行ができてしまうため
    taxAnswer = { ...parseTaxAnswer(html, sourceUrl, fetchedAt), no };
  } catch (err) {
    if (err instanceof TsutatsuParseError) {
      return makeError('INTERNAL_ERROR', `タックスアンサーページのパースに失敗: ${err.message}`, {
        url,
        // v0.23.0（T5）: ページの構造の変更かパーサの不具合で、時間をおいても結果は変わらない（SPEC-NTA-COMMON-ERRORS-009）
        retryable: false,
        hint: 'パーサのバグまたは国税庁ページの構造変更の可能性。報告してください',
        detail: { url, cause: err.message },
      });
    }
    throw err;
  }

  // Issue #29: 取得した 1 件を DB に入れる。次回は DB から返せる。
  // best effort で、失敗してもこの応答には影響しない
  writeBackTaxAnswer(taxAnswer, html, db);

  return taxAnswerResponse(taxAnswer, args.format, 'live');
}

/** 記事の URL を国税庁の索引で決めた結果 */
type TaxAnswerUrlResolution =
  | { kind: 'url'; url: string; fetchedIndex: boolean }
  | { kind: 'not_in_index' }
  | { kind: 'error'; error: LawServiceError };

/**
 * 記事の URL を国税庁の索引で決める（v0.24.0、SPEC-NTA-GET-TAX-ANSWER-003・016・017、#128）。
 *
 * - 保存した索引が無ければ取って保存し、そこで探す（番号が無くても取り直さない）
 * - 保存した索引にあればそれを使う。無ければ前回の Last-Modified / ETag を付けて 1 回だけ取り直す。
 *   304 なら取得日時だけを書き換えて「索引に無い」、200 なら保存し直して探し直す
 * - 取得の失敗は SOURCE_*、記事の URL が 1 件も読めない索引は INTERNAL_ERROR（保存してあった一覧は書き換えない）
 */
async function resolveTaxAnswerUrl(
  no: string,
  db: DatabaseT.Database,
  options: LiveDocumentFetchOptions
): Promise<TaxAnswerUrlResolution> {
  {
    const stored = readStoredTaxAnswerIndex(db);
    const hit = stored?.entries.get(no);
    if (hit) return { kind: 'url', url: hit.url, fetchedIndex: false };

    const loaded = await fetchTaxAnswerIndex(stored?.page, options);
    if ('error' in loaded) return { kind: 'error', error: loaded.error };
    if (loaded.notModified) {
      try {
        touchTaxAnswerIndexPage(db, loaded.fetchedAt);
      } catch {
        // best effort
      }
      return { kind: 'not_in_index' };
    }
    try {
      saveTaxAnswerIndex(db, loaded.rows, loaded.page);
    } catch {
      // best effort: 保存に失敗しても、取った索引で URL は決められる
    }
    const found = loaded.rows.find((r) => r.no === no);
    return found ? { kind: 'url', url: found.url, fetchedIndex: true } : { kind: 'not_in_index' };
  }
}

/** 索引を取って読む。`previous` を渡すと条件付きで取る */
async function fetchTaxAnswerIndex(
  previous: TaxAnswerIndexPage | undefined,
  options: LiveDocumentFetchOptions
): Promise<
  | { error: LawServiceError }
  | { notModified: true; fetchedAt: string }
  | { notModified: false; rows: TaxAnswerIndexRow[]; page: TaxAnswerIndexPage }
> {
  const fetchOpts = fetchOptionsOf(options);
  if (previous?.lastModified) fetchOpts.ifModifiedSince = previous.lastModified;
  if (previous?.etag) fetchOpts.ifNoneMatch = previous.etag;
  let fetched: Awaited<ReturnType<typeof fetchNtaPage>>;
  try {
    fetched = await fetchNtaPage(TAX_ANSWER_INDEX_URL, fetchOpts);
  } catch (err) {
    if (err instanceof NtaFetchError) {
      // SPEC-NTA-GET-TAX-ANSWER-017: 索引の URL はこのサーバーが決めた値なので、404・410 も DOC_NOT_FOUND にしない
      return {
        error: sourceFetchError(err, TAX_ANSWER_INDEX_URL, 'nta_get_tax_answer', {
          missingPageHint: `国税庁のタックスアンサーの索引（${TAX_ANSWER_INDEX_URL}）が見つかりません（HTTP ${err.status}）。国税庁サイトの構成が変わった可能性があります。報告してください`,
        }),
      };
    }
    throw err;
  }
  if (fetched.notModified) return { notModified: true, fetchedAt: fetched.fetchedAt };
  const rows = parseTaxAnswerIndex(fetched.html, fetched.sourceUrl).map((e) => ({
    no: e.no,
    url: e.url,
    taxonomy: e.taxonomy,
    title: e.title,
  }));
  if (rows.length === 0) {
    const cause = '記事の URL（/taxes/shiraberu/taxanswer/<税目>/<番号>.htm）が 1 件もありません';
    return {
      error: makeError('INTERNAL_ERROR', `タックスアンサーの索引のパースに失敗: ${cause}`, {
        url: TAX_ANSWER_INDEX_URL,
        retryable: false,
        hint: 'パーサのバグまたは国税庁ページの構造変更の可能性。報告してください',
        detail: { url: TAX_ANSWER_INDEX_URL, cause },
        tool: 'nta_get_tax_answer',
      }),
    };
  }
  return {
    notModified: false,
    rows,
    page: {
      fetchedAt: fetched.fetchedAt,
      ...(fetched.lastModified ? { lastModified: fetched.lastModified } : {}),
      ...(fetched.etag ? { etag: fetched.etag } : {}),
    },
  };
}

/** SPEC-NTA-GET-TAX-ANSWER-013: DB にも国税庁の索引にも無い番号。記事のページは取りに行かない */
function taxAnswerNotInIndex(no: string): LawServiceError {
  return makeError(
    'DOC_NOT_FOUND',
    `タックスアンサー no="${no}" は国税庁の索引（${TAX_ANSWER_INDEX_URL}）にありません`,
    {
      url: TAX_ANSWER_INDEX_URL,
      hint: '番号を確かめてください。番号が分からないときは nta_search_tax_answer でキーワードから探せます',
      retryable: false,
      next_actions: [
        {
          action: 'nta_search_tax_answer',
          reason: 'キーワード検索で正しい番号を探せます',
          example: { keyword: '<探したい語>' },
        },
      ],
      detail: { url: TAX_ANSWER_INDEX_URL },
      tool: 'nta_get_tax_answer',
    }
  );
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * DB からタックスアンサー 1 件を読む（Issue #29）。
 *
 * `structured_json` を持つ行は `taxAnswer` を返す。構造を持たない行（v0.16.0 より前に投入した行）は、
 * その行の出典 URL を返し、呼び出し側はその URL を国税庁サイトから取り直す（SPEC-NTA-GET-TAX-ANSWER-003）。
 * 行が無ければ null。返す `taxAnswer.no` は引数の `no`（#73）。
 */
function readTaxAnswerFromDb(
  no: string,
  db: DatabaseT.Database
): { taxAnswer: TaxAnswer; orphanedAt?: string } | { sourceUrl: string } | null {
  try {
    const doc = getDocumentFromDb(db, 'tax-answer', no);
    if (!doc) return null;
    if (!doc.structured) return doc.sourceUrl ? { sourceUrl: doc.sourceUrl } : null;
    const structured = doc.structured as StoredTaxAnswerStructure;
    return {
      // #73: 行に記録された番号が空（見出しに No. の無いページを bulk download で入れた行）でも、
      // 応答の番号は引数の no にする
      taxAnswer: { ...structured, no, sourceUrl: doc.sourceUrl, fetchedAt: doc.fetchedAt },
      ...(doc.orphanedAt ? { orphanedAt: doc.orphanedAt } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * 取得したタックスアンサーを DB に書き戻す（Issue #29）。失敗は無視する。
 * 行の税目は取得した URL の税目フォルダ（v0.24.0、SPEC-NTA-GET-TAX-ANSWER-006・011）
 */
function writeBackTaxAnswer(ta: TaxAnswer, html: string, db: DatabaseT.Database): void {
  try {
    {
      const { sourceUrl: _s, fetchedAt: _f, ...structured } = ta;
      writeBackLiveDocument(db, {
        docType: 'tax-answer',
        docId: ta.no,
        taxonomy: taxAnswerFolderOf(ta.sourceUrl),

        // bulk download と同じ行になるように、題名にも同じ正規化を通す（content_hash が揃う）
        title: normalizeJpText(ta.title),
        issuedAt: parseEffectiveDate(ta.effectiveDate),
        issuer: '国税庁',
        sourceUrl: ta.sourceUrl,
        fetchedAt: ta.fetchedAt,
        fullText: buildTaxAnswerFullText(ta),
        attachedPdfs: extractPdfs(html, ta.sourceUrl),
        structured,
      });
    }
  } catch {
    // best effort: 書き戻しに失敗しても応答は返せる
  }
}

/** タックスアンサー 1 件を応答の形にする（DB / live で同じ形にするため共有する） */
function taxAnswerResponse(
  taxAnswer: TaxAnswer,
  format: GetTaxAnswerArgs['format'],
  source: DocumentSource,
  orphanedAt?: string
) {
  if (format === 'json') {
    return {
      // v0.23.0（T4）: 値の無いフィールドを null で置き、法令時点から読んだ basisDate を足す（SPEC-NTA-GET-TAX-ANSWER-008）。
      // basisDate は bulk download が document.issued_at に入れる値と同じ読み方（parseEffectiveDate）で、
      // DB の経路でも国税庁サイトの経路でも同じ値になる
      taxAnswer: {
        no: taxAnswer.no,
        title: taxAnswer.title,
        effectiveDate: taxAnswer.effectiveDate ?? null,
        basisDate: parseEffectiveDate(taxAnswer.effectiveDate) ?? null,
        taxCategory: taxAnswer.taxCategory ?? null,
        sections: taxAnswer.sections,
        sourceUrl: taxAnswer.sourceUrl,
        fetchedAt: taxAnswer.fetchedAt,
      },
      source,
      ...indexMarkFields(orphanedAt),
      legal_status: NTA_GENERAL_INFO_LEGAL_STATUS,
    };
  }
  return renderTaxAnswerMarkdown(taxAnswer, source, orphanedAt);
}

/**
 * resolve_abbreviation — 略称解決（houki-abbreviations 経由）
 *
 * 自分の管轄（source_mcp_hint === 'houki-nta'）以外のエントリは、
 * 「正しい MCP に誘導するヒント」と共に返す。
 */
export async function handleResolveAbbreviation(args: ResolveAbbreviationArgs) {
  // 空白だけの abbr は辞書に無い名前ではなく引数の誤り（SPEC-NTA-RESOLVE-ABBREVIATION-007）
  if (isBlank(args.abbr)) {
    return blankArgument(
      'resolve_abbreviation',
      'abbr',
      '略称・正式名称・別名（例: "消基通"、"消費税法基本通達"）を渡してください'
    );
  }
  // 全角英数字・ダッシュ類・全角空白は半角に揃えてから照合する。応答の abbr は渡した値のまま
  // （SPEC-NTA-RESOLVE-ABBREVIATION-008）
  const result = resolveAbbreviation(args.abbr, { normalize: true });

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
    ...(isInScope ? {} : describeOutOfScope(result.source_mcp_hint ?? 'unknown')),
  };
}

/** houki-hub family にある MCP サーバーの `source_mcp_hint`（houki-nta 自身を除く） */
const FAMILY_MCP_HINTS: ReadonlySet<string> = new Set(['houki-egov']);

/**
 * `resolve_abbreviation` で管轄外のエントリに付ける `hint` と `next_actions` を作る（SPEC-NTA-RESOLVE-ABBREVIATION-003）。
 *
 * - family にある管轄（houki-egov）: その MCP で取得する案内と、`nta_get_tsutatsu` の `OUT_OF_SCOPE` と同じ `delegate_to_mcp`
 * - family にまだ無い管轄: 対応する MCP サーバーがまだ無い旨だけを書き、`next_actions` は付けない。
 *   `<source_mcp_hint>-mcp` の形で、まだ無いサーバーの名前を案内しない（v0.23.0 の T5。v0.22.0 までは組み立てていた）
 */
export function describeOutOfScope(sourceMcpHint: string): {
  hint: string;
  next_actions?: NextAction[];
} {
  if (FAMILY_MCP_HINTS.has(sourceMcpHint)) {
    return {
      hint: `このエントリは ${sourceMcpHint} の管轄です。${sourceMcpHint}-mcp で取得してください。`,
      next_actions: [NEXT_ACTIONS.delegateTo(sourceMcpHint)],
    };
  }
  return {
    hint: `このエントリは ${sourceMcpHint} の管轄ですが、対応する MCP サーバーはまだありません。`,
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
/**
 * `handleNtaSearchKaiseiTsutatsuInner` を呼び、DB の版が合わないときは「DB に 1 件も無い」応答の hint を DB の状態の文にする
 * （v0.24.0、SPEC-NTA-DB-SCHEMA-021 の注 2）
 */
export async function handleNtaSearchKaiseiTsutatsu(
  ...a: Parameters<typeof handleNtaSearchKaiseiTsutatsuInner>
) {
  return explainDbState(
    await handleNtaSearchKaiseiTsutatsuInner(...a),
    a[1]?.dbPath,
    DOC_SEARCH_META.kaisei
  );
}

async function handleNtaSearchKaiseiTsutatsuInner(
  args: SearchKaiseiTsutatsuArgs,
  options: { dbPath?: string } = {}
) {
  if (isBlank(args.keyword)) {
    return blankArgument('nta_search_kaisei_tsutatsu', 'keyword', BLANK_KEYWORD_HINT);
  }
  const limit = args.limit ?? 10;
  const location = toolLocation(options.dbPath);
  const db = openReadDb(location.path).db;
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
      ...describeSearchNotes(args.keyword, expansion),
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
    const freshness = freshnessOf(
      summarizeFreshnessFromDocument(
        db,
        'kaisei',
        taxonomyFilter,
        warningCommand('--bulk-download-kaisei', location)
      ),
      location
    );
    return {
      keyword: args.keyword,
      results: hits.map(docSearchResult),
      freshness,
      ...describeIndexStatusNotes(hits, searchNotes),
      legal_status: TSUTATSU_LEGAL_STATUS,
    };
  } catch (err) {
    const unreadable = unreadableFetchedAt(
      err,
      'nta_search_kaisei_tsutatsu',
      '--bulk-download-kaisei',
      location
    );
    if (unreadable) return unreadable;
    throw err;
  } finally {
    closeDb(db);
  }
}

/**
 * 改正通達を docId で取得する（DB 経由）。
 */
/**
 * `handleNtaGetKaiseiTsutatsuInner` を呼び、DB の版が合わないときは「DB に 1 件も無い」応答の hint を DB の状態の文にする
 * （v0.24.0、SPEC-NTA-DB-SCHEMA-021 の注 2）
 */
export async function handleNtaGetKaiseiTsutatsu(
  ...a: Parameters<typeof handleNtaGetKaiseiTsutatsuInner>
) {
  return explainDbState(
    await handleNtaGetKaiseiTsutatsuInner(...a),
    a[1]?.dbPath,
    DOC_SEARCH_META.kaisei
  );
}

async function handleNtaGetKaiseiTsutatsuInner(
  args: GetKaiseiTsutatsuArgs,
  options: { dbPath?: string } = {}
) {
  const guarded = guardDocId(KAISEI_DOC_ID, args.docId);
  if (isLawServiceError(guarded)) return guarded;
  const { docId } = guarded;
  const db = openReadDb(options.dbPath).db;
  try {
    const stored = getDocumentFromDb(db, 'kaisei', docId);
    if (!stored) {
      return explainDocIdNotFound(db, 'kaisei', docId, 'nta_get_kaisei_tsutatsu', options);
    }
    // #73: kind の無い PDF（v0.6.0 期に投入した行）は nta_inspect_pdf_meta と同じく題名から kind を決める。
    // v0.20.0 (#44): 「別紙 N」だけの PDF は新旧対照表本体として comparison にする（DB は変えない）
    const doc = {
      ...stored,
      attachedPdfs: refinePdfKindsForDoc(fillMissingKinds(stored.attachedPdfs), 'kaisei'),
    };

    if (args.format === 'json') {
      return {
        document: documentJson(doc),
        ...indexMarkFields(doc.orphanedAt),
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
function renderKaiseiMarkdown(doc: NtaDocument): string {
  const lines: string[] = [];
  lines.push(`# ${doc.title}`);
  lines.push('');
  if (doc.issuedAt) lines.push(`- **発出日**: ${doc.issuedAt}`);
  if (doc.taxonomy) lines.push(`- **税目**: ${doc.taxonomy}`);
  lines.push(`- **docId**: \`${doc.docId}\``);
  lines.push(`- **出典**: ${doc.sourceUrl}`);
  lines.push(`- **取得**: ${doc.fetchedAt}`);
  // v0.23.0（T4）: nta_get_qa / nta_get_tax_answer の「取得元」に合わせる。DB だけを引くので値は常に DB
  lines.push(`- **取得元**: ${SOURCE_LABEL.db}`);
  if (doc.orphanedAt) {
    lines.push(`- **索引の状態**: ${REMOVED_FROM_INDEX}（${doc.orphanedAt} に確認）`);
    lines.push('');
    lines.push(`> ${REMOVED_FROM_INDEX_NOTICE}`);
  }
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
/**
 * `handleNtaSearchJimuUneiInner` を呼び、DB の版が合わないときは「DB に 1 件も無い」応答の hint を DB の状態の文にする
 * （v0.24.0、SPEC-NTA-DB-SCHEMA-021 の注 2）
 */
export async function handleNtaSearchJimuUnei(
  ...a: Parameters<typeof handleNtaSearchJimuUneiInner>
) {
  return explainDbState(
    await handleNtaSearchJimuUneiInner(...a),
    a[1]?.dbPath,
    DOC_SEARCH_META['jimu-unei']
  );
}

async function handleNtaSearchJimuUneiInner(
  args: SearchJimuUneiArgs,
  options: { dbPath?: string } = {}
) {
  if (isBlank(args.keyword)) {
    return blankArgument('nta_search_jimu_unei', 'keyword', BLANK_KEYWORD_HINT);
  }
  const limit = args.limit ?? 10;
  const location = toolLocation(options.dbPath);
  const db = openReadDb(location.path).db;
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
      ...describeSearchNotes(args.keyword, expansion),
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
        // v0.24.0（SPEC-NTA-SEARCH-JIMU-UNEI-002・003、#131）: nta_get_jimu_unei の json と同じ値にする
        legal_status: JIMU_UNEI_LEGAL_STATUS,
      };
    }

    const taxonomyFilter = args.taxonomy !== undefined ? [args.taxonomy] : undefined;
    const freshness = freshnessOf(
      summarizeFreshnessFromDocument(
        db,
        'jimu-unei',
        taxonomyFilter,
        warningCommand('--bulk-download-jimu-unei', location)
      ),
      location
    );
    return {
      keyword: args.keyword,
      results: hits.map(docSearchResult),
      freshness,
      ...describeIndexStatusNotes(hits, searchNotes),
      legal_status: JIMU_UNEI_LEGAL_STATUS,
    };
  } catch (err) {
    const unreadable = unreadableFetchedAt(
      err,
      'nta_search_jimu_unei',
      '--bulk-download-jimu-unei',
      location
    );
    if (unreadable) return unreadable;
    throw err;
  } finally {
    closeDb(db);
  }
}

/**
 * 事務運営指針を docId で取得する（DB 経由）。
 */
/**
 * `handleNtaGetJimuUneiInner` を呼び、DB の版が合わないときは「DB に 1 件も無い」応答の hint を DB の状態の文にする
 * （v0.24.0、SPEC-NTA-DB-SCHEMA-021 の注 2）
 */
export async function handleNtaGetJimuUnei(...a: Parameters<typeof handleNtaGetJimuUneiInner>) {
  return explainDbState(
    await handleNtaGetJimuUneiInner(...a),
    a[1]?.dbPath,
    DOC_SEARCH_META['jimu-unei']
  );
}

async function handleNtaGetJimuUneiInner(args: GetJimuUneiArgs, options: { dbPath?: string } = {}) {
  const guarded = guardDocId(JIMU_UNEI_DOC_ID, args.docId);
  if (isLawServiceError(guarded)) return guarded;
  const { docId } = guarded;
  const db = openReadDb(options.dbPath).db;
  try {
    const stored = getDocumentFromDb(db, 'jimu-unei', docId);
    if (!stored) {
      return explainDocIdNotFound(db, 'jimu-unei', docId, 'nta_get_jimu_unei', options);
    }
    // #73（判断 3）: kind の無い添付 PDF は題名から kind を決める（SPEC-NTA-GET-JIMU-UNEI-008）。DB は書き換えない
    const doc = { ...stored, attachedPdfs: fillMissingKinds(stored.attachedPdfs) };
    if (args.format === 'json') {
      return {
        document: documentJson(doc),
        ...indexMarkFields(doc.orphanedAt),
        legal_status: JIMU_UNEI_LEGAL_STATUS,
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
  doc: NtaDocument,
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
  // v0.23.0（T4）: nta_get_qa / nta_get_tax_answer の「取得元」に合わせる。DB だけを引くので値は常に DB
  lines.push(`- **取得元**: ${SOURCE_LABEL.db}`);
  if (doc.orphanedAt) {
    lines.push(`- **索引の状態**: ${REMOVED_FROM_INDEX}（${doc.orphanedAt} に確認）`);
    lines.push('');
    lines.push(`> ${REMOVED_FROM_INDEX_NOTICE}`);
  }
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
/**
 * `handleNtaSearchBunshokaitouInner` を呼び、DB の版が合わないときは「DB に 1 件も無い」応答の hint を DB の状態の文にする
 * （v0.24.0、SPEC-NTA-DB-SCHEMA-021 の注 2）
 */
export async function handleNtaSearchBunshokaitou(
  ...a: Parameters<typeof handleNtaSearchBunshokaitouInner>
) {
  return explainDbState(
    await handleNtaSearchBunshokaitouInner(...a),
    a[1]?.dbPath,
    DOC_SEARCH_META.bunshokaitou
  );
}

async function handleNtaSearchBunshokaitouInner(
  args: SearchBunshokaitouArgs,
  options: { dbPath?: string } = {}
) {
  if (isBlank(args.keyword)) {
    return blankArgument('nta_search_bunshokaitou', 'keyword', BLANK_KEYWORD_HINT);
  }
  const limit = args.limit ?? 10;
  const location = toolLocation(options.dbPath);
  const db = openReadDb(location.path).db;
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
      ...describeSearchNotes(args.keyword, expansion),
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
    const freshness = freshnessOf(
      summarizeFreshnessFromDocument(
        db,
        'bunshokaitou',
        taxonomies,
        warningCommand('--bulk-download-bunshokaitou', location)
      ),
      location
    );
    return {
      keyword: args.keyword,
      results: hits.map(docSearchResult),
      freshness,
      ...describeIndexStatusNotes(hits, searchNotes),
      // v0.9.1: 文書回答事例固有の文言に修正 (Issue #2)
      legal_status: BUNSHOKAITOU_LEGAL_STATUS,
    };
  } catch (err) {
    const unreadable = unreadableFetchedAt(
      err,
      'nta_search_bunshokaitou',
      '--bulk-download-bunshokaitou',
      location
    );
    if (unreadable) return unreadable;
    throw err;
  } finally {
    closeDb(db);
  }
}

/**
 * 文書回答事例を docId で取得する（DB 経由）。
 */
/**
 * `handleNtaGetBunshokaitouInner` を呼び、DB の版が合わないときは「DB に 1 件も無い」応答の hint を DB の状態の文にする
 * （v0.24.0、SPEC-NTA-DB-SCHEMA-021 の注 2）
 */
export async function handleNtaGetBunshokaitou(
  ...a: Parameters<typeof handleNtaGetBunshokaitouInner>
) {
  return explainDbState(
    await handleNtaGetBunshokaitouInner(...a),
    a[1]?.dbPath,
    DOC_SEARCH_META.bunshokaitou
  );
}

async function handleNtaGetBunshokaitouInner(
  args: GetBunshokaitouArgs,
  options: { dbPath?: string } = {}
) {
  const guarded = guardDocId(BUNSHOKAITOU_DOC_ID, args.docId);
  if (isLawServiceError(guarded)) return guarded;
  const { docId } = guarded;
  const db = openReadDb(options.dbPath).db;
  try {
    const stored = getDocumentFromDb(db, 'bunshokaitou', docId);
    if (!stored) {
      return explainDocIdNotFound(db, 'bunshokaitou', docId, 'nta_get_bunshokaitou', options);
    }
    // #73（判断 3）: kind の無い添付 PDF は題名から kind を決める（SPEC-NTA-GET-BUNSHOKAITOU-008）。DB は書き換えない
    const doc = { ...stored, attachedPdfs: fillMissingKinds(stored.attachedPdfs) };
    if (args.format === 'json') {
      return {
        document: documentJson(doc),
        ...indexMarkFields(doc.orphanedAt),
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
/* v0.19.0 (#36): 読み方の事実 + save: true + next_actions。読み手は固定しない   */
/* -------------------------------------------------------------------------- */

/**
 * 指定文書の添付 PDF のメタ情報と読み方を返す。本文は読まない。
 *
 * 応答は 3 層に分かれる（docs/PHASE4-PDF.md §6、houki-hub の docs/DECISIONS.md 2026-09-21）:
 *  - 事実の層: `attachedPdfs[]` の url / kind / read_strategy / layout_note。どの読み手でも使える
 *  - 入手の層: `save: true` のとき PDF をサーバー側のキャッシュに置き、`saved[]` に絶対パスを返す
 *  - 呼び出し例の層: `next_actions`。pdf-reader-mcp を第一候補にし、最後に汎用の 1 件を置く
 *
 * 質疑応答事例 (qa-jirei) は PDF を持たないため対象外（tool definition で enum 制限済）。
 */
/**
 * `handleNtaInspectPdfMetaInner` を呼び、DB の版が合わないときは「DB に 1 件も無い」応答の hint を DB の状態の文にする
 * （v0.24.0、SPEC-NTA-DB-SCHEMA-021 の注 2）
 */
export async function handleNtaInspectPdfMeta(
  ...a: Parameters<typeof handleNtaInspectPdfMetaInner>
) {
  return explainDbState(
    await handleNtaInspectPdfMetaInner(...a),
    a[1]?.dbPath,
    DOC_SEARCH_META[a[0].docType]
  );
}

async function handleNtaInspectPdfMetaInner(
  args: InspectPdfMetaArgs,
  options: { dbPath?: string; filesDir?: string; fetchImpl?: typeof fetch } = {}
) {
  // 空白だけの docId は DB を引かずに返す（SPEC-NTA-INSPECT-PDF-META-019）
  if (isBlank(args.docId)) {
    return blankArgument(
      'nta_inspect_pdf_meta',
      'docId',
      'nta_search_* か nta_get_* の結果の docId を渡してください'
    );
  }
  // 全角の数字・ダッシュ類は半角に揃えてから DB を引く（SPEC-NTA-INSPECT-PDF-META-020）
  const docId = normalizeJpText(args.docId);
  const db = openReadDb(options.dbPath).db;
  try {
    const doc = getDocumentFromDb(db, args.docType, docId);
    if (!doc) {
      return makeError('DOC_NOT_FOUND', `${args.docType} の docId="${docId}" は DB に未登録です`, {
        // v0.25.0（SPEC-NTA-INSPECT-PDF-META-001）: qa-jirei のフラグは --bulk-download-qa（v0.24.x は無いフラグ
        // --bulk-download-qa-jirei を書いていた）。DB が無いときは explainDbState が DB の状態の文に置き換える
        hint: `\`${DOC_SEARCH_META[args.docType].flag}\` で投入済みか確認してください。docId が正しいかも \`nta_search_*\` で検証可能`,
      });
    }

    // v0.7.2: kind 未設定（v0.6.0 期に投入された DB レコード）はタイトルから動的補完。
    // v0.20.0 (#44): 改正通達の「別紙 N」は新旧対照表本体のことが多いので comparison に補正。
    // v0.19.0: kind ごとの read_strategy / layout_note を付ける。
    const described = withPdfReading(
      refinePdfKindsForDoc(fillMissingKinds(doc.attachedPdfs), doc.docType)
    );

    // kind 優先度（Phase 4-1 と同じ並び順）
    const kindOrder: Record<string, number> = {
      comparison: 0,
      attachment: 1,
      'qa-pdf': 2,
      related: 3,
      notice: 4,
      unknown: 5,
    };
    const sorted = [...described].sort(
      (a, b) => (kindOrder[a.kind] ?? 5) - (kindOrder[b.kind] ?? 5)
    );

    // v0.19.0: kind で絞る。該当が無いときは空で返し、ある種別を note に書く（黙って空にしない）
    const filtered = args.kind ? sorted.filter((p) => p.kind === args.kind) : sorted;
    const availableKinds = Array.from(new Set(sorted.map((p) => p.kind)));

    // v0.19.0: save: true のときだけ PDF を取得して保存する。失敗した PDF も saved[] に error 付きで残す
    // #73: ファイル名は kind で絞る前の添付 PDF 全体から決める。同じ文書の中で URL の最後のパス要素が
    // 重なる PDF（別のディレクトリの 01.pdf など）を、1 つ目のファイルを cached: true で返さず区別する
    // v0.23.0（T4）: save: true なら保存する PDF が 0 件でも saved: [] を返す（SPEC-NTA-INSPECT-PDF-META-010）
    let saved: SavedPdf[] | undefined;
    if (args.save) {
      const fileNames = pdfFileNamesForUrls(described.map((p) => p.url));
      saved = [];
      for (const pdf of filtered) {
        saved.push(
          await savePdf(pdf.url, {
            docType: doc.docType,
            docId: doc.docId,
            fileName: fileNames.get(pdf.url),
            filesDir: options.filesDir,
            fetchImpl: options.fetchImpl,
          })
        );
      }
    }
    const savedPathByUrl = new Map<string, string>();
    for (const s of saved ?? []) {
      if (s.path) savedPathByUrl.set(s.url, s.path);
    }

    const next_actions = buildPdfNextActions(filtered, savedPathByUrl);

    const failed = (saved ?? []).filter((s) => s.error);
    const noteParts: string[] = [];
    if (args.kind && filtered.length === 0) {
      noteParts.push(
        `kind="${args.kind}" の PDF はありません。この文書にある種別: ${availableKinds.join(', ') || 'なし'}`
      );
      // v0.20.0 (#44): 改正通達で comparison が無く attachment があるときは、別紙を読むよう書く
      if (
        args.kind === 'comparison' &&
        doc.docType === 'kaisei' &&
        availableKinds.includes('attachment')
      ) {
        noteParts.push(
          '改正通達（kaisei）の別紙は新旧対照表本体のことが多いので、kind="attachment" の別紙も読んでください'
        );
      }
    }
    if (failed.length > 0) {
      noteParts.push(
        `${failed.length} 件の PDF を保存できませんでした（saved[].error を参照）。その PDF は URL のまま読んでください`
      );
    }

    return {
      docType: doc.docType,
      docId: doc.docId,
      title: doc.title,
      sourceUrl: doc.sourceUrl,
      attachedPdfs: filtered,
      ...(saved ? { saved } : {}),
      // v0.23.0（T4）: 取得ツールの json と同じ索引の印（索引にあれば 3 つとも null。SPEC-NTA-INSPECT-PDF-META-002）
      ...indexMarkFields(doc.orphanedAt),
      ...(next_actions.length > 0 ? { next_actions } : {}),
      ...(noteParts.length > 0 ? { note: noteParts.join('。') } : {}),
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
