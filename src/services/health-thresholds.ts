/**
 * Health Thresholds — bulk DL 結果を baseline と比較し、警告判定を行うロジック。
 *
 * 3 つの観点で評価:
 *  1. fail rate threshold: 絶対数 (`MIN_ABS`) AND 比率 (`MIN_RATE`) の両方を満たしたら警告
 *  2. count drift: baseline 中央値から ±`COUNT_DRIFT_RATIO` (default 20%) ズレたら警告
 *  3. 構造変質: updatedDocs / totalEntries > `STRUCTURAL_RATIO` (default 50%) なら警告
 *
 * 設計詳細: docs/RESILIENCE.md §5.3 / 5.4 / 5.5
 */

import type { BaselineDocType, BulkRunRecord, DocTypeBaseline } from './health-store.js';
import { getMedianTotal } from './health-store.js';

/** 種別ごとの fail rate threshold */
export interface FailThreshold {
  /** 絶対数の下限。MIN_ABS 件未満なら警告しない（ノイズ抑制） */
  MIN_ABS: number;
  /** 比率の下限 (0..1)。MIN_RATE 未満なら警告しない */
  MIN_RATE: number;
}

/**
 * v0.5.0 ベンチマーク (fail rate 0%) を基準に決定した、種別ごとの threshold。
 *
 * MIN_ABS は「ノイズと事故の境界」を表す絶対件数:
 *  - 大規模な qa-jirei (1841 件) では 10 件失敗まで誤差として許容
 *  - 小規模な jimu-unei (32 件) では 2 件失敗で発火（小規模ほど 1 件の重みが大きい）
 *  - 基本通達は通達ごとに分離（HP 構造変更が通達単位で起きるため検知精度を上げる）
 *
 * MIN_RATE は family 全体で 1% 共通（規模に依らず比率としての意味）。
 *
 * 通達系の MIN_ABS は推定 clause 数（実走で再調整）:
 *  - 消基通 〜600 / 所基通 〜800 / 法基通 〜1000 / 相基通 〜200
 */
export const FAIL_THRESHOLDS: Record<BaselineDocType, FailThreshold> = {
  // document テーブル 5 種
  kaisei: { MIN_ABS: 3, MIN_RATE: 0.01 }, // 〜125 件
  'jimu-unei': { MIN_ABS: 2, MIN_RATE: 0.01 }, // 〜32 件
  bunshokaitou: { MIN_ABS: 3, MIN_RATE: 0.01 }, // 〜152 件
  'tax-answer': { MIN_ABS: 5, MIN_RATE: 0.01 }, // 〜750 件
  'qa-jirei': { MIN_ABS: 10, MIN_RATE: 0.01 }, // 〜1841 件
  // 基本通達 4 種 (clause テーブル)
  'tsutatsu-shohi': { MIN_ABS: 8, MIN_RATE: 0.01 }, // 消基通 〜600 clause
  'tsutatsu-shotoku': { MIN_ABS: 10, MIN_RATE: 0.01 }, // 所基通 〜800 clause
  'tsutatsu-hojin': { MIN_ABS: 10, MIN_RATE: 0.01 }, // 法基通 〜1000 clause
  'tsutatsu-sozoku': { MIN_ABS: 4, MIN_RATE: 0.01 }, // 相基通 〜200 clause
};

/** count drift の許容範囲（baseline 中央値から ±20%）*/
export const COUNT_DRIFT_RATIO = 0.2;

/** 構造変質と判定する updatedDocs 比率（50% 以上が一斉更新なら無症状の構造変質を疑う）*/
export const STRUCTURAL_RATIO = 0.5;

/**
 * fail rate が threshold を超えたか判定。
 *
 * 絶対数 AND 比率の両方を満たした時のみ警告（ノイズ抑制）。
 */
