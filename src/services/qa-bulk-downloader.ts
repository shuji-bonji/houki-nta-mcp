/**
 * QA Bulk Downloader — 質疑応答事例を税目別索引から bulk DL する。
 *
 * 索引: `/law/shitsugi/{税目}/01.htm`（税目ごとに数百件のリンク）
 * 個別: `/law/shitsugi/{税目}/{category}/{id}.htm`
 *
 * doc_id = `{topic}/{category}/{id}` 例: 'shohi/02/19'
 * taxonomy = 税目 (`QA_TOPICS` の各値)
 */

import { createHash } from 'node:crypto';

import * as cheerio from 'cheerio';
import type DatabaseT from 'better-sqlite3';

import { QA_TOPICS } from '../constants.js';
import type { QaTopic } from '../constants.js';
import { logger } from '../utils/logger.js';
import { fetchNtaPage } from './nta-scraper.js';
import { parseQaJirei } from './qa-parser.js';
import { normalizeJpText } from './text-normalize.js';
import type { NtaDocument } from '../types/document.js';

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
}

export interface BulkQaOptions {
  /** 取得対象の税目に絞る。例: ['shohi', 'shotoku']。未指定なら全 QA_TOPICS */
  topics?: QaTopic[] | undefined;
  requestIntervalMs?: number;
  fetchImpl?: typeof fetch;
  onProgress?: (p: BulkQaProgress) => void;
  /** 1 税目あたりの上限（テスト用） */
  perTopicLimit?: number | undefined;
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

  // 1. 各税目別索引から個別 URL を集める
  const targets: QaIndexEntry[] = [];
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
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('qa-bulk', `税目別索引失敗: ${topic}`, { url: indexUrl, error: msg });
    }
  }

  // 2. 個別事例 fetch + DB 投入
  const upsert = db.prepare(
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
      const fetched = await fetchNtaPage(t.url, fetchImpl ? { fetchImpl } : {});
      const qa = parseQaJirei({
        html: fetched.html,
        sourceUrl: fetched.sourceUrl,
        topic: t.topic,
        category: t.category,
        id: t.id,
        fetchedAt: fetched.fetchedAt,
      });

      const fullText = normalizeJpText(
        [
          qa.title,
          qa.question.length ? `【照会要旨】\n${qa.question.join('\n')}` : '',
          qa.answer.length ? `【回答要旨】\n${qa.answer.join('\n')}` : '',
          qa.relatedLaws.length ? `【関係法令通達】\n${qa.relatedLaws.join('\n')}` : '',
        ]
          .filter(Boolean)
          .join('\n\n')
      );

      const docId = `${t.topic}/${t.category}/${t.id}`;
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
      };
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
        computeHash(doc)
      );
      documentsFetched++;
      perTopic[t.topic] ??= { fetched: 0, failed: 0 };
      perTopic[t.topic].fetched++;
    } catch (err) {
      documentsFailed++;
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('qa-bulk', `失敗: ${t.topic}/${t.category}/${t.id}`, {
        url: t.url,
        error: msg,
      });
      perTopic[t.topic] ??= { fetched: 0, failed: 0 };
      perTopic[t.topic].failed++;
    }
  }

  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - startMs;
  onProgress?.({
    phase: 'done',
    message: `完了: ${documentsFetched}/${targets.length} docs (${(durationMs / 1000).toFixed(1)}s)`,
  });

  return {
    totalEntries: targets.length,
    documentsFetched,
    documentsFailed,
    perTopic,
    startedAt,
    finishedAt,
    durationMs,
  };
}

function computeHash(doc: NtaDocument): string {
  const h = createHash('sha1');
  h.update(doc.docType);
  h.update('\n');
  h.update(doc.docId);
  h.update('\n');
  h.update(doc.title);
  h.update('\n');
  h.update(doc.fullText);
  return h.digest('hex');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
