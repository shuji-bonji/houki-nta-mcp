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

import { createHash } from 'node:crypto';

import type DatabaseT from 'better-sqlite3';

import { TSUTATSU_TOC_STYLES, TSUTATSU_URL_ROOTS } from '../constants.js';
import { logger } from '../utils/logger.js';
import { computeBulkAggregation, recordBulkRun } from './bulk-aggregation.js';
import { snapshotClauseTable } from './db-snapshot.js';
import { fetchNtaPage } from './nta-scraper.js';
import { parseTsutatsuSection } from './tsutatsu-parser.js';
import { normalizeJpText } from './text-normalize.js';
import type { BaselineDocType, BulkRunRecord } from './health-store.js';
import type { HealthEvaluation } from './health-thresholds.js';

/** 通達略称 → BaselineDocType / taxonomy の対応 */
const ABBR_TO_TAXONOMY: Record<string, 'shohi' | 'shotoku' | 'hojin' | 'sozoku'> = {
  消基通: 'shohi',
  所基通: 'shotoku',
  法基通: 'hojin',
  相基通: 'sozoku',
};

function abbrToBaselineType(abbr: string): BaselineDocType | null {
  const tax = ABBR_TO_TAXONOMY[abbr];
  return tax ? (`tsutatsu-${tax}` as BaselineDocType) : null;
}

/**
 * section の content_hash を計算する。
 *
 * 入力は clauses の (clauseNumber + title + fullText) を連結したもの。
 * 改正検知に使うので、normalize 後の値で計算する（全角ゆらぎを吸収するため）。
 */
