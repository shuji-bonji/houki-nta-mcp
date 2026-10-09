/**
 * 差分 specs/changes/20261009-db-folder-access-and-tsutatsu-guide/（PR #160、houki-nta-mcp #154・#155）の受入テスト
 * （MCP のツール）。
 *
 * - db_schema: SPEC-NTA-DB-SCHEMA-021・029・030（MODIFIED。置き場所のフォルダーに入る権限が無いときは「開けない」）
 * - common_errors: SPEC-NTA-COMMON-ERRORS-006（MODIFIED。入る権限の無いフォルダーも INTERNAL_ERROR にしない）
 *
 * 期待値は差分の spec.md の本文・表・「例:」と、proposal.md の「実装の変更」の受入テストの場面から決めている。
 * 例のホームディレクトリ `/Users/bonji` は、一時ディレクトリの下のフォルダー（HOME）に置き換え、入る権限の無い
 * フォルダーはその下に作る（detail.cause の `~`）。場面は proposal.md の「今の動き」の A〜D:
 *
 * | 場面 | DB のパス | 入る権限の無いフォルダー |
 * |---|---|---|
 * | A | `~/locked/cache.db`（`chmod 000` の locked の中に SQLite の cache.db がある） | `~/locked` |
 * | B | `~/locked2/cache.db`（`chmod 000` の locked2 の中に何も無い） | `~/locked2` |
 * | C | `~/locked/sub/cache.db`（パスの途中の locked に入れない） | `~/locked` |
 * | D | `~/ronly/cache.db`（`chmod 444` の ronly の中に 0 バイトの cache.db がある） | `~/ronly` |
 *
 * root では chmod が効かないので、root で走るときは飛ばす。後片付けでフォルダーの権限を戻す。
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
import { join, resolve } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import Database from 'better-sqlite3';
import { encode as iconvEncode } from 'iconv-lite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withTaxAnswerIndex } from '../../tests/support/tax-answer-index.js';
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

/** root では chmod 000 のフォルダーにも入れてしまう（proposal.md の「実装の変更」の受入テスト） */
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
  isError?: boolean;
  source?: string;
  taxAnswer?: { no?: string };
  clause?: { clauseNumber?: string };
  supported_for_live?: string[];
  resolved?: { formal?: string; abbr?: string };
}

const ENV_KEYS = ['HOME', 'HOUKI_NTA_DB_PATH', 'XDG_CACHE_HOME'] as const;
let saved: Record<string, string | undefined>;
let dir: string;
/** テストのホームディレクトリ（例の `/Users/bonji` に当たる） */
let home: string;
/** 権限を変えたフォルダー。afterEach で戻してから消す */
const lockedDirs: string[] = [];

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  dir = mkdtempSync(join(tmpdir(), 'houki-nta-db-folder-access-'));
  home = join(dir, 'home');
  mkdirSync(home);
  setEnv({ HOME: home, HOUKI_NTA_DB_PATH: undefined, XDG_CACHE_HOME: undefined });
});

