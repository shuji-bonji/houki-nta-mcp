/**
 * Relevance Scoring — Phase 6-1 (v0.8.0)
 *
 * `nta_search_*` ハンドラの結果に正規化された `score` と `scoreReasons` を付与する。
 *
 * ## スコア計算式
 *
 * ```
 * score = base(rank) × docTypeWeight + clauseExactBonus
 * ```
 *
 * - **base(rank)**: FTS5 rank (BM25 ベースの負値) を `1 / (1 + |rank| / 10)` で 0〜1 に正規化
 * - **docTypeWeight**: 法的拘束力の階層に基づく重み (通達 1.0 / 改正通達 0.95 / 文書回答事例 0.9 /
 *   事務運営指針 0.85 / Q&A 0.7 / タックスアンサー 0.6)
 * - **clauseExactBonus**: クエリに clause 番号パターン (`5-1-9` や `1-4-13の2` 等) が含まれ、
 *   ヒットの `clauseNumber` と完全一致する場合に +0.5
 *
 * 結果は **降順** にソートされる (大きいほど高関連性)。
 *
 * ## 設計の前提
 *
 * - 純関数として実装し、DB 層の SQL は触らない (SQL での boost 合成は SQLite の制約上煩雑)
 * - FTS5 から fetch する件数を要求 limit より多めに取り、JS で re-rank してから limit 件返す
 *   呼び出し側で行う設計 — 本モジュールは `score` 計算と sort の関数を提供するのみ
 *
 * @see docs/PHASE6.md §3 Phase 6-1
 */

/** スコア計算で扱う doc_type の正規化された識別子 */
export type DocTypeForScoring =
  'tsutatsu' | 'kaisei' | 'jimu-unei' | 'bunshokaitou' | 'qa' | 'tax-answer';

/**
 * 法的拘束力の階層に基づく doc_type 重み (PHASE6 §3.2)。
 * 通達 (税務署員を拘束) > 改正通達 > 文書回答事例 > 事務運営指針 > Q&A > タックスアンサー (一般向け解説)
 */
export const DOC_TYPE_WEIGHT: Record<DocTypeForScoring, number> = {
  tsutatsu: 1.0,
  kaisei: 0.95,
  bunshokaitou: 0.9,
  'jimu-unei': 0.85,
  qa: 0.7,
  'tax-answer': 0.6,
};

/**
 * Clause 番号パターン。例: `5-1-9`, `1-4-13`, `1-4-13の2`。
 * 全角ハイフン・全角数字も許容するが、本パターンを使う前に `normalizeSearchQuery` で
 * 半角化されている前提。
 */
const CLAUSE_NUMBER_PATTERN = /\d+(?:-\d+){1,2}(?:の\d+)?/;

/**
 * クエリ文字列から clause 番号を抽出する。
 *
 * 全角ハイフン (`―−–ー‐－`) と全角数字 (`０-９`) を半角化したうえでマッチング。
 * 抽出結果は半角に正規化された形で返す。
 *
 * パターンが含まれていなければ `null` を返す。
 */
export function extractClauseNumberFromQuery(query: string): string | null {
  if (!query) return null;
  // 全角→半角の事前正規化 (regex マッチ用)
  const normalized = query
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[―−–ー‐－]/g, '-');
  const m = normalized.match(CLAUSE_NUMBER_PATTERN);
  return m ? m[0] : null;
}

/**
 * FTS5 の rank (BM25 ベースの負値) を 0〜1 の base score に正規化する。
 *
 * - rank が 0 (= マッチ無し) → score 0
 * - |rank| が大きいほど (= マッチ率高い) → score 1 に漸近
 * - 形: `1 / (1 + 10 / |rank|)` のシグモイド風
 *
 * @param rank FTS5 rank (typically negative; e.g. -5 to -50)
 */
export function rankToBaseScore(rank: number): number {
  if (!Number.isFinite(rank)) return 0;
  if (rank === 0) return 0;
  const magnitude = Math.abs(rank);
  return 1 / (1 + 10 / magnitude);
}

/** スコア計算の入力 */
export interface ScoringInput {
  /** FTS5 rank (BM25 negative score) */
  rank: number;
  /** doc_type 正規化識別子 */
  docType: DocTypeForScoring;
  /** ヒットの clause 番号 (tsutatsu 検索の場合のみ。未指定可) */
  clauseNumber?: string;
  /** ユーザー入力のクエリ (clause 番号判定用) */
  query: string;
}

/** スコア計算の出力 */
export interface ScoringOutput {
  /** 0.0〜1.5 の正規化スコア (boost で 1.0 を超えうる) */
  score: number;
  /** スコア決定の理由を人間可読な短文の配列で */
  scoreReasons: string[];
}

/**
 * clauseNumber 比較用の正規化。
 * 全角ハイフン → 半角、全角数字 → 半角、空白除去。
 */
function normalizeClauseForMatch(clause: string): string {
  return clause
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[―−–ー‐－]/g, '-')
    .replace(/\s+/g, '');
}

/**
 * 1 ヒット分の relevance score を計算する。
 *
 * 純関数: 同じ入力に対し常に同じ出力を返す。
 */
export function computeRelevance(input: ScoringInput): ScoringOutput {
  const reasons: string[] = [];
  const base = rankToBaseScore(input.rank);

  const docTypeWeight = DOC_TYPE_WEIGHT[input.docType] ?? 1.0;
  reasons.push(`doc_type=${input.docType} weight ${docTypeWeight.toFixed(2)}`);

  let score = base * docTypeWeight;

  // clause 番号 完全一致 boost
  if (input.clauseNumber) {
    const queryClause = extractClauseNumberFromQuery(input.query);
    if (queryClause) {
      if (normalizeClauseForMatch(queryClause) === normalizeClauseForMatch(input.clauseNumber)) {
        score += 0.5;
        reasons.push('clause exact match');
      }
    }
  }

  // 上限を 1.5 に丸めて、極端な値が出ないようにする
  return { score: Math.min(score, 1.5), scoreReasons: reasons };
}

/**
 * ヒットの配列を score 降順でソートする (in-place ではなく新配列を返す)。
 *
 * 同点時は **元の rank の昇順** (FTS5 順を保つ) で安定ソートする。
 */
export function sortByScoreDesc<T extends { score?: number; rank: number }>(hits: T[]): T[] {
  return [...hits].sort((a, b) => {
    const sa = a.score ?? 0;
    const sb = b.score ?? 0;
    if (sa !== sb) return sb - sa;
    // 同点なら rank 昇順 (FTS5 順)
    return a.rank - b.rank;
  });
}