export function shouldWarnFailRate(
  record: BulkRunRecord,
  doc_type: BaselineDocType,
  threshold: FailThreshold = FAIL_THRESHOLDS[doc_type]
): boolean {
  if (record.documentsFailed < threshold.MIN_ABS) return false;
  if (record.totalEntries === 0) return false;
  const rate = record.documentsFailed / record.totalEntries;
  return rate >= threshold.MIN_RATE;
}

/**
 * 件数が baseline 中央値から ±drift 以上ズレているか判定。
 *
 * baseline が空（履歴なし）なら判定不能とみなして false を返す。
 */
export function shouldWarnCountDrift(
  record: BulkRunRecord,
  baseline: DocTypeBaseline,
  drift: number = COUNT_DRIFT_RATIO
): boolean {
  const median = getMedianTotal(baseline);
  if (median === 0) return false;
  const diff = Math.abs(record.totalEntries - median) / median;
  return diff >= drift;
}

/**
 * 構造変質を疑う signal を返す。
 *
 * updatedDocs 比率が高すぎる = 大量の content_hash が一斉に変わった
 * = HTML 構造が変わって parser が違う場所をマッチしている可能性がある。
 *
 * 通常の通達改正は個別単位なので、全件の半分以上が一斉更新されることは稀。
 */
export function shouldWarnStructuralChange(
  record: BulkRunRecord,
  ratio: number = STRUCTURAL_RATIO
): boolean {
  if (record.totalEntries === 0) return false;
  const updateRatio = record.updatedDocs / record.totalEntries;
  return updateRatio > ratio;
}

/** evaluateHealth() の戻り値 */
export interface HealthEvaluation {
  /** いずれかの threshold に引っかかったか */
  warn: boolean;
  /** 警告の理由（人間可読、複数並列で入る）*/
  reasons: string[];
  /** debug 用の生指標 */
  details: {
    failRate: number;
    countDriftRatio: number;
    structuralRatio: number;
    medianTotal: number;
  };
}

/**
 * 3 つの threshold を統合評価する。
 *
 * baseline 履歴が空（初回 bulk DL）なら count drift は判定不能とみなし、
 * fail rate と構造変質のみで判定する。
 */
export function evaluateHealth(
  record: BulkRunRecord,
  doc_type: BaselineDocType,
  baseline: DocTypeBaseline
): HealthEvaluation {
  const reasons: string[] = [];

  if (shouldWarnFailRate(record, doc_type)) {
    const t = FAIL_THRESHOLDS[doc_type];
    reasons.push(
      `fail rate threshold 超過: failed=${record.documentsFailed}/${record.totalEntries} ` +
        `(MIN_ABS=${t.MIN_ABS}, MIN_RATE=${(t.MIN_RATE * 100).toFixed(1)}%)`
    );
  }

  if (shouldWarnCountDrift(record, baseline)) {
    const median = getMedianTotal(baseline);
    const diff = Math.abs(record.totalEntries - median) / median;
    reasons.push(
      `count drift threshold 超過: total=${record.totalEntries} vs median=${median} ` +
        `(${(diff * 100).toFixed(1)}% drift, threshold=${(COUNT_DRIFT_RATIO * 100).toFixed(0)}%)`
    );
  }

  if (shouldWarnStructuralChange(record)) {
    const r = record.updatedDocs / record.totalEntries;
    reasons.push(
      `構造変質の疑い: updatedDocs=${record.updatedDocs}/${record.totalEntries} ` +
        `(${(r * 100).toFixed(1)}% 一斉更新, threshold=${(STRUCTURAL_RATIO * 100).toFixed(0)}%)`
    );
  }

  const median = getMedianTotal(baseline);
  return {
    warn: reasons.length > 0,
    reasons,
    details: {
      failRate: record.totalEntries === 0 ? 0 : record.documentsFailed / record.totalEntries,
      countDriftRatio: median === 0 ? 0 : Math.abs(record.totalEntries - median) / median,
      structuralRatio: record.totalEntries === 0 ? 0 : record.updatedDocs / record.totalEntries,
      medianTotal: median,
    },
  };
}
