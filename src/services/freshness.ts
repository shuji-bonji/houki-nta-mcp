/**
 * Freshness — レスポンスに埋め込む staleness 情報の判定ヘルパ。
 *
 * Phase 5 Resilience の passive 検知。MCP tool 呼び出し時に DB の `fetched_at` を
 * 1 列読むだけで判定する（< 1ms）ため、レスポンス遅延への影響なし。
 *
 * staleness レベル:
 *  - fresh:    最後の bulk DL が 1 週間以内
 *  - stale:    1 週間〜1 ヶ月
 *  - outdated: 1 ヶ月以上経過 → 警告メッセージを付ける
 *
 * 設計詳細: docs/RESILIENCE.md §6
 */

import type DatabaseT from 'better-sqlite3';

/** staleness の判定レベル */
export type StalenessLevel = 'fresh' | 'stale' | 'outdated';

/** 検索範囲全体の freshness 情報（複数 doc を返す search 系で使用）*/
export interface FreshnessRange {
  /** 範囲内の最古の fetched_at (ISO 8601) */
  oldest_fetched_at: string;
  /** 範囲内の最新の fetched_at (ISO 8601) */
  newest_fetched_at: string;
  /** 最古基準で判定した staleness レベル */
  staleness: StalenessLevel;
  /** 最古からの経過日数 */
  days_since_oldest: number;
  /** outdated 時のみ付く再 bulk DL 案内メッセージ */
  warning?: string;
}

/** 単一 doc の freshness 情報（get 系で使用）*/
export interface FreshnessSingle {
  /** その doc の fetched_at (ISO 8601) */
  fetched_at: string;
  /** staleness レベル */
  staleness: StalenessLevel;
  /** 経過日数 */
  days_since: number;
  /** outdated 時のみ付く再 bulk DL 案内 */
  warning?: string;
}

/** fresh < N 日 */
export const FRESH_DAYS = 7;
/** stale < N 日 (これ以上は outdated) */
export const STALE_DAYS = 30;

/**
 * 経過日数から staleness レベルを判定。
 */
export function judgeStaleness(daysSince: number): StalenessLevel {
  if (daysSince < FRESH_DAYS) return 'fresh';
  if (daysSince < STALE_DAYS) return 'stale';
  return 'outdated';
}

/**
 * outdated 時の警告メッセージを生成（fresh / stale は undefined）。
 */
export function buildWarning(
  staleness: StalenessLevel,
  daysSince: number,
  bulkDownloadHint = '`--bulk-download-everything`'
): string | undefined {
  if (staleness !== 'outdated') return undefined;
  return `一部ドキュメントが ${daysSince} 日前のデータです。最新化するには ${bulkDownloadHint} を実行してください`;
}

/**
 * 経過日数を計算（小数なし、日数の floor）。
 */
function computeDaysSince(fetchedAt: string, nowMs: number = Date.now()): number {
  const fetchedMs = Date.parse(fetchedAt);
  if (!Number.isFinite(fetchedMs)) return 0;
  const diffMs = nowMs - fetchedMs;
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

/**
 * 単一 doc の fetched_at から FreshnessSingle を構築。
 */
export function freshnessForFetchedAt(
  fetchedAt: string,
  bulkDownloadHint?: string,
  nowMs: number = Date.now()
): FreshnessSingle {
  const days_since = computeDaysSince(fetchedAt, nowMs);
  const staleness = judgeStaleness(days_since);
  const result: FreshnessSingle = {
    fetched_at: fetchedAt,
    staleness,
    days_since,
  };
  const warning = buildWarning(staleness, days_since, bulkDownloadHint);
  if (warning) result.warning = warning;
  return result;
}

/**
 * document テーブルから doc_type 範囲の最古 / 最新 fetched_at を取得し、
 * FreshnessRange を返す。
 *
 * @param taxonomyFilter 部分実行時のスナップショット範囲を絞り込み
 * @returns データが 1 件もない場合は null
 */
export function summarizeFreshnessFromDocument(
  db: DatabaseT.Database,
  doc_type: string,
  taxonomyFilter?: readonly string[],
  bulkDownloadHint?: string,
  nowMs: number = Date.now()
): FreshnessRange | null {
  let sql = `SELECT MIN(fetched_at) as oldest, MAX(fetched_at) as newest, COUNT(*) as cnt
             FROM document WHERE doc_type = ?`;
  const params: string[] = [doc_type];
  if (taxonomyFilter && taxonomyFilter.length > 0) {
    const placeholders = taxonomyFilter.map(() => '?').join(', ');
    sql += ` AND taxonomy IN (${placeholders})`;
    params.push(...taxonomyFilter);
  }
  const row = db.prepare(sql).get(...params) as {
    oldest: string | null;
    newest: string | null;
    cnt: number;
  };
  if (!row || row.cnt === 0 || !row.oldest || !row.newest) return null;

  const days_since_oldest = computeDaysSince(row.oldest, nowMs);
  const staleness = judgeStaleness(days_since_oldest);
  const result: FreshnessRange = {
    oldest_fetched_at: row.oldest,
    newest_fetched_at: row.newest,
    staleness,
    days_since_oldest,
  };
  const warning = buildWarning(staleness, days_since_oldest, bulkDownloadHint);
  if (warning) result.warning = warning;
  return result;
}

/**
 * section テーブル（基本通達）から、指定通達の fetched_at 範囲を取得して
 * FreshnessRange を返す。
 *
 * @param tsutatsu_abbr '消基通' / '所基通' / '法基通' / '相基通'
 */
export function summarizeFreshnessFromSection(
  db: DatabaseT.Database,
  tsutatsu_abbr?: string,
  bulkDownloadHint?: string,
  nowMs: number = Date.now()
): FreshnessRange | null {
  let sql = `SELECT MIN(s.fetched_at) as oldest, MAX(s.fetched_at) as newest, COUNT(*) as cnt
             FROM section s`;
  const params: string[] = [];
  if (tsutatsu_abbr) {
    sql += ` JOIN tsutatsu t ON s.tsutatsu_id = t.id WHERE t.abbr = ?`;
    params.push(tsutatsu_abbr);
  }
  const row = db.prepare(sql).get(...params) as {
    oldest: string | null;
    newest: string | null;
    cnt: number;
  };
  if (!row || row.cnt === 0 || !row.oldest || !row.newest) return null;

  const days_since_oldest = computeDaysSince(row.oldest, nowMs);
  const staleness = judgeStaleness(days_since_oldest);
  const result: FreshnessRange = {
    oldest_fetched_at: row.oldest,
    newest_fetched_at: row.newest,
    staleness,
    days_since_oldest,
  };
  const warning = buildWarning(staleness, days_since_oldest, bulkDownloadHint);
  if (warning) result.warning = warning;
  return result;
}
