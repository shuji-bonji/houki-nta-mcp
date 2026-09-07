/**
 * Document Conditional Fetch — Phase 6-2 (v0.9.0)
 *
 * 5 つの document 系 bulk-downloader (kaisei / jimu-unei / qa / tax-answer / bunshokaitou)
 * で共有する conditional GET ヘルパー。
 *
 * 役割:
 *  - DB から既存 document の `last_modified` / `etag` / `content_hash` を読み出す
 *  - conditional GET 用の `FetchNtaPageOptions` を組み立てる
 *  - 304 / 200+同一 hash / 200+変更 の 3 経路に応じて DB を更新する SQL を提供
 *
 * 設計:
 *  - document テーブルは `source_url` で lookup する。`(doc_type, source_url)` の組合せで
 *    UNIQUE は無いが、kaisei/jimu-unei 等は doc_type ごとに sourceUrl が一意 (索引段階の
 *    URL == 個別ページの URL)。数百件オーダーで sequential scan でも実用上問題なし。
 *  - lastModified / etag は NULL を許容 (初回投入時は不在の可能性がある)。
 */

import type DatabaseT from 'better-sqlite3';
import type { DocType } from '../types/document.js';
import type { FetchNtaPageOptions } from './nta-scraper.js';

/** DB から取得した document の condition state */
export interface DocumentConditionState {
  lastModified: string | null;
  etag: string | null;
  contentHash: string | null;
}

/**
 * `(doc_type, source_url)` で既存 document の condition state を読む。
 * 該当が無ければ `null`。
 */
export function loadDocumentConditionState(
  db: DatabaseT.Database,
  docType: DocType,
  sourceUrl: string
): DocumentConditionState | null {
  const row = db
    .prepare(
      `SELECT last_modified AS lastModified, etag AS etag, content_hash AS contentHash
       FROM document
       WHERE doc_type = ? AND source_url = ?
       LIMIT 1`
    )
    .get(docType, sourceUrl) as DocumentConditionState | undefined;
  return row ?? null;
}

/**
 * conditional GET 用の `fetchNtaPage` オプションを組み立てる。
 * fetchImpl はテスト用 stub を渡せる。
 */
export function buildConditionalFetchOptions(
  state: DocumentConditionState | null,
  fetchImpl?: typeof fetch
): FetchNtaPageOptions {
  const opts: FetchNtaPageOptions = {};
  if (fetchImpl) opts.fetchImpl = fetchImpl;
  if (state?.lastModified) opts.ifModifiedSince = state.lastModified;
  if (state?.etag) opts.ifNoneMatch = state.etag;
  return opts;
}

/**
 * 304 Not Modified 時: `fetched_at` のみ更新する。
 * 既存レコードが存在することが前提 (state が non-null だったときに呼ぶ)。
 */
export function updateDocumentFetchedAt(
  db: DatabaseT.Database,
  docType: DocType,
  sourceUrl: string,
  fetchedAt: string
): void {
  db.prepare(
    `UPDATE document SET fetched_at = ?
     WHERE doc_type = ? AND source_url = ?`
  ).run(fetchedAt, docType, sourceUrl);
}

/**
 * 200 + content_hash 一致時: メタ (`fetched_at`, `last_modified`, `etag`) のみ更新。
 * full_text / attached_pdfs_json は触らない。
 */
export function updateDocumentMetaOnly(
  db: DatabaseT.Database,
  docType: DocType,
  sourceUrl: string,
  fetchedAt: string,
  lastModified: string | null,
  etag: string | null
): void {
  db.prepare(
    `UPDATE document SET fetched_at = ?, last_modified = ?, etag = ?
     WHERE doc_type = ? AND source_url = ?`
  ).run(fetchedAt, lastModified, etag, docType, sourceUrl);
}

/**
 * Phase 6-2: bulk-downloader 内で進捗カウンタとして使う集計形。
 */
export interface DocumentDifferentialCounts {
  /** 304 Not Modified を返してきた document 数 */
  notModified: number;
  /** 200 で取得し content_hash が DB と同じだった document 数 */
  contentSame: number;
  /** 200 で取得し content_hash が変わった (または初回) document 数 */
  contentChanged: number;
}

/** カウンタの初期値 */
export function newDifferentialCounts(): DocumentDifferentialCounts {
  return { notModified: 0, contentSame: 0, contentChanged: 0 };
}
