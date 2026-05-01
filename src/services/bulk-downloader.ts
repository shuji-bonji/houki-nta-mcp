/**
 * Bulk Downloader — 通達一式をローカル SQLite にダンプする
 *
 * フロー:
 *   1. TSUTATSU_URL_ROOTS から通達ルート URL を引く
 *   2. TOC ページを fetch + parseTsutatsuToc で章/節構造抽出
 *   3. tsutatsu / chapter テーブル INSERT
 *   4. 各節を順次 fetch（レート制限付き） + parseTsutatsuSection
 *   5. section + clause テーブル INSERT、FTS5 トリガで自動 indexing
 *
 * Phase 2a/2b では消費税法基本通達のみ対応。他通達は Phase 2d で追加。
 */

import type DatabaseT from 'better-sqlite3';

import { TSUTATSU_TOC_STYLES, TSUTATSU_URL_ROOTS } from '../constants.js';
import { logger } from '../utils/logger.js';
import { fetchNtaPage, NtaFetchError } from './nta-scraper.js';
import { parseTsutatsuSection, TsutatsuParseError } from './tsutatsu-parser.js';
import { parseTsutatsuToc } from './tsutatsu-toc-parser.js';
import { parseTsutatsuTocShotoku } from './tsutatsu-toc-parser-shotoku.js';

/** bulk DL 進捗イベント */
export interface BulkDownloadProgress {
  phase: 'toc' | 'section' | 'done';
  message: string;
  current?: number;
  total?: number;
}

