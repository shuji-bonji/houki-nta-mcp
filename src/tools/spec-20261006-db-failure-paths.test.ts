/**
 * 差分 specs/changes/20261006-db-failure-paths/（PR #152、houki-nta-mcp #144）の受入テスト（MCP のツール）。
 *
 * - db_schema: SPEC-NTA-DB-SCHEMA-029・021（MODIFIED。開けない DB の読むだけのツールの応答）
 * - common_errors: SPEC-NTA-COMMON-ERRORS-006（MODIFIED。開けない DB は INTERNAL_ERROR にしない）
 * - 読むだけの 10 ツールの「DB に 1 件も無い」ときの応答（MODIFIED）:
 *   SPEC-NTA-SEARCH-TSUTATSU-003、SPEC-NTA-SEARCH-QA-001、SPEC-NTA-SEARCH-TAX-ANSWER-001、
 *   SPEC-NTA-SEARCH-KAISEI-TSUTATSU-001、SPEC-NTA-SEARCH-JIMU-UNEI-001、SPEC-NTA-SEARCH-BUNSHOKAITOU-001、
 *   SPEC-NTA-GET-KAISEI-TSUTATSU-001、SPEC-NTA-GET-JIMU-UNEI-001、SPEC-NTA-GET-BUNSHOKAITOU-002、
 *   SPEC-NTA-INSPECT-PDF-META-001
 * - 書き戻す 3 ツール: SPEC-NTA-DB-SCHEMA-030（ADDED）、SPEC-NTA-GET-TSUTATSU-007・010（MODIFIED）、
 *   SPEC-NTA-DB-SCHEMA-021 の書き戻すツールの列の開けない行
 *
 * 期待値は差分の spec.md の本文・表・「例:」から決めている。例のホームディレクトリ `/Users/bonji` は、一時ディレクトリの
 * 下のフォルダー（HOME）に置き換える。ツールには DB のパスを渡さず、MCP サーバーと同じく環境変数
 * （HOUKI_NTA_DB_PATH・XDG_CACHE_HOME・HOME）で DB の場所を決める。
 *
 * 開けない DB は 4 つ（SQLite でないファイル、フォルダー、パスの途中が普通のファイル、読む権限が無いファイル）。
 * 読む権限が無いファイル（chmod 000）は root では開けてしまうので、root で走るときは飛ばす。
 * フォルダーと読む権限が無いファイルの開けない理由の文は SQLite と OS が決める（仕様は固定しない）ので、
 * `--status` が `[ERROR] DB を開けません: ` の後に出す文と同じであることを確かめる。
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import Database from 'better-sqlite3';
import { encode as iconvEncode } from 'iconv-lite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TAX_ANSWER_INDEX_URL, withTaxAnswerIndex } from '../../tests/support/tax-answer-index.js';
import { runCliIfRequested } from '../cli.js';
import { createServer } from '../server.js';
import {
  getQa,
  getTaxAnswer,
  getTsutatsu,
  handleNtaGetBunshokaitou,
  handleNtaGetJimuUnei,
  handleNtaGetKaiseiTsutatsu,
  handleNtaInspectPdfMeta,
  handleNtaSearchBunshokaitou,
  handleNtaSearchJimuUnei,
  handleNtaSearchKaiseiTsutatsu,
  handleNtaSearchQa,
  handleNtaSearchTaxAnswer,
  searchTsutatsu,
} from './handlers.js';

/* -------------------------------------------------------------------------- */
/* 共通の準備                                                                  */
/* -------------------------------------------------------------------------- */

/** 案内のコマンドの本体（SPEC-NTA-DB-SCHEMA-027） */
const NPX = 'npx -y @shuji-bonji/houki-nta-mcp@latest';

/** root では chmod 000 のファイルも開けてしまう（proposal.md の「実装の変更」の受入テスト） */
const IS_ROOT = process.getuid?.() === 0;

interface Body {
  code?: string;
  error?: string;
  hint?: string;
  retryable?: boolean;
  detail?: { cause?: string };
  next_actions?: Array<{ action: string; example?: { command?: string } }>;
  results?: unknown[];
  tool?: string;
}

const ENV_KEYS = ['HOME', 'HOUKI_NTA_DB_PATH', 'XDG_CACHE_HOME'] as const;
let saved: Record<string, string | undefined>;
let dir: string;
/** テストのホームディレクトリ（例の `/Users/bonji` に当たる） */
let home: string;
/** 既定の DB の場所（`~/.cache/houki-nta-mcp/cache.db`） */
let defaultDb: string;
/** chmod 000 にしたファイル。afterEach で戻してから消す */
const lockedFiles: string[] = [];

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  dir = mkdtempSync(join(tmpdir(), 'houki-nta-db-failure-'));
  home = join(dir, 'home');
  mkdirSync(home);
  defaultDb = join(home, '.cache', 'houki-nta-mcp', 'cache.db');
  setEnv({ HOME: home, HOUKI_NTA_DB_PATH: undefined, XDG_CACHE_HOME: undefined });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  setEnv(saved);
  for (const p of lockedFiles.splice(0)) {
    if (existsSync(p)) chmodSync(p, 0o600);
  }
  rmSync(dir, { recursive: true, force: true });
});

function setEnv(vars: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

/** SPEC-NTA-DB-SCHEMA-029 の開けないときの hint */
function unopenableHint(path: string, statusCommand: string): string {
  return `ローカル DB（${path}）を開けません。パスがフォルダーを指していないか、途中に普通のファイルが無いか、読む権限があるか、SQLite の DB のファイルかを確かめてください（HOUKI_NTA_DB_PATH を設定しているときはその値を直します）。\`${statusCommand}\` を実行すると、開けない理由が出ます`;
}

/**
 * `--status` が `[ERROR] DB を開けません: ` の後に出す文（SPEC-NTA-CLI-STATUS-007）。
 * 今の環境変数で `--status` を実行し、文の中のホームディレクトリに `/` が続く部分を `~` にして返す（SPEC-NTA-DB-SCHEMA-029）
 */
async function statusCause(): Promise<string> {
  const chunks: string[] = [];
  const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    chunks.push(String(chunk));
    return true;
  });
  const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  try {
    await runCliIfRequested(['--status']);
  } finally {
    errSpy.mockRestore();
    outSpy.mockRestore();
    process.exitCode = undefined;
  }
  const prefix = '[ERROR] DB を開けません: ';
  const line = chunks
    .join('')
    .split('\n')
    .find((l) => l.startsWith(prefix));
  if (!line)
    throw new Error(
      `--status が [ERROR] DB を開けません の行を出しませんでした: ${chunks.join('')}`
    );
  return line.slice(prefix.length).replaceAll(`${home}/`, '~/');
}

