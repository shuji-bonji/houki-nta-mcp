/**
 * ローカル DB の場所の設定と、利用者に見せるパス・案内のコマンドの書き方（v0.25.0、houki-nta-mcp #138、T6）
 *
 * - DB の場所を決めた設定の名前と DB の絶対パス（SPEC-NTA-DB-SCHEMA-026）
 * - 案内のコマンド `npx -y @shuji-bonji/houki-nta-mcp@latest <フラグ>`。DB の場所を決めた設定を、シェルでそのまま
 *   動く形で付ける（環境変数は前、`--db-path` は後ろ。SPEC-NTA-DB-SCHEMA-027）
 * - MCP の応答に出すパス。ホームディレクトリの部分を `~` にする（SPEC-NTA-DB-SCHEMA-028）
 *
 * MCP サーバーと CLI の両方がここを使う。houki-egov-mcp 0.20.0 の `src/db/location.ts` と同じ規則だが、
 * 共有ライブラリには出さず、このリポジトリで独自に持つ（houki-hub の family 方針）。
 */

import { homedir } from 'node:os';
import { resolve } from 'node:path';

import { PACKAGE_INFO } from '../config.js';

/** DB の場所を決めた設定の名前（SPEC-NTA-DB-SCHEMA-026） */
export type DbLocationSetting = '--db-path' | 'HOUKI_NTA_DB_PATH' | 'XDG_CACHE_HOME' | '既定';

/** DB の場所と、それを決めた設定 */
export interface DbLocation {
  /** CLI の `DB: ` の行に出す値。`--db-path` と `HOUKI_NTA_DB_PATH` のときはその値のまま */
  path: string;
  /** DB の絶対パス（相対パスは処理を始めたときの作業フォルダーから決める。`:memory:` はそのまま） */
  absolutePath: string;
  /** DB の場所を決めた設定 */
  setting: DbLocationSetting;
  /**
   * 案内のコマンドに付けるもの（SPEC-NTA-DB-SCHEMA-027 の表）。`既定` では null。
   * `--db-path` は後ろに、環境変数は前に付ける。`value` は絶対パス
   */
  guide: { kind: 'env' | 'flag'; name: string; value: string } | null;
}

/** DB の絶対パス。`:memory:` は絶対パスにしない（SPEC-NTA-DB-SCHEMA-026） */
function absolutize(path: string): string {
  return path === ':memory:' ? path : resolve(path);
}

/**
 * DB の場所と、それを決めた設定を返す（SPEC-NTA-DB-SCHEMA-026）。
 *
 * 優先の順: CLI の `--db-path` → `HOUKI_NTA_DB_PATH`（空文字は無いもの）→ `$XDG_CACHE_HOME/houki-nta-mcp/cache.db`
 * （空文字は無いもの）→ `~/.cache/houki-nta-mcp/cache.db`。MCP サーバーは `cliDbPath` を渡さない
 *
 * @param cliDbPath CLI の `--db-path=<path>` の値
 */
export function resolveDbLocation(cliDbPath?: string): DbLocation {
  if (cliDbPath !== undefined) {
    const absolutePath = absolutize(cliDbPath);
    return {
      path: cliDbPath,
      absolutePath,
      setting: '--db-path',
      guide: { kind: 'flag', name: '--db-path', value: absolutePath },
    };
  }
  const override = process.env.HOUKI_NTA_DB_PATH;
  if (override) return dbLocationForEnvPath(override);
  const xdg = process.env.XDG_CACHE_HOME;
  if (xdg && xdg.length > 0) {
    const path = resolve(xdg, 'houki-nta-mcp', 'cache.db');
    return {
      path,
      absolutePath: path,
      setting: 'XDG_CACHE_HOME',
      guide: { kind: 'env', name: 'XDG_CACHE_HOME', value: resolve(xdg) },
    };
  }
  const path = resolve(homedir(), '.cache', 'houki-nta-mcp', 'cache.db');
  return { path, absolutePath: path, setting: '既定', guide: null };
}

/**
 * `HOUKI_NTA_DB_PATH` に `dbPath` を指定したときの DB の場所。
 * ツールのハンドラーに `dbPath` を渡したとき（テスト用）も、この場所として扱う
 */
