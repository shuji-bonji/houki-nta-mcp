/**
 * 差分 specs/changes/20261001-t1-argument-guards/（PR #117、docId の形は 20261002-t1-docid-forms・PR #121 で訂正）の受入テスト。
 *
 * - inputSchema の検査（common_errors 003・007・010〜013、検索 6 ツールの limit）
 * - 空白だけの必須の文字列（common_errors 014、各ツールの ID）
 * - 識別子の形（common_errors 015、取得ツールの ID）
 * - taxonomy を列挙で検査しないこと（search_rules 018）
 *
 * 引数の検査は tools/call の受け口（toolHandlers）を通して確かめる。「DB を引かない」は、
 * HOUKI_NTA_DB_PATH をまだ無いファイルに向け、呼び出しの後もファイルができていないことで確かめる。
 * 「国税庁サイトを引かない」はグローバルの fetch を呼ばれたら失敗する関数に差し替えて確かめる。
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as abbreviations from '@shuji-bonji/houki-abbreviations';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withTaxAnswerIndex } from '../../tests/support/tax-answer-index.js';
import { initSchema } from '../db/schema.js';
import { tools } from './definitions.js';
import { getQa, getTaxAnswer, toolHandlers } from './handlers.js';
import { checkArgs } from './tool-args.js';

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

const PREFIX = '引数が tools/list の inputSchema に合いません: ';
const FIXTURES = join(import.meta.dirname, '../../tests/fixtures');

interface Issue {
  path: string;
  message: string;
}

interface Body {
  error?: string;
  code?: string;
  tool?: string;
  hint?: string;
  next_actions?: Array<{ action: string; reason?: string; example?: unknown }>;
  detail?: { issues?: Issue[] };
  results?: unknown[];
  available_taxonomies?: string[];
  document?: { docId?: string };
}

async function call(name: string, args: unknown): Promise<Body> {
  const handler = toolHandlers[name];
  expect(handler, `toolHandlers に ${name} が無い`).toBeDefined();
  return (await handler(args)) as Body;
}

function forbiddenFetch() {
  return vi.fn(async () => {
    throw new Error('国税庁サイトを取りに行ってはいけない');
  });
}

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
    (value as { mockClear?: () => void }).mockClear?.();
  }
}

/** DB を作らない・国税庁サイトを引かないことを確かめるための環境 */
function useUntouchedEnv() {
  const env = {
    dir: '',
    dbPath: '',
    fetchSpy: forbiddenFetch(),
  };
  let saved: string | undefined;
  beforeEach(() => {
    env.dir = mkdtempSync(join(tmpdir(), 'houki-nta-t1-'));
    env.dbPath = join(env.dir, 'never-created.db');
    saved = process.env.HOUKI_NTA_DB_PATH;
    process.env.HOUKI_NTA_DB_PATH = env.dbPath;
    env.fetchSpy = forbiddenFetch();
    vi.stubGlobal('fetch', env.fetchSpy);
    clearAbbreviationCalls();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (saved === undefined) delete process.env.HOUKI_NTA_DB_PATH;
    else process.env.HOUKI_NTA_DB_PATH = saved;
    rmSync(env.dir, { recursive: true, force: true });
  });
  return env;
}

function expectUntouched(env: { dbPath: string; fetchSpy: ReturnType<typeof forbiddenFetch> }) {
  expect(existsSync(env.dbPath), 'DB を開いた').toBe(false);
  expect(env.fetchSpy, '国税庁サイトを引いた').not.toHaveBeenCalled();
}

type SeedDoc = [docType: string, docId: string, taxonomy: string, title: string, body: string];

function seedDocuments(dbPath: string, docs: SeedDoc[]): void {
  const db = new Database(dbPath);
  initSchema(db);
  const stmt = db.prepare(
    `INSERT INTO document(doc_type, doc_id, taxonomy, title, source_url, fetched_at, full_text, attached_pdfs_json, content_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const [docType, docId, taxonomy, title, body] of docs) {
    stmt.run(
      docType,
      docId,
      taxonomy,
      title,
      `https://www.nta.go.jp/${docType}/${docId}/index.htm`,
      new Date().toISOString(),
      body,
      '[]',
      null
    );
  }
  db.close();
}

/** DB に文書を入れた環境（取得・検索が DB を引くことを確かめる） */
function useSeededEnv(docs: () => SeedDoc[]) {
  const env = { dir: '', dbPath: '' };
  let saved: string | undefined;
  beforeEach(() => {
    env.dir = mkdtempSync(join(tmpdir(), 'houki-nta-t1-seed-'));
    env.dbPath = join(env.dir, 'cache.db');
    seedDocuments(env.dbPath, docs());
    saved = process.env.HOUKI_NTA_DB_PATH;
    process.env.HOUKI_NTA_DB_PATH = env.dbPath;
    vi.stubGlobal('fetch', forbiddenFetch());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (saved === undefined) delete process.env.HOUKI_NTA_DB_PATH;
    else process.env.HOUKI_NTA_DB_PATH = saved;
    rmSync(env.dir, { recursive: true, force: true });
  });
  return env;
}