/** 開けない DB の 1 つの場面 */
interface Unopenable {
  name: string;
  /** 作って、HOUKI_NTA_DB_PATH に入れるパスを返す */
  make: () => string;
  /** hint に出るパス（ホームディレクトリの部分は ~） */
  shown: string;
  /** HOUKI_NTA_DB_PATH を前に付けた `--status` の案内のコマンドの、変数の値（シェルに書くパス） */
  shellPath: string;
  /** detail.cause。仕様が固定しない場面は undefined（--status の文と比べる） */
  cause?: () => string;
  /** 呼ぶ前のファイルの状態を写し、呼んだ後に変わっていないことを確かめる関数を返す */
  snapshot: () => () => void;
  skip?: boolean;
}

/** ファイルの大きさと中身が変わっていないことを確かめる関数 */
function fileUnchanged(path: string): () => void {
  const before = readFileSync(path);
  const size = statSync(path).size;
  return () => {
    expect(statSync(path).size).toBe(size);
    expect(readFileSync(path).equals(before)).toBe(true);
  };
}

const UNOPENABLE: Unopenable[] = [
  {
    name: 'SQLite でない中身のファイル',
    make: () => {
      mkdirSync(dirname(defaultDb), { recursive: true });
      writeFileSync(defaultDb, 'これは SQLite のファイルではありません。'.repeat(100));
      return defaultDb;
    },
    shown: '~/.cache/houki-nta-mcp/cache.db',
    shellPath: '"$HOME/.cache/houki-nta-mcp/cache.db"',
    cause: () => 'file is not a database',
    snapshot: () => fileUnchanged(defaultDb),
  },
  {
    name: 'フォルダー',
    make: () => {
      mkdirSync(defaultDb, { recursive: true });
      return defaultDb;
    },
    shown: '~/.cache/houki-nta-mcp/cache.db',
    shellPath: '"$HOME/.cache/houki-nta-mcp/cache.db"',
    snapshot: () => () => {
      expect(statSync(defaultDb).isDirectory()).toBe(true);
      expect(readdirSync(defaultDb)).toEqual([]);
    },
  },
  {
    name: 'パスの途中が普通のファイル',
    make: () => {
      writeFileSync(join(home, 'plain'), 'x');
      return join(home, 'plain', 'cache.db');
    },
    shown: '~/plain/cache.db',
    shellPath: '"$HOME/plain/cache.db"',
    cause: () => 'ENOTDIR: パスの途中が普通のファイルです (~/plain)',
    snapshot: () => {
      const check = fileUnchanged(join(home, 'plain'));
      return () => {
        expect(statSync(join(home, 'plain')).isFile()).toBe(true);
        check();
      };
    },
  },
  {
    name: '読む権限が無いファイル（chmod 000）',
    make: () => {
      mkdirSync(dirname(defaultDb), { recursive: true });
      const db = new Database(defaultDb);
      db.exec('CREATE TABLE t(x)');
      db.close();
      chmodSync(defaultDb, 0o000);
      lockedFiles.push(defaultDb);
      return defaultDb;
    },
    shown: '~/.cache/houki-nta-mcp/cache.db',
    shellPath: '"$HOME/.cache/houki-nta-mcp/cache.db"',
    snapshot: () => {
      const size = statSync(defaultDb).size;
      return () => {
        expect(statSync(defaultDb).size).toBe(size);
        expect(statSync(defaultDb).mode & 0o777).toBe(0o000);
      };
    },
    skip: IS_ROOT,
  },
];

/** 読むだけのツールと、その「DB に 1 件も無い」ときの code と error（SPEC-NTA-DB-SCHEMA-029 の下の表と各ツールの ID） */
const READ_TOOLS: Array<{
  id: string;
  tool: string;
  code: string;
  /** error の文。各ツールの ID の本文の文。書かれていないものは undefined（DB のファイルが無いときと比べる） */
  error?: string;
  call: () => Promise<unknown>;
}> = [
  {
    id: 'SPEC-NTA-SEARCH-TSUTATSU-003',
    tool: 'nta_search_tsutatsu',
    code: 'TSUTATSU_NOT_FOUND',
    error: 'ローカル DB に検索対象がありません',
    call: () => searchTsutatsu({ keyword: '役員' }),
  },
  {
    id: 'SPEC-NTA-SEARCH-QA-001',
    tool: 'nta_search_qa',
    code: 'DOC_NOT_FOUND',
    error:
      'ローカル DB に質疑応答事例が 1 件も無いため、検索できません（「該当なし」という結果ではありません）',
    call: () => handleNtaSearchQa({ keyword: '社内会議' }),
  },
  {
    id: 'SPEC-NTA-SEARCH-TAX-ANSWER-001',
    tool: 'nta_search_tax_answer',
    code: 'DOC_NOT_FOUND',
    call: () => handleNtaSearchTaxAnswer({ keyword: '医療費控除' }),
  },
  {
    id: 'SPEC-NTA-SEARCH-KAISEI-TSUTATSU-001',
    tool: 'nta_search_kaisei_tsutatsu',
    code: 'DOC_NOT_FOUND',
    error:
      'ローカル DB に改正通達が 1 件も無いため、検索できません（「該当なし」という結果ではありません）',
    call: () => handleNtaSearchKaiseiTsutatsu({ keyword: '改正' }),
  },
  {
    id: 'SPEC-NTA-SEARCH-JIMU-UNEI-001',
    tool: 'nta_search_jimu_unei',
    code: 'DOC_NOT_FOUND',
    error:
      'ローカル DB に事務運営指針が 1 件も無いため、検索できません（「該当なし」という結果ではありません）',
    call: () => handleNtaSearchJimuUnei({ keyword: '書面添付' }),
  },
  {
    id: 'SPEC-NTA-SEARCH-BUNSHOKAITOU-001',
    tool: 'nta_search_bunshokaitou',
    code: 'DOC_NOT_FOUND',
    error:
      'ローカル DB に文書回答事例が 1 件も無いため、検索できません（「該当なし」という結果ではありません）',
    call: () => handleNtaSearchBunshokaitou({ keyword: '適格請求書' }),
  },
  {
    id: 'SPEC-NTA-GET-KAISEI-TSUTATSU-001',
    tool: 'nta_get_kaisei_tsutatsu',
    code: 'DOC_NOT_FOUND',
    error: 'ローカル DB に改正通達が 1 件も無いため、docId="0026003-067" を取得できません',
    call: () => handleNtaGetKaiseiTsutatsu({ docId: '0026003-067' }),
  },
  {
    id: 'SPEC-NTA-GET-JIMU-UNEI-001',
    tool: 'nta_get_jimu_unei',
    code: 'DOC_NOT_FOUND',
    error: 'ローカル DB に事務運営指針が 1 件も無いため、docId="shotoku/000101" を取得できません',
    call: () => handleNtaGetJimuUnei({ docId: 'shotoku/000101' }),
  },
  {
    id: 'SPEC-NTA-GET-BUNSHOKAITOU-002',
    tool: 'nta_get_bunshokaitou',
    code: 'DOC_NOT_FOUND',
    error: 'ローカル DB に文書回答事例が 1 件も無いため、docId="shotoku/250416" を取得できません',
    call: () => handleNtaGetBunshokaitou({ docId: 'shotoku/250416' }),
  },
  {
    id: 'SPEC-NTA-INSPECT-PDF-META-001',
    tool: 'nta_inspect_pdf_meta',
    code: 'DOC_NOT_FOUND',
    call: () => handleNtaInspectPdfMeta({ docType: 'qa-jirei', docId: 'shohi/02/19' }),
  },
];

