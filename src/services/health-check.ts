/**
 * Health Check — 6 種別の代表 URL をライブ fetch + parse 互換性検証する。
 *
 * Phase 5 Resilience の active 検知の 1 つ。CI 週次 cron + 手動 (`--health-check`) で起動。
 *
 * 検証内容:
 *  - 各 doc_type の代表 URL を fetch
 *  - 対応する parser に通して例外が出ないこと（= HTML 構造変更を検知）
 *
 * 設計詳細: docs/RESILIENCE.md §5.6
 */

import { fetchNtaPage } from './nta-scraper.js';
import { parseTsutatsuSection } from './tsutatsu-parser.js';
import { parseKaiseiIndex } from './kaisei-toc-parser.js';
import { parseJimuUneiIndex } from './jimu-unei-parser.js';
import { parseBunshoMainIndex } from './bunshokaitou-parser.js';
import { parseTaxAnswer } from './tax-answer-parser.js';
import { parseQaJirei } from './qa-parser.js';

import type { BaselineDocType } from './health-store.js';

/** Canary 対象。doc_type ごとに代表 URL + parser を hardcode */
export interface CanaryTarget {
  doc_type: BaselineDocType;
  /** 人間可読なラベル（出力時に使用）*/
  label: string;
  /** ライブ fetch する URL */
  url: string;
  /** fetch 結果を parse して例外が出るかでチェック。null 返却で「parse OK」扱い */
  parse: (html: string, sourceUrl: string, fetchedAt: string) => void;
}

/** 1 件の検証結果 */
export interface CanaryResult {
  doc_type: BaselineDocType;
  label: string;
  url: string;
  status: 'ok' | 'fail';
  fetchMs: number;
  error?: string;
}

/** Health check 全体の結果 */
export interface HealthCheckResult {
  ranAt: string;
  durationMs: number;
  results: CanaryResult[];
  ok: number;
  fail: number;
}

export interface HealthCheckOptions {
  fetchImpl?: typeof fetch;
  /** リクエスト間隔 (ms)。デフォルト 1100 */
  requestIntervalMs?: number;
  /** 進捗コールバック */
  onProgress?: (msg: string) => void;
}

/**
 * 6 種別 + 4 通達 = 9 件の代表 URL（baseline 種別と 1:1 対応）。
 *
 * 選定理由:
 *  - tsutatsu 系: Phase 2/2d で安定動作確認済の節 URL
 *  - kaisei / jimu-unei / bunshokaitou: 索引ページ（個別ページより構造変更検知に向く）
 *  - tax-answer / qa-jirei: 代表的な実務問い合わせ（インボイス・医療費控除等）
 */
