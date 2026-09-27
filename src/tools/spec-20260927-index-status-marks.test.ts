/**
 * 仕様差分 20260927-index-status-marks の受入テスト。
 *
 * 国税庁の索引から消えた文書（document.orphaned_at が入っている行）に付く印を、
 * 取得系 4 ツール（ADDED の仕様 ID）と検索系 4 ツール（SPEC-NTA-SEARCH-RULES-011）の
 * 応答として確かめる。国税庁サイトは fetchImpl の差し替えで代え、DB は一時ディレクトリに作る。
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { encode as iconvEncode } from 'iconv-lite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initSchema } from '../db/schema.js';
import {
  getQa,
  getTaxAnswer,
  handleNtaGetBunshokaitou,
  handleNtaGetJimuUnei,
  handleNtaGetKaiseiTsutatsu,
  handleNtaSearchBunshokaitou,
  handleNtaSearchKaiseiTsutatsu,
  handleNtaSearchQa,
  handleNtaSearchTaxAnswer,
} from './handlers.js';

const ORPHANED_AT = '2026-10-01T00:30:00Z';
const STATE_PREFIX = '索引の状態**: removed_from_index（';

const fixturesDir = resolve(import.meta.dirname, '..', '..', 'tests', 'fixtures');
const QA_FIXTURE = 'www.nta.go.jp_law_shitsugi_shohi_02_19.htm';
const TAX_ANSWER_FIXTURE = 'www.nta.go.jp_taxes_shiraberu_taxanswer_shohi_6101.htm';

function sjisHtmlResponse(fixtureName: string): Response {
  const html = readFileSync(resolve(fixturesDir, fixtureName), 'utf8');
  return new Response(iconvEncode(html, 'shift_jis'), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=Shift_JIS' },
  });
}

function fixtureFetch(fixtureName: string): typeof fetch {
  return vi.fn(async () => sjisHtmlResponse(fixtureName)) as unknown as typeof fetch;
}

/** 呼ばれたら必ず失敗する fetch。DB から返したことを確かめるために使う */
const failingFetch = vi.fn(async () => {
  throw new Error('国税庁サイトを取りに行ってはいけない');
}) as unknown as typeof fetch;

interface MarkedJson {
  index_status?: string;
  orphaned_at?: string;
  notice?: string;
  source?: string;
  document?: { docId?: string; orphanedAt?: string | null };
}

interface SearchResponse {
  results: Array<Record<string, unknown>>;
  search_notes?: string[];
}

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'houki-nta-spec-index-status-'));
  dbPath = join(dir, 'cache.db');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

type SeedRow = [
  docType: string,
  docId: string,
  taxonomy: string,
  title: string,
  body: string,
  orphanedAt: string | null,
];

function seed(rows: SeedRow[]): void {
  const db = new Database(dbPath);
  initSchema(db);
  const stmt = db.prepare(
    `INSERT INTO document(doc_type, doc_id, taxonomy, title, source_url, fetched_at, full_text, attached_pdfs_json, content_hash, orphaned_at)
     VALUES (?, ?, ?, ?, ?, '2026-09-07T00:00:00Z', ?, '[]', ?, ?)`
  );
  for (const [docType, docId, taxonomy, title, body, orphanedAt] of rows) {
    stmt.run(
      docType,
      docId,
      taxonomy,
      title,
      `https://example.com/${docType}/${docId}.htm`,
      body,
      `hash-${docType}-${docId}`,
      orphanedAt
    );
  }
  db.close();
}

/** DB に入っている全行へ orphaned_at を入れる（国税庁サイトから取って書き戻した 1 件だけの DB で使う） */
function markAllOrphaned(): void {
  const db = new Database(dbPath);
  db.prepare('UPDATE document SET orphaned_at = ?').run(ORPHANED_AT);
  db.close();
}

/**
 * DB の 1 件目を、doc_id と出典 URL を変えて複製し、複製の側だけを索引から消えた行にする。
 * 検索系で「索引にある文書」と「消えた文書」を 1 件ずつ用意するために使う。
 */