/** DB のファイルが無いときの応答（error を比べるため。DB の場所の設定は今の環境変数のまま、別の無いパスにする） */
async function missingResponse(call: () => Promise<unknown>): Promise<Body> {
  const current = process.env.HOUKI_NTA_DB_PATH;
  setEnv({ HOUKI_NTA_DB_PATH: join(dir, 'none', 'cache.db') });
  try {
    return (await call()) as Body;
  } finally {
    setEnv({ HOUKI_NTA_DB_PATH: current });
  }
}

/** 開けない DB を HOUKI_NTA_DB_PATH で指し、ツールの応答が SPEC-NTA-DB-SCHEMA-029 の開けないときの応答であることを確かめる */
async function expectUnopenableResponse(
  t: (typeof READ_TOOLS)[number],
  c: Unopenable
): Promise<Body> {
  const path = c.make();
  setEnv({ HOUKI_NTA_DB_PATH: path });
  const unchanged = c.snapshot();
  const body = (await t.call()) as Body;
  expect(body.code).toBe(t.code);
  expect(body.hint).toBe(
    unopenableHint(c.shown, `HOUKI_NTA_DB_PATH=${c.shellPath} ${NPX} --status`)
  );
  expect(body.retryable).toBe(false);
  expect(body.next_actions).toBeUndefined();
  expect(body.results).toBeUndefined();
  expect(body.tool).toBe(t.tool);
  const cause = c.cause ? c.cause() : await statusCause();
  expect(body.detail?.cause).toBe(cause);
  // hint には開けない理由の文を入れない
  expect(body.hint).not.toContain(cause);
  unchanged();
  return body;
}

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-DB-SCHEMA-029                                                     */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-DB-SCHEMA-029 読むだけのツールの「DB に 1 件も無い」ときの hint は、DB の状態ごとに先頭の文を決め、開こうとしたパスを入れる（開けない DB）', () => {
  for (const t of READ_TOOLS) {
    for (const c of UNOPENABLE) {
      it.skipIf(c.skip)(
        `SPEC-NTA-DB-SCHEMA-029 ${t.tool}: ${c.name}を HOUKI_NTA_DB_PATH で指すと、${t.code}・開けないときの hint・retryable: false・detail.cause で、next_actions は無く、ファイルは変わらない`,
        async () => {
          await expectUnopenableResponse(t, c);
        }
      );
    }
  }

  it('SPEC-NTA-DB-SCHEMA-029 例: HOUKI_NTA_DB_PATH=~/.cache/houki-nta-mcp/cache.db が SQLite でない中身のとき、nta_search_qa は DOC_NOT_FOUND・retryable: false・detail.cause は file is not a database、hint の --status のコマンドは変数付き', async () => {
    mkdirSync(dirname(defaultDb), { recursive: true });
    writeFileSync(defaultDb, 'これは SQLite のファイルではありません。'.repeat(100));
    setEnv({ HOUKI_NTA_DB_PATH: defaultDb });
    const before = readFileSync(defaultDb);
    const body = (await handleNtaSearchQa({ keyword: '社内会議' })) as Body;
    expect(body.code).toBe('DOC_NOT_FOUND');
    expect(body.retryable).toBe(false);
    expect(body.hint).toBe(
      `ローカル DB（~/.cache/houki-nta-mcp/cache.db）を開けません。パスがフォルダーを指していないか、途中に普通のファイルが無いか、読む権限があるか、SQLite の DB のファイルかを確かめてください（HOUKI_NTA_DB_PATH を設定しているときはその値を直します）。\`HOUKI_NTA_DB_PATH="$HOME/.cache/houki-nta-mcp/cache.db" ${NPX} --status\` を実行すると、開けない理由が出ます`
    );
    expect(body.detail?.cause).toBe('file is not a database');
    expect(body.next_actions).toBeUndefined();
    expect(readFileSync(defaultDb).equals(before)).toBe(true);
  });

  it('SPEC-NTA-DB-SCHEMA-029 例: 環境変数を付けずに起動し、~/.cache/houki-nta-mcp/cache.db がフォルダーのとき、nta_search_tsutatsu は TSUTATSU_NOT_FOUND・retryable: false で、--status のコマンドに何も付けない', async () => {
    mkdirSync(defaultDb, { recursive: true });
    const body = (await searchTsutatsu({ keyword: '役員' })) as Body;
    expect(body.code).toBe('TSUTATSU_NOT_FOUND');
    expect(body.retryable).toBe(false);
    expect(body.hint).toBe(unopenableHint('~/.cache/houki-nta-mcp/cache.db', `${NPX} --status`));
    expect(body.next_actions).toBeUndefined();
    expect(body.detail?.cause).toBe(await statusCause());
  });

  it('SPEC-NTA-DB-SCHEMA-029 例: HOUKI_NTA_DB_PATH=~/plain/cache.db（~/plain は普通のファイル）で nta_get_jimu_unei を呼ぶと、detail.cause は ENOTDIR: パスの途中が普通のファイルです (~/plain) で、フォルダーの plain は作られない', async () => {
    writeFileSync(join(home, 'plain'), '');
    setEnv({ HOUKI_NTA_DB_PATH: join(home, 'plain', 'cache.db') });
    const body = (await handleNtaGetJimuUnei({ docId: 'shotoku/000101' })) as Body;
    expect(body.code).toBe('DOC_NOT_FOUND');
    expect(body.retryable).toBe(false);
    expect(body.detail?.cause).toBe('ENOTDIR: パスの途中が普通のファイルです (~/plain)');
    expect(statSync(join(home, 'plain')).isFile()).toBe(true);
    expect(statSync(join(home, 'plain')).size).toBe(0);
  });

  it("SPEC-NTA-DB-SCHEMA-029 detail.cause のパスがホームディレクトリの下でないときは ~ にしない（hint の --status のコマンドは '…' で囲む）", async () => {
    writeFileSync(join(dir, 'plain'), '');
    const path = join(dir, 'plain', 'cache.db');
    setEnv({ HOUKI_NTA_DB_PATH: path });
    const body = (await handleNtaSearchQa({ keyword: '社内会議' })) as Body;
    expect(body.detail?.cause).toBe(
      `ENOTDIR: パスの途中が普通のファイルです (${join(dir, 'plain')})`
    );
    expect(body.hint).toBe(unopenableHint(path, `HOUKI_NTA_DB_PATH='${path}' ${NPX} --status`));
  });

  it('SPEC-NTA-DB-SCHEMA-029 ホームディレクトリの名前で始まるだけのフォルダー（/ が続かない）は ~ にしない', async () => {
    const sibling = `${home}2`;
    mkdirSync(sibling);
    writeFileSync(join(sibling, 'plain'), '');
    setEnv({ HOUKI_NTA_DB_PATH: join(sibling, 'plain', 'cache.db') });
    const body = (await handleNtaSearchQa({ keyword: '社内会議' })) as Body;
    expect(body.detail?.cause).toBe(
      `ENOTDIR: パスの途中が普通のファイルです (${join(sibling, 'plain')})`
    );
  });

  it('SPEC-NTA-DB-SCHEMA-029 XDG_CACHE_HOME で決めた DB を開けないときは、--status のコマンドの前に XDG_CACHE_HOME を付ける', async () => {
    const caches = join(home, 'Library', 'Caches');
    setEnv({ XDG_CACHE_HOME: caches });
    mkdirSync(join(caches, 'houki-nta-mcp', 'cache.db'), { recursive: true });
    const body = (await handleNtaSearchJimuUnei({ keyword: '書面添付' })) as Body;
    expect(body.hint).toBe(
      unopenableHint(
        '~/Library/Caches/houki-nta-mcp/cache.db',
        `XDG_CACHE_HOME="$HOME/Library/Caches" ${NPX} --status`
      )
    );
  });

  it('SPEC-NTA-DB-SCHEMA-029 ほかの状態（ファイルが無い）の応答には、今までどおり retryable も detail も付けない', async () => {
    const body = (await handleNtaSearchQa({ keyword: '社内会議' })) as Body;
    expect(body.code).toBe('DOC_NOT_FOUND');
    expect(body.retryable).toBeUndefined();
    expect(body.detail).toBeUndefined();
    expect(body.next_actions?.map((a) => a.action)).toEqual(['cli_bulk_download']);
  });
});

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-DB-SCHEMA-021                                                     */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-DB-SCHEMA-021 DB の状態と入口ごとの扱い（開けない DB の読むだけのツール）', () => {
  it('SPEC-NTA-DB-SCHEMA-021 開けない行の読むだけのツール: 書き込まない。注 1 の応答で、hint は 029 の開けないときの文、retryable: false と detail.cause を付け、next_actions に投入の案内を入れない', async () => {
    const body = await expectUnopenableResponse(READ_TOOLS[2], UNOPENABLE[0]);
    expect(body.code).toBe('DOC_NOT_FOUND');
  });

  it('SPEC-NTA-DB-SCHEMA-021 開けない DB の注 1 の応答の code と error は、DB のファイルが無いときと同じ（10 ツール）', async () => {
    mkdirSync(dirname(defaultDb), { recursive: true });
    writeFileSync(defaultDb, 'not a database');
    setEnv({ HOUKI_NTA_DB_PATH: defaultDb });
    for (const t of READ_TOOLS) {
      const body = (await t.call()) as Body;
      const missing = await missingResponse(t.call);
      expect(body.code, t.tool).toBe(missing.code);
      expect(body.error, t.tool).toBe(missing.error);
      if (t.error) expect(body.error, t.tool).toBe(t.error);
    }
  });

  it('SPEC-NTA-DB-SCHEMA-021 例: HOUKI_NTA_DB_PATH で SQLite でない中身のファイルを指した nta_search_qa は DOC_NOT_FOUND・retryable: false で、hint は 029 の開けないときの文', async () => {
    const path = join(home, 'notdb.db');
    writeFileSync(path, 'これは SQLite のファイルではありません。');
    setEnv({ HOUKI_NTA_DB_PATH: path });
    const body = (await handleNtaSearchQa({ keyword: '社内会議' })) as Body;
    expect(body.code).toBe('DOC_NOT_FOUND');
    expect(body.retryable).toBe(false);
    expect(body.hint).toBe(
      unopenableHint('~/notdb.db', `HOUKI_NTA_DB_PATH="$HOME/notdb.db" ${NPX} --status`)
    );
  });
});

