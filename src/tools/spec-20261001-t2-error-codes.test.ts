/**
 * 差分 specs/changes/20261001-t2-error-codes/（PR #118）の受入テスト。
 *
 * - SPEC-NTA-COMMON-ERRORS-016: SOURCE_API_ERROR は通信の失敗だけ、*_NOT_FOUND は問い合わせが成功して無いときだけ
 * - SPEC-NTA-COMMON-ERRORS-017: DB の取得時点（fetched_at）を読めないときは INTERNAL_ERROR（retryable: false）
 * - SPEC-NTA-GET-QA-014・015、SPEC-NTA-GET-TAX-ANSWER-013・014: 国税庁サイトの 404・410・404 ページへの転送と、通信の失敗
 * - SPEC-NTA-GET-JIMU-UNEI-001・002、SPEC-NTA-GET-KAISEI-TSUTATSU-001・002（MODIFIED）: code は DOC_NOT_FOUND
 *
 * 国税庁サイトは fetchImpl の差し替えで代える。5xx と接続の失敗は取得を取り直すので（最大 4 回、合わせて 7 秒）、
 * そのテストは時間の上限を 30 秒にしている。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withTaxAnswerIndex } from '../../tests/support/tax-answer-index.js';
import { initSchema } from '../db/schema.js';
import {
  getQa,
  getTaxAnswer,
  handleNtaGetJimuUnei,
  handleNtaGetKaiseiTsutatsu,
  handleNtaSearchBunshokaitou,
  handleNtaSearchJimuUnei,
  handleNtaSearchKaiseiTsutatsu,
  handleNtaSearchQa,
  handleNtaSearchTaxAnswer,
  searchTsutatsu,
} from './handlers.js';

interface Body {
  error?: string;
  code?: string;
  tool?: string;
  hint?: string;
  retryable?: boolean;
  next_actions?: Array<{ action: string; reason?: string; example?: Record<string, unknown> }>;
  detail?: { status?: number; url?: string; cause?: string };
  available_doc_ids?: unknown[];
  results?: unknown[];
  hits?: unknown[];
}

const NTA_ORIGIN = 'https://www.nta.go.jp';
const QA_URL = `${NTA_ORIGIN}/law/shitsugi/shohi/99/99.htm`;
const TAX_ANSWER_6101_URL = `${NTA_ORIGIN}/taxes/shiraberu/taxanswer/shohi/6101.htm`;

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'houki-nta-t2-'));
  dbPath = join(dir, 'cache.db');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 決まった HTTP ステータスを返す fetch */
function statusFetch(status: number): typeof fetch {
  return vi.fn(
    async () => new Response('error', { status, statusText: `status ${status}` })
  ) as unknown as typeof fetch;
}

/** 存在しないページの応答。国税庁サイトは 302 で /error/404.htm に転送し、転送先は 200 を返す */
function soft404Fetch(): typeof fetch {
  return vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    const errorPageUrl = `${NTA_ORIGIN}/error/404.htm`;
    if (init?.redirect === 'manual') {
      return new Response(null, { status: 302, headers: { Location: errorPageUrl } });
    }
    const res = new Response('<html><body><p>ページが見つかりません</p></body></html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=UTF-8' },
    });
    Object.defineProperty(res, 'url', { value: errorPageUrl });
    Object.defineProperty(res, 'redirected', { value: true });
    return res;
  }) as unknown as typeof fetch;
}

/** 接続できない fetch */
function networkErrorFetch(): typeof fetch {
  return vi.fn(async () => {
    throw new TypeError('fetch failed');
  }) as unknown as typeof fetch;
}

/* -------------------------------------------------------------------------- */
/* nta_get_qa / nta_get_tax_answer                                             */
/* -------------------------------------------------------------------------- */

const NOT_FOUND_CASES: Array<[label: string, make: () => typeof fetch, status: number]> = [
  ['HTTP 404', () => statusFetch(404), 404],
  ['HTTP 410', () => statusFetch(410), 410],
  ['/error/404.htm への転送', soft404Fetch, 404],
];

