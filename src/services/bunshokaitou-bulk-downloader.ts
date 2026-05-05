/**
 * Bunshokaitou Bulk Downloader — 文書回答事例を 3 階層で順次取得し、
 * `document` テーブル (doc_type='bunshokaitou') に格納する。
 *
 * フロー:
 *   1. メイン索引から税目別索引 URL を取得（11 税目分）
 *   2. 各税目別索引から個別事例 URL を取得
 *   3. 各個別事例を順次 fetch (rate limit 1 req/sec)
 *
 * 全件取得は 2000+ 件 / 30 分超になる可能性があるので、`taxonomies` で絞り込み可。
 */

import { createHash } from 'node:crypto';

import type DatabaseT from 'better-sqlite3';

import { logger } from '../utils/logger.js';
import { computeBulkAggregation, recordBulkRun } from './bulk-aggregation.js';
import { snapshotDocumentTable } from './db-snapshot.js';
import { fetchNtaPage } from './nta-scraper.js';
import {
  parseBunshoMainIndex,
  parseBunshoTaxonomyIndex,
  parseBunshoPage,
} from './bunshokaitou-parser.js';
import { normalizeJpText } from './text-normalize.js';
import type { NtaDocument } from '../types/document.js';
import type { BulkRunRecord } from './health-store.js';
import type { HealthEvaluation } from './health-thresholds.js';

/** メイン索引 URL */
export const BUNSHO_MAIN_INDEX_URL = 'https://www.nta.go.jp/law/bunshokaito/01.htm';

export interface BulkBunshoProgress {
  phase: 'main-index' | 'taxonomy-index' | 'doc' | 'done';
  message: string;
  current?: number;
  total?: number;
}

export interface BulkBunshoResult {
  totalEntries: number;
  documentsFetched: number;
  documentsFailed: number;
  perTaxonomy: Record<string, { fetched: number; failed: number }>;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  /** 4 パターン集計（full run 時のみ）。Phase 5 Resilience */
  aggregation?: BulkRunRecord;
  /** baseline 比較の評価結果 */
  health?: HealthEvaluation;
}

export interface BulkBunshoOptions {
  /** メイン索引 URL（テスト用に差替可） */
  indexUrl?: string;
  /** 取得対象の税目に絞る。例: ['shotoku', 'hojin']。未指定なら全税目 */
  taxonomies?: string[] | undefined;
  requestIntervalMs?: number;
  fetchImpl?: typeof fetch;
  onProgress?: (p: BulkBunshoProgress) => void;
  /** 1 税目あたりの個別事例の上限件数（テスト用） */
  perTaxonomyLimit?: number | undefined;
  /** baseline 永続化のパス上書き（テスト用、Phase 5 Resilience）*/
  baselinePath?: string;
}

/**
 * 文書回答事例を bulk DL して `document` テーブルに投入する。
 */
