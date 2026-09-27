/**
 * 差分 specs/changes/20260927-fetch-paths/ の受入テスト
 *
 * DB から返すか国税庁サイトから取るかの分かれ目を、仕様 ID 付きで固定する。
 *   - ADDED: SPEC-NTA-GET-QA-012 / SPEC-NTA-GET-TAX-ANSWER-010（構造を持たない行は取り直す）
 *   - 既存の ID で受ける項目:
 *     SPEC-NTA-GET-TAX-ANSWER-004（bulk download で入れた行を DB から返す）
 *     SPEC-NTA-GET-TSUTATSU-006（書き戻した条項は 2 回目に DB から返す）
 *     SPEC-NTA-GET-TSUTATSU-005（4 通達以外は DB に無い条項を取りに行かない）
 *     SPEC-NTA-GET-TSUTATSU-008（目次から候補ページを決められないときの INVALID_ARGUMENT）
 *     SPEC-NTA-GET-TSUTATSU-014（その呼び出しで目次を取得したときは取り直さない）
 *
 * 国税庁サイトは fetchImpl で差し替える。DB は一時ディレクトリに作る。
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { resolveAbbreviation } from '@shuji-bonji/houki-abbreviations';
import Database from 'better-sqlite3';
import { encode as iconvEncode } from 'iconv-lite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initSchema } from '../db/schema.js';
import { writeBackLiveSection } from '../services/bulk-downloader.js';
import { bulkDownloadTaxAnswer } from '../services/tax-answer-bulk-downloader.js';
import { getQa, getTaxAnswer, getTsutatsu } from './handlers.js';

const fixturesDir = resolve(import.meta.dirname, '..', '..', 'tests', 'fixtures');
const NTA_ORIGIN = 'https://www.nta.go.jp';
const KIHON = '/law/tsutatsu/kihon';

function readFixture(fileName: string): string {
  return readFileSync(resolve(fixturesDir, fileName), 'utf8');
}

/** fixture は UTF-8 で保存しているので、国税庁サイトと同じ Shift_JIS にして返す */
function sjisHtmlResponse(html: string, headers: Record<string, string> = {}): Response {
  return new Response(iconvEncode(html, 'shift_jis'), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=Shift_JIS', ...headers },
  });
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function requestHeaders(input: string | URL | Request, init?: RequestInit): Headers {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, key) => {
    headers.set(key, value);
  });
  return headers;
}

/** 呼ばれたら必ず失敗する fetch。国税庁サイトに取りに行かないことを確かめるために使う */
function fetchMustNotBeCalled(): typeof fetch {
  return vi.fn(async () => {
    throw new Error('国税庁サイトを取りに行ってはいけない');
  }) as unknown as typeof fetch;
}

function callCount(fn: typeof fetch): number {
  return (fn as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
}

/** 1 つの fixture を毎回返す fetch */
function fixtureFetch(fileName: string): typeof fetch {
  return vi.fn(async () => sjisHtmlResponse(readFixture(fileName))) as unknown as typeof fetch;
}

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'houki-nta-spec-20260927-fetch-paths-'));
  dbPath = join(dir, 'cache.db');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** DB の文書の行を直接書き換える（構造の記録を古い形・壊れた形にする） */
function setStructuredJson(value: string | null): number {
  const db = new Database(dbPath);
  try {
    return db.prepare('UPDATE document SET structured_json = ?').run(value).changes;
  } finally {
    db.close();
  }
}

/* -------------------------------------------------------------------------- */
/* nta_get_qa                                                                 */
/* -------------------------------------------------------------------------- */

const QA_FIXTURE = 'www.nta.go.jp_law_shitsugi_shohi_02_19.htm';
const QA_ARGS = { topic: 'shohi', category: '02', id: '19', format: 'json' } as const;

type QaJson = {
  source?: string;
  qa?: { title: string; question: string[]; answer: string[] };
};

