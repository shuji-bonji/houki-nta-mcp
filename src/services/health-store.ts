/**
 * Health Store — bulk DL 実行履歴 (baseline) の永続化基盤。
 *
 * 目的:
 *  - bulk-downloader 実行ごとに件数 / 失敗数 / 4 パターン集計を記録
 *  - 履歴と比較して count drift / fail rate / 構造変質 を検知
 *
 * 永続化先: `${XDG_CACHE_HOME:-~/.cache}/houki-nta-mcp/baseline-{doc_type}.json`
 *  - `HOUKI_NTA_BASELINE_DIR` で上書き可能（テスト・運用カスタム）
 *  - 直近 12 件（≒ 月 1 bulk DL × 1 年分）でローテーション
 *
 * 設計詳細: docs/RESILIENCE.md §5.1 / 5.2
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';

import type { DocType } from '../types/document.js';

/**
 * Baseline 対象の種別。document テーブル 5 種 + 基本通達 4 種 = 9 種。
 *
 * 基本通達は通達ごとに baseline を分離（消基通・所基通・法基通・相基通）。
 * 通達ごとに HP 構造が違い（Phase 2d で TOC parser も通達別に切替済）、
 * HP 変更も通達ごとに独立して発生するため、合算では detection 精度が落ちる。
 */
export type BaselineDocType =
  | DocType
  | 'tsutatsu-shohi'
  | 'tsutatsu-shotoku'
  | 'tsutatsu-hojin'
  | 'tsutatsu-sozoku';

/** 基本通達 4 種の baseline 種別 */
export const TSUTATSU_BASELINE_TYPES = [
  'tsutatsu-shohi',
  'tsutatsu-shotoku',
  'tsutatsu-hojin',
  'tsutatsu-sozoku',
] as const satisfies ReadonlyArray<BaselineDocType>;

/** 基本通達略号から BaselineDocType への変換 */
export function tsutatsuBaselineType(
  taxonomy: 'shohi' | 'shotoku' | 'hojin' | 'sozoku'
): BaselineDocType {
  return `tsutatsu-${taxonomy}` as BaselineDocType;
}

/**
 * 1 回の bulk DL 実行を表すレコード。
 *
 * 4 パターン検知（new / updated / orphaned / moved）と二重 threshold 判定の基礎データ。
 */
export interface BulkRunRecord {
  /** ISO 8601 timestamp。bulk DL 完了時刻 */
  ranAt: string;
  /** 索引から得た総件数（個別 fetch を試みた数） */
  totalEntries: number;
  /** うち fetch + parse 成功した件数 */
  documentsFetched: number;
  /** fetch / parse 失敗件数 */
  documentsFailed: number;
  /** 索引にあるが DB に無かった → INSERT した件数（新規追加検知） */
  newDocs: number;
  /** 既存 doc_id で content_hash が変化 → UPDATE した件数（既存更新検知） */
  updatedDocs: number;
  /** DB にあるが索引から消えた件数（DELETE せず保持。既存削除検知） */
  orphanedDocs: number;
  /** orphaned + 同タイトルの new がペアで存在する推定件数（既存移動検知） */
  movedDocs: number;
  /** documentsFailed / totalEntries (0..1) */
  failRate: number;
  /** bulk DL 全体の所要 ms */
  durationMs: number;
}

/** baseline-{doc_type}.json の中身 */
export interface DocTypeBaseline {
  /** どの種別の baseline か */
  doc_type: BaselineDocType;
  /** 直近 N 件（N = HISTORY_LIMIT）の実行履歴。新しいほど末尾 */
  history: BulkRunRecord[];
}

/** ローテーション保持件数（月 1 bulk DL × 1 年分） */
export const HISTORY_LIMIT = 12;

/**
 * デフォルトの baseline ファイルパスを返す。
 *
 * 優先順:
 *  1. `HOUKI_NTA_BASELINE_DIR` 環境変数（テスト・運用カスタム）
 *  2. `XDG_CACHE_HOME/houki-nta-mcp/`
 *  3. `~/.cache/houki-nta-mcp/`
 */
export function defaultBaselinePath(doc_type: BaselineDocType): string {
  const envDir = process.env.HOUKI_NTA_BASELINE_DIR;
  if (envDir && envDir.length > 0) {
    return resolve(envDir, `baseline-${doc_type}.json`);
  }
  const xdg = process.env.XDG_CACHE_HOME;
  const cacheRoot = xdg && xdg.length > 0 ? xdg : resolve(homedir(), '.cache');
  return resolve(cacheRoot, 'houki-nta-mcp', `baseline-${doc_type}.json`);
}

/**
 * baseline ファイルを読み込む。存在しない / 壊れている / doc_type 不一致 の場合は空 baseline を返す。
 *
 * @param doc_type 期待する種別
 * @param baselinePath パス上書き（テスト用）
 */
export function loadBaseline(doc_type: BaselineDocType, baselinePath?: string): DocTypeBaseline {
  const path = baselinePath ?? defaultBaselinePath(doc_type);
  if (!existsSync(path)) {
    return { doc_type, history: [] };
  }
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as DocTypeBaseline;
    if (parsed.doc_type !== doc_type || !Array.isArray(parsed.history)) {
      // 想定と違うファイル / 壊れた構造 → 空とみなす
      return { doc_type, history: [] };
    }
    return parsed;
  } catch {
    return { doc_type, history: [] };
  }
}

/**
 * baseline に 1 件追記し、ファイルへ永続化する。
 * 履歴が `HISTORY_LIMIT` を超える場合は古い方から捨てる。
 *
 * @returns 永続化後の baseline オブジェクト
 */
export function appendBaseline(
  doc_type: BaselineDocType,
  record: BulkRunRecord,
  baselinePath?: string
): DocTypeBaseline {
  const path = baselinePath ?? defaultBaselinePath(doc_type);
  const baseline = loadBaseline(doc_type, path);
  baseline.history.push(record);
  if (baseline.history.length > HISTORY_LIMIT) {
    baseline.history = baseline.history.slice(-HISTORY_LIMIT);
  }
  // 親ディレクトリ作成
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(baseline, null, 2), 'utf-8');
  return baseline;
}

/**
 * 直近の実行レコードを返す。履歴が空なら null。
 */
export function getLastRun(baseline: DocTypeBaseline): BulkRunRecord | null {
  if (baseline.history.length === 0) return null;
  return baseline.history[baseline.history.length - 1] ?? null;
}

/**
 * 履歴中の totalEntries の中央値を返す。空なら 0。
 *
 * count drift threshold（±20%）の比較基準として使う。
 * 平均ではなく中央値を使うのは、外れ値（壊れた回）に引きずられないため。
 */
export function getMedianTotal(baseline: DocTypeBaseline): number {
  if (baseline.history.length === 0) return 0;
  const sorted = baseline.history.map((r) => r.totalEntries).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    const a = sorted[mid - 1] ?? 0;
    const b = sorted[mid] ?? 0;
    return (a + b) / 2;
  }
  return sorted[mid] ?? 0;
}

/**
 * 履歴中の failRate の中央値を返す。空なら 0。
 *
 * fail rate threshold の比較に使うことを想定（過敏な単発判定との対比）。
 */
export function getMedianFailRate(baseline: DocTypeBaseline): number {
  if (baseline.history.length === 0) return 0;
  const sorted = baseline.history.map((r) => r.failRate).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    const a = sorted[mid - 1] ?? 0;
    const b = sorted[mid] ?? 0;
    return (a + b) / 2;
  }
  return sorted[mid] ?? 0;
}
