/**
 * Bulk Aggregation — bulk DL 結果から 4 パターン集計を計算するヘルパ。
 *
 * 集計対象の 4 パターン:
 *  - newDocs:      索引にあるが DB になかった（新規追加）
 *  - updatedDocs:  既存 doc_id で content_hash が変化した（既存更新）
 *  - orphanedDocs: DB にあるが索引から消えた（既存削除、DELETE せず保持）
 *  - movedDocs:    orphaned と new で同タイトルが存在するペア（既存移動の推定）
 *
 * 設計詳細: docs/RESILIENCE.md §5.2
 */

import { logger } from '../utils/logger.js';

import {
  appendBaseline,
  loadBaseline,
  type BaselineDocType,
  type BulkRunRecord,
  type DocTypeBaseline,
} from './health-store.js';
import { evaluateHealth, type HealthEvaluation } from './health-thresholds.js';

/**
 * 1 件の document / clause の identity 情報。
 *
 * before / after の snapshot を取って差分を出すための最小限の情報。
 */
export interface DocSnapshot {
  /** doc_type 内の一意 ID（例: 'shohi/02/19' / '6101' / '1-4-13の2'） */
  doc_id: string;
  /** content_hash（SHA-1）。比較で UPDATE を検知 */
  content_hash: string | null;
  /** タイトル文字列。movedDocs 推定で照合 */
  title: string;
}

/**
 * 4 パターン集計の入力。
 */
export interface AggregationInput {
  /** bulk DL 開始前の DB スナップショット（doc_id → snapshot） */
  before: Map<string, DocSnapshot>;
  /** bulk DL 完了後の DB スナップショット（doc_id → snapshot） */
  after: Map<string, DocSnapshot>;
  /** 索引から得た総件数 */
  totalEntries: number;
  /** fetch / parse 失敗件数 */
  documentsFailed: number;
  /** bulk DL 全体の所要 ms */
  durationMs: number;
  /** ISO 8601 timestamp（省略時は現在時刻） */
  ranAt?: string;
}

/**
 * 4 パターン集計を計算して BulkRunRecord を返す。
 *
 * - newDocs:      after にあって before にない doc_id
 * - updatedDocs:  両方にあるが content_hash が違う doc_id
 * - orphanedDocs: before にあって after にない doc_id（=DB に残るが索引から消えた）
 * - movedDocs:    orphaned + new のうちタイトル一致するペアの推定件数
 *
 * **注意**: orphaned は DB から DELETE せず、件数だけ集計する設計（過去通達の
 * 法的価値を保持するため）。移動検知の推定は粗いが、後続の `--health-check` で
 * 詳細確認できる。
 */
export function computeBulkAggregation(input: AggregationInput): BulkRunRecord {
  const { before, after, totalEntries, documentsFailed, durationMs } = input;
  const ranAt = input.ranAt ?? new Date().toISOString();

  let newDocs = 0;
  let updatedDocs = 0;
  let orphanedDocs = 0;

  const newTitles: string[] = [];
  const orphanedTitles: string[] = [];

  // after - before = 新規 / updated
  for (const [doc_id, afterSnap] of after) {
    const beforeSnap = before.get(doc_id);
    if (beforeSnap === undefined) {
      newDocs++;
      newTitles.push(afterSnap.title);
    } else if (
      afterSnap.content_hash !== null &&
      beforeSnap.content_hash !== null &&
      afterSnap.content_hash !== beforeSnap.content_hash
    ) {
      updatedDocs++;
    }
  }

  // before - after = orphaned（DB 削除はしない、件数だけ）
  for (const [doc_id, beforeSnap] of before) {
    if (!after.has(doc_id)) {
      orphanedDocs++;
      orphanedTitles.push(beforeSnap.title);
    }
  }

  // movedDocs: orphaned のタイトルが new のタイトル集合に含まれる件数（粗い推定）
  const newTitleSet = new Set(newTitles);
  const movedDocs = orphanedTitles.filter((t) => newTitleSet.has(t)).length;

  const failRate = totalEntries === 0 ? 0 : documentsFailed / totalEntries;

  return {
    ranAt,
    totalEntries,
    documentsFetched: totalEntries - documentsFailed,
    documentsFailed,
    newDocs,
    updatedDocs,
    orphanedDocs,
    movedDocs,
    failRate,
    durationMs,
  };
}

/**
 * BulkRunRecord を baseline ファイルに永続化し、threshold 評価を行う。
 *
 * baseline 評価の警告は logger.warn で出すが、bulk DL 自体は成功扱いのまま
 * リターンする（呼び出し側で exit code を制御したい場合は warn フィールドを参照）。
 *
 * @returns 評価結果（warn フラグ + 警告理由）
 */
export function recordBulkRun(
  doc_type: BaselineDocType,
  record: BulkRunRecord,
  baselinePath?: string
): HealthEvaluation {
  // 既存 baseline を読み込み（threshold 比較用）
  const previousBaseline: DocTypeBaseline = loadBaseline(doc_type, baselinePath);

  // 新規実行を記録（次回の比較用）
  appendBaseline(doc_type, record, baselinePath);

  // 評価（previous baseline と比較）
  const evaluation = evaluateHealth(record, doc_type, previousBaseline);

  if (evaluation.warn) {
    logger.warn('bulk-aggregation', `[${doc_type}] health warning`, {
      reasons: evaluation.reasons,
      details: evaluation.details,
    });
  } else {
    logger.info('bulk-aggregation', `[${doc_type}] healthy`, {
      total: record.totalEntries,
      failed: record.documentsFailed,
      new: record.newDocs,
      updated: record.updatedDocs,
      orphaned: record.orphanedDocs,
      moved: record.movedDocs,
    });
  }

  return evaluation;
}

/**
 * Map の差集合（A - B）を返す utility。
 *
 * テスト容易性のため export。
 */
export function diffKeys<V>(a: Map<string, V>, b: Map<string, V>): string[] {
  const result: string[] = [];
  for (const key of a.keys()) {
    if (!b.has(key)) result.push(key);
  }
  return result;
}
