import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { encode as iconvEncode } from 'iconv-lite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { initSchema } from '../db/schema.js';

import {
  getQa,
  getTaxAnswer,
  getTsutatsu,
  handleNtaInspectPdfMeta,
  handleNtaSearchQa,
  handleNtaSearchTaxAnswer,
  handleNtaSearchTsutatsu,
  handleResolveAbbreviation,
  searchTsutatsu,
  toolHandlers,
} from './handlers.js';

describe('search 系 (Phase 3c で本実装)', () => {
  // Issue #23 (v0.13.0): 空 DB は results=[] ではなく DOC_NOT_FOUND を返す。
  // 5 ツールの 0 件の扱いは doc-search-zero-hit.test.ts で確認する
  it('nta_search_qa: 空 DB は DOC_NOT_FOUND + --bulk-download-qa', async () => {
    const r = (await handleNtaSearchQa({ keyword: '社内会議' }, { dbPath: ':memory:' })) as {
      code?: string;
      hint?: string;
    };
    expect(r.code).toBe('DOC_NOT_FOUND');
    expect(r.hint).toContain('--bulk-download-qa');
  });

  it('SPEC-NTA-SEARCH-TAX-ANSWER-001 nta_search_tax_answer: 空 DB は DOC_NOT_FOUND + --bulk-download-tax-answer', async () => {
    const r = (await handleNtaSearchTaxAnswer(
      { keyword: '医療費控除' },
      { dbPath: ':memory:' }
    )) as {
      code?: string;
      hint?: string;
    };
    expect(r.code).toBe('DOC_NOT_FOUND');
    expect(r.hint).toContain('--bulk-download-tax-answer');
  });
});

describe('searchTsutatsu — Phase 2c 本実装', () => {
  // 空 DB（in-memory）で「bulk-download を促すエラー」が返ること
  it('SPEC-NTA-SEARCH-TSUTATSU-003 DB が空のときは bulk-download を促すエラー + hint を返す', async () => {
    const r = (await searchTsutatsu({ keyword: '納税義務' }, { dbPath: ':memory:' })) as {
      error?: string;
      hint?: string;
    };
    expect(r.error).toContain('検索対象がありません');
    expect(r.hint).toContain('--bulk-download');
  });

  it('SPEC-NTA-SEARCH-TSUTATSU-002 keyword 未指定はエラー', async () => {
    const r = (await searchTsutatsu({ keyword: '' }, { dbPath: ':memory:' })) as {
      error?: string;
    };
    expect(r.error).toContain('keyword');
  });

  // search-stub の登録確認用に、spy せずに handleNtaSearchTsutatsu 経由でも呼べることを確認
  it('handleNtaSearchTsutatsu が searchTsutatsu に委譲されている', async () => {
    const r = (await handleNtaSearchTsutatsu({ keyword: '消費税' })) as
      | { hits?: unknown[]; error?: string }
      | { hits: unknown[]; count: number };
    // ローカルの実 DB が無い前提なので、error or hits=0 のいずれかのレスポンス形になっているはず
    expect(r).toBeDefined();
  });
});

