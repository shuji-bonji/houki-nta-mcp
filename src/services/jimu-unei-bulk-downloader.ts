/**
 * Jimu-unei Bulk Downloader — 事務運営指針一覧から個別ページを取得して
 * `document` テーブルに格納する（kaisei と同じパターン）。
 */

import { createHash } from 'node:crypto';

import type DatabaseT from 'better-sqlite3';

import { logger } from '../utils/logger.js';
import { computeBulkAggregation, recordBulkRun } from './bulk-aggregation.js';
import { snapshotDocumentTable } from './db-snapshot.js';
import { fetchNtaPage } from './nta-scraper.js';
import { parseJimuUneiIndex, parseJimuUneiPage } from './jimu-unei-parser.js';
import { normalizeJpText } from './text-normalize.js';
import type { NtaDocument } from '../types/document.js';
import type { BulkRunRecord } from './health-store.js';
import type { HealthEvaluation } from './health-thresholds.js';

/** 事務運営指針 索引 URL */
export const JIMU_UNEI_INDEX_URL = 'https://www.nta.go.jp/law/jimu-unei/jimu.htm';

export interface BulkJimuUneiProgress {
  phase: 'index' | 'doc' | 'done';
  message: string;
  current?: number;
  total?: number;
}

export interface BulkJimuUneiResult {
  indexUrl: string;
  totalEntries: number;
  documentsFetched: number;
  documentsFailed: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  /** 4 パターン集計（full run 時のみ）。Phase 5 Resilience */
  aggregation?: BulkRunRecord;
  /** baseline 比較の評価結果 */
  health?: HealthEvaluation;
}

export interface BulkJimuUneiOptions {
  indexUrl?: string;
  requestIntervalMs?: number;
  fetchImpl?: typeof fetch;
  onProgress?: (p: BulkJimuUneiProgress) => void;
  limit?: number | undefined;
  /** baseline 永続化のパス上書き（テスト用、Phase 5 Resilience）*/
  baselinePath?: string;
}

/**
 * 事務運営指針索引を bulk DL して `document` テーブルへ投入する。
 */
export async function bulkDownloadJimuUnei(
  db: DatabaseT.Database,
  options: BulkJimuUneiOptions = {}
): Promise<BulkJimuUneiResult> {
  const indexUrl = options.indexUrl ?? JIMU_UNEI_INDEX_URL;
  const { fetchImpl, onProgress } = options;
  const requestIntervalMs = options.requestIntervalMs ?? 1100;

  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  // Phase 5 Resilience: 上限なしの「full run」時のみ baseline を記録
  const isFullRun = !options.limit;
  const beforeSnapshot = isFullRun ? snapshotDocumentTable(db, 'jimu-unei') : undefined;

  onProgress?.({ phase: 'index', message: `索引取得: ${indexUrl}` });
  const indexFetched = await fetchNtaPage(indexUrl, fetchImpl ? { fetchImpl } : {});
  const entries = parseJimuUneiIndex(indexFetched.html, indexFetched.sourceUrl);
  const targets = options.limit ? entries.slice(0, options.limit) : entries;

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
      const doc = parseJimuUneiPage(fetched.html, fetched.sourceUrl, fetched.fetchedAt);
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
    } catch (err) {
      documentsFailed++;
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('jimu-unei-bulk', `失敗: ${t.title.slice(0, 40)}`, { url: t.url, error: msg });
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
    const afterSnapshot = snapshotDocumentTable(db, 'jimu-unei');
    aggregation = computeBulkAggregation({
      before: beforeSnapshot,
      after: afterSnapshot,
      totalEntries: targets.length,
      documentsFailed,
      durationMs,
      ranAt: finishedAt,
    });
    health = recordBulkRun('jimu-unei', aggregation, options.baselinePath);
  }

  const result: BulkJimuUneiResult = {
    indexUrl,
    totalEntries: targets.length,
    documentsFetched,
    documentsFailed,
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