function duplicateAsOrphaned(marker: string): void {
  const db = new Database(dbPath);
  db.prepare(
    `INSERT INTO document(doc_type, doc_id, taxonomy, title, issued_at, issuer, source_url, fetched_at, full_text, attached_pdfs_json, content_hash, structured_json, orphaned_at)
     SELECT doc_type, doc_id || ?, taxonomy, title, issued_at, issuer, ?, fetched_at, full_text, attached_pdfs_json, content_hash, structured_json, ?
     FROM document ORDER BY id LIMIT 1`
  ).run(`-${marker}`, `https://example.com/${marker}.htm`, ORPHANED_AT);
  db.close();
}

/** 注記が SPEC に書かれた 4 つの趣旨を含むこと */
function expectNoticeContent(notice: string | undefined): void {
  expect(notice).toBeTypeOf('string');
  expect(notice).toContain('索引から外れ');
  expect(notice).toContain('過去の課税期間');
  expect(notice).toContain('最新の通達');
  expect(notice).toContain('404');
}

/** nta_get_jimu_unei（SPEC-NTA-GET-JIMU-UNEI-004）が返す注記。同じ文であることを比べるために使う */
async function jimuUneiNotice(): Promise<string | undefined> {
  const jdir = mkdtempSync(join(tmpdir(), 'houki-nta-spec-jimu-'));
  const jdbPath = join(jdir, 'cache.db');
  try {
    const db = new Database(jdbPath);
    initSchema(db);
    db.prepare(
      `INSERT INTO document(doc_type, doc_id, taxonomy, title, source_url, fetched_at, full_text, attached_pdfs_json, content_hash, orphaned_at)
       VALUES ('jimu-unei', 'J', 'shotoku', '消えた事務運営指針', 'https://example.com/j.htm', '2026-09-07T00:00:00Z', '本文', '[]', 'hash-j', ?)`
    ).run(ORPHANED_AT);
    db.close();
    const r = (await handleNtaGetJimuUnei(
      { docId: 'J', format: 'json' },
      { dbPath: jdbPath }
    )) as MarkedJson;
    return r.notice;
  } finally {
    rmSync(jdir, { recursive: true, force: true });
  }
}

/** markdown の「- **取得**」の次に索引の状態の行、空行、「> 」の注記が続くこと（改正通達・文書回答事例） */
function expectListStyleMark(md: string): void {
  const lines = md.split('\n');
  const fetchedIdx = lines.findIndex((l) => l.startsWith('- **取得**'));
  expect(fetchedIdx).toBeGreaterThanOrEqual(0);
  const stateLine = lines[fetchedIdx + 1] ?? '';
  expect(stateLine.startsWith(`- **${STATE_PREFIX}`)).toBe(true);
  expect(stateLine).toContain('2026-10-01');
  expect(stateLine.endsWith(' に確認）')).toBe(true);
  expect(lines[fetchedIdx + 2]).toBe('');
  expect(lines[fetchedIdx + 3]?.startsWith('> ')).toBe(true);
  expect(lines[fetchedIdx + 3]).toContain('索引から外れ');
}

function expectNoMarkInMarkdown(md: string): void {
  expect(md).not.toContain('索引の状態');
  expect(md).not.toContain('removed_from_index');
}

function expectNoMarkInJson(r: MarkedJson): void {
  expect(r.index_status).toBeUndefined();
  expect(r.orphaned_at).toBeUndefined();
  expect(r.notice).toBeUndefined();
}

