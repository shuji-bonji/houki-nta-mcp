/**
 * DB ファイルパス管理 + DB を開く入口
 *
 * デフォルトのキャッシュ DB パス: `${XDG_CACHE_HOME:-~/.cache}/houki-nta-mcp/cache.db`
 *
 * 環境変数:
 *  - `XDG_CACHE_HOME` (XDG Base Directory) が指定されていればそこを使う
 *  - `HOUKI_NTA_DB_PATH` で完全に上書き可能（テスト・運用カスタム用）
 *
 * DB を開く入口は、DB の状態（ファイルの有無と schema_meta の schema_version）で扱いを変える
 * （v0.24.0、SPEC-NTA-DB-SCHEMA-021、houki-nta-mcp #107）。
 *
 * | 入口 | 関数 |
 * |---|---|
 * | CLI の投入（`--quickstart`・`--bulk-download*`） | `openIngestDb`。作る・版 1・2 を作り直す |
 * | CLI の取り直し・一覧（`--refresh-stale`） | `openExistingDb`。作らない |
 * | 読むだけのツール（10 個） | `openReadDb`。作らない。使えない DB は空の DB（メモリー）で代える |
 * | 書き戻すツール（`nta_get_tsutatsu`・`nta_get_qa`・`nta_get_tax_answer`） | `openWriteBackDb`。ファイルが無ければ、書き戻したときに作る |
 */

import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type DatabaseT from 'better-sqlite3';
import Database from 'better-sqlite3';

import { resolveDbLocation } from './location.js';
import {
  initSchema,
  MIN_MIGRATABLE_VERSION,
  readSchemaVersionRaw,
  SCHEMA_VERSION,
} from './schema.js';

/**
 * デフォルトキャッシュ DB のパスを返す（OS / 環境変数を考慮）。
 * 設定の名前と絶対パスは `resolveDbLocation()`（SPEC-NTA-DB-SCHEMA-026）
 */
export function defaultDbPath(): string {
  return resolveDbLocation().path;
}

/**
 * DB を open し、schema を初期化して返す（作る入口。ファイルが無ければ作る）。
 * テストと、DB を必ず使える状態にしたい内部の処理で使う。入口ごとの扱いは下の open*Db を使う
 *
 * @param dbPath ファイルパス。`:memory:` を渡すと in-memory DB（テスト用）。未指定なら `defaultDbPath()`
 */
