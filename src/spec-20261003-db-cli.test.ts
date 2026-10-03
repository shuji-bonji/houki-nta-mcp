/**
 * 差分 specs/changes/20261003-db-cli/（PR #135）の受入テスト（CLI）。
 *
 * - cli_entry: SPEC-NTA-CLI-ENTRY-003・004・005（MODIFIED）、006・007・008（ADDED）
 * - cli_bulk_download: SPEC-NTA-CLI-BULK-DOWNLOAD-010（MODIFIED）、011（ADDED）
 * - cli_refresh: SPEC-NTA-CLI-REFRESH-005・006（MODIFIED）、007（ADDED）
 * - cli_health_check: SPEC-NTA-CLI-HEALTH-CHECK-007（ADDED。まとめの行）
 * - db_schema: SPEC-NTA-DB-SCHEMA-021 の CLI の入口（投入・取り直し・一覧）の行
 *
 * 期待値は差分の spec.md と proposal.md の本文・「例:」・表から決めている。
 * 国税庁サイトには接続しない（取り込みの関数は差し替える）。DB は一時ディレクトリだけを使う。
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./services/bulk-downloader.js', () => ({
  bulkDownloadTsutatsu: vi.fn(async () => ({ sections: 0, clauses: 0 })),
}));
const emptyBulkResult = () => ({
  totalEntries: 0,
  documentsFetched: 0,
  documentsFailed: 0,
  durationMs: 0,
  perTaxonomy: {},
  perTopic: {},
});
vi.mock('./services/bunshokaitou-bulk-downloader.js', () => ({
  bulkDownloadBunshokaitou: vi.fn(async () => emptyBulkResult()),
}));
vi.mock('./services/jimu-unei-bulk-downloader.js', () => ({
  bulkDownloadJimuUnei: vi.fn(async () => emptyBulkResult()),
}));
vi.mock('./services/tax-answer-bulk-downloader.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./services/tax-answer-bulk-downloader.js')>();
  return { ...actual, bulkDownloadTaxAnswer: vi.fn(async () => emptyBulkResult()) };
});
vi.mock('./services/qa-bulk-downloader.js', () => ({
  bulkDownloadQa: vi.fn(async () => emptyBulkResult()),
}));
vi.mock('./services/kaisei-bulk-downloader.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./services/kaisei-bulk-downloader.js')>();
  return { ...actual, bulkDownloadKaisei: vi.fn(async () => emptyBulkResult()) };
});
vi.mock('./services/baseline-drift.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./services/baseline-drift.js')>();
  return { ...actual, detectBaselineDrift: vi.fn() };
});
vi.mock('./services/health-check.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./services/health-check.js')>();
  return {
    ...actual,
    runHealthCheck: vi.fn(async () => ({ results: [], ok: 0, fail: 0, durationMs: 0 })),
  };
});

import { runCliIfRequested } from './cli.js';
import { PACKAGE_INFO } from './config.js';
import { initSchema } from './db/schema.js';
import { detectBaselineDrift } from './services/baseline-drift.js';
import { bulkDownloadTsutatsu } from './services/bulk-downloader.js';
import { bulkDownloadJimuUnei } from './services/jimu-unei-bulk-downloader.js';
import { bulkDownloadQa } from './services/qa-bulk-downloader.js';

/* -------------------------------------------------------------------------- */
/* 共通の準備                                                                  */
/* -------------------------------------------------------------------------- */

const stdout: string[] = [];
const stderr: string[] = [];
let dir: string;
let savedDbPath: string | undefined;

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
  dir = mkdtempSync(join(tmpdir(), 'houki-nta-db-cli-'));
  // 環境変数の DB は使わない（利用者の ~/.cache の DB に触れない）
  savedDbPath = process.env.HOUKI_NTA_DB_PATH;
  process.env.HOUKI_NTA_DB_PATH = join(dir, 'env-never-used.db');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(bulkDownloadTsutatsu).mockClear();
  vi.mocked(bulkDownloadJimuUnei).mockClear();
  vi.mocked(bulkDownloadQa).mockClear();
  vi.mocked(detectBaselineDrift).mockReset();
  process.exitCode = undefined;
  if (savedDbPath === undefined) delete process.env.HOUKI_NTA_DB_PATH;
  else process.env.HOUKI_NTA_DB_PATH = savedDbPath;
  rmSync(dir, { recursive: true, force: true });
});

const out = () => stdout.join('');
const err = () => stderr.join('');
const errLines = () =>
  err()
    .split('\n')
    .filter((l) => l.length > 0);
/** 使い方（SPEC-NTA-CLI-ENTRY-002）の印。HELP の先頭の行 */
const USAGE_MARK = '使い方:';

async function run(argv: string[]): Promise<{ handled: boolean; exitCode: number | undefined }> {
  const handled = await runCliIfRequested(argv);
  const code = process.exitCode;
  return { handled, exitCode: typeof code === 'number' ? code : undefined };
}

