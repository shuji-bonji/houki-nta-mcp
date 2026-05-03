/**
 * CLI mode — `houki-nta-mcp --bulk-download` 等の対話的サブコマンド
 *
 * 使い方:
 *   houki-nta-mcp                              # MCP サーバ起動（既定）
 *   houki-nta-mcp --bulk-download              # 消基通を bulk DL（5〜10 分）
 *   houki-nta-mcp --bulk-download --tsutatsu=消基通
 *   houki-nta-mcp --db-path=/path/to/cache.db --bulk-download
 *   houki-nta-mcp --version
 *   houki-nta-mcp --help
 *
 * 注意: MCP サーバ起動モードでは stdio プロトコルを使うため `console.log` 禁止。
 *       CLI モードでは stdout に出力して OK。
 */

import { closeDb, defaultDbPath, openDb } from './db/index.js';
import { bulkDownloadTsutatsu } from './services/bulk-downloader.js';
import { bulkDownloadKaisei, KAISEI_INDEX_URLS } from './services/kaisei-bulk-downloader.js';
import { bulkDownloadJimuUnei } from './services/jimu-unei-bulk-downloader.js';
import { bulkDownloadBunshokaitou } from './services/bunshokaitou-bulk-downloader.js';
import { findStaleSections } from './services/db-search.js';
import { PACKAGE_INFO } from './config.js';
import { TSUTATSU_URL_ROOTS } from './constants.js';

interface CliArgs {
  bulkDownload: boolean;
  /** すべての登録通達を順次 bulk DL する */
  bulkDownloadAll: boolean;
  /** Phase 3b: 改正通達 bulk DL */
  bulkDownloadKaisei: boolean;
  /** Phase 3b alpha.2: 事務運営指針 bulk DL */
  bulkDownloadJimuUnei: boolean;
  /** Phase 3b alpha.3: 文書回答事例 bulk DL */
  bulkDownloadBunshokaitou: boolean;
  /** --bunsho-taxonomy=<csv> 文書回答事例 bulk DL の税目絞り込み */
  bunshoTaxonomies: string[] | undefined;
  /** v0.4.0: 通達本体 + 改正通達 + 事務運営指針 + 文書回答事例 を一括 bulk DL */
  bulkDownloadEverything: boolean;
  /** N 日より古い section を列挙（dry-run）。`--refresh-stale=<days>` */
  staleDays: number | undefined;
  /** stale section を実際に再 DL する（要 --refresh-stale） */
  refreshStale: boolean;
  tsutatsu: string;
  dbPath: string | undefined;
  refresh: boolean;
  help: boolean;
  version: boolean;
}

/** argv をパース（process.argv.slice(2) を渡す前提） */
export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    bulkDownload: false,
    bulkDownloadAll: false,
    bulkDownloadKaisei: false,
    bulkDownloadJimuUnei: false,
    bulkDownloadBunshokaitou: false,
    bunshoTaxonomies: undefined,
    bulkDownloadEverything: false,
    staleDays: undefined,
    refreshStale: false,
    tsutatsu: '消費税法基本通達',
    dbPath: undefined,
    refresh: false,
    help: false,
    version: false,
  };
  for (const a of argv) {
    if (a === '--bulk-download-everything') args.bulkDownloadEverything = true;
    else if (a === '--bulk-download-kaisei') args.bulkDownloadKaisei = true;
    else if (a === '--bulk-download-jimu-unei') args.bulkDownloadJimuUnei = true;
    else if (a === '--bulk-download-bunshokaitou') args.bulkDownloadBunshokaitou = true;
    else if (a.startsWith('--bunsho-taxonomy=')) {
      const csv = a.slice('--bunsho-taxonomy='.length);
      args.bunshoTaxonomies = csv
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (a === '--bulk-download-all') args.bulkDownloadAll = true;
    else if (a === '--bulk-download') args.bulkDownload = true;
    else if (a === '--refresh') args.refresh = true;
    else if (a === '--apply') args.refreshStale = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--version' || a === '-v') args.version = true;
    else if (a.startsWith('--tsutatsu=')) args.tsutatsu = a.slice('--tsutatsu='.length);
    else if (a.startsWith('--db-path=')) args.dbPath = a.slice('--db-path='.length);
    else if (a.startsWith('--refresh-stale=')) {
      const v = parseInt(a.slice('--refresh-stale='.length), 10);
      if (Number.isFinite(v) && v >= 0) args.staleDays = v;
    }
  }
  return args;
}

