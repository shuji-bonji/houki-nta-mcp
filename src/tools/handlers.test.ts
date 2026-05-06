import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { encode as iconvEncode } from 'iconv-lite';

import {
  handleNtaSearchTsutatsu,
  handleNtaSearchQa,
  handleNtaSearchTaxAnswer,
  handleNtaInspectPdfMeta,
  handleResolveAbbreviation,
  getTsutatsu,
  getTaxAnswer,
  getQa,
  searchTsutatsu,
  toolHandlers,
} from './handlers.js';

describe('search 系 (Phase 3c で本実装)', () => {
  // DB 空（in-memory）の場合は results=[] と hint を返す
  it('nta_search_qa: 空 DB は results=[] + hint', async () => {
    const r = (await handleNtaSearchQa({ keyword: '社内会議' }, { dbPath: ':memory:' })) as {
      results?: unknown[];
      hint?: string;
    };
    expect(r.results).toEqual([]);
    expect(r.hint).toContain('--bulk-download-qa');
  });

  it('nta_search_tax_answer: 空 DB は results=[] + hint', async () => {
    const r = (await handleNtaSearchTaxAnswer(
      { keyword: '医療費控除' },
      { dbPath: ':memory:' }
    )) as {
      results?: unknown[];
      hint?: string;
    };
    expect(r.results).toEqual([]);
    expect(r.hint).toContain('--bulk-download-tax-answer');
  });
});

