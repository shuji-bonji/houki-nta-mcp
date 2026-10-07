/**
 * 差分 specs/changes/20261006-db-failure-paths/（PR #152、houki-nta-mcp #145）の受入テスト（CLI）。
 *
 * - cli_bulk_download: SPEC-NTA-CLI-BULK-DOWNLOAD-014（ADDED。索引を保存できなくても記事の取り込みを続ける）
 * - db_schema: SPEC-NTA-DB-SCHEMA-025（MODIFIED。--bulk-download-tax-answer の書き込みの失敗の扱い）
 *
 * 期待値は差分の spec.md の本文と「例:」から決めている。国税庁サイトには接続しない（fetch を差し替え、索引は No.6101 の
 * 1 件にする。記事の間の待ちを避けるため）。HOME は一時フォルダーにする（件数の記録のファイルを書くため）。
 * --bulk-download-everything のほかの 5 種別の取り込みの関数は差し替える。
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./services/bulk-downloader.js', () => ({
  bulkDownloadTsutatsu: vi.fn(async () => ({
    sections: 0,
    sectionsFetched: 0,
    clauses: 0,
    durationMs: 0,
  })),
}));
vi.mock('./services/kaisei-bulk-downloader.js', () => ({
  KAISEI_INDEX_URLS: {},
  bulkDownloadKaisei: vi.fn(),
}));
vi.mock('./services/jimu-unei-bulk-downloader.js', () => ({
  bulkDownloadJimuUnei: vi.fn(async () => ({ documentsFetched: 0 })),
}));
vi.mock('./services/bunshokaitou-bulk-downloader.js', () => ({
  bulkDownloadBunshokaitou: vi.fn(async () => ({ documentsFetched: 0 })),
}));
vi.mock('./services/qa-bulk-downloader.js', () => ({
  bulkDownloadQa: vi.fn(async () => ({ documentsFetched: 0 })),
}));

import { TAX_ANSWER_INDEX_URL, taxAnswerIndexHtml } from '../tests/support/tax-answer-index.js';
import { runCliIfRequested } from './cli.js';
import { initSchema } from './db/schema.js';
import { bulkDownloadQa } from './services/qa-bulk-downloader.js';

/* -------------------------------------------------------------------------- */
/* 共通の準備                                                                  */
/* -------------------------------------------------------------------------- */

const ARTICLE_URL = 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6101.htm';
const ARTICLE_HTML = readFileSync(
  resolve(
    import.meta.dirname,
    '../tests/fixtures/www.nta.go.jp_taxes_shiraberu_taxanswer_shohi_6101.htm'
  ),
  'utf8'
);
const PAGE_FETCHED_AT = '2026-10-01T00:00:00.000Z';

const ENV_KEYS = ['HOME', 'HOUKI_NTA_DB_PATH', 'XDG_CACHE_HOME'] as const;
let saved: Record<string, string | undefined>;
const stdout: string[] = [];
const stderr: string[] = [];
let dir: string;

beforeEach(() => {
  stdout.length = 0;
  stderr.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  dir = mkdtempSync(join(tmpdir(), 'houki-nta-db-failure-cli-'));
  const home = join(dir, 'home');
  mkdirSync(home);
  setEnv({ HOME: home, HOUKI_NTA_DB_PATH: undefined, XDG_CACHE_HOME: undefined });
  vi.stubGlobal('fetch', site);
  vi.mocked(bulkDownloadQa).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  process.exitCode = undefined;
  setEnv(saved);
  rmSync(dir, { recursive: true, force: true });
});

function setEnv(vars: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

/** 国税庁サイトの代わり。索引は No.6101 の 1 件、記事は No.6101 のページ */
const site = (async (input: string | URL | Request) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url === TAX_ANSWER_INDEX_URL) {
    return new Response(
      taxAnswerIndexHtml([{ no: '6101', folder: 'shohi', title: '消費税の基本的なしくみ' }]),
      { status: 200, headers: { 'Content-Type': 'text/html; charset=UTF-8' } }
    );
  }
  if (url === ARTICLE_URL) {
    return new Response(ARTICLE_HTML, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=UTF-8' },
    });
  }
  return new Response('not found', { status: 404 });
}) as typeof fetch;

const errLines = () =>
  stderr
    .join('')
    .split('\n')
    .filter((l) => l.length > 0);

async function run(argv: string[]): Promise<number | undefined> {
  await runCliIfRequested(argv);
  const code = process.exitCode;
  return typeof code === 'number' ? code : undefined;
}

/** 版 12 の DB を作る */
function makeDb(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  initSchema(db);
  db.close();
}

