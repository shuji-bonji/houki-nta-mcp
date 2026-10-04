/**
 * 差分 specs/changes/20261003-t5-docs-mismatch/（PR #126）の受入テスト。
 *
 * - SPEC-NTA-COMMON-ERRORS-009: ページの解析の失敗の INTERNAL_ERROR は retryable: false
 * - SPEC-NTA-RESOLVE-ABBREVIATION-003: 管轄外のエントリの hint と next_actions
 * - SPEC-NTA-SEARCH-TSUTATSU-003: DB が空のときは --bulk-download-all を案内する
 * - SPEC-NTA-SEARCH-TAX-ANSWER-006: ヒットしたときは nta_get_tax_answer を next_actions で案内する
 *
 * SPEC-NTA-COMMON-ERRORS-002（UNKNOWN_TOOL）と 006（想定外の例外）は、tools/call を通す
 * src/server.test.ts で確かめる。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { encode as iconvEncode } from 'iconv-lite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withTaxAnswerIndex } from '../../tests/support/tax-answer-index.js';
import { initSchema } from '../db/schema.js';
import {
  describeOutOfScope,
  getQa,
  getTaxAnswer,
  getTsutatsu,
  handleNtaSearchTaxAnswer,
  handleResolveAbbreviation,
  searchTsutatsu,
} from './handlers.js';

interface Body {
  code?: string;
  error?: string;
  hint?: string;
  retryable?: boolean;
  next_actions?: Array<{ action: string; reason?: string; example?: Record<string, unknown> }>;
  results?: Array<{ docId: string }>;
}

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'houki-nta-t5-'));
  dbPath = join(dir, 'cache.db');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-COMMON-ERRORS-009                                                  */
/* -------------------------------------------------------------------------- */

/** 国税庁のページとして解析できない HTML（本文の構造が無い） */
const UNPARSEABLE_HTML =
  '<html><head><meta charset="Shift_JIS"><title>メンテナンス中</title></head><body><div>ただいまメンテナンス中です</div></body></html>';

function unparseableFetch(): typeof fetch {
  return vi.fn(
    async () =>
      new Response(iconvEncode(UNPARSEABLE_HTML, 'shift_jis'), {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=Shift_JIS' },
      })
  ) as unknown as typeof fetch;
}

const PARSE_FAILURE_HINT = 'パーサのバグまたは国税庁ページの構造変更の可能性。報告してください';

describe('SPEC-NTA-COMMON-ERRORS-009 国税庁のページの解析に失敗したときは INTERNAL_ERROR（retryable: false）', () => {
  beforeEach(() => {
    const db = new Database(dbPath);
    initSchema(db);
    db.close();
  });

  it('SPEC-NTA-COMMON-ERRORS-009 nta_get_tsutatsu: 「通達ページのパースに失敗」は retryable: false', async () => {
    const body = (await getTsutatsu(
      { name: '消費税法基本通達', clause: '5-1-9', format: 'json' },
      { fetchImpl: unparseableFetch(), dbPath }
    )) as Body;
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.error?.startsWith('通達ページのパースに失敗: ')).toBe(true);
    expect(body.retryable).toBe(false);
    expect(body.hint).toBe(PARSE_FAILURE_HINT);
  });

  it('SPEC-NTA-COMMON-ERRORS-009 nta_get_qa: 「質疑応答事例ページのパースに失敗」は retryable: false', async () => {
    const body = (await getQa(
      { topic: 'shohi', category: '02', id: '19', format: 'json' },
      { fetchImpl: unparseableFetch(), dbPath }
    )) as Body;
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.error?.startsWith('質疑応答事例ページのパースに失敗: ')).toBe(true);
    expect(body.retryable).toBe(false);
    expect(body.hint).toBe(PARSE_FAILURE_HINT);
  });

  it('SPEC-NTA-COMMON-ERRORS-009 nta_get_tax_answer: 「タックスアンサーページのパースに失敗」は retryable: false', async () => {
    const body = (await getTaxAnswer(
      { no: '6101', format: 'json' },
      { fetchImpl: withTaxAnswerIndex(unparseableFetch()), dbPath }
    )) as Body;
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.error?.startsWith('タックスアンサーページのパースに失敗: ')).toBe(true);
    expect(body.retryable).toBe(false);
    expect(body.hint).toBe(PARSE_FAILURE_HINT);
  });
});

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-RESOLVE-ABBREVIATION-003                                           */
/* -------------------------------------------------------------------------- */

const DELEGATE_TO_EGOV = {
  action: 'delegate_to_mcp',
  reason: 'houki-egov の管轄リソースです。該当 MCP に切り替えてください',
  example: { mcp: 'houki-egov' },
};

