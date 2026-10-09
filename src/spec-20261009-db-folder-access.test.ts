/**
 * 差分 specs/changes/20261009-db-folder-access-and-tsutatsu-guide/（PR #160、houki-nta-mcp #154）の受入テスト（CLI）。
 *
 * - db_schema: SPEC-NTA-DB-SCHEMA-021（MODIFIED。置き場所のフォルダーに入る権限が無いときは「開けない」行）
 * - cli_status: SPEC-NTA-CLI-STATUS-004・007（MODIFIED）
 *
 * 期待値は差分の spec.md の本文・表・「例:」と、proposal.md の「実装の変更」の受入テストの場面から決めている。
 * 場面は proposal.md の「今の動き」の A〜D:
 *
 * | 場面 | DB のパス | 入る権限の無いフォルダー |
 * |---|---|---|
 * | A | `<一時フォルダー>/locked/cache.db`（`chmod 000` の locked の中に SQLite の cache.db がある） | locked |
 * | B | `<一時フォルダー>/locked2/cache.db`（`chmod 000` の locked2 の中に何も無い） | locked2 |
 * | C | `<一時フォルダー>/locked/sub/cache.db`（パスの途中の locked に入れない） | locked |
 * | D | `<一時フォルダー>/ronly/cache.db`（`chmod 444` の ronly の中に 0 バイトの cache.db がある） | ronly |
 *
 * root では chmod が効かないので、root で走るときは飛ばす。後片付けでフォルダーの権限を戻す。
 * 国税庁サイトには接続しない（fetch を差し替え、呼ばれたら記録する。取り込みの関数も差し替える）。
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./services/qa-bulk-downloader.js', () => ({
  bulkDownloadQa: vi.fn(async () => ({ documentsFetched: 0 })),
}));

import { runCliIfRequested } from './cli.js';
import { bulkDownloadQa } from './services/qa-bulk-downloader.js';

/* -------------------------------------------------------------------------- */
/* 共通の準備                                                                  */
/* -------------------------------------------------------------------------- */

/** root では chmod 000 のフォルダーにも入れてしまう（proposal.md の「実装の変更」の受入テスト） */
const IS_ROOT = process.getuid?.() === 0;

const ENV_KEYS = ['HOME', 'HOUKI_NTA_DB_PATH', 'XDG_CACHE_HOME'] as const;
let saved: Record<string, string | undefined>;
const stdout: string[] = [];
const stderr: string[] = [];
const fetched: string[] = [];
let dir: string;
/** 権限を変えたフォルダー。afterEach で戻してから消す */
const lockedDirs: string[] = [];

beforeEach(() => {
  stdout.length = 0;
  stderr.length = 0;
  fetched.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  dir = mkdtempSync(join(tmpdir(), 'houki-nta-db-folder-access-cli-'));
  const home = join(dir, 'home');
  mkdirSync(home);
  setEnv({ HOME: home, HOUKI_NTA_DB_PATH: undefined, XDG_CACHE_HOME: undefined });
  vi.stubGlobal('fetch', (async (input: string | URL | Request) => {
    fetched.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    return new Response('not found', { status: 404 });
  }) as typeof fetch);
  vi.mocked(bulkDownloadQa).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  process.exitCode = undefined;
  setEnv(saved);
  unlockAll();
  rmSync(dir, { recursive: true, force: true });
});

