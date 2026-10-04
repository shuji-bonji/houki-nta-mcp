/**
 * Freshness — レスポンスに埋め込む staleness 情報の判定ヘルパ。
 *
 * Phase 5 Resilience の passive 検知。MCP tool 呼び出し時に DB の `fetched_at` を
 * 1 列読むだけで判定する（< 1ms）ため、レスポンス遅延への影響なし。
 *
 * v0.9.3 (Issue #15): 型 / 閾値 / 純関数 (`StalenessLevel` / `STALENESS_THRESHOLDS` /
 * `judgeStaleness` / `computeDaysSince`) は **`@shuji-bonji/houki-abbreviations` v0.4.1+**
 * から import するように変更。家族で同じ感覚で staleness を判定できる。
 * DB アクセス層・レスポンス整形・警告メッセージは houki-nta-mcp 固有のため本ファイルに残す。
 *
 * staleness レベル (閾値は houki-abbreviations の `STALENESS_THRESHOLDS` 経由で family 共通):
 *  - fresh:    最後の bulk DL が 1 週間以内 (`< STALENESS_THRESHOLDS.fresh_days`)
 *  - stale:    1 週間〜1 ヶ月 (`< STALENESS_THRESHOLDS.stale_days`)
 *  - outdated: 1 ヶ月以上経過 → 警告メッセージを付ける
 *
 * 設計詳細: docs/RESILIENCE.md §6
 */

import {
  computeDaysSince,
  judgeStaleness,
  STALENESS_THRESHOLDS,
  type StalenessLevel,
} from '@shuji-bonji/houki-abbreviations';
import type DatabaseT from 'better-sqlite3';

// v0.9.3: houki-abbreviations から re-export して既存利用者の互換性を保つ
export type { StalenessLevel };
export { judgeStaleness, STALENESS_THRESHOLDS };

/**
 * @deprecated v0.9.3+: 互換性のため残置。新規実装は
 * `STALENESS_THRESHOLDS.fresh_days` を使うこと。
 */
export const FRESH_DAYS = STALENESS_THRESHOLDS.fresh_days;
/**
 * @deprecated v0.9.3+: 互換性のため残置。新規実装は
 * `STALENESS_THRESHOLDS.stale_days` を使うこと。
 */
export const STALE_DAYS = STALENESS_THRESHOLDS.stale_days;

/**
 * DB の取得時点（`document.fetched_at` / `section.fetched_at`）を日付・時刻として読めないときの例外（v0.22.0）。
 *
 * houki-abbreviations 0.7.0 の `computeDaysSince` は、読めない値に `RangeError`（文字列でなければ `TypeError`）を
 * 投げる（0.6.1 までは 0 を返し、壊れた取得時点が fresh になっていた）。その例外をこの型に包み、
 * ツールの側で INTERNAL_ERROR（retryable: false）にする（SPEC-NTA-COMMON-ERRORS-017）。
 */
export class UnreadableFetchedAtError extends Error {
  /** 読めなかった fetched_at の値 */
  readonly value: string;
  /** computeDaysSince が投げた例外の文 */
  readonly causeMessage: string;

  constructor(value: string, cause: unknown) {
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    super(`取得時点を読めません: ${value}`);
    this.name = 'UnreadableFetchedAtError';
    this.value = value;
    this.causeMessage = causeMessage;
  }
}

/** computeDaysSince を呼び、読めない値なら UnreadableFetchedAtError にする */
function daysSince(fetchedAt: string, nowMs: number): number {
  try {
    return computeDaysSince(fetchedAt, nowMs);
  } catch (err) {
    throw new UnreadableFetchedAtError(fetchedAt, err);
  }
}

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

/**
 * outdated 時の警告メッセージを生成（fresh / stale は undefined）。
 *
 * 警告メッセージは MCP 固有 (bulk DL コマンド文言) のため houki-nta-mcp に残す。
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
 * 単一 doc の fetched_at から FreshnessSingle を構築。
 */
export function freshnessForFetchedAt(
  fetchedAt: string,
  bulkDownloadHint?: string,
  nowMs: number = Date.now()
): FreshnessSingle {
  const days_since = daysSince(fetchedAt, nowMs);
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
 * 範囲は国税庁の索引にある文書（`orphaned_at` が NULL の行）だけにする（v0.24.1、Issue #139、
 * SPEC-NTA-SEARCH-RULES-017）。bulk download は索引から消えた文書を取り直さないので、その取得日時は
 * 投入をやり直しても新しくならない。範囲に入れると staleness が fresh に戻らず、warning が案内する
 * フラグを実行しても直らない。検索結果からは除かない（呼び出し側の検索はこの関数と別）。
 *
 * @param taxonomyFilter 部分実行時のスナップショット範囲を絞り込み
 * @returns 範囲に索引にある文書が 1 件も無い場合は null（印が付いた行しか無い範囲を含む）。
 *          呼び出し側は freshness を付けない
 */
export function summarizeFreshnessFromDocument(
  db: DatabaseT.Database,
  doc_type: string,
  taxonomyFilter?: readonly string[],
  bulkDownloadHint?: string,
  nowMs: number = Date.now()
): FreshnessRange | null {
  let sql = `SELECT MIN(fetched_at) as oldest, MAX(fetched_at) as newest, COUNT(*) as cnt
             FROM document WHERE doc_type = ? AND orphaned_at IS NULL`;
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
  // 空文字の fetched_at も読めない値として扱うので、null だけを「無い」とみなす
  if (!row || row.cnt === 0 || row.oldest === null || row.newest === null) return null;

  // 文字列の最小・最大なので、読めない値は oldest か newest に出やすい。両方を確かめる
  const days_since_oldest = daysSince(row.oldest, nowMs);
  daysSince(row.newest, nowMs);
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
  // 空文字の fetched_at も読めない値として扱うので、null だけを「無い」とみなす
  if (!row || row.cnt === 0 || row.oldest === null || row.newest === null) return null;

  // 文字列の最小・最大なので、読めない値は oldest か newest に出やすい。両方を確かめる
  const days_since_oldest = daysSince(row.oldest, nowMs);
  daysSince(row.newest, nowMs);
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
