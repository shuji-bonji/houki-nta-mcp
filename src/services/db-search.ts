/**
 * DB Search — bulk DL された SQLite DB に対する FTS5 検索
 *
 * - `clause_fts` (trigram) で keyword を MATCH
 * - rank（FTS5 標準のスコア）で並べる
 * - highlight() で合った箇所に印を付け、前後の文字数を決めて JS で切り出す（#97）
 * - tsutatsu join で formal_name フィルタ（特定通達のみ検索）
 */

import { resolveAbbreviation } from '@shuji-bonji/houki-abbreviations';
import type DatabaseT from 'better-sqlite3';
import type { AttachedPdf, DocType, NtaDocument, StoredStructure } from '../types/document.js';
import { computeRelevance, type DocTypeForScoring, sortByScoreDesc } from './relevance-scoring.js';
import { normalizeClauseNumber, normalizeJpText, normalizeSearchQuery } from './text-normalize.js';

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
 *
 * 既定では英字を小文字に寄せる（検索に使う語。SPEC-NTA-SEARCH-RULES-008）。
 * `keepCase: true` は英字の大文字と小文字を渡したままにした語を返す。`search_notes` と
 * `scoreReasons` に出す語に使う（SPEC-NTA-SEARCH-RULES-006）。どちらも語の並びと長さは同じ
 */