function computeSectionContentHash(
  clauses: ReadonlyArray<{ clauseNumber: string; title: string; fullText: string }>
): string {
  const h = createHash('sha1');
  for (const c of clauses) {
    h.update(c.clauseNumber);
    h.update('\n');
    h.update(normalizeJpText(c.title));
    h.update('\n');
    h.update(normalizeJpText(c.fullText));
    h.update('\n---\n');
  }
  return h.digest('hex');
}
import { parseTsutatsuToc } from './tsutatsu-toc-parser.js';
import { parseTsutatsuTocShotoku } from './tsutatsu-toc-parser-shotoku.js';
import { parseTsutatsuTocHojin } from './tsutatsu-toc-parser-hojin.js';
import { parseTsutatsuTocSozoku } from './tsutatsu-toc-parser-sozoku.js';

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
  /** 4 パターン集計（full run + 既知 abbr 時のみ）。Phase 5 Resilience */
  aggregation?: BulkRunRecord;
  /** baseline 比較の評価結果 */
  health?: HealthEvaluation;
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
  /** baseline 永続化のパス上書き（テスト用、Phase 5 Resilience）*/
  baselinePath?: string;
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

  // Phase 5 Resilience: 通達ごとに分離した baseline で記録（4 通達 = 4 ファイル）
  // - onlyChapter（部分実行）の場合は baseline 永続化スキップ
  // - 未知の abbr の場合も skip（敏感な誤検知を避ける）
  const baselineDocType = abbrToBaselineType(abbr);
  const isFullRun = onlyChapter === undefined && baselineDocType !== null;
  const taxonomy = ABBR_TO_TAXONOMY[abbr];
  const beforeSnapshot = isFullRun && taxonomy ? snapshotClauseTable(db, taxonomy) : undefined;

  // 1. TOC 取得（通達ごとに TOC HTML 構造が違うので parser を切り替え）
  onProgress?.({ phase: 'toc', message: `TOC 取得中: ${tocUrl}` });
  const tocFetched = await fetchNtaPage(tocUrl, fetchImpl ? { fetchImpl } : {});
  const tocStyle = TSUTATSU_TOC_STYLES[formalName] ?? 'shohi';
  const toc =
    tocStyle === 'shotoku'
      ? parseTsutatsuTocShotoku(tocFetched.html, tocFetched.sourceUrl, tocFetched.fetchedAt)
      : tocStyle === 'hojin'
        ? parseTsutatsuTocHojin(tocFetched.html, tocFetched.sourceUrl, tocFetched.fetchedAt)
        : tocStyle === 'sozoku'
          ? parseTsutatsuTocSozoku(tocFetched.html, tocFetched.sourceUrl, tocFetched.fetchedAt)
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
    `INSERT OR REPLACE INTO section(tsutatsu_id, chapter_number, section_number, title, url, fetched_at, content_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
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

      // section レコード（v2: content_hash で改正検知に備える）
      const sectionContentHash = computeSectionContentHash(sec.clauses);
      insertSection.run(
        tsutatsuId,
        t.chapter,
        t.section,
        t.title,
        fetched.sourceUrl,
        fetched.fetchedAt,
        sectionContentHash
      );

      // clause レコード（FTS は trigger で自動更新）。
      // title / full_text / paragraphs に **normalizeJpText** を適用し、
      // 検索側との「Normalize-everywhere」整合を取る（全角ハイフン・全角チルダ・
      // 全角数字・全角スペースを ASCII 化）。中黒 `・` 等は意味のある文字として残す。
      const insertManyClauses = db.transaction(() => {
        for (const c of sec.clauses) {
          const normalizedTitle = normalizeJpText(c.title);
          const normalizedFullText = normalizeJpText(c.fullText);
          const normalizedParagraphs = c.paragraphs.map((p) => ({
            indent: p.indent,
            text: normalizeJpText(p.text),
          }));
          insertClause.run(
            tsutatsuId,
            c.clauseNumber,
            fetched.sourceUrl,
            t.chapter,
            t.section,
            normalizedTitle,
            normalizedFullText,
            JSON.stringify(normalizedParagraphs)
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
      // 想定外のエラー（SQLite 制約違反 / JSON エラー等）でも fail-soft で次の節に進む。
      // bulk DL 全体を止めると 1 件のバグで数百節が無駄になるため、ログ警告で済ませる。
      // ※ Phase 2e (v0.3.0) で「想定外も continue」に方針変更（旧: 想定外は throw）
    }
  }

  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - startMs;

  // Phase 5 Resilience: full run + 既知 abbr 時のみ集計 + baseline 永続化
  let aggregation: BulkRunRecord | undefined;
  let health: HealthEvaluation | undefined;
  if (isFullRun && taxonomy && baselineDocType && beforeSnapshot) {
    const afterSnapshot = snapshotClauseTable(db, taxonomy);
    // tsutatsu の場合、totalEntries は clauses 数、failed は section 数で代用
    // (1 section の失敗は通常 N clauses 取得失敗に相当するが正確な count は出にくい)
    aggregation = computeBulkAggregation({
      before: beforeSnapshot,
      after: afterSnapshot,
      totalEntries: clausesCount + sectionsFailed, // 失敗推定も加える
      documentsFailed: sectionsFailed,
      durationMs,
      ranAt: finishedAt,
    });
    health = recordBulkRun(baselineDocType, aggregation, options.baselinePath);
  }

  onProgress?.({
    phase: 'done',
    message: `完了: ${sectionsFetched}/${total} 節, ${clausesCount} clauses (${(durationMs / 1000).toFixed(1)}s)`,
  });

  const result: BulkDownloadResult = {
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
  if (aggregation) result.aggregation = aggregation;
  if (health) result.health = health;
  return result;
}

/* -------------------------------------------------------------------------- */

/**
 * ライブ取得した 1 section の clauses を DB に書き戻す（write-through cache）。
 *
 * Phase 2e で追加。`getTsutatsu` の **ライブ fallback 経路で取得した clauses を
 * 次回以降 DB lookup でヒットさせる** ために使う。
 *
 * 既存 chapter / section レコードが無くても upsert で作成し、clause を投入する。
 * 失敗しても呼び出し側に影響を与えないよう例外を握りつぶす（best effort cache）。
 *
 * 投入時は Normalize-everywhere を適用（title / full_text / paragraphs_json）。
 *
 * @returns 投入した clauses 件数（失敗時は 0）
 */
export function writeBackLiveSection(
  db: DatabaseT.Database,
  options: {
    formalName: string;
    abbr: string;
    rootUrl: string;
    chapterNumber: number;
    sectionNumber: number;
    sectionUrl: string;
    fetchedAt: string;
    sectionTitle: string;
    chapterTitle?: string | undefined;
    clauses: ReadonlyArray<{
      clauseNumber: string;
      title: string;
      fullText: string;
      paragraphs: ReadonlyArray<{ indent: 1 | 2 | 3; text: string }>;
    }>;
  }
): number {
  try {
    const upsertTsutatsu = db.prepare(
      `INSERT INTO tsutatsu(formal_name, abbr, source_root_url) VALUES (?, ?, ?)
       ON CONFLICT(formal_name) DO UPDATE SET abbr=excluded.abbr, source_root_url=excluded.source_root_url
       RETURNING id`
    );
    const tsutatsuRow = upsertTsutatsu.get(options.formalName, options.abbr, options.rootUrl) as {
      id: number;
    };
    const tsutatsuId = tsutatsuRow.id;

    if (options.chapterTitle) {
      db.prepare(`INSERT OR REPLACE INTO chapter(tsutatsu_id, number, title) VALUES (?, ?, ?)`).run(
        tsutatsuId,
        options.chapterNumber,
        options.chapterTitle
      );
    }

    const sectionContentHash = computeSectionContentHash(options.clauses);
    db.prepare(
      `INSERT OR REPLACE INTO section(tsutatsu_id, chapter_number, section_number, title, url, fetched_at, content_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      tsutatsuId,
      options.chapterNumber,
      options.sectionNumber,
      options.sectionTitle,
      options.sectionUrl,
      options.fetchedAt,
      sectionContentHash
    );

    // clause は既存があれば DELETE → INSERT（重複防止 + 最新内容を反映）
    const deleteOldClause = db.prepare(
      `DELETE FROM clause WHERE tsutatsu_id = ? AND clause_number = ?`
    );
    const insertClause = db.prepare(
      `INSERT INTO clause(tsutatsu_id, clause_number, source_url, chapter_number, section_number, title, full_text, paragraphs_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    let count = 0;
    const tx = db.transaction(() => {
      for (const c of options.clauses) {
        deleteOldClause.run(tsutatsuId, c.clauseNumber);
        const normalizedTitle = normalizeJpText(c.title);
        const normalizedFullText = normalizeJpText(c.fullText);
        const normalizedParagraphs = c.paragraphs.map((p) => ({
          indent: p.indent,
          text: normalizeJpText(p.text),
        }));
        insertClause.run(
          tsutatsuId,
          c.clauseNumber,
          options.sectionUrl,
          options.chapterNumber,
          options.sectionNumber,
          normalizedTitle,
          normalizedFullText,
          JSON.stringify(normalizedParagraphs)
        );
        count++;
      }
    });
    tx();
    return count;
  } catch (err) {
    // best effort cache: 失敗してもユーザー側の応答は変えない
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('bulk-downloader', 'writeBackLiveSection 失敗（無視）', {
      formalName: options.formalName,
      sectionUrl: options.sectionUrl,
      error: msg,
    });
    return 0;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