/* -------------------------------------------------------------------------- */
/* 読むだけの 10 ツールの ID                                                   */
/* -------------------------------------------------------------------------- */

for (const t of READ_TOOLS) {
  describe(`${t.id} ${t.tool} は、DB を開けないときも「DB に 1 件も無い」ときの応答を返す`, () => {
    for (const c of UNOPENABLE) {
      it.skipIf(c.skip)(
        `${t.id} ${t.tool}: ${c.name}のとき、code は ${t.code}、retryable: false と detail.cause を付け、next_actions に投入の案内を入れない`,
        async () => {
          const body = await expectUnopenableResponse(t, c);
          if (t.error) expect(body.error).toBe(t.error);
        }
      );
    }
  });
}

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-COMMON-ERRORS-006                                                 */
/* -------------------------------------------------------------------------- */

interface TextContent {
  type: 'text';
  text: string;
}

describe('SPEC-NTA-COMMON-ERRORS-006 処理中の想定外の例外はエラー INTERNAL_ERROR（retryable: false）で返し、再試行を案内しない（開けない DB は含まない）', () => {
  async function callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<{ isError?: boolean; body: Body; stderr: string }> {
    const chunks: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer();
    const client = new Client({ name: 'houki-nta-test', version: '0.0.0' });
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const result = (await client.callTool({ name, arguments: args })) as {
        isError?: boolean;
        content: TextContent[];
      };
      return {
        isError: result.isError,
        body: JSON.parse(result.content[0].text) as Body,
        stderr: chunks.join(''),
      };
    } finally {
      await client.close();
      spy.mockRestore();
    }
  }

  it('SPEC-NTA-COMMON-ERRORS-006 例: SQLite でない中身のファイルを HOUKI_NTA_DB_PATH で指して起動した MCP サーバーで nta_search_qa を呼ぶと、code は DOC_NOT_FOUND で INTERNAL_ERROR ではない', async () => {
    const path = join(home, 'cache.db');
    writeFileSync(path, 'これは SQLite のファイルではありません。'.repeat(10));
    setEnv({ HOUKI_NTA_DB_PATH: path });
    const { isError, body, stderr } = await callTool('nta_search_qa', { keyword: '社内会議' });
    expect(isError).toBe(true);
    expect(body.code).toBe('DOC_NOT_FOUND');
    expect(body.error).not.toContain('内部エラーが発生しました');
    expect(body.hint).not.toBe(
      'バグの可能性があります。再現手順を添えて GitHub issue でご報告ください'
    );
    expect(body.retryable).toBe(false);
    expect(body.detail?.cause).toBe('file is not a database');
    // 想定外の例外のログ（tool <name> threw）を出さない
    expect(stderr).not.toContain('threw');
  });

  for (const c of UNOPENABLE) {
    it.skipIf(c.skip)(
      `SPEC-NTA-COMMON-ERRORS-006 ${c.name}を HOUKI_NTA_DB_PATH で指した MCP サーバーの読むだけのツールは、INTERNAL_ERROR を返さない`,
      async () => {
        setEnv({ HOUKI_NTA_DB_PATH: c.make() });
        const { body } = await callTool('nta_get_jimu_unei', { docId: 'shotoku/000101' });
        expect(body.code).toBe('DOC_NOT_FOUND');
      }
    );
  }
});