/** 検索結果で「索引にある 1 件」と「消えた 1 件」を確かめる。消えた要素は marker を含む */
function expectSearchMarks(r: SearchResponse, orphanMarker: string): void {
  expect(r.results).toHaveLength(2);
  const removed = r.results.filter((x) => JSON.stringify(x).includes(orphanMarker));
  const current = r.results.filter((x) => !JSON.stringify(x).includes(orphanMarker));
  expect(removed).toHaveLength(1);
  expect(current).toHaveLength(1);

  expect(removed[0]?.index_status).toBe('removed_from_index');
  expect(removed[0]?.orphaned_at).toBe(ORPHANED_AT);
  expect(current[0]?.index_status).toBeUndefined();
  expect(current[0]?.orphaned_at).toBeUndefined();

  const note = r.search_notes?.find((n) => n.includes('2 件のうち 1 件'));
  expect(note).toBeDefined();
  expect(note).toContain('検索結果 2 件のうち 1 件は国税庁の索引から外れています');
  expect(note).toContain('removed_from_index');
  expect(note).toContain('過去の課税期間');
  expect(note).toContain('最新の通達');
  expect(note).toContain('404');
}

// ---------------------------------------------------------------------------
// ADDED: 取得系 4 ツール
// ---------------------------------------------------------------------------

describe('SPEC-NTA-GET-BUNSHOKAITOU-004 nta_get_bunshokaitou — 国税庁の索引から消えた文書に印を付ける', () => {
  beforeEach(() => {
    seed([
      [
        'bunshokaitou',
        'shotoku/250401',
        'shotoku',
        '索引にある文書回答事例',
        '配当の源泉徴収について',
        null,
      ],
      [
        'bunshokaitou',
        'shotoku/200401',
        'shotoku',
        '消えた文書回答事例',
        '配当の源泉徴収について',
        ORPHANED_AT,
      ],
    ]);
  });

  it('SPEC-NTA-GET-BUNSHOKAITOU-004 format=json に index_status / orphaned_at / notice が付き、document.orphanedAt にも同じ日時が入る', async () => {
    const r = (await handleNtaGetBunshokaitou(
      { docId: 'shotoku/200401', format: 'json' },
      { dbPath }
    )) as MarkedJson;
    expect(r.index_status).toBe('removed_from_index');
    expect(r.orphaned_at).toBe(ORPHANED_AT);
    expect(r.document?.orphanedAt).toBe(ORPHANED_AT);
    expectNoticeContent(r.notice);
  });

  it('SPEC-NTA-GET-BUNSHOKAITOU-004 注記の文は nta_get_jimu_unei と同じ', async () => {
    const r = (await handleNtaGetBunshokaitou(
      { docId: 'shotoku/200401', format: 'json' },
      { dbPath }
    )) as MarkedJson;
    expect(r.notice).toBe(await jimuUneiNotice());
  });

  it('SPEC-NTA-GET-BUNSHOKAITOU-004 format 省略（markdown）では「取得」の行の次に索引の状態の行、空行、「> 」の注記が入る', async () => {
    const r = (await handleNtaGetBunshokaitou({ docId: 'shotoku/200401' }, { dbPath })) as string;
    expect(typeof r).toBe('string');
    expectListStyleMark(r);
  });

  it('SPEC-NTA-GET-BUNSHOKAITOU-004 format=markdown でも同じ行が入る', async () => {
    const r = (await handleNtaGetBunshokaitou(
      { docId: 'shotoku/200401', format: 'markdown' },
      { dbPath }
    )) as string;
    expectListStyleMark(r);
  });

  it('SPEC-NTA-GET-BUNSHOKAITOU-004 索引にある文書には json・markdown とも何も付かない', async () => {
    const json = (await handleNtaGetBunshokaitou(
      { docId: 'shotoku/250401', format: 'json' },
      { dbPath }
    )) as MarkedJson;
    expectNoMarkInJson(json);
    const md = (await handleNtaGetBunshokaitou({ docId: 'shotoku/250401' }, { dbPath })) as string;
    expectNoMarkInMarkdown(md);
  });
});