export function analyzeKeyword(raw: string, options: { keepCase?: boolean } = {}): KeywordAnalysis {
  const result: KeywordAnalysis = { ftsTokens: [], shortTokens: [], droppedTokens: [] };
  if (!raw) return result;
  const normalized = options.keepCase
    ? normalizeJpText(raw).replace(/\s+/g, ' ')
    : normalizeSearchQuery(raw);
  const cleaned = normalized
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
 *
 * - 語の表記は、渡した keyword を半角に揃えたもので、英字の大文字と小文字は渡したまま
 *   （v0.24.0、SPEC-NTA-SEARCH-RULES-006。v0.23.0 までは小文字に寄せていた。#81）
 * - keyword 全体が 3 文字未満の略称で正式名に広げたとき（`expansion.kind === 'abbreviation'`）は、
 *   3 つの文の代わりに略称と正式名の探し方を書く文を 1 つ返す（SPEC-NTA-SEARCH-RULES-006・009。#80）
 */
export function describeSearchNotes(keyword: string, expansion?: AbbreviationExpansion): string[] {
  const shortAbbr = describeShortAbbreviationNote(expansion);
  if (shortAbbr) return [shortAbbr];
  const a = analyzeKeyword(keyword, { keepCase: true });
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

/**
 * SPEC-NTA-SEARCH-RULES-006・009（v0.24.0、#80）: 3 文字未満の略称を正式名に広げたときの文。
 * 3 文字以上の略称の展開と通称の展開は undefined（通称の文は describeExpansionNotes）
 */
function describeShortAbbreviationNote(expansion?: AbbreviationExpansion): string | undefined {
  if (expansion?.kind !== 'abbreviation') return undefined;
  const abbr = normalizeJpText(expansion.from);
  if (abbr.length >= FTS_MIN_TOKEN_LENGTH) return undefined;
  const formal = expansion.to;
  const how =
    normalizeSearchQuery(formal).trim().length >= FTS_MIN_TOKEN_LENGTH
      ? '全文検索'
      : '部分一致 (LIKE) ';
  if (abbr.length >= SHORT_TOKEN_MIN_LENGTH) {
    return `"${abbr}" は ${FTS_MIN_TOKEN_LENGTH} 文字未満のため FTS5 (trigram) では検索できません。"${abbr}" は本文とタイトルの部分一致 (LIKE) で、正式名 "${formal}" は${how}で探し、どちらかを含むものを返しました`;
  }
  return `"${abbr}" は 1 文字のため検索条件から外し、正式名 "${formal}" を${how}で探しました`;
}

/** LIKE 用にメタ文字をエスケープする */
function escapeLike(token: string): string {
  return `%${token.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
}

/** 抜粋で、合った箇所の前後に残す文字数 */
export const SNIPPET_CONTEXT_CHARS = 16;

/**
 * 合った箇所の始まりと終わりの印。FTS5 の highlight() と LIKE 補完の両方で使う。
 * 本文に現れない私用領域の文字にして、本文の `<b>` などの文字と取り違えないようにする。
 */
export const MATCH_OPEN = '\uE000';
export const MATCH_CLOSE = '\uE001';

/**
 * 印（MATCH_OPEN / MATCH_CLOSE）を付けた本文から、最初に合った箇所の前後 `width` 文字を切り出し、
 * 合った箇所を `<b>` で囲んで返す（#97）。
 *
 * - 合った箇所の途中では切らない。切り出す範囲の終わりにかかる箇所は、その箇所の終わりまで含める
 * - 前後を切った側に ` … ` を付ける
 * - 合った箇所が無ければ、先頭の `width * 2` 文字を返す
 */
export function cutAroundMatch(marked: string, width = SNIPPET_CONTEXT_CHARS): string {
  // 印を外した本文と、合った箇所の範囲 [start, end) を作る
  const ranges: Array<[number, number]> = [];
  let plain = '';
  let openAt = -1;
  for (const ch of marked) {
    if (ch === MATCH_OPEN) {
      openAt = plain.length;
    } else if (ch === MATCH_CLOSE) {
      if (openAt >= 0 && plain.length > openAt) ranges.push([openAt, plain.length]);
      openAt = -1;
    } else {
      plain = `${plain}${ch}`;
    }
  }
  if (ranges.length === 0) return plain.slice(0, width * 2);

  const [firstStart, firstEnd] = ranges[0];
  const start = Math.max(0, firstStart - width);
  let end = Math.min(plain.length, firstEnd + width);
  for (const [s, e] of ranges) {
    if (s < end && e > end) end = e;
  }

  let out = '';
  let pos = start;
  for (const [s, e] of ranges) {
    if (e <= start || s >= end) continue;
    const from = Math.max(s, start);
    out = `${out}${plain.slice(pos, from)}<b>${plain.slice(from, e)}</b>`;
    pos = e;
  }
  out = `${out}${plain.slice(pos, end)}`;
  const head = start > 0 ? ' … ' : '';
  const tail = end < plain.length ? ' … ' : '';
  return `${head}${out}${tail}`;
}

/**
 * 英字（A〜Z）だけを小文字にする。ほかの文字は変えないので、文字列の長さと位置は変わらない。
 * SPEC-NTA-SEARCH-RULES-021: 半角の英字の大文字と小文字を区別せずに比べるために使う
 */
function lowerAscii(s: string): string {
  return s.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/**
 * LIKE 補完で拾った行の snippet を JS で作る (FTS5 の snippet() は使えないため)。
 * 最初に見つかった短い語の前後 `width` 文字を切り出し `<b>` で囲む。
 * 語の位置は英字の大文字と小文字を区別せずに探し、囲む中身は本文の表記のまま
 * （v0.24.0、SPEC-NTA-SEARCH-RULES-003・021）
 */
export function makeLikeSnippet(
  text: string,
  tokens: string[],
  width = SNIPPET_CONTEXT_CHARS
): string {
  const haystack = lowerAscii(text);
  for (const t of tokens) {
    const i = haystack.indexOf(lowerAscii(t));
    if (i < 0) continue;
    return cutAroundMatch(
      `${text.slice(0, i)}${MATCH_OPEN}${text.slice(i, i + t.length)}${MATCH_CLOSE}${text.slice(i + t.length)}`,
      width
    );
  }
  return text.slice(0, width * 2);
}

/**
 * 短い語を全て含むか (AND 意味論)。title と full_text のどちらに含まれてもよい。
 * 英字の大文字と小文字は区別しない（v0.24.0、SPEC-NTA-SEARCH-RULES-004・021。#81）
 */
function includesAllShortTokens(title: string, fullText: string, tokens: string[]): boolean {
  const t1 = lowerAscii(title);
  const t2 = lowerAscii(fullText);
  return tokens.every((t) => {
    const needle = lowerAscii(t);
    return t1.includes(needle) || t2.includes(needle);
  });
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
  return searchClauseFtsWithExpansion(db, keyword, options).hits;
}

/**
 * `searchClauseFts` と同じ検索をし、実際に行った略称展開も返す（Issue #21）。
 * ハンドラは `expansion` から `search_notes` の注記を作る。
 */
export function searchClauseFtsWithExpansion(
  db: DatabaseT.Database,
  keyword: string,
  options: SearchClauseOptions = {}
): SearchResultWithExpansion<ClauseSearchHit> {
  return searchWithAliasFallback(keyword, options.enableAbbreviationExpansion, (built) =>
    runClauseQuery(db, keyword, built, options)
  );
}

function runClauseQuery(
  db: DatabaseT.Database,
  keyword: string,
  built: BuiltFtsQuery,
  options: SearchClauseOptions
): ClauseSearchHit[] {
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
  const branches = planBranches(keyword, built);
  if (branches.length === 0) return [];

  // Phase 6-1: re-rank のために要求 limit より多めに取る
  const fetchLimit = Math.min(limit * RERANK_FETCH_MULTIPLIER, RERANK_MAX_FETCH);

  type Row = ClauseSearchHit & { rowId: number; fullText: string };
  const runBranch = (branch: QueryBranch): Row[] => {
    const params: Array<string | number> = [];
    const conds: string[] = [];
    if (branch.kind === 'fts') {
      conds.push('clause_fts MATCH ?');
      params.push(branch.match);
    } else {
      // 短い語だけのクエリ: 本文 / タイトルの LIKE で補完 (AND 意味論)
      for (const t of branch.tokens) {
        conds.push(`(c.full_text LIKE ? ESCAPE '\\' OR c.title LIKE ? ESCAPE '\\')`);
        params.push(escapeLike(t), escapeLike(t));
      }
    }
    if (options.formalName) {
      conds.push('t.formal_name = ?');
      params.push(options.formalName);
    }
    params.push(fetchLimit);

    const sql =
      branch.kind === 'fts'
        ? `
    SELECT
      c.id          AS rowId,
      t.formal_name AS tsutatsu,
      t.abbr        AS abbr,
      c.clause_number AS clauseNumber,
      c.title       AS title,
      c.full_text   AS fullText,
      highlight(clause_fts, 2, char(57344), char(57345)) AS snippet,
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
      c.id          AS rowId,
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
    return db.prepare(sql).all(...params) as Row[];
  };

  // Phase 6-1: relevance score を計算して降順で並べ替え、要求 limit 件に絞る
  const scored = mergeBranchRows(branches, runBranch).map(
    ({ row, viaFts, reasons, likeTokens }) => {
      const { rowId: _rowId, fullText, ...hit } = row;
      const { score, scoreReasons } = computeRelevance({
        rank: hit.rank,
        docType: 'tsutatsu',
        clauseNumber: hit.clauseNumber,
        query: keyword,
      });
      scoreReasons.push(...reasons);
      // #97: FTS の行の snippet 列は highlight() で印を付けた本文全体。ここで前後を切り出す
      const snippet = viaFts ? cutAroundMatch(hit.snippet) : makeLikeSnippet(fullText, likeTokens);
      return { ...hit, snippet, score, scoreReasons };
    }
  );
  return sortByScoreDesc(scored).slice(0, limit);
}

/**
 * 1 回の検索で行う問い合わせ 1 つ。全文検索（`fts`）か、本文と題名の部分一致（`like`）
 *
 * ふつうは 1 つだけだが、3 文字未満の略称を広げるとき（SPEC-NTA-SEARCH-RULES-009）は、
 * 元の語と正式名をそれぞれの長さで探すので 2 つになり、結果を合わせる
 */
type QueryBranch =
  | {
      kind: 'fts';
      /** FTS5 の MATCH 式 */
      match: string;
      /** 全文検索の結果を絞り込む 2 文字の語（小文字に寄せたもの。SPEC-NTA-SEARCH-RULES-004） */
      filter: string[];
      /** この問い合わせで当たった行の scoreReasons に足す文 */
      reasons: string[];
      /**
       * 3 文字以上の略称を OR で広げたときの正式名。正式名を含む行にだけ
       * `abbreviation expanded:` を足す（SPEC-NTA-SEARCH-RULES-009）
       */
      formalCheck?: { formal: string; reason: string };
    }
  | {
      kind: 'like';
      /** 部分一致で探す語（小文字に寄せたもの。すべて含む行を返す） */
      tokens: string[];
      reasons: string[];
    };

/** 検索の語と略称の展開から、行う問い合わせを決める */
function planBranches(keyword: string, built: BuiltFtsQuery): QueryBranch[] {
  const expandedReason =
    built.expandedFrom && built.expandedTo
      ? `abbreviation expanded: ${built.expandedFrom} → ${built.expandedTo}`
      : undefined;

  // SPEC-NTA-SEARCH-RULES-009（v0.24.0、#80）: 3 文字未満の略称は、元の語と正式名をそれぞれの長さで探す
  const sa = built.shortAbbreviation;
  if (sa && expandedReason) {
    const branches: QueryBranch[] = [];
    if (sa.originalFts) {
      branches.push({ kind: 'fts', match: sa.originalFts, filter: [], reasons: [] });
    }
    if (sa.originalLike) {
      branches.push({
        kind: 'like',
        tokens: [sa.originalLike],
        reasons: [`short token search (LIKE, no FTS rank): ${sa.originalLabel}`],
      });
    }
    if (sa.formalFts) {
      branches.push({ kind: 'fts', match: sa.formalFts, filter: [], reasons: [expandedReason] });
    }
    if (sa.formalLike) {
      branches.push({ kind: 'like', tokens: [sa.formalLike], reasons: [expandedReason] });
    }
    return branches;
  }

  // Issue #18: 略称展開で formal に置き換わった場合、短い語は展開に吸収されたとみなす
  const absorbed = Boolean(built.expandedFrom) && !built.query.includes(' OR ');
  const shortTokens = absorbed ? [] : analyzeKeyword(keyword).shortTokens;
  // SPEC-NTA-SEARCH-RULES-003・004・006: scoreReasons の語は search_notes と同じ表記（大文字と小文字は渡したまま）
  const labels = (absorbed ? [] : analyzeKeyword(keyword, { keepCase: true }).shortTokens).join(
    ', '
  );

  if (built.query) {
    const reasons: string[] = [];
    let formalCheck: { formal: string; reason: string } | undefined;
    if (expandedReason && built.expandedTo) {
      if (built.expansionKind === 'abbreviation') {
        formalCheck = { formal: built.expandedTo, reason: expandedReason };
      } else {
        reasons.push(expandedReason);
      }
    }
    if (shortTokens.length > 0) reasons.push(`short token filter (LIKE): ${labels}`);
    return [{ kind: 'fts', match: built.query, filter: shortTokens, reasons, formalCheck }];
  }
  if (shortTokens.length > 0) {
    const reasons = expandedReason ? [expandedReason] : [];
    reasons.push(`short token search (LIKE, no FTS rank): ${labels}`);
    return [{ kind: 'like', tokens: shortTokens, reasons }];
  }
  return [];
}

/** 問い合わせごとの行を、同じ行（rowId）を 1 件にまとめて合わせる */
function mergeBranchRows<R extends { rowId: number; title: string; fullText: string }>(
  branches: QueryBranch[],
  runBranch: (branch: QueryBranch) => R[]
): Array<{ row: R; viaFts: boolean; reasons: string[]; likeTokens: string[] }> {
  const merged = new Map<
    number,
    { row: R; viaFts: boolean; reasons: string[]; likeTokens: string[] }
  >();
  for (const branch of branches) {
    let rows = runBranch(branch);
    if (branch.kind === 'fts' && branch.filter.length > 0) {
      // FTS ヒットのうち、短い語を本文に含むものだけ残す
      rows = rows.filter((r) => includesAllShortTokens(r.title, r.fullText, branch.filter));
    }
    for (const row of rows) {
      const reasons = [...branch.reasons];
      if (branch.kind === 'fts' && branch.formalCheck) {
        const formal = branch.formalCheck.formal;
        if (includesAllShortTokens(row.title, row.fullText, [normalizeJpText(formal)])) {
          reasons.unshift(branch.formalCheck.reason);
        }
      }
      const prev = merged.get(row.rowId);
      if (!prev) {
        merged.set(row.rowId, {
          row,
          viaFts: branch.kind === 'fts',
          reasons,
          likeTokens: branch.kind === 'like' ? branch.tokens : [],
        });
        continue;
      }
      // 全文検索で当たった行は、全文検索の順位と snippet を使う
      if (branch.kind === 'fts' && !prev.viaFts) {
        prev.row = row;
        prev.viaFts = true;
      }
      if (branch.kind === 'like' && prev.likeTokens.length === 0) prev.likeTokens = branch.tokens;
      for (const r of reasons) if (!prev.reasons.includes(r)) prev.reasons.push(r);
    }
  }
  return [...merged.values()];
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
 * Issue #21 (v0.11.1): 略称展開の種類。
 *
 * - `abbreviation`: キーワードが略称そのもの（"消基通" → 消費税法基本通達、"消法" → 消費税法）。
 *   展開先と同じものを指すので、従来どおり常に OR 展開する
 * - `alias`: キーワードが通称（houki-abbreviations の `aliases`。"インボイス"・"軽減税率"・
 *   "適格請求書発行事業者" → 消費税法）。展開先の法令名は通達・QA の本文にほぼ必ず出てくるので、
 *   常に OR 展開すると「法令名が出てくるだけ」の文書が混ざり、キーワードを含む文書が limit から押し出される。
 *   そのため **元の語で 0 件のときだけ** 展開する（本文に出てこない通称で 0 件になる問題 = Issue #14 は保つ）
 */
export type ExpansionKind = 'abbreviation' | 'alias';

/** 検索で実際に行った略称展開 */
export interface AbbreviationExpansion {
  from: string;
  to: string;
  kind: ExpansionKind;
}

/** hits と、実際に展開したときはその内容 */
export interface SearchResultWithExpansion<T> {
  hits: T[];
  expansion?: AbbreviationExpansion;
}

type BuiltFtsQuery = ReturnType<typeof buildFtsQueryWithAbbreviation>;

/**
 * Issue #21: 通称（alias）は元の語だけで先に検索し、0 件のときだけ展開して検索し直す。
 * 略称そのもの（abbreviation）と、展開しない場合は 1 回だけ検索する。
 */
function searchWithAliasFallback<T>(
  keyword: string,
  enableExpansion: boolean | undefined,
  run: (built: BuiltFtsQuery) => T[]
): SearchResultWithExpansion<T> {
  const built = buildFtsQueryWithAbbreviation(keyword, { enableExpansion });
  const expansionOf = (b: BuiltFtsQuery): AbbreviationExpansion | undefined =>
    b.expandedFrom && b.expandedTo && b.expansionKind
      ? { from: b.expandedFrom, to: b.expandedTo, kind: b.expansionKind }
      : undefined;

  if (built.expansionKind !== 'alias') {
    const hits = run(built);
    const expansion = expansionOf(built);
    return expansion ? { hits, expansion } : { hits };
  }

  const plain = buildFtsQueryWithAbbreviation(keyword, { enableExpansion: false });
  const first = run(plain);
  if (first.length > 0) return { hits: first };

  const hits = run(built);
  const expansion = expansionOf(built);
  return hits.length > 0 && expansion ? { hits, expansion } : { hits };
}

/**
 * Issue #21: 通称を 0 件のため展開したときに、応答の `search_notes` に添える注記。
 * 略称そのものの展開（"消基通" → 消費税法基本通達）は同じものを指すので注記しない。
 */
export function describeExpansionNotes(expansion?: AbbreviationExpansion): string[] {
  if (expansion?.kind !== 'alias') return [];
  const { from, to } = expansion;
  return [
    `"${from}" を含む文書は見つかりませんでした。略称辞書で "${from}" は ${to} の通称として登録されているため、"${to}" を含む文書に広げて検索しました。"${to}" という語が出てくるだけの文書も含まれます`,
  ];
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
): {
  query: string;
  expandedFrom?: string;
  expandedTo?: string;
  /** Issue #21: 略称そのもの（"消基通"・"消法"）か、通称（aliases。"インボイス"・"軽減税率"）か */
  expansionKind?: ExpansionKind;
  /**
   * SPEC-NTA-SEARCH-RULES-009（v0.24.0、#80）: 略称そのものを広げ、元の語か正式名が 3 文字未満のときの探し方。
   * 元の語と正式名を、それぞれの長さで全文検索（3 文字以上）か部分一致（2 文字）で探し、1 文字は使わない。
   * `query` は全文検索の式を OR でつないだもの（部分一致だけなら空文字）
   */
  shortAbbreviation?: ShortAbbreviationPlan;
} {
  const enable = options.enableExpansion !== false;
  const trimmed = keyword?.trim() ?? '';
  const main = buildSanitizedPhrase(trimmed);
  if (!enable) return { query: main };

  // 全角英数字・ダッシュ類・全角空白は半角に揃えてから辞書を引き、辞書の名前とも揃えた値で比べる
  // （v0.22.0、SPEC-NTA-SEARCH-RULES-019。"ＰＬ法" は "PL法" と同じく略称として広げる）
  const abbr = resolveAbbreviation(trimmed, { normalize: true });
  if (!abbr) return { query: main };
  const key = normalizeJpText(trimmed);
  // 許可リストに含まれる source_mcp_hint のみ formal を OR 展開
  // (court / saiketsu は houki-nta の検索対象外なので展開しない)
  if (!EXPAND_FORMAL_FOR_HINTS.has(abbr.source_mcp_hint)) return { query: main };
  // formal が同一文字列なら展開しても意味がない
  if (abbr.formal === key) return { query: main };

  const formalPhrase = buildSanitizedPhrase(abbr.formal);
  const expansionKind: ExpansionKind = abbr.abbr === key ? 'abbreviation' : 'alias';

  if (expansionKind === 'abbreviation') {
    const original = normalizeSearchQuery(key).trim();
    const formal = normalizeSearchQuery(abbr.formal).trim();
    const plan: ShortAbbreviationPlan = {
      originalLabel: key,
      ...(main ? { originalFts: main } : {}),
      ...(original.length === SHORT_TOKEN_MIN_LENGTH ? { originalLike: original } : {}),
      ...(formalPhrase ? { formalFts: formalPhrase } : {}),
      ...(!formalPhrase && formal.length === SHORT_TOKEN_MIN_LENGTH ? { formalLike: formal } : {}),
    };
    const hasFormal = Boolean(plan.formalFts || plan.formalLike);
    if (!hasFormal) return { query: main };
    const expanded = { expandedFrom: trimmed, expandedTo: abbr.formal, expansionKind };
    // 元の語も正式名も 3 文字以上なら、従来どおり 1 つの全文検索の OR 式にする
    if (plan.originalFts && plan.formalFts) {
      return { query: `(${main}) OR (${formalPhrase})`, ...expanded };
    }
    const query = [plan.originalFts, plan.formalFts].filter(Boolean).join('');
    return { query, ...expanded, shortAbbreviation: plan };
  }

  if (!formalPhrase) return { query: main };

  // Issue #18: 通称自体が 3 文字未満で trigram に乗らない場合は formal だけで検索する
  if (!main) {
    return { query: formalPhrase, expandedFrom: trimmed, expandedTo: abbr.formal, expansionKind };
  }

  return {
    query: `(${main}) OR (${formalPhrase})`,
    expandedFrom: trimmed,
    expandedTo: abbr.formal,
    expansionKind,
  };
}

/** SPEC-NTA-SEARCH-RULES-009: 3 文字未満の略称を広げるときの、元の語と正式名の探し方 */
interface ShortAbbreviationPlan {
  /** scoreReasons に出す元の語（半角に揃え、大文字と小文字は渡したまま） */
  originalLabel: string;
  /** 元の語が 3 文字以上のときの全文検索の式 */
  originalFts?: string;
  /** 元の語が 2 文字のときに部分一致で探す語 */
  originalLike?: string;
  /** 正式名が 3 文字以上のときの全文検索の式 */
  formalFts?: string;
  /** 正式名が 2 文字のときに部分一致で探す語 */
  formalLike?: string;
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

/**
 * Issue #54: その通達を bulk download で全章取り込んであるか（`tsutatsu.bulk_completed_at`）。
 * 国税庁サイトから取って書き戻した節しか無い通達は false
 */
export function isBulkCompleted(db: DatabaseT.Database, formalName: string): boolean {
  const row = db
    .prepare(`SELECT bulk_completed_at AS at FROM tsutatsu WHERE formal_name = ?`)
    .get(formalName) as { at: string | null } | undefined;
  return Boolean(row?.at);
}

/**
 * Issue #23 (v0.13.0): その種別の文書が持つ taxonomy（税目フォルダ）の一覧を返す。
 * 絞り込んだ範囲に文書が無いときに、指定できる値を応答で示すために使う。
 */
export function listDocumentTaxonomies(db: DatabaseT.Database, docType: DocType): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT taxonomy FROM document WHERE doc_type = ? AND taxonomy IS NOT NULL ORDER BY taxonomy`
    )
    .all(docType) as Array<{ taxonomy: string }>;
  return rows.map((r) => r.taxonomy);
}

/**
 * Issue #23 (v0.13.0): document テーブルの件数を数える。
 *
 * 文書系の検索が 0 件だったときに、その種別の文書が DB に無いのか、
 * 絞り込み（taxonomy / hasPdf）の範囲に無いのか、キーワードに合わないだけなのかを分けるために使う。
 * `hasPdf` の判定は `searchDocumentFts()` と同じ条件にそろえる。
 */
export function countDocuments(
  db: DatabaseT.Database,
  options: { docType: DocType; taxonomy?: string | readonly string[]; hasPdf?: boolean }
): number {
  const conds = ['doc_type = ?'];
  const params: string[] = [options.docType];
  pushTaxonomyCondition(conds, params, 'taxonomy', options.taxonomy);
  if (options.hasPdf === true) {
    conds.push(
      `attached_pdfs_json IS NOT NULL AND attached_pdfs_json != '[]' AND attached_pdfs_json != ''`
    );
  } else if (options.hasPdf === false) {
    conds.push(
      `(attached_pdfs_json IS NULL OR attached_pdfs_json = '[]' OR attached_pdfs_json = '')`
    );
  }
  const row = db
    .prepare(`SELECT count(*) AS n FROM document WHERE ${conds.join(' AND ')}`)
    .get(...params) as { n: number };
  return row.n;
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
  /**
   * 国税庁の索引から消えたことを最初に確認した日時（Issue #30、v0.17.0 から）。
   * NULL は索引にあることを表す。
   */
  orphanedAt: string | null;
}

export interface SearchDocumentOptions {
  /** 'kaisei' / 'jimu-unei' / 'bunshokaitou' で絞る */
  docType?: DocType;
  /**
   * 税目で絞る。例: 'shohi'。
   * v0.14.0 から配列も受け付ける（文書回答事例の別表記 `['sozoku', 'souzoku']` をまとめて探すため）
   */
  taxonomy?: string | readonly string[];
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
  return searchDocumentFtsWithExpansion(db, keyword, options).hits;
}

/**
 * `searchDocumentFts` と同じ検索をし、実際に行った略称展開も返す（Issue #21）。
 */
export function searchDocumentFtsWithExpansion(
  db: DatabaseT.Database,
  keyword: string,
  options: SearchDocumentOptions = {}
): SearchResultWithExpansion<DocumentSearchHit> {
  return searchWithAliasFallback(keyword, options.enableAbbreviationExpansion, (built) =>
    runDocumentQuery(db, keyword, built, options)
  );
}

function runDocumentQuery(
  db: DatabaseT.Database,
  keyword: string,
  built: BuiltFtsQuery,
  options: SearchDocumentOptions
): DocumentSearchHit[] {
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
  const branches = planBranches(keyword, built);
  if (branches.length === 0) return [];

  // Phase 6-1: re-rank のために要求 limit より多めに取る
  const fetchLimit = Math.min(limit * RERANK_FETCH_MULTIPLIER, RERANK_MAX_FETCH);

  type Row = DocumentSearchHit & { rowId: number; fullText: string };
  const runBranch = (branch: QueryBranch): Row[] => {
    const params: Array<string | number> = [];
    const conds: string[] = [];
    if (branch.kind === 'fts') {
      conds.push('document_fts MATCH ?');
      params.push(branch.match);
    } else {
      // 短い語だけのクエリ: 本文 / タイトルの LIKE で補完 (AND 意味論)
      for (const t of branch.tokens) {
        conds.push(`(d.full_text LIKE ? ESCAPE '\\' OR d.title LIKE ? ESCAPE '\\')`);
        params.push(escapeLike(t), escapeLike(t));
      }
    }
    if (options.docType) {
      conds.push('d.doc_type = ?');
      params.push(options.docType);
    }
    pushTaxonomyCondition(conds, params, 'd.taxonomy', options.taxonomy);
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

    const sql =
      branch.kind === 'fts'
        ? `
    SELECT
      d.id       AS rowId,
      d.doc_type AS docType,
      d.doc_id   AS docId,
      d.taxonomy AS taxonomy,
      d.title    AS title,
      d.issued_at AS issuedAt,
      d.source_url AS sourceUrl,
      d.full_text AS fullText,
      d.orphaned_at AS orphanedAt,
      highlight(document_fts, 3, char(57344), char(57345)) AS snippet,
      document_fts.rank AS rank
    FROM document_fts
    JOIN document d ON d.id = document_fts.rowid
    WHERE ${conds.join(' AND ')}
    ORDER BY document_fts.rank
    LIMIT ?
  `
        : `
    SELECT
      d.id       AS rowId,
      d.doc_type AS docType,
      d.doc_id   AS docId,
      d.taxonomy AS taxonomy,
      d.title    AS title,
      d.issued_at AS issuedAt,
      d.source_url AS sourceUrl,
      d.full_text AS fullText,
      d.orphaned_at AS orphanedAt,
      '' AS snippet,
      -1 AS rank
    FROM document d
    WHERE ${conds.join(' AND ')}
    ORDER BY d.id
    LIMIT ?
  `;
    return db.prepare(sql).all(...params) as Row[];
  };

  // Phase 6-1: relevance score を計算して降順で並べ替え、要求 limit 件に絞る
  const scored = mergeBranchRows(branches, runBranch).map(
    ({ row, viaFts, reasons, likeTokens }) => {
      const { rowId: _rowId, fullText, ...hit } = row;
      const { score, scoreReasons } = computeRelevance({
        rank: hit.rank,
        docType: dbDocTypeToScoring(hit.docType),
        query: keyword,
      });
      scoreReasons.push(...reasons);
      // #97: FTS の行の snippet 列は highlight() で印を付けた本文全体。ここで前後を切り出す
      const snippet = viaFts ? cutAroundMatch(hit.snippet) : makeLikeSnippet(fullText, likeTokens);
      return { ...hit, snippet, score, scoreReasons };
    }
  );
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
              fetched_at, full_text, attached_pdfs_json, structured_json, orphaned_at
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
        structured_json: string | null;
        orphaned_at: string | null;
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

  // Issue #29: v6 より前に投入した行と、構造を持たない 3 種別では NULL になる
  let structured: StoredStructure | undefined;
  if (row.structured_json) {
    try {
      structured = JSON.parse(row.structured_json) as StoredStructure;
    } catch {
      // JSON 壊れは「構造なし」として扱い、呼び出し側が国税庁サイトから取り直す
    }
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
    ...(structured ? { structured } : {}),
    ...(row.orphaned_at ? { orphanedAt: row.orphaned_at } : {}),
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

/**
 * taxonomy の絞り込み条件を足す。1 つなら `= ?`、複数なら `IN (?, ?)`。空・未指定なら何もしない。
 */
function pushTaxonomyCondition(
  conds: string[],
  params: Array<string | number>,
  column: string,
  taxonomy: string | readonly string[] | undefined
): void {
  const values = typeof taxonomy === 'string' ? [taxonomy] : [...(taxonomy ?? [])];
  const nonEmpty = values.filter((v) => v.length > 0);
  if (nonEmpty.length === 0) return;
  if (nonEmpty.length === 1) {
    conds.push(`${column} = ?`);
  } else {
    conds.push(`${column} IN (${nonEmpty.map(() => '?').join(', ')})`);
  }
  params.push(...nonEmpty);
}