describe('nta_get_qa — SPEC-NTA-GET-QA-012 段落の構造を持たない DB の行は、国税庁サイトから取り直す', () => {
  const variants: Array<{ title: string; structured: string | null }> = [
    { title: '段落の構造を持たない行（v0.16.0 より前に入れた行）', structured: null },
    { title: '構造の記録が読めない行', structured: '{壊れた JSON' },
  ];

  for (const v of variants) {
    it(`SPEC-NTA-GET-QA-012 ${v.title}は DB から返さず国税庁サイトから取り（source=live）、書き戻して次から DB から返す`, async () => {
      // 準備: 1 回取って DB に行を作り、構造の記録を古い形に書き換える
      await getQa(QA_ARGS, { fetchImpl: fixtureFetch(QA_FIXTURE), dbPath });
      expect(setStructuredJson(v.structured)).toBeGreaterThan(0);

      const fetchImpl = fixtureFetch(QA_FIXTURE);
      const r = (await getQa(QA_ARGS, { fetchImpl, dbPath })) as QaJson;

      expect(r.source).toBe('live');
      expect(callCount(fetchImpl)).toBeGreaterThan(0);
      expect(r.qa?.title).toContain('ゴルフ会員権');
      expect(r.qa?.question.length).toBeGreaterThan(0);
      expect(r.qa?.answer.length).toBeGreaterThan(0);

      // SPEC-NTA-GET-QA-006 のとおり書き戻され、次の呼び出しは DB から返す
      const again = (await getQa(QA_ARGS, {
        fetchImpl: fetchMustNotBeCalled(),
        dbPath,
      })) as QaJson;
      expect(again.source).toBe('db');
      expect(again.qa?.question.length).toBeGreaterThan(0);
      expect(again.qa?.answer.length).toBeGreaterThan(0);
    });
  }
});

/* -------------------------------------------------------------------------- */
/* nta_get_tax_answer                                                         */
/* -------------------------------------------------------------------------- */

const TAX_ANSWER_FIXTURE = 'www.nta.go.jp_taxes_shiraberu_taxanswer_shohi_6101.htm';

type TaxAnswerJson = {
  source?: string;
  taxAnswer?: { no: string; title: string; sections: unknown[]; fetchedAt: string };
};

describe('nta_get_tax_answer — SPEC-NTA-GET-TAX-ANSWER-010 節の構造を持たない DB の行は、国税庁サイトから取り直す', () => {
  const variants: Array<{ title: string; structured: string | null }> = [
    { title: '節の構造を持たない行（v0.16.0 より前に入れた行）', structured: null },
    { title: '構造の記録が読めない行', structured: '{壊れた JSON' },
  ];

  for (const v of variants) {
    it(`SPEC-NTA-GET-TAX-ANSWER-010 ${v.title}は DB から返さず国税庁サイトから取り（source=live）、書き戻して次から DB から返す`, async () => {
      await getTaxAnswer(
        { no: '6101', format: 'json' },
        { fetchImpl: fixtureFetch(TAX_ANSWER_FIXTURE), dbPath }
      );
      expect(setStructuredJson(v.structured)).toBeGreaterThan(0);

      const fetchImpl = fixtureFetch(TAX_ANSWER_FIXTURE);
      const r = (await getTaxAnswer(
        { no: '6101', format: 'json' },
        { fetchImpl, dbPath }
      )) as TaxAnswerJson;

      expect(r.source).toBe('live');
      expect(callCount(fetchImpl)).toBeGreaterThan(0);
      expect(r.taxAnswer?.no).toBe('6101');
      expect(r.taxAnswer?.sections.length).toBeGreaterThan(0);

      const again = (await getTaxAnswer(
        { no: '6101', format: 'json' },
        { fetchImpl: fetchMustNotBeCalled(), dbPath }
      )) as TaxAnswerJson;
      expect(again.source).toBe('db');
      expect(again.taxAnswer?.sections.length).toBe(r.taxAnswer?.sections.length);
    });
  }
});

