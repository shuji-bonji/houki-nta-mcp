/**
 * CLI `--status`（v0.25.0、houki-nta-mcp #138、cli_status の spec.md）。
 *
 * DB の場所と、それを決めた設定、同じフォルダーの別の DB、DB の版と種別ごとの件数を標準出力に出す。
 * DB を作らず、移行もせず、書き込まない（SPEC-NTA-CLI-STATUS-008。読み取り専用で開く）。
 * 行の形は houki-egov-mcp の `--status`（SPEC-EGOV-CLI-STATUS-013・014）に合わせ、件数の行は nta の DB の中身に合わせる。
 */

import { readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';

import { PACKAGE_INFO } from './config.js';
import {
  type DbLocation,
  type DbLocationSetting,
  guideCommand,
  probeDbState,
  SCHEMA_VERSION,
} from './db/index.js';

/** 件数を出す文書の種別と、その順（SPEC-NTA-CLI-STATUS-003 の 3〜7 行目） */
const STATUS_DOC_TYPES = ['qa-jirei', 'tax-answer', 'kaisei', 'jimu-unei', 'bunshokaitou'] as const;

/** `--status` の 3 行目の値（SPEC-NTA-CLI-STATUS-001） */
function settingLine(setting: DbLocationSetting): string {
  switch (setting) {
    case '--db-path':
      return '--db-path（MCP サーバーは --db-path を受け取りません。MCP サーバーが開く DB は HOUKI_NTA_DB_PATH・XDG_CACHE_HOME・既定のどれかで決まります）';
    case 'HOUKI_NTA_DB_PATH':
    case 'XDG_CACHE_HOME':
      return `${setting}（MCP クライアントから起動したサーバーは、シェルの環境変数を受け継がないことがあります）`;
    default:
      return setting;
  }
}

/** ファイルの大きさ（SPEC-NTA-CLI-STATUS-002。1 KB = 1,024 バイト） */
export function formatFileSize(bytes: number): string {
  const KB = 1024;
  const MB = KB * 1024;
  const GB = MB * 1024;
  if (bytes < KB) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / KB).toFixed(1)} KB`;
  if (bytes < GB) return `${(bytes / MB).toFixed(1)} MB`;
  return `${(bytes / GB).toFixed(2)} GB`;
}

/** 実行した環境の時刻の YYYY-MM-DD HH:MM（SPEC-NTA-CLI-STATUS-002） */
function formatLocalMinute(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * DB と同じフォルダーにある、名前が cache で始まり .db で終わる普通のファイル（DB のファイルそのものを除く）の
 * [WARN] の行（SPEC-NTA-CLI-STATUS-002）。無ければ null。
 *
 * 見つけたファイルは開かない（版を読まない）。フォルダーが無い・読めないとき、`:memory:` のときは null
 */
export function otherDbFilesWarning(dbAbsolutePath: string): string | null {
  if (dbAbsolutePath === ':memory:') return null;
  const dir = dirname(dbAbsolutePath);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  const found: string[] = [];
  for (const name of [...names].sort()) {
    if (!name.startsWith('cache') || !name.endsWith('.db')) continue;
    const path = join(dir, name);
    if (path === dbAbsolutePath) continue;
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(path);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    found.push(`${name} (${formatFileSize(st.size)}, ${formatLocalMinute(st.mtime)})`);
  }
  if (found.length === 0) return null;
  return `[WARN] 同じフォルダーに、この DB のほかに cache*.db のファイルがあります: ${found.join(', ')}。MCP サーバーと CLI が別のファイルを開いていないか確かめてください`;
}

/** 取得日時の範囲（DB の文字列のまま。日付として読まない） */
function rangeText(range: { oldest: string | null; newest: string | null }): string | null {
  if (range.oldest === null || range.newest === null) return null;
  return `fetched_at: ${range.oldest} 〜 ${range.newest}`;
}

/** 版 12 の DB の件数の 7 行（SPEC-NTA-CLI-STATUS-003） */
function countLines(path: string): string[] {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const tsutatsu = db
      .prepare('SELECT COUNT(DISTINCT tsutatsu_id) AS n, COUNT(*) AS clauses FROM clause')
      .get() as { n: number; clauses: number };
    const sectionRange = db
      .prepare('SELECT MIN(fetched_at) AS oldest, MAX(fetched_at) AS newest FROM section')
      .get() as { oldest: string | null; newest: string | null };
    const sectionText = rangeText(sectionRange);
    const lines = [
      `  schema_version: ${SCHEMA_VERSION}`,
      `  tsutatsu: ${tsutatsu.n} (clause: ${tsutatsu.clauses}${sectionText ? `, ${sectionText}` : ''})`,
    ];
    const countStmt = db.prepare(
      `SELECT COUNT(*) AS n, SUM(CASE WHEN orphaned_at IS NOT NULL THEN 1 ELSE 0 END) AS orphaned
       FROM document WHERE doc_type = ?`
    );
    const rangeStmt = db.prepare(
      `SELECT MIN(fetched_at) AS oldest, MAX(fetched_at) AS newest
       FROM document WHERE doc_type = ? AND orphaned_at IS NULL`
    );
    for (const docType of STATUS_DOC_TYPES) {
      const c = countStmt.get(docType) as { n: number; orphaned: number | null };
      const parts: string[] = [];
      if ((c.orphaned ?? 0) > 0) parts.push(`国税庁の索引から消えた: ${c.orphaned}`);
      const r = rangeText(
        rangeStmt.get(docType) as { oldest: string | null; newest: string | null }
      );
      if (r) parts.push(r);
      lines.push(`  ${docType}: ${c.n}${parts.length > 0 ? ` (${parts.join(', ')})` : ''}`);
    }
    return lines;
  } finally {
    db.close();
  }
}

/**
 * `--status` を実行する。標準出力・標準エラー出力に書き、終了コードを返す（0 か 1）。
 *
 * @param formatDbEntryError SPEC-NTA-DB-SCHEMA-021 の CLI のエラーの文（cli.ts の関数を渡す）
 */
export function runStatus(
  location: DbLocation,
  formatDbEntryError: (state: ReturnType<typeof probeDbState>, location: DbLocation) => string
): number {
  const out = (line: string) => process.stdout.write(`${line}\n`);
  out(`[status] ${PACKAGE_INFO.name} v${PACKAGE_INFO.version}`);
  out(`  DB: ${location.path}`);
  out(`  DB の場所の設定: ${settingLine(location.setting)}`);
  // 同じフォルダーの別の DB は、DB の状態によらず 3 行目の次に出す（SPEC-NTA-CLI-STATUS-002）
  const others = otherDbFilesWarning(location.absolutePath);
  if (others) out(others);

  // 読み取り専用で状態を調べる。DB を作らず、移行もしない（SPEC-NTA-CLI-STATUS-008）
  const state = probeDbState(location.path);
  const quickstart = guideCommand('--quickstart', location);
  switch (state.kind) {
    case 'missing':
    case 'memory':
      // `:memory:` は何も入っていない一時的な DB なので、ファイルが無いときと同じに扱う
      out(`  (DB がまだありません — ${quickstart} などの投入のフラグで作ります)`);
      return 0;
    case 'unversioned':
      out(
        `  (DB のファイルはありますが、まだ何も投入されていません — ${quickstart} などの投入のフラグで、このファイルに投入します)`
      );
      return 0;
    case 'migratable':
      out(`  schema_version: ${state.version}`);
      out(
        `  (この版の DB は、次に投入のフラグかツールで開いたときに、行を保ったまま ${SCHEMA_VERSION} に移行します。--status は移行しないので、件数は出しません)`
      );
      return 0;
    case 'current': {
      let lines: string[];
      try {
        lines = countLines(location.path);
      } catch (err) {
        process.stderr.write(
          `${formatDbEntryError({ kind: 'unopenable', message: err instanceof Error ? err.message : String(err) }, location)}\n`
        );
        return 1;
      }
      for (const line of lines) out(line);
      return 0;
    }
    default:
      // 版 1・2・新しい・読めない・開けない（SPEC-NTA-CLI-STATUS-006・007）
      process.stderr.write(`${formatDbEntryError(state, location)}\n`);
      return 1;
  }
}