describe('SPEC-NTA-GET-QA-014 国税庁サイトにページが無い（404・410・404 ページへの転送）ときは DOC_NOT_FOUND を返し、検索ツールを案内する', () => {
  for (const [label, make, status] of NOT_FOUND_CASES) {
    it(`SPEC-NTA-GET-QA-014 ${label} は DOC_NOT_FOUND・retryable: false・next_actions は nta_search_qa（retry_later を入れない）`, async () => {
      const body = (await getQa(
        { topic: 'shohi', category: '99', id: '99' },
        { fetchImpl: make(), dbPath }
      )) as Body;
      expect(body.code).toBe('DOC_NOT_FOUND');
      expect(body.retryable).toBe(false);
      expect(body.tool).toBe('nta_get_qa');
      expect(body.error).toContain('shohi');
      expect(body.error).toContain('99');
      expect(body.hint).toContain('nta_search_qa');
      expect(body.next_actions).toEqual([
        {
          action: 'nta_search_qa',
          reason: 'キーワード検索で正しい番号を探せます',
          example: { topic: 'shohi', keyword: '<探したい語>' },
        },
      ]);
      expect(body.detail?.status).toBe(status);
      expect(body.detail?.url).toBe(QA_URL);
    });
  }
});

describe('SPEC-NTA-GET-QA-015 国税庁サイトとの通信が失敗したときは、失敗の種類ごとの SOURCE_* を返す', () => {
  it('SPEC-NTA-GET-QA-015 HTTP 503 は SOURCE_API_ERROR・retryable: true・detail.status: 503・retry_later', async () => {
    const body = (await getQa(
      { topic: 'shohi', category: '02', id: '19' },
      { fetchImpl: statusFetch(503), dbPath }
    )) as Body;
    expect(body.code).toBe('SOURCE_API_ERROR');
    expect(body.retryable).toBe(true);
    expect(body.tool).toBe('nta_get_qa');
    expect(body.detail?.status).toBe(503);
    expect(body.detail?.url).toBe(`${NTA_ORIGIN}/law/shitsugi/shohi/02/19.htm`);
    expect(body.next_actions?.map((a) => a.action)).toEqual(['retry_later']);
  }, 30_000);

  // 差分 20261003-source-paths（#120）で 429 は SOURCE_RATE_LIMITED に分けた
  it('SPEC-NTA-GET-QA-015 SPEC-NTA-COMMON-ERRORS-018 HTTP 429 は SOURCE_RATE_LIMITED・retryable: true（v0.23.0 では SOURCE_API_ERROR）', async () => {
    const body = (await getQa(
      { topic: 'shohi', category: '02', id: '19' },
      { fetchImpl: statusFetch(429), dbPath }
    )) as Body;
    expect(body.code).toBe('SOURCE_RATE_LIMITED');
    expect(body.retryable).toBe(true);
    expect(body.detail?.status).toBe(429);
  });

  it('SPEC-NTA-GET-QA-015 接続できないときは detail.status が無く retryable: true', async () => {
    const body = (await getQa(
      { topic: 'shohi', category: '02', id: '19' },
      { fetchImpl: networkErrorFetch(), dbPath }
    )) as Body;
    expect(body.code).toBe('SOURCE_API_ERROR');
    expect(body.retryable).toBe(true);
    expect(body.tool).toBe('nta_get_qa');
    expect(body.detail?.status).toBeUndefined();
  }, 30_000);
});

// 差分 20261003-source-paths（#128）: 記事の URL は国税庁の索引で決める。索引にある番号（6101）の記事のページが無いときを確かめる
// （索引に無い番号は記事を取りに行かずに DOC_NOT_FOUND。src/tools/spec-20261003-source-paths.test.ts）
describe('SPEC-NTA-GET-TAX-ANSWER-013 索引に番号が無いとき、または国税庁サイトにページが無い（404・410・404 ページへの転送）ときは DOC_NOT_FOUND を返し、検索ツールを案内する', () => {
  for (const [label, make, status] of NOT_FOUND_CASES) {
    it(`SPEC-NTA-GET-TAX-ANSWER-013 索引にある番号の記事のページが ${label} なら DOC_NOT_FOUND・retryable: false・next_actions は nta_search_tax_answer`, async () => {
      const body = (await getTaxAnswer(
        { no: '6101' },
        { fetchImpl: withTaxAnswerIndex(make()), dbPath }
      )) as Body;
      expect(body.code).toBe('DOC_NOT_FOUND');
      expect(body.retryable).toBe(false);
      expect(body.tool).toBe('nta_get_tax_answer');
      expect(body.error).toContain('6101');
      expect(body.hint).toContain('nta_search_tax_answer');
      expect(body.next_actions).toEqual([
        {
          action: 'nta_search_tax_answer',
          reason: 'キーワード検索で正しい番号を探せます',
          example: { keyword: '<探したい語>' },
        },
      ]);
      expect(body.detail?.status).toBe(status);
      expect(body.detail?.url).toBe(TAX_ANSWER_6101_URL);
    });
  }
});