describe('SPEC-NTA-GET-KAISEI-TSUTATSU-004 nta_get_kaisei_tsutatsu — 国税庁の索引から消えた文書に印を付ける', () => {
  beforeEach(() => {
    seed([
      ['kaisei', 'k-current', 'shohi', '索引にある改正通達', '消費税法基本通達の一部改正', null],
      ['kaisei', 'k-removed', 'shohi', '消えた改正通達', '消費税法基本通達の一部改正', ORPHANED_AT],
    ]);
  });

  it('SPEC-NTA-GET-KAISEI-TSUTATSU-004 format=json に index_status / orphaned_at / notice が付き、document.orphanedAt にも同じ日時が入る', async () => {
    const r = (await handleNtaGetKaiseiTsutatsu(
      { docId: 'k-removed', format: 'json' },
      { dbPath }
    )) as MarkedJson;
    expect(r.index_status).toBe('removed_from_index');
    expect(r.orphaned_at).toBe(ORPHANED_AT);
    expect(r.document?.orphanedAt).toBe(ORPHANED_AT);
    expectNoticeContent(r.notice);
  });

  it('SPEC-NTA-GET-KAISEI-TSUTATSU-004 注記の文は nta_get_jimu_unei と同じ', async () => {
    const r = (await handleNtaGetKaiseiTsutatsu(
      { docId: 'k-removed', format: 'json' },
      { dbPath }
    )) as MarkedJson;
    expect(r.notice).toBe(await jimuUneiNotice());
  });

  it('SPEC-NTA-GET-KAISEI-TSUTATSU-004 format 省略（markdown）では「取得」の行の次に索引の状態の行、空行、「> 」の注記が入る', async () => {
    const r = (await handleNtaGetKaiseiTsutatsu({ docId: 'k-removed' }, { dbPath })) as string;
    expect(typeof r).toBe('string');
    expectListStyleMark(r);
  });

  it('SPEC-NTA-GET-KAISEI-TSUTATSU-004 format=markdown でも同じ行が入る', async () => {
    const r = (await handleNtaGetKaiseiTsutatsu(
      { docId: 'k-removed', format: 'markdown' },
      { dbPath }
    )) as string;
    expectListStyleMark(r);
  });

  it('SPEC-NTA-GET-KAISEI-TSUTATSU-004 索引にある文書には json・markdown とも何も付かない', async () => {
    const json = (await handleNtaGetKaiseiTsutatsu(
      { docId: 'k-current', format: 'json' },
      { dbPath }
    )) as MarkedJson;
    expectNoMarkInJson(json);
    const md = (await handleNtaGetKaiseiTsutatsu({ docId: 'k-current' }, { dbPath })) as string;
    expectNoMarkInMarkdown(md);
  });
});

describe('SPEC-NTA-GET-QA-010 nta_get_qa — 国税庁の索引から消えた事例に印を付ける', () => {
  const args = { topic: 'shohi', category: '02', id: '19' } as const;

  it('SPEC-NTA-GET-QA-010 国税庁サイトから取った事例（source=live）と、索引にある DB の事例には何も付かない', async () => {
    const live = (await getQa(
      { ...args, format: 'json' },
      { fetchImpl: fixtureFetch(QA_FIXTURE), dbPath }
    )) as MarkedJson;
    expect(live.source).toBe('live');
    expectNoMarkInJson(live);

    const fromDb = (await getQa(
      { ...args, format: 'json' },
      { fetchImpl: failingFetch, dbPath }
    )) as MarkedJson;
    expect(fromDb.source).toBe('db');
    expectNoMarkInJson(fromDb);

    const md = (await getQa(args, { fetchImpl: failingFetch, dbPath })) as string;
    expectNoMarkInMarkdown(md);
  });

  it('SPEC-NTA-GET-QA-010 DB の事例が索引から外れていれば format=json に index_status / orphaned_at / notice が付く', async () => {
    await getQa({ ...args, format: 'json' }, { fetchImpl: fixtureFetch(QA_FIXTURE), dbPath });
    markAllOrphaned();

    const r = (await getQa(
      { ...args, format: 'json' },
      { fetchImpl: failingFetch, dbPath }
    )) as MarkedJson;
    expect(r.source).toBe('db');
    expect(r.index_status).toBe('removed_from_index');
    expect(r.orphaned_at).toBe(ORPHANED_AT);
    expectNoticeContent(r.notice);
    expect(r.notice).toBe(await jimuUneiNotice());
  });

  it('SPEC-NTA-GET-QA-010 markdown では「> 税目: … / カテゴリ: … / 事例番号: …」の行の後に索引の状態の行と「> 」の注記が入る', async () => {
    await getQa(args, { fetchImpl: fixtureFetch(QA_FIXTURE), dbPath });
    markAllOrphaned();

    const r = (await getQa(args, { fetchImpl: failingFetch, dbPath })) as string;
    expect(typeof r).toBe('string');
    const lines = r.split('\n');
    const metaIdx = lines.findIndex(
      (l) => l.startsWith('> 税目:') && l.includes('カテゴリ:') && l.includes('事例番号:')
    );
    const stateIdx = lines.findIndex((l) => l.startsWith(`> **${STATE_PREFIX}`));
    expect(metaIdx).toBeGreaterThanOrEqual(0);
    expect(stateIdx).toBeGreaterThan(metaIdx);
    expect(lines[stateIdx]).toContain('2026-10-01');
    expect(lines[stateIdx]?.endsWith(' に確認）')).toBe(true);
    const noteIdx = lines.findIndex(
      (l, i) => i > stateIdx && l.startsWith('> ') && l.includes('索引から外れ')
    );
    expect(noteIdx).toBeGreaterThan(stateIdx);
  });
});

