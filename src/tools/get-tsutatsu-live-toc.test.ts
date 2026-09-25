/**
 * houki-nta-mcp#54: nta_get_tsutatsu の国税庁サイトからの取得を基本通達 4 種で成立させる
 *
 * 差分 specs/changes/20260925-tsutatsu-live-toc/ のうち、目次を使う経路の受入テスト。
 *   - SPEC-NTA-GET-TSUTATSU-006 目次から候補ページを選び、順に取得する
 *   - SPEC-NTA-GET-TSUTATSU-010 候補ページのどれにも無いときの ARTICLE_NOT_FOUND
 *   - SPEC-NTA-GET-TSUTATSU-014 目次を DB に保存して使い回し、見つからないときにだけ取り直す
 *   - SPEC-NTA-GET-TSUTATSU-015 1 回の呼び出しで取るページは 10 まで、ページ間は 0.3 秒
 * 005・008・009 と入力の全角は handlers.test.ts にある。
 *
 * 国税庁サイトは fetchImpl で差し替える。目次・節のページは tests/fixtures/ の保存版を使う。
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { encode as iconvEncode } from 'iconv-lite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { getTsutatsu } from './handlers.js';

const fixturesDir = resolve(import.meta.dirname, '..', '..', 'tests', 'fixtures');
const NTA_ORIGIN = 'https://www.nta.go.jp';
const KIHON = '/law/tsutatsu/kihon';

function fixture(name: string): string {
  return readFileSync(resolve(fixturesDir, `www.nta.go.jp_law_tsutatsu_kihon_${name}.htm`), 'utf8');
}

/** fixture は UTF-8 で保存しているので、国税庁サイトと同じ Shift_JIS にして返す */
function sjisHtmlResponse(html: string, headers: Record<string, string> = {}): Response {
  return new Response(iconvEncode(html, 'shift_jis'), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=Shift_JIS', ...headers },
  });
}

/**
 * 存在しないページの応答。国税庁サイトは 302 で /error/404.htm に転送し、転送先は 200 を返す
 * （2026-09-25 JST に確認）。redirect: 'manual' なら 302 を、既定（follow）なら転送後の応答を返す
 */
