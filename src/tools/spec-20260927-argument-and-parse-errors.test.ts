/**
 * 差分 specs/changes/20260927-argument-and-parse-errors/ の受入テスト。
 *
 * ADDED:
 *   - SPEC-NTA-COMMON-ERRORS-007 inputSchema の検査で返す INVALID_ARGUMENT の error・hint・next_actions
 *   - SPEC-NTA-COMMON-ERRORS-008 inputSchema に合わない引数では、ツールの処理に進まない
 *   - SPEC-NTA-COMMON-ERRORS-009 国税庁のページの解析に失敗したときの INTERNAL_ERROR
 * 既存の仕様 ID で受ける項目（proposal.md の表）:
 *   - nta_get_jimu_unei・nta_get_kaisei_tsutatsu・nta_inspect_pdf_meta・
 *     nta_search_jimu_unei・nta_search_kaisei_tsutatsu の応答としての 003・004（・007・008）
 *
 * 引数の検査は tools/call の受け口（toolHandlers）を通して確かめる。違反は 1 回の呼び出しに 1 つだけ入れる
 * （2 つ以上のときの detail.issues は v0.22.0 の SPEC-NTA-COMMON-ERRORS-010 で決めた。spec-20261001-t1-argument-guards.test.ts）。
 * hint の括弧の中は v0.22.0 から「型・必須・enum・範囲・形式・未知の引数」（SPEC-NTA-COMMON-ERRORS-007 の MODIFIED）。
 * 国税庁サイトは fetchImpl（009）またはグローバルの fetch の差し替え（008）で代える。
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as abbreviations from '@shuji-bonji/houki-abbreviations';
import Database from 'better-sqlite3';
import { encode as iconvEncode } from 'iconv-lite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initSchema } from '../db/schema.js';
import { tools } from './definitions.js';
import { getQa, getTaxAnswer, getTsutatsu, toolHandlers } from './handlers.js';

// 略称辞書を引いたかを数えるため、関数の export を呼び出しを記録する関数で包む（動きは元のまま）
vi.mock('@shuji-bonji/houki-abbreviations', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  const wrapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(mod)) {
    wrapped[key] =
      typeof value === 'function'
        ? vi.fn((...args: unknown[]) => (value as (...a: unknown[]) => unknown)(...args))
        : value;
  }
  return wrapped;
});

/* -------------------------------------------------------------------------- */
/* 共通の準備                                                                  */
/* -------------------------------------------------------------------------- */

const INVALID_ARGUMENT_PREFIX = '引数が tools/list の inputSchema に合いません: ';
const UNKNOWN_ARGUMENT_MESSAGE = 'inputSchema に無い引数です';
const PARSE_FAILURE_HINT = 'パーサのバグまたは国税庁ページの構造変更の可能性。報告してください';

interface Issue {
  path: string;
  message: string;
}

interface ErrorBody {
  error?: string;
  code?: string;
  tool?: string;
  hint?: string;
  url?: string;
  next_actions?: Array<{ action: string; reason?: string; example?: unknown }>;
  detail?: { issues?: Issue[]; url?: string; cause?: string };
}

async function call(name: string, args: unknown): Promise<ErrorBody> {
  const handler = toolHandlers[name];
  expect(handler, `toolHandlers に ${name} が無い`).toBeDefined();
  return (await handler(args)) as ErrorBody;
}

function expectInvalidArgument(body: ErrorBody, tool: string, path: string): void {
  expect(body.code).toBe('INVALID_ARGUMENT');
  expect(body.tool).toBe(tool);
  expect(body.detail?.issues?.[0]?.path).toBe(path);
}

/** SPEC-NTA-COMMON-ERRORS-007 の error・hint・next_actions を確かめる（違反は 1 つの前提） */
function expectInputSchemaGuidance(body: ErrorBody, tool: string): void {
  const issue = body.detail?.issues?.[0];
  expect(issue).toBeDefined();
  const expectedProblem = issue?.path ? `${issue.path}: ${issue.message}` : `${issue?.message}`;
  expect(body.error).toBe(`${INVALID_ARGUMENT_PREFIX}${expectedProblem}`);
  expect(body.hint).toBe(
    `tools/list の ${tool} の inputSchema を確認してください (型・必須・enum・範囲・形式・未知の引数)`
  );
  expect(body.next_actions).toEqual([
    { action: 'list_tools', reason: 'inputSchema で引数の型と必須項目を確認できます' },
  ]);
}