describe('SPEC-NTA-GET-TAX-ANSWER-009 nta_get_tax_answer — 国税庁の索引から消えた記事に印を付ける', () => {
  it('SPEC-NTA-GET-TAX-ANSWER-009 国税庁サイトから取った記事（source=live）と、索引にある DB の記事には何も付かない', async () => {
    const live = (await getTaxAnswer(
      { no: '6101', format: 'json' },
      { fetchImpl: fixtureFetch(TAX_ANSWER_FIXTURE), dbPath }
    )) as MarkedJson;
    expect(live.source).toBe('live');
    expectNoMarkInJson(live);

    const fromDb = (await getTaxAnswer(
      { no: '6101', format: 'json' },
      { fetchImpl: failingFetch, dbPath }
    )) as MarkedJson;
    expect(fromDb.source).toBe('db');
    expectNoMarkInJson(fromDb);

    const md = (await getTaxAnswer({ no: '6101' }, { fetchImpl: failingFetch, dbPath })) as string;
    expectNoMarkInMarkdown(md);
  });

  it('SPEC-NTA-GET-TAX-ANSWER-009 DB の記事が索引から外れていれば format=json に index_status / orphaned_at / notice が付く', async () => {
    await getTaxAnswer(
      { no: '6101', format: 'json' },
      { fetchImpl: fixtureFetch(TAX_ANSWER_FIXTURE), dbPath }
    );
    markAllOrphaned();

    const r = (await getTaxAnswer(
      { no: '6101', format: 'json' },
      { fetchImpl: failingFetch, dbPath }
    )) as MarkedJson;
    expect(r.source).toBe('db');
    expect(r.index_status).toBe('removed_from_index');
    expect(r.orphaned_at).toBe(ORPHANED_AT);
    expectNoticeContent(r.notice);
    expect(r.notice).toBe(await jimuUneiNotice());
  });

  it('SPEC-NTA-GET-TAX-ANSWER-009 markdown では見出しの後、最初の「## 」の節の前に索引の状態の行と「> 」の注記が入る', async () => {
    await getTaxAnswer({ no: '6101' }, { fetchImpl: fixtureFetch(TAX_ANSWER_FIXTURE), dbPath });
    markAllOrphaned();

    const r = (await getTaxAnswer({ no: '6101' }, { fetchImpl: failingFetch, dbPath })) as string;
    expect(typeof r).toBe('string');
    const lines = r.split('\n');
    const headingIdx = lines.findIndex((l) => l.startsWith('# No.6101'));
    const stateIdx = lines.findIndex((l) => l.startsWith(`> **${STATE_PREFIX}`));
    const firstSectionIdx = lines.findIndex((l) => l.startsWith('## '));
    expect(headingIdx).toBeGreaterThanOrEqual(0);
    expect(stateIdx).toBeGreaterThan(headingIdx);
    expect(firstSectionIdx).toBeGreaterThan(stateIdx);
    expect(lines[stateIdx]).toContain('2026-10-01');
    expect(lines[stateIdx]?.endsWith(' に確認）')).toBe(true);
    for (const l of lines.slice(headingIdx + 1, stateIdx)) {
      // 見出しと状態の行の間にあってよいのは、空行と「> 法令時点:」「> 対象税目:」の行だけ
      expect(l === '' || l.startsWith('> 法令時点:') || l.startsWith('> 対象税目:')).toBe(true);
    }
    const noteIdx = lines.findIndex(
      (l, i) => i > stateIdx && l.startsWith('> ') && l.includes('索引から外れ')
    );
    expect(noteIdx).toBeGreaterThan(stateIdx);
    expect(noteIdx).toBeLessThan(firstSectionIdx);
  });
});