describe('SPEC-NTA-GET-TAX-ANSWER-014 国税庁サイトとの通信が失敗したときは、失敗の種類ごとの SOURCE_* を返す', () => {
  it('SPEC-NTA-GET-TAX-ANSWER-014 HTTP 503 は SOURCE_API_ERROR・retryable: true・detail.status: 503', async () => {
    const body = (await getTaxAnswer(
      { no: '6101' },
      { fetchImpl: withTaxAnswerIndex(statusFetch(503)), dbPath }
    )) as Body;
    expect(body.code).toBe('SOURCE_API_ERROR');
    expect(body.retryable).toBe(true);
    expect(body.tool).toBe('nta_get_tax_answer');
    expect(body.detail?.status).toBe(503);
    expect(body.next_actions?.map((a) => a.action)).toEqual(['retry_later']);
  }, 30_000);

  it('SPEC-NTA-GET-TAX-ANSWER-014 接続できないときは detail.status が無く retryable: true', async () => {
    const body = (await getTaxAnswer(
      { no: '6101' },
      { fetchImpl: withTaxAnswerIndex(networkErrorFetch()), dbPath }
    )) as Body;
    expect(body.code).toBe('SOURCE_API_ERROR');
    expect(body.retryable).toBe(true);
    expect(body.detail?.status).toBeUndefined();
  }, 30_000);
});

/* -------------------------------------------------------------------------- */
/* 文書系 3 ツールの code                                                       */
/* -------------------------------------------------------------------------- */

function seedDocuments(rows: Array<[docType: string, docId: string, fetchedAt: string]>): void {
  const db = new Database(dbPath);
  initSchema(db);
  const stmt = db.prepare(
    `INSERT INTO document(doc_type, doc_id, taxonomy, title, source_url, fetched_at, full_text, attached_pdfs_json, content_hash)
     VALUES (?, ?, 'shohi', ?, ?, ?, ?, '[]', NULL)`
  );
  for (const [docType, docId, fetchedAt] of rows) {
    stmt.run(
      docType,
      docId,
      `題名 ${docId}`,
      `${NTA_ORIGIN}/${docType}/${docId}.htm`,
      fetchedAt,
      '軽減税率の取扱いについての本文'
    );
  }
  db.close();
}

describe('SPEC-NTA-GET-JIMU-UNEI-001 事務運営指針が DB に 1 件も無いときは投入を案内する', () => {
  it('SPEC-NTA-GET-JIMU-UNEI-001 code は DOC_NOT_FOUND（v0.21.3 は TSUTATSU_NOT_FOUND）、next_actions は --bulk-download-jimu-unei', async () => {
    const body = (await handleNtaGetJimuUnei(
      { docId: 'shotoku/shinkoku/170331' },
      { dbPath }
    )) as Body;
    expect(body.code).toBe('DOC_NOT_FOUND');
    expect(body.tool).toBe('nta_get_jimu_unei');
    expect(body.error).toBe(
      'ローカル DB に事務運営指針が 1 件も無いため、docId="shotoku/shinkoku/170331" を取得できません'
    );
    expect(body.available_doc_ids).toBeUndefined();
    expect(body.next_actions?.[0]?.example).toEqual({
      command: 'houki-nta-mcp --bulk-download-jimu-unei',
    });
  });
});

describe('SPEC-NTA-GET-JIMU-UNEI-002 事務運営指針はあるが docId が無いときは「見つかりません」と候補を返す', () => {
  it('SPEC-NTA-GET-JIMU-UNEI-002 code は DOC_NOT_FOUND、available_doc_ids と nta_search_jimu_unei の案内は変えない', async () => {
    seedDocuments([['jimu-unei', 'shotoku/shinkoku/170331', new Date().toISOString()]]);
    const body = (await handleNtaGetJimuUnei({ docId: 'sozoku/170111_1' }, { dbPath })) as Body;
    expect(body.code).toBe('DOC_NOT_FOUND');
    expect(body.error).toBe('事務運営指針 docId="sozoku/170111_1" は見つかりません');
    expect(body.available_doc_ids).toHaveLength(1);
    expect(body.next_actions).toEqual([
      { action: 'nta_search_jimu_unei', reason: 'キーワード検索で正しい docId を探せます' },
    ]);
  });
});

