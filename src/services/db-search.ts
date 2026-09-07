/**
 * DB Search — bulk DL された SQLite DB に対する FTS5 検索
 *
 * - `clause_fts` (trigram) で keyword を MATCH
 * - rank（FTS5 標準のスコア）で並べる
 * - snippet() で前後 5 トークンを抽出してハイライト
 * - tsutatsu join で formal_name フィルタ（特定通達のみ検索）
 */

import { resolveAbbreviation } from '@shuji-bonji/houki-abbreviations';
import type DatabaseT from 'better-sqlite3';
import type { AttachedPdf, DocType, NtaDocument } from '../types/document.js';
import { computeRelevance, type DocTypeForScoring, sortByScoreDesc } from './relevance-scoring.js';
import { normalizeClauseNumber, normalizeSearchQuery } from './text-normalize.js';

/**
 * Phase 6-1: re-rank 用に FTS5 から取得する件数の倍率。
 * 要求 limit より多く取って JS で score 順に並べ替えてから limit 件返す。
 */
const RERANK_FETCH_MULTIPLIER = 3;
const RERANK_MAX_FETCH = 150;

/** Phase 6-1: DocType (DB) → DocTypeForScoring (relevance-scoring) のマッピング */
function dbDocTypeToScoring(docType: DocType): DocTypeForScoring {
  switch (docType) {
    case 'kaisei':
      return 'kaisei';
    case 'jimu-unei':
      return 'jimu-unei';
    case 'bunshokaitou':
      return 'bunshokaitou';
    case 'qa-jirei':
      return 'qa';
    case 'tax-answer':
      return 'tax-answer';
    default: {
      // 網羅性を担保するため exhaustive check
      const _exhaustive: never = docType;
      void _exhaustive;
      return 'tax-answer';
    }
  }
}

/** 検索ヒット 1 件 */
export interface ClauseSearchHit {
  /** 通達 formal 名。例: "消費税法基本通達" */
  tsutatsu: string;
  /** 通達略称。例: "消基通" */
  abbr: string;
  /** clause 番号。例: "1-4-13の2" */
  clauseNumber: string;
  /** clause タイトル */
  title: string;
  /** snippet（マッチ前後の抜粋、`<b>...</b>` でハイライト） */
  snippet: string;
  /** 出典 URL */
  sourceUrl: string;
  /** FTS5 rank（小さいほど高スコア。bm25 ベース） */
  rank: number;
  /**
   * Phase 6-1 (v0.8.0): 0.0〜1.5 の正規化された関連性スコア。
   * doc_type 重み + clause 完全一致 boost + base(rank) で算出。
   */
  score?: number;
  /**
   * Phase 6-1 (v0.8.0): スコア決定の理由 (例: `["doc_type=tsutatsu weight 1.00", "clause exact match"]`)
   */
  scoreReasons?: string[];
}

export interface SearchClauseOptions {
  /** 通達 formal 名で絞り込み（例: "消費税法基本通達"）。未指定なら全通達横断 */
  formalName?: string;
  /** 取得件数。default 10、最大 50 */
  limit?: number;
  /**
   * Phase 6-1 (v0.8.0): キーワード全体が houki-nta 管轄の略称に該当する場合に
   * formal_name を OR 展開する。default `true`。
   */
  enableAbbreviationExpansion?: boolean;
}

/**
 * FTS5 を使った clause 検索。
 *
 * 検索対象は `clause_number` / `title` / `full_text` 全部。
 * trigram tokenizer なので「軽減税率」も「軽減」もヒットする。
 */