/** 空白だけの必須の文字列で返すエラー（SPEC-NTA-COMMON-ERRORS-014 の形） */
function expectBlank(body: Body, tool: string, path: string): void {
  expect(body.code).toBe('INVALID_ARGUMENT');
  expect(body.tool).toBe(tool);
  expect(body.error).toBe(`${path} が空です`);
  expect(body.detail?.issues).toEqual([{ path, message: '空白だけは指定できません' }]);
  expect(typeof body.hint).toBe('string');
  expect(body.hint?.length).toBeGreaterThan(0);
}

/** 空文字で返すエラー（SPEC-NTA-COMMON-ERRORS-013 の形） */
function expectEmpty(body: Body, tool: string, path: string): void {
  expect(body.code).toBe('INVALID_ARGUMENT');
  expect(body.tool).toBe(tool);
  expect(body.detail?.issues).toEqual([{ path, message: '空文字は指定できません' }]);
  expect(body.error).toBe(`${PREFIX}${path}: 空文字は指定できません`);
}

/** 識別子の形が合わないときのエラー（SPEC-NTA-COMMON-ERRORS-015 の形） */
function expectBadForm(body: Body, tool: string, path: string, value: string, message: string) {
  expect(body.code).toBe('INVALID_ARGUMENT');
  expect(body.tool).toBe(tool);
  expect(body.error).toBe(`${path} の形が受け付ける形ではありません: ${value}`);
  expect(body.detail?.issues).toEqual([{ path, message }]);
  expect(typeof body.hint).toBe('string');
  expect(body.hint?.length).toBeGreaterThan(0);
}

/** tools/list に出す inputSchema の properties */
function propsOf(name: string): Record<string, Record<string, unknown>> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`tools/list に ${name} が無い`);
  return (tool.inputSchema.properties ?? {}) as Record<string, Record<string, unknown>>;
}

const SEARCH_TOOLS = [
  'nta_search_tsutatsu',
  'nta_search_qa',
  'nta_search_tax_answer',
  'nta_search_kaisei_tsutatsu',
  'nta_search_jimu_unei',
  'nta_search_bunshokaitou',
] as const;

/* -------------------------------------------------------------------------- */
/* common_errors                                                               */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-COMMON-ERRORS-003 inputSchema に合わない引数はエラー INVALID_ARGUMENT', () => {
  const env = useUntouchedEnv();

  it('SPEC-NTA-COMMON-ERRORS-003 resolve_abbreviation に abbr: 123 を渡すと INVALID_ARGUMENT、tool は resolve_abbreviation、path は abbr', async () => {
    const body = await call('resolve_abbreviation', { abbr: 123 });
    expect(body.code).toBe('INVALID_ARGUMENT');
    expect(body.tool).toBe('resolve_abbreviation');
    expect(body.detail?.issues?.[0]?.path).toBe('abbr');
    expect(abbreviationCallCount()).toBe(0);
  });

  it('SPEC-NTA-COMMON-ERRORS-003 nta_search_tsutatsu の {}・type: "bogus"・limit: 100 はどれも INVALID_ARGUMENT で、path は空文字にならない', async () => {
    for (const args of [
      {},
      { keyword: '軽減税率', type: 'bogus' },
      { keyword: '軽減税率', limit: 100 },
    ]) {
      const body = await call('nta_search_tsutatsu', args);
      expect(body.code, JSON.stringify(args)).toBe('INVALID_ARGUMENT');
      for (const issue of body.detail?.issues ?? []) expect(issue.path).not.toBe('');
    }
    expectUntouched(env);
  });
});

describe('SPEC-NTA-COMMON-ERRORS-007 inputSchema の検査で返す INVALID_ARGUMENT には、inputSchema を確かめる案内を付ける', () => {
  useUntouchedEnv();

  it('SPEC-NTA-COMMON-ERRORS-007 nta_search_jimu_unei に { keyword: "x", foo: 1 } を渡すと、error・hint（範囲・形式を含む）・next_actions が決まった形', async () => {
    const body = await call('nta_search_jimu_unei', { keyword: 'x', foo: 1 });
    expect(body.error).toBe(`${PREFIX}foo: inputSchema に無い引数です`);
    expect(body.hint).toBe(
      'tools/list の nta_search_jimu_unei の inputSchema を確認してください (型・必須・enum・範囲・形式・未知の引数)'
    );
    expect(body.next_actions).toEqual([
      { action: 'list_tools', reason: 'inputSchema で引数の型と必須項目を確認できます' },
    ]);
  });

  it('SPEC-NTA-COMMON-ERRORS-007 nta_get_jimu_unei に {} を渡すと、detail.issues は [{ path: "docId", message: "必須の引数です" }]', async () => {
    const body = await call('nta_get_jimu_unei', {});
    expect(body.detail?.issues).toEqual([{ path: 'docId', message: '必須の引数です' }]);
    expect(body.error).toBe(`${PREFIX}docId: 必須の引数です`);
  });

  it('SPEC-NTA-COMMON-ERRORS-007 14 ツールとも hint はツール名入りで「型・必須・enum・範囲・形式・未知の引数」', async () => {
    expect(tools.length).toBe(14);
    for (const tool of tools) {
      const body = await call(tool.name, { zz: 1 });
      expect(body.hint, tool.name).toBe(
        `tools/list の ${tool.name} の inputSchema を確認してください (型・必須・enum・範囲・形式・未知の引数)`
      );
    }
  });
});