const HELP_TEXT = `${PACKAGE_INFO.name} v${PACKAGE_INFO.version}

使い方:
  houki-nta-mcp                              MCP サーバを起動（既定）
  houki-nta-mcp --bulk-download-everything   通達本体 + 改正通達 + 事務運営指針 + 文書回答事例 を一括投入（推奨、約 50 分 / --bunsho-taxonomy で短縮可）
  houki-nta-mcp --bulk-download              特定通達を bulk DL してローカル DB に投入
  houki-nta-mcp --bulk-download-all          登録済み通達を全て順次 bulk DL（消基通/所基通/法基通/相基通）
  houki-nta-mcp --bulk-download-kaisei       4 通達分の改正通達一覧を順次 bulk DL（document テーブルへ投入）
  houki-nta-mcp --bulk-download-jimu-unei    事務運営指針（jimu-unei）一覧を bulk DL（document テーブルへ投入）
  houki-nta-mcp --bulk-download-bunshokaitou 文書回答事例（bunshokaitou）を bulk DL（全税目で 30 分超のため、--bunsho-taxonomy=shotoku,hojin で絞り込み推奨）
  houki-nta-mcp --refresh-stale=<日数>     N 日以上古い section を列挙（dry-run）
  houki-nta-mcp --refresh-stale=<日数> --apply  N 日以上古い section の通達を実際に再 DL
  houki-nta-mcp --version                  バージョンを表示
  houki-nta-mcp --help                     このメッセージを表示

オプション:
  --tsutatsu=<formal名>   --bulk-download 用。bulk DL する通達の正式名（既定: 消費税法基本通達）
  --db-path=<path>        DB ファイルパスを上書き（既定: \${XDG_CACHE_HOME:-~/.cache}/houki-nta-mcp/cache.db）
  --refresh               既存 DB を消去して再 DL
  --apply                 --refresh-stale と組み合わせて実際の再 DL を実行

環境変数:
  HOUKI_NTA_DB_PATH   DB ファイルパス（--db-path と同等）
  XDG_CACHE_HOME      デフォルト DB の親ディレクトリ
`;

/**
 * CLI モードのメイン関数。
 *
 * @returns CLI モードで処理した場合 true、MCP モードに進むべき場合 false
 */
export async function runCliIfRequested(argv: readonly string[]): Promise<boolean> {
  const args = parseArgs(argv);

  if (args.help) {
    process.stdout.write(HELP_TEXT);
    return true;
  }
  if (args.version) {
    process.stdout.write(`${PACKAGE_INFO.version}\n`);
    return true;
  }
  if (args.bulkDownloadEverything) {
    await runBulkDownloadEverything(args);
    return true;
  }
  if (args.bulkDownloadKaisei) {
    await runBulkDownloadKaisei(args);
    return true;
  }
  if (args.bulkDownloadJimuUnei) {
    await runBulkDownloadJimuUnei(args);
    return true;
  }
  if (args.bulkDownloadBunshokaitou) {
    await runBulkDownloadBunshokaitou(args);
    return true;
  }
  if (args.staleDays !== undefined) {
    await runRefreshStale(args, args.staleDays);
    return true;
  }
  if (args.bulkDownloadAll) {
    await runBulkDownloadAll(args);
    return true;
  }
  if (args.bulkDownload) {
    await runBulkDownload(args);
    return true;
  }
  return false;
}