afterEach(() => {
  vi.restoreAllMocks();
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

/** SPEC-NTA-DB-SCHEMA-029 の開けないときの hint */
function unopenableHint(path: string, statusCommand: string): string {
  return `ローカル DB（${path}）を開けません。パスがフォルダーを指していないか、途中に普通のファイルが無いか、読む権限があるか、SQLite の DB のファイルかを確かめてください（HOUKI_NTA_DB_PATH を設定しているときはその値を直します）。\`${statusCommand}\` を実行すると、開けない理由が出ます`;
}

/** SPEC-NTA-DB-SCHEMA-021 の入る権限の無いフォルダーの開けない理由の文 */
function folderCause(folder: string): string {
  return `EACCES: パスの途中のフォルダーに入る権限がありません (${folder})`;
}

/** 入る権限の無いフォルダーの場面（proposal.md の「今の動き」の A〜D） */
interface Locked {
  name: string;
  /** 作って、HOUKI_NTA_DB_PATH に入れるパスを返す */
  make: () => string;
  /** hint に出るパス（ホームディレクトリの部分は ~） */
  shown: string;
  /** HOUKI_NTA_DB_PATH を前に付けた `--status` の案内のコマンドの、変数の値（シェルに書くパス） */
  shellPath: string;
  /** 入る権限の無いフォルダー（ホームディレクトリの下からの相対） */
  folder: string;
  /** 権限を戻した後に、中身が変わっていないことを確かめる */
  unchanged: () => void;
}

const LOCKED: Locked[] = [
  {
    name: 'A: chmod 000 のフォルダーの中に SQLite の cache.db がある',
    make: () => {
      mkdirSync(join(home, 'locked'));
      const db = new Database(join(home, 'locked', 'cache.db'));
      db.exec('CREATE TABLE t(x)');
      db.close();
      lock(join(home, 'locked'), 0o000);
      return join(home, 'locked', 'cache.db');
    },
    shown: '~/locked/cache.db',
    shellPath: '"$HOME/locked/cache.db"',
    folder: 'locked',
    unchanged: () => {
      expect(readdirSync(join(home, 'locked'))).toEqual(['cache.db']);
    },
  },
  {
    name: 'B: chmod 000 のフォルダーの中に何も無い',
    make: () => {
      mkdirSync(join(home, 'locked2'));
      lock(join(home, 'locked2'), 0o000);
      return join(home, 'locked2', 'cache.db');
    },
    shown: '~/locked2/cache.db',
    shellPath: '"$HOME/locked2/cache.db"',
    folder: 'locked2',
    unchanged: () => {
      expect(readdirSync(join(home, 'locked2'))).toEqual([]);
    },
  },
  {
    name: 'C: パスの途中のフォルダー（chmod 000）に入れない',
    make: () => {
      mkdirSync(join(home, 'locked', 'sub'), { recursive: true });
      lock(join(home, 'locked'), 0o000);
      return join(home, 'locked', 'sub', 'cache.db');
    },
    shown: '~/locked/sub/cache.db',
    shellPath: '"$HOME/locked/sub/cache.db"',
    folder: 'locked',
    unchanged: () => {
      expect(readdirSync(join(home, 'locked'))).toEqual(['sub']);
      expect(readdirSync(join(home, 'locked', 'sub'))).toEqual([]);
    },
  },
  {
    name: 'D: 読めるが入れないフォルダー（chmod 444）の中に 0 バイトの cache.db がある',
    make: () => {
      mkdirSync(join(home, 'ronly'));
      writeFileSync(join(home, 'ronly', 'cache.db'), '');
      lock(join(home, 'ronly'), 0o444);
      return join(home, 'ronly', 'cache.db');
    },
    shown: '~/ronly/cache.db',
    shellPath: '"$HOME/ronly/cache.db"',
    folder: 'ronly',
    unchanged: () => {
      expect(readdirSync(join(home, 'ronly'))).toEqual(['cache.db']);
      expect(statSync(join(home, 'ronly', 'cache.db')).size).toBe(0);
    },
  },
];

/** 読むだけのツールと、その「DB に 1 件も無い」ときの code（SPEC-NTA-DB-SCHEMA-029 の下の表と 021 の注 1） */
const READ_TOOLS: Array<{
  tool: string;
  code: string;
  call: () => Promise<unknown>;
}> = [
  {
    tool: 'nta_search_tsutatsu',
    code: 'TSUTATSU_NOT_FOUND',
    call: () => searchTsutatsu({ keyword: '役員' }),
  },
  {
    tool: 'nta_search_qa',
    code: 'DOC_NOT_FOUND',
    call: () => handleNtaSearchQa({ keyword: '社内会議' }),
  },
  {
    tool: 'nta_search_tax_answer',
    code: 'DOC_NOT_FOUND',
    call: () => handleNtaSearchTaxAnswer({ keyword: '医療費控除' }),
  },
  {
    tool: 'nta_search_kaisei_tsutatsu',
    code: 'DOC_NOT_FOUND',
    call: () => handleNtaSearchKaiseiTsutatsu({ keyword: '改正' }),
  },
  {
    tool: 'nta_search_jimu_unei',
    code: 'DOC_NOT_FOUND',
    call: () => handleNtaSearchJimuUnei({ keyword: '書面添付' }),
  },
  {
    tool: 'nta_search_bunshokaitou',
    code: 'DOC_NOT_FOUND',
    call: () => handleNtaSearchBunshokaitou({ keyword: '適格請求書' }),
  },
  {
    tool: 'nta_get_kaisei_tsutatsu',
    code: 'DOC_NOT_FOUND',
    call: () => handleNtaGetKaiseiTsutatsu({ docId: '0026003-067' }),
  },
  {
    tool: 'nta_get_jimu_unei',
    code: 'DOC_NOT_FOUND',
    call: () => handleNtaGetJimuUnei({ docId: 'shotoku/000101' }),
  },
  {
    tool: 'nta_get_bunshokaitou',
    code: 'DOC_NOT_FOUND',
    call: () => handleNtaGetBunshokaitou({ docId: 'shotoku/250416' }),
  },
  {
    tool: 'nta_inspect_pdf_meta',
    code: 'DOC_NOT_FOUND',
    call: () => handleNtaInspectPdfMeta({ docType: 'tax-answer', docId: '6101' }),
  },
];

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-DB-SCHEMA-029・021（読むだけのツール）                              */
/* -------------------------------------------------------------------------- */

describe.skipIf(IS_ROOT)(
  'SPEC-NTA-DB-SCHEMA-029 読むだけのツールの「DB に 1 件も無い」ときの hint（置き場所のフォルダーに入る権限が無いときは開けないときの応答）',
  () => {
    for (const t of READ_TOOLS) {
      for (const c of LOCKED) {
        it(`SPEC-NTA-DB-SCHEMA-029 ${t.tool}: ${c.name}を HOUKI_NTA_DB_PATH で指すと、${t.code}・開けないときの hint・retryable: false・detail.cause は EACCES: パスの途中のフォルダーに入る権限がありません (~/${c.folder}) で、next_actions は無く、フォルダーの中身は変わらない`, async () => {
          setEnv({ HOUKI_NTA_DB_PATH: c.make() });
          const body = (await t.call()) as Body;
          expect(body.code).toBe(t.code);
          expect(body.hint).toBe(
            unopenableHint(c.shown, `HOUKI_NTA_DB_PATH=${c.shellPath} ${NPX} --status`)
          );
          expect(body.retryable).toBe(false);
          expect(body.detail?.cause).toBe(folderCause(`~/${c.folder}`));
          expect(body.next_actions).toBeUndefined();
          expect(body.results).toBeUndefined();
          // hint には開けない理由の文を入れない
          expect(body.hint).not.toContain('EACCES');
          unlockAll();
          c.unchanged();
        });
      }
    }

    for (const withDb of [true, false]) {
      it(`SPEC-NTA-DB-SCHEMA-029 例: HOUKI_NTA_DB_PATH=~/locked/cache.db（~/locked は chmod 000、cache.db が${withDb ? 'ある' : '無い'}）で nta_search_qa { keyword: "社内会議" } は DOC_NOT_FOUND・retryable: false・detail.cause は EACCES: パスの途中のフォルダーに入る権限がありません (~/locked)、next_actions は無い`, async () => {
        const locked = join(home, 'locked');
        mkdirSync(locked);
        if (withDb) {
          const db = new Database(join(locked, 'cache.db'));
          db.exec('CREATE TABLE t(x)');
          db.close();
        }
        lock(locked, 0o000);
        setEnv({ HOUKI_NTA_DB_PATH: join(locked, 'cache.db') });
        const body = (await handleNtaSearchQa({ keyword: '社内会議' })) as Body;
        expect(body.code).toBe('DOC_NOT_FOUND');
        expect(body.retryable).toBe(false);
        expect(body.hint).toBe(
          `ローカル DB（~/locked/cache.db）を開けません。パスがフォルダーを指していないか、途中に普通のファイルが無いか、読む権限があるか、SQLite の DB のファイルかを確かめてください（HOUKI_NTA_DB_PATH を設定しているときはその値を直します）。\`HOUKI_NTA_DB_PATH="$HOME/locked/cache.db" ${NPX} --status\` を実行すると、開けない理由が出ます`
        );
        expect(body.detail?.cause).toBe(
          'EACCES: パスの途中のフォルダーに入る権限がありません (~/locked)'
        );
        expect(body.next_actions).toBeUndefined();
      });
    }

    it('SPEC-NTA-DB-SCHEMA-029 入る権限の無いフォルダーがホームディレクトリの下でないときは、detail.cause のパスを ~ にしない', async () => {
      const locked = join(dir, 'outside');
      mkdirSync(locked);
      lock(locked, 0o000);
      const path = join(locked, 'cache.db');
      setEnv({ HOUKI_NTA_DB_PATH: path });
      const body = (await handleNtaSearchQa({ keyword: '社内会議' })) as Body;
      expect(body.detail?.cause).toBe(folderCause(locked));
      expect(body.hint).toBe(unopenableHint(path, `HOUKI_NTA_DB_PATH='${path}' ${NPX} --status`));
    });
  }
);

describe.skipIf(IS_ROOT)(
  'SPEC-NTA-DB-SCHEMA-021 DB の状態と入口ごとの扱い（置き場所のフォルダーに入る権限が無いときの読むだけのツール）',
  () => {
    it('SPEC-NTA-DB-SCHEMA-021 開けない行の読むだけのツール: 入る権限の無いフォルダーの下の DB は、ファイルがあってもなくても開けないときの応答で、cli_bulk_download を入れない（A と B は同じ応答）', async () => {
      setEnv({ HOUKI_NTA_DB_PATH: LOCKED[0].make() });
      const a = (await handleNtaSearchQa({ keyword: '社内会議' })) as Body;
      setEnv({ HOUKI_NTA_DB_PATH: LOCKED[1].make() });
      const b = (await handleNtaSearchQa({ keyword: '社内会議' })) as Body;
      for (const body of [a, b]) {
        expect(body.retryable).toBe(false);
        expect(body.hint?.startsWith('ローカル DB（')).toBe(true);
        expect(body.hint).not.toContain('がありません');
        expect(body.next_actions?.some((x) => x.action === 'cli_bulk_download') ?? false).toBe(
          false
        );
      }
      expect(a.code).toBe(b.code);
      expect(a.error).toBe(b.error);
    });

    it('SPEC-NTA-DB-SCHEMA-021 開けない DB の注 1 の応答の code と error は、DB のファイルが無いときと同じ（10 ツール、A の場面）', async () => {
      for (const t of READ_TOOLS) {
        setEnv({ HOUKI_NTA_DB_PATH: join(dir, 'none', 'cache.db') });
        const missing = (await t.call()) as Body;
        unlockAll();
        rmSync(join(home, 'locked'), { recursive: true, force: true });
        setEnv({ HOUKI_NTA_DB_PATH: LOCKED[0].make() });
        const body = (await t.call()) as Body;
        expect(body.code, t.tool).toBe(missing.code);
        expect(body.error, t.tool).toBe(missing.error);
      }
    });
  }
);

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-COMMON-ERRORS-006                                                 */
/* -------------------------------------------------------------------------- */

interface TextContent {
  type: 'text';
  text: string;
}

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

describe.skipIf(IS_ROOT)(
  'SPEC-NTA-COMMON-ERRORS-006 処理中の想定外の例外は INTERNAL_ERROR で返す（置き場所のフォルダーに入る権限が無いことは含まない）',
  () => {
    for (const c of LOCKED) {
      it(`SPEC-NTA-COMMON-ERRORS-006 ${c.name}を HOUKI_NTA_DB_PATH で指した MCP サーバーの nta_search_qa は DOC_NOT_FOUND で、INTERNAL_ERROR ではない`, async () => {
        setEnv({ HOUKI_NTA_DB_PATH: c.make() });
        const { isError, body, stderr } = await callTool('nta_search_qa', { keyword: '社内会議' });
        expect(isError).toBe(true);
        expect(body.code).toBe('DOC_NOT_FOUND');
        expect(body.error).not.toContain('内部エラーが発生しました');
        expect(body.hint).not.toBe(
          'バグの可能性があります。再現手順を添えて GitHub issue でご報告ください'
        );
        expect(body.retryable).toBe(false);
        expect(body.detail?.cause).toBe(folderCause(`~/${c.folder}`));
        expect(stderr).not.toContain('threw');
      });
    }
  }
);

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-DB-SCHEMA-030（書き戻す 3 ツール）                                  */
/* -------------------------------------------------------------------------- */

const fixturesDir = resolve(import.meta.dirname, '..', '..', 'tests', 'fixtures');
const QA_URL = 'https://www.nta.go.jp/law/shitsugi/shohi/02/19.htm';
const TSUTATSU_TOC_PATH = '/law/tsutatsu/kihon/shohi/01.htm';

interface LogLine {
  level: string;
  scope: string;
  msg: string;
  meta?: Record<string, unknown>;
}

async function callLogged(call: () => Promise<unknown>): Promise<{ body: Body; log: LogLine[] }> {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    chunks.push(String(chunk));
    return true;
  });
  try {
    const body = (await call()) as Body;
    const log = chunks
      .join('')
      .split('\n')
      .filter((l) => l.startsWith('{'))
      .map((l) => JSON.parse(l) as LogLine);
    return { body, log };
  } finally {
    spy.mockRestore();
  }
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

/** 書き戻す 3 ツールの呼び出し（国税庁サイトから取れる番号） */
const WRITE_BACK_TOOLS: Array<{
  tool: string;
  call: (fetchImpl: typeof fetch) => Promise<unknown>;
  check: (body: Body) => void;
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

describe.skipIf(IS_ROOT)(
  'SPEC-NTA-DB-SCHEMA-030 書き戻すツールは、置き場所のフォルダーに入る権限が無いときも DB を使わずに国税庁サイトから取って返し、warn を残す',
  () => {
    for (const t of WRITE_BACK_TOOLS) {
      for (const c of LOCKED) {
        it(`SPEC-NTA-DB-SCHEMA-030 ${t.tool}: ${c.name}を HOUKI_NTA_DB_PATH で指すと、source: "live" で返し、warn を 1 行出し（meta.cause は EACCES: … の絶対パス）、フォルダーの中身は変わらない`, async () => {
          const path = c.make();
          setEnv({ HOUKI_NTA_DB_PATH: path });
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
          expect(warns[0].meta?.db_path).toBe(path);
          // ホームディレクトリを ~ に置き換えない
          expect(warns[0].meta?.cause).toBe(folderCause(join(home, c.folder)));
          unlockAll();
          c.unchanged();
        });
      }
    }
  }
);
