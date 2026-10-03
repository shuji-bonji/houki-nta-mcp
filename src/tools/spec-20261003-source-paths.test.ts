/**
 * 差分 specs/changes/20261003-source-paths/（PR #134）の受入テスト。
 *
 * - #120: SPEC-NTA-COMMON-ERRORS-016・018・019、SPEC-NTA-GET-QA-015、SPEC-NTA-GET-TAX-ANSWER-014、
 *   SPEC-NTA-GET-TSUTATSU-009（国税庁サイトとの通信の失敗を 4 つの code に分ける）
 * - #128: SPEC-NTA-GET-TAX-ANSWER-003・005・006・011・012・013・015・016・017、SPEC-NTA-COMMON-ERRORS-009
 *   （記事の URL を国税庁の索引で決める・8xxx 帯）
 * - #131: SPEC-NTA-SEARCH-JIMU-UNEI-002・003、SPEC-NTA-INSPECT-PDF-META-016、SPEC-NTA-GET-JIMU-UNEI-005、
 *   SPEC-NTA-SEARCH-RULES-015（事務運営指針の legal_status.note）
 *
 * 期待値は差分の spec.md・proposal.md の本文と「例:」から決めている。国税庁サイトは fetchImpl の差し替えで代える。
 * タックスアンサーの索引は、houki-hub docs/notes/2026-10-03-issue-draft-nta-tax-answer-8xxx.md と
 * 差分の proposal.md「確かめた値」の 2026-10-03 JST の実測値（755 件、先頭の桁とフォルダの組の件数、
 * 先頭の桁で決めたフォルダと違う 129 件、8001 の saigai など）から組み立てる。
 *
 * 取り直し（1・2・4 秒）と 30 秒の打ち切りは、ツールの options の retryBaseMs・timeoutMs で短くして確かめる。
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type IndexEntry,
  taxAnswerIndexHtml as indexHtml,
  MEASURED_INDEX,
} from '../../tests/support/tax-answer-index.js';
import { TAX_ANSWER_FOLDER_MAP } from '../constants.js';
import { initSchema } from '../db/schema.js';
import {
  getQa,
  getTaxAnswer,
  getTsutatsu,
  handleNtaGetJimuUnei,
  handleNtaInspectPdfMeta,
  handleNtaSearchJimuUnei,
} from './handlers.js';

/* -------------------------------------------------------------------------- */
/* 共通の準備                                                                  */
/* -------------------------------------------------------------------------- */

interface Body {
  error?: string;
  code?: string;
  tool?: string;
  hint?: string;
  url?: string;
  retryable?: boolean;
  next_actions?: Array<{ action: string; reason?: string; example?: Record<string, unknown> }>;
  detail?: { status?: number; url?: string; cause?: string };
  source?: string;
  taxAnswer?: { no?: string; title?: string; sourceUrl?: string; fetchedAt?: string };
  legal_status?: { note?: string; binds_tax_office?: boolean };
  results?: unknown[];
}

const NTA = 'https://www.nta.go.jp';
const INDEX_URL = `${NTA}/taxes/shiraberu/taxanswer/code/`;
const ERROR_PAGE = `${NTA}/error/404.htm`;
const FIXTURES = join(import.meta.dirname, '../../tests/fixtures');

/** 取り直しの待ちと打ち切りを短くする（1・2・4 秒 → 1・2・4 ミリ秒、30 秒 → 30 ミリ秒） */
const FAST = { retryBaseMs: 1, timeoutMs: 30 } as const;

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'houki-nta-source-paths-'));
  dbPath = join(dir, 'cache.db');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function urlOf(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function headerOf(init: RequestInit | undefined, name: string): string | undefined {
  const h = init?.headers as Record<string, string> | undefined;
  if (!h) return undefined;
  const key = Object.keys(h).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? h[key] : undefined;
}

/** 国税庁サイトの存在しないページ（302 で /error/404.htm へ転送され、転送先は 200） */
function soft404(): Response {
  const res = new Response('<html><body><p>ページが見つかりません</p></body></html>', {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=UTF-8' },
  });
  Object.defineProperty(res, 'url', { value: ERROR_PAGE });
  Object.defineProperty(res, 'redirected', { value: true });
  return res;
}

function html(body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=UTF-8', ...headers },
  });
}

/** 応答を待たせ、打ち切られたら（signal の abort）AbortError で失敗する fetch の応答 */
function hang(init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return;
    signal.addEventListener('abort', () =>
      reject(new DOMException('This operation was aborted', 'AbortError'))
    );
  });
}

/** Node の fetch が接続できないときに投げる形の例外 */
function connectError(code: string): TypeError {
  return new TypeError('fetch failed', { cause: { code, hostname: 'www.nta.go.jp' } });
}

/* -------------------------------------------------------------------------- */
/* タックスアンサーの索引（2026-10-03 JST の実測値）                            */
/* -------------------------------------------------------------------------- */

const ARTICLE_TEMPLATE = readFileSync(
  join(FIXTURES, 'www.nta.go.jp_taxes_shiraberu_taxanswer_shohi_6101.htm'),
  'utf8'
);

/** 6101 のフィクスチャーの見出しを差し替えた記事のページ */
function articleHtml(heading: string): string {
  return ARTICLE_TEMPLATE.replace(/<h1>No\.6101[^<]*<\/h1>/, `<h1>${heading}</h1>`);
}