export function openDb(dbPath?: string): DatabaseT.Database {
  const path = dbPath ?? defaultDbPath();
  if (path !== ':memory:') {
    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
  const db = new Database(path);
  try {
    initSchema(db);
  } catch (err) {
    db.close();
    throw err;
  }
  return db;
}

/** 安全に close する（既に閉じていても無害） */
export function closeDb(db: DatabaseT.Database): void {
  if (db.open) {
    db.close();
  }
}

/* -------------------------------------------------------------------------- */
/* DB の状態（SPEC-NTA-DB-SCHEMA-021）                                          */
/* -------------------------------------------------------------------------- */

/** DB の状態。ファイルの有無と schema_meta の schema_version で決まる */
export type DbState =
  /** `:memory:`（テスト用。新しい空の DB として扱う） */
  | { kind: 'memory' }
  /** ファイルが無い（置き場所のフォルダーも無いときを含む） */
  | { kind: 'missing' }
  /** ファイルはあるが版の記録が無い（0 バイトのファイル、schema_meta の無い SQLite のファイル） */
  | { kind: 'unversioned' }
  /** 版が同じ（12） */
  | { kind: 'current' }
  /** 版が古く、移行できる（3〜11） */
  | { kind: 'migratable'; version: number }
  /** 版が古く、移行できない（1・2） */
  | { kind: 'too-old'; version: number }
  /** 版が新しい（13 以上の整数） */
  | { kind: 'too-new'; version: number }
  /** 版を読めない（10 進の整数の文字列でない値） */
  | { kind: 'unreadable'; raw: string }
  /** 開けない（SQLite でないファイル、フォルダー、パスの途中が普通のファイル、権限が無い） */
  | { kind: 'unopenable'; message: string };

/** 版の合わない DB（読むだけのツールは使わず、書き戻すツールは書かない） */
export type VersionProblem = Extract<DbState, { kind: 'too-old' | 'too-new' | 'unreadable' }>;

export function isVersionProblem(state: DbState): state is VersionProblem {
  return state.kind === 'too-old' || state.kind === 'too-new' || state.kind === 'unreadable';
}

/** パスの途中に普通のファイルがあるか（そのときは DB を作れない） */
function blockedByFile(path: string): string | undefined {
  let cur = dirname(resolve(path));
  for (;;) {
    if (existsSync(cur)) {
      return statSync(cur).isDirectory() ? undefined : cur;
    }
    const parent = dirname(cur);
    if (parent === cur) return undefined;
    cur = parent;
  }
}

/**
 * DB の状態を調べる。ファイル・フォルダー・テーブル・schema_meta を作らず、行も書かない
 * （読み取り専用で開く。SQLite が -wal / -shm のファイルを置くことはある）
 */
export function probeDbState(path: string): DbState {
  if (path === ':memory:') return { kind: 'memory' };
  if (!existsSync(path)) {
    const blocker = blockedByFile(path);
    if (blocker) {
      return {
        kind: 'unopenable',
        message: `ENOTDIR: パスの途中が普通のファイルです (${blocker})`,
      };
    }
    return { kind: 'missing' };
  }
  let db: DatabaseT.Database;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
  } catch (err) {
    return { kind: 'unopenable', message: err instanceof Error ? err.message : String(err) };
  }
  try {
    const raw = readSchemaVersionRaw(db);
    if (raw.kind === 'none') return { kind: 'unversioned' };
    if (raw.kind === 'invalid') return { kind: 'unreadable', raw: raw.raw };
    if (raw.value === SCHEMA_VERSION) return { kind: 'current' };
    if (raw.value > SCHEMA_VERSION) return { kind: 'too-new', version: raw.value };
    if (raw.value < MIN_MIGRATABLE_VERSION) return { kind: 'too-old', version: raw.value };
    return { kind: 'migratable', version: raw.value };
  } catch (err) {
    return { kind: 'unopenable', message: err instanceof Error ? err.message : String(err) };
  } finally {
    db.close();
  }
}

/** CLI の入口が DB を使えないときの例外。CLI はこれを見て文を出し、終了コード 1 で終わる */
export class DbEntryError extends Error {
  constructor(public readonly state: DbState) {
    super(`DB を使えません: ${state.kind}`);
    this.name = 'DbEntryError';
  }
}

