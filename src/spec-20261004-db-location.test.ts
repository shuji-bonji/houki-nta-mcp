/**
 * 差分 specs/changes/20261004-db-location/（PR #142、houki-nta-mcp #138）の受入テスト（CLI）。
 *
 * - db_schema: SPEC-NTA-DB-SCHEMA-021（MODIFIED。CLI のエラーの文の中の案内のコマンド）、026・027（ADDED。CLI の出力）
 * - cli_status: SPEC-NTA-CLI-STATUS-001〜008（ADDED。新しい --status）
 * - cli_entry: SPEC-NTA-CLI-ENTRY-009（ADDED。MCP サーバーの起動時のログ）、002・004・007（MODIFIED。--status）
 *
 * 期待値は差分の spec.md の本文・表・「例:」から決めている。例のホームディレクトリ `/Users/bonji` は、一時ディレクトリの
 * 下のフォルダー（HOME）に置き換える。国税庁サイトには接続しない（取り込みの関数は差し替える）。
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./services/bulk-downloader.js', () => ({
  bulkDownloadTsutatsu: vi.fn(async () => ({ sections: 0, clauses: 0 })),
}));

import { runCliIfRequested } from './cli.js';
import { PACKAGE_INFO } from './config.js';
import { initSchema } from './db/schema.js';
import { logServerStarted } from './startup-log.js';

/* -------------------------------------------------------------------------- */
/* 共通の準備                                                                  */
/* -------------------------------------------------------------------------- */

/** 案内のコマンドの本体（SPEC-NTA-DB-SCHEMA-027） */
const NPX = 'npx -y @shuji-bonji/houki-nta-mcp@latest';

const ENV_KEYS = ['HOME', 'HOUKI_NTA_DB_PATH', 'XDG_CACHE_HOME'] as const;
let saved: Record<string, string | undefined>;
const stdout: string[] = [];
const stderr: string[] = [];
let dir: string;
let home: string;
let defaultDb: string;
const relativeLeftovers: string[] = [];

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
  dir = mkdtempSync(join(tmpdir(), 'houki-nta-db-location-cli-'));
  home = join(dir, 'home');
  mkdirSync(home);
  defaultDb = join(home, '.cache', 'houki-nta-mcp', 'cache.db');
  setEnv({ HOME: home, HOUKI_NTA_DB_PATH: undefined, XDG_CACHE_HOME: undefined });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  setEnv(saved);
  rmSync(dir, { recursive: true, force: true });
  for (const p of relativeLeftovers.splice(0)) rmSync(p, { recursive: true, force: true });
});