/**
 * v0.4.0: すべての種別を一括 bulk DL（通達本体 → 改正通達 → 事務運営指針 → 文書回答事例）。
 *
 * 所要時間の目安:
 *   - 通達本体 4 通達: 計 10-15 分
 *   - 改正通達: 約 5-10 分
 *   - 事務運営指針: 約 1 分
 *   - 文書回答事例: 約 30 分超（`--bunsho-taxonomy` で絞り込み推奨）
 *   合計: 約 50 分（絞り込まない場合）
 */
async function runBulkDownloadEverything(args: CliArgs): Promise<void> {
  const dbPath = args.dbPath ?? defaultDbPath();
  process.stderr.write(`[bulk-download-everything] DB: ${dbPath}\n`);
  process.stderr.write(
    `[bulk-download-everything] 順次実行: 通達本体 → 改正通達 → 事務運営指針 → 文書回答事例\n`
  );
  if (args.bunshoTaxonomies?.length) {
    process.stderr.write(
      `[bulk-download-everything] bunshokaitou は ${args.bunshoTaxonomies.join(', ')} に絞り込み\n`
    );
  } else {
    process.stderr.write(
      `[bulk-download-everything] bunshokaitou は全税目（30 分超）。短時間で済ませたい場合は --bunsho-taxonomy=shotoku 等で絞り込んでください\n`
    );
  }

  // 4 種別を順番に実行（fail-soft、各種別が失敗しても次に進む）
  process.stderr.write('\n[bulk-download-everything] (1/4) ===== 通達本体 =====\n');
  try {
    await runBulkDownloadAll(args);
  } catch (err) {
    process.stderr.write(
      `[bulk-download-everything] (1/4) 通達本体 失敗: ${err instanceof Error ? err.message : String(err)}\n`
    );
  }

  process.stderr.write('\n[bulk-download-everything] (2/4) ===== 改正通達 =====\n');
  try {
    await runBulkDownloadKaisei(args);
  } catch (err) {
    process.stderr.write(
      `[bulk-download-everything] (2/4) 改正通達 失敗: ${err instanceof Error ? err.message : String(err)}\n`
    );
  }

  process.stderr.write('\n[bulk-download-everything] (3/4) ===== 事務運営指針 =====\n');
  try {
    await runBulkDownloadJimuUnei(args);
  } catch (err) {
    process.stderr.write(
      `[bulk-download-everything] (3/4) 事務運営指針 失敗: ${err instanceof Error ? err.message : String(err)}\n`
    );
  }

  process.stderr.write('\n[bulk-download-everything] (4/4) ===== 文書回答事例 =====\n');
  try {
    await runBulkDownloadBunshokaitou(args);
  } catch (err) {
    process.stderr.write(
      `[bulk-download-everything] (4/4) 文書回答事例 失敗: ${err instanceof Error ? err.message : String(err)}\n`
    );
  }

  process.stderr.write('\n[bulk-download-everything] 全 4 種別の処理を完了しました\n');
}

/**
 * Phase 3b alpha.3: 文書回答事例を 3 階層 (メイン索引 → 税目別 → 個別) で bulk DL する。
 */
async function runBulkDownloadBunshokaitou(args: CliArgs): Promise<void> {
  const dbPath = args.dbPath ?? defaultDbPath();
  process.stderr.write(`[bulk-download-bunshokaitou] DB: ${dbPath}\n`);
  if (args.bunshoTaxonomies?.length) {
    process.stderr.write(
      `[bulk-download-bunshokaitou] taxonomies 絞り込み: ${args.bunshoTaxonomies.join(', ')}\n`
    );
  }
  const db = openDb(dbPath);
  try {
    const result = await bulkDownloadBunshokaitou(db, {
      taxonomies: args.bunshoTaxonomies,
      onProgress: (p) => {
        if (p.current && p.total) {
          process.stderr.write(`  ${p.message}\n`);
        } else {
          process.stderr.write(`[${p.phase}] ${p.message}\n`);
        }
      },
    });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } finally {
    closeDb(db);
  }
}

/**
 * Phase 3b alpha.2: 事務運営指針索引から個別ページを順次 bulk DL する。
 */