describe('SPEC-NTA-COMMON-ERRORS-010 detail.issues は違反 1 件ごとに要素を分け、path には引数名を入れる', () => {
  useUntouchedEnv();

  it('SPEC-NTA-COMMON-ERRORS-010 nta_search_tsutatsu に { keyword: 1, limit: "x" } を渡すと 2 要素', async () => {
    const body = await call('nta_search_tsutatsu', { keyword: 1, limit: 'x' });
    expect(body.detail?.issues).toEqual([
      { path: 'keyword', message: '文字列で指定してください' },
      { path: 'limit', message: '整数で指定してください' },
    ]);
    expect(body.error).toBe(
      `${PREFIX}keyword: 文字列で指定してください; limit: 整数で指定してください`
    );
  });

  it('SPEC-NTA-COMMON-ERRORS-010 nta_get_qa に { topic: "shohi" } を渡すと category と id の 2 要素', async () => {
    const body = await call('nta_get_qa', { topic: 'shohi' });
    expect(body.detail?.issues).toEqual([
      { path: 'category', message: '必須の引数です' },
      { path: 'id', message: '必須の引数です' },
    ]);
  });

  it('SPEC-NTA-COMMON-ERRORS-010 型の違反と inputSchema に無い引数が同時なら両方（limit と zz）', async () => {
    const body = await call('nta_search_tsutatsu', { keyword: 'a', limit: 'x', zz: 1 });
    expect(body.detail?.issues?.map((i) => i.path)).toEqual(['limit', 'zz']);
  });

  it('SPEC-NTA-COMMON-ERRORS-010 inputSchema に無い引数が 2 つなら 1 つずつ別の要素（zz と yy）', async () => {
    const body = await call('nta_search_tsutatsu', { keyword: 'a', zz: 1, yy: 2 });
    expect(body.detail?.issues).toEqual([
      { path: 'zz', message: 'inputSchema に無い引数です' },
      { path: 'yy', message: 'inputSchema に無い引数です' },
    ]);
  });
});