function articleUrl(folder: string, no: string): string {
  return `${NTA}/taxes/shiraberu/taxanswer/${folder}/${no}.htm`;
}

interface SiteOptions {
  /** 索引の記事（既定: 実測の 755 件） */
  index?: readonly IndexEntry[];
  /** 2 回目以降の索引の取得で返す記事（指定すると 200 で返す） */
  indexAfter?: readonly IndexEntry[];
  /** 索引の応答を差し替える（指定するとこちらを使う） */
  indexResponse?: (init?: RequestInit) => Response | Promise<Response>;
  /** 条件付きの取り直しに 304 を返す */
  indexNotModified?: boolean;
  /** 記事の応答を差し替える */
  articleResponse?: (url: string, init?: RequestInit) => Response | Promise<Response>;
  /** 記事の見出し（URL → 見出し）。無い記事は「No.<番号> 記事 <番号>」 */
  headings?: Record<string, string>;
}

const INDEX_HEADERS = {
  'Last-Modified': 'Tue, 15 Sep 2026 08:58:03 GMT',
  ETag: '"25b0a-65b81bf96ae40"',
};

/** 国税庁サイトの代わり。索引と記事のページを返し、要求を記録する */
function makeSite(o: SiteOptions = {}) {
  const requests: Array<{ url: string; init?: RequestInit; at: number }> = [];
  let indexCalls = 0;
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = urlOf(input);
    requests.push({ url, init, at: Date.now() });
    if (url === INDEX_URL) {
      indexCalls++;
      if (o.indexResponse) return o.indexResponse(init);
      const conditional = headerOf(init, 'If-None-Match') || headerOf(init, 'If-Modified-Since');
      if (conditional && o.indexNotModified) {
        return new Response(null, { status: 304, headers: INDEX_HEADERS });
      }
      const entries = indexCalls > 1 && o.indexAfter ? o.indexAfter : (o.index ?? MEASURED_INDEX);
      return html(indexHtml(entries), INDEX_HEADERS);
    }
    if (o.articleResponse) return o.articleResponse(url, init);
    const all = [...(o.index ?? MEASURED_INDEX), ...(o.indexAfter ?? [])];
    const entry = all.find((e) => articleUrl(e.folder, e.no) === url);
    if (!entry) return soft404();
    return html(articleHtml(o.headings?.[url] ?? `No.${entry.no} ${entry.title}`));
  });
  return {
    fetchImpl: fetchImpl as unknown as typeof fetch,
    requests,
    urls: () => requests.map((r) => r.url),
    indexRequests: () => requests.filter((r) => r.url === INDEX_URL),
    articleRequests: () => requests.filter((r) => r.url !== INDEX_URL),
  };
}

function readTaxAnswerRow(no: string): { taxonomy: string | null; source_url: string } | undefined {
  const db = new Database(dbPath);
  try {
    return db
      .prepare(
        `SELECT taxonomy, source_url FROM document WHERE doc_type = 'tax-answer' AND doc_id = ?`
      )
      .get(no) as { taxonomy: string | null; source_url: string } | undefined;
  } finally {
    db.close();
  }
}

const fetchTaxAnswer = (no: string, site: ReturnType<typeof makeSite>, format = 'json') =>
  getTaxAnswer(
    { no, format: format as 'json' },
    { fetchImpl: site.fetchImpl, dbPath, ...FAST }
  ) as Promise<Body>;

/* -------------------------------------------------------------------------- */
/* #128 記事の URL を国税庁の索引で決める                                       */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-GET-TAX-ANSWER-003 記事の URL は国税庁の索引で決め、DB にある行はその行の URL を使う', () => {
  it('SPEC-NTA-GET-TAX-ANSWER-003 テストの索引は実測の値（755 件、番号の重複なし、0 で始まる番号なし、先頭の桁で決めたフォルダと違うのは 129 件）', () => {
    expect(MEASURED_INDEX).toHaveLength(755);
    expect(new Set(MEASURED_INDEX.map((e) => e.no)).size).toBe(755);
    expect(MEASURED_INDEX.some((e) => e.no.startsWith('0'))).toBe(false);
    const mismatched = MEASURED_INDEX.filter((e) => TAX_ANSWER_FOLDER_MAP[e.no[0]] !== e.folder);
    expect(mismatched).toHaveLength(129);
    expect(MEASURED_INDEX.filter((e) => e.folder === 'saigai')).toHaveLength(16);
  });

  const TABLE: Array<[no: string, folder: string, wrong: string | null]> = [
    ['6101', 'shohi', null],
    ['2010', 'shotoku', 'gensen'],
    ['4402', 'zoyo', 'sozoku'],
    ['7400', 'hotei', 'inshi'],
    ['3429', 'hojin', 'joto'],
    ['8001', 'saigai', null],
  ];
  for (const [no, folder, wrong] of TABLE) {
    it(`SPEC-NTA-GET-TAX-ANSWER-003 DB に無い ${no} は索引で /${folder}/${no}.htm を決めて取る`, async () => {
      const site = makeSite();
      const r = await fetchTaxAnswer(no, site);
      expect(r.code).toBeUndefined();
      expect(r.source).toBe('live');
      expect(r.taxAnswer?.sourceUrl).toBe(articleUrl(folder, no));
      expect(site.indexRequests()).toHaveLength(1);
      expect(site.articleRequests().map((x) => x.url)).toEqual([articleUrl(folder, no)]);
      if (wrong) expect(site.urls()).not.toContain(articleUrl(wrong, no));
    });
  }

  it('SPEC-NTA-GET-TAX-ANSWER-003 DB に節の構造を持たない行があれば、その行の出典 URL を取り、索引は取らない', async () => {
    const db = new Database(dbPath);
    initSchema(db);
    db.prepare(
      `INSERT INTO document(doc_type, doc_id, taxonomy, title, source_url, fetched_at, full_text, attached_pdfs_json)
       VALUES ('tax-answer', '2010', 'shotoku', '古い行', ?, '2026-01-01T00:00:00.000Z', '本文', '[]')`
    ).run(articleUrl('shotoku', '2010'));
    db.close();
    const site = makeSite();
    const r = await fetchTaxAnswer('2010', site);
    expect(r.code).toBeUndefined();
    expect(r.source).toBe('live');
    expect(site.indexRequests()).toHaveLength(0);
    expect(site.articleRequests().map((x) => x.url)).toEqual([articleUrl('shotoku', '2010')]);
  });
});