async function runBulkDownloadJimuUnei(args: CliArgs): Promise<void> {
  const dbPath = args.dbPath ?? defaultDbPath();
  process.stderr.write(`[bulk-download-jimu-unei] DB: ${dbPath}\n`);
  const db = openDb(dbPath);
  try {
    const result = await bulkDownloadJimuUnei(db, {
      onProgress: (p) => {
        if (p.current && p.total) {
          process.stderr.write(`  ${p.message}\n`);
        } else {
          process.stderr.write(`[${p.phase}] ${p.message}\n`);
        }
      },
    });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } finally {
    closeDb(db);
  }
}

/**
 * Phase 3b: 4 通達分の改正通達索引を順次 bulk DL する。
 * 1 通達が失敗しても次に進む（fail-soft）。
 */
async function runBulkDownloadKaisei(args: CliArgs): Promise<void> {
  const dbPath = args.dbPath ?? defaultDbPath();
  const targets = Object.entries(KAISEI_INDEX_URLS);
  process.stderr.write(`[bulk-download-kaisei] DB: ${dbPath}\n`);
  process.stderr.write(
    `[bulk-download-kaisei] targets (${targets.length}): ${targets.map(([n]) => n).join(' / ')}\n`
  );

  const db = openDb(dbPath);
  const summary: Array<{ formalName: string; status: 'ok' | 'error'; detail: string }> = [];
  try {
    for (const [formalName, indexUrl] of targets) {
      process.stderr.write(`\n[bulk-download-kaisei] ===== ${formalName} =====\n`);
      try {
        const result = await bulkDownloadKaisei(db, {
          indexUrl,
          onProgress: (p) => {
            if (p.current && p.total) {
              process.stderr.write(`  ${p.message}\n`);
            } else {
              process.stderr.write(`[${p.phase}] ${p.message}\n`);
            }
          },
        });
        summary.push({
          formalName,
          status: 'ok',
          detail: `${result.documentsFetched}/${result.totalEntries} docs, ${(result.durationMs / 1000).toFixed(1)}s`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[bulk-download-kaisei] ${formalName} 失敗: ${msg}\n`);
        summary.push({ formalName, status: 'error', detail: msg });
      }
    }
    process.stderr.write(`\n[bulk-download-kaisei] ===== サマリ =====\n`);
    for (const s of summary) {
      const mark = s.status === 'ok' ? '✓' : '✗';
      process.stderr.write(`  ${mark} ${s.formalName}: ${s.detail}\n`);
    }
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  } finally {
    closeDb(db);
  }
}

/**
 * fetched_at が `staleDays` 日より古い section を列挙し、`--apply` 指定時は
 * 該当通達を再 bulk DL する（個別 section だけの再 DL ではなく、その通達全体）。
 *
 * dry-run 時は何が古いかを JSON で stdout に出すのみで DB は変更しない。
 */
async function runRefreshStale(args: CliArgs, staleDays: number): Promise<void> {
  const dbPath = args.dbPath ?? defaultDbPath();
  process.stderr.write(`[refresh-stale] DB: ${dbPath} (${staleDays} 日以上古い section を対象)\n`);

  const db = openDb(dbPath);
  try {
    const stale = findStaleSections(db, staleDays);
    process.stderr.write(`[refresh-stale] 該当: ${stale.length} sections\n`);

    if (!args.refreshStale) {
      // dry-run: 一覧 JSON を返すだけ
      process.stdout.write(JSON.stringify(stale, null, 2) + '\n');
      process.stderr.write(`[refresh-stale] dry-run（--apply で再 DL を実行）\n`);
      return;
    }

    // --apply 指定時: 該当通達を再 bulk DL（重複排除）
    const formalNames = Array.from(new Set(stale.map((s) => s.formalName)));
    process.stderr.write(`[refresh-stale] 再 DL 対象通達: ${formalNames.join(' / ')}\n`);
    const summary: Array<{ formalName: string; status: 'ok' | 'error'; detail: string }> = [];
    for (const formalName of formalNames) {
      try {
        const result = await bulkDownloadTsutatsu(db, {
          formalName,
          abbr: deriveAbbr(formalName),
          onProgress: (p) => {
            if (p.current && p.total) {
              process.stderr.write(`  ${p.message}\n`);
            } else {
              process.stderr.write(`[${p.phase}] ${p.message}\n`);
            }
          },
        });
        summary.push({
          formalName,
          status: 'ok',
          detail: `${result.sectionsFetched}/${result.sections} 節, ${result.clauses} clauses, ${(result.durationMs / 1000).toFixed(1)}s`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        summary.push({ formalName, status: 'error', detail: msg });
      }
    }
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  } finally {
    closeDb(db);
  }
}

/**
 * すべての登録済み通達を順次 bulk DL する。
 * 1 通達が失敗しても次に進む（fail-soft）。最後に通達ごとのサマリを出力。
 */
async function runBulkDownloadAll(args: CliArgs): Promise<void> {
  const dbPath = args.dbPath ?? defaultDbPath();
  const targets = Object.keys(TSUTATSU_URL_ROOTS);
  process.stderr.write(`[bulk-download-all] DB: ${dbPath}\n`);
  process.stderr.write(`[bulk-download-all] targets (${targets.length}): ${targets.join(' / ')}\n`);

  const db = openDb(dbPath);
  const summary: Array<{ formalName: string; status: 'ok' | 'error'; detail: string }> = [];
  try {
    for (const formalName of targets) {
      process.stderr.write(`\n[bulk-download-all] ===== ${formalName} =====\n`);
      try {
        const result = await bulkDownloadTsutatsu(db, {
          formalName,
          abbr: deriveAbbr(formalName),
          onProgress: (p) => {
            if (p.current && p.total) {
              process.stderr.write(`  ${p.message}\n`);
            } else {
              process.stderr.write(`[${p.phase}] ${p.message}\n`);
            }
          },
        });
        summary.push({
          formalName,
          status: 'ok',
          detail: `${result.sectionsFetched}/${result.sections} 節, ${result.clauses} clauses, ${(result.durationMs / 1000).toFixed(1)}s`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[bulk-download-all] ${formalName} 失敗: ${msg}\n`);
        summary.push({ formalName, status: 'error', detail: msg });
      }
    }

    process.stderr.write(`\n[bulk-download-all] ===== サマリ =====\n`);
    for (const s of summary) {
      const mark = s.status === 'ok' ? '✓' : '✗';
      process.stderr.write(`  ${mark} ${s.formalName}: ${s.detail}\n`);
    }
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  } finally {
    closeDb(db);
  }
}

async function runBulkDownload(args: CliArgs): Promise<void> {
  const dbPath = args.dbPath ?? defaultDbPath();
  process.stderr.write(`[bulk-download] DB: ${dbPath}\n`);
  process.stderr.write(`[bulk-download] target: ${args.tsutatsu}\n`);

  const db = openDb(dbPath);
  try {
    const result = await bulkDownloadTsutatsu(db, {
      formalName: args.tsutatsu,
      abbr: deriveAbbr(args.tsutatsu),
      onProgress: (p) => {
        if (p.current && p.total) {
          process.stderr.write(`  ${p.message}\n`);
        } else {
          process.stderr.write(`[${p.phase}] ${p.message}\n`);
        }
      },
    });

    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } finally {
    closeDb(db);
  }
}

/** formal_name → 略称 の簡易マッピング（DB 記録用、houki-abbreviations 経由でも引けるが軽量化） */
function deriveAbbr(formalName: string): string {
  const map: Record<string, string> = {
    消費税法基本通達: '消基通',
    所得税基本通達: '所基通',
    法人税基本通達: '法基通',
    相続税法基本通達: '相基通',
    国税通則法基本通達: '通基通',
    国税徴収法基本通達: '徴基通',
    租税特別措置法関係通達: '措通',
    印紙税法基本通達: '印基通',
  };
  return map[formalName] ?? formalName;
}