function setEnv(vars: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

function lock(path: string, mode: number): void {
  chmodSync(path, mode);
  lockedDirs.push(path);
}

function unlockAll(): void {
  for (const p of lockedDirs.splice(0)) {
    if (existsSync(p)) chmodSync(p, 0o755);
  }
}

const outLines = () =>
  stdout
    .join('')
    .split('\n')
    .filter((l) => l.length > 0);
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

/** SPEC-NTA-DB-SCHEMA-021 の入る権限の無いフォルダーで開けないときの CLI の文 */
function folderError(folder: string): string {
  return `[ERROR] DB を開けません: EACCES: パスの途中のフォルダーに入る権限がありません (${folder})`;
}

/** 入る権限の無いフォルダーの場面（proposal.md の「今の動き」の A〜D） */
interface Locked {
  name: string;
  /** 作って、DB のパスを返す */
  make: () => string;
  /** 入る権限が無いフォルダー（絶対パス） */
  folder: () => string;
  /** 権限を戻した後に、中身が変わっていないことを確かめる */
  unchanged: () => void;
}

const LOCKED: Locked[] = [
  {
    name: 'A: chmod 000 のフォルダーの中に SQLite の cache.db がある',
    make: () => {
      mkdirSync(join(dir, 'locked'));
      const db = new Database(join(dir, 'locked', 'cache.db'));
      db.exec('CREATE TABLE t(x)');
      db.close();
      lock(join(dir, 'locked'), 0o000);
      return join(dir, 'locked', 'cache.db');
    },
    folder: () => join(dir, 'locked'),
    unchanged: () => {
      expect(readdirSync(join(dir, 'locked'))).toEqual(['cache.db']);
    },
  },
  {
    name: 'B: chmod 000 のフォルダーの中に何も無い',
    make: () => {
      mkdirSync(join(dir, 'locked2'));
      lock(join(dir, 'locked2'), 0o000);
      return join(dir, 'locked2', 'cache.db');
    },
    folder: () => join(dir, 'locked2'),
    unchanged: () => {
      expect(readdirSync(join(dir, 'locked2'))).toEqual([]);
    },
  },
  {
    name: 'C: パスの途中のフォルダー（chmod 000）に入れない',
    make: () => {
      mkdirSync(join(dir, 'locked', 'sub'), { recursive: true });
      lock(join(dir, 'locked'), 0o000);
      return join(dir, 'locked', 'sub', 'cache.db');
    },
    folder: () => join(dir, 'locked'),
    unchanged: () => {
      expect(readdirSync(join(dir, 'locked'))).toEqual(['sub']);
      expect(readdirSync(join(dir, 'locked', 'sub'))).toEqual([]);
    },
  },
  {
    name: 'D: 読めるが入れないフォルダー（chmod 444）の中に 0 バイトの cache.db がある',
    make: () => {
      mkdirSync(join(dir, 'ronly'));
      writeFileSync(join(dir, 'ronly', 'cache.db'), '');
      lock(join(dir, 'ronly'), 0o444);
      return join(dir, 'ronly', 'cache.db');
    },
    folder: () => join(dir, 'ronly'),
    unchanged: () => {
      expect(readdirSync(join(dir, 'ronly'))).toEqual(['cache.db']);
      expect(statSync(join(dir, 'ronly', 'cache.db')).size).toBe(0);
    },
  },
];

/** 入口（SPEC-NTA-DB-SCHEMA-021 の CLI の 4 つの入口） */
const ENTRIES: Array<{ name: string; argv: string[] }> = [
  { name: '確かめる（--status）', argv: ['--status'] },
  { name: '一覧（--refresh-stale=30）', argv: ['--refresh-stale=30'] },
  { name: '取り直し（--refresh-stale=30 --apply）', argv: ['--refresh-stale=30', '--apply'] },
  { name: '投入（--bulk-download-qa）', argv: ['--bulk-download-qa'] },
];

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-DB-SCHEMA-021                                                     */
/* -------------------------------------------------------------------------- */

describe.skipIf(IS_ROOT)(
  'SPEC-NTA-DB-SCHEMA-021 DB の状態と入口ごとの扱い（置き場所のフォルダーに入る権限が無いときは「開けない」行）',
  () => {
    for (const c of LOCKED) {
      for (const e of ENTRIES) {
        it(`SPEC-NTA-DB-SCHEMA-021 ${c.name}: ${e.name}は [ERROR] DB を開けません: EACCES: パスの途中のフォルダーに入る権限がありません (<フォルダー>) で終了コード 1、DB がまだありませんとは出さず、フォルダーの中身は変わらない`, async () => {
          setEnv({ HOUKI_NTA_DB_PATH: c.make() });
          const code = await run(e.argv);
          expect(code).toBe(1);
          expect(errLines()).toContain(folderError(c.folder()));
          expect(
            [...outLines(), ...errLines()].some((l) => l.includes('DB がまだありません'))
          ).toBe(false);
          unlockAll();
          c.unchanged();
        });
      }
    }

    it('SPEC-NTA-DB-SCHEMA-021 投入のフラグは、国税庁サイトを取りに行く前に止める（A の場面の --bulk-download-qa）', async () => {
      setEnv({ HOUKI_NTA_DB_PATH: LOCKED[0].make() });
      expect(await run(['--bulk-download-qa'])).toBe(1);
      expect(vi.mocked(bulkDownloadQa)).not.toHaveBeenCalled();
      expect(fetched).toEqual([]);
    });

    it('SPEC-NTA-DB-SCHEMA-021 例: HOUKI_NTA_DB_PATH=<…>/locked/cache.db（locked は chmod 000）で --status は、1〜3 行目の後に [ERROR] DB を開けません: EACCES: パスの途中のフォルダーに入る権限がありません (<…>/locked) を出して終了コード 1。cache.db があってもなくても同じ', async () => {
      const locked = join(dir, 'locked');
      const path = join(locked, 'cache.db');
      // cache.db が無いとき
      mkdirSync(locked);
      lock(locked, 0o000);
      setEnv({ HOUKI_NTA_DB_PATH: path });
      expect(await run(['--status'])).toBe(1);
      expect(errLines()).toEqual([folderError(locked)]);
      expect(outLines()).toHaveLength(3);
      // cache.db があるとき
      unlockAll();
      const db = new Database(path);
      db.exec('CREATE TABLE t(x)');
      db.close();
      lock(locked, 0o000);
      stdout.length = 0;
      stderr.length = 0;
      process.exitCode = undefined;
      expect(await run(['--status'])).toBe(1);
      expect(errLines()).toEqual([folderError(locked)]);
      expect(outLines()).toHaveLength(3);
    });

    it('SPEC-NTA-DB-SCHEMA-021 置き場所のフォルダーに入れて、書く権限だけが無い（chmod 555）ときに DB のファイルが無ければ、今までどおり「ファイルが無い」（--status は DB がまだありませんで終了コード 0）', async () => {
      const folder = join(dir, 'readonly');
      mkdirSync(folder);
      lock(folder, 0o555);
      setEnv({ HOUKI_NTA_DB_PATH: join(folder, 'cache.db') });
      expect(await run(['--status'])).toBe(0);
      expect(outLines().some((l) => l.startsWith('  (DB がまだありません — '))).toBe(true);
      expect(errLines()).toEqual([]);
    });
  }
);

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-CLI-STATUS-004・007                                                */
/* -------------------------------------------------------------------------- */

describe.skipIf(IS_ROOT)(
  'SPEC-NTA-CLI-STATUS-004 DB が無いときは作らずに、そのことを出して exit 0（置き場所のフォルダーに入る権限が無いときは当たらない）',
  () => {
    for (const c of LOCKED) {
      it(`SPEC-NTA-CLI-STATUS-004 ${c.name}: (DB がまだありません — …) の行を出さず、終了コード 0 にしない`, async () => {
        setEnv({ HOUKI_NTA_DB_PATH: c.make() });
        const code = await run(['--status']);
        expect(code).not.toBe(0);
        expect(outLines().some((l) => l.startsWith('  (DB がまだありません'))).toBe(false);
        expect(outLines().some((l) => l.startsWith('  (DB のファイルはありますが'))).toBe(false);
      });
    }
  }
);

describe.skipIf(IS_ROOT)(
  'SPEC-NTA-CLI-STATUS-007 DB を開けないときは exit 1（置き場所のフォルダーに入る権限が無いとき）',
  () => {
    for (const c of LOCKED) {
      it(`SPEC-NTA-CLI-STATUS-007 ${c.name}: 1〜3 行目を標準出力に出した後、標準エラー出力に [ERROR] DB を開けません: EACCES: … を出し、件数を出さずに終了コード 1。フォルダーの中身は変わらない`, async () => {
        setEnv({ HOUKI_NTA_DB_PATH: c.make() });
        expect(await run(['--status'])).toBe(1);
        expect(errLines()).toEqual([folderError(c.folder())]);
        expect(outLines()).toHaveLength(3);
        unlockAll();
        c.unchanged();
      });
    }

    for (const withDb of [false, true]) {
      it(`SPEC-NTA-CLI-STATUS-007 例: --db-path=<…>/locked/cache.db（locked は chmod 000、cache.db が${withDb ? 'ある' : '無い'}）は [ERROR] DB を開けません: EACCES: パスの途中のフォルダーに入る権限がありません (<…>/locked) で終了コード 1、[WARN] の行は出ない`, async () => {
        const locked = join(dir, 'locked');
        mkdirSync(locked);
        if (withDb) {
          const db = new Database(join(locked, 'cache.db'));
          db.exec('CREATE TABLE t(x)');
          db.close();
        }
        // 同じフォルダーの別の cache*.db（入れないので探せない）
        writeFileSync(join(locked, 'cache.dev.db'), '');
        lock(locked, 0o000);
        expect(await run(['--status', `--db-path=${join(locked, 'cache.db')}`])).toBe(1);
        expect(errLines()).toEqual([folderError(locked)]);
        expect(outLines().some((l) => l.startsWith('[WARN]'))).toBe(false);
        expect(outLines()).toHaveLength(3);
      });
    }
  }
);