// ---------------------------------------------------------------------------
// 既存の仕様 ID で受ける項目: 検索系 4 ツール
// ---------------------------------------------------------------------------

describe('SPEC-NTA-SEARCH-RULES-011 検索系 4 ツールの応答 — 索引から消えた文書も返し、印と件数の文を付ける', () => {
  it('SPEC-NTA-SEARCH-RULES-011 nta_search_bunshokaitou の応答: 両方返り、消えた文書だけに印、search_notes に件数の文', async () => {
    seed([
      [
        'bunshokaitou',
        'shotoku/250401',
        'shotoku',
        '現行の回答',
        '外国法人から受ける配当の取扱い',
        null,
      ],
      [
        'bunshokaitou',
        'shotoku/orphan-b',
        'shotoku',
        '消えた回答',
        '外国法人から受ける配当の取扱い',
        ORPHANED_AT,
      ],
    ]);
    const r = (await handleNtaSearchBunshokaitou(
      { keyword: '外国法人' },
      { dbPath }
    )) as SearchResponse;
    expectSearchMarks(r, 'orphan-b');
  });

  it('SPEC-NTA-SEARCH-RULES-011 nta_search_kaisei_tsutatsu の応答: 両方返り、消えた文書だけに印、search_notes に件数の文', async () => {
    seed([
      ['kaisei', 'k-current', 'shohi', '現行の改正通達', '適格請求書の記載事項を改める', null],
      [
        'kaisei',
        'orphan-k',
        'shohi',
        '消えた改正通達',
        '適格請求書の記載事項を改める',
        ORPHANED_AT,
      ],
    ]);
    const r = (await handleNtaSearchKaiseiTsutatsu(
      { keyword: '適格請求書' },
      { dbPath }
    )) as SearchResponse;
    expectSearchMarks(r, 'orphan-k');
  });

  it('SPEC-NTA-SEARCH-RULES-011 nta_search_qa の応答: 両方返り、消えた事例だけに印、search_notes に件数の文', async () => {
    await getQa(
      { topic: 'shohi', category: '02', id: '19', format: 'json' },
      { fetchImpl: fixtureFetch(QA_FIXTURE), dbPath }
    );
    duplicateAsOrphaned('orphan-q');
    const r = (await handleNtaSearchQa({ keyword: 'ゴルフ会員権' }, { dbPath })) as SearchResponse;
    expectSearchMarks(r, 'orphan-q');
  });

  it('SPEC-NTA-SEARCH-RULES-011 nta_search_tax_answer の応答: 両方返り、消えた記事だけに印、search_notes に件数の文', async () => {
    seed([
      [
        'tax-answer',
        '6101',
        'shohi',
        '消費税のしくみ',
        '消費税は消費に広く公平に負担を求める税',
        null,
      ],
      [
        'tax-answer',
        '9999',
        'shohi',
        '消えた記事 orphan-t',
        '消費税は消費に広く公平に負担を求める税',
        ORPHANED_AT,
      ],
    ]);
    const r = (await handleNtaSearchTaxAnswer(
      { keyword: '公平に負担' },
      { dbPath }
    )) as SearchResponse;
    expectSearchMarks(r, 'orphan-t');
  });
});