describe('SPEC-NTA-RESOLVE-ABBREVIATION-003 管轄外のエントリには in_scope: false と、管轄の MCP への案内を返す', () => {
  it('SPEC-NTA-RESOLVE-ABBREVIATION-003 abbr: "消法" は houki-egov の管轄で、hint と delegate_to_mcp の next_actions を返す', async () => {
    const r = (await handleResolveAbbreviation({ abbr: '消法' })) as {
      resolved: { formal: string; source_mcp_hint: string } | null;
      in_scope: boolean;
      hint?: string;
      next_actions?: unknown[];
    };
    expect(r.resolved?.formal).toBe('消費税法');
    expect(r.resolved?.source_mcp_hint).toBe('houki-egov');
    expect(r.in_scope).toBe(false);
    expect(r.hint).toBe(
      'このエントリは houki-egov の管轄です。houki-egov-mcp で取得してください。'
    );
    expect(r.next_actions).toEqual([DELEGATE_TO_EGOV]);
  });

  it('SPEC-NTA-RESOLVE-ABBREVIATION-003 houki-egov の管轄の案内は、hint と next_actions の組み立てでも同じ', () => {
    expect(describeOutOfScope('houki-egov')).toEqual({
      hint: 'このエントリは houki-egov の管轄です。houki-egov-mcp で取得してください。',
      next_actions: [DELEGATE_TO_EGOV],
    });
  });

  it('SPEC-NTA-RESOLVE-ABBREVIATION-003 family にまだ無い管轄（houki-court）は「対応する MCP サーバーはまだありません」の hint で、next_actions を付けない', () => {
    const r = describeOutOfScope('houki-court') as { hint: string; next_actions?: unknown };
    expect(r.hint).toBe(
      'このエントリは houki-court の管轄ですが、対応する MCP サーバーはまだありません。'
    );
    expect(r.hint).not.toContain('houki-court-mcp');
    expect(r.next_actions).toBeUndefined();
  });

  it('SPEC-NTA-RESOLVE-ABBREVIATION-003 houki-nta の管轄（消基通）には hint も next_actions も付けない', async () => {
    const r = (await handleResolveAbbreviation({ abbr: '消基通' })) as {
      in_scope: boolean;
      hint?: string;
      next_actions?: unknown;
    };
    expect(r.in_scope).toBe(true);
    expect(r.hint).toBeUndefined();
    expect(r.next_actions).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-SEARCH-TSUTATSU-003                                                */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-SEARCH-TSUTATSU-003 DB に条項が 1 件も無いときは、基本通達 4 種の bulk download を案内する', () => {
  it('SPEC-NTA-SEARCH-TSUTATSU-003 空の DB で { keyword: "役員" } は TSUTATSU_NOT_FOUND で、hint と next_actions は --bulk-download-all', async () => {
    const body = (await searchTsutatsu({ keyword: '役員' }, { dbPath: ':memory:' })) as Body;
    expect(body.code).toBe('TSUTATSU_NOT_FOUND');
    expect(body.error).toBe('ローカル DB に検索対象がありません');
    expect(body.hint).toContain('--bulk-download-all');
    // 1 つの通達だけを先に入れる方法も併記する
    expect(body.hint).toContain('--bulk-download --tsutatsu=');
    expect(body.next_actions?.[0]?.action).toBe('cli_bulk_download');
    expect(body.next_actions?.[0]?.example?.command).toMatch(
      // v0.25.0（SPEC-NTA-DB-SCHEMA-027）: DB のパスを渡すと HOUKI_NTA_DB_PATH で起動したときと同じで、変数が前に付く
      /^HOUKI_NTA_DB_PATH=\S+ npx -y @shuji-bonji\/houki-nta-mcp@latest --bulk-download-all$/
    );
  });
});

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-SEARCH-TAX-ANSWER-006                                              */
/* -------------------------------------------------------------------------- */

function seedTaxAnswers(): void {
  const db = new Database(dbPath);
  initSchema(db);
  const stmt = db.prepare(
    `INSERT INTO document(doc_type, doc_id, taxonomy, title, issued_at, source_url, fetched_at, full_text, attached_pdfs_json, content_hash)
     VALUES ('tax-answer', ?, 'shotoku', ?, '2025-04-01', ?, '2026-10-01T00:00:00.000Z', ?, '[]', ?)`
  );
  stmt.run(
    '1131',
    '医療費控除の対象となる医療費',
    'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1131.htm',
    '医療費控除の対象となる医療費の範囲',
    'hash-1131'
  );
  db.close();
}

describe('SPEC-NTA-SEARCH-TAX-ANSWER-006 ヒットしたときは、先頭の記事を nta_get_tax_answer で読む案内を next_actions に入れる', () => {
  it('SPEC-NTA-SEARCH-TAX-ANSWER-006 { keyword: "医療費控除" } で results[0].docId が "1131" のとき、next_actions は nta_get_tax_answer の 1 件', async () => {
    seedTaxAnswers();
    const r = (await handleNtaSearchTaxAnswer({ keyword: '医療費控除' }, { dbPath })) as Body;
    expect(r.results?.[0]?.docId).toBe('1131');
    expect(r.next_actions).toEqual([
      { action: 'nta_get_tax_answer', reason: '記事の本文を読めます', example: { no: '1131' } },
    ]);
  });

  it('SPEC-NTA-SEARCH-TAX-ANSWER-006 0 件のときは next_actions を付けない', async () => {
    seedTaxAnswers();
    const r = (await handleNtaSearchTaxAnswer({ keyword: '存在しない語句' }, { dbPath })) as Body;
    expect(r.results).toEqual([]);
    expect((r.next_actions ?? []).some((a) => a.action === 'nta_get_tax_answer')).toBe(false);
  });
});
