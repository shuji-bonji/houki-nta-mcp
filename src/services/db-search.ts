/**
 * DB Search — bulk DL された SQLite DB に対する FTS5 検索
 *
 * - `clause_fts` (trigram) で keyword を MATCH
 * - rank（FTS5 標準のスコア）で並べる
 * - snippet() で前後 5 トークンを抽出してハイライト
 * - tsutatsu join で formal_name フィルタ（特定通達のみ検索）
 */

import type DatabaseT from 'better-sqlite3';

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
}

export interface SearchClauseOptions {
  /** 通達 formal 名で絞り込み（例: "消費税法基本通達"）。未指定なら全通達横断 */
  formalName?: string;
  /** 取得件数。default 10、最大 50 */
  limit?: number;
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
  const sanitized = sanitizeFtsQuery(keyword);
  if (!sanitized) return [];

  const params: Array<string | number> = [sanitized];
  let where = `clause_fts MATCH ?`;
  if (options.formalName) {
    where += ` AND t.formal_name = ?`;
    params.push(options.formalName);
  }
  params.push(limit);

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

  return db.prepare(sql).all(...params) as ClauseSearchHit[];
}

/**
 * FTS5 の MATCH に渡す前に query を整形する。
 *
 * - 改行・特殊文字を除去
 * - 完全に空 / 短すぎる場合は空文字を返す（呼び出し側で空配列を返す）
 * - trigram tokenizer は文字列を 3-gram に分解するので、フレーズ検索は `"..."` でラップ
 */
export function sanitizeFtsQuery(raw: string): string {
  if (!raw) return '';
  // 制御文字・FTS5 メタ文字をスペース化
  // FTS5 のメタ: " * : ( )
  const cleaned = raw
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/["*:()]/g, ' ')
    .trim();
  if (cleaned.length < 2) return '';
  // 単一トークンは「フレーズ検索」として扱うとマッチが安定する
  // 半角/全角空白で複数語があれば AND 検索
  const tokens = cleaned.split(/[\s　]+/).filter((t) => t.length >= 1);
  if (tokens.length === 0) return '';
  return tokens.map((t) => `"${t}"`).join(' AND ');
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
  const row = db.prepare(sql).get(formalName, clauseNumber) as
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