export const CANARY_TARGETS: CanaryTarget[] = [
  {
    doc_type: 'tsutatsu-shohi',
    label: '消基通 第1章 第4節',
    url: 'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/01/04.htm',
    parse: (html, sourceUrl, fetchedAt) => {
      parseTsutatsuSection(html, sourceUrl, fetchedAt);
    },
  },
  {
    doc_type: 'tsutatsu-shotoku',
    label: '所基通 2-4',
    url: 'https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/02/04.htm',
    parse: (html, sourceUrl, fetchedAt) => {
      parseTsutatsuSection(html, sourceUrl, fetchedAt);
    },
  },
  {
    doc_type: 'tsutatsu-hojin',
    label: '法基通 1-3',
    url: 'https://www.nta.go.jp/law/tsutatsu/kihon/hojin/01/03.htm',
    parse: (html, sourceUrl, fetchedAt) => {
      parseTsutatsuSection(html, sourceUrl, fetchedAt);
    },
  },
  {
    doc_type: 'tsutatsu-sozoku',
    label: '相基通 第1章',
    url: 'https://www.nta.go.jp/law/tsutatsu/kihon/sisan/sozoku/01.htm',
    parse: (html, sourceUrl, fetchedAt) => {
      parseTsutatsuSection(html, sourceUrl, fetchedAt);
    },
  },
  {
    doc_type: 'kaisei',
    label: '改正通達 索引（消基通）',
    url: 'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/kaisei/kaisei_a.htm',
    parse: (html, sourceUrl) => {
      const entries = parseKaiseiIndex(html, sourceUrl);
      if (entries.length === 0) throw new Error('索引から個別 URL を 1 件も抽出できませんでした');
    },
  },
  {
    doc_type: 'jimu-unei',
    label: '事務運営指針 索引',
    url: 'https://www.nta.go.jp/law/jimu-unei/jimu.htm',
    parse: (html, sourceUrl) => {
      const entries = parseJimuUneiIndex(html, sourceUrl);
      if (entries.length === 0) throw new Error('索引から個別 URL を 1 件も抽出できませんでした');
    },
  },
  {
    doc_type: 'bunshokaitou',
    label: '文書回答事例 メイン索引',
    url: 'https://www.nta.go.jp/law/bunshokaito/01.htm',
    parse: (html, sourceUrl) => {
      const taxonomies = parseBunshoMainIndex(html, sourceUrl);
      if (taxonomies.length === 0) throw new Error('税目リンクを 1 件も抽出できませんでした');
    },
  },
  {
    doc_type: 'tax-answer',
    label: 'タックスアンサー 6101 (消費税の基本的なしくみ)',
    url: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6101.htm',
    parse: (html, sourceUrl, fetchedAt) => {
      const ta = parseTaxAnswer(html, sourceUrl, fetchedAt);
      if (!ta.title) throw new Error('title を抽出できませんでした');
    },
  },
  {
    doc_type: 'qa-jirei',
    label: '質疑応答事例 shohi/02/19',
    url: 'https://www.nta.go.jp/law/shitsugi/shohi/02/19.htm',
    parse: (html, sourceUrl, fetchedAt) => {
      const qa = parseQaJirei({
        html,
        sourceUrl,
        topic: 'shohi',
        category: '02',
        id: '19',
        fetchedAt,
      });
      if (!qa.title) throw new Error('title を抽出できませんでした');
    },
  },
];

/**
 * 6 大コンテンツ + 4 通達 (= 9 種別) の canary fetch + parse を順次実行する。
 *
 * 各 fetch 失敗 / parse 失敗は CanaryResult.status='fail' として記録され、
 * 後続も継続する（fail-soft）。
 */
export async function runHealthCheck(options: HealthCheckOptions = {}): Promise<HealthCheckResult> {
  const { fetchImpl, onProgress } = options;
  const requestIntervalMs = options.requestIntervalMs ?? 1100;

  const ranAt = new Date().toISOString();
  const startMs = Date.now();
  const results: CanaryResult[] = [];

  for (let i = 0; i < CANARY_TARGETS.length; i++) {
    const target = CANARY_TARGETS[i];
    if (i > 0) await sleep(requestIntervalMs);

    onProgress?.(`[${i + 1}/${CANARY_TARGETS.length}] ${target.label} (${target.doc_type})`);

    const fetchStart = Date.now();
    try {
      const fetched = await fetchNtaPage(target.url, fetchImpl ? { fetchImpl } : {});
      const fetchMs = Date.now() - fetchStart;
      try {
        target.parse(fetched.html, fetched.sourceUrl, fetched.fetchedAt);
        results.push({
          doc_type: target.doc_type,
          label: target.label,
          url: target.url,
          status: 'ok',
          fetchMs,
        });
      } catch (parseErr) {
        const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
        results.push({
          doc_type: target.doc_type,
          label: target.label,
          url: target.url,
          status: 'fail',
          fetchMs,
          error: `parse: ${msg}`,
        });
      }
    } catch (fetchErr) {
      const fetchMs = Date.now() - fetchStart;
      const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      results.push({
        doc_type: target.doc_type,
        label: target.label,
        url: target.url,
        status: 'fail',
        fetchMs,
        error: `fetch: ${msg}`,
      });
    }
  }

  const ok = results.filter((r) => r.status === 'ok').length;
  const fail = results.filter((r) => r.status === 'fail').length;
  const durationMs = Date.now() - startMs;
  return { ranAt, durationMs, results, ok, fail };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
