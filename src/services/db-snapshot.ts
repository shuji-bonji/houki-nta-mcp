/**
 * DB Snapshot — bulk DL の前後で DB から DocSnapshot を取得するヘルパ。
 *
 * `bulk-aggregation.ts` の computeBulkAggregation() への入力として使う。
 * テーブル別に 2 種類:
 *  - snapshotDocumentTable: kaisei / jimu-unei / bunshokaitou / tax-answer / qa-jirei (document テーブル)
 *  - snapshotClauseTable:   基本通達 4 種 (clause テーブル)
 *
 * 設計詳細: docs/RESILIENCE.md §5.2
 */

import { createHash } from 'node:crypto';

import type DatabaseT from 'better-sqlite3';

import type { DocSnapshot } from './bulk-aggregation.js';

/** taxonomy → 通達略称（clause テーブルの tsutatsu.abbr 値） */
const TSUTATSU_ABBR_BY_TAXONOMY: Record<string, string> = {
  shohi: '消基通',
  shotoku: '所基通',
  hojin: '法基通',
  sozoku: '相基通',
};

/**
 * document テーブルから snapshot を取得する。
 *
 * @param doc_type 'kaisei' / 'jimu-unei' / 'bunshokaitou' / 'tax-answer' / 'qa-jirei'
 * @param taxonomyFilter 部分実行時にスナップショット範囲を絞り込むための taxonomy（複数指定可）
 *
 * @returns doc_id → DocSnapshot の Map
 */
export function snapshotDocumentTable(
  db: DatabaseT.Database,
  doc_type: string,
  taxonomyFilter?: readonly string[]
): Map<string, DocSnapshot> {
  let sql = 'SELECT doc_id, content_hash, title FROM document WHERE doc_type = ?';
  const params: string[] = [doc_type];
  if (taxonomyFilter && taxonomyFilter.length > 0) {
    const placeholders = taxonomyFilter.map(() => '?').join(', ');
    sql += ` AND taxonomy IN (${placeholders})`;
    params.push(...taxonomyFilter);
  }
  const rows = db.prepare(sql).all(...params) as Array<{
    doc_id: string;
    content_hash: string | null;
    title: string;
  }>;
  return new Map(
    rows.map((r) => [r.doc_id, { doc_id: r.doc_id, content_hash: r.content_hash, title: r.title }])
  );
}

/**
 * clause テーブル（基本通達）から snapshot を取得する。
 *
 * 通達ごとに分離した baseline で扱うため、tsutatsu_taxonomy（'shohi' / 'shotoku' /
 * 'hojin' / 'sozoku'）を必須引数とする。
 *
 * clause テーブルには `content_hash` カラムが無いため、`full_text` から SHA-1 を
 * その場で計算する。`clause.tsutatsu_id` は `tsutatsu` テーブルとの JOIN で taxonomy
 * を解決する（abbr で絞り込み）。
 *
 * @param tsutatsu_taxonomy 'shohi' / 'shotoku' / 'hojin' / 'sozoku'
 * @returns clause_number → DocSnapshot の Map（doc_id = clause_number）
 */
export function snapshotClauseTable(
  db: DatabaseT.Database,
  tsutatsu_taxonomy: 'shohi' | 'shotoku' | 'hojin' | 'sozoku'
): Map<string, DocSnapshot> {
  const abbr = TSUTATSU_ABBR_BY_TAXONOMY[tsutatsu_taxonomy];
  if (!abbr) return new Map();
  const rows = db
    .prepare(
      `SELECT c.clause_number, c.full_text, c.title
       FROM clause c
       JOIN tsutatsu t ON c.tsutatsu_id = t.id
       WHERE t.abbr = ?`
    )
    .all(abbr) as Array<{ clause_number: string; full_text: string; title: string }>;
  return new Map(
    rows.map((r) => {
      // full_text を SHA-1 で hash 化して content_hash 代わりに使う
      const hash = createHash('sha1').update(r.full_text).digest('hex');
      return [r.clause_number, { doc_id: r.clause_number, content_hash: hash, title: r.title }];
    })
  );
}