/* -------------------------------------------------------------------------- */
/* 書き戻す 3 ツール: SPEC-NTA-DB-SCHEMA-030・021、SPEC-NTA-GET-TSUTATSU-007・010 */
/* -------------------------------------------------------------------------- */

const fixturesDir = resolve(import.meta.dirname, '..', '..', 'tests', 'fixtures');
const QA_URL = 'https://www.nta.go.jp/law/shitsugi/shohi/02/19.htm';
const TSUTATSU_TOC_PATH = '/law/tsutatsu/kihon/shohi/01.htm';

interface LiveBody extends Body {
  source?: string;
  isError?: boolean;
  taxAnswer?: { no?: string };
  qa?: { topic?: string };
  clause?: { clauseNumber?: string };
  supported_for_live?: string[];
  resolved?: { formal?: string };
  available_clauses?: string[];
  searched_urls?: string[];
}

interface LogLine {
  level: string;
  scope: string;
  msg: string;
  meta?: Record<string, unknown>;
}

/** 標準エラー出力の JSON のログの行を集める */
function captureLog(): { lines: () => LogLine[]; restore: () => void } {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    chunks.push(String(chunk));
    return true;
  });
  return {
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter((l) => l.startsWith('{'))
        .map((l) => JSON.parse(l) as LogLine),
    restore: () => spy.mockRestore(),
  };
}

/** SPEC-NTA-DB-SCHEMA-030 の warn の msg */
function writeBackWarnMsg(absPath: string): string {
  return `ローカル DB を開けないため、DB を使わずに国税庁サイトから取ります。取った内容は DB に書きません（DB: ${absPath}）`;
}

function sjis(html: string): Response {
  return new Response(iconvEncode(html, 'shift_jis'), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=Shift_JIS' },
  });
}

function fixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), 'utf8');
}

function urlOf(input: string | URL | Request): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

/** 呼ばれた URL を記録しながら、国税庁サイトの代わりのページを返す fetch */
function recordingSite(): { fetchImpl: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const article = (async () =>
    new Response(fixture('www.nta.go.jp_taxes_shiraberu_taxanswer_shohi_6101.htm'), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=UTF-8' },
    })) as unknown as typeof fetch;
  const withIndex = withTaxAnswerIndex(article);
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = urlOf(input);
    urls.push(url);
    if (url === QA_URL) return sjis(fixture('www.nta.go.jp_law_shitsugi_shohi_02_19.htm'));
    const path = new URL(url).pathname;
    if (path === TSUTATSU_TOC_PATH)
      return sjis(fixture('www.nta.go.jp_law_tsutatsu_kihon_shohi_01.htm'));
    if (path.startsWith('/law/tsutatsu/kihon/shohi/')) {
      return sjis(fixture('www.nta.go.jp_law_tsutatsu_kihon_shohi_01_04.htm'));
    }
    return withIndex(input, init);
  }) as typeof fetch;
  return { fetchImpl, urls };
}