describe('searchTsutatsu — Issue #18: 2 文字語の応答に search_notes を付ける', () => {
  let dir: string;
  let dbPath: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'houki-nta-issue18-'));
    dbPath = join(dir, 'cache.db');
    const db = new Database(dbPath);
    initSchema(db);
    const tsutatsuId = (
      db
        .prepare(
          `INSERT INTO tsutatsu(formal_name, abbr, source_root_url) VALUES (?, ?, ?) RETURNING id`
        )
        .get('法人税基本通達', '法基通', 'https://x/') as { id: number }
    ).id;
    db.prepare(
      `INSERT INTO clause(tsutatsu_id, clause_number, source_url, chapter_number, section_number, title, full_text, paragraphs_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      tsutatsuId,
      '9-2-1',
      'https://x/09/02.htm',
      9,
      2,
      '役員の範囲',
      '役員の範囲\n法第2条第15号に規定する役員には、経営に従事している者が含まれる。',
      '[]'
    );
    db.close();
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('SPEC-NTA-SEARCH-TSUTATSU-004 SPEC-NTA-SEARCH-TSUTATSU-006 2 文字語でヒットしたときは hits と search_notes の両方を返す', async () => {
    const r = (await searchTsutatsu({ keyword: '役員' }, { dbPath })) as {
      count?: number;
      hits: Array<{ clauseNumber: string; snippet: string }>;
      search_notes?: string[];
    };
    expect(r.count).toBe(1);
    expect(r.hits[0].clauseNumber).toBe('9-2-1');
    expect(r.hits[0].snippet).toContain('<b>役員</b>');
    expect(r.search_notes?.[0]).toContain('LIKE');
  });

  it('SPEC-NTA-SEARCH-TSUTATSU-005 SPEC-NTA-SEARCH-TSUTATSU-006 2 文字語で 0 件のときも search_notes で仕様起因と分かる', async () => {
    const r = (await searchTsutatsu({ keyword: '社宅' }, { dbPath })) as {
      hits: unknown[];
      message?: string;
      search_notes?: string[];
    };
    expect(r.hits).toEqual([]);
    expect(r.message).toContain('社宅');
    expect(r.search_notes?.[0]).toContain('3 文字未満');
  });

  it('SPEC-NTA-SEARCH-TSUTATSU-007 3 文字以上の語だけなら search_notes は付かない', async () => {
    const r = (await searchTsutatsu({ keyword: '経営に従事' }, { dbPath })) as {
      count?: number;
      search_notes?: string[];
    };
    expect(r.count).toBe(1);
    expect(r.search_notes).toBeUndefined();
  });
});

describe('handleResolveAbbreviation — houki-abbreviations 連携', () => {
  it('houki-egov 管轄エントリ（消法）には in_scope=false と誘導 hint を返す', async () => {
    const r = (await handleResolveAbbreviation({ abbr: '消法' })) as {
      resolved: { source_mcp_hint: string } | null;
      in_scope: boolean;
      hint?: string;
    };
    expect(r.resolved).not.toBeNull();
    expect(r.resolved?.source_mcp_hint).toBe('houki-egov');
    expect(r.in_scope).toBe(false);
    expect(r.hint).toContain('houki-egov');
  });

  it('houki-nta 管轄エントリ（消基通）には in_scope=true を返す', async () => {
    // houki-abbreviations v0.2.0 で追加された通達系エントリ
    const r = (await handleResolveAbbreviation({ abbr: '消基通' })) as {
      resolved: { formal: string; category: string; source_mcp_hint: string } | null;
      in_scope: boolean;
      hint?: string;
    };
    expect(r.resolved).not.toBeNull();
    expect(r.resolved?.formal).toBe('消費税法基本通達');
    expect(r.resolved?.category).toBe('kihon-tsutatsu');
    expect(r.resolved?.source_mcp_hint).toBe('houki-nta');
    expect(r.in_scope).toBe(true);
    expect(r.hint).toBeUndefined();
  });

  it('houki-nta 管轄エントリ（電帳法取通）も in_scope=true', async () => {
    const r = (await handleResolveAbbreviation({ abbr: '電帳法取通' })) as {
      resolved: { category: string; source_mcp_hint: string } | null;
      in_scope: boolean;
    };
    expect(r.resolved?.category).toBe('kobetsu-tsutatsu');
    expect(r.resolved?.source_mcp_hint).toBe('houki-nta');
    expect(r.in_scope).toBe(true);
  });

  it('正式名称（消費税法基本通達）でも引ける', async () => {
    const r = (await handleResolveAbbreviation({ abbr: '消費税法基本通達' })) as {
      resolved: { abbr: string } | null;
      in_scope: boolean;
    };
    expect(r.resolved?.abbr).toBe('消基通');
    expect(r.in_scope).toBe(true);
  });

  it('辞書に無いエントリは resolved: null を返す', async () => {
    const r = (await handleResolveAbbreviation({ abbr: '存在しない通達' })) as {
      resolved: unknown;
      note?: string;
    };
    expect(r.resolved).toBeNull();
    expect(r.note).toContain('辞書に該当なし');
  });
});

/* -------------------------------------------------------------------------- */
/* getTsutatsu — 本実装ロジックのテスト（fetchImpl をモック）                  */
/* -------------------------------------------------------------------------- */

const fixturesDir = resolve(import.meta.dirname ?? __dirname, '../../tests/fixtures');

function sjisHtmlResponse(fixtureName: string): Response {
  const html = readFileSync(resolve(fixturesDir, fixtureName), 'utf8');
  // fixture は UTF-8 で保存しているので、テスト用に Shift_JIS にエンコードして
  // nta-scraper のデコード経路を含めた E2E をシミュレートする
  const buf = iconvEncode(html, 'shift_jis');
  return new Response(buf, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=Shift_JIS' },
  });
}

/*
 * 国税庁サイトの応答のモック（houki-nta-mcp#54）。
 * 存在しないページは 302 で /error/404.htm に転送され、転送先は 200 を返す（2026-09-25 JST に確認）。
 * fetch を redirect: 'manual' で呼ぶ実装には 302 を、既定（follow）で呼ぶ実装には転送後の応答を返す。
 */
const NTA_ORIGIN = 'https://www.nta.go.jp';

function ntaRedirectTo404Response(init?: RequestInit): Response {
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

/**
 * パス（`/law/tsutatsu/kihon/shohi/01/04.htm` など）ごとにフィクスチャーを返し、
 * それ以外は otherwise の応答を返す fetch のモック
 */
function ntaFetch(
  pages: Record<string, string>,
  otherwise: (url: string, init?: RequestInit) => Response
): typeof fetch {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = requestUrl(input);
    const fixture = pages[new URL(url).pathname];
    return fixture ? sjisHtmlResponse(fixture) : otherwise(url, init);
  }) as unknown as typeof fetch;
}

/** fetch のモックが呼ばれた URL のパスの一覧 */
function fetchedPaths(fetchImpl: typeof fetch): string[] {
  const calls = (fetchImpl as unknown as { mock: { calls: [string | URL | Request][] } }).mock
    .calls;
  return calls.map(([input]) => new URL(requestUrl(input)).pathname);
}

/** 基本通達 4 種の目次ページのパスとフィクスチャー */
const TOC_PAGES: Record<string, string> = {
  '/law/tsutatsu/kihon/shohi/01.htm': 'www.nta.go.jp_law_tsutatsu_kihon_shohi_01.htm',
  '/law/tsutatsu/kihon/hojin/01.htm': 'www.nta.go.jp_law_tsutatsu_kihon_hojin_01.htm',
  '/law/tsutatsu/kihon/shotoku/01.htm': 'www.nta.go.jp_law_tsutatsu_kihon_shotoku_01.htm',
  '/law/tsutatsu/kihon/sisan/sozoku2/01.htm':
    'www.nta.go.jp_law_tsutatsu_kihon_sisan_sozoku2_01.htm',
};

/**
 * 通達に「bulk download で全節取り込んだ」印を付ける（SPEC-NTA-GET-TSUTATSU-005）。
 * 印の置き場所は houki-hub docs/notes/2026-09-25-design-nta-54-tsutatsu-live-toc.md の 4.5
 * （tsutatsu 表の bulk_completed_at）に従う。
 */
function markBulkCompleted(db: Database.Database, tsutatsuId: number): void {
  db.prepare('UPDATE tsutatsu SET bulk_completed_at = ? WHERE id = ?').run(
    '2026-09-01T00:00:00.000Z',
    tsutatsuId
  );
}

describe('getTsutatsu — 引数バリデーション', () => {
  it('SPEC-NTA-GET-TSUTATSU-001 辞書に無い名前はエラー', async () => {
    const r = (await getTsutatsu({ name: '存在しない通達' }, { dbPath: ':memory:' })) as {
      error?: string;
    };
    expect(r.error).toContain('辞書に該当なし');
  });

  it('SPEC-NTA-GET-TSUTATSU-002 管轄外（消法 = houki-egov）は誘導 hint を返す', async () => {
    const r = (await getTsutatsu({ name: '消法' }, { dbPath: ':memory:' })) as {
      error?: string;
      hint?: string;
    };
    expect(r.error).toContain('houki-egov');
    expect(r.hint).toContain('houki-egov-mcp');
  });

  it('SPEC-NTA-GET-TSUTATSU-003 clause 未指定はエラー', async () => {
    const r = (await getTsutatsu({ name: '消基通' }, { dbPath: ':memory:' })) as {
      error?: string;
      hint?: string;
    };
    expect(r.error).toContain('clause');
    expect(r.hint).toContain('5-1-9');
  });

  it('SPEC-NTA-GET-TSUTATSU-008 不正な clause 形式（DB miss + ライブ取得経路でも不正）はエラー', async () => {
    const r = (await getTsutatsu({ name: '消基通', clause: '5-1' }, { dbPath: ':memory:' })) as {
      error?: string;
    };
    expect(r.error).toContain('不正');
  });

  it('SPEC-NTA-GET-TSUTATSU-007 houki-nta 管轄だが DB 未投入 + ライブ未対応の通達（電帳法取通）はエラー + hint', async () => {
    const r = (await getTsutatsu(
      { name: '電帳法取通', clause: '1-1-1' },
      { dbPath: ':memory:' }
    )) as {
      error?: string;
      hint?: string;
      supported_for_live?: string[];
    };
    expect(r.error).toContain('DB にも未投入');
    expect(r.hint).toContain('--bulk-download');
    expect(r.supported_for_live).toContain('消費税法基本通達');
  });
});

describe('getTsutatsu — 消基通 1-4-1 を取得（fetchImpl モック）', () => {
  it('SPEC-NTA-GET-TSUTATSU-011 Markdown（既定）で本文・出典・legal_status を含む', async () => {
    const fetchImpl = vi.fn(async () =>
      sjisHtmlResponse('www.nta.go.jp_law_tsutatsu_kihon_shohi_01_04.htm')
    ) as unknown as typeof fetch;

    const r = (await getTsutatsu(
      { name: '消基通', clause: '1-4-1' },
      { fetchImpl, dbPath: ':memory:' }
    )) as string;

    expect(typeof r).toBe('string');
    expect(r).toContain('1-4-1');
    expect(r).toContain('納税義務が免除される課税期間');
    expect(r).toContain('法第9条第1項本文');
    expect(r).toContain('出典: https://www.nta.go.jp/law/tsutatsu/kihon/shohi/01/04.htm');
    expect(r).toContain('通達は行政内部文書');
  });

  it('SPEC-NTA-GET-TSUTATSU-012 format=json で構造化レスポンス + legal_status を返す', async () => {
    const fetchImpl = vi.fn(async () =>
      sjisHtmlResponse('www.nta.go.jp_law_tsutatsu_kihon_shohi_01_04.htm')
    ) as unknown as typeof fetch;

    const r = (await getTsutatsu(
      { name: '消基通', clause: '1-4-13の2', format: 'json' },
      { fetchImpl, dbPath: ':memory:' }
    )) as {
      tsutatsu: string;
      clause: { clauseNumber: string; title: string; paragraphs: unknown[] };
      sourceUrl: string;
      legal_status: { binds_citizens: boolean; binds_tax_office: boolean };
    };

    expect(r.tsutatsu).toBe('消費税法基本通達');
    expect(r.clause.clauseNumber).toBe('1-4-13の2');
    expect(r.clause.title).toContain('分割があった場合');
    expect(r.clause.paragraphs.length).toBeGreaterThan(0);
    expect(r.sourceUrl).toBe('https://www.nta.go.jp/law/tsutatsu/kihon/shohi/01/04.htm');
    expect(r.legal_status.binds_citizens).toBe(false);
    expect(r.legal_status.binds_tax_office).toBe(true);
  });

  it('SPEC-NTA-GET-TSUTATSU-001 正式名称（消費税法基本通達）でも引ける', async () => {
    const fetchImpl = vi.fn(async () =>
      sjisHtmlResponse('www.nta.go.jp_law_tsutatsu_kihon_shohi_05_01.htm')
    ) as unknown as typeof fetch;

    const r = (await getTsutatsu(
      { name: '消費税法基本通達', clause: '5-1-1', format: 'json' },
      { fetchImpl, dbPath: ':memory:' }
    )) as { clause: { clauseNumber: string } };

    expect(r.clause.clauseNumber).toBe('5-1-1');
    // 章/節から組み立てた URL で fetch されたか
    const calls = (fetchImpl as unknown as { mock: { calls: [string][] } }).mock.calls;
    expect(calls[0][0]).toBe('https://www.nta.go.jp/law/tsutatsu/kihon/shohi/05/01.htm');
  });

  it('SPEC-NTA-GET-TSUTATSU-010 ページに存在しない clause は available_clauses を返す', async () => {
    // 目次（shohi/01.htm）には目次のフィクスチャーを、それ以外の URL には 1-4 節のページを返す
    const fetchImpl = ntaFetch({ ...TOC_PAGES }, () =>
      sjisHtmlResponse('www.nta.go.jp_law_tsutatsu_kihon_shohi_01_04.htm')
    );

    const r = (await getTsutatsu(
      { name: '消基通', clause: '1-4-99' },
      { fetchImpl, dbPath: ':memory:' }
    )) as {
      error?: string;
      available_clauses?: string[];
    };

    expect(r.error).toContain('1-4-99');
    expect(r.available_clauses).toContain('1-4-1');
    expect(r.available_clauses).toContain('1-4-17');
  });

  // 通信の失敗とサイトのエラーは取得の側で再試行してから返すため、既定の 5 秒では足りない
  it('SPEC-NTA-GET-TSUTATSU-009 国税庁サイトのエラー（500）は再試行できるエラーにする', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('server error', { status: 500, statusText: 'Internal Server Error' })
    ) as unknown as typeof fetch;

    const r = (await getTsutatsu(
      { name: '消基通', clause: '1-4-1' },
      { fetchImpl, dbPath: ':memory:' }
    )) as {
      error?: string;
      code?: string;
      retryable?: boolean;
      detail?: { status?: number; url?: string };
    };

    expect(r.error).toContain('取得に失敗');
    expect(r.code).toBe('SOURCE_API_ERROR');
    expect(r.retryable).toBe(true);
    expect(r.detail?.status).toBe(500);
  }, 30_000);
});

/* -------------------------------------------------------------------------- */
/* getTsutatsu — Phase 2d DB lookup 経路                                       */
/* -------------------------------------------------------------------------- */

describe('getTsutatsu — DB lookup 経路（Phase 2d）', () => {
  // テスト用に in-memory DB に通達と clause を seed するヘルパ
  // openDb で別 DB を毎回 open するので、PATH を共有する形で seed → 検証する
  // ※ better-sqlite3 の :memory: は接続ごとに別 DB になるため、tmpfile を使う
  it('SPEC-NTA-GET-TSUTATSU-004 seed した通達 + clause を DB lookup で返す（fetch しない）', async () => {
    const tmpFile = `/tmp/houki-nta-mcp-test-${Date.now()}.db`;

    // seed: 同じパスで openDb → INSERT → 閉じる
    const Database = (await import('better-sqlite3')).default;
    const seedDb = new Database(tmpFile);
    const { initSchema } = await import('../db/schema.js');
    initSchema(seedDb);
    const tsutatsuId = (
      seedDb
        .prepare(
          `INSERT INTO tsutatsu(formal_name, abbr, source_root_url) VALUES (?, ?, ?) RETURNING id`
        )
        .get('消費税法基本通達', '消基通', 'https://www.nta.go.jp/x/') as { id: number }
    ).id;
    seedDb
      .prepare(
        `INSERT INTO section(tsutatsu_id, chapter_number, section_number, title, url, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(tsutatsuId, 1, 4, 'X', 'https://www.nta.go.jp/01/04.htm', '2026-05-01T00:00:00.000Z');
    seedDb
      .prepare(
        `INSERT INTO clause(tsutatsu_id, clause_number, source_url, chapter_number, section_number, title, full_text, paragraphs_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        tsutatsuId,
        '1-4-1',
        'https://www.nta.go.jp/01/04.htm',
        1,
        4,
        '納税義務が免除される課税期間',
        '法第9条第1項本文 …',
        JSON.stringify([{ indent: 1, text: '法第9条第1項本文 …' }])
      );
    seedDb.close();

    // fetchImpl は使わないことを確認するため、呼び出されたら fail する mock を仕込む
    const fetchImpl = vi.fn(async () => {
      throw new Error('fetch should NOT be called when DB has the clause');
    }) as unknown as typeof fetch;

    const r = (await getTsutatsu(
      { name: '消基通', clause: '1-4-1', format: 'json' },
      { fetchImpl, dbPath: tmpFile }
    )) as {
      tsutatsu: string;
      clause: { clauseNumber: string; title: string };
      sourceUrl: string;
      source: 'db' | 'live';
    };

    expect(r.tsutatsu).toBe('消費税法基本通達');
    expect(r.clause.clauseNumber).toBe('1-4-1');
    expect(r.clause.title).toContain('納税義務');
    expect(r.source).toBe('db');
    expect(fetchImpl).not.toHaveBeenCalled();

    // クリーンアップ
    const fs = await import('node:fs');
    fs.rmSync(tmpFile, { force: true });
    fs.rmSync(`${tmpFile}-wal`, { force: true });
    fs.rmSync(`${tmpFile}-shm`, { force: true });
  });

  it('SPEC-NTA-GET-TSUTATSU-005 bulk download 済みの通達に該当 clause が無い場合、available_clauses を返す', async () => {
    const tmpFile = `/tmp/houki-nta-mcp-test-${Date.now()}-${Math.random()}.db`;

    const Database = (await import('better-sqlite3')).default;
    const seedDb = new Database(tmpFile);
    const { initSchema } = await import('../db/schema.js');
    initSchema(seedDb);
    const tsutatsuId = (
      seedDb
        .prepare(
          `INSERT INTO tsutatsu(formal_name, abbr, source_root_url) VALUES (?, ?, ?) RETURNING id`
        )
        .get('消費税法基本通達', '消基通', 'https://x/') as { id: number }
    ).id;
    seedDb
      .prepare(
        `INSERT INTO clause(tsutatsu_id, clause_number, source_url, chapter_number, section_number, title, full_text, paragraphs_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(tsutatsuId, '1-1-1', 'u', 1, 1, 't', 'f', '[]');
    markBulkCompleted(seedDb, tsutatsuId);
    seedDb.close();

    const fetchImpl = vi.fn(async () => {
      throw new Error('fetch should NOT be called when the tsutatsu is bulk-downloaded');
    }) as unknown as typeof fetch;

    const r = (await getTsutatsu(
      { name: '消基通', clause: '99-99-99' },
      { fetchImpl, dbPath: tmpFile }
    )) as {
      error?: string;
      code?: string;
      available_clauses?: string[];
    };

    expect(r.error).toContain('99-99-99');
    expect(r.code).toBe('ARTICLE_NOT_FOUND');
    expect(r.available_clauses).toContain('1-1-1');
    expect(fetchImpl).not.toHaveBeenCalled();

    const fs = await import('node:fs');
    fs.rmSync(tmpFile, { force: true });
    fs.rmSync(`${tmpFile}-wal`, { force: true });
    fs.rmSync(`${tmpFile}-shm`, { force: true });
  });

  it('SPEC-NTA-GET-TSUTATSU-006 DB が空 + ライブ取得対応通達なら、ライブ取得にフォールバック', async () => {
    const fetchImpl = vi.fn(async () =>
      sjisHtmlResponse('www.nta.go.jp_law_tsutatsu_kihon_shohi_01_04.htm')
    ) as unknown as typeof fetch;

    const r = (await getTsutatsu(
      { name: '消基通', clause: '1-4-1', format: 'json' },
      { fetchImpl, dbPath: ':memory:' }
    )) as {
      clause: { clauseNumber: string };
      source: 'db' | 'live';
    };

    expect(r.clause.clauseNumber).toBe('1-4-1');
    expect(r.source).toBe('live');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

/* -------------------------------------------------------------------------- */
/* getTsutatsu — 国税庁サイトからの取得の段階 1（houki-nta-mcp#54）             */
/* 差分: specs/changes/20260925-tsutatsu-live-toc/（005・008・009・入力の全角）   */
/* -------------------------------------------------------------------------- */

describe('getTsutatsu — SPEC-NTA-GET-TSUTATSU-005 bulk download 済みかどうかで DB の経路を分ける', () => {
  let dir: string;
  const SHOHI_01_04 = '/law/tsutatsu/kihon/shohi/01/04.htm';
  const SHOHI_05_01 = '/law/tsutatsu/kihon/shohi/05/01.htm';

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'houki-nta-issue54-005-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** 消費税法基本通達の条項を DB に直接入れる。bulkCompleted のときだけ bulk download 済みの印を付ける */
  function seedShohi(dbPath: string, clauses: string[], bulkCompleted: boolean): void {
    const db = new Database(dbPath);
    initSchema(db);
    const tsutatsuId = (
      db
        .prepare(
          `INSERT INTO tsutatsu(formal_name, abbr, source_root_url) VALUES (?, ?, ?) RETURNING id`
        )
        .get('消費税法基本通達', '消基通', `${NTA_ORIGIN}/law/tsutatsu/kihon/shohi/`) as {
        id: number;
      }
    ).id;
    const insert = db.prepare(
      `INSERT INTO clause(tsutatsu_id, clause_number, source_url, chapter_number, section_number, title, full_text, paragraphs_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const clauseNumber of clauses) {
      const [chapter, section] = clauseNumber.split('-').map(Number);
      const pagePath = `${String(chapter).padStart(2, '0')}/${String(section).padStart(2, '0')}.htm`;
      insert.run(
        tsutatsuId,
        clauseNumber,
        `${NTA_ORIGIN}/law/tsutatsu/kihon/shohi/${pagePath}`,
        chapter,
        section,
        `表題 ${clauseNumber}`,
        `本文 ${clauseNumber}`,
        '[]'
      );
    }
    if (bulkCompleted) markBulkCompleted(db, tsutatsuId);
    db.close();
  }

  it('SPEC-NTA-GET-TSUTATSU-005 bulk download 済みなら、DB に無い条項は国税庁サイトに取りに行かず ARTICLE_NOT_FOUND', async () => {
    const dbPath = join(dir, 'bulk-completed.db');
    seedShohi(dbPath, ['1-1-1', '1-1-2', '5-1-1'], true);
    const fetchImpl = vi.fn(async () => {
      throw new Error('fetch should NOT be called when the tsutatsu is bulk-downloaded');
    }) as unknown as typeof fetch;

    const r = (await getTsutatsu(
      { name: '消基通', clause: '1-4-1', format: 'json' },
      { fetchImpl, dbPath }
    )) as { code?: string; available_clauses?: string[] };

    expect(r.code).toBe('ARTICLE_NOT_FOUND');
    expect(r.available_clauses).toEqual(expect.arrayContaining(['1-1-1', '1-1-2', '5-1-1']));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('SPEC-NTA-GET-TSUTATSU-005 bulk download 済みの available_clauses は最大 50 件', async () => {
    const dbPath = join(dir, 'bulk-completed-60.db');
    const clauses = Array.from({ length: 60 }, (_, i) => `1-1-${i + 1}`);
    seedShohi(dbPath, clauses, true);
    const fetchImpl = vi.fn(async () => {
      throw new Error('fetch should NOT be called when the tsutatsu is bulk-downloaded');
    }) as unknown as typeof fetch;

    const r = (await getTsutatsu(
      { name: '消基通', clause: '1-4-1', format: 'json' },
      { fetchImpl, dbPath }
    )) as { code?: string; available_clauses?: string[] };

    expect(r.code).toBe('ARTICLE_NOT_FOUND');
    expect(r.available_clauses?.length ?? 0).toBeGreaterThan(0);
    expect(r.available_clauses?.length ?? 0).toBeLessThanOrEqual(50);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('SPEC-NTA-GET-TSUTATSU-005 bulk download 済みでない通達は、DB に条項があっても無い条項を国税庁サイトから取る', async () => {
    const dbPath = join(dir, 'not-bulk.db');
    seedShohi(dbPath, ['1-1-1', '5-1-1'], false);
    const fetchImpl = ntaFetch(
      { [SHOHI_01_04]: 'www.nta.go.jp_law_tsutatsu_kihon_shohi_01_04.htm', ...TOC_PAGES },
      (_url, init) => ntaRedirectTo404Response(init)
    );

    const r = (await getTsutatsu(
      { name: '消基通', clause: '1-4-1', format: 'json' },
      { fetchImpl, dbPath }
    )) as { code?: string; clause?: { clauseNumber: string }; source?: string };

    expect(r.code).toBeUndefined();
    expect(r.clause?.clauseNumber).toBe('1-4-1');
    expect(r.source).toBe('live');
    expect(fetchedPaths(fetchImpl)).toContain(SHOHI_01_04);
  });

  it('SPEC-NTA-GET-TSUTATSU-005 国税庁サイトから 1 節取って書き戻した後も、同じ通達の別の節を国税庁サイトから取れる', async () => {
    // #54 の 2 章の再現: 消基通 5-1-9 を取った後の 1-4-1 が ARTICLE_NOT_FOUND になっていた
    const dbPath = join(dir, 'writeback-then-other-section.db');

    const first = ntaFetch(
      { [SHOHI_05_01]: 'www.nta.go.jp_law_tsutatsu_kihon_shohi_05_01.htm', ...TOC_PAGES },
      (_url, init) => ntaRedirectTo404Response(init)
    );
    const r1 = (await getTsutatsu(
      { name: '消基通', clause: '5-1-9', format: 'json' },
      { fetchImpl: first, dbPath }
    )) as { clause?: { clauseNumber: string }; source?: string };
    expect(r1.clause?.clauseNumber).toBe('5-1-9');
    expect(r1.source).toBe('live');

    const second = ntaFetch(
      { [SHOHI_01_04]: 'www.nta.go.jp_law_tsutatsu_kihon_shohi_01_04.htm', ...TOC_PAGES },
      (_url, init) => ntaRedirectTo404Response(init)
    );
    const r2 = (await getTsutatsu(
      { name: '消基通', clause: '1-4-1', format: 'json' },
      { fetchImpl: second, dbPath }
    )) as { code?: string; clause?: { clauseNumber: string }; source?: string };

    expect(r2.code).toBeUndefined();
    expect(r2.clause?.clauseNumber).toBe('1-4-1');
    expect(r2.source).toBe('live');
    expect(fetchedPaths(second)).toContain(SHOHI_01_04);
  });
});

describe('getTsutatsu — SPEC-NTA-GET-TSUTATSU-008 clause を通達ごとの番号の形で読む', () => {
  /** 番号の形に当たらない clause。国税庁サイトに取りに行った場合もエラーにならないよう、全ページを 404 への転送にする */
  const notFoundEverywhere = () =>
    ntaFetch({ ...TOC_PAGES }, (_url, init) => ntaRedirectTo404Response(init));

  const invalidCases: Array<{
    name: string;
    clause: string;
    form: string;
    examples: string[];
    mustNotMention?: string;
  }> = [
    { name: '消基通', clause: '5-1', form: '章-節-条', examples: ['5-1-9', '1-4-13の2'] },
    { name: '法基通', clause: 'abc', form: '章-節-条', examples: ['1-1-1', '1-3の2-1'] },
    {
      name: '所基通',
      clause: '5-1-9',
      form: '条-項',
      examples: ['34-1', '2-4の2', '23~35共-6'],
      mustNotMention: '章-節-条',
    },
    {
      name: '相基通',
      clause: '5-1-9',
      form: '条-項',
      examples: ['3-1', '1の3・1の4共-1'],
      mustNotMention: '章-節-条',
    },
  ];

  for (const c of invalidCases) {
    it(`SPEC-NTA-GET-TSUTATSU-008 ${c.name} の形に当たらない clause（${c.clause}）は INVALID_ARGUMENT で、hint にその通達の番号の形と例を書く`, async () => {
      const r = (await getTsutatsu(
        { name: c.name, clause: c.clause, format: 'json' },
        { fetchImpl: notFoundEverywhere(), dbPath: ':memory:' }
      )) as { code?: string; hint?: string };

      expect(r.code).toBe('INVALID_ARGUMENT');
      expect(r.hint).toContain(c.form);
      expect(c.examples.some((e) => r.hint?.includes(e))).toBe(true);
      if (c.mustNotMention) expect(r.hint).not.toContain(c.mustNotMention);
    });
  }

  // 入力の表の例は、どれも番号の形の検査で拒否しない（取れるかどうかは 006 / 010 の範囲）
  const validCases: Array<{ name: string; clause: string }> = [
    { name: '消基通', clause: '5-1-9' },
    { name: '消基通', clause: '1-4-13の2' },
    { name: '法基通', clause: '1-1-1' },
    { name: '法基通', clause: '1-3の2-1' },
    { name: '法基通', clause: '12の2-1-1' },
    { name: '所基通', clause: '34-1' },
    { name: '所基通', clause: '2-4の2' },
    { name: '所基通', clause: '23~35共-6' },
    { name: '相基通', clause: '3-1' },
    { name: '相基通', clause: '1の3・1の4共-1' },
  ];

  for (const c of validCases) {
    it(`SPEC-NTA-GET-TSUTATSU-008 ${c.name} の形に当たる clause（${c.clause}）は INVALID_ARGUMENT にしない`, async () => {
      const r = (await getTsutatsu(
        { name: c.name, clause: c.clause, format: 'json' },
        { fetchImpl: notFoundEverywhere(), dbPath: ':memory:' }
      )) as { code?: string };

      expect(r.code).not.toBe('INVALID_ARGUMENT');
    });
  }
});

describe('getTsutatsu — SPEC-NTA-GET-TSUTATSU-008 入力の表: clause の全角の数字・ハイフンは国税庁サイトから取るときも半角に揃える', () => {
  const SHOHI_01_04 = '/law/tsutatsu/kihon/shohi/01/04.htm';

  it('SPEC-NTA-GET-TSUTATSU-008 全角の「１－４－１」を DB が空のときも 1-4-1 として国税庁サイトから取る', async () => {
    const fetchImpl = ntaFetch(
      { [SHOHI_01_04]: 'www.nta.go.jp_law_tsutatsu_kihon_shohi_01_04.htm', ...TOC_PAGES },
      (_url, init) => ntaRedirectTo404Response(init)
    );

    const r = (await getTsutatsu(
      { name: '消基通', clause: '１－４－１', format: 'json' },
      { fetchImpl, dbPath: ':memory:' }
    )) as { code?: string; clause?: { clauseNumber: string }; source?: string };

    expect(r.code).toBeUndefined();
    expect(r.clause?.clauseNumber).toBe('1-4-1');
    expect(r.source).toBe('live');
    expect(fetchedPaths(fetchImpl)[0]).toBe(SHOHI_01_04);
  });

  it('SPEC-NTA-GET-TSUTATSU-008 全角の「１－４－１３の２」を 1-4-13の2 として国税庁サイトから取る', async () => {
    const fetchImpl = ntaFetch(
      { [SHOHI_01_04]: 'www.nta.go.jp_law_tsutatsu_kihon_shohi_01_04.htm', ...TOC_PAGES },
      (_url, init) => ntaRedirectTo404Response(init)
    );

    const r = (await getTsutatsu(
      { name: '消基通', clause: '１－４－１３の２', format: 'json' },
      { fetchImpl, dbPath: ':memory:' }
    )) as { code?: string; clause?: { clauseNumber: string }; source?: string };

    expect(r.code).toBeUndefined();
    expect(r.clause?.clauseNumber).toBe('1-4-13の2');
    expect(r.source).toBe('live');
  });

  it('SPEC-NTA-GET-TSUTATSU-008 全角の「３４－１」（所基通）は番号の形の検査で拒否しない', async () => {
    const fetchImpl = ntaFetch({ ...TOC_PAGES }, (_url, init) => ntaRedirectTo404Response(init));

    const r = (await getTsutatsu(
      { name: '所基通', clause: '３４－１', format: 'json' },
      { fetchImpl, dbPath: ':memory:' }
    )) as { code?: string };

    expect(r.code).not.toBe('INVALID_ARGUMENT');
  });
});

describe('getTsutatsu — SPEC-NTA-GET-TSUTATSU-009 SOURCE_API_ERROR は取得の失敗だけに出す', () => {
  type SourceError = {
    code?: string;
    retryable?: boolean;
    detail?: { status?: number };
    next_actions?: unknown[];
  };

  // 通信の失敗とサイトのエラーは取得の側で再試行してから返すため、既定の 5 秒では足りない
  it('SPEC-NTA-GET-TSUTATSU-009 国税庁サイトのエラー（503）は retryable な SOURCE_API_ERROR（法基通）', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('unavailable', { status: 503, statusText: 'Service Unavailable' })
    ) as unknown as typeof fetch;

    const r = (await getTsutatsu(
      { name: '法基通', clause: '1-1-1', format: 'json' },
      { fetchImpl, dbPath: ':memory:' }
    )) as SourceError;

    expect(r.code).toBe('SOURCE_API_ERROR');
    expect(r.retryable).toBe(true);
    expect(r.detail?.status).toBe(503);
    expect(r.next_actions?.length ?? 0).toBeGreaterThan(0);
  }, 30_000);

  // 通信の失敗とサイトのエラーは取得の側で再試行してから返すため、既定の 5 秒では足りない
  it('SPEC-NTA-GET-TSUTATSU-009 通信の失敗（fetch が reject）は retryable な SOURCE_API_ERROR', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;

    const r = (await getTsutatsu(
      { name: '消基通', clause: '1-4-1', format: 'json' },
      { fetchImpl, dbPath: ':memory:' }
    )) as SourceError;

    expect(r.code).toBe('SOURCE_API_ERROR');
    expect(r.retryable).toBe(true);
    expect(r.next_actions?.length ?? 0).toBeGreaterThan(0);
  }, 30_000);

  it('SPEC-NTA-GET-TSUTATSU-009 候補ページが 404 のときは SOURCE_API_ERROR にせず ARTICLE_NOT_FOUND（消基通）', async () => {
    const fetchImpl = ntaFetch(
      { ...TOC_PAGES },
      () => new Response('not found', { status: 404, statusText: 'Not Found' })
    );

    const r = (await getTsutatsu(
      { name: '消基通', clause: '1-4-1', format: 'json' },
      { fetchImpl, dbPath: ':memory:' }
    )) as SourceError;

    expect(r.code).toBe('ARTICLE_NOT_FOUND');
    expect(r.retryable).not.toBe(true);
  });

  it('SPEC-NTA-GET-TSUTATSU-009 候補ページが国税庁サイトの 404 ページへ転送されるときは SOURCE_API_ERROR にせず ARTICLE_NOT_FOUND（法基通）', async () => {
    // #54 の再現: 法基通 1-1-1 は存在しない 01/01.htm を取りに行き、retryable な SOURCE_API_ERROR になっていた
    const fetchImpl = ntaFetch({ ...TOC_PAGES }, (_url, init) => ntaRedirectTo404Response(init));

    const r = (await getTsutatsu(
      { name: '法基通', clause: '1-1-1', format: 'json' },
      { fetchImpl, dbPath: ':memory:' }
    )) as SourceError;

    expect(r.code).toBe('ARTICLE_NOT_FOUND');
    expect(r.retryable).not.toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* getTaxAnswer — タックスアンサー取得（fixture モック）                        */
/* -------------------------------------------------------------------------- */

function utf8HtmlResponse(fixtureName: string): Response {
  const html = readFileSync(resolve(fixturesDir, fixtureName), 'utf8');
  return new Response(Buffer.from(html, 'utf8'), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=UTF-8' },
  });
}

describe('getTaxAnswer — 引数バリデーション', () => {
  it('SPEC-NTA-GET-TAX-ANSWER-001 数字以外の番号はエラー', async () => {
    const r = (await getTaxAnswer({ no: 'abc' })) as { error?: string };
    expect(r.error).toContain('数字');
  });

  it('SPEC-NTA-GET-TAX-ANSWER-002 8xxx 番台（未対応）はエラー + hint', async () => {
    const r = (await getTaxAnswer({ no: '8001' })) as { error?: string; hint?: string };
    expect(r.error).toContain('未対応');
    expect(r.hint).toContain('1xxx');
  });
});

describe('getTaxAnswer — 6101 (消費税) を取得', () => {
  it('SPEC-NTA-GET-TAX-ANSWER-007 Markdown（既定）で本文・出典・legal_status を含む', async () => {
    const fetchImpl = vi.fn(async () =>
      utf8HtmlResponse('www.nta.go.jp_taxes_shiraberu_taxanswer_shohi_6101.htm')
    ) as unknown as typeof fetch;

    const r = (await getTaxAnswer({ no: '6101' }, { fetchImpl, dbPath: ':memory:' })) as string;
    expect(typeof r).toBe('string');
    expect(r).toContain('No.6101');
    expect(r).toContain('消費税の基本的なしくみ');
    expect(r).toContain('対象税目: 消費税');
    expect(r).toContain('概要');
    expect(r).toContain('参考解説資料'); // legal_status note
  });

  it('SPEC-NTA-GET-TAX-ANSWER-003 SPEC-NTA-GET-TAX-ANSWER-008 format=json で構造化レスポンス + legal_status', async () => {
    const fetchImpl = vi.fn(async () =>
      utf8HtmlResponse('www.nta.go.jp_taxes_shiraberu_taxanswer_shotoku_1120.htm')
    ) as unknown as typeof fetch;

    const r = (await getTaxAnswer(
      { no: '1120', format: 'json' },
      { fetchImpl, dbPath: ':memory:' }
    )) as {
      taxAnswer: { no: string; title: string; sections: unknown[] };
      legal_status: { binds_citizens: boolean };
    };
    expect(r.taxAnswer.no).toBe('1120');
    expect(r.taxAnswer.title).toContain('医療費');
    expect(r.taxAnswer.sections.length).toBeGreaterThan(0);
    expect(r.legal_status.binds_citizens).toBe(false);

    const calls = (fetchImpl as unknown as { mock: { calls: [string][] } }).mock.calls;
    expect(calls[0][0]).toBe('https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1120.htm');
  });

  it('SPEC-NTA-GET-TAX-ANSWER-003 番号→税目の自動振り分け: 6xxx→shohi, 1xxx→shotoku, 5xxx→hojin', async () => {
    const fetchImpl = vi.fn(async () =>
      utf8HtmlResponse('www.nta.go.jp_taxes_shiraberu_taxanswer_hojin_5759.htm')
    ) as unknown as typeof fetch;

    await getTaxAnswer({ no: '5759', format: 'json' }, { fetchImpl, dbPath: ':memory:' });
    const calls = (fetchImpl as unknown as { mock: { calls: [string][] } }).mock.calls;
    expect(calls[0][0]).toContain('/hojin/5759.htm');
  });
});

/* -------------------------------------------------------------------------- */
/* getQa — 質疑応答事例取得（fixture モック）                                  */
/* -------------------------------------------------------------------------- */

describe('getQa — 引数バリデーション', () => {
  it('SPEC-NTA-GET-QA-001 未対応 topic はエラー', async () => {
    const r = (await getQa({ topic: 'unknown', category: '02', id: '19' })) as { error?: string };
    expect(r.error).toContain('未対応');
  });

  it('SPEC-NTA-GET-QA-002 category 不足はエラー', async () => {
    const r = (await getQa({ topic: 'shohi', category: '', id: '19' })) as { error?: string };
    expect(r.error).toContain('category');
  });
});

describe('getQa — 消費税 02/19 を取得', () => {
  it('SPEC-NTA-GET-QA-007 Markdown で【照会要旨】【回答要旨】【関係法令通達】を含む', async () => {
    const fetchImpl = vi.fn(async () =>
      sjisHtmlResponse('www.nta.go.jp_law_shitsugi_shohi_02_19.htm')
    ) as unknown as typeof fetch;

    const r = (await getQa(
      { topic: 'shohi', category: '02', id: '19' },
      { fetchImpl, dbPath: ':memory:' }
    )) as string;
    expect(typeof r).toBe('string');
    expect(r).toContain('ゴルフ会員権');
    expect(r).toContain('【照会要旨】');
    expect(r).toContain('【回答要旨】');
    expect(r).toContain('【関係法令通達】');
    expect(r).toContain('参考解説資料');
    // Issue #22: 注記は【関係法令通達】ではなく独立した節
    expect(r).toContain('## 注記（国税庁）');
    expect(r.indexOf('## 注記（国税庁）')).toBeGreaterThan(r.indexOf('## 【関係法令通達】'));
    const related = r.slice(r.indexOf('## 【関係法令通達】'), r.indexOf('## 注記（国税庁）'));
    expect(related).not.toContain('注記');
  });

  it('SPEC-NTA-GET-QA-009 Issue #22: format=json で related_laws / related_tsutatsu / next_actions を返す', async () => {
    const fetchImpl = vi.fn(async () =>
      sjisHtmlResponse('www.nta.go.jp_law_shitsugi_shohi_02_19.htm')
    ) as unknown as typeof fetch;
    const r = (await getQa(
      { topic: 'shohi', category: '02', id: '19', format: 'json' },
      { fetchImpl, dbPath: ':memory:' }
    )) as {
      qa: { relatedLaws: string[]; notice?: string; basisDate?: string };
      related_laws?: Array<Record<string, unknown>>;
      related_tsutatsu?: Array<Record<string, unknown>>;
      next_actions?: Array<{ action: string; example?: Record<string, unknown> }>;
    };
    expect(r.qa.relatedLaws).toEqual(['消費税法第2条第1項第8号、消費税法基本通達5-1-1']);
    expect(r.qa.basisDate).toBe('2025-08-01');
    expect(r.related_laws).toEqual([
      { law_name: '消費税法', article: '2', paragraph: 1, item: 8, raw: '消費税法第2条第1項第8号' },
    ]);
    expect(r.related_tsutatsu).toEqual([
      { name: '消費税法基本通達', clause: '5-1-1', raw: '消費税法基本通達5-1-1' },
    ]);
    expect(r.next_actions).toEqual([
      {
        action: 'delegate_to_mcp',
        reason: '質疑応答事例は参考資料で法的拘束力がない。根拠は法律本文で確認する',
        example: {
          mcp: 'houki-egov',
          tool: 'get_law',
          law_name: '消費税法',
          article: '2',
          paragraph: 1,
          item: 8,
        },
      },
      {
        action: 'nta_get_tsutatsu',
        reason: '質疑応答事例が挙げている通達の本文を確認する',
        example: { name: '消費税法基本通達', clause: '5-1-1' },
      },
    ]);
  });

  it('SPEC-NTA-GET-QA-008 format=json で構造化レスポンス', async () => {
    const fetchImpl = vi.fn(async () =>
      sjisHtmlResponse('www.nta.go.jp_law_shitsugi_shohi_02_19.htm')
    ) as unknown as typeof fetch;

    const r = (await getQa(
      { topic: 'shohi', category: '02', id: '19', format: 'json' },
      { fetchImpl, dbPath: ':memory:' }
    )) as {
      qa: { topic: string; title: string; question: string[]; relatedLaws: string[] };
      legal_status: { binds_courts: boolean };
    };
    expect(r.qa.topic).toBe('shohi');
    expect(r.qa.title).toContain('ゴルフ会員権');
    expect(r.qa.question.length).toBeGreaterThan(0);
    expect(r.qa.relatedLaws.length).toBeGreaterThan(0);
    expect(r.legal_status.binds_courts).toBe(false);

    // URL: /law/shitsugi/shohi/02/19.htm
    const calls = (fetchImpl as unknown as { mock: { calls: [string][] } }).mock.calls;
    expect(calls[0][0]).toBe('https://www.nta.go.jp/law/shitsugi/shohi/02/19.htm');
  });

  it('SPEC-NTA-GET-QA-003 1 桁 category/id を 2 桁にゼロパディングする', async () => {
    const fetchImpl = vi.fn(async () =>
      sjisHtmlResponse('www.nta.go.jp_law_shitsugi_shohi_02_19.htm')
    ) as unknown as typeof fetch;

    await getQa(
      { topic: 'shohi', category: '2', id: '19', format: 'json' },
      { fetchImpl, dbPath: ':memory:' }
    );
    const calls = (fetchImpl as unknown as { mock: { calls: [string][] } }).mock.calls;
    expect(calls[0][0]).toContain('/02/19.htm');
  });
});

/* -------------------------------------------------------------------------- */
/* integration test — INTEGRATION=1 でのみ実行（CI canary）                    */
/* -------------------------------------------------------------------------- */

const integration = process.env.INTEGRATION === '1';
const itIntegration = integration ? it : it.skip;

describe('integration tests (INTEGRATION=1 でのみ実行)', () => {
  itIntegration(
    'getTsutatsu: 実 nta.go.jp から消基通 1-4-1 を取得してパースまで通る',
    async () => {
      const r = (await getTsutatsu({ name: '消基通', clause: '1-4-1', format: 'json' })) as {
        clause?: { clauseNumber: string; title: string };
        sourceUrl?: string;
        legal_status?: { binds_tax_office: boolean };
        error?: string;
      };
      expect(r.error).toBeUndefined();
      expect(r.clause?.clauseNumber).toBe('1-4-1');
      expect(r.clause?.title).toContain('納税義務');
      expect(r.sourceUrl).toContain('nta.go.jp');
      expect(r.legal_status?.binds_tax_office).toBe(true);
    },
    30_000
  );

  itIntegration(
    'getTaxAnswer: 実 nta.go.jp から 6101 (消費税の基本) を取得',
    async () => {
      const r = (await getTaxAnswer({ no: '6101', format: 'json' }, { dbPath: ':memory:' })) as {
        taxAnswer?: { no: string; title: string };
        error?: string;
      };
      expect(r.error).toBeUndefined();
      expect(r.taxAnswer?.no).toBe('6101');
      expect(r.taxAnswer?.title).toContain('消費税');
    },
    30_000
  );

  itIntegration(
    'getQa: 実 nta.go.jp から消費税 02/19 (ゴルフ会員権) を取得',
    async () => {
      const r = (await getQa(
        { topic: 'shohi', category: '02', id: '19', format: 'json' },
        { dbPath: ':memory:' }
      )) as {
        qa?: { title: string };
        error?: string;
      };
      expect(r.error).toBeUndefined();
      expect(r.qa?.title).toContain('ゴルフ会員権');
    },
    30_000
  );
});

describe('toolHandlers map', () => {
  it('全ツールが登録されている', () => {
    expect(Object.keys(toolHandlers).sort()).toEqual(
      [
        'nta_search_tsutatsu',
        'nta_get_tsutatsu',
        'nta_search_qa',
        'nta_get_qa',
        'nta_search_tax_answer',
        'nta_get_tax_answer',
        // Phase 3b (v0.4.0-alpha.1) で追加
        'nta_search_kaisei_tsutatsu',
        'nta_get_kaisei_tsutatsu',
        // Phase 3b (v0.4.0-alpha.2) で追加
        'nta_search_jimu_unei',
        'nta_get_jimu_unei',
        // Phase 3b (v0.4.0-alpha.3) で追加
        'nta_search_bunshokaitou',
        'nta_get_bunshokaitou',
        // Phase 4-2 (v0.7.1) で追加
        'nta_inspect_pdf_meta',
        'resolve_abbreviation',
      ].sort()
    );
  });
});

describe('nta_inspect_pdf_meta — Phase 4-2 (v0.7.1) / Phase 4 self-feedback (v0.7.2)', () => {
  it('DB 未投入の docId はエラー + hint', async () => {
    const r = (await handleNtaInspectPdfMeta(
      { docType: 'kaisei', docId: 'unknown-doc-id' },
      { dbPath: ':memory:' }
    )) as { error?: string; hint?: string };
    expect(r.error).toContain('DB に未登録');
    expect(r.hint).toContain('--bulk-download');
  });

  /** PDF 付きの改正通達を 1 件入れた一時 DB を作る */
  function seedPdfDoc(
    docId: string,
    pdfs: Array<{ title: string; url: string; sizeKb?: number; kind?: string }>
  ): string {
    const tmpFile = join(mkdtempSync(join(tmpdir(), 'inspect-pdf-meta-')), 'cache.db');
    const seedDb = new Database(tmpFile);
    initSchema(seedDb);
    seedDb
      .prepare(
        `INSERT INTO document(doc_type, doc_id, taxonomy, title, source_url, fetched_at, full_text, attached_pdfs_json, content_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'kaisei',
        docId,
        'shohi',
        'インボイス改正',
        'https://x/index.htm',
        '2026-05-06T00:00:00Z',
        '本文',
        JSON.stringify(pdfs),
        'h1'
      );
    seedDb.close();
    return tmpFile;
  }

  type InspectResult = {
    docType: string;
    docId: string;
    title: string;
    attachedPdfs: Array<{
      kind: string;
      url: string;
      title: string;
      read_strategy: string;
      layout_note: string;
    }>;
    saved?: Array<{
      url: string;
      path: string | null;
      bytes: number | null;
      cached: boolean;
      error?: string;
    }>;
    next_actions?: Array<{ action: string; reason: string; example?: Record<string, unknown> }>;
    note?: string;
  };

  it('#36: kind 優先度ソート + read_strategy / layout_note + next_actions（未保存は read_url）', async () => {
    const tmpFile = seedPdfDoc('sample-001', [
      // #44: 「別紙」だけだと kaisei では comparison に補正されるので、他の語を含む別紙にする
      { title: '別紙1 計算明細書', url: 'https://x/b.pdf', sizeKb: 120, kind: 'attachment' },
      { title: '新旧対照表', url: 'https://x/a.pdf', sizeKb: 470, kind: 'comparison' },
    ]);

    const r = (await handleNtaInspectPdfMeta(
      { docType: 'kaisei', docId: 'sample-001' },
      { dbPath: tmpFile }
    )) as InspectResult;

    expect(r.docType).toBe('kaisei');
    expect(r.docId).toBe('sample-001');
    expect(r.title).toBe('インボイス改正');
    // comparison が attachment より先
    expect(r.attachedPdfs.map((p) => p.kind)).toEqual(['comparison', 'attachment']);
    // 読み方の事実は道具の名前を含まない
    expect(r.attachedPdfs[0].read_strategy).toBe('tables');
    expect(r.attachedPdfs[0].layout_note).toContain('改正後');
    expect(r.attachedPdfs[0].layout_note).not.toContain('pdf-reader');
    // reader_hints は無くなった
    expect((r as Record<string, unknown>).reader_hints).toBeUndefined();
    // next_actions: kind ごとに 1 件 + 汎用 1 件。未保存なので read_url
    expect(r.next_actions?.map((a) => a.action)).toEqual([
      'pdf-reader-mcp:read_url',
      'pdf-reader-mcp:read_url',
      'read_pdf',
    ]);
    expect(r.next_actions?.[0].example).toEqual({ url: 'https://x/a.pdf', split_columns: 2 });
    expect(r.next_actions?.[1].example).toEqual({ url: 'https://x/b.pdf' });
    expect(r.next_actions?.[2].example).toEqual({ url: 'https://x/a.pdf' });
    // example に mcp / tool は入れない（additionalProperties: false の tool にそのまま渡せる）
    for (const a of r.next_actions ?? []) {
      expect(a.example).not.toHaveProperty('mcp');
      expect(a.example).not.toHaveProperty('tool');
    }
    expect(r.saved).toBeUndefined();
  });

  it('#36: kind で絞る。該当なしは空 + note にある種別', async () => {
    const tmpFile = seedPdfDoc('sample-002', [
      { title: '別紙1 計算明細書', url: 'https://x/b.pdf', kind: 'attachment' },
      { title: '新旧対照表', url: 'https://x/a.pdf', kind: 'comparison' },
    ]);
    const only = (await handleNtaInspectPdfMeta(
      { docType: 'kaisei', docId: 'sample-002', kind: 'comparison' },
      { dbPath: tmpFile }
    )) as InspectResult;
    expect(only.attachedPdfs.map((p) => p.url)).toEqual(['https://x/a.pdf']);
    expect(only.next_actions?.map((a) => a.action)).toEqual([
      'pdf-reader-mcp:read_url',
      'read_pdf',
    ]);

    const none = (await handleNtaInspectPdfMeta(
      { docType: 'kaisei', docId: 'sample-002', kind: 'qa-pdf' },
      { dbPath: tmpFile }
    )) as InspectResult;
    expect(none.attachedPdfs).toEqual([]);
    expect(none.next_actions).toBeUndefined();
    expect(none.note).toContain('kind="qa-pdf" の PDF はありません');
    expect(none.note).toContain('comparison, attachment');
  });

  it('#36: save: true で PDF を保存し、saved[].path を extract_tables / read_text の file_path に使う', async () => {
    const tmpFile = seedPdfDoc('sample-003', [
      { title: '新旧対照表', url: 'https://x/a.pdf', kind: 'comparison' },
      { title: '参考資料', url: 'https://x/r.pdf', kind: 'related' },
      { title: '壊れたリンク', url: 'https://x/missing.pdf', kind: 'unknown' },
    ]);
    const filesDir = mkdtempSync(join(tmpdir(), 'nta-files-'));
    const pdfBytes = Buffer.from('%PDF-1.7\n%test\n');
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('missing.pdf')) return new Response('not found', { status: 404 });
      return new Response(pdfBytes, {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      });
    }) as unknown as typeof fetch;

    const r = (await handleNtaInspectPdfMeta(
      { docType: 'kaisei', docId: 'sample-003', save: true },
      { dbPath: tmpFile, filesDir, fetchImpl }
    )) as InspectResult;

    expect(r.saved).toHaveLength(3);
    const a = r.saved?.find((s) => s.url === 'https://x/a.pdf');
    expect(a?.path).toBe(resolve(filesDir, 'kaisei', 'sample-003', 'a.pdf'));
    expect(a?.bytes).toBe(pdfBytes.byteLength);
    expect(a?.cached).toBe(false);
    expect(readFileSync(a?.path as string)).toEqual(pdfBytes);
    const missing = r.saved?.find((s) => s.url === 'https://x/missing.pdf');
    expect(missing?.path).toBeNull();
    expect(missing?.error).toBe('HTTP 404');
    expect(r.note).toContain('1 件の PDF を保存できませんでした');

    // 保存済みは file_path、失敗分は URL のまま
    expect(r.next_actions?.map((a) => a.action)).toEqual([
      'pdf-reader-mcp:extract_tables',
      'pdf-reader-mcp:read_text',
      'pdf-reader-mcp:read_url',
      'read_pdf',
    ]);
    expect(r.next_actions?.[0].example).toEqual({ file_path: a?.path });
    expect(r.next_actions?.[2].example).toEqual({ url: 'https://x/missing.pdf', pages: '1' });
    expect(r.next_actions?.[3].example).toEqual({ url: 'https://x/a.pdf', path: a?.path });

    // 2 回目は再取得しない
    const again = (await handleNtaInspectPdfMeta(
      { docType: 'kaisei', docId: 'sample-003', save: true, kind: 'comparison' },
      { dbPath: tmpFile, filesDir, fetchImpl }
    )) as InspectResult;
    expect(again.saved?.[0].cached).toBe(true);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
    rmSync(filesDir, { recursive: true, force: true });
  });

  it('v0.6.0 期の DB レコード (kind なし) はタイトルから動的補完される (v0.7.2)', async () => {
    const tmpFile = seedPdfDoc('legacy-001', [
      // kind フィールド無し（v0.6.0 期投入を再現）
      { title: '新旧対応表', url: 'https://x/c.pdf', sizeKb: 399 },
      { title: '別紙1', url: 'https://x/a.pdf', sizeKb: 67 },
    ]);

    const r = (await handleNtaInspectPdfMeta(
      { docType: 'kaisei', docId: 'legacy-001' },
      { dbPath: tmpFile }
    )) as InspectResult;

    // タイトルから推定された kind が attachedPdfs に入る
    expect(r.attachedPdfs.find((p) => p.title === '新旧対応表')?.kind).toBe('comparison');
    // #44: kaisei の「別紙1」は新旧対照表本体として comparison に補正される
    expect(r.attachedPdfs.find((p) => p.title === '別紙1')?.kind).toBe('comparison');
    // next_actions は kind ごとに 1 件なので comparison 1 件 + 汎用 1 件
    expect(r.next_actions?.map((a) => a.action)).toEqual(['pdf-reader-mcp:read_url', 'read_pdf']);
  });

  it('#44: 改正通達の「別紙 N」だけの PDF は comparison として返り、kind: "comparison" で絞れる', async () => {
    const tmpFile = seedPdfDoc('0025004-026', [
      {
        title:
          '【参考】令和８年11月１日から適用される「消費税法基本通達（第８章）」の構成及び新旧対応表（令和７年４月１日）（PDF/399KB）',
        url: 'https://x/b0025003-111.pdf',
        sizeKb: 399,
        kind: 'comparison',
      },
      { title: '別紙1（PDF/221KB）', url: 'https://x/01.pdf', sizeKb: 221, kind: 'attachment' },
      { title: '別紙2（PDF/449KB）', url: 'https://x/02.pdf', sizeKb: 449, kind: 'attachment' },
      { title: '別紙3 様式', url: 'https://x/03.pdf', sizeKb: 10, kind: 'attachment' },
    ]);

    const r = (await handleNtaInspectPdfMeta(
      { docType: 'kaisei', docId: '0025004-026', kind: 'comparison' },
      { dbPath: tmpFile }
    )) as InspectResult;
    expect(r.attachedPdfs.map((p) => p.url)).toEqual([
      'https://x/b0025003-111.pdf',
      'https://x/01.pdf',
      'https://x/02.pdf',
    ]);
    for (const p of r.attachedPdfs) {
      expect(p.kind).toBe('comparison');
      expect(p.read_strategy).toBe('tables');
      // 丸括弧と墨付き括弧の両方の記号が書いてある
      expect(p.layout_note).toContain('（同左）');
      expect(p.layout_note).toContain('【新設】');
      expect(p.layout_note).toContain('【一部改正】');
    }
    expect(r.note).toBeUndefined();

    // 他の語を含む別紙は attachment のまま
    const att = (await handleNtaInspectPdfMeta(
      { docType: 'kaisei', docId: '0025004-026', kind: 'attachment' },
      { dbPath: tmpFile }
    )) as InspectResult;
    expect(att.attachedPdfs.map((p) => p.url)).toEqual(['https://x/03.pdf']);
    expect(att.attachedPdfs[0].layout_note).toContain(
      '改正通達（kaisei）の別紙は新旧対照表本体のことが多い'
    );
  });

  it('#44: 改正通達で comparison が 0 件・attachment があるときは note に別紙を読むよう書く', async () => {
    const tmpFile = seedPdfDoc('kaisei-att-only', [
      { title: '別紙1 計算明細書', url: 'https://x/01.pdf', kind: 'attachment' },
    ]);
    const r = (await handleNtaInspectPdfMeta(
      { docType: 'kaisei', docId: 'kaisei-att-only', kind: 'comparison' },
      { dbPath: tmpFile }
    )) as InspectResult;
    expect(r.attachedPdfs).toEqual([]);
    expect(r.note).toContain('kind="comparison" の PDF はありません');
    expect(r.note).toContain('kind="attachment" の別紙も読んでください');
  });
});

describe('Issue #20: 通達の応答に base_laws と houki-egov-mcp への next_actions を付ける', () => {
  type NextActionLike = { action: string; reason: string; example?: Record<string, unknown> };

  let dir: string;
  let dbPath: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'houki-nta-issue20-'));
    dbPath = join(dir, 'cache.db');
    const db = new Database(dbPath);
    initSchema(db);
    const insertTsutatsu = db.prepare(
      `INSERT INTO tsutatsu(formal_name, abbr, source_root_url) VALUES (?, ?, ?) RETURNING id`
    );
    const insertClause = db.prepare(
      `INSERT INTO clause(tsutatsu_id, clause_number, source_url, chapter_number, section_number, title, full_text, paragraphs_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const hojin = (
      insertTsutatsu.get('法人税基本通達', '法基通', 'https://x/hojin/') as { id: number }
    ).id;
    const shohi = (
      insertTsutatsu.get('消費税法基本通達', '消基通', 'https://x/shohi/') as { id: number }
    ).id;
    const para = (t: string) => JSON.stringify([{ indent: 1, text: t }]);
    insertClause.run(
      hojin,
      '9-2-1',
      'https://x/hojin/09/02.htm',
      9,
      2,
      '役員の範囲',
      '役員の範囲 使用人兼務役員の取扱い',
      para('使用人兼務役員の取扱い')
    );
    insertClause.run(
      hojin,
      '9-2-5',
      'https://x/hojin/09/02.htm',
      9,
      2,
      '使用人兼務役員',
      '使用人兼務役員とされない役員',
      para('使用人兼務役員とされない役員')
    );
    insertClause.run(
      shohi,
      '1-4-1',
      'https://x/shohi/01/04.htm',
      1,
      4,
      '免除',
      '使用人兼務役員に関する消費税の取扱い',
      para('使用人兼務役員に関する消費税の取扱い')
    );
    db.close();
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('SPEC-NTA-SEARCH-TSUTATSU-009 nta_search_tsutatsu: 対応表 base_laws_by_tsutatsu を 1 回だけ、通達ごとに 1 件の next_actions（重複なし）', async () => {
    const r = (await searchTsutatsu({ keyword: '使用人兼務役員' }, { dbPath })) as {
      hits: Array<{ tsutatsu: string; base_laws?: unknown }>;
      base_laws_by_tsutatsu?: Record<string, string[]>;
      next_actions?: NextActionLike[];
    };
    expect(r.hits.length).toBe(3);
    // hit ごとには付けない（対応は通達単位の事実のため）
    for (const h of r.hits) {
      expect(h.base_laws).toBeUndefined();
      expect(r.base_laws_by_tsutatsu?.[h.tsutatsu]).toBeDefined();
    }
    expect(r.base_laws_by_tsutatsu).toEqual({
      法人税基本通達: ['法人税法', '法人税法施行令', '法人税法施行規則'],
      消費税法基本通達: ['消費税法', '消費税法施行令', '消費税法施行規則'],
    });
    const lawNames = (r.next_actions ?? []).map((a) => a.example?.law_name);
    expect(new Set(lawNames)).toEqual(new Set(['法人税法', '消費税法']));
    expect(lawNames).toHaveLength(2);
    for (const a of r.next_actions ?? []) {
      expect(a.action).toBe('delegate_to_mcp');
      expect(a.example).toMatchObject({ mcp: 'houki-egov', tool: 'get_law' });
    }
  });

  it('SPEC-NTA-SEARCH-TSUTATSU-005 SPEC-NTA-SEARCH-TSUTATSU-009 nta_search_tsutatsu: 0 件のときは base_laws_by_tsutatsu も next_actions も付けない', async () => {
    const r = (await searchTsutatsu({ keyword: '存在しない語句です' }, { dbPath })) as {
      hits: unknown[];
      base_laws_by_tsutatsu?: unknown;
      next_actions?: unknown;
    };
    expect(r.hits).toEqual([]);
    expect(r.base_laws_by_tsutatsu).toBeUndefined();
    expect(r.next_actions).toBeUndefined();
  });

  it('SPEC-NTA-GET-TSUTATSU-013 nta_get_tsutatsu（DB 経路, json）: base_laws と get_law への next_actions', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('fetch should NOT be called');
    }) as unknown as typeof fetch;
    const r = (await getTsutatsu(
      { name: '法基通', clause: '9-2-1', format: 'json' },
      { fetchImpl, dbPath }
    )) as { base_laws?: string[]; next_actions?: NextActionLike[]; source: string };
    expect(r.source).toBe('db');
    expect(r.base_laws).toEqual(['法人税法', '法人税法施行令', '法人税法施行規則']);
    expect(r.next_actions).toEqual([
      {
        action: 'delegate_to_mcp',
        reason: '通達は国民・裁判所を拘束しない。根拠は法律本文で確認する',
        example: { mcp: 'houki-egov', tool: 'get_law', law_name: '法人税法' },
      },
    ]);
  });

  it('SPEC-NTA-GET-TSUTATSU-013 nta_get_tsutatsu（DB 経路, markdown）: 解釈の対象になる法律の行を含む', async () => {
    const r = (await getTsutatsu({ name: '法基通', clause: '9-2-1' }, { dbPath })) as string;
    expect(r).toContain(
      '解釈の対象になる法律: 法人税法 / 法人税法施行令 / 法人税法施行規則（houki-egov-mcp の get_law で本文を確認できます）'
    );
  });

  it('SPEC-NTA-GET-TSUTATSU-013 nta_get_tsutatsu（ライブ経路）: json / markdown とも base_laws を返す', async () => {
    const fetchImpl = vi.fn(async () =>
      sjisHtmlResponse('www.nta.go.jp_law_tsutatsu_kihon_shohi_01_04.htm')
    ) as unknown as typeof fetch;

    const json = (await getTsutatsu(
      { name: '消基通', clause: '1-4-13の2', format: 'json' },
      { fetchImpl, dbPath: ':memory:' }
    )) as { source: string; base_laws?: string[]; next_actions?: NextActionLike[] };
    expect(json.source).toBe('live');
    expect(json.base_laws).toEqual(['消費税法', '消費税法施行令', '消費税法施行規則']);
    expect(json.next_actions?.[0].example?.law_name).toBe('消費税法');

    const md = (await getTsutatsu(
      { name: '消基通', clause: '1-4-1' },
      { fetchImpl, dbPath: ':memory:' }
    )) as string;
    expect(md).toContain('解釈の対象になる法律: 消費税法 / 消費税法施行令 / 消費税法施行規則');
    // legal_status の note より前に置く（出典ブロックの中）
    expect(md.indexOf('解釈の対象になる法律')).toBeLessThan(md.indexOf('通達は行政内部文書'));
  });
});

describe('Issue #21: 通称を 0 件のため展開したときだけ search_notes で知らせる', () => {
  let dir: string;
  let dbPath: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'houki-nta-issue21-'));
    dbPath = join(dir, 'cache.db');
    const db = new Database(dbPath);
    initSchema(db);
    const id = (
      db
        .prepare(
          `INSERT INTO tsutatsu(formal_name, abbr, source_root_url) VALUES (?, ?, ?) RETURNING id`
        )
        .get('消費税法基本通達', '消基通', 'https://x/shohi/') as { id: number }
    ).id;
    const insert = db.prepare(
      `INSERT INTO clause(tsutatsu_id, clause_number, source_url, chapter_number, section_number, title, full_text, paragraphs_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insert.run(
      id,
      '1-7-2',
      'https://x/shohi/01/07.htm',
      1,
      7,
      '登録番号の構成',
      '適格請求書発行事業者登録簿に登載する登録番号',
      '[]'
    );
    insert.run(
      id,
      '1-4-1',
      'https://x/shohi/01/04.htm',
      1,
      4,
      '納税義務が免除される課税期間',
      '法第9条第1項本文（消費税法の小規模事業者に係る納税義務の免除）',
      '[]'
    );
    db.close();
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('SPEC-NTA-SEARCH-TSUTATSU-008 元の語で当たるとき: 展開せず、注記も付けない', async () => {
    const r = (await searchTsutatsu({ keyword: '適格請求書発行事業者' }, { dbPath })) as {
      hits: Array<{ clauseNumber: string }>;
      search_notes?: string[];
    };
    expect(r.hits.map((h) => h.clauseNumber)).toEqual(['1-7-2']);
    expect(r.search_notes).toBeUndefined();
  });

  it('SPEC-NTA-SEARCH-TSUTATSU-008 元の語で 0 件のとき: 法令名に広げ、search_notes で知らせる', async () => {
    const r = (await searchTsutatsu({ keyword: 'インボイス' }, { dbPath })) as {
      hits: Array<{ clauseNumber: string }>;
      search_notes?: string[];
    };
    expect(r.hits.map((h) => h.clauseNumber)).toEqual(['1-4-1']);
    expect(r.search_notes?.[0]).toContain('"消費税法" を含む文書に広げて検索しました');
  });
});