function redirectTo404Response(init?: RequestInit): Response {
  const errorPageUrl = `${NTA_ORIGIN}/error/404.htm`;
  if (init?.redirect === 'manual') {
    return new Response(null, { status: 302, headers: { Location: errorPageUrl } });
  }
  const res = new Response(
    '<html><head><title>ページが見つかりません</title></head><body><p>お探しのページは見つかりませんでした。</p></body></html>',
    { status: 200, headers: { 'Content-Type': 'text/html; charset=UTF-8' } }
  );
  Object.defineProperty(res, 'url', { value: errorPageUrl });
  Object.defineProperty(res, 'redirected', { value: true });
  return res;
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

/* -------------------------------------------------------------------------- */
/* 国税庁サイトのモック                                                        */
/* -------------------------------------------------------------------------- */

const TOC_ETAG = '"toc-v1"';
const TOC_LAST_MODIFIED = 'Wed, 29 Jul 2026 00:00:00 GMT';

type TocPage = {
  html: string;
  etag: string;
  lastModified: string;
  /** true なら条件付きの取得にも 304 を返さず、毎回 200 で本文を返す */
  ignoreConditional?: boolean;
};

/** 基本通達 4 種の目次ページのパスとフィクスチャー */
const TOC_FIXTURES: Record<string, string> = {
  [`${KIHON}/shohi/01.htm`]: 'shohi_01',
  [`${KIHON}/hojin/01.htm`]: 'hojin_01',
  [`${KIHON}/shotoku/01.htm`]: 'shotoku_01',
  [`${KIHON}/sisan/sozoku2/01.htm`]: 'sisan_sozoku2_01',
};

function defaultTocs(): Record<string, TocPage> {
  return Object.fromEntries(
    Object.entries(TOC_FIXTURES).map(([path, name]) => [
      path,
      { html: fixture(name), etag: TOC_ETAG, lastModified: TOC_LAST_MODIFIED },
    ])
  );
}

type RecordedRequest = { path: string; headers: Headers; at: number };

type LiveSite = {
  fetchImpl: typeof fetch;
  requests: RecordedRequest[];
  /** 目次ページへのリクエスト */
  tocRequests: () => RecordedRequest[];
  /** 目次以外（候補ページ）へのリクエスト */
  pageRequests: () => RecordedRequest[];
};

/**
 * 国税庁サイトのモック。
 * - 目次: ETag / Last-Modified を付けて返す。条件付きの取得で前回と同じ値が来たら 304
 * - pages に載せたパス: そのフィクスチャー（名前は `www.nta.go.jp_law_tsutatsu_kihon_` の後ろ）
 * - それ以外: 存在しないページ（404 ページへの転送）
 */
function liveSite(
  opts: { pages?: Record<string, string>; tocs?: Record<string, TocPage> } = {}
): LiveSite {
  const pages = opts.pages ?? {};
  const tocs = opts.tocs ?? defaultTocs();
  const requests: RecordedRequest[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(requestUrl(input)).pathname;
    const headers = requestHeaders(input, init);
    requests.push({ path, headers, at: Date.now() });

    const toc = tocs[path];
    if (toc) {
      const notModified =
        !toc.ignoreConditional &&
        (headers.get('if-none-match') === toc.etag ||
          headers.get('if-modified-since') === toc.lastModified);
      if (notModified) {
        return new Response(null, {
          status: 304,
          headers: { ETag: toc.etag, 'Last-Modified': toc.lastModified },
        });
      }
      return sjisHtmlResponse(toc.html, { ETag: toc.etag, 'Last-Modified': toc.lastModified });
    }
    const page = pages[path];
    if (page) return sjisHtmlResponse(fixture(page));
    return redirectTo404Response(init);
  }) as unknown as typeof fetch;

  return {
    fetchImpl,
    requests,
    tocRequests: () => requests.filter((r) => tocs[r.path]),
    pageRequests: () => requests.filter((r) => !tocs[r.path]),
  };
}

/** 条件付きの取得（前回の ETag か Last-Modified を付けた取得）か */
function isConditional(req: RecordedRequest, etag = TOC_ETAG, lastModified = TOC_LAST_MODIFIED) {
  return (
    req.headers.get('if-none-match') === etag ||
    req.headers.get('if-modified-since') === lastModified
  );
}

type LiveClause = {
  code?: string;
  clause?: { clauseNumber: string; fullText: string };
  sourceUrl?: string;
  source?: string;
};

type NotFound = {
  code?: string;
  error?: string;
  hint?: string;
  available_clauses?: string[];
  searched_urls?: string[];
};

/** 呼ばれたら失敗する fetch。DB から返したことを確かめるために使う */
function fetchMustNotBeCalled(): typeof fetch {
  return vi.fn(async () => {
    throw new Error('fetch should NOT be called');
  }) as unknown as typeof fetch;
}

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'houki-nta-issue54-live-toc-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 呼び出しをまたいで DB を使うテスト用に、テストごとの DB ファイルのパスを返す */
function dbFile(name: string): string {
  return join(dir, `${name}.db`);
}

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-GET-TSUTATSU-006                                                  */
/* -------------------------------------------------------------------------- */