describe('nta_get_tax_answer — SPEC-NTA-GET-TAX-ANSWER-004 bulk download で入れた記事を DB から返す', () => {
  it('SPEC-NTA-GET-TAX-ANSWER-004 nta_get_tax_answer の応答: --bulk-download-tax-answer と同じ形で入れた行（構造を持つ行）を、国税庁サイトに取りに行かずに source=db で返す', async () => {
    // 準備: bulk download（索引 → 個別ページ）を fetchImpl の差し替えで実行して行を入れる
    // 索引は保存版の分野別索引に 6101 の項目を足したもの
    const indexHtml = readFixture(
      'www.nta.go.jp_taxes_shiraberu_taxanswer_code_bunya-syohizei.htm'
    ).replace(
      '<ul class="noListImg">',
      '<ul class="noListImg">\n        <li><a href="/taxes/shiraberu/taxanswer/shohi/6101.htm">6101　消費税の基本的なしくみ</a></li>'
    );
    const bulkFetch = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(requestUrl(input)).pathname;
      if (path === '/taxes/shiraberu/taxanswer/shohi/6101.htm') {
        return sjisHtmlResponse(readFixture(TAX_ANSWER_FIXTURE));
      }
      if (/\/taxanswer\/[a-z]+\/\d+(-\d+)?\.htm$/.test(path)) {
        return new Response('not found', { status: 404 });
      }
      return sjisHtmlResponse(indexHtml);
    }) as unknown as typeof fetch;

    const db = new Database(dbPath);
    let fetchedAtInDb: string | undefined;
    try {
      initSchema(db);
      await bulkDownloadTaxAnswer(db, {
        fetchImpl: bulkFetch,
        taxonomies: ['shohi'],
        requestIntervalMs: 0,
        baselinePath: join(dir, 'baseline.json'),
      });
      const row = db
        .prepare(
          `SELECT fetched_at, structured_json FROM document WHERE source_url LIKE '%/shohi/6101.htm'`
        )
        .get() as { fetched_at: string; structured_json: string | null } | undefined;
      // 前提: bulk download が構造を持つ行を入れた
      expect(row).toBeDefined();
      expect(row?.structured_json).not.toBeNull();
      fetchedAtInDb = row?.fetched_at;
    } finally {
      db.close();
    }

    const r = (await getTaxAnswer(
      { no: '6101', format: 'json' },
      { fetchImpl: fetchMustNotBeCalled(), dbPath }
    )) as TaxAnswerJson;

    expect(r.source).toBe('db');
    expect(r.taxAnswer?.no).toBe('6101');
    expect(r.taxAnswer?.sections.length).toBeGreaterThan(0);
    // fetchedAt は DB に入れたときの日時のまま
    expect(r.taxAnswer?.fetchedAt).toBe(fetchedAtInDb);
  });
});

/* -------------------------------------------------------------------------- */
/* nta_get_tsutatsu                                                           */
/* -------------------------------------------------------------------------- */

const TOC_ETAG = '"toc-v1"';
const TOC_LAST_MODIFIED = 'Wed, 29 Jul 2026 00:00:00 GMT';
const HOJIN_TOC = `${KIHON}/hojin/01.htm`;

type RecordedRequest = { path: string; headers: Headers };

/**
 * 国税庁サイトのモック（法人税基本通達）。
 * - 目次: ETag / Last-Modified を付けて返し、条件付きの取得で同じ値が来たら 304
 * - pages に載せたパス: その fixture
 * - それ以外: 404
 */