describe('SPEC-NTA-COMMON-ERRORS-011 detail.issues[].message は違反の種類ごとに決まった日本語の 1 文', () => {
  useUntouchedEnv();

  const cases: Array<[tool: string, args: Record<string, unknown>, path: string, message: string]> =
    [
      ['nta_search_qa', { keyword: '軽減税率', limit: 2.5 }, 'limit', '整数で指定してください'],
      ['nta_search_qa', { keyword: '軽減税率', limit: 0 }, 'limit', '1 以上で指定してください'],
      ['nta_search_qa', { keyword: '軽減税率', limit: 51 }, 'limit', '50 以下で指定してください'],
      [
        'nta_get_qa',
        { topic: 'bogus', category: '01', id: '01' },
        'topic',
        'shotoku・gensen・joto・sozoku・hyoka・hojin・shohi・inshi・hotei のどれかで指定してください',
      ],
      ['nta_search_tax_answer', { keyword: '' }, 'keyword', '空文字は指定できません'],
      [
        'nta_search_tax_answer',
        { keyword: '医療費控除', hasPdf: 'yes' },
        'hasPdf',
        'true か false で指定してください',
      ],
      ['nta_get_tsutatsu', { name: 1 }, 'name', '文字列で指定してください'],
      ['nta_get_tsutatsu', {}, 'name', '必須の引数です'],
      ['nta_search_qa', { keyword: 'x', zz: 1 }, 'zz', 'inputSchema に無い引数です'],
    ];

  for (const [tool, args, path, message] of cases) {
    it(`SPEC-NTA-COMMON-ERRORS-011 ${tool} に ${JSON.stringify(args)} を渡すと message は「${message}」`, async () => {
      const body = await call(tool, args);
      expect(body.code).toBe('INVALID_ARGUMENT');
      expect(body.detail?.issues).toEqual([{ path, message }]);
    });
  }

  it('SPEC-NTA-COMMON-ERRORS-011 検査の部品の英文（data/limit must be number など）は返さない', async () => {
    const body = await call('nta_search_qa', { keyword: 1, limit: 'x', hasPdf: 1, zz: 1 });
    for (const issue of body.detail?.issues ?? []) {
      expect(issue.message).not.toMatch(/must|data\//);
    }
  });

  it('SPEC-NTA-COMMON-ERRORS-011 表の残りの行（number・array・object）も決まった文', () => {
    const schema = {
      type: 'object',
      properties: {
        n: { type: 'number' },
        a: { type: 'array' },
        o: { type: 'object' },
      },
      additionalProperties: false,
    } as const;
    expect(checkArgs(schema, { n: 'x', a: 'x', o: 'x' })).toEqual([
      { path: 'n', message: '数値で指定してください' },
      { path: 'a', message: '配列で指定してください' },
      { path: 'o', message: 'オブジェクトで指定してください' },
    ]);
  });
});

describe('SPEC-NTA-COMMON-ERRORS-012 数値の引数は inputSchema に整数と範囲を書き、範囲の外は INVALID_ARGUMENT にして丸めない', () => {
  it('SPEC-NTA-COMMON-ERRORS-012 検索 6 ツールの limit は type: "integer"・minimum: 1・maximum: 50・default: 10', () => {
    for (const name of SEARCH_TOOLS) {
      const limit = propsOf(name).limit;
      expect(limit, name).toMatchObject({ type: 'integer', minimum: 1, maximum: 50, default: 10 });
    }
  });

  it('SPEC-NTA-COMMON-ERRORS-012 数値の引数は検索 6 ツールの limit だけ', () => {
    const numeric: string[] = [];
    for (const tool of tools) {
      const props = (tool.inputSchema.properties ?? {}) as Record<string, { type?: string }>;
      for (const [key, prop] of Object.entries(props)) {
        if (prop.type === 'number' || prop.type === 'integer') numeric.push(`${tool.name}.${key}`);
      }
    }
    expect(numeric.sort()).toEqual(SEARCH_TOOLS.map((t) => `${t}.limit`).sort());
  });
});

describe('SPEC-NTA-COMMON-ERRORS-013 必須の文字列の引数は inputSchema に minLength: 1 を書き、空文字は INVALID_ARGUMENT', () => {
  const env = useUntouchedEnv();

  const requiredStrings: Record<string, string[]> = {
    nta_search_tsutatsu: ['keyword'],
    nta_search_qa: ['keyword'],
    nta_search_tax_answer: ['keyword'],
    nta_search_kaisei_tsutatsu: ['keyword'],
    nta_search_jimu_unei: ['keyword'],
    nta_search_bunshokaitou: ['keyword'],
    resolve_abbreviation: ['abbr'],
    nta_get_tsutatsu: ['name'],
    nta_get_kaisei_tsutatsu: ['docId'],
    nta_get_jimu_unei: ['docId'],
    nta_get_bunshokaitou: ['docId'],
    nta_inspect_pdf_meta: ['docId'],
    nta_get_qa: ['category', 'id'],
    nta_get_tax_answer: ['no'],
  };

  it('SPEC-NTA-COMMON-ERRORS-013 必須の文字列には minLength: 1、enum と任意の文字列には書かない', () => {
    for (const tool of tools) {
      const props = (tool.inputSchema.properties ?? {}) as Record<
        string,
        { type?: string; enum?: unknown[]; minLength?: number }
      >;
      const expected = requiredStrings[tool.name] ?? [];
      for (const [key, prop] of Object.entries(props)) {
        if (expected.includes(key)) expect(prop.minLength, `${tool.name}.${key}`).toBe(1);
        else expect(prop.minLength, `${tool.name}.${key}`).toBeUndefined();
      }
    }
  });

  it('SPEC-NTA-COMMON-ERRORS-013 nta_search_qa に keyword: "" を渡すと INVALID_ARGUMENT で、DB は引かない', async () => {
    const body = await call('nta_search_qa', { keyword: '' });
    expectEmpty(body, 'nta_search_qa', 'keyword');
    expectUntouched(env);
  });

  it('SPEC-NTA-COMMON-ERRORS-013 resolve_abbreviation に abbr: "" を渡すと INVALID_ARGUMENT（resolved: null ではない）', async () => {
    const body = await call('resolve_abbreviation', { abbr: '' });
    expectEmpty(body, 'resolve_abbreviation', 'abbr');
    expect(abbreviationCallCount()).toBe(0);
  });

  it('SPEC-NTA-COMMON-ERRORS-013 nta_get_tax_answer に no: "" を渡すと INVALID_ARGUMENT', async () => {
    const body = await call('nta_get_tax_answer', { no: '' });
    expectEmpty(body, 'nta_get_tax_answer', 'no');
    expectUntouched(env);
  });
});

describe('SPEC-NTA-COMMON-ERRORS-014 空白だけの必須の文字列は、ツールの処理で同じ形の INVALID_ARGUMENT にする', () => {
  const env = useUntouchedEnv();

  it('SPEC-NTA-COMMON-ERRORS-014 nta_search_qa に keyword: "   " を渡すと「keyword が空です」で、DB は引かない', async () => {
    const body = await call('nta_search_qa', { keyword: '   ' });
    expectBlank(body, 'nta_search_qa', 'keyword');
    expectUntouched(env);
  });

  it('SPEC-NTA-COMMON-ERRORS-014 nta_get_bunshokaitou に docId: "\\t" を渡しても同じ形（path: "docId"）', async () => {
    const body = await call('nta_get_bunshokaitou', { docId: '\t' });
    expectBlank(body, 'nta_get_bunshokaitou', 'docId');
    expectUntouched(env);
  });
});

describe('SPEC-NTA-COMMON-ERRORS-015 識別子の形は各ツールの処理で確かめ、合わなければ同じ形の INVALID_ARGUMENT と正しい形の hint を返す', () => {
  const env = useUntouchedEnv();

  it('SPEC-NTA-COMMON-ERRORS-015 nta_get_bunshokaitou に docId: "250416" を渡すと INVALID_ARGUMENT で、DB は引かない', async () => {
    const body = await call('nta_get_bunshokaitou', { docId: '250416' });
    expect(body.code).toBe('INVALID_ARGUMENT');
    expect(body.tool).toBe('nta_get_bunshokaitou');
    expect(body.detail?.issues?.[0]?.path).toBe('docId');
    expect(body.error).toBe('docId の形が受け付ける形ではありません: 250416');
    expectUntouched(env);
  });

  it('SPEC-NTA-COMMON-ERRORS-015 nta_get_qa に category: "1a" を渡すと path は category で、国税庁サイトも DB も引かない', async () => {
    const body = await call('nta_get_qa', { topic: 'shohi', category: '1a', id: '01' });
    expect(body.code).toBe('INVALID_ARGUMENT');
    expect(body.detail?.issues?.[0]?.path).toBe('category');
    expectUntouched(env);
  });
});

/* -------------------------------------------------------------------------- */
/* search_rules                                                                */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-SEARCH-RULES-018 taxonomy は列挙で検査せず、DB に無い値のときは available_taxonomies で正しい値を返す', () => {
  useSeededEnv(() => [['kaisei', '0026003-067', 'shohi', '改正通達の題名', '改正通達の本文']]);

  it('SPEC-NTA-SEARCH-RULES-018 3 ツールの taxonomy に enum は無く、description に available_taxonomies の語が入る', () => {
    for (const name of [
      'nta_search_kaisei_tsutatsu',
      'nta_search_jimu_unei',
      'nta_search_bunshokaitou',
    ]) {
      const taxonomy = propsOf(name).taxonomy;
      expect(taxonomy.enum, name).toBeUndefined();
      expect(String(taxonomy.description), name).toContain('available_taxonomies');
    }
  });

  it('SPEC-NTA-SEARCH-RULES-018 nta_search_kaisei_tsutatsu に taxonomy: "bogus" を渡すと、INVALID_ARGUMENT ではなく results: [] と available_taxonomies', async () => {
    const body = await call('nta_search_kaisei_tsutatsu', { keyword: '改正', taxonomy: 'bogus' });
    expect(body.code).toBeUndefined();
    expect(body.results).toEqual([]);
    expect(body.available_taxonomies).toEqual(['shohi']);
  });
});