/** 版を記録した DB を作る。rows は document に入れる行（doc_type, doc_id） */
function makeDb(path: string, version: string | null, rows: Array<[string, string]> = []): void {
  const db = new Database(path);
  initSchema(db);
  const stmt = db.prepare(
    `INSERT INTO document(doc_type, doc_id, taxonomy, title, source_url, fetched_at, full_text, attached_pdfs_json)
     VALUES (?, ?, 'shotoku', '題名', 'https://www.nta.go.jp/x.htm', '2026-10-01T00:00:00.000Z', '本文', '[]')`
  );
  for (const [t, id] of rows) stmt.run(t, id);
  if (version === null) db.exec(`DELETE FROM schema_meta WHERE key = 'schema_version'`);
  else db.prepare(`UPDATE schema_meta SET value = ? WHERE key = 'schema_version'`).run(version);
  db.close();
}

function readVersion(path: string): string | undefined {
  const db = new Database(path, { readonly: true });
  try {
    return (
      db.prepare(`SELECT value FROM schema_meta WHERE key = 'schema_version'`).get() as
        | { value: string }
        | undefined
    )?.value;
  } finally {
    db.close();
  }
}

function countDocuments(path: string): number {
  const db = new Database(path, { readonly: true });
  try {
    return (db.prepare('SELECT count(*) AS n FROM document').get() as { n: number }).n;
  } finally {
    db.close();
  }
}

