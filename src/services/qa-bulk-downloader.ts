/**
 * QA Bulk Downloader — 質疑応答事例を税目別索引から bulk DL する。
 *
 * 索引: `/law/shitsugi/{税目}/01.htm`（税目ごとに数百件のリンク）
 * 個別: `/law/shitsugi/{税目}/{category}/{id}.htm`
 *
 * doc_id = `{topic}/{category}/{id}` 例: 'shohi/02/19'
 * taxonomy = 税目 (`QA_TOPICS` の各値)
 */

import type DatabaseT from 'better-sqlite3';
import * as cheerio from 'cheerio';
import type { QaTopic } from '../constants.js';
import { QA_TOPICS } from '../constants.js';
import type { NtaDocument } from '../types/document.js';
import { logger, toMeta } from '../utils/logger.js';
import { computeBulkAggregation, recordBulkRun } from './bulk-aggregation.js';
import { snapshotDocumentTable } from './db-snapshot.js';
import {
  buildConditionalFetchOptions,
  loadDocumentConditionState,
  newDifferentialCounts,
  updateDocumentFetchedAt,
  updateDocumentMetaOnly,
} from './document-conditional-fetch.js';
import { computeDocumentHash } from './document-writeback.js';
import { markAndCount } from './index-status.js';
import type { BulkRunRecord } from './health-store.js';
import type { HealthEvaluation } from './health-thresholds.js';
import { fetchNtaPage } from './nta-scraper.js';
import { buildQaFullText, parseQaJirei } from './qa-parser.js';
import { normalizeJpText } from './text-normalize.js';

export interface BulkQaProgress {
  phase: 'topic-index' | 'doc' | 'done';
  message: string;
  current?: number;
  total?: number;
}

export interface BulkQaResult {
  totalEntries: number;
  documentsFetched: number;
  documentsFailed: number;
  perTopic: Record<string, { fetched: number; failed: number }>;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  /** 4 パターン集計（全 9 topics の full run 時のみ）。Phase 5 Resilience */
  aggregation?: BulkRunRecord;
  /** baseline 比較の評価結果（aggregation がある時のみ）*/
  health?: HealthEvaluation;
  /** Phase 6-2 (v0.9.0): 304 / 同 hash / 変更 の内訳 */
  documentsNotModified?: number;
  documentsContentSame?: number;
  documentsContentChanged?: number;
}

export interface BulkQaOptions {
  /** 取得対象の税目に絞る。例: ['shohi', 'shotoku']。未指定なら全 QA_TOPICS */
  topics?: QaTopic[] | undefined;
  requestIntervalMs?: number;
  fetchImpl?: typeof fetch;
  onProgress?: (p: BulkQaProgress) => void;
  /** 1 税目あたりの上限（テスト用） */
  perTopicLimit?: number | undefined;
  /** baseline 永続化のパス上書き（テスト用、Phase 5 Resilience）*/
  baselinePath?: string;
  /** Phase 6-2 (v0.9.0): true で conditional GET をスキップ */
  forceReload?: boolean;
}

interface QaIndexEntry {
  topic: QaTopic;
  category: string;
  id: string;
  title: string;
  url: string;
}

/** 税目別索引から個別 URL のリストを返す */
export function parseQaTopicIndex(html: string, sourceUrl: string, topic: QaTopic): QaIndexEntry[] {
  const $ = cheerio.load(html);
  const $body = $('#bodyArea').first();
  const seen = new Set<string>();
  const entries: QaIndexEntry[] = [];

  $body.find('a[href]').each((_, a) => {
    const $a = $(a);
    const href = $a.attr('href') ?? '';
    const text = $a.text().trim().replace(/\s+/g, ' ');
    if (!text) return;
    // /law/shitsugi/{topic}/{category}/{id}.htm
    const m = href.match(new RegExp(`/law/shitsugi/${topic}/(\\d+)/(\\d+)\\.htm$`));
    if (!m) return;
    let abs: string;
    try {
      abs = new URL(href, sourceUrl).toString();
    } catch {
      return;
    }
    if (seen.has(abs)) return;
    seen.add(abs);
    entries.push({
      topic,
      category: m[1],
      id: m[2],
      title: text,
      url: abs,
    });
  });
  return entries;
}