/* -------------------------------------------------------------------------- */
/* 検索 6 ツール: limit と keyword                                              */
/* -------------------------------------------------------------------------- */

const LIMIT_IDS: Record<(typeof SEARCH_TOOLS)[number], string> = {
  nta_search_tsutatsu: 'SPEC-NTA-SEARCH-TSUTATSU-011',
  nta_search_qa: 'SPEC-NTA-SEARCH-QA-008',
  nta_search_tax_answer: 'SPEC-NTA-SEARCH-TAX-ANSWER-004',
  nta_search_kaisei_tsutatsu: 'SPEC-NTA-SEARCH-KAISEI-TSUTATSU-005',
  nta_search_jimu_unei: 'SPEC-NTA-SEARCH-JIMU-UNEI-007',
  nta_search_bunshokaitou: 'SPEC-NTA-SEARCH-BUNSHOKAITOU-007',
};

const KEYWORD_IDS: Record<(typeof SEARCH_TOOLS)[number], string> = {
  nta_search_tsutatsu: 'SPEC-NTA-SEARCH-TSUTATSU-002',
  nta_search_qa: 'SPEC-NTA-SEARCH-QA-009',
  nta_search_tax_answer: 'SPEC-NTA-SEARCH-TAX-ANSWER-005',
  nta_search_kaisei_tsutatsu: 'SPEC-NTA-SEARCH-KAISEI-TSUTATSU-006',
  nta_search_jimu_unei: 'SPEC-NTA-SEARCH-JIMU-UNEI-008',
  nta_search_bunshokaitou: 'SPEC-NTA-SEARCH-BUNSHOKAITOU-008',
};

const DOC_TYPE_OF: Partial<Record<(typeof SEARCH_TOOLS)[number], string>> = {
  nta_search_qa: 'qa-jirei',
  nta_search_tax_answer: 'tax-answer',
  nta_search_kaisei_tsutatsu: 'kaisei',
  nta_search_jimu_unei: 'jimu-unei',
  nta_search_bunshokaitou: 'bunshokaitou',
};

