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
import { PACKAGE_INFO } from './config.js';

interface CliArgs {
  bulkDownload: boolean;
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
    tsutatsu: '消費税法基本通達',
    dbPath: undefined,
    refresh: false,
    help: false,
    version: false,
  };
  for (const a of argv) {
    if (a === '--bulk-download') args.bulkDownload = true;
    else if (a === '--refresh') args.refresh = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--version' || a === '-v') args.version = true;
    else if (a.startsWith('--tsutatsu=')) args.tsutatsu = a.slice('--tsutatsu='.length);
    else if (a.startsWith('--db-path=')) args.dbPath = a.slice('--db-path='.length);
  }
  return args;
}

const HELP_TEXT = `${PACKAGE_INFO.name} v${PACKAGE_INFO.version}

使い方:
  houki-nta-mcp                       MCP サーバを起動（既定）
  houki-nta-mcp --bulk-download       通達を bulk DL してローカル DB に投入
  houki-nta-mcp --version             バージョンを表示
  houki-nta-mcp --help                このメッセージを表示

オプション:
  --tsutatsu=<formal名>   bulk DL する通達の正式名（既定: 消費税法基本通達）
  --db-path=<path>        DB ファイルパスを上書き（既定: \${XDG_CACHE_HOME:-~/.cache}/houki-nta-mcp/cache.db）
  --refresh               既存 DB を消去して再 DL

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
  if (args.bulkDownload) {
    await runBulkDownload(args);
    return true;
  }
  return false;
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