function openWritable(path: string): DatabaseT.Database {
  try {
    return new Database(path);
  } catch (err) {
    throw new DbEntryError({
      kind: 'unopenable',
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * CLI の投入（`--quickstart`・`--bulk-download*`）の入口。国税庁サイトを取りに行く前に呼ぶ。
 *
 * - ファイルが無い: フォルダーとファイルを作り、テーブルを作って版 12 を記録する
 * - 版の記録が無い: テーブルを作って版 12 を記録する
 * - 版 3〜11: 行を保ったまま 12 に移行する。版 12: そのまま
 * - 版 1・2: `onRecreate` を呼んでから、全テーブルを消して版 12 で作り直す
 * - 版が新しい・読めない・開けない: 何も変えずに DbEntryError を投げる
 */
export function openIngestDb(
  path: string,
  onRecreate?: (version: number) => void
): DatabaseT.Database {
  const state = probeDbState(path);
  switch (state.kind) {
    case 'too-new':
    case 'unreadable':
    case 'unopenable':
      throw new DbEntryError(state);
    case 'memory':
      return openDb(':memory:');
    case 'missing':
      try {
        mkdirSync(dirname(path), { recursive: true });
      } catch (err) {
        throw new DbEntryError({
          kind: 'unopenable',
          message: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    case 'too-old':
      onRecreate?.(state.version);
      break;
    default:
      break;
  }
  const db = openWritable(path);
  try {
    initSchema(db);
  } catch (err) {
    db.close();
    throw new DbEntryError({
      kind: 'unopenable',
      message: err instanceof Error ? err.message : String(err),
    });
  }
  return db;
}

/**
 * CLI の取り直し・一覧（`--refresh-stale`）の入口。DB を作らない。
 *
 * - ファイルが無い・版の記録が無い: undefined（呼び出し側が「DB がまだありません」を出す）
 * - 版 3〜11: 行を保ったまま 12 に移行してから返す。版 12: そのまま返す
 * - 版 1・2・新しい・読めない・開けない: DbEntryError を投げる（書き込まない）
 */
export function openExistingDb(path: string): DatabaseT.Database | undefined {
  const state = probeDbState(path);
  switch (state.kind) {
    case 'missing':
    case 'unversioned':
      return undefined;
    case 'too-old':
    case 'too-new':
    case 'unreadable':
    case 'unopenable':
      throw new DbEntryError(state);
    case 'memory':
      return openDb(':memory:');
    default: {
      const db = openWritable(path);
      try {
        initSchema(db);
      } catch (err) {
        db.close();
        throw new DbEntryError({
          kind: 'unopenable',
          message: err instanceof Error ? err.message : String(err),
        });
      }
      return db;
    }
  }
}

/** 空の DB（メモリー）。使えない DB の代わりに引いて、「DB に 1 件も無い」ときと同じ応答を作るために使う */
function emptyMemoryDb(): DatabaseT.Database {
  const db = new Database(':memory:');
  initSchema(db);
  return db;
}

/**
 * 読むだけのツールの入口。DB のファイルを作らない。
 *
 * - 版 12・版 3〜11（移行してから）: その DB を返す
 * - ファイルが無い・版の記録が無い・版が合わない: 空の DB（メモリー）を返す。ツールは「DB に 1 件も無い」ときの応答を作る
 * - 開けない: v0.23.x と同じく例外（この差分では変えない）
 *
 * `state` を見て、版の合わない DB のときは応答の hint を書き換える（handlers の explainDbState）
 */
export function openReadDb(dbPath?: string): {
  db: DatabaseT.Database;
  state: DbState;
  path: string;
} {
  const path = dbPath ?? defaultDbPath();
  const state = probeDbState(path);
  switch (state.kind) {
    case 'current':
    case 'migratable':
    case 'memory':
    case 'unopenable':
      return { db: openDb(path), state, path };
    default:
      return { db: emptyMemoryDb(), state, path };
  }
}

/**
 * 書き戻すツールの入口。
 *
 * - 版 12・版 3〜11（移行してから）: その DB を返す。`persist` は何もしない
 * - ファイルが無い: 空の DB（メモリー）を返し、`persist` を呼んだときに書き込みがあれば、フォルダーとファイルを作って
 *   その中身を書く（国税庁サイトから取れたときだけファイルができる）
 * - 版の記録が無い・版が合わない: 空の DB（メモリー）を返す。`persist` は何もしない（DB には書かない）
 * - 開けない: v0.23.x と同じく例外（この差分では変えない）
 */
export function openWriteBackDb(dbPath?: string): {
  db: DatabaseT.Database;
  state: DbState;
  /** 呼び出しの終わりに呼ぶ。閉じるのは closeDb */
  persist: () => void;
} {
  const path = dbPath ?? defaultDbPath();
  const state = probeDbState(path);
  const noop = () => {};
  switch (state.kind) {
    case 'current':
    case 'migratable':
    case 'memory':
    case 'unopenable':
      return { db: openDb(path), state, persist: noop };
    case 'missing': {
      const db = emptyMemoryDb();
      const baseline = totalChanges(db);
      return {
        db,
        state,
        persist: () => {
          if (!db.open || totalChanges(db) === baseline) return;
          try {
            mkdirSync(dirname(path), { recursive: true });
            // 呼び出しのあいだに別のプロセスが作ったファイルは上書きしない
            writeFileSync(path, db.serialize(), { flag: 'wx' });
          } catch {
            // best effort: 書けなくても応答は返せる
          }
        },
      };
    }
    default:
      return { db: emptyMemoryDb(), state, persist: noop };
  }
}

function totalChanges(db: DatabaseT.Database): number {
  return (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
}

export {
  bareCommand,
  type DbLocation,
  type DbLocationSetting,
  dbLocationForEnvPath,
  displayDbPath,
  guideCommand,
  resolveDbLocation,
  shellPath,
} from './location.js';
export { getSchemaVersion, initSchema, SCHEMA_VERSION } from './schema.js';