function hojinSite(pages: Record<string, string> = {}) {
  const requests: RecordedRequest[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(requestUrl(input)).pathname;
    const headers = requestHeaders(input, init);
    requests.push({ path, headers });
    if (path === HOJIN_TOC) {
      if (
        headers.get('if-none-match') === TOC_ETAG ||
        headers.get('if-modified-since') === TOC_LAST_MODIFIED
      ) {
        return new Response(null, {
          status: 304,
          headers: { ETag: TOC_ETAG, 'Last-Modified': TOC_LAST_MODIFIED },
        });
      }
      return sjisHtmlResponse(readFixture('www.nta.go.jp_law_tsutatsu_kihon_hojin_01.htm'), {
        ETag: TOC_ETAG,
        'Last-Modified': TOC_LAST_MODIFIED,
      });
    }
    const page = pages[path];
    if (page) return sjisHtmlResponse(readFixture(`www.nta.go.jp_law_tsutatsu_kihon_${page}.htm`));
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  return {
    fetchImpl,
    tocRequests: () => requests.filter((r) => r.path === HOJIN_TOC),
    pageRequests: () => requests.filter((r) => r.path !== HOJIN_TOC),
  };
}

function isConditional(req: RecordedRequest): boolean {
  return (
    req.headers.get('if-none-match') === TOC_ETAG ||
    req.headers.get('if-modified-since') === TOC_LAST_MODIFIED
  );
}

const HOJIN_01_01 = { [`${KIHON}/hojin/01/01_01.htm`]: 'hojin_01_01_01' };

type TsutatsuJson = {
  code?: string;
  hint?: string;
  clause?: { clauseNumber: string; fullText: string };
  source?: string;
  fetchedAt?: string;
  available_clauses?: string[];
  next_actions?: unknown[];
};

describe('nta_get_tsutatsu — SPEC-NTA-GET-TSUTATSU-006 国税庁サイトから取った条項は DB に書き戻される', () => {
  it('SPEC-NTA-GET-TSUTATSU-006 nta_get_tsutatsu の応答: 国税庁サイトから取った条項は、同じ条項の 2 回目の呼び出しで取りに行かずに source=db で返す', async () => {
    const site = hojinSite(HOJIN_01_01);
    const first = (await getTsutatsu(
      { name: '法基通', clause: '1-1-1', format: 'json' },
      { fetchImpl: site.fetchImpl, dbPath }
    )) as TsutatsuJson;
    expect(first.source).toBe('live');
    expect(first.clause?.clauseNumber).toBe('1-1-1');

    const noFetch = fetchMustNotBeCalled();
    const second = (await getTsutatsu(
      { name: '法基通', clause: '1-1-1', format: 'json' },
      { fetchImpl: noFetch, dbPath }
    )) as TsutatsuJson;

    expect(second.code).toBeUndefined();
    expect(second.source).toBe('db');
    expect(second.clause?.clauseNumber).toBe('1-1-1');
    // SPEC-NTA-GET-TSUTATSU-004: fetchedAt は DB に入れたときの日時のまま
    expect(second.fetchedAt).toBe(first.fetchedAt);
    expect(callCount(noFetch)).toBe(0);
  });
});

describe('nta_get_tsutatsu — SPEC-NTA-GET-TSUTATSU-005 4 通達以外の通達に条項が残っているとき', () => {
  it('SPEC-NTA-GET-TSUTATSU-005 nta_get_tsutatsu の応答: 4 通達以外（電帳法取通）の DB に無い条項は、国税庁サイトに取りに行かず ARTICLE_NOT_FOUND と available_clauses を返す', async () => {
    const formalName = resolveAbbreviation('電帳法取通')?.formal;
    expect(formalName).toBeDefined();

    // 準備: bulk download 済みの印は付けず（国税庁サイトからの書き戻しと同じ形で）条項を入れる
    const db = new Database(dbPath);
    try {
      initSchema(db);
      writeBackLiveSection(db, {
        formalName: `${formalName}`,
        abbr: '電帳法取通',
        rootUrl: `${NTA_ORIGIN}/law/tsutatsu/kobetsu/denshicho/`,
        chapterNumber: 4,
        sectionNumber: 1,
        sectionUrl: `${NTA_ORIGIN}/law/tsutatsu/kobetsu/denshicho/04/01.htm`,
        fetchedAt: '2026-09-01T00:00:00.000Z',
        sectionTitle: '第1節 テスト',
        chapterTitle: '第4章 テスト',
        clauses: [
          {
            clauseNumber: '4-1',
            title: 'テストの条項',
            fullText: 'テストの本文',
            paragraphs: [{ indent: 1, text: 'テストの本文' }],
          },
          {
            clauseNumber: '4-2',
            title: 'テストの条項 2',
            fullText: 'テストの本文 2',
            paragraphs: [{ indent: 1, text: 'テストの本文 2' }],
          },
        ],
      });
    } finally {
      db.close();
    }

    const noFetch = fetchMustNotBeCalled();
    const r = (await getTsutatsu(
      { name: '電帳法取通', clause: '4-99', format: 'json' },
      { fetchImpl: noFetch, dbPath }
    )) as TsutatsuJson;

    expect(r.code).toBe('ARTICLE_NOT_FOUND');
    expect(r.available_clauses).toEqual(expect.arrayContaining(['4-1', '4-2']));
    expect(callCount(noFetch)).toBe(0);
  });
});

describe('nta_get_tsutatsu — SPEC-NTA-GET-TSUTATSU-008 番号の形には当たるが、目次から候補ページを決められないとき', () => {
  function expectInvalidArgumentWithSearchGuide(r: TsutatsuJson): void {
    expect(r.code).toBe('INVALID_ARGUMENT');
    // hint にその通達の番号の形（法基通は 章-節-条）と nta_search_tsutatsu での検索
    expect(r.hint).toContain('章-節-条');
    expect(r.hint).toContain('nta_search_tsutatsu');
    expect(JSON.stringify(r.next_actions ?? [])).toContain('nta_search_tsutatsu');
  }

  it('SPEC-NTA-GET-TSUTATSU-008 nta_get_tsutatsu の応答: 法基通 99-1-1（目次に第99章が無い）は候補ページを 1 つも取らずに INVALID_ARGUMENT と nta_search_tsutatsu の案内を返す', async () => {
    const site = hojinSite(HOJIN_01_01);
    const r = (await getTsutatsu(
      { name: '法基通', clause: '99-1-1', format: 'json' },
      { fetchImpl: site.fetchImpl, dbPath }
    )) as TsutatsuJson;

    expectInvalidArgumentWithSearchGuide(r);
    expect(site.pageRequests()).toHaveLength(0);
  });

  it('SPEC-NTA-GET-TSUTATSU-008 nta_get_tsutatsu の応答: 保存した目次で候補ページを決められず、取り直した目次（304）でも決められないときも INVALID_ARGUMENT', async () => {
    // 準備: 1 回目の呼び出しで目次を DB に保存させる
    const prime = hojinSite(HOJIN_01_01);
    const first = (await getTsutatsu(
      { name: '法基通', clause: '1-1-1', format: 'json' },
      { fetchImpl: prime.fetchImpl, dbPath }
    )) as TsutatsuJson;
    expect(first.source).toBe('live');

    const site = hojinSite(HOJIN_01_01);
    const r = (await getTsutatsu(
      { name: '法基通', clause: '99-1-1', format: 'json' },
      { fetchImpl: site.fetchImpl, dbPath }
    )) as TsutatsuJson;

    expectInvalidArgumentWithSearchGuide(r);
    expect(site.pageRequests()).toHaveLength(0);
    // SPEC-NTA-GET-TSUTATSU-014 の取り直し（条件付きの取得）を 1 回した後である
    const tocRequests = site.tocRequests();
    expect(tocRequests).toHaveLength(1);
    expect(isConditional(tocRequests[0])).toBe(true);
  });
});

describe('nta_get_tsutatsu — SPEC-NTA-GET-TSUTATSU-014 その呼び出しで目次を取得したときは取り直さない', () => {
  it('SPEC-NTA-GET-TSUTATSU-014 nta_get_tsutatsu の応答: 目次の保存が無い DB で法基通 1-1-99（候補ページに無い）を求めると、目次の取得は 1 回だけで ARTICLE_NOT_FOUND', async () => {
    const site = hojinSite(HOJIN_01_01);
    const r = (await getTsutatsu(
      { name: '法基通', clause: '1-1-99', format: 'json' },
      { fetchImpl: site.fetchImpl, dbPath }
    )) as TsutatsuJson;

    expect(r.code).toBe('ARTICLE_NOT_FOUND');
    const tocRequests = site.tocRequests();
    expect(tocRequests).toHaveLength(1);
    // 保存した目次の取り直し（条件付きの取得）ではない
    expect(isConditional(tocRequests[0])).toBe(false);
  });

  it('SPEC-NTA-GET-TSUTATSU-014 nta_get_tsutatsu の応答: 目次の保存が無い DB で候補ページを決められない法基通 99-1-1 でも、目次の取得は 1 回だけ', async () => {
    const site = hojinSite(HOJIN_01_01);
    const r = (await getTsutatsu(
      { name: '法基通', clause: '99-1-1', format: 'json' },
      { fetchImpl: site.fetchImpl, dbPath }
    )) as TsutatsuJson;

    expect(r.code).toBe('INVALID_ARGUMENT');
    const tocRequests = site.tocRequests();
    expect(tocRequests).toHaveLength(1);
    expect(isConditional(tocRequests[0])).toBe(false);
  });
});
