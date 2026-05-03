/**
 * Tax Answer Bulk Downloader — タックスアンサーを索引から bulk DL する。
 *
 * 索引: `/taxes/shiraberu/taxanswer/code/` （全 850+ 件のリンクが集約）
 * 個別: `/taxes/shiraberu/taxanswer/{税目}/{No}.htm`
 *
 * doc_id = タックスアンサー番号（例: '6101', '1120'）
 * taxonomy = 税目フォルダ（'shotoku' / 'gensen' / 'joto' / 'sozoku' / 'hojin' / 'shohi' / 'inshi' / 'osirase' 等）
 */

import { createHash } from 'node:crypto';

import * as cheerio from 'cheerio';
import type DatabaseT from 'better-sqlite3';

import { logger } from '../utils/logger.js';
import { fetchNtaPage } from './nta-scraper.js';
import { parseTaxAnswer } from './tax-answer-parser.js';
import { normalizeJpText } from './text-normalize.js';
import type { NtaDocument, AttachedPdf } from '../types/document.js';

/** タックスアンサー索引 URL */
export const TAX_ANSWER_INDEX_URL = 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/code/';

export interface BulkTaxAnswerProgress {
  phase: 'index' | 'doc' | 'done';
  message: string;
  current?: number;
  total?: number;
}

export interface BulkTaxAnswerResult {
  totalEntries: number;
  documentsFetched: number;
  documentsFailed: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

export interface BulkTaxAnswerOptions {
  indexUrl?: string;
  /** 取得対象を税目で絞る。例: ['shotoku', 'shohi'] */
  taxonomies?: string[] | undefined;
  requestIntervalMs?: number;
  fetchImpl?: typeof fetch;
  onProgress?: (p: BulkTaxAnswerProgress) => void;
  /** 取得件数の上限（テスト用） */
  limit?: number | undefined;
}

interface TaxAnswerIndexEntry {
  no: string;
  taxonomy: string;
  title: string;
  url: string;
}

/** 索引から個別 URL のリストを抽出する */
export function parseTaxAnswerIndex(html: string, sourceUrl: string): TaxAnswerIndexEntry[] {
  const $ = cheerio.load(html);
  const $body = $('#bodyArea').first();
  const seen = new Set<string>();
  const entries: TaxAnswerIndexEntry[] = [];

  $body.find('a[href]').each((_, a) => {
    const $a = $(a);
    const href = $a.attr('href') ?? '';
    const text = $a.text().trim().replace(/\s+/g, ' ');
    if (!text) return;
    // /taxes/shiraberu/taxanswer/{税目}/{No}.htm
    const m = href.match(/\/taxes\/shiraberu\/taxanswer\/([^/]+)\/(\d+)\.htm$/);
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
      no: m[2],
      taxonomy: m[1],
      title: text,
      url: abs,
    });
  });
  return entries;
}

/** タックスアンサーを bulk DL して `document` テーブルに投入する。 */
export async function bulkDownloadTaxAnswer(
  db: DatabaseT.Database,
  options: BulkTaxAnswerOptions = {}
): Promise<BulkTaxAnswerResult> {
  const indexUrl = options.indexUrl ?? TAX_ANSWER_INDEX_URL;
  const { fetchImpl, onProgress } = options;
  const requestIntervalMs = options.requestIntervalMs ?? 1100;

  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  onProgress?.({ phase: 'index', message: `索引取得: ${indexUrl}` });
  const indexFetched = await fetchNtaPage(indexUrl, fetchImpl ? { fetchImpl } : {});
  let entries = parseTaxAnswerIndex(indexFetched.html, indexFetched.sourceUrl);
  if (options.taxonomies && options.taxonomies.length > 0) {
    const allow = new Set(options.taxonomies);
    entries = entries.filter((e) => allow.has(e.taxonomy));
  }
  const targets = options.limit ? entries.slice(0, options.limit) : entries;

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
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    onProgress?.({
      phase: 'doc',
      message: `[${i + 1}/${targets.length}] No.${t.no} ${t.title.slice(0, 40)}`,
      current: i + 1,
      total: targets.length,
    });
    if (i > 0) await sleep(requestIntervalMs);
    try {
      const fetched = await fetchNtaPage(t.url, fetchImpl ? { fetchImpl } : {});
      const ta = parseTaxAnswer(fetched.html, fetched.sourceUrl, fetched.fetchedAt);
      // タックスアンサーの本文は sections の text を結合
      const fullText = normalizeJpText(
        [
          ta.title,
          ta.effectiveDate ? `[${ta.effectiveDate}]` : '',
          ta.taxCategory ? `税目: ${ta.taxCategory}` : '',
          ...ta.sections.map((s) => `【${s.heading}】\n${s.paragraphs.join('\n')}`),
        ]
          .filter(Boolean)
          .join('\n\n')
      );
      const doc: NtaDocument = {
        docType: 'tax-answer',
        docId: t.no,
        taxonomy: t.taxonomy,
        title: normalizeJpText(ta.title),
        issuedAt: parseEffectiveDate(ta.effectiveDate),
        issuer: '国税庁',
        sourceUrl: ta.sourceUrl,
        fetchedAt: ta.fetchedAt,
        fullText,
        attachedPdfs: extractPdfs(fetched.html, ta.sourceUrl),
      };
      upsert.run(
        doc.docType,
        doc.docId,
        doc.taxonomy ?? null,
        doc.title,
        doc.issuedAt ?? null,
        doc.issuer ?? null,
        doc.sourceUrl,
        doc.fetchedAt,
        doc.fullText,
        JSON.stringify(doc.attachedPdfs),
        computeHash(doc)
      );
      documentsFetched++;
    } catch (err) {
      documentsFailed++;
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('tax-answer-bulk', `失敗: No.${t.no}`, { url: t.url, error: msg });
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
    startedAt,
    finishedAt,
    durationMs,
  };
}

/** `[令和7年4月1日現在法令等]` から ISO 8601 の発出日を取り出す（best effort） */
function parseEffectiveDate(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const m = s.match(/(令和|平成|昭和|大正|明治)\s*(\d+|元)\s*年\s*(\d+)\s*月\s*(\d+)\s*日/);
  if (!m) return undefined;
  const eraOffsets: Record<string, number> = {
    令和: 2018,
    平成: 1988,
    昭和: 1925,
    大正: 1911,
    明治: 1867,
  };
  const yearRaw = m[2] === '元' ? 1 : parseInt(m[2], 10);
  const year = eraOffsets[m[1]] + yearRaw;
  const mm = String(parseInt(m[3], 10)).padStart(2, '0');
  const dd = String(parseInt(m[4], 10)).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function extractPdfs(html: string, sourceUrl: string): AttachedPdf[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const pdfs: AttachedPdf[] = [];
  $('#bodyArea a[href]').each((_, a) => {
    const href = $(a).attr('href');
    if (!href || !/\.pdf(\?|$)/i.test(href)) return;
    let abs: string;
    try {
      abs = new URL(href, sourceUrl).toString();
    } catch {
      return;
    }
    if (seen.has(abs)) return;
    seen.add(abs);
    pdfs.push({ title: $(a).text().trim() || 'PDF', url: abs });
  });
  return pdfs;
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