/** inputSchema の必須の引数に、型に合う値を入れた引数を作る */
function validRequiredArgs(tool: (typeof tools)[number]): Record<string, unknown> {
  const schema = tool.inputSchema as {
    properties?: Record<string, { type?: string; enum?: unknown[] }>;
    required?: string[];
  };
  const args: Record<string, unknown> = {};
  for (const key of schema.required ?? []) {
    const prop = schema.properties?.[key] ?? {};
    if (prop.enum && prop.enum.length > 0) args[key] = prop.enum[0];
    else if (prop.type === 'number' || prop.type === 'integer') args[key] = 1;
    else if (prop.type === 'boolean') args[key] = false;
    else args[key] = 'x';
  }
  return args;
}

/** 呼ばれたら記録して失敗する fetch */
function forbiddenFetch() {
  return vi.fn(async () => {
    throw new Error('国税庁サイトを取りに行ってはいけない');
  });
}

/** 略称辞書の関数の呼び出し回数の合計 */
function abbreviationCallCount(): number {
  let count = 0;
  for (const value of Object.values(abbreviations)) {
    const mock = (value as { mock?: { calls: unknown[] } }).mock;
    if (mock) count += mock.calls.length;
  }
  return count;
}

function clearAbbreviationCalls(): void {
  for (const value of Object.values(abbreviations)) {
    const fn = value as { mockClear?: () => void };
    fn.mockClear?.();
  }
}

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-COMMON-ERRORS-007                                                  */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-COMMON-ERRORS-007 inputSchema の検査で返す INVALID_ARGUMENT には、inputSchema を確かめる案内を付ける', () => {
  it('SPEC-NTA-COMMON-ERRORS-007 nta_search_jimu_unei に { keyword: "x", foo: 1 } を渡すと、error は「…: foo: inputSchema に無い引数です」、hint はツール名入りの案内', async () => {
    const body = await call('nta_search_jimu_unei', { keyword: 'x', foo: 1 });
    expect(body.code).toBe('INVALID_ARGUMENT');
    expect(body.error).toBe(`${INVALID_ARGUMENT_PREFIX}foo: ${UNKNOWN_ARGUMENT_MESSAGE}`);
    expect(body.hint).toBe(
      'tools/list の nta_search_jimu_unei の inputSchema を確認してください (型・必須・enum・範囲・形式・未知の引数)'
    );
    expect(body.next_actions).toEqual([
      { action: 'list_tools', reason: 'inputSchema で引数の型と必須項目を確認できます' },
    ]);
  });

  it('SPEC-NTA-COMMON-ERRORS-007 SPEC-NTA-COMMON-ERRORS-010 SPEC-NTA-COMMON-ERRORS-011 nta_get_jimu_unei に {} を渡すと、detail.issues は [{ path: "docId", message: "必須の引数です" }] で、error は「docId: 必須の引数です」（v0.21.3 は path が空文字だった）', async () => {
    const body = await call('nta_get_jimu_unei', {});
    expect(body.code).toBe('INVALID_ARGUMENT');
    expect(body.detail?.issues).toEqual([{ path: 'docId', message: '必須の引数です' }]);
    expect(body.error).toBe(`${INVALID_ARGUMENT_PREFIX}docId: 必須の引数です`);
  });

  it('SPEC-NTA-COMMON-ERRORS-007 14 ツールとも、inputSchema に無い引数を 1 つ渡すと error・hint・next_actions が同じ形で返る', async () => {
    expect(tools.length).toBe(14);
    for (const tool of tools) {
      const body = await call(tool.name, { ...validRequiredArgs(tool), foo: 1 });
      expect(body.code, tool.name).toBe('INVALID_ARGUMENT');
      expect(body.detail?.issues?.[0]?.path, tool.name).toBe('foo');
      expect(body.error, tool.name).toBe(
        `${INVALID_ARGUMENT_PREFIX}foo: ${UNKNOWN_ARGUMENT_MESSAGE}`
      );
      expectInputSchemaGuidance(body, tool.name);
    }
  });

  it('SPEC-NTA-COMMON-ERRORS-007 型の違反（nta_search_kaisei_tsutatsu に { keyword: 1 }）でも、error は「<path>: <message>」を続け、hint・next_actions は同じ', async () => {
    const body = await call('nta_search_kaisei_tsutatsu', { keyword: 1 });
    expect(body.detail?.issues?.[0]?.path).toBe('keyword');
    expectInputSchemaGuidance(body, 'nta_search_kaisei_tsutatsu');
  });
});

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-COMMON-ERRORS-008                                                  */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-COMMON-ERRORS-008 inputSchema に合わない引数では、ツールの処理に進まない', () => {
  let dir: string;
  let dbPath: string;
  let savedDbPath: string | undefined;
  let fetchSpy: ReturnType<typeof forbiddenFetch>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'houki-nta-spec-008-'));
    dbPath = join(dir, 'never-created.db');
    savedDbPath = process.env.HOUKI_NTA_DB_PATH;
    process.env.HOUKI_NTA_DB_PATH = dbPath;
    fetchSpy = forbiddenFetch();
    vi.stubGlobal('fetch', fetchSpy);
    clearAbbreviationCalls();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (savedDbPath === undefined) delete process.env.HOUKI_NTA_DB_PATH;
    else process.env.HOUKI_NTA_DB_PATH = savedDbPath;
    rmSync(dir, { recursive: true, force: true });
  });

  it('SPEC-NTA-COMMON-ERRORS-008 nta_get_qa に { topic: "shohi", category: "01" }（id が無い）を渡しても、国税庁サイトへの取得は起きず、DB も開かない', async () => {
    const body = await call('nta_get_qa', { topic: 'shohi', category: '01' });
    expect(body.code).toBe('INVALID_ARGUMENT');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(existsSync(dbPath)).toBe(false);
  });

  it('SPEC-NTA-COMMON-ERRORS-008 nta_get_tsutatsu に inputSchema に無い引数を渡しても、略称辞書を引かず、国税庁サイトにも DB にも進まない', async () => {
    const body = await call('nta_get_tsutatsu', { name: '消基通', clause: '5-1-9', foo: 1 });
    expect(body.code).toBe('INVALID_ARGUMENT');
    expect(abbreviationCallCount()).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(existsSync(dbPath)).toBe(false);
  });

  it('SPEC-NTA-COMMON-ERRORS-008 nta_get_tax_answer に { no: 6101 }（型の違反）を渡しても、国税庁サイトにも DB にも進まない', async () => {
    const body = await call('nta_get_tax_answer', { no: 6101 });
    expect(body.code).toBe('INVALID_ARGUMENT');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(existsSync(dbPath)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-COMMON-ERRORS-009                                                  */
/* -------------------------------------------------------------------------- */

/** 国税庁のページとして解析できない HTML（本文の構造が無い） */
const UNPARSEABLE_HTML =
  '<html><head><meta charset="Shift_JIS"><title>メンテナンス中</title></head><body><div>ただいまメンテナンス中です</div></body></html>';

function unparseableFetch() {
  const urls: string[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);
    return new Response(iconvEncode(UNPARSEABLE_HTML, 'shift_jis'), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=Shift_JIS' },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, urls };
}

/** 書き戻しが起きうる表の行数の合計 */
function storedRowCount(dbPath: string): number {
  const db = new Database(dbPath, { readonly: true });
  try {
    let total = 0;
    for (const table of ['tsutatsu', 'tsutatsu_toc', 'chapter', 'section', 'clause', 'document']) {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
      total += row.n;
    }
    return total;
  } finally {
    db.close();
  }
}

function expectParseFailure(
  body: ErrorBody & { isError?: boolean },
  errorPrefix: string,
  fetchedUrls: string[]
): void {
  expect(body.code).toBe('INTERNAL_ERROR');
  expect(body.hint).toBe(PARSE_FAILURE_HINT);
  expect(typeof body.url).toBe('string');
  expect(fetchedUrls).toContain(body.url);
  expect(body.detail?.url).toBe(body.url);
  expect(typeof body.detail?.cause).toBe('string');
  expect(body.error).toBe(`${errorPrefix}${body.detail?.cause}`);
}

describe('SPEC-NTA-COMMON-ERRORS-009 国税庁のページの解析に失敗したときは INTERNAL_ERROR で、ページの構造の変更を疑う案内を付ける', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'houki-nta-spec-009-'));
    dbPath = join(dir, 'cache.db');
    const db = new Database(dbPath);
    initSchema(db);
    db.close();
    // handler が fetchImpl を使わずにグローバルの fetch を呼んだら失敗させる
    vi.stubGlobal('fetch', forbiddenFetch());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });

  it('SPEC-NTA-COMMON-ERRORS-009 nta_get_tsutatsu: 取ったページを解析できないと「通達ページのパースに失敗: <理由>」、url と detail に読めなかったページ、DB に書き戻さない', async () => {
    const { fetchImpl, urls } = unparseableFetch();
    clearAbbreviationCalls();
    const body = (await getTsutatsu(
      { name: '消費税法基本通達', clause: '5-1-9', format: 'json' },
      { fetchImpl, dbPath }
    )) as ErrorBody;
    expectParseFailure(body, '通達ページのパースに失敗: ', urls);
    expect(body.url?.startsWith('https://www.nta.go.jp/law/tsutatsu/kihon/shohi/')).toBe(true);
    expect(storedRowCount(dbPath)).toBe(0);
    // 008 の「略称辞書を引かない」の確かめ方が効いていることの裏付け（SPEC-NTA-GET-TSUTATSU-001 で辞書を引く）
    expect(abbreviationCallCount()).toBeGreaterThan(0);
  });

  it('SPEC-NTA-COMMON-ERRORS-009 nta_get_qa: 事例のページを解析できないと「質疑応答事例ページのパースに失敗: <理由>」、url は事例のページ、DB に書き戻さない', async () => {
    const { fetchImpl, urls } = unparseableFetch();
    const body = (await getQa(
      { topic: 'shohi', category: '02', id: '19', format: 'json' },
      { fetchImpl, dbPath }
    )) as ErrorBody;
    expectParseFailure(body, '質疑応答事例ページのパースに失敗: ', urls);
    expect(body.url).toBe('https://www.nta.go.jp/law/shitsugi/shohi/02/19.htm');
    expect(storedRowCount(dbPath)).toBe(0);
  });

  it('SPEC-NTA-COMMON-ERRORS-009 nta_get_tax_answer: 記事のページを解析できないと「タックスアンサーページのパースに失敗: <理由>」、url は記事のページ、DB に書き戻さない', async () => {
    const { fetchImpl, urls } = unparseableFetch();
    const body = (await getTaxAnswer(
      { no: '6101', format: 'json' },
      { fetchImpl, dbPath }
    )) as ErrorBody;
    expectParseFailure(body, 'タックスアンサーページのパースに失敗: ', urls);
    expect(body.url).toBe('https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6101.htm');
    expect(storedRowCount(dbPath)).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* 既存の仕様 ID で受ける項目（proposal.md の表）                              */
/* -------------------------------------------------------------------------- */

describe('既存の仕様 ID で受ける項目 — 各ツールの応答として', () => {
  it('SPEC-NTA-COMMON-ERRORS-003 SPEC-NTA-COMMON-ERRORS-010 nta_get_jimu_unei の応答: {}（docId が無い）は INVALID_ARGUMENT で path は docId', async () => {
    expectInvalidArgument(await call('nta_get_jimu_unei', {}), 'nta_get_jimu_unei', 'docId');
  });

  it('SPEC-NTA-COMMON-ERRORS-004 nta_get_jimu_unei の応答: { docId: "x", foo: 1 } は INVALID_ARGUMENT で path は foo', async () => {
    expectInvalidArgument(
      await call('nta_get_jimu_unei', { docId: 'x', foo: 1 }),
      'nta_get_jimu_unei',
      'foo'
    );
  });

  it('SPEC-NTA-COMMON-ERRORS-003 nta_get_kaisei_tsutatsu の応答: {}（docId が無い）は INVALID_ARGUMENT', async () => {
    const body = await call('nta_get_kaisei_tsutatsu', {});
    expect(body.code).toBe('INVALID_ARGUMENT');
    expect(body.tool).toBe('nta_get_kaisei_tsutatsu');
    expect(body.detail?.issues?.length).toBeGreaterThan(0);
  });

  it('SPEC-NTA-COMMON-ERRORS-003 nta_get_kaisei_tsutatsu の応答: { docId: 1 }（型の違反）は INVALID_ARGUMENT で path は docId', async () => {
    expectInvalidArgument(
      await call('nta_get_kaisei_tsutatsu', { docId: 1 }),
      'nta_get_kaisei_tsutatsu',
      'docId'
    );
  });

  describe('nta_inspect_pdf_meta の応答（違反は 1 つずつ渡す）', () => {
    const base = { docType: 'kaisei', docId: 'x' };

    it('SPEC-NTA-COMMON-ERRORS-003 nta_inspect_pdf_meta の応答: docType "qa-jirei"（enum に無い）は INVALID_ARGUMENT で path は docType', async () => {
      expectInvalidArgument(
        await call('nta_inspect_pdf_meta', { ...base, docType: 'qa-jirei' }),
        'nta_inspect_pdf_meta',
        'docType'
      );
    });

    it('SPEC-NTA-COMMON-ERRORS-003 nta_inspect_pdf_meta の応答: kind "zzz"（enum に無い）は INVALID_ARGUMENT で path は kind', async () => {
      expectInvalidArgument(
        await call('nta_inspect_pdf_meta', { ...base, kind: 'zzz' }),
        'nta_inspect_pdf_meta',
        'kind'
      );
    });

    it('SPEC-NTA-COMMON-ERRORS-003 nta_inspect_pdf_meta の応答: save "yes"（型の違反）は INVALID_ARGUMENT で path は save', async () => {
      expectInvalidArgument(
        await call('nta_inspect_pdf_meta', { ...base, save: 'yes' }),
        'nta_inspect_pdf_meta',
        'save'
      );
    });

    it('SPEC-NTA-COMMON-ERRORS-004 nta_inspect_pdf_meta の応答: inputSchema に無い引数は INVALID_ARGUMENT で path はその引数名', async () => {
      expectInvalidArgument(
        await call('nta_inspect_pdf_meta', { ...base, foo: 1 }),
        'nta_inspect_pdf_meta',
        'foo'
      );
    });
  });

  describe('nta_search_jimu_unei の応答', () => {
    let dir: string;
    let dbPath: string;
    let savedDbPath: string | undefined;
    let fetchSpy: ReturnType<typeof forbiddenFetch>;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'houki-nta-spec-jimu-'));
      dbPath = join(dir, 'never-created.db');
      savedDbPath = process.env.HOUKI_NTA_DB_PATH;
      process.env.HOUKI_NTA_DB_PATH = dbPath;
      fetchSpy = forbiddenFetch();
      vi.stubGlobal('fetch', fetchSpy);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      if (savedDbPath === undefined) delete process.env.HOUKI_NTA_DB_PATH;
      else process.env.HOUKI_NTA_DB_PATH = savedDbPath;
      rmSync(dir, { recursive: true, force: true });
    });

    const cases: Array<{ label: string; args: Record<string, unknown>; path?: string }> = [
      { label: '{}（keyword が無い）', args: {} },
      { label: '{ keyword: 1 }（型の違反）', args: { keyword: 1 }, path: 'keyword' },
      {
        label: '{ keyword: "x", foo: 1 }（inputSchema に無い引数）',
        args: { keyword: 'x', foo: 1 },
        path: 'foo',
      },
    ];

    for (const c of cases) {
      it(`SPEC-NTA-COMMON-ERRORS-003 SPEC-NTA-COMMON-ERRORS-004 SPEC-NTA-COMMON-ERRORS-007 SPEC-NTA-COMMON-ERRORS-008 nta_search_jimu_unei の応答: ${c.label} は INVALID_ARGUMENT と案内を返し、DB も国税庁サイトも引かない`, async () => {
        const body = await call('nta_search_jimu_unei', c.args);
        expect(body.code).toBe('INVALID_ARGUMENT');
        expect(body.tool).toBe('nta_search_jimu_unei');
        if (c.path !== undefined) expect(body.detail?.issues?.[0]?.path).toBe(c.path);
        expectInputSchemaGuidance(body, 'nta_search_jimu_unei');
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(existsSync(dbPath)).toBe(false);
      });
    }
  });

  describe('nta_search_kaisei_tsutatsu の応答', () => {
    const cases: Array<{ label: string; args: Record<string, unknown>; path?: string }> = [
      { label: '{}（keyword が無い）', args: {} },
      { label: '{ keyword: 1 }（型の違反）', args: { keyword: 1 }, path: 'keyword' },
      {
        label: '{ keyword: "x", foo: 1 }（inputSchema に無い引数）',
        args: { keyword: 'x', foo: 1 },
        path: 'foo',
      },
    ];

    for (const c of cases) {
      it(`SPEC-NTA-COMMON-ERRORS-003 SPEC-NTA-COMMON-ERRORS-004 SPEC-NTA-COMMON-ERRORS-007 nta_search_kaisei_tsutatsu の応答: ${c.label} は INVALID_ARGUMENT と案内を返す`, async () => {
        const body = await call('nta_search_kaisei_tsutatsu', c.args);
        expect(body.code).toBe('INVALID_ARGUMENT');
        expect(body.tool).toBe('nta_search_kaisei_tsutatsu');
        if (c.path !== undefined) expect(body.detail?.issues?.[0]?.path).toBe(c.path);
        expectInputSchemaGuidance(body, 'nta_search_kaisei_tsutatsu');
      });
    }
  });
});
