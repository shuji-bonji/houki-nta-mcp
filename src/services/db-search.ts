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
 * Issue #18 (v0.10.1): trigram tokenizer が索引する最小文字数。
 * これ未満の語は FTS5 の MATCH に乗らない (0 件になる) ので、本文の LIKE で補完する。
 */
export const FTS_MIN_TOKEN_LENGTH = 3;
/** LIKE で補完する短い語の最小文字数 (1 文字はノイズが多すぎるため検索条件から外す) */
export const SHORT_TOKEN_MIN_LENGTH = 2;

/** キーワードを FTS5 向け / LIKE 補完向け / 除外 の 3 種に分けた結果 */
export interface KeywordAnalysis {
  /** 3 文字以上の語 (FTS5 MATCH に渡す) */
  ftsTokens: string[];
  /** 2 文字の語 (trigram では引けないので本文 LIKE で補完する) */
  shortTokens: string[];
  /** 1 文字の語 (検索条件から外す) */
  droppedTokens: string[];
}

/**
 * 半角化 → FTS5 メタ文字除去 → 空白で分割し、語の長さで 3 種に振り分ける。
 */
export function analyzeKeyword(raw: string): KeywordAnalysis {
  const result: KeywordAnalysis = { ftsTokens: [], shortTokens: [], droppedTokens: [] };
  if (!raw) return result;
  const cleaned = normalizeSearchQuery(raw)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/["*:()]/g, ' ')
    .trim();
  for (const t of cleaned.split(/\s+/).filter((t) => t.length >= 1)) {
    if (t.length >= FTS_MIN_TOKEN_LENGTH) result.ftsTokens.push(t);
    else if (t.length >= SHORT_TOKEN_MIN_LENGTH) result.shortTokens.push(t);
    else result.droppedTokens.push(t);
  }
  return result;
}

/**
 * Issue #18: 検索結果に添える注記。短い語を LIKE で補完した / 1 文字を外した ことを
 * 利用側 (LLM / Skill 層) が「仕様上ヒットしなかった」と区別できるように文で返す。
 * 注記が不要なら空配列。
 */
export function describeSearchNotes(keyword: string): string[] {
  const a = analyzeKeyword(keyword);
  const notes: string[] = [];
  if (a.shortTokens.length > 0) {
    const words = a.shortTokens.map((t) => `"${t}"`).join(' / ');
    notes.push(
      a.ftsTokens.length > 0
        ? `${words} は ${FTS_MIN_TOKEN_LENGTH} 文字未満のため FTS5 (trigram) の索引に乗りません。3 文字以上の語で全文検索したうえで、本文に ${words} を含むものに絞り込みました`
        : `${words} は ${FTS_MIN_TOKEN_LENGTH} 文字未満のため FTS5 (trigram) では検索できません。代わりに本文とタイトルの部分一致 (LIKE) で検索しました。0 件でも「該当なし」とは限らないので、${words} に語を続けて 3 文字以上にした形での再検索を推奨します`
    );
  }
  if (a.droppedTokens.length > 0) {
    notes.push(
      `${a.droppedTokens.map((t) => `"${t}"`).join(' / ')} は 1 文字のため検索条件から外しました`
    );
  }
  return notes;
}

/** LIKE 用にメタ文字をエスケープする */
function escapeLike(token: string): string {
  return `%${token.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
}

/**
 * LIKE 補完で拾った行の snippet を JS で作る (FTS5 の snippet() は使えないため)。
 * 最初に見つかった短い語の前後 `width` 文字を切り出し `<b>` で囲む。
 */
export function makeLikeSnippet(text: string, tokens: string[], width = 16): string {
  for (const t of tokens) {
    const i = text.indexOf(t);
    if (i < 0) continue;
    const start = Math.max(0, i - width);
    const end = Math.min(text.length, i + t.length + width);
    const head = start > 0 ? ' … ' : '';
    const tail = end < text.length ? ' … ' : '';
    return `${head}${text.slice(start, i)}<b>${t}</b>${text.slice(i + t.length, end)}${tail}`;
  }
  return text.slice(0, width * 2);
}

/** 短い語を全て含むか (AND 意味論)。title と full_text のどちらに含まれてもよい */
function includesAllShortTokens(title: string, fullText: string, tokens: string[]): boolean {
  return tokens.every((t) => title.includes(t) || fullText.includes(t));
}

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
  // Issue #18: 略称展開で formal に置き換わった場合、短い語は展開に吸収されたとみなす
  const shortTokens =
    built.expandedFrom && !built.query.includes(' OR ') ? [] : analyzeKeyword(keyword).shortTokens;
  if (!built.query && shortTokens.length === 0) return [];

  // Phase 6-1: re-rank のために要求 limit より多めに取る
  const fetchLimit = Math.min(limit * RERANK_FETCH_MULTIPLIER, RERANK_MAX_FETCH);

  const params: Array<string | number> = [];
  const conds: string[] = [];
  const useFts = built.query !== '';
  if (useFts) {
    conds.push('clause_fts MATCH ?');
    params.push(built.query);
  } else {
    // 短い語だけのクエリ: 本文 / タイトルの LIKE で補完 (AND 意味論)
    for (const t of shortTokens) {
      conds.push(`(c.full_text LIKE ? ESCAPE '\\' OR c.title LIKE ? ESCAPE '\\')`);
      params.push(escapeLike(t), escapeLike(t));
    }
  }
  if (options.formalName) {
    conds.push('t.formal_name = ?');
    params.push(options.formalName);
  }
  params.push(fetchLimit);

  const sql = useFts
    ? `
    SELECT
      t.formal_name AS tsutatsu,
      t.abbr        AS abbr,
      c.clause_number AS clauseNumber,
      c.title       AS title,
      c.full_text   AS fullText,
      snippet(clause_fts, 2, '<b>', '</b>', ' … ', 16) AS snippet,
      c.source_url  AS sourceUrl,
      clause_fts.rank AS rank
    FROM clause_fts
    JOIN clause c ON c.id = clause_fts.rowid
    JOIN tsutatsu t ON t.id = c.tsutatsu_id
    WHERE ${conds.join(' AND ')}
    ORDER BY clause_fts.rank
    LIMIT ?
  `
    : `
    SELECT
      t.formal_name AS tsutatsu,
      t.abbr        AS abbr,
      c.clause_number AS clauseNumber,
      c.title       AS title,
      c.full_text   AS fullText,
      '' AS snippet,
      c.source_url  AS sourceUrl,
      -1 AS rank
    FROM clause c
    JOIN tsutatsu t ON t.id = c.tsutatsu_id
    WHERE ${conds.join(' AND ')}
    ORDER BY c.id
    LIMIT ?
  `;

  type Row = ClauseSearchHit & { fullText: string };
  let rawRows = db.prepare(sql).all(...params) as Row[];
  if (useFts && shortTokens.length > 0) {
    // FTS ヒットのうち、短い語を本文に含むものだけ残す
    rawRows = rawRows.filter((r) => includesAllShortTokens(r.title, r.fullText, shortTokens));
  }

  // Phase 6-1: relevance score を計算して降順で並べ替え、要求 limit 件に絞る
  const scored = rawRows.map(({ fullText, ...hit }) => {
    const { score, scoreReasons } = computeRelevance({
      rank: hit.rank,
      docType: 'tsutatsu',
      clauseNumber: hit.clauseNumber,
      query: keyword,
    });
    if (built.expandedFrom && scoreReasons) {
      scoreReasons.push(`abbreviation expanded: ${built.expandedFrom} → ${built.expandedTo}`);
    }
    if (shortTokens.length > 0 && scoreReasons) {
      scoreReasons.push(
        useFts
          ? `short token filter (LIKE): ${shortTokens.join(', ')}`
          : `short token search (LIKE, no FTS rank): ${shortTokens.join(', ')}`
      );
    }
    const snippet = useFts ? hit.snippet : makeLikeSnippet(fullText, shortTokens);
    return { ...hit, snippet, score, scoreReasons };
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
 * - 3 文字未満の語は trigram の索引に乗らないため MATCH 式から外す (Issue #18)。
 *   3 文字以上の語が 1 つも無ければ空文字を返す（呼び出し側は LIKE 補完に回す）
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
  // Issue #18: trigram に乗らない 3 文字未満の語は MATCH 式に入れない
  // (2 文字語は searchClauseFts / searchDocumentFts が LIKE で補完する)
  const { ftsTokens } = analyzeKeyword(raw);
  if (ftsTokens.length === 0) return '';
  return ftsTokens.map((t) => `"${t}"`).join(' AND ');
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

  // Issue #18: 「消法」のように略称自体が 3 文字未満で trigram に乗らない場合は formal だけで検索する
  if (!main) {
    return { query: formalPhrase, expandedFrom: trimmed, expandedTo: abbr.formal };
  }

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
  /** 本文を構造化した paragraphs 配列（JSON パース済み）。images は Issue #17 (v0.10.1) 以降の投入分にだけ入る */
  paragraphs: Array<{
    indent: 1 | 2 | 3;
    text: string;
    images?: Array<{ alt: string; src: string }>;
  }>;
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
  // Issue #18: 略称展開で formal に置き換わった場合、短い語は展開に吸収されたとみなす
  const shortTokens =
    built.expandedFrom && !built.query.includes(' OR ') ? [] : analyzeKeyword(keyword).shortTokens;
  if (!built.query && shortTokens.length === 0) return [];

  // Phase 6-1: re-rank のために要求 limit より多めに取る
  const fetchLimit = Math.min(limit * RERANK_FETCH_MULTIPLIER, RERANK_MAX_FETCH);

  const params: Array<string | number> = [];
  const conds: string[] = [];
  const useFts = built.query !== '';
  if (useFts) {
    conds.push('document_fts MATCH ?');
    params.push(built.query);
  } else {
    // 短い語だけのクエリ: 本文 / タイトルの LIKE で補完 (AND 意味論)
    for (const t of shortTokens) {
      conds.push(`(d.full_text LIKE ? ESCAPE '\\' OR d.title LIKE ? ESCAPE '\\')`);
      params.push(escapeLike(t), escapeLike(t));
    }
  }
  if (options.docType) {
    conds.push('d.doc_type = ?');
    params.push(options.docType);
  }
  if (options.taxonomy) {
    conds.push('d.taxonomy = ?');
    params.push(options.taxonomy);
  }
  if (options.hasPdf === true) {
    // PDF を持つ文書だけ。NULL / '[]' / '' は全て除外
    conds.push(
      `d.attached_pdfs_json IS NOT NULL AND d.attached_pdfs_json != '[]' AND d.attached_pdfs_json != ''`
    );
  } else if (options.hasPdf === false) {
    // PDF を持たない文書だけ
    conds.push(
      `(d.attached_pdfs_json IS NULL OR d.attached_pdfs_json = '[]' OR d.attached_pdfs_json = '')`
    );
  }
  params.push(fetchLimit);

  const sql = useFts
    ? `
    SELECT
      d.doc_type AS docType,
      d.doc_id   AS docId,
      d.taxonomy AS taxonomy,
      d.title    AS title,
      d.issued_at AS issuedAt,
      d.source_url AS sourceUrl,
      d.full_text AS fullText,
      snippet(document_fts, 3, '<b>', '</b>', ' … ', 16) AS snippet,
      document_fts.rank AS rank
    FROM document_fts
    JOIN document d ON d.id = document_fts.rowid
    WHERE ${conds.join(' AND ')}
    ORDER BY document_fts.rank
    LIMIT ?
  `
    : `
    SELECT
      d.doc_type AS docType,
      d.doc_id   AS docId,
      d.taxonomy AS taxonomy,
      d.title    AS title,
      d.issued_at AS issuedAt,
      d.source_url AS sourceUrl,
      d.full_text AS fullText,
      '' AS snippet,
      -1 AS rank
    FROM document d
    WHERE ${conds.join(' AND ')}
    ORDER BY d.id
    LIMIT ?
  `;

  type Row = DocumentSearchHit & { fullText: string };
  let rawRows = db.prepare(sql).all(...params) as Row[];
  if (useFts && shortTokens.length > 0) {
    rawRows = rawRows.filter((r) => includesAllShortTokens(r.title, r.fullText, shortTokens));
  }

  // Phase 6-1: relevance score を計算して降順で並べ替え、要求 limit 件に絞る
  const scored = rawRows.map(({ fullText, ...hit }) => {
    const { score, scoreReasons } = computeRelevance({
      rank: hit.rank,
      docType: dbDocTypeToScoring(hit.docType),
      query: keyword,
    });
    if (built.expandedFrom && scoreReasons) {
      scoreReasons.push(`abbreviation expanded: ${built.expandedFrom} → ${built.expandedTo}`);
    }
    if (shortTokens.length > 0 && scoreReasons) {
      scoreReasons.push(
        useFts
          ? `short token filter (LIKE): ${shortTokens.join(', ')}`
          : `short token search (LIKE, no FTS rank): ${shortTokens.join(', ')}`
      );
    }
    const snippet = useFts ? hit.snippet : makeLikeSnippet(fullText, shortTokens);
    return { ...hit, snippet, score, scoreReasons };
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