describe('SPEC-NTA-SEARCH-TSUTATSU-011 SPEC-NTA-SEARCH-QA-008 SPEC-NTA-SEARCH-TAX-ANSWER-004 SPEC-NTA-SEARCH-KAISEI-TSUTATSU-005 SPEC-NTA-SEARCH-JIMU-UNEI-007 SPEC-NTA-SEARCH-BUNSHOKAITOU-007 SPEC-NTA-SEARCH-TSUTATSU-002 SPEC-NTA-SEARCH-QA-009 SPEC-NTA-SEARCH-TAX-ANSWER-005 SPEC-NTA-SEARCH-KAISEI-TSUTATSU-006 SPEC-NTA-SEARCH-JIMU-UNEI-008 SPEC-NTA-SEARCH-BUNSHOKAITOU-008 検索 6 ツールの limit と keyword', () => {
  for (const tool of SEARCH_TOOLS) {
    const id = LIMIT_IDS[tool];
    describe(`${id} limit は 1 以上 50 以下の整数で、範囲の外は INVALID_ARGUMENT にして丸めない`, () => {
      const env = useUntouchedEnv();
      const cases: Array<[limit: unknown, message: string]> = [
        [0, '1 以上で指定してください'],
        [-1, '1 以上で指定してください'],
        [100, '50 以下で指定してください'],
        [51, '50 以下で指定してください'],
        [2.5, '整数で指定してください'],
        ['10', '整数で指定してください'],
      ];
      for (const [limit, message] of cases) {
        it(`${id} ${tool} の limit: ${JSON.stringify(limit)} は「${message}」で、DB を引かない`, async () => {
          const body = await call(tool, { keyword: '軽減税率', limit });
          expect(body.code).toBe('INVALID_ARGUMENT');
          expect(body.tool).toBe(tool);
          expect(body.detail?.issues).toEqual([{ path: 'limit', message }]);
          expectUntouched(env);
        });
      }
    });

    const docType = DOC_TYPE_OF[tool];
    if (docType) {
      describe(`${id} limit: 50 は検査を通り、最大 50 件を返す（${tool}）`, () => {
        useSeededEnv(() =>
          Array.from({ length: 55 }, (_, i): SeedDoc => {
            const n = String(i).padStart(2, '0');
            const docId =
              docType === 'tax-answer'
                ? `61${n}`
                : docType === 'qa-jirei'
                  ? `shohi/01/${n}`
                  : docType === 'kaisei'
                    ? `2401${n}`
                    : `shohi/2401${n}`;
            return [docType, docId, 'shohi', `題名${n}`, `限度額計算テストの本文${n}`];
          })
        );
        it(`${id} ${tool} の limit: 50 は 50 件、省くと 10 件`, async () => {
          const fifty = await call(tool, { keyword: '限度額計算', limit: 50 });
          expect(fifty.code).toBeUndefined();
          expect(fifty.results).toHaveLength(50);
          const dflt = await call(tool, { keyword: '限度額計算' });
          expect(dflt.results).toHaveLength(10);
        });
      });
    } else {
      describe(`${id} limit: 50 は検査を通る（${tool}）`, () => {
        useSeededEnv(() => []);
        it(`${id} ${tool} の limit: 50 は INVALID_ARGUMENT にならない`, async () => {
          const body = await call(tool, { keyword: '軽減税率', limit: 50 });
          expect(body.code).not.toBe('INVALID_ARGUMENT');
        });
      });
    }

    const kid = KEYWORD_IDS[tool];
    describe(`${kid} keyword が空文字・空白だけのときは DB を引かずに INVALID_ARGUMENT を返す（${tool}）`, () => {
      const env = useUntouchedEnv();
      it(`${kid} ${tool} の keyword: "" は「空文字は指定できません」`, async () => {
        expectEmpty(await call(tool, { keyword: '' }), tool, 'keyword');
        expectUntouched(env);
      });
      for (const blank of ['　', ' \n', '\t']) {
        it(`${kid} ${tool} の keyword: ${JSON.stringify(blank)} は「keyword が空です」`, async () => {
          expectBlank(await call(tool, { keyword: blank }), tool, 'keyword');
          expectUntouched(env);
        });
      }
    });
  }
});

describe('SPEC-NTA-SEARCH-TSUTATSU-001 inputSchema に合わない引数では検索しない', () => {
  const env = useUntouchedEnv();

  it('SPEC-NTA-SEARCH-TSUTATSU-001 { keyword: "軽減税率", domain: "tax" } は path が domain、{} は keyword が必須', async () => {
    const a = await call('nta_search_tsutatsu', { keyword: '軽減税率', domain: 'tax' });
    expect(a.code).toBe('INVALID_ARGUMENT');
    expect(a.tool).toBe('nta_search_tsutatsu');
    expect(a.detail?.issues?.[0]?.path).toBe('domain');
    expect(a.next_actions?.[0]?.action).toBe('list_tools');
    const b = await call('nta_search_tsutatsu', {});
    expect(b.detail?.issues).toEqual([{ path: 'keyword', message: '必須の引数です' }]);
    expectUntouched(env);
  });
});

describe('SPEC-NTA-SEARCH-TSUTATSU-002 keyword が空なら検索しない', () => {
  useUntouchedEnv();

  it('SPEC-NTA-SEARCH-TSUTATSU-002 空白だけのときは next_actions に list_tools', async () => {
    const body = await call('nta_search_tsutatsu', { keyword: '   ' });
    expectBlank(body, 'nta_search_tsutatsu', 'keyword');
    expect(body.next_actions?.map((a) => a.action)).toEqual(['list_tools']);
  });
});

/* -------------------------------------------------------------------------- */
/* 取得ツール: 空文字・空白だけ                                                  */
/* -------------------------------------------------------------------------- */

const BLANK_CASES: Array<[id: string, tool: string, path: string, base: Record<string, unknown>]> =
  [
    ['SPEC-NTA-GET-KAISEI-TSUTATSU-009', 'nta_get_kaisei_tsutatsu', 'docId', {}],
    ['SPEC-NTA-GET-JIMU-UNEI-009', 'nta_get_jimu_unei', 'docId', {}],
    ['SPEC-NTA-GET-BUNSHOKAITOU-009', 'nta_get_bunshokaitou', 'docId', {}],
    ['SPEC-NTA-GET-TSUTATSU-017', 'nta_get_tsutatsu', 'name', { clause: '5-1-9' }],
    ['SPEC-NTA-INSPECT-PDF-META-019', 'nta_inspect_pdf_meta', 'docId', { docType: 'kaisei' }],
    ['SPEC-NTA-RESOLVE-ABBREVIATION-007', 'resolve_abbreviation', 'abbr', {}],
    ['SPEC-NTA-GET-QA-002', 'nta_get_qa', 'category', { topic: 'shohi', id: '19' }],
    ['SPEC-NTA-GET-QA-002', 'nta_get_qa', 'id', { topic: 'shohi', category: '02' }],
    ['SPEC-NTA-GET-TAX-ANSWER-001', 'nta_get_tax_answer', 'no', {}],
  ];