describe('SPEC-NTA-GET-TAX-ANSWER-005 DB に無い記事は国税庁サイトから取る（8xxx 帯も）', () => {
  it('SPEC-NTA-GET-TAX-ANSWER-005 DB に無い 8001 は /saigai/8001.htm から取り、題名に「災害等による期限の延長」を含み source: "live"（v0.23.0 では INVALID_ARGUMENT）', async () => {
    const site = makeSite({
      headings: { [articleUrl('saigai', '8001')]: 'No.8001 災害等による期限の延長' },
    });
    const r = await fetchTaxAnswer('8001', site);
    expect(r.code).toBeUndefined();
    expect(r.source).toBe('live');
    expect(r.taxAnswer?.title).toContain('災害等による期限の延長');
    expect(r.taxAnswer?.no).toBe('8001');
  });
});

describe('SPEC-NTA-GET-TAX-ANSWER-006 国税庁サイトから取った記事は、URL の税目フォルダで DB に入り、次からは DB から返す', () => {
  it('SPEC-NTA-GET-TAX-ANSWER-006 2010 を取ると DB の行の税目は shotoku で、もう一度求めると source: "db"', async () => {
    const site = makeSite();
    const first = await fetchTaxAnswer('2010', site);
    expect(first.source).toBe('live');
    expect(readTaxAnswerRow('2010')?.taxonomy).toBe('shotoku');
    const second = await fetchTaxAnswer('2010', site);
    expect(second.source).toBe('db');
    expect(second.taxAnswer?.fetchedAt).toBe(first.taxAnswer?.fetchedAt);
    expect(site.articleRequests()).toHaveLength(1);
  });

  it('SPEC-NTA-GET-TAX-ANSWER-006 8001 の行の税目は saigai', async () => {
    const site = makeSite();
    await fetchTaxAnswer('8001', site);
    expect(readTaxAnswerRow('8001')?.taxonomy).toBe('saigai');
  });
});

describe('SPEC-NTA-GET-TAX-ANSWER-011 記事番号は引数の no で決め、DB の行の税目は URL の税目フォルダ', () => {
  it('SPEC-NTA-GET-TAX-ANSWER-011 見出しが「消費税の基本的なしくみ」（No. が無い）のページを 6101 で取ると、taxAnswer.no は "6101"、行の文書 ID は 6101、税目は shohi', async () => {
    const site = makeSite({
      headings: { [articleUrl('shohi', '6101')]: '消費税の基本的なしくみ' },
    });
    const r = await fetchTaxAnswer('6101', site);
    expect(r.taxAnswer?.no).toBe('6101');
    expect(r.taxAnswer?.title).toBe('消費税の基本的なしくみ');
    expect(readTaxAnswerRow('6101')?.taxonomy).toBe('shohi');
    const again = await fetchTaxAnswer('6101', site);
    expect(again.source).toBe('db');
    expect(again.taxAnswer?.no).toBe('6101');
  });
});

describe('SPEC-NTA-GET-TAX-ANSWER-012 番号は 4 桁で、先頭の桁では断らない', () => {
  it('SPEC-NTA-GET-TAX-ANSWER-012 "6101"・"8001"・"0101" は形の検査を通る（INVALID_ARGUMENT にしない）', async () => {
    for (const no of ['6101', '8001', '0101']) {
      const r = await fetchTaxAnswer(no, makeSite());
      expect(r.code, no).not.toBe('INVALID_ARGUMENT');
    }
  });

  it('SPEC-NTA-GET-TAX-ANSWER-012 "61" と "61011" は INVALID_ARGUMENT で、DB も国税庁サイトも引かない', async () => {
    for (const no of ['61', '61011']) {
      const site = makeSite();
      const r = await fetchTaxAnswer(no, site);
      expect(r.code).toBe('INVALID_ARGUMENT');
      expect(r.tool).toBe('nta_get_tax_answer');
      expect(r.detail).toMatchObject({
        issues: [{ path: 'no', message: '半角の数字 4 桁で指定してください' }],
      });
      expect(site.requests).toHaveLength(0);
    }
  });

  it('SPEC-NTA-GET-TAX-ANSWER-012 "0101" は DB にも索引にも無ければ DOC_NOT_FOUND（v0.23.0 では先頭の桁が未対応の INVALID_ARGUMENT）', async () => {
    const site = makeSite();
    const r = await fetchTaxAnswer('0101', site);
    expect(r.code).toBe('DOC_NOT_FOUND');
    expect(site.articleRequests()).toHaveLength(0);
  });
});