describe('SPEC-NTA-GET-KAISEI-TSUTATSU-001 ローカル DB に改正通達が 1 件も無いときは投入を案内する', () => {
  it('SPEC-NTA-GET-KAISEI-TSUTATSU-001 code は DOC_NOT_FOUND（v0.21.3 は TSUTATSU_NOT_FOUND）、next_actions は --bulk-download-kaisei', async () => {
    seedDocuments([['qa-jirei', 'shohi/02/19', new Date().toISOString()]]);
    const body = (await handleNtaGetKaiseiTsutatsu({ docId: '0026003-067' }, { dbPath })) as Body;
    expect(body.code).toBe('DOC_NOT_FOUND');
    expect(body.tool).toBe('nta_get_kaisei_tsutatsu');
    expect(body.error).toBe(
      'ローカル DB に改正通達が 1 件も無いため、docId="0026003-067" を取得できません'
    );
    expect(body.next_actions?.[0]?.example).toEqual({
      command: 'houki-nta-mcp --bulk-download-kaisei',
    });
  });
});

describe('SPEC-NTA-GET-KAISEI-TSUTATSU-002 改正通達はあるが docId が無いときは「見つかりません」と候補を返す', () => {
  it('SPEC-NTA-GET-KAISEI-TSUTATSU-002 code は DOC_NOT_FOUND、形は正しいが DB に無い "abc" も同じ', async () => {
    seedDocuments([['kaisei', '0026003-067', new Date().toISOString()]]);
    for (const docId of ['0026003-999', 'abc']) {
      const body = (await handleNtaGetKaiseiTsutatsu({ docId }, { dbPath })) as Body;
      expect(body.code, docId).toBe('DOC_NOT_FOUND');
      expect(body.error).toBe(`改正通達 docId="${docId}" は見つかりません`);
      expect(body.next_actions).toEqual([
        { action: 'nta_search_kaisei_tsutatsu', reason: 'キーワード検索で正しい docId を探せます' },
      ]);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-COMMON-ERRORS-016                                                  */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-COMMON-ERRORS-016 SOURCE_API_ERROR は国税庁サイトとの通信が失敗したときだけ返し、*_NOT_FOUND は問い合わせが成功して求めたものが無かったときだけ返す', () => {
  // 差分 20261003-source-paths（#128）: 6999 は国税庁の索引に無いので、記事を取りに行かずに DOC_NOT_FOUND
  it('SPEC-NTA-COMMON-ERRORS-016 nta_get_tax_answer の { no: "6999" } は、DB にも国税庁の索引にも無いので DOC_NOT_FOUND・retryable: false', async () => {
    const body = (await getTaxAnswer(
      { no: '6999' },
      { fetchImpl: withTaxAnswerIndex(soft404Fetch()), dbPath }
    )) as Body;
    expect(body.code).toBe('DOC_NOT_FOUND');
    expect(body.retryable).toBe(false);
    expect(body.next_actions?.some((a) => a.action === 'retry_later')).toBe(false);
  });

  it('SPEC-NTA-COMMON-ERRORS-016 索引にある番号（6101）で記事のページが 503 なら SOURCE_API_ERROR・retryable: true', async () => {
    const body = (await getTaxAnswer(
      { no: '6101' },
      { fetchImpl: withTaxAnswerIndex(statusFetch(503)), dbPath }
    )) as Body;
    expect(body.code).toBe('SOURCE_API_ERROR');
    expect(body.retryable).toBe(true);
  }, 30_000);

  it('SPEC-NTA-COMMON-ERRORS-016 nta_get_jimu_unei に DB に無い docId を渡すと DOC_NOT_FOUND', async () => {
    seedDocuments([['jimu-unei', 'shotoku/shinkoku/170331', new Date().toISOString()]]);
    const body = (await handleNtaGetJimuUnei({ docId: 'hojin/000703-3' }, { dbPath })) as Body;
    expect(body.code).toBe('DOC_NOT_FOUND');
  });
});

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-COMMON-ERRORS-017                                                  */
/* -------------------------------------------------------------------------- */

type SearchCall = () => Promise<unknown>;

const FRESHNESS_CASES: Array<[tool: string, docType: string, flag: string, run: SearchCall]> = [
  [
    'nta_search_qa',
    'qa-jirei',
    '--bulk-download-qa',
    () => handleNtaSearchQa({ keyword: '軽減税率' }, { dbPath }),
  ],
  [
    'nta_search_tax_answer',
    'tax-answer',
    '--bulk-download-tax-answer',
    () => handleNtaSearchTaxAnswer({ keyword: '軽減税率' }, { dbPath }),
  ],
  [
    'nta_search_kaisei_tsutatsu',
    'kaisei',
    '--bulk-download-kaisei',
    () => handleNtaSearchKaiseiTsutatsu({ keyword: '軽減税率' }, { dbPath }),
  ],
  [
    'nta_search_jimu_unei',
    'jimu-unei',
    '--bulk-download-jimu-unei',
    () => handleNtaSearchJimuUnei({ keyword: '軽減税率' }, { dbPath }),
  ],
  [
    'nta_search_bunshokaitou',
    'bunshokaitou',
    '--bulk-download-bunshokaitou',
    () => handleNtaSearchBunshokaitou({ keyword: '軽減税率' }, { dbPath }),
  ],
];

function docIdFor(docType: string): string {
  if (docType === 'qa-jirei') return 'shohi/02/19';
  if (docType === 'tax-answer') return '6101';
  if (docType === 'kaisei') return '0026003-067';
  if (docType === 'jimu-unei') return 'shotoku/shinkoku/170331';
  return 'shotoku/250416';
}

function expectUnreadableFetchedAt(body: Body, tool: string, value: string, flag: string): void {
  expect(body.code).toBe('INTERNAL_ERROR');
  expect(body.retryable).toBe(false);
  expect(body.tool).toBe(tool);
  expect(body.error).toBe(`取得時点を読めません: ${value}`);
  expect(body.hint).toContain(flag);
  expect(body.next_actions).toHaveLength(1);
  expect(body.next_actions?.[0]?.action).toBe('cli_bulk_download');
  expect(body.next_actions?.[0]?.example).toEqual({ command: `houki-nta-mcp ${flag}` });
  expect(typeof body.detail?.cause).toBe('string');
  expect(body.results).toBeUndefined();
  expect(body.hits).toBeUndefined();
}

describe('SPEC-NTA-COMMON-ERRORS-017 DB の取得時点を解釈できないときは INTERNAL_ERROR（retryable: false）にし、その種別の投入をやり直す案内を付ける', () => {
  for (const [tool, docType, flag, run] of FRESHNESS_CASES) {
    for (const value of ['2026/05/08', '2026-02-30', '']) {
      it(`SPEC-NTA-COMMON-ERRORS-017 ${tool}: fetched_at が ${JSON.stringify(value)} の DB では INTERNAL_ERROR と ${flag} の案内`, async () => {
        seedDocuments([[docType, docIdFor(docType), value]]);
        expectUnreadableFetchedAt((await run()) as Body, tool, value, flag);
      });
    }
  }

  it('SPEC-NTA-COMMON-ERRORS-017 nta_search_tsutatsu: section.fetched_at が "2026/05/08" の DB では INTERNAL_ERROR と --bulk-download-all の案内', async () => {
    const db = new Database(dbPath);
    initSchema(db);
    db.prepare(
      `INSERT INTO tsutatsu(id, formal_name, abbr, source_root_url) VALUES (1, '消費税法基本通達', '消基通', '${NTA_ORIGIN}/law/tsutatsu/kihon/shohi/')`
    ).run();
    db.prepare(`INSERT INTO chapter(tsutatsu_id, number, title) VALUES (1, 5, '課税範囲')`).run();
    db.prepare(
      `INSERT INTO section(tsutatsu_id, chapter_number, section_number, title, url, fetched_at) VALUES (1, 5, 1, '通則', ?, '2026/05/08')`
    ).run(`${NTA_ORIGIN}/law/tsutatsu/kihon/shohi/05/01.htm`);
    db.prepare(
      `INSERT INTO clause(tsutatsu_id, clause_number, source_url, chapter_number, section_number, title, full_text, paragraphs_json)
       VALUES (1, '5-1-9', ?, 5, 1, '軽減税率の適用', '軽減税率の取扱いについての本文', '[]')`
    ).run(`${NTA_ORIGIN}/law/tsutatsu/kihon/shohi/05/01.htm`);
    db.close();
    const body = (await searchTsutatsu({ keyword: '軽減税率' }, { dbPath })) as Body;
    expectUnreadableFetchedAt(body, 'nta_search_tsutatsu', '2026/05/08', '--bulk-download-all');
  });

  it('SPEC-NTA-COMMON-ERRORS-017 取り込みが書く形（new Date().toISOString()）の DB ではこのエラーにならない', async () => {
    seedDocuments([['qa-jirei', 'shohi/02/19', '2026-10-01T00:30:00.000Z']]);
    const body = (await handleNtaSearchQa({ keyword: '軽減税率' }, { dbPath })) as Body;
    expect(body.code).toBeUndefined();
    expect(body.results).toHaveLength(1);
  });
});