describe('SPEC-NTA-GET-KAISEI-TSUTATSU-009 SPEC-NTA-GET-JIMU-UNEI-009 SPEC-NTA-GET-BUNSHOKAITOU-009 SPEC-NTA-GET-TSUTATSU-017 SPEC-NTA-INSPECT-PDF-META-019 SPEC-NTA-RESOLVE-ABBREVIATION-007 SPEC-NTA-GET-QA-002 SPEC-NTA-GET-TAX-ANSWER-001 取得ツールと resolve_abbreviation の空文字・空白だけの必須の文字列', () => {
  for (const [id, tool, path, base] of BLANK_CASES) {
    describe(`${id} ${path} が空文字・空白だけのときは引かずに INVALID_ARGUMENT を返す（${tool}）`, () => {
      const env = useUntouchedEnv();
      it(`${id} ${tool} の ${path}: "" は「空文字は指定できません」`, async () => {
        expectEmpty(await call(tool, { ...base, [path]: '' }), tool, path);
        expectUntouched(env);
        expect(abbreviationCallCount()).toBe(0);
      });
      for (const blank of ['　', ' \n', '  ']) {
        it(`${id} ${tool} の ${path}: ${JSON.stringify(blank)} は「${path} が空です」で、DB・国税庁サイト・略称辞書を引かない`, async () => {
          expectBlank(await call(tool, { ...base, [path]: blank }), tool, path);
          expectUntouched(env);
          expect(abbreviationCallCount()).toBe(0);
        });
      }
    });
  }
});

/* -------------------------------------------------------------------------- */
/* 取得ツール: 識別子の形                                                       */
/* -------------------------------------------------------------------------- */

const FORM_CASES: Array<{
  id: string;
  tool: string;
  docType: string;
  message: string;
  valid: string[];
  invalid: string[];
}> = [
  {
    id: 'SPEC-NTA-GET-KAISEI-TSUTATSU-010',
    tool: 'nta_get_kaisei_tsutatsu',
    docType: 'kaisei',
    message: '英小文字・数字・- だけで指定してください（例: 0026003-067、240401）',
    valid: ['0026003-067', '240401', '0014720-84', 'tougou'],
    invalid: ['0026003/067', '0026003_067', 'ABC-1', '課消2-11', '0026003-067/index.htm'],
  },
  {
    id: 'SPEC-NTA-GET-JIMU-UNEI-010',
    tool: 'nta_get_jimu_unei',
    docType: 'jimu-unei',
    message:
      '税目/…/フォルダー名 の形で、英小文字・数字・-・_ だけで指定してください（例: shotoku/shinkoku/170331）',
    valid: ['shotoku/shinkoku/170331', 'sozoku/170111_1', 'hojin/000703-3', 'sonota/1912'],
    invalid: [
      '170331',
      '/shotoku/170331',
      'shotoku/',
      'shotoku/shinkoku/170331/index.htm',
      'shotoku/申告/170331',
    ],
  },
  {
    id: 'SPEC-NTA-GET-BUNSHOKAITOU-010',
    tool: 'nta_get_bunshokaitou',
    docType: 'bunshokaitou',
    message:
      '税目/フォルダー名 か 局/税目/フォルダー名 の形で、英小文字・数字・-・_ だけで指定してください（例: shotoku/250416、tokyo/shotoku/260218）',
    valid: [
      'shotoku/250416',
      'tokyo/shotoku/260218',
      'fukuoka/hojin/20101001',
      'sapporo/hojin/02_01',
      'nagoya/hojin/nag_140625',
    ],
    invalid: [
      '250416',
      'a/b/c/250416',
      'shotoku/250416/index.htm',
      'Tokyo/shotoku/260218',
      'shotoku/文書/250416',
    ],
  },
];

describe('SPEC-NTA-GET-KAISEI-TSUTATSU-010 SPEC-NTA-GET-JIMU-UNEI-010 SPEC-NTA-GET-BUNSHOKAITOU-010 取得系 3 ツールの docId の形', () => {
  for (const c of FORM_CASES) {
    describe(`${c.id} docId が受け付ける形でないときは DB を引かずに INVALID_ARGUMENT を返す（${c.tool}）`, () => {
      const env = useUntouchedEnv();
      for (const value of c.invalid) {
        it(`${c.id} ${c.tool} の docId: "${value}" は INVALID_ARGUMENT で、DB を引かない`, async () => {
          const body = await call(c.tool, { docId: value });
          expectBadForm(body, c.tool, 'docId', value, c.message);
          expectUntouched(env);
        });
      }
    });

    describe(`${c.id} 受け付ける形の docId は検査を通り、DB を引く（${c.tool}）`, () => {
      useSeededEnv(() =>
        c.valid.map((docId): SeedDoc => [c.docType, docId, 'shohi', `題名 ${docId}`, '本文'])
      );
      for (const value of c.valid) {
        it(`${c.id} ${c.tool} の docId: "${value}" は DB の文書を返す`, async () => {
          const body = await call(c.tool, { docId: value, format: 'json' });
          expect(body.code).toBeUndefined();
          expect(body.document?.docId).toBe(value);
        });
      }
    });
  }
});