describe('SPEC-NTA-GET-TAX-ANSWER-013 索引に番号が無いとき、または国税庁サイトにページが無いときは DOC_NOT_FOUND', () => {
  it('SPEC-NTA-GET-TAX-ANSWER-013 SPEC-NTA-COMMON-ERRORS-016 索引に無い 6999 は記事を取りに行かずに DOC_NOT_FOUND・retryable: false・nta_search_tax_answer の案内、detail.url は索引の URL で status は無い', async () => {
    const site = makeSite();
    const r = await fetchTaxAnswer('6999', site);
    expect(r.code).toBe('DOC_NOT_FOUND');
    expect(r.retryable).toBe(false);
    expect(r.tool).toBe('nta_get_tax_answer');
    expect(r.error).toContain('6999');
    expect(r.hint).toContain('nta_search_tax_answer');
    expect(r.next_actions).toEqual([
      {
        action: 'nta_search_tax_answer',
        reason: 'キーワード検索で正しい番号を探せます',
        example: { keyword: '<探したい語>' },
      },
    ]);
    expect(r.detail?.url).toBe(INDEX_URL);
    expect(r.detail?.status).toBeUndefined();
    expect(site.articleRequests()).toHaveLength(0);
  });

  const MISSING: Array<[label: string, make: () => Response, status: number]> = [
    ['/error/404.htm への転送', soft404, 404],
    ['HTTP 410', () => new Response('gone', { status: 410 }), 410],
    ['HTTP 404', () => new Response('nf', { status: 404 }), 404],
  ];
  for (const [label, make, status] of MISSING) {
    it(`SPEC-NTA-GET-TAX-ANSWER-013 索引にある番号の記事のページが ${label} なら DOC_NOT_FOUND（detail.status: ${status}、detail.url は記事の URL）`, async () => {
      const site = makeSite({ articleResponse: () => make() });
      const r = await fetchTaxAnswer('6101', site);
      expect(r.code).toBe('DOC_NOT_FOUND');
      expect(r.retryable).toBe(false);
      expect(r.detail?.status).toBe(status);
      expect(r.detail?.url).toBe(articleUrl('shohi', '6101'));
      expect(r.next_actions?.map((a) => a.action)).toEqual(['nta_search_tax_answer']);
    });
  }
});

describe('SPEC-NTA-GET-TAX-ANSWER-015 no は半角に揃えてから形を確かめ、揃えた値で DB と索引を引く', () => {
  it('SPEC-NTA-GET-TAX-ANSWER-015 "６１０１" は "6101" と同じ記事を返す', async () => {
    const site = makeSite();
    const r = await fetchTaxAnswer('６１０１', site);
    expect(r.code).toBeUndefined();
    expect(r.taxAnswer?.no).toBe('6101');
    expect(r.taxAnswer?.sourceUrl).toBe(articleUrl('shohi', '6101'));
  });
});

describe('SPEC-NTA-GET-TAX-ANSWER-016 国税庁の索引を DB に保存して使い回し、番号が見つからないときにだけ取り直す', () => {
  it('SPEC-NTA-GET-TAX-ANSWER-016 2 回目の呼び出しは保存した索引を使い、索引を取り直さない', async () => {
    const site = makeSite();
    await fetchTaxAnswer('6101', site);
    await fetchTaxAnswer('2010', site);
    expect(site.indexRequests()).toHaveLength(1);
    expect(site.articleRequests().map((x) => x.url)).toEqual([
      articleUrl('shohi', '6101'),
      articleUrl('shotoku', '2010'),
    ]);
  });

  it('SPEC-NTA-GET-TAX-ANSWER-016 保存した索引に無い番号は、前回の Last-Modified / ETag を付けて 1 回だけ取り直し、変わっていれば（200）探し直して記事を取る', async () => {
    const added: IndexEntry = { no: '6998', folder: 'shohi', title: '足された記事' };
    const site = makeSite({ indexAfter: [...MEASURED_INDEX, added] });
    await fetchTaxAnswer('6101', site);
    const r = await fetchTaxAnswer('6998', site);
    expect(r.code).toBeUndefined();
    expect(r.taxAnswer?.sourceUrl).toBe(articleUrl('shohi', '6998'));
    const idx = site.indexRequests();
    expect(idx).toHaveLength(2);
    expect(headerOf(idx[1].init, 'If-None-Match')).toBe(INDEX_HEADERS.ETag);
    expect(headerOf(idx[1].init, 'If-Modified-Since')).toBe(INDEX_HEADERS['Last-Modified']);
  });

  it('SPEC-NTA-GET-TAX-ANSWER-016 取り直しが 304 なら DOC_NOT_FOUND で、記事は取りに行かない', async () => {
    const site = makeSite({ indexNotModified: true });
    await fetchTaxAnswer('6101', site);
    const r = await fetchTaxAnswer('6999', site);
    expect(r.code).toBe('DOC_NOT_FOUND');
    expect(site.indexRequests()).toHaveLength(2);
    expect(site.articleRequests().map((x) => x.url)).toEqual([articleUrl('shohi', '6101')]);
  });

  it('SPEC-NTA-GET-TAX-ANSWER-016 取り直しても（200）番号が無ければ DOC_NOT_FOUND で、取り直しは 1 回だけ', async () => {
    const site = makeSite({ indexAfter: MEASURED_INDEX });
    await fetchTaxAnswer('6101', site);
    const r = await fetchTaxAnswer('6999', site);
    expect(r.code).toBe('DOC_NOT_FOUND');
    expect(site.indexRequests()).toHaveLength(2);
  });

  it('SPEC-NTA-GET-TAX-ANSWER-016 その呼び出しで索引を取った（保存が無かった）ときは、番号が無くても取り直さない', async () => {
    const site = makeSite();
    const r = await fetchTaxAnswer('6999', site);
    expect(r.code).toBe('DOC_NOT_FOUND');
    expect(site.indexRequests()).toHaveLength(1);
  });

  it('SPEC-NTA-GET-TAX-ANSWER-016 索引と記事のページのあいだは 0.3 秒あける', async () => {
    const site = makeSite();
    await fetchTaxAnswer('6101', site);
    const [index, article] = site.requests;
    expect(index.url).toBe(INDEX_URL);
    expect(article.at - index.at).toBeGreaterThanOrEqual(290);
  });
});