/** 1－4－1 から 1－4－<n> までの条項を持つ節のページ（消基通 第1章第4節の形） */
function sectionPageWithClauses(n: number): string {
  const blocks: string[] = [];
  for (let i = 1; i <= n; i++) {
    blocks.push(`<h2>（見出し${i}）</h2>`);
    blocks.push(`<p class="indent1"><strong>1－4－${i}　</strong>条項${i}の本文である。</p>`);
  }
  return `<!DOCTYPE html><html lang="ja"><head><meta content="text/html; charset=shift_jis" http-equiv="Content-Type"><title>第4節　納税義務の免除｜国税庁</title></head><body><div id="contents"><div class="imp-cnt-tsutatsu" id="bodyArea"><div class="page-header" id="page-top"><h1>第4節　納税義務の免除</h1></div>
${blocks.join('\n')}
</div></div></body></html>`;
}

/** 目次と、求めた条項の無い節のページを返す fetch（SPEC-NTA-GET-TSUTATSU-010） */
function siteWithoutClause(): typeof fetch {
  return (async (input: string | URL | Request) => {
    const path = new URL(urlOf(input)).pathname;
    if (path === TSUTATSU_TOC_PATH)
      return sjis(fixture('www.nta.go.jp_law_tsutatsu_kihon_shohi_01.htm'));
    return sjis(sectionPageWithClauses(3));
  }) as typeof fetch;
}

/** 書き戻す 3 ツールの呼び出し（国税庁サイトから取れる番号） */
const WRITE_BACK_TOOLS: Array<{
  tool: string;
  call: (fetchImpl: typeof fetch) => Promise<unknown>;
  check: (body: LiveBody) => void;
}> = [
  {
    tool: 'nta_get_tax_answer',
    call: (fetchImpl) =>
      getTaxAnswer({ no: '6101', format: 'json' }, { fetchImpl, maxRetries: 0, retryBaseMs: 0 }),
    check: (body) => expect(body.taxAnswer?.no).toBe('6101'),
  },
  {
    tool: 'nta_get_qa',
    call: (fetchImpl) =>
      getQa(
        { topic: 'shohi', category: '02', id: '19', format: 'json' },
        { fetchImpl, maxRetries: 0, retryBaseMs: 0 }
      ),
    check: (body) => expect(body.code).toBeUndefined(),
  },
  {
    tool: 'nta_get_tsutatsu',
    call: (fetchImpl) =>
      getTsutatsu(
        { name: '消基通', clause: '1-4-1', format: 'json' },
        { fetchImpl, pageIntervalMs: 0, maxRetries: 0, retryBaseMs: 0 }
      ),
    check: (body) => expect(body.clause?.clauseNumber).toBe('1-4-1'),
  },
];

/** 呼んで、応答とログの行を返す */
async function callLogged(
  call: () => Promise<unknown>
): Promise<{ body: LiveBody; log: LogLine[] }> {
  const log = captureLog();
  try {
    const body = (await call()) as LiveBody;
    return { body, log: log.lines() };
  } finally {
    log.restore();
  }
}