export async function bulkDownloadBunshokaitou(
  db: DatabaseT.Database,
  options: BulkBunshoOptions = {}
): Promise<BulkBunshoResult> {
  const indexUrl = options.indexUrl ?? BUNSHO_MAIN_INDEX_URL;
  const { fetchImpl, onProgress } = options;
  const requestIntervalMs = options.requestIntervalMs ?? 1100;

  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  // Phase 5 Resilience: 全 taxonomy + 上限なしの「full run」時のみ baseline を記録
  const isFullRun =
    (!options.taxonomies || options.taxonomies.length === 0) && !options.perTaxonomyLimit;
  const beforeSnapshot = isFullRun ? snapshotDocumentTable(db, 'bunshokaitou') : undefined;

  // 1. メイン索引取得
  onProgress?.({ phase: 'main-index', message: `メイン索引取得: ${indexUrl}` });
  const main = await fetchNtaPage(indexUrl, fetchImpl ? { fetchImpl } : {});
  let taxonomyEntries = parseBunshoMainIndex(main.html, main.sourceUrl);

  if (options.taxonomies && options.taxonomies.length > 0) {
    const allow = new Set(options.taxonomies);
    taxonomyEntries = taxonomyEntries.filter((e) => allow.has(e.taxonomy));
  }

  // 2. 各税目別索引から個別事例 URL を集める（fetch 間隔を空ける）
  const targets: Array<{ url: string; title: string; issuedAt: string | undefined }> = [];
  for (let i = 0; i < taxonomyEntries.length; i++) {
    const t = taxonomyEntries[i];
    onProgress?.({
      phase: 'taxonomy-index',
      message: `[${i + 1}/${taxonomyEntries.length}] ${t.taxonomy} 索引取得: ${t.indexUrl}`,
      current: i + 1,
      total: taxonomyEntries.length,
    });
    if (i > 0) await sleep(requestIntervalMs);
    try {
      const fetched = await fetchNtaPage(t.indexUrl, fetchImpl ? { fetchImpl } : {});
      const items = parseBunshoTaxonomyIndex(fetched.html, fetched.sourceUrl);
      const limited = options.perTaxonomyLimit ? items.slice(0, options.perTaxonomyLimit) : items;
      for (const it of limited) {
        targets.push({ url: it.url, title: it.title, issuedAt: it.issuedAt });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('bunsho-bulk', `税目別索引失敗: ${t.taxonomy}`, { url: t.indexUrl, error: msg });
    }
  }

  // 3. 個別事例 fetch + DB INSERT
  const upsertDocument = db.prepare(
    `INSERT INTO document(doc_type, doc_id, taxonomy, title, issued_at, issuer, source_url, fetched_at, full_text, attached_pdfs_json, content_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(doc_type, doc_id) DO UPDATE SET
       taxonomy=excluded.taxonomy,
       title=excluded.title,
       issued_at=excluded.issued_at,
       issuer=excluded.issuer,
       source_url=excluded.source_url,
       fetched_at=excluded.fetched_at,
       full_text=excluded.full_text,
       attached_pdfs_json=excluded.attached_pdfs_json,
       content_hash=excluded.content_hash`
  );

  let documentsFetched = 0;
  let documentsFailed = 0;
  const perTaxonomy: Record<string, { fetched: number; failed: number }> = {};
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    onProgress?.({
      phase: 'doc',
      message: `[${i + 1}/${targets.length}] ${t.title.slice(0, 50)}`,
      current: i + 1,
      total: targets.length,
    });
    if (i > 0) await sleep(requestIntervalMs);

    try {
      const fetched = await fetchNtaPage(t.url, fetchImpl ? { fetchImpl } : {});
      const doc = parseBunshoPage(fetched.html, fetched.sourceUrl, fetched.fetchedAt);
      const issuedAt = doc.issuedAt ?? t.issuedAt;
      const hash = computeDocumentHash(doc);
      upsertDocument.run(
        doc.docType,
        doc.docId,
        doc.taxonomy ?? null,
        normalizeJpText(doc.title),
        issuedAt ?? null,
        doc.issuer ? normalizeJpText(doc.issuer) : null,
        doc.sourceUrl,
        doc.fetchedAt,
        doc.fullText,
        JSON.stringify(doc.attachedPdfs),
        hash
      );
      documentsFetched++;
      const tx = doc.taxonomy ?? '(unknown)';
      perTaxonomy[tx] ??= { fetched: 0, failed: 0 };
      perTaxonomy[tx].fetched++;
    } catch (err) {
      documentsFailed++;
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('bunsho-bulk', `失敗: ${t.title.slice(0, 40)}`, { url: t.url, error: msg });
      // taxonomy を URL から推測して failed カウント
      const txMatch = t.url.match(/bunshokaito\/([^/]+)\//);
      const tx = txMatch ? txMatch[1] : '(unknown)';
      perTaxonomy[tx] ??= { fetched: 0, failed: 0 };
      perTaxonomy[tx].failed++;
    }
  }

  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - startMs;
  onProgress?.({
    phase: 'done',
    message: `完了: ${documentsFetched}/${targets.length} docs (${(durationMs / 1000).toFixed(1)}s)`,
  });

  // Phase 5 Resilience: full run 時のみ集計 + baseline 永続化
  let aggregation: BulkRunRecord | undefined;
  let health: HealthEvaluation | undefined;
  if (isFullRun && beforeSnapshot) {
    const afterSnapshot = snapshotDocumentTable(db, 'bunshokaitou');
    aggregation = computeBulkAggregation({
      before: beforeSnapshot,
      after: afterSnapshot,
      totalEntries: targets.length,
      documentsFailed,
      durationMs,
      ranAt: finishedAt,
    });
    health = recordBulkRun('bunshokaitou', aggregation, options.baselinePath);
  }

  const result: BulkBunshoResult = {
    totalEntries: targets.length,
    documentsFetched,
    documentsFailed,
    perTaxonomy,
    startedAt,
    finishedAt,
    durationMs,
  };
  if (aggregation) result.aggregation = aggregation;
  if (health) result.health = health;
  return result;
}

function computeDocumentHash(doc: NtaDocument): string {
  const h = createHash('sha1');
  h.update(doc.docType);
  h.update('\n');
  h.update(doc.docId);
  h.update('\n');
  h.update(normalizeJpText(doc.title));
  h.update('\n');
  h.update(doc.fullText);
  return h.digest('hex');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
