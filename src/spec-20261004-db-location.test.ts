/**
 * 差分 specs/changes/20261004-db-location/（PR #142、houki-nta-mcp #138）の受入テスト（CLI）。
 *
 * - db_schema: SPEC-NTA-DB-SCHEMA-021（MODIFIED。CLI のエラーの文の中の案内のコマンド）、026・027（ADDED。CLI の出力）
 *
 * 期待値は差分の spec.md の本文・表・「例:」から決めている。例のホームディレクトリ `/Users/bonji` は、一時ディレクトリの
 * 下のフォルダー（HOME）に置き換える。国税庁サイトには接続しない（取り込みの関数は差し替える）。
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./services/bulk-downloader.js', () => ({
  bulkDownloadTsutatsu: vi.fn(async () => ({ sections: 0, clauses: 0 })),
}));

import { runCliIfRequested } from './cli.js';
import { initSchema } from './db/schema.js';

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