describe('SPEC-NTA-DB-SCHEMA-030 書き戻すツールは、DB を開けないときも DB を使わずに国税庁サイトから取って返し、DB に書かないことを MCP サーバーのログに warn で残す', () => {
  for (const t of WRITE_BACK_TOOLS) {
    for (const c of UNOPENABLE) {
      it.skipIf(c.skip)(
        `SPEC-NTA-DB-SCHEMA-030 ${t.tool}: ${c.name}を HOUKI_NTA_DB_PATH で指すと、国税庁サイトから取って source: "live" で返し、warn を 1 行出し、ファイルは変わらない`,
        async () => {
          const path = c.make();
          setEnv({ HOUKI_NTA_DB_PATH: path });
          const unchanged = c.snapshot();
          const site = recordingSite();
          const { body, log } = await callLogged(() => t.call(site.fetchImpl));
          expect(body.isError).toBeUndefined();
          expect(body.source).toBe('live');
          t.check(body);
          expect(site.urls.length).toBeGreaterThan(0);
          const warns = log.filter((l) => l.level === 'warn');
          expect(warns).toHaveLength(1);
          expect(warns[0].scope).toBe(t.tool);
          expect(warns[0].msg).toBe(writeBackWarnMsg(path));
          expect(Object.keys(warns[0].meta ?? {}).sort()).toEqual(['cause', 'db_path']);
          expect(warns[0].meta?.db_path).toBe(path);
          // cause は 029 の detail.cause と同じ文で、ホームディレクトリを ~ にしない
          const shown = c.cause ? c.cause() : await statusCause();
          expect(warns[0].meta?.cause).toBe(shown.replaceAll('~/', `${home}/`));
          unchanged();
        }
      );
    }
  }

  it('SPEC-NTA-DB-SCHEMA-030 例: SQLite でない中身のファイルで nta_get_tax_answer { no: "6101", format: "json" } を呼ぶと、索引と記事を取って返し、warn の meta.cause は file is not a database。もう一度呼ぶと索引と記事をもう一度取り、同じ warn を出す', async () => {
    mkdirSync(dirname(defaultDb), { recursive: true });
    writeFileSync(defaultDb, 'これは SQLite のファイルではありません。'.repeat(100));
    setEnv({ HOUKI_NTA_DB_PATH: defaultDb });
    const unchanged = fileUnchanged(defaultDb);
    for (let i = 0; i < 2; i++) {
      const site = recordingSite();
      const { body, log } = await callLogged(() =>
        getTaxAnswer(
          { no: '6101', format: 'json' },
          { fetchImpl: site.fetchImpl, maxRetries: 0, retryBaseMs: 0 }
        )
      );
      expect(body.source).toBe('live');
      expect(body.taxAnswer?.no).toBe('6101');
      expect(body.isError).toBeUndefined();
      expect(site.urls.filter((u) => u === TAX_ANSWER_INDEX_URL)).toHaveLength(1);
      expect(site.urls.filter((u) => u !== TAX_ANSWER_INDEX_URL)).toHaveLength(1);
      const warns = log.filter((l) => l.level === 'warn');
      // 保存した索引は読みに行かないので、SPEC-NTA-GET-TAX-ANSWER-018 の warn は出さない
      expect(warns).toHaveLength(1);
      expect(warns[0].scope).toBe('nta_get_tax_answer');
      expect(warns[0].meta?.cause).toBe('file is not a database');
      unchanged();
    }
  });

  it('SPEC-NTA-DB-SCHEMA-030 例: 同じサーバーで nta_get_tsutatsu { name: "電帳法取通", clause: "4-1" } は TSUTATSU_NOT_FOUND・retryable: false・開けないときの hint で、next_actions は無い', async () => {
    mkdirSync(dirname(defaultDb), { recursive: true });
    writeFileSync(defaultDb, 'これは SQLite のファイルではありません。');
    setEnv({ HOUKI_NTA_DB_PATH: defaultDb });
    const { body, log } = await callLogged(() =>
      getTsutatsu({ name: '電帳法取通', clause: '4-1' })
    );
    expect(body.code).toBe('TSUTATSU_NOT_FOUND');
    expect(body.retryable).toBe(false);
    expect(
      body.hint?.startsWith('ローカル DB（~/.cache/houki-nta-mcp/cache.db）を開けません。')
    ).toBe(true);
    expect(body.next_actions).toBeUndefined();
    // DB を開こうとした呼び出しなので warn を出す
    expect(log.filter((l) => l.level === 'warn' && l.scope === 'nta_get_tsutatsu')).toHaveLength(1);
  });

  it('SPEC-NTA-DB-SCHEMA-030 目次も保存しないので、nta_get_tsutatsu を 2 回呼ぶと 2 回とも国税庁サイトから目次を取る', async () => {
    mkdirSync(defaultDb, { recursive: true });
    setEnv({ HOUKI_NTA_DB_PATH: defaultDb });
    for (let i = 0; i < 2; i++) {
      const urls: string[] = [];
      const inner = siteWithoutClause();
      const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
        urls.push(urlOf(input));
        return inner(input, init);
      }) as typeof fetch;
      const { body } = await callLogged(() =>
        getTsutatsu(
          { name: '消基通', clause: '1-4-99', format: 'json' },
          { fetchImpl, pageIntervalMs: 0, maxRetries: 0, retryBaseMs: 0 }
        )
      );
      expect(body.code).toBe('ARTICLE_NOT_FOUND');
      expect(urls.some((u) => new URL(u).pathname === TSUTATSU_TOC_PATH)).toBe(true);
    }
    expect(readdirSync(defaultDb)).toEqual([]);
  });

  it('SPEC-NTA-DB-SCHEMA-030 nta_get_qa を 2 回呼ぶと、DB から返さずに 2 回とも国税庁サイトから取る', async () => {
    writeFileSync(join(home, 'plain'), 'x');
    setEnv({ HOUKI_NTA_DB_PATH: join(home, 'plain', 'cache.db') });
    for (let i = 0; i < 2; i++) {
      const site = recordingSite();
      const { body } = await callLogged(() =>
        getQa(
          { topic: 'shohi', category: '02', id: '19', format: 'json' },
          { fetchImpl: site.fetchImpl }
        )
      );
      expect(body.source).toBe('live');
      expect(site.urls).toEqual([QA_URL]);
    }
    expect(statSync(join(home, 'plain')).isFile()).toBe(true);
  });

  it('SPEC-NTA-DB-SCHEMA-030 国税庁サイトとの通信の失敗（503）は DB を使えるときと同じ応答で、next_actions に cli_bulk_download を入れず、warn は出す', async () => {
    const fail = (async () => new Response('busy', { status: 503 })) as unknown as typeof fetch;
    const call = () =>
      getQa(
        { topic: 'shohi', category: '02', id: '19', format: 'json' },
        { fetchImpl: fail, maxRetries: 0, retryBaseMs: 0 }
      );
    // DB を使えるとき（ファイルが無い）の応答
    setEnv({ HOUKI_NTA_DB_PATH: join(dir, 'none', 'cache.db') });
    const usable = (await callLogged(call)).body;
    mkdirSync(dirname(defaultDb), { recursive: true });
    writeFileSync(defaultDb, 'not a database');
    setEnv({ HOUKI_NTA_DB_PATH: defaultDb });
    const { body, log } = await callLogged(call);
    expect(body.code).toBe(usable.code);
    expect(body.code?.startsWith('SOURCE_')).toBe(true);
    expect(body.retryable).toBe(usable.retryable);
    expect(body.hint).toBe(usable.hint);
    expect(body.next_actions?.some((a) => a.action === 'cli_bulk_download') ?? false).toBe(false);
    expect(log.filter((l) => l.level === 'warn' && l.scope === 'nta_get_qa')).toHaveLength(1);
  });

  it('SPEC-NTA-DB-SCHEMA-030 ページが無い（404）は DB を使えるときと同じ DOC_NOT_FOUND', async () => {
    const missing = (async () =>
      new Response('not found', { status: 404 })) as unknown as typeof fetch;
    const call = () =>
      getQa(
        { topic: 'shohi', category: '02', id: '99', format: 'json' },
        { fetchImpl: missing, maxRetries: 0, retryBaseMs: 0 }
      );
    setEnv({ HOUKI_NTA_DB_PATH: join(dir, 'none', 'cache.db') });
    const usable = (await callLogged(call)).body;
    mkdirSync(defaultDb, { recursive: true });
    setEnv({ HOUKI_NTA_DB_PATH: defaultDb });
    const { body } = await callLogged(call);
    expect(body.code).toBe('DOC_NOT_FOUND');
    expect(body).toEqual(usable);
  });

  it('SPEC-NTA-DB-SCHEMA-030 引数の検査で返す応答（INVALID_ARGUMENT）は DB を開く前に返すので変わらず、warn も出さない', async () => {
    const call = () => getQa({ topic: 'shohi', category: 'ab', id: '19', format: 'json' });
    setEnv({ HOUKI_NTA_DB_PATH: join(dir, 'none', 'cache.db') });
    const usable = (await callLogged(call)).body;
    mkdirSync(defaultDb, { recursive: true });
    setEnv({ HOUKI_NTA_DB_PATH: defaultDb });
    const { body, log } = await callLogged(call);
    expect(body.code).toBe('INVALID_ARGUMENT');
    expect(body).toEqual(usable);
    expect(log.filter((l) => l.level === 'warn')).toEqual([]);
  });
});