/** 取得日時が 60 日前の節を 1 つ持つ DB（--refresh-stale=30 が列挙する） */
function makeStaleDb(path: string): void {
  const db = new Database(path);
  initSchema(db);
  db.prepare(
    `INSERT INTO tsutatsu(id, formal_name, abbr, source_root_url) VALUES (1, '消費税法基本通達', '消基通', 'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/')`
  ).run();
  db.prepare(
    `INSERT INTO section(tsutatsu_id, chapter_number, section_number, title, url, fetched_at)
     VALUES (1, 1, 1, '第1節', 'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/01/01.htm', datetime('now', '-60 days'))`
  ).run();
  db.close();
}

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-CLI-ENTRY-003 --version                                            */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-CLI-ENTRY-003 --version と -v は <パッケージ名> v<版> の 1 行を出して終わる', () => {
  for (const flag of ['--version', '-v']) {
    it(`SPEC-NTA-CLI-ENTRY-003 ${flag} は "${PACKAGE_INFO.name} v${PACKAGE_INFO.version}" を出して終了コード 0（v0.23.x までは版の数字だけ）`, async () => {
      const r = await run([flag]);
      expect(r.handled).toBe(true);
      expect(r.exitCode ?? 0).toBe(0);
      expect(out()).toBe(`${PACKAGE_INFO.name} v${PACKAGE_INFO.version}\n`);
      expect(out()).toMatch(/^@shuji-bonji\/houki-nta-mcp v\d+\.\d+\.\d+\n$/);
    });
  }

  it('SPEC-NTA-CLI-ENTRY-003 SPEC-NTA-CLI-ENTRY-007 ほかの引数と一緒に渡すと余分な引数のエラー（--version --health-check）', async () => {
    const r = await run(['--version', '--health-check']);
    expect(r.exitCode).toBe(2);
    expect(errLines()).toContain('ERROR: 余分な引数: --health-check');
  });
});

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-CLI-ENTRY-004 --db-path                                            */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-CLI-ENTRY-004 --db-path=<path> で、投入と --refresh-stale が使う DB ファイルを指定できる', () => {
  it('SPEC-NTA-CLI-ENTRY-004 --bulk-download --tsutatsu=所得税基本通達 --db-path=<path> は、そのパスに投入する', async () => {
    const path = join(dir, 'cache.db');
    const r = await run(['--bulk-download', '--tsutatsu=所得税基本通達', `--db-path=${path}`]);
    expect(r.exitCode ?? 0).toBe(0);
    expect(bulkDownloadTsutatsu).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bulkDownloadTsutatsu).mock.calls[0][1]).toMatchObject({
      formalName: '所得税基本通達',
    });
    expect(existsSync(path)).toBe(true);
  });

  it('SPEC-NTA-CLI-ENTRY-004 SPEC-NTA-CLI-ENTRY-007 --db-path=<path> だけを渡すと「処理を選ぶフラグがありません」で終了コード 2（v0.23.x は MCP サーバーとして起動した）', async () => {
    const r = await run(['--db-path=/tmp/x.db']);
    expect(r.handled).toBe(true);
    expect(r.exitCode).toBe(2);
    expect(errLines()).toContain(
      'ERROR: 処理を選ぶフラグがありません（--db-path=/tmp/x.db だけでは何もしません）'
    );
  });

  for (const action of ['--health-check', '--check-baseline-drift']) {
    it(`SPEC-NTA-CLI-ENTRY-004 DB を使わない ${action} と一緒に渡すと余分な引数のエラー`, async () => {
      const r = await run([action, '--db-path=/tmp/x.db']);
      expect(r.exitCode).toBe(2);
      expect(errLines()).toContain('ERROR: 余分な引数: --db-path=/tmp/x.db');
    });
  }

  it('SPEC-NTA-CLI-ENTRY-004 SPEC-NTA-CLI-ENTRY-006 --db-path=（値が空）は値の無いフラグのエラー', async () => {
    const r = await run(['--bulk-download', '--db-path=']);
    expect(r.exitCode).toBe(2);
    expect(errLines()).toContain(
      'ERROR: --db-path は値を必要とします（--db-path=<値> の形で指定してください）'
    );
    expect(bulkDownloadTsutatsu).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-CLI-ENTRY-005 --help                                               */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-CLI-ENTRY-005 --help はほかの引数と一緒に渡すとエラーにし、値の誤りがあれば値のエラーを先に出す', () => {
  it('SPEC-NTA-CLI-ENTRY-005 SPEC-NTA-CLI-ENTRY-002 --help だけなら使い方を出して終了コード 0', async () => {
    const r = await run(['--help']);
    expect(r.exitCode ?? 0).toBe(0);
    expect(out()).toContain(USAGE_MARK);
  });

  it('SPEC-NTA-CLI-ENTRY-005 --help --qa-topic=zzz は値のエラーを出して終了コード 2、使い方は出さない（v0.23.x は使い方を出して 0）', async () => {
    const r = await run(['--help', '--qa-topic=zzz']);
    expect(r.exitCode).toBe(2);
    expect(err()).toContain('[houki-nta-mcp] --qa-topic="zzz" は使えません。使える値: ');
    expect(out()).not.toContain(USAGE_MARK);
  });

  it('SPEC-NTA-CLI-ENTRY-005 --help --version は余分な引数のエラーで終了コード 2', async () => {
    const r = await run(['--help', '--version']);
    expect(r.exitCode).toBe(2);
    expect(errLines()).toContain('ERROR: 余分な引数: --version');
  });

  it('SPEC-NTA-CLI-ENTRY-005 SPEC-NTA-CLI-ENTRY-006 --help と形の誤った引数は形のエラー', async () => {
    const r = await run(['--help', '--bulk-downlod']);
    expect(r.exitCode).toBe(2);
    expect(errLines()).toContain('ERROR: 未知のフラグ: --bulk-downlod');
  });
});

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-CLI-ENTRY-006 形の誤り                                              */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-CLI-ENTRY-006 形の誤った引数は、何もせずにエラーと使い方を出して exit 2', () => {
  const CASES: Array<[argv: string[], message: string, usage: boolean]> = [
    [['--bulk-downlod'], 'ERROR: 未知のフラグ: --bulk-downlod', true],
    [
      ['--db-path', '/tmp/x.db', '--bulk-download'],
      'ERROR: --db-path は値を必要とします（--db-path=<値> の形で指定してください）',
      false,
    ],
    [['status'], 'ERROR: 未知の引数: status', true],
    [
      ['--refresh-stale'],
      'ERROR: --refresh-stale は値を必要とします（--refresh-stale=<値> の形で指定してください）',
      false,
    ],
    [['--refresh=1'], 'ERROR: 未知のフラグ: --refresh=1', true],
    [['-x'], 'ERROR: 未知のフラグ: -x', true],
    [['/path'], 'ERROR: 未知の引数: /path', true],
  ];
  for (const [argv, message, usage] of CASES) {
    it(`SPEC-NTA-CLI-ENTRY-006 houki-nta-mcp ${argv.join(' ')} → "${message}"・終了コード 2・使い方を${usage ? '出す' : '出さない'}`, async () => {
      const r = await run(argv);
      expect(r.handled).toBe(true);
      expect(r.exitCode).toBe(2);
      expect(errLines()[0]).toBe(message);
      if (usage) expect(out()).toContain(USAGE_MARK);
      else expect(out()).not.toContain(USAGE_MARK);
      expect(bulkDownloadTsutatsu).not.toHaveBeenCalled();
    });
  }

  for (const flag of [
    '--db-path',
    '--tsutatsu',
    '--bunsho-taxonomy',
    '--tax-answer-taxonomy',
    '--qa-topic',
    '--refresh-stale',
  ]) {
    it(`SPEC-NTA-CLI-ENTRY-006 値を取る ${flag} に = が無い・= の後が空なら値の無いフラグのエラー`, async () => {
      for (const arg of [flag, `${flag}=`]) {
        stderr.length = 0;
        process.exitCode = undefined;
        const r = await run(['--bulk-download-everything', arg]);
        expect(r.exitCode).toBe(2);
        expect(errLines()[0]).toBe(
          `ERROR: ${flag} は値を必要とします（${flag}=<値> の形で指定してください）`
        );
      }
    });
  }

  it('SPEC-NTA-CLI-ENTRY-006 形の誤りでは DB を開かない（--db-path のファイルができない）', async () => {
    const path = join(dir, 'never.db');
    const r = await run(['--bulk-download', `--db-path=${path}`, 'status']);
    expect(r.exitCode).toBe(2);
    expect(existsSync(path)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-CLI-ENTRY-007 組み合わせ                                            */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-CLI-ENTRY-007 処理を選ぶフラグは 1 つだけで、その処理が受け付けないフラグはエラーにして exit 2', () => {
  const CASES: Array<[argv: string[], message: string]> = [
    [['--bulk-download-qa', '--health-check'], 'ERROR: 余分な引数: --health-check'],
    [
      ['--bulk-download-all', '--tsutatsu=所得税基本通達'],
      'ERROR: 余分な引数: --tsutatsu=所得税基本通達',
    ],
    [['--refresh-stale=30', '--refresh'], 'ERROR: 余分な引数: --refresh'],
    [['--apply'], 'ERROR: 処理を選ぶフラグがありません（--apply だけでは何もしません）'],
    [
      ['--db-path=/tmp/x.db'],
      'ERROR: 処理を選ぶフラグがありません（--db-path=/tmp/x.db だけでは何もしません）',
    ],
    [['--strict'], 'ERROR: 処理を選ぶフラグがありません（--strict だけでは何もしません）'],
    [['--bulk-download', '--refresh', '--refresh'], 'ERROR: 余分な引数: --refresh'],
    [
      ['--bulk-download-everything', '--tsutatsu=消費税法基本通達'],
      'ERROR: 余分な引数: --tsutatsu=消費税法基本通達',
    ],
    [['--health-check', '--apply'], 'ERROR: 余分な引数: --apply'],
    [['--bulk-download-jimu-unei', '--qa-topic=shohi'], 'ERROR: 余分な引数: --qa-topic=shohi'],
  ];
  for (const [argv, message] of CASES) {
    it(`SPEC-NTA-CLI-ENTRY-007 houki-nta-mcp ${argv.join(' ')} → "${message}"・終了コード 2・使い方を出す・処理をしない`, async () => {
      const r = await run(argv);
      expect(r.handled).toBe(true);
      expect(r.exitCode).toBe(2);
      expect(errLines()[0]).toBe(message);
      expect(out()).toContain(USAGE_MARK);
      expect(bulkDownloadTsutatsu).not.toHaveBeenCalled();
      expect(bulkDownloadQa).not.toHaveBeenCalled();
    });
  }

  const ACCEPTED: Array<[argv: string[]]> = [
    [['--quickstart', '--tsutatsu=所得税基本通達', '--refresh']],
    [['--bulk-download-bunshokaitou', '--bunsho-taxonomy=shotoku', '--refresh']],
    [['--bulk-download-tax-answer', '--tax-answer-taxonomy=saigai']],
    [['--bulk-download-qa', '--qa-topic=shohi', '--refresh']],
    [
      [
        '--bulk-download-everything',
        '--bunsho-taxonomy=shotoku',
        '--tax-answer-taxonomy=shohi',
        '--qa-topic=shohi',
        '--refresh',
      ],
    ],
  ];
  for (const [argv] of ACCEPTED) {
    it(`SPEC-NTA-CLI-ENTRY-007 一緒に使えるフラグの組み合わせは受け付ける: ${argv.join(' ')}`, async () => {
      const r = await run([...argv, `--db-path=${join(dir, 'ok.db')}`]);
      expect(r.exitCode ?? 0).toBe(0);
      expect(err()).not.toContain('ERROR:');
    });
  }
});

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-CLI-ENTRY-008 検査の順                                              */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-CLI-ENTRY-008 引数の検査は「形 → 値 → 組み合わせ」の順に行い、値の誤りはすべてを並べて exit 2', () => {
  it('SPEC-NTA-CLI-ENTRY-008 --bulk-download-everything --qa-topic=zzz --tax-answer-taxonomy=yyy は 2 行をこの引数の順に出して終了コード 2、使い方は出さない', async () => {
    const r = await run([
      '--bulk-download-everything',
      '--qa-topic=zzz',
      '--tax-answer-taxonomy=yyy',
    ]);
    expect(r.exitCode).toBe(2);
    const lines = errLines();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\[houki-nta-mcp\] --qa-topic="zzz" は使えません。使える値: /);
    expect(lines[1]).toMatch(
      /^\[houki-nta-mcp\] --tax-answer-taxonomy="yyy" は使えません。使える値: /
    );
    expect(out()).not.toContain(USAGE_MARK);
  });

  it('SPEC-NTA-CLI-ENTRY-008 --bulk-downlod --qa-topic=zzz は形の誤りが先で、未知のフラグだけを出す', async () => {
    const r = await run(['--bulk-downlod', '--qa-topic=zzz']);
    expect(r.exitCode).toBe(2);
    expect(errLines()[0]).toBe('ERROR: 未知のフラグ: --bulk-downlod');
    expect(err()).not.toContain('--qa-topic="zzz"');
  });

  it('SPEC-NTA-CLI-ENTRY-008 値の誤りがあれば組み合わせは確かめない（--health-check --qa-topic=zzz は値のエラー）', async () => {
    const r = await run(['--health-check', '--qa-topic=zzz']);
    expect(r.exitCode).toBe(2);
    expect(err()).toContain('--qa-topic="zzz" は使えません');
    expect(err()).not.toContain('余分な引数');
  });

  it('SPEC-NTA-CLI-ENTRY-008 SPEC-NTA-CLI-ENTRY-001 引数が無ければ MCP サーバーとして起動する（CLI は処理しない）', async () => {
    const r = await run([]);
    expect(r.handled).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* cli_bulk_download                                                           */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-CLI-BULK-DOWNLOAD-010 税目フラグに一覧に無い値があれば、何も投入せずに exit 2 で終わる', () => {
  it('SPEC-NTA-CLI-BULK-DOWNLOAD-010 --bulk-download-bunshokaitou --bunsho-taxonomy=zzz は使えない値と一覧（国税局の別表記つき）を出して終了コード 2（v0.23.x までは 1）、DB を開かない', async () => {
    const path = join(dir, 'never.db');
    const r = await run([
      '--bulk-download-bunshokaitou',
      '--bunsho-taxonomy=zzz',
      `--db-path=${path}`,
    ]);
    expect(r.exitCode).toBe(2);
    expect(err()).toContain('[houki-nta-mcp] --bunsho-taxonomy="zzz" は使えません。使える値: ');
    expect(err()).toContain('shotoku');
    expect(err()).toContain('（国税局の別表記 souzoku・gensenshotoku・joto_sanrin も使えます）');
    expect(existsSync(path)).toBe(false);
  });

  it('SPEC-NTA-CLI-BULK-DOWNLOAD-010 --bulk-download-qa --qa-topic=shohi,zzz も投入せず終了コード 2', async () => {
    const r = await run(['--bulk-download-qa', '--qa-topic=shohi,zzz']);
    expect(r.exitCode).toBe(2);
    expect(bulkDownloadQa).not.toHaveBeenCalled();
  });
});