describe('getTsutatsu — SPEC-NTA-GET-TSUTATSU-006 DB に無い基本通達 4 種の条項を目次から選んだページで取る', () => {
  const cases: Array<{
    title: string;
    name: string;
    clause: string;
    pages: Record<string, string>;
    expectedClause: string | RegExp;
    expectedPage: string;
  }> = [
    {
      title: '法基通 1-1-1 は、目次で第1章第1節のページを選ぶ',
      name: '法基通',
      clause: '1-1-1',
      pages: { [`${KIHON}/hojin/01/01_01.htm`]: 'hojin_01_01_01' },
      expectedClause: '1-1-1',
      expectedPage: `${KIHON}/hojin/01/01_01.htm`,
    },
    {
      title: '法基通 1-3の2-1 は、目次で第1章第3節の2のページを選ぶ（節の枝番号）',
      name: '法基通',
      clause: '1-3の2-1',
      pages: { [`${KIHON}/hojin/01/01_03_02.htm`]: 'hojin_01_01_03_02' },
      expectedClause: '1-3の2-1',
      expectedPage: `${KIHON}/hojin/01/01_03_02.htm`,
    },
    {
      title: '所基通 31-1 は、目次の「法第31条…関係」のページを選ぶ',
      name: '所基通',
      clause: '31-1',
      pages: { [`${KIHON}/shotoku/04/05.htm`]: 'shotoku_04_05' },
      expectedClause: '31-1',
      expectedPage: `${KIHON}/shotoku/04/05.htm`,
    },
    {
      title: '所基通 183~193共-1 は、目次の「法第183条から第193条まで…共通関係」のページを選ぶ',
      name: '所基通',
      clause: '183~193共-1',
      pages: { [`${KIHON}/shotoku/30/01.htm`]: 'shotoku_30_01' },
      expectedClause: /^183[~～]193共-1$/,
      expectedPage: `${KIHON}/shotoku/30/01.htm`,
    },
    {
      title:
        '所基通 2-4の2 は、見出し「法第2条《定義》関係」に属する「〔…〕」の項目のページから選ぶ',
      name: '所基通',
      clause: '2-4の2',
      pages: { [`${KIHON}/shotoku/01/01.htm`]: 'shotoku_01_01' },
      expectedClause: '2-4の2',
      expectedPage: `${KIHON}/shotoku/01/01.htm`,
    },
    {
      title: '相基通 3-1 は、目次の「第3条《…》関係」のページを選ぶ',
      name: '相基通',
      clause: '3-1',
      pages: {
        [`${KIHON}/sisan/sozoku2/01/02.htm`]: 'sisan_sozoku2_01_02',
        [`${KIHON}/sisan/sozoku2/01/03.htm`]: 'sisan_sozoku2_01_03',
      },
      expectedClause: '3-1',
      expectedPage: `${KIHON}/sisan/sozoku2/01/02.htm`,
    },
    {
      title:
        '相基通 1の3・1の4共-1 は、目次の「第1条の3《…》及び第1条の4《…》共通関係」のページを選ぶ',
      name: '相基通',
      clause: '1の3・1の4共-1',
      pages: { [`${KIHON}/sisan/sozoku2/01/01.htm`]: 'sisan_sozoku2_01_01' },
      expectedClause: '1の3・1の4共-1',
      expectedPage: `${KIHON}/sisan/sozoku2/01/01.htm`,
    },
  ];

  for (const c of cases) {
    it(`SPEC-NTA-GET-TSUTATSU-006 ${c.title}`, async () => {
      const site = liveSite({ pages: c.pages });

      const r = (await getTsutatsu(
        { name: c.name, clause: c.clause, format: 'json' },
        { fetchImpl: site.fetchImpl, dbPath: ':memory:' }
      )) as LiveClause;

      expect(r.code).toBeUndefined();
      if (typeof c.expectedClause === 'string') {
        expect(r.clause?.clauseNumber).toBe(c.expectedClause);
      } else {
        expect(r.clause?.clauseNumber).toMatch(c.expectedClause);
      }
      expect(r.clause?.fullText.length ?? 0).toBeGreaterThan(0);
      expect(r.source).toBe('live');
      expect(r.sourceUrl).toBe(`${NTA_ORIGIN}${c.expectedPage}`);
      expect(site.pageRequests().map((q) => q.path)).toContain(c.expectedPage);
    });
  }

  it('SPEC-NTA-GET-TSUTATSU-006 法基通 2-1-2 は、第2章第1節の款のページを目次の順に取り、見つかったところで止める', async () => {
    const site = liveSite({
      pages: {
        [`${KIHON}/hojin/02/02_01_01.htm`]: 'hojin_02_02_01_01',
        [`${KIHON}/hojin/02/02_01_01_2.htm`]: 'hojin_02_02_01_01_2',
      },
    });

    const r = (await getTsutatsu(
      { name: '法基通', clause: '2-1-2', format: 'json' },
      { fetchImpl: site.fetchImpl, dbPath: ':memory:' }
    )) as LiveClause;

    expect(r.clause?.clauseNumber).toBe('2-1-2');
    expect(r.source).toBe('live');
    expect(r.sourceUrl).toBe(`${NTA_ORIGIN}${KIHON}/hojin/02/02_01_01_2.htm`);
    // 第1款（2-1-1 系）→ 第1款の2（2-1-2〜）で見つかり、第2款以降は取らない
    expect(site.pageRequests().map((q) => q.path)).toEqual([
      `${KIHON}/hojin/02/02_01_01.htm`,
      `${KIHON}/hojin/02/02_01_01_2.htm`,
    ]);
  });

  it('SPEC-NTA-GET-TSUTATSU-006 相基通 3-18 は、第3条のページを全部候補にし、2 ページ目で見つける', async () => {
    const site = liveSite({
      pages: {
        [`${KIHON}/sisan/sozoku2/01/02.htm`]: 'sisan_sozoku2_01_02',
        [`${KIHON}/sisan/sozoku2/01/03.htm`]: 'sisan_sozoku2_01_03',
      },
    });

    const r = (await getTsutatsu(
      { name: '相基通', clause: '3-18', format: 'json' },
      { fetchImpl: site.fetchImpl, dbPath: ':memory:' }
    )) as LiveClause;

    expect(r.clause?.clauseNumber).toBe('3-18');
    expect(r.source).toBe('live');
    expect(r.sourceUrl).toBe(`${NTA_ORIGIN}${KIHON}/sisan/sozoku2/01/03.htm`);
    expect(site.pageRequests().map((q) => q.path)).toEqual([
      `${KIHON}/sisan/sozoku2/01/02.htm`,
      `${KIHON}/sisan/sozoku2/01/03.htm`,
    ]);
  });

  it('SPEC-NTA-GET-TSUTATSU-006 取得して解析できたページは、条項が見つからなかったページも DB に書き戻し、次からは DB から返す', async () => {
    const dbPath = dbFile('006-writeback');
    const site = liveSite({
      pages: {
        [`${KIHON}/hojin/02/02_01_01.htm`]: 'hojin_02_02_01_01',
        [`${KIHON}/hojin/02/02_01_01_2.htm`]: 'hojin_02_02_01_01_2',
      },
    });
    const first = (await getTsutatsu(
      { name: '法基通', clause: '2-1-2', format: 'json' },
      { fetchImpl: site.fetchImpl, dbPath }
    )) as LiveClause;
    expect(first.source).toBe('live');

    // 見つかったページ（第1款の2）の別の条項
    const sameFoundPage = (await getTsutatsu(
      { name: '法基通', clause: '2-1-3', format: 'json' },
      { fetchImpl: fetchMustNotBeCalled(), dbPath }
    )) as LiveClause;
    expect(sameFoundPage.clause?.clauseNumber).toBe('2-1-3');
    expect(sameFoundPage.source).toBe('db');

    // 条項が無かったページ（第1款）の条項
    const notFoundPage = (await getTsutatsu(
      { name: '法基通', clause: '2-1-1の2', format: 'json' },
      { fetchImpl: fetchMustNotBeCalled(), dbPath }
    )) as LiveClause;
    expect(notFoundPage.clause?.clauseNumber).toBe('2-1-1の2');
    expect(notFoundPage.source).toBe('db');
  });
});

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-GET-TSUTATSU-010                                                  */
/* -------------------------------------------------------------------------- */

