/**
 * Index Status — Issue #30
 *
 * 国税庁の索引から消えた文書に印を付け、応答で現行の文書と区別できるようにする。
 *
 * 行は消しません。索引から外れた通達でも、過去の課税期間の判断では依然として意味を
 * 持つためです。代わりに `document.orphaned_at` に「索引から消えたことを最初に確認した
 * 日時」を入れ、検索・取得の応答で `index_status` として返します。
 *
 * ## 索引にあるかどうかの見分け方
 *
 * bulk download が集めた索引の URL 集合と、その実行で触った行の 2 つを使います。
 *
 * - 索引の URL 集合にある → 索引にある
 * - この実行で `fetched_at` が更新された → 索引にある（索引の URL からリダイレクトされて
 *   `source_url` が変わった行を、消えたと誤判定しないため）
 * - どちらでもない → 索引から消えた
 *
 * 取得に失敗した行は `fetched_at` が古いままですが、その URL は索引の集合にあるので
 * 印は付きません。
 *
 * ## 移動との区別
 *
 * 国税庁サイトは税目フォルダの世代移行（`sozoku` → `sozoku2` など）を行います。移行で
 * doc_id が変わると、古い doc_id は索引から消えたように見えます。索引にある行と題名が
 * 一致する場合は移動とみなし、印を付けません。
 */

import type DatabaseT from 'better-sqlite3';

import type { DocType } from '../types/document.js';
import { logger } from '../utils/logger.js';
import type { OrphanCounts } from './bulk-aggregation.js';

/** 索引から消えた文書に付く `index_status` の値 */
export const REMOVED_FROM_INDEX = 'removed_from_index';

/** 索引から消えた文書の応答に添える注記 */
export const REMOVED_FROM_INDEX_NOTICE =
  'この文書は国税庁の索引から外れています。過去の課税期間の判断では依然として意味を持つ場合がありますが、現在の取扱いは最新の通達で確認してください。出典 URL は 404 になることがあります';

/** 印を付け直した結果（Issue #30） */
export interface OrphanMarkingResult {
  /** 新しく印を付けた件数 */
  marked: number;
  /** 索引に戻っていたので印を外した件数 */
  cleared: number;
  /** 索引にある文書と題名が一致したため、移動とみなして印を付けなかった件数 */
  movedSkipped: number;
}

/** `markOrphanedDocuments` の引数 */
export interface OrphanMarkingInput {
  /** この実行で索引から集めた個別ページの URL 全部 */
  indexUrls: ReadonlySet<string>;
  /** bulk download を始めた時刻（ISO 8601）。これ以降の `fetched_at` は「この実行で触った」印 */
  runStartedAt: string;
  /** 印に入れる日時（ISO 8601）。通常は bulk download の終了時刻 */
  ranAt: string;
  /** 税目を絞って実行したときの範囲。指定した税目の行だけを見る */
  taxonomyFilter?: readonly string[];
}

interface DocumentRow {
  doc_id: string;
  title: string;
  source_url: string;
  fetched_at: string;
  orphaned_at: string | null;
}

/**
 * 索引と DB を突き合わせ、`orphaned_at` を付け直す。
 *
 * **索引をすべて取れた実行でだけ呼んでください。** 索引の取得に失敗した税目があると、
 * その税目の文書が丸ごと「消えた」と判定されます。
 */
export function markOrphanedDocuments(
  db: DatabaseT.Database,
  docType: DocType,
  input: OrphanMarkingInput
): OrphanMarkingResult {
  let sql =
    'SELECT doc_id, title, source_url, fetched_at, orphaned_at FROM document WHERE doc_type = ?';
  const params: string[] = [docType];
  if (input.taxonomyFilter && input.taxonomyFilter.length > 0) {
    sql += ` AND taxonomy IN (${input.taxonomyFilter.map(() => '?').join(', ')})`;
    params.push(...input.taxonomyFilter);
  }
  const rows = db.prepare(sql).all(...params) as DocumentRow[];

  const isListed = (row: DocumentRow): boolean =>
    input.indexUrls.has(row.source_url) || row.fetched_at >= input.runStartedAt;

  const listedTitles = new Set(rows.filter(isListed).map((r) => r.title));

  const mark = db.prepare('UPDATE document SET orphaned_at = ? WHERE doc_type = ? AND doc_id = ?');
  const clear = db.prepare(
    'UPDATE document SET orphaned_at = NULL WHERE doc_type = ? AND doc_id = ?'
  );

  const result: OrphanMarkingResult = { marked: 0, cleared: 0, movedSkipped: 0 };
  const tx = db.transaction(() => {
    for (const row of rows) {
      if (isListed(row)) {
        if (row.orphaned_at !== null) {
          clear.run(docType, row.doc_id);
          result.cleared++;
        }
        continue;
      }
      if (listedTitles.has(row.title)) {
        // 世代ディレクトリの移行などで doc_id が変わっただけ。印は付けない
        if (row.orphaned_at !== null) {
          clear.run(docType, row.doc_id);
          result.cleared++;
        }
        result.movedSkipped++;
        continue;
      }
      if (row.orphaned_at === null) {
        mark.run(input.ranAt, docType, row.doc_id);
        result.marked++;
      }
    }
  });
  tx();
  return result;
}

/** 索引から消えた文書の件数（印が付いている行の数）を数える */
export function countOrphanedDocuments(db: DatabaseT.Database, docType: DocType): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM document WHERE doc_type = ? AND orphaned_at IS NOT NULL')
    .get(docType) as { n: number };
  return row.n;
}

/**
 * 応答に載せる索引の状態を作る。索引にある文書には何も付けない。
 */
export function indexStatusFields(orphanedAt: string | null | undefined): {
  index_status?: typeof REMOVED_FROM_INDEX;
  orphaned_at?: string;
} {
  if (!orphanedAt) return {};
  return { index_status: REMOVED_FROM_INDEX, orphaned_at: orphanedAt };
}

/**
 * `markOrphanedDocuments` を呼び、`computeBulkAggregation` に渡す件数に直す（Issue #30）。
 *
 * `orphanedDocs` はこの実行で新しく印が付いた件数です。印が付いたまま残っている総数は
 * `countOrphanedDocuments` で数えられます。
 */
export function markAndCount(
  db: DatabaseT.Database,
  docType: DocType,
  input: OrphanMarkingInput
): OrphanCounts {
  const result = markOrphanedDocuments(db, docType, input);
  logger.info('index-status', `[${docType}] 索引の状態を付け直した`, {
    marked: result.marked,
    cleared: result.cleared,
    movedSkipped: result.movedSkipped,
    totalOrphaned: countOrphanedDocuments(db, docType),
  });
  return { orphanedDocs: result.marked, movedDocs: result.movedSkipped };
}