describe('SPEC-NTA-CLI-BULK-DOWNLOAD-011 --tsutatsu が基本通達 4 種の正式名でなければ、何も投入せずに exit 2 で終わる', () => {
  const MESSAGE = (v: string) =>
    `[houki-nta-mcp] --tsutatsu="${v}" は使えません。使える値: 消費税法基本通達, 所得税基本通達, 法人税基本通達, 相続税法基本通達`;

  it('SPEC-NTA-CLI-BULK-DOWNLOAD-011 --bulk-download --tsutatsu=国税通則法基本通達 は使える値を出して終了コード 2 で、DB のファイルはできない（v0.23.x は DB を開いた後に fatal error で 1）', async () => {
    const path = join(dir, 'never.db');
    const r = await run(['--bulk-download', '--tsutatsu=国税通則法基本通達', `--db-path=${path}`]);
    expect(r.exitCode).toBe(2);
    expect(errLines()).toContain(MESSAGE('国税通則法基本通達'));
    expect(existsSync(path)).toBe(false);
    expect(bulkDownloadTsutatsu).not.toHaveBeenCalled();
  });

  it('SPEC-NTA-CLI-BULK-DOWNLOAD-011 --quickstart --tsutatsu=消基通（略称）も使えない値', async () => {
    const r = await run(['--quickstart', '--tsutatsu=消基通']);
    expect(r.exitCode).toBe(2);
    expect(errLines()).toContain(MESSAGE('消基通'));
    expect(bulkDownloadTsutatsu).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* cli_refresh                                                                 */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-CLI-REFRESH-006 --refresh-stale の日数が 0 以上の整数でなければ、何もせずに exit 2', () => {
  for (const v of ['abc', '-5', '1.5', '+5', '90d']) {
    it(`SPEC-NTA-CLI-REFRESH-006 --refresh-stale=${v} は値のエラーで終了コード 2（v0.23.x は指定しなかったものとして MCP サーバーを起動した）`, async () => {
      const path = join(dir, 'never.db');
      const r = await run([`--refresh-stale=${v}`, `--db-path=${path}`]);
      expect(r.handled).toBe(true);
      expect(r.exitCode).toBe(2);
      expect(errLines()).toContain(
        `[houki-nta-mcp] --refresh-stale="${v}" は使えません。0 以上の整数の日数を指定してください（例: --refresh-stale=90）`
      );
      expect(existsSync(path)).toBe(false);
    });
  }

  it('SPEC-NTA-CLI-REFRESH-006 0 は正しい値で、取得日時が実行時点より前の節をすべて列挙する', async () => {
    const path = join(dir, 'stale.db');
    makeStaleDb(path);
    const r = await run(['--refresh-stale=0', `--db-path=${path}`]);
    expect(r.exitCode ?? 0).toBe(0);
    const listed = JSON.parse(out()) as unknown[];
    expect(listed).toHaveLength(1);
  });
});

describe('SPEC-NTA-CLI-REFRESH-005 SPEC-NTA-CLI-REFRESH-007 --refresh-stale=<日数> --apply と --refresh', () => {
  it('SPEC-NTA-CLI-REFRESH-005 --refresh-stale=30 --apply は列挙した節を含む通達を差分更新で取り直す（forceReload を付けない）', async () => {
    const path = join(dir, 'stale.db');
    makeStaleDb(path);
    const r = await run(['--refresh-stale=30', '--apply', `--db-path=${path}`]);
    expect(r.exitCode ?? 0).toBe(0);
    expect(bulkDownloadTsutatsu).toHaveBeenCalledTimes(1);
    const opts = vi.mocked(bulkDownloadTsutatsu).mock.calls[0][1] as {
      formalName: string;
      forceReload?: boolean;
    };
    expect(opts.formalName).toBe('消費税法基本通達');
    expect(opts.forceReload ?? false).toBe(false);
  });

  it('SPEC-NTA-CLI-REFRESH-007 --refresh-stale=30 --apply --refresh は条件付き取得を使わずに取り直す（forceReload: true。v0.23.x は --refresh が渡らなかった）', async () => {
    const path = join(dir, 'stale.db');
    makeStaleDb(path);
    const r = await run(['--refresh-stale=30', '--apply', '--refresh', `--db-path=${path}`]);
    expect(r.exitCode ?? 0).toBe(0);
    expect(bulkDownloadTsutatsu).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bulkDownloadTsutatsu).mock.calls[0][1]).toMatchObject({
      formalName: '消費税法基本通達',
      forceReload: true,
    });
  });

  it('SPEC-NTA-CLI-REFRESH-007 SPEC-NTA-CLI-ENTRY-007 --apply の無い --refresh-stale=30 --refresh は余分な引数のエラー', async () => {
    const r = await run(['--refresh-stale=30', '--refresh']);
    expect(r.exitCode).toBe(2);
    expect(errLines()[0]).toBe('ERROR: 余分な引数: --refresh');
    expect(bulkDownloadTsutatsu).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* cli_health_check                                                            */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-CLI-HEALTH-CHECK-007 --check-baseline-drift のまとめの行は、判定の対象の件数を分母にし、対象外の件数を別に出す', () => {
  const entry = (status: string, doc_type: string) => ({
    doc_type,
    label: doc_type,
    baselineUrl: `https://www.nta.go.jp/${doc_type}`,
    status,
    message: status === 'not-applicable' ? 'kihon/ 配下でないため drift 検知対象外' : 'ok',
  });

  it('SPEC-NTA-CLI-HEALTH-CHECK-007 判定の対象 5 件が ok、対象外 4 件なら [drift-check] 5/5 OK, drift=0, 対象外=4（v0.23.x は 9/9 OK）、対象外の行には - を付ける', async () => {
    vi.mocked(detectBaselineDrift).mockResolvedValue({
      ranAt: '2026-10-04T00:00:00.000Z',
      durationMs: 1200,
      menuUrl: 'https://www.nta.go.jp/law/tsutatsu/menu.htm',
      menuEntryCount: 10,
      entries: [
        entry('ok', 'tsutatsu-shohi'),
        entry('ok', 'tsutatsu-shotoku'),
        entry('ok', 'tsutatsu-hojin'),
        entry('ok', 'tsutatsu-sozoku'),
        entry('ok', 'kaisei'),
        entry('not-applicable', 'jimu-unei'),
        entry('not-applicable', 'bunshokaitou'),
        entry('not-applicable', 'tax-answer'),
        entry('not-applicable', 'qa-jirei'),
      ],
      driftCount: 0,
    } as never);
    const r = await run(['--check-baseline-drift']);
    expect(r.exitCode ?? 0).toBe(0);
    expect(err()).toContain('[drift-check] 5/5 OK, drift=0, 対象外=4 (1.2s)');
    expect(errLines().some((l) => /^ {2}- jimu-unei/.test(l))).toBe(true);
  });

  it('SPEC-NTA-CLI-HEALTH-CHECK-007 drift があるときは ok の件数と driftCount', async () => {
    vi.mocked(detectBaselineDrift).mockResolvedValue({
      ranAt: '2026-10-04T00:00:00.000Z',
      durationMs: 0,
      menuUrl: 'https://www.nta.go.jp/law/tsutatsu/menu.htm',
      menuEntryCount: 10,
      entries: [
        entry('ok', 'tsutatsu-shohi'),
        entry('missing', 'tsutatsu-sozoku'),
        entry('generation-drift', 'tsutatsu-hojin'),
        entry('not-applicable', 'qa-jirei'),
      ],
      driftCount: 2,
    } as never);
    await run(['--check-baseline-drift']);
    expect(err()).toContain('[drift-check] 1/3 OK, drift=2, 対象外=1 (0.0s)');
  });
});

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-DB-SCHEMA-021 CLI の入口                                           */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-DB-SCHEMA-021 DB の状態と入口ごとの扱い（CLI の投入・取り直し・一覧）', () => {
  const NEW_VERSION = (v: string) =>
    `[ERROR] DB の版 (${v}) がこの houki-nta-mcp の版 (12) より新しいため、DB を変更しません。houki-nta-mcp を新しい版に更新するか、--db-path（MCP サーバーでは HOUKI_NTA_DB_PATH）で別のファイルを指定してください`;
  const OLD_VERSION = (v: string) =>
    `[ERROR] DB の版 (${v}) は古く移行できないため使えません。houki-nta-mcp --quickstart などの投入のフラグを実行すると作り直します（取り込んだ中身は消えます）`;
  const UNREADABLE = (raw: string, path: string) =>
    `[ERROR] DB の版を読めないため (schema_version: ${raw})、DB を変更しません。DB ファイル (${path}) を消してから houki-nta-mcp --quickstart などの投入のフラグを実行してください`;
  const NO_DB_APPLY = (path: string) =>
    `[ERROR] DB がまだありません (${path})。houki-nta-mcp --quickstart か --bulk-download-all で作ってください`;
  const NO_DB_LIST = (path: string) =>
    `[refresh-stale] DB がまだありません (${path})。houki-nta-mcp --quickstart か --bulk-download-all で作ってください`;

  /* ---- ファイルが無い ---- */

  it('SPEC-NTA-DB-SCHEMA-021 ファイルが無い（フォルダーも無い）とき、投入はフォルダーとファイルを作り、版 12 を記録して取り込む', async () => {
    const path = join(dir, 'nested', 'deeper', 'cache.db');
    const r = await run(['--bulk-download-jimu-unei', `--db-path=${path}`]);
    expect(r.exitCode ?? 0).toBe(0);
    expect(existsSync(path)).toBe(true);
    expect(readVersion(path)).toBe('12');
    expect(bulkDownloadJimuUnei).toHaveBeenCalledTimes(1);
  });

  it('SPEC-NTA-DB-SCHEMA-021 ファイルが無いとき、一覧（--refresh-stale=30）は作らず、DB が無いことを標準エラー出力に、[] を標準出力に出して終了コード 0', async () => {
    const path = join(dir, 'nested', 'cache.db');
    const r = await run(['--refresh-stale=30', `--db-path=${path}`]);
    expect(r.exitCode ?? 0).toBe(0);
    expect(errLines()).toContain(NO_DB_LIST(path));
    expect(JSON.parse(out())).toEqual([]);
    expect(existsSync(path)).toBe(false);
    expect(existsSync(join(dir, 'nested'))).toBe(false);
  });

  it('SPEC-NTA-DB-SCHEMA-021 ファイルが無いとき、取り直し（--refresh-stale=30 --apply）は作らず、DB が無いエラーで終了コード 1', async () => {
    const path = join(dir, 'nested', 'cache.db');
    const r = await run(['--refresh-stale=30', '--apply', `--db-path=${path}`]);
    expect(r.exitCode).toBe(1);
    expect(errLines()).toContain(NO_DB_APPLY(path));
    expect(existsSync(path)).toBe(false);
    expect(bulkDownloadTsutatsu).not.toHaveBeenCalled();
  });

  /* ---- 版の記録が無い ---- */

  it('SPEC-NTA-DB-SCHEMA-021 0 バイトのファイルは、投入ならテーブルを作って版 12 を記録して取り込む', async () => {
    const path = join(dir, 'empty.db');
    writeFileSync(path, '');
    const r = await run(['--bulk-download-jimu-unei', `--db-path=${path}`]);
    expect(r.exitCode ?? 0).toBe(0);
    expect(readVersion(path)).toBe('12');
  });

  it('SPEC-NTA-DB-SCHEMA-021 版の記録の無いファイルは、一覧ではファイルが無いときと同じ（[] と終了コード 0）で書き込まない', async () => {
    const path = join(dir, 'empty.db');
    writeFileSync(path, '');
    const r = await run(['--refresh-stale=30', `--db-path=${path}`]);
    expect(r.exitCode ?? 0).toBe(0);
    expect(errLines()).toContain(NO_DB_LIST(path));
    expect(JSON.parse(out())).toEqual([]);
  });

  it('SPEC-NTA-DB-SCHEMA-021 版の記録の無い SQLite のファイルは、取り直しではファイルが無いときと同じエラーで終了コード 1', async () => {
    const path = join(dir, 'other.db');
    makeDb(path, null);
    const r = await run(['--refresh-stale=30', '--apply', `--db-path=${path}`]);
    expect(r.exitCode).toBe(1);
    expect(errLines()).toContain(NO_DB_APPLY(path));
  });

  /* ---- 版が古く、移行できる ---- */

  it('SPEC-NTA-DB-SCHEMA-021 版 11 の DB は、一覧でも行を保ったまま 12 に移行してから列挙する', async () => {
    const path = join(dir, 'v11.db');
    makeStaleDb(path);
    {
      const db = new Database(path);
      db.prepare(`UPDATE schema_meta SET value = '11' WHERE key = 'schema_version'`).run();
      db.close();
    }
    const r = await run(['--refresh-stale=30', `--db-path=${path}`]);
    expect(r.exitCode ?? 0).toBe(0);
    expect(JSON.parse(out())).toHaveLength(1);
    expect(readVersion(path)).toBe('12');
  });

  /* ---- 版が古く、移行できない ---- */

  it('SPEC-NTA-DB-SCHEMA-021 版 2 の DB は、投入なら取得の前に作り直しの行を出し、全テーブルを消して版 12 で作り直してから取り込む', async () => {
    const path = join(dir, 'v2.db');
    makeDb(path, '2', [['jimu-unei', 'shozei/090401']]);
    const r = await run(['--bulk-download-jimu-unei', `--db-path=${path}`]);
    expect(r.exitCode ?? 0).toBe(0);
    expect(errLines()).toContain(
      '  DB の版 (2) は移行できないため、作り直します（取り込んだ中身は消えます）'
    );
    expect(readVersion(path)).toBe('12');
    expect(countDocuments(path)).toBe(0);
    expect(bulkDownloadJimuUnei).toHaveBeenCalledTimes(1);
  });

  for (const argv of [['--refresh-stale=30'], ['--refresh-stale=30', '--apply']]) {
    it(`SPEC-NTA-DB-SCHEMA-021 版 2 の DB は、${argv.join(' ')} では書き込まず、古い版のエラーで終了コード 1`, async () => {
      const path = join(dir, 'v2.db');
      makeDb(path, '2', [['jimu-unei', 'shozei/090401']]);
      const r = await run([...argv, `--db-path=${path}`]);
      expect(r.exitCode).toBe(1);
      expect(errLines()).toContain(OLD_VERSION('2'));
      expect(readVersion(path)).toBe('2');
      expect(countDocuments(path)).toBe(1);
    });
  }

  /* ---- 版が新しい ---- */

  it('SPEC-NTA-DB-SCHEMA-021 schema_version を 13 に書き換えた DB で --bulk-download-jimu-unei を実行すると、取りに行かずに新しい版の文を出して終了コード 1、版も document の行も残る（v0.23.x は作り直した）', async () => {
    const path = join(dir, 'v13.db');
    makeDb(path, '13', [['jimu-unei', 'shozei/090401']]);
    const r = await run(['--bulk-download-jimu-unei', `--db-path=${path}`]);
    expect(r.exitCode).toBe(1);
    expect(errLines()).toContain(NEW_VERSION('13'));
    expect(bulkDownloadJimuUnei).not.toHaveBeenCalled();
    expect(readVersion(path)).toBe('13');
    expect(countDocuments(path)).toBe(1);
  });

  for (const argv of [['--refresh-stale=30'], ['--refresh-stale=30', '--apply']]) {
    it(`SPEC-NTA-DB-SCHEMA-021 版 13 の DB は、${argv.join(' ')} でも新しい版のエラーで終了コード 1`, async () => {
      const path = join(dir, 'v13.db');
      makeDb(path, '13');
      const r = await run([...argv, `--db-path=${path}`]);
      expect(r.exitCode).toBe(1);
      expect(errLines()).toContain(NEW_VERSION('13'));
      expect(readVersion(path)).toBe('13');
    });
  }

  /* ---- 版を読めない ---- */

  it('SPEC-NTA-DB-SCHEMA-021 schema_version を abc に書き換えた DB で --refresh-stale=30 を実行すると、[refresh-stale] DB: の行の後に読めない版の文を出して終了コード 1（v0.23.x は UNIQUE constraint failed の例外）', async () => {
    const path = join(dir, 'abc.db');
    makeDb(path, 'abc');
    const r = await run(['--refresh-stale=30', `--db-path=${path}`]);
    expect(r.exitCode).toBe(1);
    const lines = errLines();
    const dbLine = lines.findIndex((l) => l.startsWith('[refresh-stale] DB: '));
    const msgLine = lines.indexOf(UNREADABLE('abc', path));
    expect(dbLine).toBeGreaterThanOrEqual(0);
    expect(msgLine).toBeGreaterThan(dbLine);
    expect(readVersion(path)).toBe('abc');
  });

  for (const raw of ['', '12abc']) {
    it(`SPEC-NTA-DB-SCHEMA-021 schema_version が "${raw}" の DB は読めない版で、投入も取りに行かずに終了コード 1`, async () => {
      const path = join(dir, 'bad.db');
      makeDb(path, raw, [['jimu-unei', 'shozei/090401']]);
      const r = await run(['--bulk-download-jimu-unei', `--db-path=${path}`]);
      expect(r.exitCode).toBe(1);
      expect(errLines()).toContain(UNREADABLE(raw, path));
      expect(bulkDownloadJimuUnei).not.toHaveBeenCalled();
      expect(readVersion(path)).toBe(raw);
      expect(countDocuments(path)).toBe(1);
    });
  }

  /* ---- 開けない ---- */

  const UNOPENABLE: Array<[label: string, make: () => string]> = [
    [
      'SQLite でないファイル',
      () => {
        const p = join(dir, 'text.db');
        writeFileSync(p, 'これは SQLite のファイルではありません。'.repeat(100));
        return p;
      },
    ],
    [
      'フォルダー',
      () => {
        const p = join(dir, 'a-folder.db');
        mkdirSync(p);
        return p;
      },
    ],
    [
      'パスの途中が普通のファイル',
      () => {
        const f = join(dir, 'plain-file');
        writeFileSync(f, 'x');
        return join(f, 'cache.db');
      },
    ],
  ];
  for (const [label, make] of UNOPENABLE) {
    for (const argv of [
      ['--bulk-download-jimu-unei'],
      ['--refresh-stale=30'],
      ['--refresh-stale=30', '--apply'],
    ]) {
      it(`SPEC-NTA-DB-SCHEMA-021 ${label} は、${argv.join(' ')} で「[ERROR] DB を開けません: 」を出して終了コード 1`, async () => {
        const path = make();
        const r = await run([...argv, `--db-path=${path}`]);
        expect(r.exitCode).toBe(1);
        expect(errLines().some((l) => l.startsWith('[ERROR] DB を開けません: '))).toBe(true);
        expect(bulkDownloadJimuUnei).not.toHaveBeenCalled();
      });
    }
  }
});