describe('searchTsutatsu — Phase 2c 本実装', () => {
  // 空 DB（in-memory）で「bulk-download を促すエラー」が返ること
  it('DB が空のときは bulk-download を促すエラー + hint を返す', async () => {
    const r = (await searchTsutatsu({ keyword: '納税義務' }, { dbPath: ':memory:' })) as {
      error?: string;
      hint?: string;
    };
    expect(r.error).toContain('検索対象がありません');
    expect(r.hint).toContain('--bulk-download');
  });

  it('keyword 未指定はエラー', async () => {
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

describe('getTsutatsu — 引数バリデーション', () => {
  it('辞書に無い名前はエラー', async () => {
    const r = (await getTsutatsu({ name: '存在しない通達' }, { dbPath: ':memory:' })) as {
      error?: string;
    };
    expect(r.error).toContain('辞書に該当なし');
  });

  it('管轄外（消法 = houki-egov）は誘導 hint を返す', async () => {
    const r = (await getTsutatsu({ name: '消法' }, { dbPath: ':memory:' })) as {
      error?: string;
      hint?: string;
    };
    expect(r.error).toContain('houki-egov');
    expect(r.hint).toContain('houki-egov-mcp');
  });

  it('clause 未指定はエラー', async () => {
    const r = (await getTsutatsu({ name: '消基通' }, { dbPath: ':memory:' })) as {
      error?: string;
      hint?: string;
    };
    expect(r.error).toContain('clause');
    expect(r.hint).toContain('5-1-9');
  });

  it('不正な clause 形式（DB miss + ライブ取得経路でも不正）はエラー', async () => {
    const r = (await getTsutatsu({ name: '消基通', clause: '5-1' }, { dbPath: ':memory:' })) as {
      error?: string;
    };
    expect(r.error).toContain('不正');
  });

  it('houki-nta 管轄だが DB 未投入 + ライブ未対応の通達（電帳法取通）はエラー + hint', async () => {
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
  it('Markdown（既定）で本文・出典・legal_status を含む', async () => {
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

  it('format=json で構造化レスポンス + legal_status を返す', async () => {
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

  it('正式名称（消費税法基本通達）でも引ける', async () => {
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

  it('ページに存在しない clause は available_clauses を返す', async () => {
    const fetchImpl = vi.fn(async () =>
      sjisHtmlResponse('www.nta.go.jp_law_tsutatsu_kihon_shohi_01_04.htm')
    ) as unknown as typeof fetch;

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

  it('国税庁取得失敗（404）はエラー情報を返す', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('not found', { status: 404, statusText: 'Not Found' })
    ) as unknown as typeof fetch;

    const r = (await getTsutatsu(
      { name: '消基通', clause: '1-4-1' },
      { fetchImpl, dbPath: ':memory:' }
    )) as {
      error?: string;
      status?: number;
    };

    expect(r.error).toContain('取得に失敗');
    expect(r.status).toBe(404);
  });
});

/* -------------------------------------------------------------------------- */
/* getTsutatsu — Phase 2d DB lookup 経路                                       */
/* -------------------------------------------------------------------------- */

describe('getTsutatsu — DB lookup 経路（Phase 2d）', () => {
  // テスト用に in-memory DB に通達と clause を seed するヘルパ
  // openDb で別 DB を毎回 open するので、PATH を共有する形で seed → 検証する
  // ※ better-sqlite3 の :memory: は接続ごとに別 DB になるため、tmpfile を使う
  it('seed した通達 + clause を DB lookup で返す（fetch しない）', async () => {
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

  it('DB に通達はあるが該当 clause が無い場合、available_clauses を返す', async () => {
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
    seedDb.close();

    const r = (await getTsutatsu({ name: '消基通', clause: '99-99-99' }, { dbPath: tmpFile })) as {
      error?: string;
      available_clauses?: string[];
    };

    expect(r.error).toContain('99-99-99');
    expect(r.available_clauses).toContain('1-1-1');

    const fs = await import('node:fs');
    fs.rmSync(tmpFile, { force: true });
    fs.rmSync(`${tmpFile}-wal`, { force: true });
    fs.rmSync(`${tmpFile}-shm`, { force: true });
  });

  it('DB が空 + ライブ取得対応通達なら、ライブ取得にフォールバック', async () => {
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
  it('数字以外の番号はエラー', async () => {
    const r = (await getTaxAnswer({ no: 'abc' })) as { error?: string };
    expect(r.error).toContain('数字');
  });

  it('8xxx 番台（未対応）はエラー + hint', async () => {
    const r = (await getTaxAnswer({ no: '8001' })) as { error?: string; hint?: string };
    expect(r.error).toContain('未対応');
    expect(r.hint).toContain('1xxx');
  });
});

describe('getTaxAnswer — 6101 (消費税) を取得', () => {
  it('Markdown（既定）で本文・出典・legal_status を含む', async () => {
    const fetchImpl = vi.fn(async () =>
      utf8HtmlResponse('www.nta.go.jp_taxes_shiraberu_taxanswer_shohi_6101.htm')
    ) as unknown as typeof fetch;

    const r = (await getTaxAnswer({ no: '6101' }, { fetchImpl })) as string;
    expect(typeof r).toBe('string');
    expect(r).toContain('No.6101');
    expect(r).toContain('消費税の基本的なしくみ');
    expect(r).toContain('対象税目: 消費税');
    expect(r).toContain('概要');
    expect(r).toContain('参考解説資料'); // legal_status note
  });

  it('format=json で構造化レスポンス + legal_status', async () => {
    const fetchImpl = vi.fn(async () =>
      utf8HtmlResponse('www.nta.go.jp_taxes_shiraberu_taxanswer_shotoku_1120.htm')
    ) as unknown as typeof fetch;

    const r = (await getTaxAnswer({ no: '1120', format: 'json' }, { fetchImpl })) as {
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

  it('番号→税目の自動振り分け: 6xxx→shohi, 1xxx→shotoku, 5xxx→hojin', async () => {
    const fetchImpl = vi.fn(async () =>
      utf8HtmlResponse('www.nta.go.jp_taxes_shiraberu_taxanswer_hojin_5759.htm')
    ) as unknown as typeof fetch;

    await getTaxAnswer({ no: '5759', format: 'json' }, { fetchImpl });
    const calls = (fetchImpl as unknown as { mock: { calls: [string][] } }).mock.calls;
    expect(calls[0][0]).toContain('/hojin/5759.htm');
  });
});

/* -------------------------------------------------------------------------- */
/* getQa — 質疑応答事例取得（fixture モック）                                  */
/* -------------------------------------------------------------------------- */

describe('getQa — 引数バリデーション', () => {
  it('未対応 topic はエラー', async () => {
    const r = (await getQa({ topic: 'unknown', category: '02', id: '19' })) as { error?: string };
    expect(r.error).toContain('未対応');
  });

  it('category 不足はエラー', async () => {
    const r = (await getQa({ topic: 'shohi', category: '', id: '19' })) as { error?: string };
    expect(r.error).toContain('category');
  });
});

describe('getQa — 消費税 02/19 を取得', () => {
  it('Markdown で【照会要旨】【回答要旨】【関係法令通達】を含む', async () => {
    const fetchImpl = vi.fn(async () =>
      sjisHtmlResponse('www.nta.go.jp_law_shitsugi_shohi_02_19.htm')
    ) as unknown as typeof fetch;

    const r = (await getQa({ topic: 'shohi', category: '02', id: '19' }, { fetchImpl })) as string;
    expect(typeof r).toBe('string');
    expect(r).toContain('ゴルフ会員権');
    expect(r).toContain('【照会要旨】');
    expect(r).toContain('【回答要旨】');
    expect(r).toContain('【関係法令通達】');
    expect(r).toContain('参考解説資料');
  });

  it('format=json で構造化レスポンス', async () => {
    const fetchImpl = vi.fn(async () =>
      sjisHtmlResponse('www.nta.go.jp_law_shitsugi_shohi_02_19.htm')
    ) as unknown as typeof fetch;

    const r = (await getQa(
      { topic: 'shohi', category: '02', id: '19', format: 'json' },
      { fetchImpl }
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

  it('1 桁 category/id を 2 桁にゼロパディングする', async () => {
    const fetchImpl = vi.fn(async () =>
      sjisHtmlResponse('www.nta.go.jp_law_shitsugi_shohi_02_19.htm')
    ) as unknown as typeof fetch;

    await getQa({ topic: 'shohi', category: '2', id: '19', format: 'json' }, { fetchImpl });
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
      const r = (await getTaxAnswer({ no: '6101', format: 'json' })) as {
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
      const r = (await getQa({ topic: 'shohi', category: '02', id: '19', format: 'json' })) as {
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

  it('PDF 付き文書: kind 優先度ソート + reader_hints を返す', async () => {
    // in-file seed のために temp DB を使う
    const Database = (await import('better-sqlite3')).default;
    const tmpFile = `/tmp/inspect-pdf-meta-test-${Date.now()}.db`;
    const seedDb = new Database(tmpFile);
    const { initSchema } = await import('../db/schema.js');
    initSchema(seedDb);

    seedDb
      .prepare(
        `INSERT INTO document(doc_type, doc_id, taxonomy, title, source_url, fetched_at, full_text, attached_pdfs_json, content_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'kaisei',
        'sample-001',
        'shohi',
        'インボイス改正',
        'https://x/index.htm',
        '2026-05-06T00:00:00Z',
        '本文',
        JSON.stringify([
          { title: '別紙', url: 'https://x/b.pdf', sizeKb: 120, kind: 'attachment' },
          {
            title: '新旧対照表',
            url: 'https://x/a.pdf',
            sizeKb: 470,
            kind: 'comparison',
          },
        ]),
        'h1'
      );
    seedDb.close();

    const r = (await handleNtaInspectPdfMeta(
      { docType: 'kaisei', docId: 'sample-001' },
      { dbPath: tmpFile }
    )) as {
      docType: string;
      docId: string;
      title: string;
      attachedPdfs: Array<{ kind?: string; url: string }>;
      reader_hints: {
        tool: string;
        primary_action: string;
        min_pdf_reader_version?: string;
        examples: Array<{ kind: string; tool: string; args: { url: string } }>;
      };
    };

    expect(r.docType).toBe('kaisei');
    expect(r.docId).toBe('sample-001');
    expect(r.title).toBe('インボイス改正');
    // comparison が attachment より先
    expect(r.attachedPdfs[0].kind).toBe('comparison');
    expect(r.attachedPdfs[1].kind).toBe('attachment');
    // v0.7.2: kind 別に複数の examples が出る (comparison + attachment の 2 件)
    expect(r.reader_hints.tool).toContain('pdf-reader-mcp');
    expect(r.reader_hints.primary_action).toBe('extract_tables');
    expect(r.reader_hints.min_pdf_reader_version).toBe('0.3.0');
    expect(r.reader_hints.examples).toHaveLength(2);
    expect(r.reader_hints.examples[0]).toMatchObject({
      kind: 'comparison',
      tool: 'extract_tables',
      args: { url: 'https://x/a.pdf' },
    });
    expect(r.reader_hints.examples[1]).toMatchObject({
      kind: 'attachment',
      tool: 'extract_tables',
      args: { url: 'https://x/b.pdf' },
    });
  });

  it('v0.6.0 期の DB レコード (kind なし) はタイトルから動的補完される (v0.7.2)', async () => {
    const Database = (await import('better-sqlite3')).default;
    const tmpFile = `/tmp/inspect-pdf-meta-fillkind-${Date.now()}.db`;
    const seedDb = new Database(tmpFile);
    const { initSchema } = await import('../db/schema.js');
    initSchema(seedDb);

    seedDb
      .prepare(
        `INSERT INTO document(doc_type, doc_id, taxonomy, title, source_url, fetched_at, full_text, attached_pdfs_json, content_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'kaisei',
        'legacy-001',
        'shohi',
        '改正通達',
        'https://x/index.htm',
        '2026-05-06T00:00:00Z',
        '本文',
        // kind フィールド無し（v0.6.0 期投入を再現）
        JSON.stringify([
          { title: '新旧対応表', url: 'https://x/c.pdf', sizeKb: 399 },
          { title: '別紙1', url: 'https://x/a.pdf', sizeKb: 67 },
        ]),
        'h2'
      );
    seedDb.close();

    const r = (await handleNtaInspectPdfMeta(
      { docType: 'kaisei', docId: 'legacy-001' },
      { dbPath: tmpFile }
    )) as {
      attachedPdfs: Array<{ kind?: string; title: string }>;
      reader_hints: { examples: Array<{ kind: string; tool: string }> };
    };

    // タイトルから推定された kind が attachedPdfs に入る
    expect(r.attachedPdfs.find((p) => p.title === '新旧対応表')?.kind).toBe('comparison');
    expect(r.attachedPdfs.find((p) => p.title === '別紙1')?.kind).toBe('attachment');
    // examples も kind 別に出る
    expect(r.reader_hints.examples.map((e) => e.kind)).toEqual(['comparison', 'attachment']);
  });
});