function setEnv(vars: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

const out = () => stdout.join('');
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

/** 版を記録した DB を作る */
function makeDb(path: string, version: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  initSchema(db);
  db.prepare(`UPDATE schema_meta SET value = ? WHERE key = 'schema_version'`).run(version);
  db.close();
}

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-DB-SCHEMA-021（CLI のエラーの文）                                  */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-DB-SCHEMA-021 DB の状態と入口ごとの扱い（CLI のエラーの文の中の案内のコマンド）', () => {
  it('SPEC-NTA-DB-SCHEMA-021 環境変数を付けずに、schema_version が 2 の DB で --refresh-stale=30 --apply を実行すると、npx の形の --quickstart を案内して終了コード 1', async () => {
    makeDb(defaultDb, '2');
    const code = await run(['--refresh-stale=30', '--apply']);
    expect(code).toBe(1);
    expect(errLines()).toContain(
      `[ERROR] DB の版 (2) は古く移行できないため使えません。${NPX} --quickstart などの投入のフラグを実行すると作り直します（取り込んだ中身は消えます）`
    );
  });

  it('SPEC-NTA-DB-SCHEMA-021 --db-path を付けて実行したときは、コマンドの後ろに --db-path=… が付く', async () => {
    const path = join(dir, 'old.db');
    makeDb(path, '2');
    const code = await run(['--refresh-stale=30', '--apply', `--db-path=${path}`]);
    expect(code).toBe(1);
    expect(errLines()).toContain(
      `[ERROR] DB の版 (2) は古く移行できないため使えません。${NPX} --quickstart --db-path='${path}' などの投入のフラグを実行すると作り直します（取り込んだ中身は消えます）`
    );
  });

  it('SPEC-NTA-DB-SCHEMA-021 読めない版の文の <DB の場所> は DB: の行と同じ値で、コマンドは案内のコマンド', async () => {
    makeDb(defaultDb, 'abc');
    const code = await run(['--refresh-stale=30']);
    expect(code).toBe(1);
    expect(errLines()).toContain(
      `[ERROR] DB の版を読めないため (schema_version: abc)、DB を変更しません。DB ファイル (${defaultDb}) を消してから ${NPX} --quickstart などの投入のフラグを実行してください`
    );
  });

  it('SPEC-NTA-DB-SCHEMA-021 DB が無い（取り直し・一覧）の文の中のコマンドも案内のコマンド', async () => {
    expect(await run(['--refresh-stale=30', '--apply'])).toBe(1);
    expect(errLines()).toContain(
      `[ERROR] DB がまだありません (${defaultDb})。${NPX} --quickstart か --bulk-download-all で作ってください`
    );
    stderr.length = 0;
    process.exitCode = undefined;
    expect((await run(['--refresh-stale=30'])) ?? 0).toBe(0);
    expect(errLines()).toContain(
      `[refresh-stale] DB がまだありません (${defaultDb})。${NPX} --quickstart か --bulk-download-all で作ってください`
    );
    expect(JSON.parse(out())).toEqual([]);
  });

  it('SPEC-NTA-DB-SCHEMA-021 新しい版の文は変わらない（コマンドを含まない）', async () => {
    makeDb(defaultDb, '13');
    expect(await run(['--refresh-stale=30'])).toBe(1);
    expect(errLines()).toContain(
      '[ERROR] DB の版 (13) がこの houki-nta-mcp の版 (12) より新しいため、DB を変更しません。houki-nta-mcp を新しい版に更新するか、--db-path（MCP サーバーでは HOUKI_NTA_DB_PATH）で別のファイルを指定してください'
    );
  });
});

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-DB-SCHEMA-026・027（CLI）                                          */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-DB-SCHEMA-026 DB の場所を決めた設定を 4 つの名前で表し、表示と案内には DB の絶対パスを使う', () => {
  it('SPEC-NTA-DB-SCHEMA-026 --db-path と HOUKI_NTA_DB_PATH を両方付けると --db-path が先で、案内のコマンドは後ろに --db-path=… を付ける', async () => {
    const x = join(dir, 'x.db');
    const y = join(dir, 'y.db');
    setEnv({ HOUKI_NTA_DB_PATH: y });
    expect(await run(['--refresh-stale=30', '--apply', `--db-path=${x}`])).toBe(1);
    expect(errLines()).toContain(
      `[ERROR] DB がまだありません (${x})。${NPX} --quickstart --db-path='${x}' か --bulk-download-all で作ってください`
    );
  });

  it('SPEC-NTA-DB-SCHEMA-026 CLI の DB: の行と <DB の場所> は HOUKI_NTA_DB_PATH の値のまま、案内のコマンドは絶対パスにした値を前に付ける', async () => {
    const top = `houki-nta-db-location-cli-${process.pid}-${Date.now()}`;
    relativeLeftovers.push(resolve(top));
    const rel = `${top}/cache.db`;
    setEnv({ HOUKI_NTA_DB_PATH: rel });
    expect((await run(['--refresh-stale=30'])) ?? 0).toBe(0);
    expect(errLines()).toContain(`[refresh-stale] DB: ${rel} (30 日より古い section を対象)`);
    expect(errLines()).toContain(
      `[refresh-stale] DB がまだありません (${rel})。HOUKI_NTA_DB_PATH='${resolve(rel)}' ${NPX} --quickstart か --bulk-download-all で作ってください`
    );
    expect(existsSync(resolve(top))).toBe(false);
  });

  it('SPEC-NTA-DB-SCHEMA-026 --db-path が相対パスなら、案内のコマンドの --db-path=… は作業フォルダーから絶対パスにした値', async () => {
    const top = `houki-nta-db-location-cli-rel-${process.pid}-${Date.now()}`;
    relativeLeftovers.push(resolve(top));
    const rel = `${top}/cache.db`;
    expect(await run(['--refresh-stale=30', '--apply', `--db-path=${rel}`])).toBe(1);
    expect(errLines()).toContain(
      `[ERROR] DB がまだありません (${rel})。${NPX} --quickstart --db-path='${resolve(rel)}' か --bulk-download-all で作ってください`
    );
  });
});

describe('SPEC-NTA-DB-SCHEMA-027 案内のコマンドは npx -y @shuji-bonji/houki-nta-mcp@latest <フラグ> で、DB の場所を決めた設定を同じ形で付ける', () => {
  it('SPEC-NTA-DB-SCHEMA-027 CLI に --db-path=<ホーム>/dev$1/cache.db を渡すと、--db-path="$HOME"\'/dev$1/cache.db\' を後ろに付ける', async () => {
    const path = join(home, 'dev$1', 'cache.db');
    expect(await run(['--refresh-stale=30', '--apply', `--db-path=${path}`])).toBe(1);
    expect(errLines()).toContain(
      `[ERROR] DB がまだありません (${path})。${NPX} --quickstart --db-path="$HOME"'/dev$1/cache.db' か --bulk-download-all で作ってください`
    );
  });

  it('SPEC-NTA-DB-SCHEMA-027 CLI を XDG_CACHE_HOME 付きで実行したときも、前に同じ変数を付ける', async () => {
    setEnv({ XDG_CACHE_HOME: join(home, 'Library', 'Caches') });
    expect(await run(['--refresh-stale=30', '--apply'])).toBe(1);
    expect(errLines()).toContain(
      `[ERROR] DB がまだありません (${join(home, 'Library', 'Caches', 'houki-nta-mcp', 'cache.db')})。XDG_CACHE_HOME="$HOME/Library/Caches" ${NPX} --quickstart か --bulk-download-all で作ってください`
    );
  });
});

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-CLI-ENTRY-009 起動時のログ                                         */
/* -------------------------------------------------------------------------- */