describe('getTsutatsu — SPEC-NTA-GET-TSUTATSU-010 候補ページのどれにも条項が無いときは、見たページの番号と URL を返す', () => {
  it('SPEC-NTA-GET-TSUTATSU-010 法基通 2-1-99: available_clauses に取得したページの条項番号、searched_urls にその URL を入れる', async () => {
    const site = liveSite({
      pages: {
        [`${KIHON}/hojin/02/02_01_01.htm`]: 'hojin_02_02_01_01',
        [`${KIHON}/hojin/02/02_01_01_2.htm`]: 'hojin_02_02_01_01_2',
      },
    });

    const r = (await getTsutatsu(
      { name: '法基通', clause: '2-1-99', format: 'json' },
      { fetchImpl: site.fetchImpl, dbPath: ':memory:' }
    )) as NotFound;

    expect(r.code).toBe('ARTICLE_NOT_FOUND');
    expect(r.error).toContain('2-1-99');
    expect(r.available_clauses).toEqual(
      expect.arrayContaining(['2-1-1', '2-1-1の16', '2-1-2', '2-1-4'])
    );
    expect(r.searched_urls).toEqual(
      expect.arrayContaining([
        `${NTA_ORIGIN}${KIHON}/hojin/02/02_01_01.htm`,
        `${NTA_ORIGIN}${KIHON}/hojin/02/02_01_01_2.htm`,
      ])
    );
    // 第2章第1節の款は 8 ページ。ページ間の 0.3 秒の待ちがあるので既定の 5 秒では足りないことがある
  }, 30_000);

  it('SPEC-NTA-GET-TSUTATSU-010 hint に、番号の形の確認・nta_search_tsutatsu での検索・--bulk-download を書く', async () => {
    const site = liveSite({
      pages: {
        [`${KIHON}/sisan/sozoku2/01/02.htm`]: 'sisan_sozoku2_01_02',
        [`${KIHON}/sisan/sozoku2/01/03.htm`]: 'sisan_sozoku2_01_03',
      },
    });

    const r = (await getTsutatsu(
      { name: '相基通', clause: '3-99', format: 'json' },
      { fetchImpl: site.fetchImpl, dbPath: ':memory:' }
    )) as NotFound;

    expect(r.code).toBe('ARTICLE_NOT_FOUND');
    expect(r.available_clauses).toEqual(expect.arrayContaining(['3-1', '3-17', '3-18', '3-33']));
    expect(r.searched_urls).toEqual(
      expect.arrayContaining([
        `${NTA_ORIGIN}${KIHON}/sisan/sozoku2/01/02.htm`,
        `${NTA_ORIGIN}${KIHON}/sisan/sozoku2/01/03.htm`,
      ])
    );
    // 番号の形（相基通は 条-項）の確認
    expect(r.hint).toContain('条-項');
    expect(r.hint).toContain('nta_search_tsutatsu');
    expect(r.hint).toContain('--bulk-download');
  });
});

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-GET-TSUTATSU-014                                                  */
/* -------------------------------------------------------------------------- */

