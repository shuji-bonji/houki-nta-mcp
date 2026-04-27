import { describe, it, expect } from 'vitest';
import {
  handleNtaSearchTsutatsu,
  handleNtaGetTsutatsu,
  handleNtaSearchQa,
  handleNtaGetQa,
  handleNtaSearchTaxAnswer,
  handleNtaGetTaxAnswer,
  handleResolveAbbreviation,
  toolHandlers,
} from './handlers.js';

describe('Phase 0 — 全 nta_* スタブが not_implemented を返す', () => {
  it('nta_search_tsutatsu', async () => {
    const r = (await handleNtaSearchTsutatsu({ keyword: '電帳法' })) as { status?: string };
    expect(r.status).toBe('not_implemented');
  });

  it('nta_get_tsutatsu', async () => {
    const r = (await handleNtaGetTsutatsu({ name: '消基通' })) as { status?: string };
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

  it('辞書に無いエントリは resolved: null を返す', async () => {
    const r = (await handleResolveAbbreviation({ abbr: '存在しない通達' })) as {
      resolved: unknown;
      note?: string;
    };
    expect(r.resolved).toBeNull();
    expect(r.note).toContain('辞書に該当なし');
  });

  // Phase 1 以降: houki-abbreviations に houki-nta 管轄エントリ（消基通等）が
  // 追加されたら、in_scope=true のテストケースを足す。
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
