/**
 * タックスアンサーの索引の保存と読み出し（v0.24.0、SPEC-NTA-GET-TAX-ANSWER-016、SPEC-NTA-DB-SCHEMA-025、houki-nta-mcp #128）。
 *
 * `nta_get_tax_answer` は記事の URL を国税庁の索引（`/taxes/shiraberu/taxanswer/code/`）で決める。
 * 索引は `tax_answer_index`（1 記事 1 行）と `tax_answer_index_page`（索引のページを取った記録）に保存し、
 * 次の呼び出しで使い回す。番号が見つからないときだけ、前回の `Last-Modified` / `ETag` を付けて取り直す。
 */

import type DatabaseT from 'better-sqlite3';
import { TAX_ANSWER_INDEX_URL } from './tax-answer-bulk-downloader.js';

/** 索引の 1 記事 */
export interface TaxAnswerIndexRow {
  /** 4 桁の番号 */
  no: string;
  /** 記事の URL */
  url: string;
  /** URL の `taxanswer/` の次の要素（例: `saigai`） */
  taxonomy: string;
  /** 索引の題名 */
  title: string;
}

/** 索引のページを取った記録 */
export interface TaxAnswerIndexPage {
  fetchedAt: string;
  lastModified?: string;
  etag?: string;
}

/** 保存した索引。番号から記事を引ける */
export interface StoredTaxAnswerIndex {
  entries: Map<string, TaxAnswerIndexRow>;
  page: TaxAnswerIndexPage;
}

/**
 * 保存した索引を読む。索引のページを取った記録が無ければ（まだ一度も取っていなければ）null。
 * テーブルが無い DB（作り直し前など）も null として扱う
 */
export function readStoredTaxAnswerIndex(
  db: DatabaseT.Database,
  indexUrl: string = TAX_ANSWER_INDEX_URL
): StoredTaxAnswerIndex | null {
  try {
    const page = db
      .prepare(
        `SELECT fetched_at AS fetchedAt, last_modified AS lastModified, etag
         FROM tax_answer_index_page WHERE url = ?`
      )
      .get(indexUrl) as
      | { fetchedAt: string; lastModified: string | null; etag: string | null }
      | undefined;
    if (!page) return null;
    const rows = db
      .prepare('SELECT no, url, taxonomy, title FROM tax_answer_index')
      .all() as TaxAnswerIndexRow[];
    const entries = new Map<string, TaxAnswerIndexRow>();
    for (const r of rows) entries.set(r.no, { ...r });
    return {
      entries,
      page: {
        fetchedAt: page.fetchedAt,
        ...(page.lastModified ? { lastModified: page.lastModified } : {}),
        ...(page.etag ? { etag: page.etag } : {}),
      },
    };
  } catch {
    return null;
  }
}

/**
 * 取った索引で、保存した記事の行をすべて置き換え、索引のページの記録を書き換える。
 * 1 つのトランザクションで行い、途中で失敗したら前の行を残す（SPEC-NTA-DB-SCHEMA-025）。
 * 同じ番号が 2 回出てきたら最初の行を使う
 */
export function saveTaxAnswerIndex(
  db: DatabaseT.Database,
  rows: readonly TaxAnswerIndexRow[],
  page: TaxAnswerIndexPage,
  indexUrl: string = TAX_ANSWER_INDEX_URL
): void {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO tax_answer_index(no, url, taxonomy, title) VALUES (?, ?, ?, ?)'
  );
  const upsertPage = db.prepare(
    `INSERT INTO tax_answer_index_page(url, fetched_at, last_modified, etag) VALUES (?, ?, ?, ?)
     ON CONFLICT(url) DO UPDATE SET
       fetched_at = excluded.fetched_at,
       last_modified = excluded.last_modified,
       etag = excluded.etag`
  );
  db.transaction(() => {
    db.exec('DELETE FROM tax_answer_index');
    for (const r of rows) insert.run(r.no, r.url, r.taxonomy, r.title);
    upsertPage.run(indexUrl, page.fetchedAt, page.lastModified ?? null, page.etag ?? null);
  })();
}

/** 条件付きの取り直しで 304 が返ったときは、索引のページの取得日時だけを書き換える（SPEC-NTA-DB-SCHEMA-025） */
export function touchTaxAnswerIndexPage(
  db: DatabaseT.Database,
  fetchedAt: string,
  indexUrl: string = TAX_ANSWER_INDEX_URL
): void {
  db.prepare('UPDATE tax_answer_index_page SET fetched_at = ? WHERE url = ?').run(
    fetchedAt,
    indexUrl
  );
}

/** 記事の URL から税目フォルダ（`taxanswer/` の次の要素）を取る。取れなければ undefined */
export function taxAnswerFolderOf(url: string): string | undefined {
  return url.match(/\/taxes\/shiraberu\/taxanswer\/([^/]+)\/\d+\.htm$/)?.[1];
}