describe('getTsutatsu — SPEC-NTA-GET-TSUTATSU-014 目次を DB に保存して使い回し、条項が見つからないときにだけ取り直す', () => {
  const HOJIN_TOC = `${KIHON}/hojin/01.htm`;
  const HOJIN_01_01 = { [`${KIHON}/hojin/01/01_01.htm`]: 'hojin_01_01_01' };
  const HOJIN_01_04 = { [`${KIHON}/hojin/01/01_04.htm`]: 'hojin_01_01_04' };

  /** 1 回目の呼び出しで法基通の目次を DB に保存させる（1-1-1 を国税庁サイトから取る） */
  async function primeHojinToc(dbPath: string, tocs?: Record<string, TocPage>): Promise<void> {
    const site = liveSite({ pages: HOJIN_01_01, tocs });
    const r = (await getTsutatsu(
      { name: '法基通', clause: '1-1-1', format: 'json' },
      { fetchImpl: site.fetchImpl, dbPath }
    )) as LiveClause;
    expect(r.source).toBe('live');
    expect(site.tocRequests().length).toBeGreaterThan(0);
  }

  it('SPEC-NTA-GET-TSUTATSU-014 保存した目次で候補ページが決まるときは、目次を国税庁サイトから取り直さない', async () => {
    const dbPath = dbFile('014-reuse');
    await primeHojinToc(dbPath);

    const site = liveSite({ pages: HOJIN_01_04 });
    const r = (await getTsutatsu(
      { name: '法基通', clause: '1-4-1', format: 'json' },
      { fetchImpl: site.fetchImpl, dbPath }
    )) as LiveClause;

    expect(r.clause?.clauseNumber).toBe('1-4-1');
    expect(r.source).toBe('live');
    expect(site.tocRequests()).toHaveLength(0);
  });

  it('SPEC-NTA-GET-TSUTATSU-014 候補ページのどれにも条項が無いときは、前回の ETag / Last-Modified を付けて目次を 1 回取り直し、304 なら ARTICLE_NOT_FOUND', async () => {
    const dbPath = dbFile('014-not-modified');
    await primeHojinToc(dbPath);

    const site = liveSite({ pages: HOJIN_01_01 });
    const r = (await getTsutatsu(
      { name: '法基通', clause: '1-1-99', format: 'json' },
      { fetchImpl: site.fetchImpl, dbPath }
    )) as NotFound;

    expect(r.code).toBe('ARTICLE_NOT_FOUND');
    const tocRequests = site.tocRequests();
    expect(tocRequests.map((q) => q.path)).toEqual([HOJIN_TOC]);
    expect(isConditional(tocRequests[0])).toBe(true);
  });

  it('SPEC-NTA-GET-TSUTATSU-014 保存した目次で候補ページを決められないときは目次を取り直し、新しい目次で選んだページから返す', async () => {
    const dbPath = dbFile('014-updated-toc');
    // 保存される目次は、第1章第4節（01/01_04.htm）の項目が無い古い版
    const fullToc = fixture('hojin_01');
    const oldToc = fullToc.replace(
      /<li><a href="\/law\/tsutatsu\/kihon\/hojin\/01\/01_04\.htm">[^<]*<\/a><\/li>/,
      ''
    );
    expect(oldToc).not.toBe(fullToc);
    await primeHojinToc(dbPath, {
      [HOJIN_TOC]: { html: oldToc, etag: TOC_ETAG, lastModified: TOC_LAST_MODIFIED },
    });

    // 国税庁サイトの目次は更新されている（ETag・Last-Modified が変わった）
    const newEtag = '"toc-v2"';
    const newLastModified = 'Mon, 03 Aug 2026 00:00:00 GMT';
    const site = liveSite({
      pages: HOJIN_01_04,
      tocs: { [HOJIN_TOC]: { html: fullToc, etag: newEtag, lastModified: newLastModified } },
    });
    const r = (await getTsutatsu(
      { name: '法基通', clause: '1-4-1', format: 'json' },
      { fetchImpl: site.fetchImpl, dbPath }
    )) as LiveClause;

    expect(r.code).toBeUndefined();
    expect(r.clause?.clauseNumber).toBe('1-4-1');
    expect(r.source).toBe('live');
    const tocRequests = site.tocRequests();
    expect(tocRequests).toHaveLength(1);
    // 取り直しには、保存したときの（古い版の）ETag / Last-Modified を付ける
    expect(isConditional(tocRequests[0])).toBe(true);
  });

  it('SPEC-NTA-GET-TSUTATSU-014 候補ページがどれも存在しないときも目次を取り直し、304 なら ARTICLE_NOT_FOUND', async () => {
    const dbPath = dbFile('014-pages-missing');
    await primeHojinToc(dbPath);

    // 01/01_04.htm は 404 ページへ転送される
    const site = liveSite({ pages: {} });
    const r = (await getTsutatsu(
      { name: '法基通', clause: '1-4-1', format: 'json' },
      { fetchImpl: site.fetchImpl, dbPath }
    )) as NotFound & { retryable?: boolean };

    expect(r.code).toBe('ARTICLE_NOT_FOUND');
    expect(r.retryable).not.toBe(true);
    const tocRequests = site.tocRequests();
    expect(tocRequests).toHaveLength(1);
    expect(isConditional(tocRequests[0])).toBe(true);
  });

  it('SPEC-NTA-GET-TSUTATSU-014 目次を取り直すのは 1 回の呼び出しにつき 1 回だけ（取り直した目次でも見つからないとき）', async () => {
    const dbPath = dbFile('014-once-per-call');
    await primeHojinToc(dbPath);

    // 条件付きの取得にも毎回 200 で同じ目次を返すサイト
    const site = liveSite({
      pages: HOJIN_01_01,
      tocs: {
        [HOJIN_TOC]: {
          html: fixture('hojin_01'),
          etag: TOC_ETAG,
          lastModified: TOC_LAST_MODIFIED,
          ignoreConditional: true,
        },
      },
    });
    const r = (await getTsutatsu(
      { name: '法基通', clause: '1-1-99', format: 'json' },
      { fetchImpl: site.fetchImpl, dbPath }
    )) as NotFound;

    expect(r.code).toBe('ARTICLE_NOT_FOUND');
    expect(site.tocRequests()).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-GET-TSUTATSU-015                                                  */
/* -------------------------------------------------------------------------- */

describe('getTsutatsu — SPEC-NTA-GET-TSUTATSU-015 1 回の呼び出しで国税庁サイトから取るページは 10 まで', () => {
  it('SPEC-NTA-GET-TSUTATSU-015 候補ページが 11 ある法基通 2-3-99 では 10 ページで止め、hint に上限に達したことを書く', async () => {
    // 第2章第3節は第1款〜第11款の 11 ページ（目次の順）。どのページにも 2-3-99 は無い
    const kanPages = [
      '02_03_01',
      '02_03_02',
      '02_03_03',
      '02_03_04',
      '02_03_05',
      '02_03_06',
      '02_03_07a',
      '02_03_08',
      '02_03_09',
      '02_03_10',
      '02_03_11',
    ];
    const site = liveSite({
      pages: Object.fromEntries(
        kanPages.map((p) => [`${KIHON}/hojin/02/${p}.htm`, 'hojin_02_02_01_01'])
      ),
    });

    const r = (await getTsutatsu(
      { name: '法基通', clause: '2-3-99', format: 'json' },
      { fetchImpl: site.fetchImpl, dbPath: ':memory:' }
    )) as NotFound;

    expect(r.code).toBe('ARTICLE_NOT_FOUND');
    expect(r.hint).toContain('上限');
    // 目次ページは数えない
    expect(site.pageRequests()).toHaveLength(10);
  }, 30_000);

  it('SPEC-NTA-GET-TSUTATSU-015 候補ページとページのあいだは 0.3 秒あける', async () => {
    const site = liveSite({
      pages: {
        [`${KIHON}/sisan/sozoku2/01/02.htm`]: 'sisan_sozoku2_01_02',
        [`${KIHON}/sisan/sozoku2/01/03.htm`]: 'sisan_sozoku2_01_03',
      },
    });

    const r = (await getTsutatsu(
      { name: '相基通', clause: '3-18', format: 'json' },
      { fetchImpl: site.fetchImpl, dbPath: ':memory:' }
    )) as LiveClause;

    expect(r.clause?.clauseNumber).toBe('3-18');
    const pages = site.pageRequests();
    expect(pages).toHaveLength(2);
    // タイマーの誤差を見込んで 280 ミリ秒以上
    expect(pages[1].at - pages[0].at).toBeGreaterThanOrEqual(280);
  });
});