describe('SPEC-NTA-DB-SCHEMA-021 DB の状態と入口ごとの扱い（開けない DB の書き戻すツール）', () => {
  it('SPEC-NTA-DB-SCHEMA-021 例: SQLite でない中身のファイルを指したサーバーで nta_get_qa { topic: "shohi", category: "02", id: "19" } を呼ぶと、国税庁サイトから取った事例を返し（source: "live"）、ファイルの中身は変わらない', async () => {
    mkdirSync(dirname(defaultDb), { recursive: true });
    writeFileSync(defaultDb, 'これは SQLite のファイルではありません。'.repeat(100));
    setEnv({ HOUKI_NTA_DB_PATH: defaultDb });
    const unchanged = fileUnchanged(defaultDb);
    const site = recordingSite();
    const { body, log } = await callLogged(() =>
      getQa(
        { topic: 'shohi', category: '02', id: '19', format: 'json' },
        { fetchImpl: site.fetchImpl }
      )
    );
    expect(body.source).toBe('live');
    expect(body.isError).toBeUndefined();
    expect(log.filter((l) => l.level === 'warn' && l.scope === 'nta_get_qa')).toHaveLength(1);
    unchanged();
  });
});

describe('SPEC-NTA-GET-TSUTATSU-007 DB に無く、ライブ取得にも対応していない通達は投入を案内する', () => {
  it('SPEC-NTA-GET-TSUTATSU-007 例: DB を開けるとき、{ name: "電帳法取通", clause: "4-1" } は TSUTATSU_NOT_FOUND で next_actions[0].action は cli_bulk_download', async () => {
    const body = (await getTsutatsu({ name: '電帳法取通', clause: '4-1' })) as LiveBody;
    expect(body.code).toBe('TSUTATSU_NOT_FOUND');
    expect(body.next_actions?.[0]?.action).toBe('cli_bulk_download');
    expect(body.retryable).toBeUndefined();
  });

  for (const c of UNOPENABLE) {
    it.skipIf(c.skip)(
      `SPEC-NTA-GET-TSUTATSU-007 ${c.name}のとき、code は同じ TSUTATSU_NOT_FOUND で、hint は 029 の開けないときの文、retryable: false と detail.cause を付け、next_actions は無く、supported_for_live と resolved は同じ`,
      async () => {
        // DB を開けるとき（別の場所の DB）の応答
        setEnv({ HOUKI_NTA_DB_PATH: join(dir, 'opened', 'cache.db') });
        const opened = (await getTsutatsu({ name: '電帳法取通', clause: '4-1' })) as LiveBody;
        const path = c.make();
        setEnv({ HOUKI_NTA_DB_PATH: path });
        const unchanged = c.snapshot();
        const { body } = await callLogged(() => getTsutatsu({ name: '電帳法取通', clause: '4-1' }));
        expect(body.code).toBe('TSUTATSU_NOT_FOUND');
        expect(body.error).toBe(opened.error);
        expect(body.hint).toBe(
          unopenableHint(c.shown, `HOUKI_NTA_DB_PATH=${c.shellPath} ${NPX} --status`)
        );
        expect(body.retryable).toBe(false);
        expect(body.detail?.cause).toBe(c.cause ? c.cause() : await statusCause());
        expect(body.next_actions).toBeUndefined();
        expect(body.supported_for_live).toEqual(opened.supported_for_live);
        expect(body.resolved).toEqual(opened.resolved);
        expect(body.tool).toBe('nta_get_tsutatsu');
        unchanged();
      }
    );
  }
});

describe('SPEC-NTA-GET-TSUTATSU-010 候補ページのどれにも条項が無いときは、見たページの番号（最大 50 件）と URL を返す', () => {
  async function articleNotFound(): Promise<LiveBody> {
    const { body } = await callLogged(() =>
      getTsutatsu(
        { name: '消基通', clause: '1-4-99', format: 'json' },
        { fetchImpl: siteWithoutClause(), pageIntervalMs: 0, maxRetries: 0, retryBaseMs: 0 }
      )
    );
    return body;
  }

  it('SPEC-NTA-GET-TSUTATSU-010 DB を開けるとき、next_actions は nta_search_tsutatsu と cli_bulk_download の 2 件', async () => {
    const body = await articleNotFound();
    expect(body.code).toBe('ARTICLE_NOT_FOUND');
    expect(body.next_actions?.map((a) => a.action)).toEqual([
      'nta_search_tsutatsu',
      'cli_bulk_download',
    ]);
    expect(body.hint).toContain('--bulk-download');
  });

  for (const c of UNOPENABLE) {
    it.skipIf(c.skip)(
      `SPEC-NTA-GET-TSUTATSU-010 ${c.name}のとき、hint に --bulk-download を含まず、next_actions は nta_search_tsutatsu の 1 件。code・available_clauses・searched_urls は同じ`,
      async () => {
        // DB を開けるとき（別の場所の DB。条項を書き戻すのでファイルができる）の応答
        setEnv({ HOUKI_NTA_DB_PATH: join(dir, 'opened', 'cache.db') });
        const opened = await articleNotFound();
        const path = c.make();
        setEnv({ HOUKI_NTA_DB_PATH: path });
        const body = await articleNotFound();
        expect(body.code).toBe('ARTICLE_NOT_FOUND');
        expect(body.hint).not.toContain('--bulk-download');
        expect(body.hint).toContain('nta_search_tsutatsu');
        expect(body.next_actions?.map((a) => a.action)).toEqual(['nta_search_tsutatsu']);
        expect(body.available_clauses).toEqual(opened.available_clauses);
        expect(body.searched_urls).toEqual(opened.searched_urls);
        expect(body.searched_urls?.length).toBeGreaterThan(0);
      }
    );
  }
});