export function searchClauseFts(
  db: DatabaseT.Database,
  keyword: string,
  options: SearchClauseOptions = {}
): ClauseSearchHit[] {
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
  // Phase 6-1: 略称展開を含む FTS5 クエリ生成
  const built = buildFtsQueryWithAbbreviation(keyword, {
    enableExpansion: options.enableAbbreviationExpansion,
  });
  if (!built.query) return [];

  // Phase 6-1: re-rank のために要求 limit より多めに取る
  const fetchLimit = Math.min(limit * RERANK_FETCH_MULTIPLIER, RERANK_MAX_FETCH);

  const params: Array<string | number> = [built.query];
  let where = `clause_fts MATCH ?`;
  if (options.formalName) {
    where += ` AND t.formal_name = ?`;
    params.push(options.formalName);
  }
  params.push(fetchLimit);

  const sql = `
    SELECT
      t.formal_name AS tsutatsu,
      t.abbr        AS abbr,
      c.clause_number AS clauseNumber,
      c.title       AS title,
      snippet(clause_fts, 2, '<b>', '</b>', ' … ', 16) AS snippet,
      c.source_url  AS sourceUrl,
      clause_fts.rank AS rank
    FROM clause_fts
    JOIN clause c ON c.id = clause_fts.rowid
    JOIN tsutatsu t ON t.id = c.tsutatsu_id
    WHERE ${where}
    ORDER BY clause_fts.rank
    LIMIT ?
  `;

  const rawHits = db.prepare(sql).all(...params) as ClauseSearchHit[];

  // Phase 6-1: relevance score を計算して降順で並べ替え、要求 limit 件に絞る
  const scored = rawHits.map((hit) => {
    const { score, scoreReasons } = computeRelevance({
      rank: hit.rank,
      docType: 'tsutatsu',
      clauseNumber: hit.clauseNumber,
      query: keyword,
    });
    if (built.expandedFrom && scoreReasons) {
      scoreReasons.push(`abbreviation expanded: ${built.expandedFrom} → ${built.expandedTo}`);
    }
    return { ...hit, score, scoreReasons };
  });
  return sortByScoreDesc(scored).slice(0, limit);
}

/**
 * FTS5 の MATCH に渡す前に query を整形する。
 *
 * - **`normalizeSearchQuery`** で全角ハイフン・全角チルダ・全角数字・全角スペースを
 *   ASCII 化して、bulk-downloader で投入時に同じ正規化を通した DB と整合させる
 *   （Normalize-everywhere）
 * - 改行・FTS5 メタ文字を除去
 * - 完全に空 / 短すぎる場合は空文字を返す（呼び出し側で空配列を返す）
 * - trigram tokenizer は文字列を 3-gram に分解するので、フレーズ検索は `"..."` でラップ
 */
export function sanitizeFtsQuery(raw: string): string {
  return buildSanitizedPhrase(raw);
}

/**
 * 1 つのキーワードを FTS5 フレーズに整形する内部ヘルパー。
 * 半角化 → メタ文字除去 → 半角空白で AND 結合。
 */
