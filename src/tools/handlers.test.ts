import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { encode as iconvEncode } from 'iconv-lite';

import {
  handleNtaSearchTsutatsu,
  handleNtaSearchQa,
  handleNtaGetQa,
  handleNtaSearchTaxAnswer,
  handleNtaGetTaxAnswer,
  handleResolveAbbreviation,
  getTsutatsu,
  toolHandlers,
} from './handlers.js';

describe('未実装スタブ — 後続フェーズで本実装予定の tool が not_implemented を返す', () => {
  it('nta_search_tsutatsu', async () => {
    const r = (await handleNtaSearchTsutatsu({ keyword: '電帳法' })) as { status?: string };
    expect(r.status).toBe('not_implemented');
  });

  it('nta_search_qa', async () => {
    const r = (await handleNtaSearchQa({ keyword: '社内会議' })) as { status?: string };
    expect(r.status).toBe('not_implemented');
  });

  it('nta_get_qa', async () => {
    const r = (await handleNtaGetQa({ identifier: 'xxx' })) as { status?: string };
    expect(r.status).toBe('not_implemented');
  });

  it('nta_search_tax_answer', async () => {
    const r = (await handleNtaSearchTaxAnswer({ keyword: '医療費控除' })) as { status?: string };
    expect(r.status).toBe('not_implemented');
  });

  it('nta_get_tax_answer', async () => {
    const r = (await handleNtaGetTaxAnswer({ no: '6101' })) as { status?: string };
    expect(r.status).toBe('not_implemented');
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
    const r = (await getTsutatsu({ name: '存在しない通達' })) as { error?: string };
    expect(r.error).toContain('辞書に該当なし');
  });

  it('管轄外（消法 = houki-egov）は誘導 hint を返す', async () => {
    const r = (await getTsutatsu({ name: '消法' })) as {
      error?: string;
      hint?: string;
    };
    expect(r.error).toContain('houki-egov');
    expect(r.hint).toContain('houki-egov-mcp');
  });

  it('clause 未指定はエラー', async () => {
    const r = (await getTsutatsu({ name: '消基通' })) as { error?: string; hint?: string };
    expect(r.error).toContain('clause');
    expect(r.hint).toContain('5-1-9');
  });

  it('不正な clause 形式はエラー', async () => {
    const r = (await getTsutatsu({ name: '消基通', clause: '5-1' })) as { error?: string };
    expect(r.error).toContain('clause');
    expect(r.error).toContain('不正');
  });

  it('houki-nta 管轄だが URL 未対応の通達（電帳法取通 等）は supported list と hint を返す', async () => {
    const r = (await getTsutatsu({ name: '電帳法取通', clause: '1-1-1' })) as {
      error?: string;
      hint?: string;
      supported?: string[];
    };
    expect(r.error).toContain('未対応');
    expect(r.supported).toContain('消費税法基本通達');
    // Phase 1d 調査結果を踏まえ、Phase 2 対応予定の hint を返す
    expect(r.hint).toContain('Phase 2');
  });
});

describe('getTsutatsu — 消基通 1-4-1 を取得（fetchImpl モック）', () => {
  it('Markdown（既定）で本文・出典・legal_status を含む', async () => {
    const fetchImpl = vi.fn(async () =>
      sjisHtmlResponse('www.nta.go.jp_law_tsutatsu_kihon_shohi_01_04.htm')
    ) as unknown as typeof fetch;

    const r = (await getTsutatsu({ name: '消基通', clause: '1-4-1' }, { fetchImpl })) as string;

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
      { fetchImpl }
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
      { fetchImpl }
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

    const r = (await getTsutatsu({ name: '消基通', clause: '1-4-99' }, { fetchImpl })) as {
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

    const r = (await getTsutatsu({ name: '消基通', clause: '1-4-1' }, { fetchImpl })) as {
      error?: string;
      status?: number;
    };

    expect(r.error).toContain('取得に失敗');
    expect(r.status).toBe(404);
  });
});

/* -------------------------------------------------------------------------- */
/* integration test — INTEGRATION=1 でのみ実行（CI canary）                    */
/* -------------------------------------------------------------------------- */

const integration = process.env.INTEGRATION === '1';
const itIntegration = integration ? it : it.skip;

describe('getTsutatsu — integration (INTEGRATION=1 でのみ実行)', () => {
  itIntegration(
    '実 nta.go.jp から消基通 1-4-1 を取得してパースまで通る（HTML 構造変更カナリア）',
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
        'resolve_abbreviation',
      ].sort()
    );
  });
});