export async function bulkDownloadQa(
  db: DatabaseT.Database,
  options: BulkQaOptions = {}
): Promise<BulkQaResult> {
  const topics = (options.topics?.length ? options.topics : [...QA_TOPICS]) as QaTopic[];
  const { fetchImpl, onProgress } = options;
  const requestIntervalMs = options.requestIntervalMs ?? 1100;

  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  // Phase 5 Resilience: 全 9 topics + 上限なしの「full run」時のみ baseline を記録。
  // partial run（特定 topic のみ / perTopicLimit あり）は median 比較が意味を持たないので
  // baseline 永続化はスキップする。
  const isFullRun = topics.length === QA_TOPICS.length && !options.perTopicLimit;
  const beforeSnapshot = isFullRun ? snapshotDocumentTable(db, 'qa-jirei') : undefined;

  // 1. 各税目別索引から個別 URL を集める
  const targets: QaIndexEntry[] = [];
  // Issue #30: 索引を 1 つでも取れなかった実行では、索引から消えた文書の判定をしない
  let indexFailures = 0;
  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i];
    const indexUrl = `https://www.nta.go.jp/law/shitsugi/${topic}/01.htm`;
    onProgress?.({
      phase: 'topic-index',
      message: `[${i + 1}/${topics.length}] ${topic} 索引取得: ${indexUrl}`,
      current: i + 1,
      total: topics.length,
    });
    if (i > 0) await sleep(requestIntervalMs);
    try {
      const fetched = await fetchNtaPage(indexUrl, fetchImpl ? { fetchImpl } : {});
      const items = parseQaTopicIndex(fetched.html, fetched.sourceUrl, topic);
      const limited = options.perTopicLimit ? items.slice(0, options.perTopicLimit) : items;
      targets.push(...limited);
    } catch (err) {
      indexFailures++;
      logger.warn('qa-bulk', `税目別索引失敗: ${topic}`, { url: indexUrl, error: toMeta(err) });
    }
  }

  // 2. 個別事例 fetch + DB 投入 (Phase 6-2: conditional GET + 3-way diff)
  const upsert = db.prepare(
    `INSERT INTO document(doc_type, doc_id, taxonomy, title, issued_at, issuer, source_url, fetched_at, full_text, attached_pdfs_json, content_hash, last_modified, etag, structured_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(doc_type, doc_id) DO UPDATE SET
       taxonomy=excluded.taxonomy,
       title=excluded.title,
       issued_at=excluded.issued_at,
       issuer=excluded.issuer,
       source_url=excluded.source_url,
       fetched_at=excluded.fetched_at,
       full_text=excluded.full_text,
       attached_pdfs_json=excluded.attached_pdfs_json,
       content_hash=excluded.content_hash,
       last_modified=excluded.last_modified,
       etag=excluded.etag,
       structured_json=excluded.structured_json`
  );

  let documentsFetched = 0;
  let documentsFailed = 0;
  const counts = newDifferentialCounts();
  const perTopic: Record<string, { fetched: number; failed: number }> = {};

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    onProgress?.({
      phase: 'doc',
      message: `[${i + 1}/${targets.length}] ${t.topic}/${t.category}/${t.id} ${t.title.slice(0, 40)}`,
      current: i + 1,
      total: targets.length,
    });
    if (i > 0) await sleep(requestIntervalMs);

    try {
      const state = options.forceReload ? null : loadDocumentConditionState(db, 'qa-jirei', t.url);
      // Issue #29: structured_json がまだ無い行は、本文が同じでも構造を入れる必要がある。
      // 条件付き GET を使うと 304 で本文が返らずパースできないので、その行だけ 200 で取り直す
      const effectiveState = state?.hasStructured === false ? null : state;
      const fetchOpts = buildConditionalFetchOptions(effectiveState, fetchImpl);
      const fetched = await fetchNtaPage(t.url, fetchOpts);

      if (fetched.notModified) {
        updateDocumentFetchedAt(db, 'qa-jirei', t.url, fetched.fetchedAt);
        counts.notModified++;
        documentsFetched++;
        perTopic[t.topic] ??= { fetched: 0, failed: 0 };
        perTopic[t.topic].fetched++;
        continue;
      }

      const qa = parseQaJirei({
        html: fetched.html,
        sourceUrl: fetched.sourceUrl,
        topic: t.topic,
        category: t.category,
        id: t.id,
        fetchedAt: fetched.fetchedAt,
      });

      const fullText = buildQaFullText(qa);

      const docId = `${t.topic}/${t.category}/${t.id}`;
      // Issue #29: 取得ツールが DB から live と同じ構造を返せるように、パース結果を残す。
      // sourceUrl / fetchedAt は列を正とするので構造には入れない
      const {
        sourceUrl: _structuredSourceUrl,
        fetchedAt: _structuredFetchedAt,
        ...structured
      } = qa;
      const doc: NtaDocument = {
        docType: 'qa-jirei',
        docId,
        taxonomy: t.topic,
        title: normalizeJpText(qa.title),
        issuedAt: undefined,
        issuer: '国税庁',
        sourceUrl: qa.sourceUrl,
        fetchedAt: qa.fetchedAt,
        fullText,
        attachedPdfs: [],
        structured,
      };
      const hash = computeDocumentHash(doc);

      if (effectiveState?.contentHash && effectiveState.contentHash === hash) {
        updateDocumentMetaOnly(
          db,
          'qa-jirei',
          t.url,
          fetched.fetchedAt,
          fetched.lastModified ?? null,
          fetched.etag ?? null
        );
        counts.contentSame++;
        documentsFetched++;
        perTopic[t.topic] ??= { fetched: 0, failed: 0 };
        perTopic[t.topic].fetched++;
        continue;
      }

      upsert.run(
        doc.docType,
        doc.docId,
        doc.taxonomy ?? null,
        doc.title,
        null,
        doc.issuer ?? null,
        doc.sourceUrl,
        doc.fetchedAt,
        doc.fullText,
        JSON.stringify(doc.attachedPdfs),
        hash,
        fetched.lastModified ?? null,
        fetched.etag ?? null,
        JSON.stringify(doc.structured)
      );
      counts.contentChanged++;
      documentsFetched++;
      perTopic[t.topic] ??= { fetched: 0, failed: 0 };
      perTopic[t.topic].fetched++;
    } catch (err) {
      documentsFailed++;
      logger.warn('qa-bulk', `失敗: ${t.topic}/${t.category}/${t.id}`, {
        url: t.url,
        error: toMeta(err),
      });
      perTopic[t.topic] ??= { fetched: 0, failed: 0 };
      perTopic[t.topic].failed++;
    }
  }

  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - startMs;

  // Phase 5 Resilience: full run 時のみ集計 + baseline 永続化
  let aggregation: BulkRunRecord | undefined;
  let health: HealthEvaluation | undefined;
  if (isFullRun && beforeSnapshot) {
    const afterSnapshot = snapshotDocumentTable(db, 'qa-jirei');
    // Issue #30: 索引から消えた文書に印を付け直す（索引をすべて取れたときだけ）
    const orphanCounts =
      indexFailures === 0
        ? markAndCount(db, 'qa-jirei', {
            indexUrls: new Set(targets.map((t) => t.url)),
            runStartedAt: startedAt,
            ranAt: finishedAt,
          })
        : undefined;
    aggregation = computeBulkAggregation({
      before: beforeSnapshot,
      after: afterSnapshot,
      totalEntries: targets.length,
      documentsFailed,
      durationMs,
      ranAt: finishedAt,
      ...(orphanCounts ? { orphanCounts } : {}),
    });
    health = recordBulkRun('qa-jirei', aggregation, options.baselinePath);
  }

  onProgress?.({
    phase: 'done',
    message: `完了: ${documentsFetched}/${targets.length} docs (304: ${counts.notModified}, 同内容: ${counts.contentSame}, 更新: ${counts.contentChanged}) ${(durationMs / 1000).toFixed(1)}s`,
  });

  const result: BulkQaResult = {
    totalEntries: targets.length,
    documentsFetched,
    documentsFailed,
    perTopic,
    startedAt,
    finishedAt,
    durationMs,
    documentsNotModified: counts.notModified,
    documentsContentSame: counts.contentSame,
    documentsContentChanged: counts.contentChanged,
  };
  if (aggregation) result.aggregation = aggregation;
  if (health) result.health = health;
  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