/**
 * 例の壊れた表の DB（SPEC-NTA-CLI-BULK-DOWNLOAD-014 の例）: tax_answer_index を url の列の無い表に作り替え、
 * tax_answer_index_page に fetched_at が 2026-10-01T00:00:00.000Z の行を入れる
 */
function makeBrokenIndexDb(path: string): void {
  makeDb(path);
  const db = new Database(path);
  db.exec(
    'DROP TABLE tax_answer_index; CREATE TABLE tax_answer_index (no TEXT PRIMARY KEY, taxonomy TEXT NOT NULL, title TEXT NOT NULL);'
  );
  db.prepare(
    `INSERT INTO tax_answer_index_page(url, fetched_at, last_modified, etag) VALUES (?, ?, NULL, NULL)`
  ).run(TAX_ANSWER_INDEX_URL, PAGE_FETCHED_AT);
  db.close();
}

function pageFetchedAt(path: string): string | undefined {
  const db = new Database(path, { readonly: true });
  try {
    return (
      db.prepare('SELECT fetched_at FROM tax_answer_index_page').get() as
        | { fetched_at: string }
        | undefined
    )?.fetched_at;
  } finally {
    db.close();
  }
}

function taxAnswerDocIds(path: string): string[] {
  const db = new Database(path, { readonly: true });
  try {
    return (
      db
        .prepare(`SELECT doc_id FROM document WHERE doc_type = 'tax-answer' ORDER BY doc_id`)
        .all() as Array<{ doc_id: string }>
    ).map((r) => r.doc_id);
  } finally {
    db.close();
  }
}

/** 標準出力の結果の JSON（--bulk-download-tax-answer は 1 つだけ出す） */
function resultJson(): Record<string, unknown> {
  return JSON.parse(stdout.join('')) as Record<string, unknown>;
}