interface LogLine {
  ts: string;
  level: string;
  scope: string;
  msg: string;
  meta?: Record<string, unknown>;
}

function logLines(): LogLine[] {
  return errLines().map((l) => JSON.parse(l) as LogLine);
}

describe('SPEC-NTA-CLI-ENTRY-009 MCP サーバーは起動時のログに、DB の絶対パスと DB の場所の設定を出す', () => {
  it('SPEC-NTA-CLI-ENTRY-009 環境変数なしで起動すると、started の行の次に msg「DB: <絶対パス>（DB の場所の設定: 既定）」と meta の行', () => {
    logServerStarted();
    const lines = logLines();
    expect(lines).toHaveLength(2);
    expect(lines[0].scope).toBe('server');
    expect(lines[0].msg.startsWith(`${PACKAGE_INFO.name} v${PACKAGE_INFO.version} started`)).toBe(
      true
    );
    expect(lines[1]).toMatchObject({
      level: 'info',
      scope: 'server',
      msg: `DB: ${defaultDb}（DB の場所の設定: 既定）`,
      meta: { db_path: defaultDb, setting: '既定' },
    });
    expect(typeof lines[1].ts).toBe('string');
  });

  it('SPEC-NTA-CLI-ENTRY-009 HOUKI_NTA_DB_PATH（ホームディレクトリの下）で起動すると、設定は HOUKI_NTA_DB_PATH で、パスは ~ に置き換えない', () => {
    const path = join(home, '.cache', 'houki-nta-mcp', 'cache.dev.db');
    setEnv({ HOUKI_NTA_DB_PATH: path });
    logServerStarted();
    expect(logLines()[1]).toMatchObject({
      msg: `DB: ${path}（DB の場所の設定: HOUKI_NTA_DB_PATH）`,
      meta: { db_path: path, setting: 'HOUKI_NTA_DB_PATH' },
    });
  });

  it('SPEC-NTA-CLI-ENTRY-009 XDG_CACHE_HOME で起動すると、設定は XDG_CACHE_HOME で、パスは $XDG_CACHE_HOME/houki-nta-mcp/cache.db', () => {
    const xdg = join(dir, 'xdg');
    setEnv({ XDG_CACHE_HOME: xdg });
    logServerStarted();
    const path = join(xdg, 'houki-nta-mcp', 'cache.db');
    expect(logLines()[1]).toMatchObject({
      msg: `DB: ${path}（DB の場所の設定: XDG_CACHE_HOME）`,
      meta: { db_path: path, setting: 'XDG_CACHE_HOME' },
    });
  });

  it('SPEC-NTA-CLI-ENTRY-009 HOUKI_NTA_DB_PATH が相対パスなら、作業フォルダーから絶対パスにしたものを出す', () => {
    setEnv({ HOUKI_NTA_DB_PATH: 'dev/cache.db' });
    logServerStarted();
    expect(logLines()[1].meta).toEqual({
      db_path: resolve('dev/cache.db'),
      setting: 'HOUKI_NTA_DB_PATH',
    });
  });

  it('SPEC-NTA-CLI-ENTRY-009 この行のために DB を開かず、ファイルも作らない', () => {
    logServerStarted();
    expect(existsSync(defaultDb)).toBe(false);
    expect(existsSync(dirname(defaultDb))).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-CLI-ENTRY-002・004・007（--status）                                 */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-CLI-ENTRY-002 --help と -h は使い方を標準出力に出して終わり、MCP サーバーを起動しない', () => {
  it('SPEC-NTA-CLI-ENTRY-002 --help の保守のフラグに --status の行があり、DB の場所とそれを決めた設定、件数を出し、DB を作らないことを書く', async () => {
    expect((await run(['--help'])) ?? 0).toBe(0);
    const help = out();
    const statusLines = help.split('\n').filter((l) => l.includes('houki-nta-mcp --status'));
    expect(statusLines).toHaveLength(1);
    const i = help.indexOf('houki-nta-mcp --status');
    const block = help.slice(i, help.indexOf('\n  houki-nta-mcp', i + 1));
    expect(block).toContain('DB の場所');
    expect(block).toContain('設定');
    expect(block).toContain('件数');
    expect(block).toContain('DB を作らず');
    expect(help.indexOf('保守:')).toBeLessThan(i);
  });
});

describe('SPEC-NTA-CLI-ENTRY-004 --db-path=<path> で、投入と --refresh-stale と --status が使う DB ファイルを指定できる', () => {
  it('SPEC-NTA-CLI-ENTRY-004 --status --db-path=<path> は、そのパスの場所を出す（設定は --db-path）', async () => {
    const path = join(dir, 'cache.db');
    expect((await run(['--status', `--db-path=${path}`])) ?? 0).toBe(0);
    const lines = out().split('\n');
    expect(lines[1]).toBe(`  DB: ${path}`);
    expect(lines[2].startsWith('  DB の場所の設定: --db-path（')).toBe(true);
  });
});

describe('SPEC-NTA-CLI-ENTRY-007 処理を選ぶフラグは 1 つだけで、その処理が受け付けないフラグはエラーにして exit 2', () => {
  const cases: Array<[string[], string]> = [
    [['--status', '--refresh'], 'ERROR: 余分な引数: --refresh'],
    [['--status', '--bulk-download-qa'], 'ERROR: 余分な引数: --bulk-download-qa'],
    [['--status', '--status'], 'ERROR: 余分な引数: --status'],
    [['--status', '--strict'], 'ERROR: 余分な引数: --strict'],
  ];
  for (const [argv, message] of cases) {
    it(`SPEC-NTA-CLI-ENTRY-007 houki-nta-mcp ${argv.join(' ')} → "${message}"・終了コード 2・使い方を出す`, async () => {
      expect(await run(argv)).toBe(2);
      expect(errLines()).toEqual([message]);
      expect(out()).toContain('使い方:');
      expect(out()).not.toContain('[status]');
    });
  }

  it('SPEC-NTA-CLI-ENTRY-007 --status は --db-path と一緒に使える', async () => {
    expect((await run(['--status', `--db-path=${join(dir, 'x.db')}`])) ?? 0).toBe(0);
    expect(out().startsWith('[status] ')).toBe(true);
  });

  it('SPEC-NTA-CLI-ENTRY-007 v0.24.x の「未知のフラグ: --status」にはならない', async () => {
    await run(['--status']);
    expect(errLines().some((l) => l.includes('未知のフラグ'))).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* cli_status                                                                  */
/* -------------------------------------------------------------------------- */

const outLines = () =>
  out()
    .split('\n')
    .filter((l) => l.length > 0);

/** 版 12 の DB を作り、文書を入れる。rows は [doc_type, doc_id, fetched_at, orphaned_at] */
function makeDocsDb(path: string, rows: Array<[string, string, string, string | null]> = []): void {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  initSchema(db);
  const stmt = db.prepare(
    `INSERT INTO document(doc_type, doc_id, taxonomy, title, source_url, fetched_at, full_text, attached_pdfs_json, orphaned_at)
     VALUES (?, ?, 'shohi', '題名', 'https://www.nta.go.jp/x.htm', ?, '本文', '[]', ?)`
  );
  for (const [t, id, f, o] of rows) stmt.run(t, id, f, o);
  db.close();
}

function versionOf(path: string): string | undefined {
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

function tableNames(path: string): string[] {
  const db = new Database(path, { readonly: true });
  try {
    return (
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
        .all() as Array<{
        name: string;
      }>
    ).map((r) => r.name);
  } finally {
    db.close();
  }
}

function rowCounts(path: string): Record<string, number> {
  const db = new Database(path, { readonly: true });
  try {
    const counts: Record<string, number> = {};
    for (const name of tableNames(path)) {
      if (name.includes('fts')) continue;
      counts[name] = (db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get() as { n: number }).n;
    }
    return counts;
  } finally {
    db.close();
  }
}

describe('SPEC-NTA-CLI-STATUS-001 1〜3 行目に、版・DB の場所・DB の場所を決めた設定を出す', () => {
  it('SPEC-NTA-CLI-STATUS-001 環境変数なしでは [status] <パッケージ名> v<版>・DB: ~/.cache/houki-nta-mcp/cache.db の絶対パス・DB の場所の設定: 既定', async () => {
    await run(['--status']);
    expect(outLines().slice(0, 3)).toEqual([
      `[status] ${PACKAGE_INFO.name} v${PACKAGE_INFO.version}`,
      `  DB: ${defaultDb}`,
      '  DB の場所の設定: 既定',
    ]);
  });

  it('SPEC-NTA-CLI-STATUS-001 --db-path=/tmp/x.db の形を付けると、2 行目はその値、3 行目は --db-path の文', async () => {
    const path = join(dir, 'x.db');
    await run(['--status', `--db-path=${path}`]);
    expect(outLines().slice(1, 3)).toEqual([
      `  DB: ${path}`,
      '  DB の場所の設定: --db-path（MCP サーバーは --db-path を受け取りません。MCP サーバーが開く DB は HOUKI_NTA_DB_PATH・XDG_CACHE_HOME・既定のどれかで決まります）',
    ]);
  });

  it('SPEC-NTA-CLI-STATUS-001 HOUKI_NTA_DB_PATH は値のまま（相対パスも）、3 行目は HOUKI_NTA_DB_PATH の文', async () => {
    const top = `houki-nta-status-${process.pid}-${Date.now()}`;
    relativeLeftovers.push(resolve(top));
    setEnv({ HOUKI_NTA_DB_PATH: `${top}/cache.db` });
    await run(['--status']);
    expect(outLines().slice(1, 3)).toEqual([
      `  DB: ${top}/cache.db`,
      '  DB の場所の設定: HOUKI_NTA_DB_PATH（MCP クライアントから起動したサーバーは、シェルの環境変数を受け継がないことがあります）',
    ]);
    expect(existsSync(resolve(top))).toBe(false);
  });

  it('SPEC-NTA-CLI-STATUS-001 XDG_CACHE_HOME は $XDG_CACHE_HOME/houki-nta-mcp/cache.db を絶対パスにしたもの、3 行目は XDG_CACHE_HOME の文', async () => {
    const xdg = join(dir, 'xdg');
    setEnv({ XDG_CACHE_HOME: xdg });
    await run(['--status']);
    expect(outLines().slice(1, 3)).toEqual([
      `  DB: ${join(xdg, 'houki-nta-mcp', 'cache.db')}`,
      '  DB の場所の設定: XDG_CACHE_HOME（MCP クライアントから起動したサーバーは、シェルの環境変数を受け継がないことがあります）',
    ]);
  });
});

describe('SPEC-NTA-CLI-STATUS-002 同じフォルダーに別の cache*.db があれば [WARN] で知らせる', () => {
  const WARN_HEAD = '[WARN] 同じフォルダーに、この DB のほかに cache*.db のファイルがあります: ';
  const WARN_TAIL = '。MCP サーバーと CLI が別のファイルを開いていないか確かめてください';

  it('SPEC-NTA-CLI-STATUS-002 例: cache.dev.db（2,048 バイト、2026-10-04 12:00）があれば 3 行目の次に [WARN]。-wal・baseline-*.json・files/ は数えない', async () => {
    makeDocsDb(defaultDb);
    const folder = dirname(defaultDb);
    const dev = join(folder, 'cache.dev.db');
    writeFileSync(dev, Buffer.alloc(2048));
    const t = new Date(2026, 9, 4, 12, 0, 0);
    utimesSync(dev, t, t);
    writeFileSync(join(folder, 'cache.db-wal'), '');
    writeFileSync(join(folder, 'baseline-qa-jirei.json'), '{}');
    mkdirSync(join(folder, 'files'));
    mkdirSync(join(folder, 'cache.dir.db'));
    expect((await run(['--status'])) ?? 0).toBe(0);
    expect(outLines()[3]).toBe(`${WARN_HEAD}cache.dev.db (2.0 KB, 2026-10-04 12:00)${WARN_TAIL}`);
    expect(outLines().filter((l) => l.startsWith('[WARN]'))).toHaveLength(1);
    expect(errLines()).toEqual([]);
  });

  it('SPEC-NTA-CLI-STATUS-002 HOUKI_NTA_DB_PATH が無いファイル（cache.dev.db）を指し、同じフォルダーに cache.db があるときは cache.db を挙げ、DB が無いことを出して終了コード 0', async () => {
    makeDocsDb(defaultDb);
    setEnv({ HOUKI_NTA_DB_PATH: join(dirname(defaultDb), 'cache.dev.db') });
    expect((await run(['--status'])) ?? 0).toBe(0);
    const lines = outLines();
    expect(lines[3].startsWith(`${WARN_HEAD}cache.db (`)).toBe(true);
    expect(lines[3].endsWith(WARN_TAIL)).toBe(true);
    expect(lines[4].startsWith('  (DB がまだありません — ')).toBe(true);
  });

  it('SPEC-NTA-CLI-STATUS-002 cache.db だけのフォルダーでは出さない', async () => {
    makeDocsDb(defaultDb);
    await run(['--status']);
    expect(outLines().some((l) => l.startsWith('[WARN]'))).toBe(false);
  });

  it('SPEC-NTA-CLI-STATUS-002 並びは名前の順で、大きさは B・KB・MB（小数 1 桁）・GB（小数 2 桁）、退避したファイル（cache.v11.bak.db）も数える', async () => {
    const folder = dirname(defaultDb);
    mkdirSync(folder, { recursive: true });
    const t = new Date(2026, 0, 2, 3, 4, 0);
    const files: Array<[string, number]> = [
      ['cache.v11.bak.db', 1024 * 1024 * 1024],
      ['cache.b.db', 100],
      ['cache.a.db', Math.round(1.5 * 1024 * 1024)],
    ];
    for (const [name, size] of files) {
      const p = join(folder, name);
      writeFileSync(p, '');
      truncateSync(p, size);
      utimesSync(p, t, t);
    }
    await run(['--status']);
    expect(outLines()[3]).toBe(
      `${WARN_HEAD}cache.a.db (1.5 MB, 2026-01-02 03:04), cache.b.db (100 B, 2026-01-02 03:04), cache.v11.bak.db (1.00 GB, 2026-01-02 03:04)${WARN_TAIL}`
    );
  });

  it('SPEC-NTA-CLI-STATUS-002 見つけたファイルは開かない（SQLite でない中身でもエラーにならない）', async () => {
    makeDocsDb(defaultDb);
    writeFileSync(join(dirname(defaultDb), 'cache.broken.db'), 'not a database');
    expect((await run(['--status'])) ?? 0).toBe(0);
    expect(outLines()[3].startsWith(`${WARN_HEAD}cache.broken.db (14 B, `)).toBe(true);
    expect(errLines()).toEqual([]);
  });

  it('SPEC-NTA-CLI-STATUS-002 版が違う DB（版 13）でも 3 行目の次に [WARN] を出す。終了コードは変えない', async () => {
    makeDocsDb(defaultDb);
    const db = new Database(defaultDb);
    db.prepare(`UPDATE schema_meta SET value = '13' WHERE key = 'schema_version'`).run();
    db.close();
    writeFileSync(join(dirname(defaultDb), 'cache.old.db'), '');
    expect(await run(['--status'])).toBe(1);
    expect(outLines()[3].startsWith(`${WARN_HEAD}cache.old.db (0 B, `)).toBe(true);
    expect(errLines().some((l) => l.startsWith('[WARN]'))).toBe(false);
  });

  it('SPEC-NTA-CLI-STATUS-002 フォルダーが無いときは何も出さず、エラーにしない', async () => {
    expect((await run(['--status'])) ?? 0).toBe(0);
    expect(outLines().some((l) => l.startsWith('[WARN]'))).toBe(false);
    expect(errLines()).toEqual([]);
  });
});

describe('SPEC-NTA-CLI-STATUS-003 版 12 の DB では、版と種別ごとの件数・取得日時の範囲を出して exit 0', () => {
  it('SPEC-NTA-CLI-STATUS-003 例の DB（消基通の条項 2 件、タックスアンサー 3 件のうち 1 件は索引から消えた、質疑応答事例 1 件）', async () => {
    makeDocsDb(defaultDb, [
      ['tax-answer', '2882', '2026-09-07T21:06:49.516Z', '2026-10-04T02:11:37.431Z'],
      ['tax-answer', '1131', '2026-10-04T03:00:00.000Z', null],
      ['tax-answer', '6101', '2026-10-04T03:51:17.445Z', null],
      ['qa-jirei', 'shohi/02/19', '2026-10-04T04:26:15.744Z', null],
    ]);
    const db = new Database(defaultDb);
    const id = (
      db
        .prepare(
          'INSERT INTO tsutatsu(formal_name, abbr, source_root_url) VALUES (?, ?, ?) RETURNING id'
        )
        .get('消費税法基本通達', '消基通', 'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/') as {
        id: number;
      }
    ).id;
    for (const [section, fetchedAt] of [
      [1, '2026-10-04T03:14:49.904Z'],
      [2, '2026-10-04T03:24:14.467Z'],
    ] as const) {
      const url = `https://www.nta.go.jp/law/tsutatsu/kihon/shohi/01/0${section}.htm`;
      db.prepare(
        `INSERT INTO section(tsutatsu_id, chapter_number, section_number, title, url, fetched_at)
         VALUES (?, 1, ?, '節', ?, ?)`
      ).run(id, section, url, fetchedAt);
      db.prepare(
        `INSERT INTO clause(tsutatsu_id, clause_number, source_url, chapter_number, section_number, title, full_text, paragraphs_json)
         VALUES (?, ?, ?, 1, ?, '題', '本文', '[]')`
      ).run(id, `1-${section}-1`, url, section);
    }
    db.close();
    expect((await run(['--status'])) ?? 0).toBe(0);
    expect(out()).toBe(
      [
        `[status] ${PACKAGE_INFO.name} v${PACKAGE_INFO.version}`,
        `  DB: ${defaultDb}`,
        '  DB の場所の設定: 既定',
        '  schema_version: 12',
        '  tsutatsu: 1 (clause: 2, fetched_at: 2026-10-04T03:14:49.904Z 〜 2026-10-04T03:24:14.467Z)',
        '  qa-jirei: 1 (fetched_at: 2026-10-04T04:26:15.744Z 〜 2026-10-04T04:26:15.744Z)',
        '  tax-answer: 3 (国税庁の索引から消えた: 1, fetched_at: 2026-10-04T03:00:00.000Z 〜 2026-10-04T03:51:17.445Z)',
        '  kaisei: 0',
        '  jimu-unei: 0',
        '  bunshokaitou: 0',
        '',
      ].join('\n')
    );
    expect(stderr.join('')).toBe('');
  });

  it('SPEC-NTA-CLI-STATUS-003 節の行が無ければ tsutatsu の fetched_at を書かず、索引から消えた文書だけの種別は括弧に消えた件数だけ。読めない取得日時もそのまま出す', async () => {
    makeDocsDb(defaultDb, [
      ['kaisei', '0026003-067', '2026-09-01T00:00:00Z', '2026-10-04T03:40:00Z'],
      ['jimu-unei', 'shozei/090401', '2026/05/08', null],
    ]);
    expect((await run(['--status'])) ?? 0).toBe(0);
    const lines = outLines();
    expect(lines).toContain('  tsutatsu: 0 (clause: 0)');
    expect(lines).toContain('  kaisei: 1 (国税庁の索引から消えた: 1)');
    expect(lines).toContain('  jimu-unei: 1 (fetched_at: 2026/05/08 〜 2026/05/08)');
    expect(lines.some((l) => l.includes('staleness'))).toBe(false);
  });

  it('SPEC-NTA-CLI-STATUS-003 件数に区切りの , を付けない', async () => {
    const rows: Array<[string, string, string, string | null]> = [];
    for (let i = 0; i < 1234; i++)
      rows.push(['qa-jirei', `shohi/01/${i}`, '2026-10-04T00:00:00Z', null]);
    makeDocsDb(defaultDb, rows);
    await run(['--status']);
    expect(outLines()).toContain(
      '  qa-jirei: 1234 (fetched_at: 2026-10-04T00:00:00Z 〜 2026-10-04T00:00:00Z)'
    );
  });
});

describe('SPEC-NTA-CLI-STATUS-004 DB が無いときは作らずに、そのことを出して exit 0', () => {
  it('SPEC-NTA-CLI-STATUS-004 例: HOUKI_NTA_DB_PATH=<空のフォルダー>/a/cache.db（ホームディレクトリの外）では 4 行で終了コード 0、<空のフォルダー>/a はできない', async () => {
    const empty = join(dir, 'empty');
    mkdirSync(empty);
    const path = join(empty, 'a', 'cache.db');
    setEnv({ HOUKI_NTA_DB_PATH: path });
    expect((await run(['--status'])) ?? 0).toBe(0);
    expect(outLines()).toEqual([
      `[status] ${PACKAGE_INFO.name} v${PACKAGE_INFO.version}`,
      `  DB: ${path}`,
      '  DB の場所の設定: HOUKI_NTA_DB_PATH（MCP クライアントから起動したサーバーは、シェルの環境変数を受け継がないことがあります）',
      `  (DB がまだありません — HOUKI_NTA_DB_PATH='${path}' ${NPX} --quickstart などの投入のフラグで作ります)`,
    ]);
    expect(existsSync(join(empty, 'a'))).toBe(false);
  });

  it('SPEC-NTA-CLI-STATUS-004 環境変数なしでファイルが無いときのコマンドは変数なし、--db-path を付けたときは後ろに --db-path=…', async () => {
    await run(['--status']);
    expect(outLines()[3]).toBe(
      `  (DB がまだありません — ${NPX} --quickstart などの投入のフラグで作ります)`
    );
    stdout.length = 0;
    const path = join(home, 'work', 'cache.db');
    await run(['--status', `--db-path=${path}`]);
    expect(outLines()[3]).toBe(
      `  (DB がまだありません — ${NPX} --quickstart --db-path="$HOME/work/cache.db" などの投入のフラグで作ります)`
    );
  });

  it('SPEC-NTA-CLI-STATUS-004 ファイルはあるが版の記録が無い（0 バイト）ときは別の行で、終了コード 0', async () => {
    mkdirSync(dirname(defaultDb), { recursive: true });
    writeFileSync(defaultDb, '');
    expect((await run(['--status'])) ?? 0).toBe(0);
    expect(outLines()[3]).toBe(
      `  (DB のファイルはありますが、まだ何も投入されていません — ${NPX} --quickstart などの投入のフラグで、このファイルに投入します)`
    );
    expect(outLines()).toHaveLength(4);
  });

  it('SPEC-NTA-CLI-STATUS-004 schema_meta の無い SQLite のファイルも版の記録が無い DB の行', async () => {
    mkdirSync(dirname(defaultDb), { recursive: true });
    const db = new Database(defaultDb);
    db.exec('CREATE TABLE other (x TEXT)');
    db.close();
    expect((await run(['--status'])) ?? 0).toBe(0);
    expect(
      outLines()[3].startsWith('  (DB のファイルはありますが、まだ何も投入されていません — ')
    ).toBe(true);
  });
});

describe('SPEC-NTA-CLI-STATUS-005 版 3〜11 の DB は移行せず、版と移行の案内を出して exit 0', () => {
  it('SPEC-NTA-CLI-STATUS-005 例: schema_version が 11 の DB では 4 行目が schema_version: 11、5 行目が移行の案内で、版は 11 のまま、tax_answer_index の表もできない', async () => {
    makeDocsDb(defaultDb, [['qa-jirei', 'shohi/02/19', '2026-10-04T00:00:00Z', null]]);
    const db = new Database(defaultDb);
    db.exec('DROP TABLE tax_answer_index; DROP TABLE tax_answer_index_page;');
    db.prepare(`UPDATE schema_meta SET value = '11' WHERE key = 'schema_version'`).run();
    db.close();
    expect((await run(['--status'])) ?? 0).toBe(0);
    expect(outLines().slice(3)).toEqual([
      '  schema_version: 11',
      '  (この版の DB は、次に投入のフラグかツールで開いたときに、行を保ったまま 12 に移行します。--status は移行しないので、件数は出しません)',
    ]);
    expect(versionOf(defaultDb)).toBe('11');
    expect(tableNames(defaultDb)).not.toContain('tax_answer_index');
  });
});

describe('SPEC-NTA-CLI-STATUS-006 版 1・2・新しい版・読めない版の DB には書き込まずに exit 1', () => {
  function setVersion(v: string): void {
    makeDocsDb(defaultDb, [['qa-jirei', 'shohi/02/19', '2026-10-04T00:00:00Z', null]]);
    const db = new Database(defaultDb);
    db.prepare(`UPDATE schema_meta SET value = ? WHERE key = 'schema_version'`).run(v);
    db.close();
  }

  it('SPEC-NTA-CLI-STATUS-006 例: schema_version が 13 の DB では新しい版の文を標準エラー出力に出して終了コード 1', async () => {
    setVersion('13');
    expect(await run(['--status'])).toBe(1);
    expect(errLines()).toEqual([
      '[ERROR] DB の版 (13) がこの houki-nta-mcp の版 (12) より新しいため、DB を変更しません。houki-nta-mcp を新しい版に更新するか、--db-path（MCP サーバーでは HOUKI_NTA_DB_PATH）で別のファイルを指定してください',
    ]);
    expect(outLines()).toHaveLength(3);
    expect(versionOf(defaultDb)).toBe('13');
  });

  it('SPEC-NTA-CLI-STATUS-006 例: schema_version が 2 の DB では npx の形の --quickstart を案内して終了コード 1、版は 2 のまま、行も残る', async () => {
    setVersion('2');
    expect(await run(['--status'])).toBe(1);
    expect(errLines()).toEqual([
      `[ERROR] DB の版 (2) は古く移行できないため使えません。${NPX} --quickstart などの投入のフラグを実行すると作り直します（取り込んだ中身は消えます）`,
    ]);
    expect(versionOf(defaultDb)).toBe('2');
    expect(rowCounts(defaultDb).document).toBe(1);
  });

  it('SPEC-NTA-CLI-STATUS-006 版を読めない DB（abc）は読めない版の文で終了コード 1', async () => {
    setVersion('abc');
    expect(await run(['--status'])).toBe(1);
    expect(errLines()).toEqual([
      `[ERROR] DB の版を読めないため (schema_version: abc)、DB を変更しません。DB ファイル (${defaultDb}) を消してから ${NPX} --quickstart などの投入のフラグを実行してください`,
    ]);
  });
});

describe('SPEC-NTA-CLI-STATUS-007 DB を開けないときは exit 1', () => {
  it('SPEC-NTA-CLI-STATUS-007 例: --db-path に SQLite でない中身のファイルを指定すると [ERROR] DB を開けません: file is not a database で終了コード 1', async () => {
    const path = join(dir, 'not-a-db.db');
    writeFileSync(path, 'this is not a sqlite database file at all, just text.');
    expect(await run(['--status', `--db-path=${path}`])).toBe(1);
    expect(errLines()).toEqual(['[ERROR] DB を開けません: file is not a database']);
    expect(outLines()).toHaveLength(3);
  });

  it('SPEC-NTA-CLI-STATUS-007 DB のパスがフォルダーのときも [ERROR] DB を開けません: で終了コード 1', async () => {
    const path = join(dir, 'folder.db');
    mkdirSync(path);
    expect(await run(['--status', `--db-path=${path}`])).toBe(1);
    expect(errLines()).toHaveLength(1);
    expect(errLines()[0].startsWith('[ERROR] DB を開けません: ')).toBe(true);
  });

  it('SPEC-NTA-CLI-STATUS-007 パスの途中が普通のファイルのときも [ERROR] DB を開けません: で終了コード 1', async () => {
    writeFileSync(join(dir, 'plain'), '');
    expect(await run(['--status', `--db-path=${join(dir, 'plain', 'cache.db')}`])).toBe(1);
    expect(errLines()[0].startsWith('[ERROR] DB を開けません: ')).toBe(true);
  });
});

describe('SPEC-NTA-CLI-STATUS-008 --status は DB に書き込まず、移行もしない', () => {
  it('SPEC-NTA-CLI-STATUS-008 DB のファイルが無い場所では、ファイルもフォルダーもできない', async () => {
    await run(['--status']);
    expect(existsSync(defaultDb)).toBe(false);
    expect(existsSync(dirname(defaultDb))).toBe(false);
  });

  it('SPEC-NTA-CLI-STATUS-008 0 バイトのファイルは 0 バイトのまま', async () => {
    mkdirSync(dirname(defaultDb), { recursive: true });
    writeFileSync(defaultDb, '');
    await run(['--status']);
    expect(statSync(defaultDb).size).toBe(0);
  });

  for (const version of ['11', '12', '13']) {
    it(`SPEC-NTA-CLI-STATUS-008 版 ${version} の DB は、実行の前後で大きさ・schema_version・各テーブルの行の数が変わらない`, async () => {
      makeDocsDb(defaultDb, [
        ['qa-jirei', 'shohi/02/19', '2026-10-04T00:00:00Z', null],
        ['tax-answer', '6101', '2026-10-04T00:00:00Z', '2026-10-04T01:00:00Z'],
      ]);
      const db = new Database(defaultDb);
      db.prepare(`UPDATE schema_meta SET value = ? WHERE key = 'schema_version'`).run(version);
      db.close();
      const before = {
        size: statSync(defaultDb).size,
        version: versionOf(defaultDb),
        rows: rowCounts(defaultDb),
      };
      await run(['--status']);
      expect({
        size: statSync(defaultDb).size,
        version: versionOf(defaultDb),
        rows: rowCounts(defaultDb),
      }).toEqual(before);
    });
  }
});