export function dbLocationForEnvPath(dbPath: string): DbLocation {
  const absolutePath = absolutize(dbPath);
  return {
    path: dbPath,
    absolutePath,
    setting: 'HOUKI_NTA_DB_PATH',
    guide: { kind: 'env', name: 'HOUKI_NTA_DB_PATH', value: absolutePath },
  };
}

/**
 * ホームディレクトリの下なら、ホームディレクトリより後ろの部分（先頭の `/` を含む。同じなら空文字）を返す。
 * 下でなければ null。区切りの位置で、文字列のまま比べる。ホームディレクトリが空文字か `/` なら置き換えない
 * （SPEC-NTA-DB-SCHEMA-028 の 2〜5）
 */
function restUnderHome(absPath: string, home: string): string | null {
  if (home === '' || home === '/') return null;
  if (absPath === home) return '';
  if (absPath.startsWith(`${home}/`)) return absPath.slice(home.length);
  return null;
}

/** MCP の応答に出す DB のパス。ホームディレクトリの部分を `~` に置き換える（SPEC-NTA-DB-SCHEMA-028） */
export function displayDbPath(absPath: string, home: string = homedir()): string {
  const rest = restUnderHome(absPath, home);
  return rest === null ? absPath : `~${rest}`;
}

/**
 * 文の中の、ホームディレクトリに `/` が続く部分のホームディレクトリを `~` にする。
 * ホームディレクトリが空文字か `/` なら置き換えない（`displayDbPath` と同じ判定。SPEC-NTA-DB-SCHEMA-028 の 3〜5）。
 * DB を開けない理由の文（`detail.cause`）を MCP の応答に出すときに使う（v0.26.0、SPEC-NTA-DB-SCHEMA-029、#144）
 */
export function displayHomeInText(text: string, home: string = homedir()): string {
  if (home === '' || home === '/') return text;
  return text.replaceAll(`${home}/`, '~/');
}

/** `'` で囲む。中の `'` は `'\''` にする */
function singleQuoted(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}

/**
 * パスをシェルに書く形（SPEC-NTA-DB-SCHEMA-027）。
 * ホームディレクトリの下は `"$HOME/<残り>"`（残りに `"` `$` `` ` `` `\` `!` を含めば `"$HOME"'/<残り>'`）、外は `'<絶対パス>'`
 */
export function shellPath(absPath: string, home: string = homedir()): string {
  const rest = restUnderHome(absPath, home);
  if (rest === null) return singleQuoted(absPath);
  const tail = rest.slice(1);
  if (/["$`\\!]/.test(tail)) return `"$HOME"${singleQuoted(`/${tail}`)}`;
  return `"$HOME/${tail}"`;
}

/**
 * 利用者に実行を勧めるコマンド（SPEC-NTA-DB-SCHEMA-027）。
 * `[<変数>=<シェルに書くパス> ]npx -y @shuji-bonji/houki-nta-mcp@latest <フラグ>[ --db-path=<シェルに書くパス>]`
 *
 * @param flag フラグと、それに続ける値（例: `--bulk-download-qa --qa-topic=shohi`）
 * @param location DB の場所。省略すると MCP サーバーの場所（環境変数で決まる）
 */
export function guideCommand(flag: string, location: DbLocation = resolveDbLocation()): string {
  const command = bareCommand(flag);
  const g = location.guide;
  if (!g) return command;
  if (g.kind === 'flag') return `${command} ${g.name}=${shellPath(g.value)}`;
  return `${g.name}=${shellPath(g.value)} ${command}`;
}

/**
 * DB の場所の設定を付けないコマンド `npx -y @shuji-bonji/houki-nta-mcp@latest <フラグ>`。
 * SPEC-NTA-DB-SCHEMA-029 の「投入したシェルで … --status を実行し」のように、MCP サーバーの設定ではなく
 * 利用者のシェルの設定で DB を開くコマンドに使う（SPEC-NTA-DB-SCHEMA-027 の「この形にしない」箇所）
 */
export function bareCommand(flag: string): string {
  return `npx -y ${PACKAGE_INFO.name}@latest ${flag}`;
}