function buildSanitizedPhrase(raw: string): string {
  if (!raw) return '';
  // 1) 全角→半角の正規化（DB 投入時と同じルール）
  const normalized = normalizeSearchQuery(raw);
  // 2) 制御文字・FTS5 メタ文字をスペース化
  const cleaned = normalized
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/["*:()]/g, ' ')
    .trim();
  if (cleaned.length < 2) return '';
  const tokens = cleaned.split(/\s+/).filter((t) => t.length >= 1);
  if (tokens.length === 0) return '';
  return tokens.map((t) => `"${t}"`).join(' AND ');
}

/**
 * v0.9.2 (Issue #14 / smoketest #3): formal を OR 展開する条件で許可される
 * `source_mcp_hint` のセット。
 *
 * - `houki-nta`: 通達・改正通達・QA・タックスアンサー・文書回答事例 (本来の主軸)
 * - `houki-egov`: 法令名 (例: "消費税法")。**通称 alias** (例: "インボイス") を
 *   houki-abbreviations に登録すると、houki-nta-mcp の検索本文 (通達等) には
 *   法令名がよく出てくるため OR 展開で広めに拾えるとヒット率が上がる。
 *
 * `houki-court` (判例) / `houki-saiketsu` (裁決) は houki-nta-mcp の検索対象外
 * なので展開しない (ただ広げてもノイズが増えるだけ)。
 */
const EXPAND_FORMAL_FOR_HINTS: ReadonlySet<string> = new Set(['houki-nta', 'houki-egov']);

/**
 * Phase 6-1: 略称展開を行ったうえで FTS5 クエリを組み立てる。
 * v0.9.2 (Issue #14): houki-egov 管轄エントリも展開対象に拡張。
 *
 * 例:
 * - "消基通" (houki-nta) → `("消基通") OR ("消費税法基本通達")`
 * - "インボイス" → 消費税法 entry hit (alias) → `("インボイス") OR ("消費税法")`
 *   通達本文に「消費税法」が頻出するため OR 展開でヒット率が上がる。
 *   Phase 6-1 の re-rank で「インボイス」自体を含む文書が score 上位に並ぶ。
 *
 * 戻り値:
 *   - `query`: FTS5 MATCH に渡す式 (空文字なら呼び出し側で 0 件扱い)
 *   - `expandedFrom`: 展開元の略称 (展開しなかった場合は undefined)
 *   - `expandedTo`: 展開先の formal name (展開しなかった場合は undefined)
 */
export function buildFtsQueryWithAbbreviation(
  keyword: string,
  options: { enableExpansion?: boolean } = {}
): { query: string; expandedFrom?: string; expandedTo?: string } {
  const enable = options.enableExpansion !== false;
  const trimmed = keyword?.trim() ?? '';
  const main = buildSanitizedPhrase(trimmed);
  if (!main) return { query: '' };
  if (!enable) return { query: main };

  const abbr = resolveAbbreviation(trimmed);
  if (!abbr) return { query: main };
  // 許可リストに含まれる source_mcp_hint のみ formal を OR 展開
  // (court / saiketsu は houki-nta の検索対象外なので展開しない)
  if (!EXPAND_FORMAL_FOR_HINTS.has(abbr.source_mcp_hint)) return { query: main };
  // formal が同一文字列なら展開しても意味がない
  if (abbr.formal === trimmed) return { query: main };

  const formalPhrase = buildSanitizedPhrase(abbr.formal);
  if (!formalPhrase) return { query: main };

  return {
    query: `(${main}) OR (${formalPhrase})`,
    expandedFrom: trimmed,
    expandedTo: abbr.formal,
  };
}

/**
 * DB 内に検索可能な clause が 1 件以上あるかを確認。
 * 0 件なら「bulk-download が必要」と判定できる。
 */
export function hasAnyClause(db: DatabaseT.Database, formalName?: string): boolean {
  if (formalName) {
    const row = db
      .prepare(
        `SELECT count(*) AS n FROM clause c JOIN tsutatsu t ON t.id = c.tsutatsu_id WHERE t.formal_name = ?`
      )
      .get(formalName) as { n: number };
    return row.n > 0;
  }
  const row = db.prepare(`SELECT count(*) AS n FROM clause`).get() as { n: number };
  return row.n > 0;
}

/* -------------------------------------------------------------------------- */
/* clause lookup — Phase 2d で nta_get_tsutatsu の DB 経由応答に使う           */
/* -------------------------------------------------------------------------- */

/** DB から取得した clause 1 件 + 通達メタ */
export interface ClauseRow {
  /** 通達 formal 名 */
  tsutatsu: string;
  /** 通達略称 */
  abbr: string;
  /** clause 番号（DB 投入時の正規化済み形式） */
  clauseNumber: string;
  /** 章番号（取得時に section テーブルから join） */
  chapterNumber: number | null;
  /** 節番号 */
  sectionNumber: number | null;
  /** タイトル */
  title: string;
  /** 連結本文（FTS5 検索対象でもある） */
  fullText: string;
  /** 本文を構造化した paragraphs 配列（JSON パース済み） */
  paragraphs: Array<{ indent: 1 | 2 | 3; text: string }>;
  /** 取得元 URL */
  sourceUrl: string;
  /** その節の最後の取得時刻 */
  fetchedAt: string;
}

/**
 * DB から指定通達の指定 clause を取得する。
 * 該当が無ければ null（呼び出し側でライブ取得にフォールバックさせる）。
 */
export function getClauseFromDb(
  db: DatabaseT.Database,
  formalName: string,
  clauseNumber: string
): ClauseRow | null {
  const sql = `
    SELECT
      t.formal_name AS tsutatsu,
      t.abbr        AS abbr,
      c.clause_number AS clauseNumber,
      c.chapter_number AS chapterNumber,
      c.section_number AS sectionNumber,
      c.title       AS title,
      c.full_text   AS fullText,
      c.paragraphs_json AS paragraphsJson,
      c.source_url  AS sourceUrl,
      COALESCE(s.fetched_at, '') AS fetchedAt
    FROM clause c
    JOIN tsutatsu t ON t.id = c.tsutatsu_id
    LEFT JOIN section s
      ON s.tsutatsu_id = c.tsutatsu_id
     AND s.chapter_number = c.chapter_number
     AND s.section_number = c.section_number
    WHERE t.formal_name = ? AND c.clause_number = ?
    LIMIT 1
  `;
  // ユーザー入力の clauseNumber も Normalize-everywhere で DB と整合させる。
  // 例: "1－4－13の2"（全角ハイフン）→ "1-4-13の2"（DB 内の正規化済み形式）
  const normalizedClauseNumber = normalizeClauseNumber(clauseNumber);
  const row = db.prepare(sql).get(formalName, normalizedClauseNumber) as
    | (Omit<ClauseRow, 'paragraphs'> & { paragraphsJson: string })
    | undefined;
  if (!row) return null;

  let paragraphs: ClauseRow['paragraphs'] = [];
  try {
    const parsed = JSON.parse(row.paragraphsJson) as ClauseRow['paragraphs'];
    if (Array.isArray(parsed)) paragraphs = parsed;
  } catch {
    // JSON パース失敗は空配列で扱う（実害最小、本文 fullText は別フィールドで持つ）
  }

  return {
    tsutatsu: row.tsutatsu,
    abbr: row.abbr,
    clauseNumber: row.clauseNumber,
    chapterNumber: row.chapterNumber,
    sectionNumber: row.sectionNumber,
    title: row.title,
    fullText: row.fullText,
    paragraphs,
    sourceUrl: row.sourceUrl,
    fetchedAt: row.fetchedAt,
  };
}

/**
 * 指定通達の利用可能 clause 番号一覧を返す（DB 経由）。
 * `clause "X-Y-Z" が見つかりません` のエラー時に hint として提示するために使う。
 */
export function listAvailableClauses(
  db: DatabaseT.Database,
  formalName: string,
  limit = 200
): string[] {
  const rows = db
    .prepare(
      `SELECT c.clause_number AS n
       FROM clause c JOIN tsutatsu t ON t.id = c.tsutatsu_id
       WHERE t.formal_name = ?
       ORDER BY c.id LIMIT ?`
    )
    .all(formalName, limit) as Array<{ n: string }>;
  return rows.map((r) => r.n);
}

/* -------------------------------------------------------------------------- */
/* document — Phase 3b で追加（改正通達 / 事務運営指針 / 文書回答事例）         */
/* -------------------------------------------------------------------------- */

export interface DocumentSearchHit {
  docType: DocType;
  docId: string;
  taxonomy: string | null;
  title: string;
  issuedAt: string | null;
  sourceUrl: string;
  snippet: string;
  rank: number;
  /**
   * Phase 6-1 (v0.8.0): 0.0〜1.5 の正規化された関連性スコア。
   * doc_type 重み + base(rank) で算出。
   */
  score?: number;
  /** Phase 6-1 (v0.8.0): スコア決定の理由 */
  scoreReasons?: string[];
}

export interface SearchDocumentOptions {
  /** 'kaisei' / 'jimu-unei' / 'bunshokaitou' で絞る */
  docType?: DocType;
  /** 税目で絞る。例: 'shohi' */
  taxonomy?: string;
  /** 取得件数。default 10、最大 50 */
  limit?: number;
  /**
   * Phase 4-2 (v0.7.1): 添付 PDF を持つ文書だけに絞る。
   *
   * - `true`: `attached_pdfs_json` が `'[]'` 以外（PDF 1 件以上）の文書だけ返す
   * - `false`: PDF を持たない文書だけ返す
   * - `undefined`: フィルタしない（既定）
   *
   * 改正点・別表・Q&A など PDF 添付が必須の重要文書だけを抽出したいときに使う。
   */
  hasPdf?: boolean;
  /**
   * Phase 6-1 (v0.8.0): キーワード全体が houki-nta 管轄の略称に該当する場合に
   * formal_name を OR 展開する。default `true`。
   */
  enableAbbreviationExpansion?: boolean;
}

/**
 * `document_fts` を使った全文検索。
 */
export function searchDocumentFts(
  db: DatabaseT.Database,
  keyword: string,
  options: SearchDocumentOptions = {}
): DocumentSearchHit[] {
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
  // Phase 6-1: 略称展開を含む FTS5 クエリ生成
  const built = buildFtsQueryWithAbbreviation(keyword, {
    enableExpansion: options.enableAbbreviationExpansion,
  });
  if (!built.query) return [];

  // Phase 6-1: re-rank のために要求 limit より多めに取る
  const fetchLimit = Math.min(limit * RERANK_FETCH_MULTIPLIER, RERANK_MAX_FETCH);

  const params: Array<string | number> = [built.query];
  let where = `document_fts MATCH ?`;
  if (options.docType) {
    where += ` AND d.doc_type = ?`;
    params.push(options.docType);
  }
  if (options.taxonomy) {
    where += ` AND d.taxonomy = ?`;
    params.push(options.taxonomy);
  }
  if (options.hasPdf === true) {
    // PDF を持つ文書だけ。NULL / '[]' / '' は全て除外
    where += ` AND d.attached_pdfs_json IS NOT NULL AND d.attached_pdfs_json != '[]' AND d.attached_pdfs_json != ''`;
  } else if (options.hasPdf === false) {
    // PDF を持たない文書だけ
    where += ` AND (d.attached_pdfs_json IS NULL OR d.attached_pdfs_json = '[]' OR d.attached_pdfs_json = '')`;
  }
  params.push(fetchLimit);

  const sql = `
    SELECT
      d.doc_type AS docType,
      d.doc_id   AS docId,
      d.taxonomy AS taxonomy,
      d.title    AS title,
      d.issued_at AS issuedAt,
      d.source_url AS sourceUrl,
      snippet(document_fts, 3, '<b>', '</b>', ' … ', 16) AS snippet,
      document_fts.rank AS rank
    FROM document_fts
    JOIN document d ON d.id = document_fts.rowid
    WHERE ${where}
    ORDER BY document_fts.rank
    LIMIT ?
  `;

  const rawHits = db.prepare(sql).all(...params) as DocumentSearchHit[];

  // Phase 6-1: relevance score を計算して降順で並べ替え、要求 limit 件に絞る
  const scored = rawHits.map((hit) => {
    const { score, scoreReasons } = computeRelevance({
      rank: hit.rank,
      docType: dbDocTypeToScoring(hit.docType),
      query: keyword,
    });
    if (built.expandedFrom && scoreReasons) {
      scoreReasons.push(`abbreviation expanded: ${built.expandedFrom} → ${built.expandedTo}`);
    }
    return { ...hit, score, scoreReasons };
  });
  return sortByScoreDesc(scored).slice(0, limit);
}

/**
 * doc_type + doc_id で 1 件取得。
 */
export function getDocumentFromDb(
  db: DatabaseT.Database,
  docType: DocType,
  docId: string
): NtaDocument | null {
  const row = db
    .prepare(
      `SELECT doc_type, doc_id, taxonomy, title, issued_at, issuer, source_url,
              fetched_at, full_text, attached_pdfs_json
       FROM document
       WHERE doc_type = ? AND doc_id = ?
       LIMIT 1`
    )
    .get(docType, docId) as
    | {
        doc_type: DocType;
        doc_id: string;
        taxonomy: string | null;
        title: string;
        issued_at: string | null;
        issuer: string | null;
        source_url: string;
        fetched_at: string;
        full_text: string;
        attached_pdfs_json: string;
      }
    | undefined;
  if (!row) return null;

  let attachedPdfs: AttachedPdf[] = [];
  try {
    const parsed = JSON.parse(row.attached_pdfs_json) as AttachedPdf[];
    if (Array.isArray(parsed)) attachedPdfs = parsed;
  } catch {
    // JSON 壊れは空配列で扱う
  }

  return {
    docType: row.doc_type,
    docId: row.doc_id,
    taxonomy: row.taxonomy ?? undefined,
    title: row.title,
    issuedAt: row.issued_at ?? undefined,
    issuer: row.issuer ?? undefined,
    sourceUrl: row.source_url,
    fetchedAt: row.fetched_at,
    fullText: row.full_text,
    attachedPdfs,
  };
}

/**
 * 利用可能 docId の一覧（hint 用）。
 */
export function listAvailableDocIds(
  db: DatabaseT.Database,
  docType: DocType,
  limit = 50
): Array<{ docId: string; title: string; issuedAt: string | null }> {
  return db
    .prepare(
      `SELECT doc_id AS docId, title, issued_at AS issuedAt
       FROM document
       WHERE doc_type = ?
       ORDER BY issued_at DESC NULLS LAST, doc_id DESC
       LIMIT ?`
    )
    .all(docType, limit) as Array<{ docId: string; title: string; issuedAt: string | null }>;
}

/* -------------------------------------------------------------------------- */
/* 改正検知 — Phase 2e で追加                                                  */
/* -------------------------------------------------------------------------- */

export interface StaleSection {
  formalName: string;
  abbr: string;
  rootUrl: string;
  chapterNumber: number;
  sectionNumber: number;
  url: string | null;
  fetchedAt: string;
}

/**
 * `fetched_at` が指定日数より古い section を列挙する。
 *
 * @param olderThanDays 何日以上古い section を返すか（例: 30 で 1 ヶ月以上）
 * @param formalName 特定通達に絞る（未指定なら全通達横断）
 */
export function findStaleSections(
  db: DatabaseT.Database,
  olderThanDays: number,
  formalName?: string
): StaleSection[] {
  // SQLite の datetime() で N 日前を計算し、それより古い fetched_at を抽出
  const params: Array<string | number> = [olderThanDays];
  let where = `s.fetched_at < datetime('now', '-' || ? || ' days')`;
  if (formalName) {
    where += ` AND t.formal_name = ?`;
    params.push(formalName);
  }
  const rows = db
    .prepare(
      `SELECT
         t.formal_name AS formalName,
         t.abbr AS abbr,
         t.source_root_url AS rootUrl,
         s.chapter_number AS chapterNumber,
         s.section_number AS sectionNumber,
         s.url AS url,
         s.fetched_at AS fetchedAt
       FROM section s JOIN tsutatsu t ON t.id = s.tsutatsu_id
       WHERE ${where}
       ORDER BY s.fetched_at ASC, t.formal_name, s.chapter_number, s.section_number`
    )
    .all(...params) as StaleSection[];
  return rows;
}
