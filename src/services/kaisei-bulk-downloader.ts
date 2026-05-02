/**
 * Kaisei Bulk Downloader — 4 通達分の改正通達一覧 + 個別ページを取得して
 * `document` テーブルに格納する。
 *
 * フロー:
 *   1. 各 `KAISEI_INDEX_URLS[税目]` の改正索引を fetch
 *   2. parseKaiseiIndex で個別改正通達 URL のリスト化
 *   3. 各個別ページを順次 fetch（rate limit 1 req/sec）
 *   4. parseKaiseiPage で本文・添付 PDF を抽出 → document テーブル INSERT
 *
 * fail-soft: 個別ページの fetch / parse 失敗は続行（失敗カウントのみ）
 */

import { createHash } from 'node:crypto';

import type DatabaseT from 'better-sqlite3';

import { logger } from '../utils/logger.js';
import { fetchNtaPage } from './nta-scraper.js';
import { parseKaiseiIndex } from './kaisei-toc-parser.js';
import { parseKaiseiPage } from './kaisei-parser.js';
import { normalizeJpText } from './text-normalize.js';
import type { NtaDocument } from '../types/document.js';

/** 4 通達の改正索引 URL（v0.4.0-alpha.1 の対象） */
export const KAISEI_INDEX_URLS: Readonly<Record<string, string>> = {
  消費税法基本通達: 'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/kaisei/kaisei_a.htm',
  所得税法基本通達: 'https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/kaisei/kaisei_a.htm',
  法人税法基本通達: 'https://www.nta.go.jp/law/tsutatsu/kihon/hojin/kaisei/kaisei_a.htm',
  相続税法基本通達: 'https://www.nta.go.jp/law/tsutatsu/kihon/sisan/sozoku/kaisei/kaisei_a.htm',
} as const;

export interface BulkKaiseiProgress {
  phase: 'index' | 'doc' | 'done';
  message: string;
  current?: number;
  total?: number;
}

export interface BulkKaiseiResult {
  indexUrl: string;
  totalEntries: number;
  documentsFetched: number;
  documentsFailed: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

export interface BulkKaiseiOptions {
  /** 索引ページの URL */
  indexUrl: string;
  /** リクエスト間隔 (ms)。デフォルト 1100 */
  requestIntervalMs?: number;
  /** fetch 差し替え（テスト用） */
  fetchImpl?: typeof fetch;
  /** 進捗コールバック */
  onProgress?: (p: BulkKaiseiProgress) => void;
  /** 取得件数を制限（テスト用） */
  limit?: number | undefined;
}

/**
 * 改正通達索引を 1 つ bulk DL して document テーブルに投入する。
 *
 * 既存の同 (doc_type='kaisei', doc_id) は INSERT OR REPLACE で上書き（idempotent）。
 */
export async function bulkDownloadKaisei(
  db: DatabaseT.Database,
  options: BulkKaiseiOptions
): Promise<BulkKaiseiResult> {
  const { indexUrl, fetchImpl, onProgress } = options;
  const requestIntervalMs = options.requestIntervalMs ?? 1100;

  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  // 1. 索引取得
  onProgress?.({ phase: 'index', message: `索引取得: ${indexUrl}` });
  const indexFetched = await fetchNtaPage(indexUrl, fetchImpl ? { fetchImpl } : {});
  const entries = parseKaiseiIndex(indexFetched.html, indexFetched.sourceUrl);
  const targets = options.limit ? entries.slice(0, options.limit) : entries;

  // 2. INSERT 文を準備
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

  // 3. 各個別ページを順次取得
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
      const doc = parseKaiseiPage(fetched.html, fetched.sourceUrl, fetched.fetchedAt);
      // 索引から取れた issuedAt が個別ページより信頼できる場合があるので fallback
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
      logger.warn('kaisei-bulk', `失敗: ${t.title.slice(0, 40)}`, { url: t.url, error: msg });
      // fail-soft: 想定外エラーでも次の document へ
    }
  }

  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - startMs;
  onProgress?.({
    phase: 'done',
    message: `完了: ${documentsFetched}/${targets.length} docs (${(durationMs / 1000).toFixed(1)}s)`,
  });

  return {
    indexUrl,
    totalEntries: targets.length,
    documentsFetched,
    documentsFailed,
    startedAt,
    finishedAt,
    durationMs,
  };
}

/** document の content_hash を計算 */
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