const warnLine = (table: string, dbPath: string, message: string) =>
  `[WARN] タックスアンサーの索引を DB に保存できませんでした（表: ${table}、DB: ${dbPath}）: ${message}。記事の取り込みは続けます`;

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-CLI-BULK-DOWNLOAD-014                                             */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-CLI-BULK-DOWNLOAD-014 --bulk-download-tax-answer は、取った索引を DB に保存できなくても記事の取り込みを続け、標準エラー出力に [WARN] の行を出す', () => {
  it('SPEC-NTA-CLI-BULK-DOWNLOAD-014 例: 壊れた表の DB で --bulk-download-tax-answer --db-path=<DB> を実行すると、[WARN] の 1 行、document に 6101、tax_answer_index_page は前のまま、documentsFetched: 1 で終了コード 0', async () => {
    const path = join(dir, 'broken.db');
    makeBrokenIndexDb(path);
    const code = await run(['--bulk-download-tax-answer', `--db-path=${path}`]);
    expect(code).toBeUndefined();
    const warns = errLines().filter((l) => l.startsWith('[WARN]'));
    expect(warns).toEqual([
      warnLine('tax_answer_index', path, 'table tax_answer_index has no column named url'),
    ]);
    expect(taxAnswerDocIds(path)).toEqual(['6101']);
    expect(pageFetchedAt(path)).toBe(PAGE_FETCHED_AT);
    expect(resultJson().documentsFetched).toBe(1);
  }, 30_000);

  it('SPEC-NTA-CLI-BULK-DOWNLOAD-014 <DB の場所> は同じ実行の [bulk-download-tax-answer] DB: の行と同じ値（相対パスの --db-path はそのまま）', async () => {
    const path = join(dir, 'broken.db');
    makeBrokenIndexDb(path);
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      await run(['--bulk-download-tax-answer', '--db-path=broken.db']);
    } finally {
      process.chdir(cwd);
    }
    const dbLine = errLines().find((l) => l.startsWith('[bulk-download-tax-answer] DB: '));
    const shown = dbLine?.slice('[bulk-download-tax-answer] DB: '.length);
    expect(shown).toBe('broken.db');
    expect(errLines()).toContain(
      warnLine('tax_answer_index', 'broken.db', 'table tax_answer_index has no column named url')
    );
  }, 30_000);

  it('SPEC-NTA-CLI-BULK-DOWNLOAD-014 tax_answer_index_page の書き込みで失敗したときは、表の名前を tax_answer_index_page にして続ける', async () => {
    const path = join(dir, 'blocked.db');
    makeDb(path);
    const db = new Database(path);
    db.exec(
      `CREATE TRIGGER block_page BEFORE INSERT ON tax_answer_index_page BEGIN SELECT RAISE(ABORT, 'blocked'); END;`
    );
    db.close();
    const code = await run(['--bulk-download-tax-answer', `--db-path=${path}`]);
    expect(code).toBeUndefined();
    expect(errLines().filter((l) => l.startsWith('[WARN]'))).toEqual([
      warnLine('tax_answer_index_page', path, 'blocked'),
    ]);
    expect(taxAnswerDocIds(path)).toEqual(['6101']);
    // 途中で失敗したので、2 つのテーブルの行は前のまま（SPEC-NTA-DB-SCHEMA-025）
    const check = new Database(path, { readonly: true });
    const n = (check.prepare('SELECT COUNT(*) AS n FROM tax_answer_index').get() as { n: number })
      .n;
    check.close();
    expect(n).toBe(0);
  }, 30_000);

  it('SPEC-NTA-CLI-BULK-DOWNLOAD-014 標準出力の結果の JSON にはフィールドを足さない（保存できたときと同じキー）', async () => {
    const good = join(dir, 'good.db');
    makeDb(good);
    await run(['--bulk-download-tax-answer', `--db-path=${good}`]);
    const goodKeys = Object.keys(resultJson()).sort();
    stdout.length = 0;
    const broken = join(dir, 'broken.db');
    makeBrokenIndexDb(broken);
    await run(['--bulk-download-tax-answer', `--db-path=${broken}`, '--refresh']);
    expect(Object.keys(resultJson()).sort()).toEqual(goodKeys);
  }, 30_000);

  it('SPEC-NTA-CLI-BULK-DOWNLOAD-014 --tax-answer-taxonomy の絞り込みも、保存できたときと同じく続ける', async () => {
    const path = join(dir, 'broken.db');
    makeBrokenIndexDb(path);
    const code = await run([
      '--bulk-download-tax-answer',
      '--tax-answer-taxonomy=shohi',
      `--db-path=${path}`,
    ]);
    expect(code).toBeUndefined();
    expect(errLines().filter((l) => l.startsWith('[WARN]'))).toHaveLength(1);
    expect(taxAnswerDocIds(path)).toEqual(['6101']);
  }, 30_000);

  it('SPEC-NTA-CLI-BULK-DOWNLOAD-014 例: 同じ DB で --bulk-download-everything を実行すると、同じ [WARN] の行を出し、(5/6) タックスアンサー 失敗: の行は出さずに質疑応答事例へ進み、終了コード 0', async () => {
    const path = join(dir, 'broken.db');
    makeBrokenIndexDb(path);
    const code = await run(['--bulk-download-everything', `--db-path=${path}`]);
    expect(code).toBeUndefined();
    const lines = errLines();
    expect(lines).toContain(
      warnLine('tax_answer_index', path, 'table tax_answer_index has no column named url')
    );
    expect(lines.some((l) => l.includes('(5/6) タックスアンサー 失敗:'))).toBe(false);
    expect(vi.mocked(bulkDownloadQa)).toHaveBeenCalledTimes(1);
    expect(taxAnswerDocIds(path)).toEqual(['6101']);
    expect(lines).toContain('[bulk-download-everything] 全 6 種別の処理を完了しました');
  }, 30_000);
});

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-DB-SCHEMA-025                                                     */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-DB-SCHEMA-025 タックスアンサーの索引は tax_answer_index に 1 記事 1 行で保存し、取り直したら置き換える', () => {
  it('SPEC-NTA-DB-SCHEMA-025 例: url の列の無い表の DB で --bulk-download-tax-answer を実行しても、tax_answer_index_page の行は前の値のまま残り、記事は document に入る', async () => {
    const path = join(dir, 'broken.db');
    makeBrokenIndexDb(path);
    await run(['--bulk-download-tax-answer', `--db-path=${path}`]);
    expect(pageFetchedAt(path)).toBe(PAGE_FETCHED_AT);
    expect(taxAnswerDocIds(path)).toEqual(['6101']);
  }, 30_000);

  it('SPEC-NTA-DB-SCHEMA-025 保存できる DB では、索引の 1 記事が tax_answer_index の 1 行になり、[WARN] の行を出さない', async () => {
    const path = join(dir, 'good.db');
    makeDb(path);
    await run(['--bulk-download-tax-answer', `--db-path=${path}`]);
    expect(errLines().filter((l) => l.startsWith('[WARN]'))).toEqual([]);
    const db = new Database(path, { readonly: true });
    const rows = db.prepare('SELECT no, url, taxonomy FROM tax_answer_index').all();
    db.close();
    expect(rows).toEqual([{ no: '6101', url: ARTICLE_URL, taxonomy: 'shohi' }]);
  }, 30_000);
});