describe('SPEC-NTA-GET-QA-013 category と id は 1 桁か 2 桁の半角の数字で、それ以外は取りに行かずに INVALID_ARGUMENT を返す', () => {
  const env = useUntouchedEnv();
  const message = '1 桁か 2 桁の数字で指定してください';

  const bad: Array<[category: string, id: string, path: string, value: string]> = [
    ['1a', '19', 'category', '1a'],
    ['02', '190', 'id', '190'],
    ['0-2', '19', 'category', '0-2'],
    ['02', 'ab', 'id', 'ab'],
  ];
  for (const [category, id, path, value] of bad) {
    it(`SPEC-NTA-GET-QA-013 { category: "${category}", id: "${id}" } は path が ${path} で、DB も国税庁サイトも引かない`, async () => {
      const body = await call('nta_get_qa', { topic: 'shohi', category, id });
      expectBadForm(body, 'nta_get_qa', path, value, message);
      expectUntouched(env);
    });
  }

  it('SPEC-NTA-GET-QA-013 { category: "02", id: "19" } と { category: "2", id: "9" } は検査を通り、2 桁に揃えて取りに行く', async () => {
    const html = readFileSync(join(FIXTURES, 'www.nta.go.jp_law_shitsugi_shohi_02_19.htm'));
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      return new Response(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=Shift_JIS' },
      });
    }) as unknown as typeof fetch;
    const dbPath = join(env.dir, 'qa.db');
    const a = (await getQa(
      { topic: 'shohi', category: '02', id: '19', format: 'json' },
      { fetchImpl, dbPath }
    )) as Body;
    expect(a.code).toBeUndefined();
    const b = (await getQa(
      { topic: 'shohi', category: '2', id: '9', format: 'json' },
      { fetchImpl, dbPath }
    )) as Body;
    expect(b.code).toBeUndefined();
    expect(urls).toEqual([
      'https://www.nta.go.jp/law/shitsugi/shohi/02/19.htm',
      'https://www.nta.go.jp/law/shitsugi/shohi/02/09.htm',
    ]);
  });
});

describe('SPEC-NTA-GET-TAX-ANSWER-001 番号が空か数字でなければ取りに行かない', () => {
  const env = useUntouchedEnv();

  for (const value of ['abc', '61-01', '6a01']) {
    it(`SPEC-NTA-GET-TAX-ANSWER-001 no: "${value}" は「半角の数字 4 桁で指定してください」で、DB も国税庁サイトも引かない`, async () => {
      const body = await call('nta_get_tax_answer', { no: value });
      expectBadForm(body, 'nta_get_tax_answer', 'no', value, '半角の数字 4 桁で指定してください');
      expectUntouched(env);
    });
  }
});

describe('SPEC-NTA-GET-TAX-ANSWER-012 番号は 4 桁で、桁数が違えば取りに行かずに INVALID_ARGUMENT を返す', () => {
  const env = useUntouchedEnv();

  for (const value of ['61', '61011', '1']) {
    it(`SPEC-NTA-GET-TAX-ANSWER-012 no: "${value}" は INVALID_ARGUMENT で path は no、DB も国税庁サイトも引かない`, async () => {
      const body = await call('nta_get_tax_answer', { no: value });
      expectBadForm(body, 'nta_get_tax_answer', 'no', value, '半角の数字 4 桁で指定してください');
      expectUntouched(env);
    });
  }

  // 差分 20261003-source-paths（#128）で SPEC-NTA-GET-TAX-ANSWER-002（先頭の桁で断る）を外し、012 の例を "8001" に直した
  it('SPEC-NTA-GET-TAX-ANSWER-012 no: "8001" は 4 桁なので検査を通り、先頭の桁では断らずに国税庁の索引で URL を決めて取る（v0.23.0 では先頭の桁が未対応の INVALID_ARGUMENT）', async () => {
    const html = readFileSync(
      join(FIXTURES, 'www.nta.go.jp_taxes_shiraberu_taxanswer_shohi_6101.htm')
    );
    const fetchImpl = vi.fn(
      async () =>
        new Response(html, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
    );
    const body = (await getTaxAnswer(
      { no: '8001', format: 'json' },
      {
        fetchImpl: withTaxAnswerIndex(fetchImpl as unknown as typeof fetch),
        dbPath: join(env.dir, 'ta8.db'),
      }
    )) as Body;
    expect(body.code).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      'https://www.nta.go.jp/taxes/shiraberu/taxanswer/saigai/8001.htm'
    );
  });

  it('SPEC-NTA-GET-TAX-ANSWER-012 no: "6101" は検査を通り、国税庁サイトから取る', async () => {
    const html = readFileSync(
      join(FIXTURES, 'www.nta.go.jp_taxes_shiraberu_taxanswer_shohi_6101.htm')
    );
    const fetchImpl = vi.fn(
      async () =>
        new Response(html, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
    ) as unknown as typeof fetch;
    const body = (await getTaxAnswer(
      { no: '6101', format: 'json' },
      { fetchImpl: withTaxAnswerIndex(fetchImpl), dbPath: join(env.dir, 'ta.db') }
    )) as Body;
    expect(body.code).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