describe('SPEC-NTA-GET-TAX-ANSWER-017 索引の取得に失敗したときは、記事を取りに行かずに SOURCE_* を返す', () => {
  it('SPEC-NTA-GET-TAX-ANSWER-017 保存した索引が無く、索引が 503 を返し続けると SOURCE_API_ERROR・retryable: true、url は索引の URL で、記事は取りに行かない', async () => {
    const site = makeSite({ indexResponse: () => new Response('busy', { status: 503 }) });
    const r = await fetchTaxAnswer('6101', site);
    expect(r.code).toBe('SOURCE_API_ERROR');
    expect(r.retryable).toBe(true);
    expect(r.tool).toBe('nta_get_tax_answer');
    expect(r.url).toBe(INDEX_URL);
    expect(r.detail?.url).toBe(INDEX_URL);
    expect(r.detail?.status).toBe(503);
    expect(site.articleRequests()).toHaveLength(0);
  });

  for (const [label, make, status] of [
    ['/error/404.htm への転送', soft404, 404],
    ['HTTP 410', () => new Response('gone', { status: 410 }), 410],
  ] as Array<[string, () => Response, number]>) {
    it(`SPEC-NTA-GET-TAX-ANSWER-017 索引のページが ${label} なら DOC_NOT_FOUND ではなく SOURCE_API_ERROR・retryable: false・detail.status、hint に報告を求める文`, async () => {
      const site = makeSite({ indexResponse: () => make() });
      const r = await fetchTaxAnswer('6101', site);
      expect(r.code).toBe('SOURCE_API_ERROR');
      expect(r.retryable).toBe(false);
      expect(r.detail?.status).toBe(status);
      expect(r.detail?.url).toBe(INDEX_URL);
      expect(r.hint).toContain('報告');
      expect(r.next_actions).toBeUndefined();
      expect(site.articleRequests()).toHaveLength(0);
    });
  }

  it('SPEC-NTA-GET-TAX-ANSWER-017 条件付きの取り直しが失敗したときも SOURCE_* を返す', async () => {
    let calls = 0;
    const site = makeSite({
      indexResponse: () => {
        calls++;
        return calls === 1
          ? html(indexHtml(MEASURED_INDEX), INDEX_HEADERS)
          : new Response('busy', { status: 503 });
      },
    });
    await fetchTaxAnswer('6101', site);
    const r = await fetchTaxAnswer('6999', site);
    expect(r.code).toBe('SOURCE_API_ERROR');
    expect(r.retryable).toBe(true);
    expect(r.url).toBe(INDEX_URL);
  });

  it('SPEC-NTA-GET-TAX-ANSWER-017 SPEC-NTA-COMMON-ERRORS-009 索引を 200 で取ったが記事の URL が 1 件も無いときは INTERNAL_ERROR（retryable: false）で、保存してあった一覧は書き換えない', async () => {
    let calls = 0;
    const site = makeSite({
      indexResponse: () => {
        calls++;
        return calls === 1
          ? html(indexHtml(MEASURED_INDEX), INDEX_HEADERS)
          : html('<html><body><div id="bodyArea"><p>メンテナンス中</p></div></body></html>');
      },
    });
    await fetchTaxAnswer('6101', site);
    const broken = await fetchTaxAnswer('6999', site);
    expect(broken.code).toBe('INTERNAL_ERROR');
    expect(broken.retryable).toBe(false);
    expect(broken.error).toMatch(/^タックスアンサーの索引のパースに失敗: /);
    expect(broken.hint).toBe('パーサのバグまたは国税庁ページの構造変更の可能性。報告してください');
    expect(broken.url).toBe(INDEX_URL);
    expect(broken.detail?.url).toBe(INDEX_URL);
    // 保存してあった一覧はそのまま使える（索引を取らずに 2010 の URL を決める）
    const before = site.indexRequests().length;
    const ok = await fetchTaxAnswer('2010', site);
    expect(ok.code).toBeUndefined();
    expect(ok.taxAnswer?.sourceUrl).toBe(articleUrl('shotoku', '2010'));
    expect(site.indexRequests()).toHaveLength(before);
  });

  it('SPEC-NTA-COMMON-ERRORS-009 保存した索引が無く、最初に取った索引に記事の URL が 1 件も無いときも INTERNAL_ERROR', async () => {
    const site = makeSite({
      indexResponse: () => html('<html><body><div id="bodyArea"></div></body></html>'),
    });
    const r = await fetchTaxAnswer('6101', site);
    expect(r.code).toBe('INTERNAL_ERROR');
    expect(r.error).toMatch(/^タックスアンサーの索引のパースに失敗: /);
    expect(site.articleRequests()).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* #120 通信の失敗の code（SPEC-NTA-COMMON-ERRORS-018・019）                     */
/* -------------------------------------------------------------------------- */

type Failure = {
  label: string;
  respond: (init?: RequestInit) => Response | Promise<Response>;
  code: string;
  retryable: boolean;
  nextActions: string[] | undefined;
  status?: number;
  cause?: string;
  /** 合わせて何回要求するか（取り直しを含む） */
  attempts: number;
  hint: string;
};

const FAILURES: Failure[] = [
  {
    label: 'HTTP 429',
    respond: () => new Response('too many', { status: 429 }),
    code: 'SOURCE_RATE_LIMITED',
    retryable: true,
    nextActions: ['retry_later'],
    status: 429,
    attempts: 1,
    hint: '間隔',
  },
  {
    label: '30 秒を過ぎても応答しない（4 回とも）',
    respond: (init) => hang(init),
    code: 'SOURCE_TIMEOUT',
    retryable: true,
    nextActions: ['retry_later'],
    attempts: 4,
    hint: '30 秒',
  },
  {
    label: 'HTTP 503（4 回とも）',
    respond: () => new Response('busy', { status: 503 }),
    code: 'SOURCE_API_ERROR',
    retryable: true,
    nextActions: ['retry_later'],
    status: 503,
    attempts: 4,
    hint: '時間をおいて',
  },
  {
    label: 'HTTP 403',
    respond: () => new Response('forbidden', { status: 403 }),
    code: 'SOURCE_API_ERROR',
    retryable: false,
    nextActions: undefined,
    status: 403,
    attempts: 1,
    hint: 'HTTP 403',
  },
  {
    label: 'HTTP 400',
    respond: () => new Response('bad', { status: 400 }),
    code: 'SOURCE_API_ERROR',
    retryable: false,
    nextActions: undefined,
    status: 400,
    attempts: 1,
    hint: 'HTTP 400',
  },
  {
    label: 'fetch failed・cause.code: "ENOTFOUND"（4 回とも）',
    respond: () => {
      throw connectError('ENOTFOUND');
    },
    code: 'SOURCE_UNAVAILABLE',
    retryable: true,
    nextActions: ['retry_later'],
    cause: 'ENOTFOUND',
    attempts: 4,
    hint: 'DNS',
  },
  {
    label: 'fetch failed・cause.code が 019 の表に無い（EPROTO。4 回とも）',
    respond: () => {
      throw connectError('EPROTO');
    },
    code: 'SOURCE_API_ERROR',
    retryable: true,
    nextActions: ['retry_later'],
    attempts: 4,
    hint: '時間をおいて',
  },
];

function expectFailure(r: Body, f: Failure, tool: string, url: string): void {
  expect(r.code).toBe(f.code);
  expect(r.retryable).toBe(f.retryable);
  expect(r.tool).toBe(tool);
  expect(r.error).toMatch(/^国税庁サイトからの取得に失敗: /);
  expect(r.url).toBe(url);
  expect(r.detail?.url).toBe(url);
  if (f.status !== undefined) expect(r.detail?.status).toBe(f.status);
  else expect(r.detail?.status).toBeUndefined();
  if (f.cause !== undefined) expect(r.detail?.cause).toBe(f.cause);
  if (f.code === 'SOURCE_API_ERROR' && f.status === undefined) {
    // そのほかのネットワークの失敗: detail.cause に例外の文
    expect(typeof r.detail?.cause).toBe('string');
  }
  expect(r.next_actions?.map((a) => a.action)).toEqual(f.nextActions);
  expect(r.hint).toContain(f.hint);
}

describe('SPEC-NTA-COMMON-ERRORS-018 SPEC-NTA-GET-QA-015 nta_get_qa: 国税庁サイトへの要求の終わり方で code・retryable・取り直しを決める', () => {
  const QA_URL = `${NTA}/law/shitsugi/shohi/02/19.htm`;
  for (const f of FAILURES) {
    it(`SPEC-NTA-COMMON-ERRORS-018 SPEC-NTA-GET-QA-015 ${f.label} → ${f.code}・retryable: ${f.retryable}・要求 ${f.attempts} 回`, async () => {
      const fetchImpl = vi.fn(async (_i: string | URL | Request, init?: RequestInit) =>
        f.respond(init)
      );
      const r = (await getQa(
        { topic: 'shohi', category: '02', id: '19' },
        { fetchImpl: fetchImpl as unknown as typeof fetch, dbPath, ...FAST }
      )) as Body;
      expectFailure(r, f, 'nta_get_qa', QA_URL);
      expect(fetchImpl).toHaveBeenCalledTimes(f.attempts);
    });
  }
});

describe('SPEC-NTA-COMMON-ERRORS-018 SPEC-NTA-GET-TAX-ANSWER-014 nta_get_tax_answer: 記事のページの取得の失敗', () => {
  for (const f of FAILURES) {
    it(`SPEC-NTA-COMMON-ERRORS-018 SPEC-NTA-GET-TAX-ANSWER-014 ${f.label} → ${f.code}・retryable: ${f.retryable}・記事の要求 ${f.attempts} 回`, async () => {
      const site = makeSite({ articleResponse: (_u, init) => f.respond(init) });
      const r = await fetchTaxAnswer('6101', site);
      expectFailure(r, f, 'nta_get_tax_answer', articleUrl('shohi', '6101'));
      expect(site.articleRequests()).toHaveLength(f.attempts);
    });
  }
});

describe('SPEC-NTA-COMMON-ERRORS-018 SPEC-NTA-GET-TAX-ANSWER-017 nta_get_tax_answer: 索引の取得の失敗も同じ表', () => {
  for (const f of FAILURES) {
    it(`SPEC-NTA-COMMON-ERRORS-018 SPEC-NTA-GET-TAX-ANSWER-017 索引が ${f.label} → ${f.code}・retryable: ${f.retryable}`, async () => {
      const site = makeSite({ indexResponse: (init) => f.respond(init) });
      const r = await fetchTaxAnswer('6101', site);
      expectFailure(r, f, 'nta_get_tax_answer', INDEX_URL);
      expect(site.articleRequests()).toHaveLength(0);
    });
  }
});

describe('SPEC-NTA-COMMON-ERRORS-018 SPEC-NTA-GET-TSUTATSU-009 nta_get_tsutatsu: 目次・候補ページの取得の失敗', () => {
  // 消基通は番号から組み立てた候補ページ（/shohi/05/01.htm）を最初に取る
  const SHOHI_PAGE = `${NTA}/law/tsutatsu/kihon/shohi/05/01.htm`;
  for (const f of FAILURES) {
    it(`SPEC-NTA-COMMON-ERRORS-018 SPEC-NTA-GET-TSUTATSU-009 候補ページが ${f.label} → ${f.code}・retryable: ${f.retryable}・tool: nta_get_tsutatsu`, async () => {
      const fetchImpl = vi.fn(async (_i: string | URL | Request, init?: RequestInit) =>
        f.respond(init)
      );
      const r = (await getTsutatsu(
        { name: '消基通', clause: '5-1-9', format: 'json' },
        { fetchImpl: fetchImpl as unknown as typeof fetch, dbPath, pageIntervalMs: 0, ...FAST }
      )) as Body;
      expectFailure(r, f, 'nta_get_tsutatsu', SHOHI_PAGE);
      expect(fetchImpl).toHaveBeenCalledTimes(f.attempts);
    });
  }

  const HOJIN_TOC = `${NTA}/law/tsutatsu/kihon/hojin/01.htm`;
  for (const [label, make, status] of [
    ['HTTP 404', () => new Response('nf', { status: 404 }), 404],
    ['HTTP 410', () => new Response('gone', { status: 410 }), 410],
    ['/error/404.htm への転送', soft404, 404],
  ] as Array<[string, () => Response, number]>) {
    it(`SPEC-NTA-GET-TSUTATSU-009 目次のページそのものが ${label} なら SOURCE_API_ERROR・retryable: false・detail.status: ${status}（v0.23.0 では retryable: true）`, async () => {
      const fetchImpl = vi.fn(async () => make());
      const r = (await getTsutatsu(
        { name: '法基通', clause: '9-2-1', format: 'json' },
        { fetchImpl: fetchImpl as unknown as typeof fetch, dbPath, pageIntervalMs: 0, ...FAST }
      )) as Body;
      expect(r.code).toBe('SOURCE_API_ERROR');
      expect(r.retryable).toBe(false);
      expect(r.tool).toBe('nta_get_tsutatsu');
      expect(r.url).toBe(HOJIN_TOC);
      expect(r.detail).toMatchObject({ status, url: HOJIN_TOC });
      expect(r.next_actions).toBeUndefined();
    });
  }
});

describe('SPEC-NTA-COMMON-ERRORS-019 接続できないときは cause.code を見て SOURCE_UNAVAILABLE を返す', () => {
  for (const code of ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT']) {
    it(`SPEC-NTA-COMMON-ERRORS-019 cause.code が ${code} なら SOURCE_UNAVAILABLE・retryable: true・detail.cause: "${code}"`, async () => {
      const site = makeSite({
        articleResponse: () => {
          throw connectError(code);
        },
      });
      const r = await fetchTaxAnswer('6101', site);
      expect(r.code).toBe('SOURCE_UNAVAILABLE');
      expect(r.retryable).toBe(true);
      expect(r.detail?.cause).toBe(code);
      expect(site.articleRequests()).toHaveLength(4);
    });
  }
});

describe('SPEC-NTA-COMMON-ERRORS-016 ページが無いことは DOC_NOT_FOUND、通信の失敗は SOURCE_*', () => {
  it('SPEC-NTA-COMMON-ERRORS-016 索引にある番号で記事のページが 503 を返し続けると SOURCE_API_ERROR・retryable: true', async () => {
    const site = makeSite({ articleResponse: () => new Response('busy', { status: 503 }) });
    const r = await fetchTaxAnswer('6101', site);
    expect(r.code).toBe('SOURCE_API_ERROR');
    expect(r.retryable).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* #131 事務運営指針の legal_status.note                                        */
/* -------------------------------------------------------------------------- */

const JIMU_UNEI_NOTE =
  '通達・事務運営指針は行政内部文書であり、納税者・裁判所には直接的拘束力なし。ただし税務署員は職務として守る義務あり（最高裁 昭和43.12.24）';

function seedJimuUnei(): void {
  const db = new Database(dbPath);
  initSchema(db);
  const stmt = db.prepare(
    `INSERT INTO document(doc_type, doc_id, taxonomy, title, source_url, fetched_at, full_text, attached_pdfs_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, '[]')`
  );
  const now = new Date().toISOString();
  stmt.run(
    'jimu-unei',
    'shozei/090401',
    'shozei',
    '書面添付制度の運用について',
    `${NTA}/law/jimu-unei/shozei/090401/01.htm`,
    now,
    '税理士法第33条の2に規定する書面添付制度の運用について定める。'
  );
  stmt.run(
    'kaisei',
    '0026003-067',
    'shohi',
    '消費税法基本通達の一部改正について',
    `${NTA}/law/tsutatsu/kihon/shohi/kaisei/0026003-067/index.htm`,
    now,
    '消費税法基本通達の一部を改正する。'
  );
  db.close();
}

describe('SPEC-NTA-SEARCH-JIMU-UNEI-002 SPEC-NTA-SEARCH-JIMU-UNEI-003 nta_search_jimu_unei の legal_status.note は nta_get_jimu_unei と同じ文', () => {
  it('SPEC-NTA-SEARCH-JIMU-UNEI-002 キーワードに合わない「滞納処分」の該当なしの応答の legal_status は binds_tax_office: true と事務運営指針を名指しする note（v0.23.0 では「通達は行政内部文書。」で始まる文）', async () => {
    seedJimuUnei();
    const r = (await handleNtaSearchJimuUnei({ keyword: '滞納処分' }, { dbPath })) as Body;
    expect(r.code).toBeUndefined();
    expect(r.results).toEqual([]);
    expect(r.legal_status).toEqual({
      binds_citizens: false,
      binds_courts: false,
      binds_tax_office: true,
      note: JIMU_UNEI_NOTE,
    });
  });

  it('SPEC-NTA-SEARCH-JIMU-UNEI-003 SPEC-NTA-SEARCH-RULES-015 キーワードに合う文書があるときの legal_status も同じ値', async () => {
    seedJimuUnei();
    const r = (await handleNtaSearchJimuUnei({ keyword: '書面添付' }, { dbPath })) as Body;
    expect((r.results ?? []).length).toBe(1);
    expect(r.legal_status?.note).toBe(JIMU_UNEI_NOTE);
    expect(r.legal_status?.binds_tax_office).toBe(true);
  });
});

describe('SPEC-NTA-GET-JIMU-UNEI-005 nta_get_jimu_unei の json の legal_status.note', () => {
  it('SPEC-NTA-GET-JIMU-UNEI-005 { docId: "shozei/090401", format: "json" } の legal_status.note は事務運営指針を名指しする文', async () => {
    seedJimuUnei();
    const r = (await handleNtaGetJimuUnei(
      { docId: 'shozei/090401', format: 'json' },
      { dbPath }
    )) as Body;
    expect(r.legal_status?.note).toBe(JIMU_UNEI_NOTE);
  });
});

describe('SPEC-NTA-INSPECT-PDF-META-016 legal_status は docType ごとの資料の位置付け', () => {
  it('SPEC-NTA-INSPECT-PDF-META-016 docType: "jimu-unei" の note は nta_get_jimu_unei の json と同じ値（v0.23.0 では kaisei と同じ文）', async () => {
    seedJimuUnei();
    const r = (await handleNtaInspectPdfMeta(
      { docType: 'jimu-unei', docId: 'shozei/090401' },
      { dbPath, filesDir: dir }
    )) as Body;
    expect(r.code).toBeUndefined();
    expect(r.legal_status).toEqual({
      binds_citizens: false,
      binds_courts: false,
      binds_tax_office: true,
      note: JIMU_UNEI_NOTE,
    });
  });

  it('SPEC-NTA-INSPECT-PDF-META-016 docType: "kaisei" の note は今までどおり「通達は行政内部文書」で始まる', async () => {
    seedJimuUnei();
    const r = (await handleNtaInspectPdfMeta(
      { docType: 'kaisei', docId: '0026003-067' },
      { dbPath, filesDir: dir }
    )) as Body;
    expect(r.legal_status?.note?.startsWith('通達は行政内部文書')).toBe(true);
    expect(r.legal_status?.note).not.toBe(JIMU_UNEI_NOTE);
  });
});