/** bulk DL の結果サマリ */
export interface BulkDownloadResult {
  tsutatsuId: number;
  chapters: number;
  sections: number;
  sectionsFetched: number;
  sectionsFailed: number;
  clauses: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

export interface BulkDownloadOptions {
  /** 通達 formal 名。例: "消費税法基本通達" */
  formalName: string;
  /** 略称。例: "消基通"（DB 記録用） */
  abbr: string;
  /** リクエスト間隔 (ms)。デフォルト 1100 (1 req/sec 以下) */
  requestIntervalMs?: number;
  /** fetch 差し替え（テスト用） */
  fetchImpl?: typeof fetch;
  /** 進捗コールバック */
  onProgress?: (p: BulkDownloadProgress) => void;
  /** 取得対象を制限（テスト用）。指定章のみ DL */
  onlyChapter?: number;
}

/**
 * 1 通達を bulk DL して DB に格納する。
 *
 * 既存の同 formal_name のレコードがあれば全消去して再投入する（idempotent）。
 */
export async function bulkDownloadTsutatsu(
  db: DatabaseT.Database,
  options: BulkDownloadOptions
): Promise<BulkDownloadResult> {
  const { formalName, abbr, fetchImpl, onProgress, onlyChapter } = options;
  const requestIntervalMs = options.requestIntervalMs ?? 1100;

  const rootUrl = TSUTATSU_URL_ROOTS[formalName];
  if (!rootUrl) {
    throw new Error(`通達 "${formalName}" は TSUTATSU_URL_ROOTS に未登録です`);
  }

  const tocUrl = `${rootUrl}01.htm`;
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  // 1. TOC 取得（通達ごとに TOC HTML 構造が違うので parser を切り替え）
  onProgress?.({ phase: 'toc', message: `TOC 取得中: ${tocUrl}` });
  const tocFetched = await fetchNtaPage(tocUrl, fetchImpl ? { fetchImpl } : {});
  const tocStyle = TSUTATSU_TOC_STYLES[formalName] ?? 'shohi';
  const toc =
    tocStyle === 'shotoku'
      ? parseTsutatsuTocShotoku(tocFetched.html, tocFetched.sourceUrl, tocFetched.fetchedAt)
      : parseTsutatsuToc(tocFetched.html, tocFetched.sourceUrl, tocFetched.fetchedAt);

  // 2. tsutatsu / chapter / section の登録
  const insertTsutatsu = db.prepare(
    `INSERT INTO tsutatsu(formal_name, abbr, source_root_url) VALUES (?, ?, ?)
     ON CONFLICT(formal_name) DO UPDATE SET abbr=excluded.abbr, source_root_url=excluded.source_root_url
     RETURNING id`
  );
  const insertChapter = db.prepare(
    `INSERT OR REPLACE INTO chapter(tsutatsu_id, number, title) VALUES (?, ?, ?)`
  );
  const deleteOldClauses = db.prepare(`DELETE FROM clause WHERE tsutatsu_id = ?`);
  const deleteOldSections = db.prepare(`DELETE FROM section WHERE tsutatsu_id = ?`);
  const insertSection = db.prepare(
    `INSERT OR REPLACE INTO section(tsutatsu_id, chapter_number, section_number, title, url, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const insertClause = db.prepare(
    `INSERT INTO clause(tsutatsu_id, clause_number, source_url, chapter_number, section_number, title, full_text, paragraphs_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  // 既存データを消してから入れ直し（同 formal_name で idempotent）
  const tsutatsuRow = insertTsutatsu.get(formalName, abbr, rootUrl) as { id: number };
  const tsutatsuId = tsutatsuRow.id;
  deleteOldClauses.run(tsutatsuId);
  deleteOldSections.run(tsutatsuId);

  let chaptersCount = 0;
  for (const ch of toc.chapters) {
    if (onlyChapter !== undefined && ch.number !== onlyChapter) continue;
    insertChapter.run(tsutatsuId, ch.number, ch.title);
    chaptersCount++;
  }

  // 3. 全節 URL のリストアップ（直接 URL があるものだけ。款はスキップ）
  const sectionTargets: Array<{ chapter: number; section: number; title: string; url: string }> =
    [];
  for (const ch of toc.chapters) {
    if (onlyChapter !== undefined && ch.number !== onlyChapter) continue;
    for (const sec of ch.sections) {
      if (sec.url) {
        sectionTargets.push({
          chapter: ch.number,
          section: sec.number,
          title: sec.title,
          url: sec.url,
        });
      }
    }
  }

  // 4. 各節を順次 fetch + parse + insert
  let sectionsFetched = 0;
  let sectionsFailed = 0;
  let clausesCount = 0;
  const total = sectionTargets.length;

  for (let i = 0; i < total; i++) {
    const t = sectionTargets[i];
    onProgress?.({
      phase: 'section',
      message: `[${i + 1}/${total}] 第${t.chapter}章 第${t.section}節 ${t.title}`,
      current: i + 1,
      total,
    });

    if (i > 0) {
      await sleep(requestIntervalMs);
    }

    try {
      const fetched = await fetchNtaPage(t.url, fetchImpl ? { fetchImpl } : {});
      const sec = parseTsutatsuSection(fetched.html, fetched.sourceUrl, fetched.fetchedAt);

      // section レコード
      insertSection.run(
        tsutatsuId,
        t.chapter,
        t.section,
        t.title,
        fetched.sourceUrl,
        fetched.fetchedAt
      );

      // clause レコード（FTS は trigger で自動更新）
      const insertManyClauses = db.transaction(() => {
        for (const c of sec.clauses) {
          insertClause.run(
            tsutatsuId,
            c.clauseNumber,
            fetched.sourceUrl,
            t.chapter,
            t.section,
            c.title,
            c.fullText,
            JSON.stringify(c.paragraphs)
          );
        }
      });
      insertManyClauses();

      sectionsFetched++;
      clausesCount += sec.clauses.length;
    } catch (err) {
      sectionsFailed++;
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('bulk-downloader', `失敗: 第${t.chapter}章 第${t.section}節`, {
        url: t.url,
        error: msg,
      });
      // NtaFetchError / TsutatsuParseError は continue。他は throw
      if (!(err instanceof NtaFetchError) && !(err instanceof TsutatsuParseError)) {
        throw err;
      }
    }
  }

  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - startMs;
  onProgress?.({
    phase: 'done',
    message: `完了: ${sectionsFetched}/${total} 節, ${clausesCount} clauses (${(durationMs / 1000).toFixed(1)}s)`,
  });

  return {
    tsutatsuId,
    chapters: chaptersCount,
    sections: total,
    sectionsFetched,
    sectionsFailed,
    clauses: clausesCount,
    startedAt,
    finishedAt,
    durationMs,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
