/**
 * 差分 specs/changes/20261004-db-location/（PR #142、houki-nta-mcp #138・#137）の受入テスト（MCP のツール）。
 *
 * - db_schema: SPEC-NTA-DB-SCHEMA-026・027・028・029（ADDED）、021（MODIFIED。読むだけのツールの hint の文）
 * - common_errors: SPEC-NTA-COMMON-ERRORS-017（MODIFIED。案内のコマンド）
 * - search_rules: SPEC-NTA-SEARCH-RULES-022（ADDED。freshness.db_path）、017（MODIFIED。freshness の形と warning のコマンド）
 * - 検索・取得の各ツールの「DB に 1 件も無い」ときの hint と案内のコマンド（MODIFIED）:
 *   SPEC-NTA-SEARCH-TSUTATSU-003、SPEC-NTA-SEARCH-QA-001・005、SPEC-NTA-SEARCH-TAX-ANSWER-001、
 *   SPEC-NTA-SEARCH-KAISEI-TSUTATSU-001、SPEC-NTA-SEARCH-JIMU-UNEI-001、SPEC-NTA-SEARCH-BUNSHOKAITOU-001・002、
 *   SPEC-NTA-GET-KAISEI-TSUTATSU-001・002、SPEC-NTA-GET-JIMU-UNEI-001・002、SPEC-NTA-GET-BUNSHOKAITOU-002・003、
 *   SPEC-NTA-INSPECT-PDF-META-001、SPEC-NTA-SEARCH-TSUTATSU-004（freshness.db_path）
 * - nta_get_tax_answer: SPEC-NTA-GET-TAX-ANSWER-018（ADDED。#137）、db_schema: SPEC-NTA-DB-SCHEMA-025（MODIFIED）
 *
 * 期待値は差分の spec.md の本文・表・「例:」から決めている。例のホームディレクトリ `/Users/bonji` は、一時ディレクトリの
 * 下のフォルダー（HOME）に置き換える。ツールには DB のパスを渡さず、MCP サーバーと同じく環境変数
 * （HOUKI_NTA_DB_PATH・XDG_CACHE_HOME・HOME）で DB の場所を決める。国税庁サイトには取りに行かない。
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TAX_ANSWER_INDEX_URL, withTaxAnswerIndex } from '../../tests/support/tax-answer-index.js';
import { initSchema } from '../db/schema.js';
import {
  getTaxAnswer,
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

interface Body {
  code?: string;
  error?: string;
  hint?: string;
  retryable?: boolean;
  next_actions?: Array<{ action: string; example?: { command?: string } }>;
  results?: unknown[];
}

const ENV_KEYS = ['HOME', 'HOUKI_NTA_DB_PATH', 'XDG_CACHE_HOME'] as const;
let saved: Record<string, string | undefined>;
let dir: string;
/** テストのホームディレクトリ（例の `/Users/bonji` に当たる） */
let home: string;
/** 既定の DB の場所（`~/.cache/houki-nta-mcp/cache.db`） */
let defaultDb: string;
/** 作業フォルダーからの相対パスで作ったもの。afterEach で消す */
const relativeLeftovers: string[] = [];

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  dir = mkdtempSync(join(tmpdir(), 'houki-nta-db-location-'));
  home = join(dir, 'home');
  mkdirSync(home);
  defaultDb = join(home, '.cache', 'houki-nta-mcp', 'cache.db');
  setEnv({ HOME: home, HOUKI_NTA_DB_PATH: undefined, XDG_CACHE_HOME: undefined });
});

afterEach(() => {
  vi.useRealTimers();
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

/** 版 12 の DB を作り、文書を入れる。rows は [doc_type, doc_id, taxonomy, fetched_at] */
function makeDb(path: string, rows: Array<[string, string, string, string?]> = []): void {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  initSchema(db);
  const stmt = db.prepare(
    `INSERT INTO document(doc_type, doc_id, taxonomy, title, source_url, fetched_at, full_text, attached_pdfs_json)
     VALUES (?, ?, ?, ?, 'https://www.nta.go.jp/x.htm', ?, ?, '[]')`
  );
  for (const [docType, docId, taxonomy, fetchedAt] of rows) {
    stmt.run(
      docType,
      docId,
      taxonomy,
      `${docId} の題名`,
      fetchedAt ?? new Date().toISOString(),
      '軽減税率と贈与と医療費控除と社内会議の取扱い'
    );
  }
  db.close();
}

/** 0 バイトのファイル（版の記録が無い DB） */
function makeEmptyFile(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, '');
}

function command(body: Body): string | undefined {
  return body.next_actions?.find((a) => a.action === 'cli_bulk_download')?.example?.command;
}

/** DB は使えるがその種別が無いときの hint（SPEC-NTA-DB-SCHEMA-029 の表の最後の行） */
function kindMissing(path: string, label: string, docType: string, cmd: string): string {
  return `ローカル DB（${path}）に${label}（doc_type="${docType}"）が入っていません。\`${cmd}\` で投入してください。投入したはずの場合は、投入したシェルで \`${NPX} --status\` を実行し、表示される DB がこの DB と同じか確かめてください（MCP クライアントから起動したサーバーは、シェルの環境変数 HOUKI_NTA_DB_PATH・XDG_CACHE_HOME を受け継がないことがあります）`;
}

/** 読むだけのツールと、その `<種別>`・フラグ（SPEC-NTA-DB-SCHEMA-029 の下の表） */
const READ_TOOLS: Array<{
  tool: string;
  label: string;
  flag: string;
  /** cli_bulk_download の next_actions を持つか（nta_inspect_pdf_meta は持たない） */
  guides: boolean;
  call: () => Promise<unknown>;
}> = [
  {
    tool: 'nta_search_tsutatsu',
    label: '基本通達',
    flag: '--bulk-download-all',
    guides: true,
    call: () => searchTsutatsu({ keyword: '役員' }),
  },
  {
    tool: 'nta_search_qa',
    label: '質疑応答事例',
    flag: '--bulk-download-qa',
    guides: true,
    call: () => handleNtaSearchQa({ keyword: '社内会議' }),
  },
  {
    tool: 'nta_search_tax_answer',
    label: 'タックスアンサー',
    flag: '--bulk-download-tax-answer',
    guides: true,
    call: () => handleNtaSearchTaxAnswer({ keyword: '医療費控除' }),
  },
  {
    tool: 'nta_search_kaisei_tsutatsu',
    label: '改正通達',
    flag: '--bulk-download-kaisei',
    guides: true,
    call: () => handleNtaSearchKaiseiTsutatsu({ keyword: '改正' }),
  },
  {
    tool: 'nta_get_kaisei_tsutatsu',
    label: '改正通達',
    flag: '--bulk-download-kaisei',
    guides: true,
    call: () => handleNtaGetKaiseiTsutatsu({ docId: '0026003-067' }),
  },
  {
    tool: 'nta_search_jimu_unei',
    label: '事務運営指針',
    flag: '--bulk-download-jimu-unei',
    guides: true,
    call: () => handleNtaSearchJimuUnei({ keyword: '書面添付' }),
  },
  {
    tool: 'nta_get_jimu_unei',
    label: '事務運営指針',
    flag: '--bulk-download-jimu-unei',
    guides: true,
    call: () => handleNtaGetJimuUnei({ docId: 'shotoku/000101' }),
  },
  {
    tool: 'nta_search_bunshokaitou',
    label: '文書回答事例',
    flag: '--bulk-download-bunshokaitou',
    guides: true,
    call: () => handleNtaSearchBunshokaitou({ keyword: '適格請求書' }),
  },
  {
    tool: 'nta_get_bunshokaitou',
    label: '文書回答事例',
    flag: '--bulk-download-bunshokaitou',
    guides: true,
    call: () => handleNtaGetBunshokaitou({ docId: 'shotoku/250416' }),
  },
  {
    tool: 'nta_inspect_pdf_meta',
    label: '改正通達',
    flag: '--bulk-download-kaisei',
    guides: false,
    call: () => handleNtaInspectPdfMeta({ docType: 'kaisei', docId: '0026003-067' }),
  },
];

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-DB-SCHEMA-026                                                     */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-DB-SCHEMA-026 DB の場所を決めた設定を 4 つの名前で表し、表示と案内には DB の絶対パスを使う', () => {
  it('SPEC-NTA-DB-SCHEMA-026 環境変数が無ければ設定は「既定」で、DB は ~/.cache/houki-nta-mcp/cache.db、案内のコマンドに何も付けない', async () => {
    const body = (await handleNtaSearchQa({ keyword: '社内会議' })) as Body;
    expect(body.hint).toBe(
      `ローカル DB（~/.cache/houki-nta-mcp/cache.db）がありません。\`${NPX} --bulk-download-qa\` で質疑応答事例を投入してください`
    );
    expect(command(body)).toBe(`${NPX} --bulk-download-qa`);
  });

  it('SPEC-NTA-DB-SCHEMA-026 HOUKI_NTA_DB_PATH が相対パスなら、作業フォルダーから絶対パスにしたものを hint と案内のコマンドに使う（ファイルは作らない）', async () => {
    const top = `houki-nta-db-location-${process.pid}-${Date.now()}`;
    relativeLeftovers.push(resolve(top));
    const rel = `${top}/dev/cache.db`;
    setEnv({ HOUKI_NTA_DB_PATH: rel });
    const abs = resolve(rel);
    const body = (await handleNtaSearchQa({ keyword: '社内会議' })) as Body;
    expect(body.hint).toBe(
      `HOUKI_NTA_DB_PATH が指すファイル（${abs}）がありません。HOUKI_NTA_DB_PATH を投入した DB のファイルに直すか、\`HOUKI_NTA_DB_PATH='${abs}' ${NPX} --bulk-download-qa\` でこのパスに質疑応答事例を投入してください`
    );
    expect(command(body)).toBe(`HOUKI_NTA_DB_PATH='${abs}' ${NPX} --bulk-download-qa`);
    expect(existsSync(resolve(top))).toBe(false);
  });

  it('SPEC-NTA-DB-SCHEMA-026 HOUKI_NTA_DB_PATH が空文字で XDG_CACHE_HOME があれば、設定は XDG_CACHE_HOME で、DB は $XDG_CACHE_HOME/houki-nta-mcp/cache.db', async () => {
    const xdg = join(dir, 'data', 'cache');
    setEnv({ HOUKI_NTA_DB_PATH: '', XDG_CACHE_HOME: xdg });
    const body = (await handleNtaSearchQa({ keyword: '社内会議' })) as Body;
    expect(body.hint).toBe(
      `ローカル DB（${xdg}/houki-nta-mcp/cache.db）がありません。\`XDG_CACHE_HOME='${xdg}' ${NPX} --bulk-download-qa\` で質疑応答事例を投入してください`
    );
    expect(command(body)).toBe(`XDG_CACHE_HOME='${xdg}' ${NPX} --bulk-download-qa`);
  });

  it('SPEC-NTA-DB-SCHEMA-026 XDG_CACHE_HOME が相対パスなら、作業フォルダーから絶対パスにしたものを使う', async () => {
    const top = `houki-nta-db-location-xdg-${process.pid}-${Date.now()}`;
    relativeLeftovers.push(resolve(top));
    setEnv({ XDG_CACHE_HOME: top });
    const body = (await handleNtaSearchQa({ keyword: '社内会議' })) as Body;
    expect(body.hint).toBe(
      `ローカル DB（${resolve(top, 'houki-nta-mcp', 'cache.db')}）がありません。\`XDG_CACHE_HOME='${resolve(top)}' ${NPX} --bulk-download-qa\` で質疑応答事例を投入してください`
    );
    expect(existsSync(resolve(top))).toBe(false);
  });

  it('SPEC-NTA-DB-SCHEMA-026 XDG_CACHE_HOME が空文字なら「既定」', async () => {
    setEnv({ XDG_CACHE_HOME: '' });
    const body = (await handleNtaSearchQa({ keyword: '社内会議' })) as Body;
    expect(body.hint).toBe(
      `ローカル DB（~/.cache/houki-nta-mcp/cache.db）がありません。\`${NPX} --bulk-download-qa\` で質疑応答事例を投入してください`
    );
  });

  it('SPEC-NTA-DB-SCHEMA-026 HOUKI_NTA_DB_PATH は XDG_CACHE_HOME より先', async () => {
    const db = join(dir, 'y.db');
    setEnv({ HOUKI_NTA_DB_PATH: db, XDG_CACHE_HOME: join(dir, 'xdg') });
    const body = (await handleNtaSearchQa({ keyword: '社内会議' })) as Body;
    expect(command(body)).toBe(`HOUKI_NTA_DB_PATH='${db}' ${NPX} --bulk-download-qa`);
  });
});

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-DB-SCHEMA-027                                                     */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-DB-SCHEMA-027 案内のコマンドは npx -y @shuji-bonji/houki-nta-mcp@latest <フラグ> で、DB の場所を決めた設定を同じ形で付ける', () => {
  const cases: Array<[label: string, env: () => Record<string, string>, expected: () => string]> = [
    ['環境変数なし', () => ({}), () => `${NPX} --bulk-download-qa`],
    [
      'HOUKI_NTA_DB_PATH がホームディレクトリの下（~/.cache/houki-nta-mcp/cache.dev.db）',
      () => ({ HOUKI_NTA_DB_PATH: join(home, '.cache', 'houki-nta-mcp', 'cache.dev.db') }),
      () => `HOUKI_NTA_DB_PATH="$HOME/.cache/houki-nta-mcp/cache.dev.db" ${NPX} --bulk-download-qa`,
    ],
    [
      'HOUKI_NTA_DB_PATH がホームディレクトリの外',
      () => ({ HOUKI_NTA_DB_PATH: join(dir, 'x', 'cache.db') }),
      () => `HOUKI_NTA_DB_PATH='${join(dir, 'x', 'cache.db')}' ${NPX} --bulk-download-qa`,
    ],
    [
      'XDG_CACHE_HOME がホームディレクトリの下（~/Library/Caches）',
      () => ({ XDG_CACHE_HOME: join(home, 'Library', 'Caches') }),
      () => `XDG_CACHE_HOME="$HOME/Library/Caches" ${NPX} --bulk-download-qa`,
    ],
    [
      'ホームディレクトリの下で、残りに $ を含む（dev$1）',
      () => ({ HOUKI_NTA_DB_PATH: join(home, 'dev$1', 'cache.db') }),
      () => `HOUKI_NTA_DB_PATH="$HOME"'/dev$1/cache.db' ${NPX} --bulk-download-qa`,
    ],
    [
      "ホームディレクトリの下で、残りに $ と ' を含む",
      () => ({ HOUKI_NTA_DB_PATH: join(home, 'a$b', "it's.db") }),
      () => `HOUKI_NTA_DB_PATH="$HOME"'/a$b/it'\\''s.db' ${NPX} --bulk-download-qa`,
    ],
    [
      'ホームディレクトリの下で、残りに \' だけを含む（" で囲む形のまま）',
      () => ({ HOUKI_NTA_DB_PATH: join(home, "it's", 'cache.db') }),
      () => `HOUKI_NTA_DB_PATH="$HOME/it's/cache.db" ${NPX} --bulk-download-qa`,
    ],
    [
      'ホームディレクトリの下で、残りに ` \\ ! " のどれかを含む',
      () => ({ HOUKI_NTA_DB_PATH: join(home, 'a!b', 'cache.db') }),
      () => `HOUKI_NTA_DB_PATH="$HOME"'/a!b/cache.db' ${NPX} --bulk-download-qa`,
    ],
    [
      "ホームディレクトリの外で、' を含む",
      () => ({ HOUKI_NTA_DB_PATH: join(dir, "x'y", 'cache.db') }),
      () => `HOUKI_NTA_DB_PATH='${join(dir, 'x')}'\\''y/cache.db' ${NPX} --bulk-download-qa`,
    ],
  ];
  for (const [label, env, expected] of cases) {
    it(`SPEC-NTA-DB-SCHEMA-027 ${label}: next_actions の cli_bulk_download の example.command と hint の中のコマンド`, async () => {
      setEnv(env());
      const body = (await handleNtaSearchQa({ keyword: '社内会議' })) as Body;
      expect(command(body)).toBe(expected());
      expect(body.hint).toContain(`\`${expected()}\``);
    });
  }

  it('SPEC-NTA-DB-SCHEMA-027 フラグに続ける値も <フラグ> に含める（税目を絞った追加の案内）', async () => {
    setEnv({ HOUKI_NTA_DB_PATH: join(home, '.cache', 'houki-nta-mcp', 'cache.dev.db') });
    makeDb(join(home, '.cache', 'houki-nta-mcp', 'cache.dev.db'), [
      ['qa-jirei', 'shohi/02/19', 'shohi'],
    ]);
    const body = (await handleNtaSearchQa({ keyword: '軽減税率', topic: 'shotoku' })) as Body;
    expect(body.hint).toContain(
      `\`HOUKI_NTA_DB_PATH="$HOME/.cache/houki-nta-mcp/cache.dev.db" ${NPX} --bulk-download-qa --qa-topic=shotoku\``
    );
  });

  it('SPEC-NTA-DB-SCHEMA-027 「投入したシェルで … --status を実行し」のコマンドには変数を付けない', async () => {
    const path = join(dir, 'x', 'cache.db');
    setEnv({ HOUKI_NTA_DB_PATH: path });
    makeDb(path, [['tax-answer', '6101', 'shohi']]);
    const body = (await handleNtaSearchQa({ keyword: '社内会議' })) as Body;
    expect(body.hint).toContain(`投入したシェルで \`${NPX} --status\` を実行し`);
    expect(body.hint).toContain(
      `\`HOUKI_NTA_DB_PATH='${path}' ${NPX} --bulk-download-qa\` で投入してください`
    );
  });

  it('SPEC-NTA-DB-SCHEMA-027 フラグだけを書いた文（nta_inspect_pdf_meta の DB はあるがその文書が無いとき）は npx の形にしない', async () => {
    makeDb(defaultDb, [['kaisei', '0026003-001', 'shohi']]);
    const body = (await handleNtaInspectPdfMeta({
      docType: 'kaisei',
      docId: '0026003-067',
    })) as Body;
    expect(body.hint).toBe(
      '`--bulk-download-kaisei` で投入済みか確認してください。docId が正しいかも `nta_search_*` で検証可能'
    );
  });
});

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-DB-SCHEMA-028                                                     */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-DB-SCHEMA-028 MCP の応答に出す DB のパスは、ホームディレクトリの部分を ~ に置き換える', () => {
  it('SPEC-NTA-DB-SCHEMA-028 ホームディレクトリの下は ~ にする（~/.cache/houki-nta-mcp/cache.db）', async () => {
    const body = (await handleNtaSearchJimuUnei({ keyword: '書面添付' })) as Body;
    expect(body.hint).toContain('（~/.cache/houki-nta-mcp/cache.db）');
    expect(body.hint).not.toContain(home);
  });

  it('SPEC-NTA-DB-SCHEMA-028 区切りの位置で比べる（ホームが …/home のとき …/home2/cache.db は置き換えない）', async () => {
    const path = `${home}2/cache.db`;
    setEnv({ HOUKI_NTA_DB_PATH: path });
    const body = (await handleNtaSearchJimuUnei({ keyword: '書面添付' })) as Body;
    expect(body.hint).toContain(`（${path}）`);
    expect(command(body)).toBe(`HOUKI_NTA_DB_PATH='${path}' ${NPX} --bulk-download-jimu-unei`);
  });

  it('SPEC-NTA-DB-SCHEMA-028 ホームディレクトリの外のパスはそのまま', async () => {
    const path = join(dir, 'x', 'cache.db');
    setEnv({ HOUKI_NTA_DB_PATH: path });
    const body = (await handleNtaSearchJimuUnei({ keyword: '書面添付' })) as Body;
    expect(body.hint).toContain(`（${path}）`);
  });

  it('SPEC-NTA-DB-SCHEMA-028 ホームディレクトリが / のときは置き換えない', async () => {
    const path = join(dir, 'x', 'cache.db');
    setEnv({ HOME: '/', HOUKI_NTA_DB_PATH: path });
    const body = (await handleNtaSearchJimuUnei({ keyword: '書面添付' })) as Body;
    expect(body.hint).toContain(`（${path}）`);
    expect(command(body)).toBe(`HOUKI_NTA_DB_PATH='${path}' ${NPX} --bulk-download-jimu-unei`);
  });

  it('SPEC-NTA-DB-SCHEMA-028 大文字と小文字を区別する', async () => {
    const upper = home.toUpperCase();
    // 一時ディレクトリの名前に英小文字が無い環境ではこの確かめができない
    if (upper === home) return;
    setEnv({ HOME: upper, HOUKI_NTA_DB_PATH: join(home, 'cache.db') });
    const body = (await handleNtaSearchJimuUnei({ keyword: '書面添付' })) as Body;
    expect(body.hint).toContain(`（${join(home, 'cache.db')}）`);
  });

  it('SPEC-NTA-DB-SCHEMA-028 シンボリックリンクはたどらない（ホームがリンクで、DB のパスがリンク先の下なら置き換えない）', async () => {
    const link = join(dir, 'home-link');
    symlinkSync(home, link);
    setEnv({ HOME: link, HOUKI_NTA_DB_PATH: join(home, 'cache.db') });
    const body = (await handleNtaSearchJimuUnei({ keyword: '書面添付' })) as Body;
    expect(body.hint).toContain(`（${join(home, 'cache.db')}）`);
  });
});

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-DB-SCHEMA-029                                                     */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-DB-SCHEMA-029 読むだけのツールの「DB に 1 件も無い」ときの hint は、DB の状態ごとに先頭の文を決め、開こうとしたパスを入れる', () => {
  for (const t of READ_TOOLS) {
    it(`SPEC-NTA-DB-SCHEMA-029 ${t.tool}: ファイルが無い（既定）ときは「ローカル DB（<パス>）がありません。」で、<種別> は ${t.label}、フラグは ${t.flag}`, async () => {
      const body = (await t.call()) as Body;
      expect(body.hint).toBe(
        `ローカル DB（~/.cache/houki-nta-mcp/cache.db）がありません。\`${NPX} ${t.flag}\` で${t.label}を投入してください`
      );
      if (t.guides) expect(command(body)).toBe(`${NPX} ${t.flag}`);
      expect(existsSync(defaultDb)).toBe(false);
    });

    it(`SPEC-NTA-DB-SCHEMA-029 ${t.tool}: HOUKI_NTA_DB_PATH が指すファイルが無いときは別の文`, async () => {
      const path = join(home, '.cache', 'houki-nta-mcp', 'cache.v12.db');
      setEnv({ HOUKI_NTA_DB_PATH: path });
      const cmd = `HOUKI_NTA_DB_PATH="$HOME/.cache/houki-nta-mcp/cache.v12.db" ${NPX} ${t.flag}`;
      const body = (await t.call()) as Body;
      expect(body.hint).toBe(
        `HOUKI_NTA_DB_PATH が指すファイル（~/.cache/houki-nta-mcp/cache.v12.db）がありません。HOUKI_NTA_DB_PATH を投入した DB のファイルに直すか、\`${cmd}\` でこのパスに${t.label}を投入してください`
      );
      if (t.guides) expect(command(body)).toBe(cmd);
    });

    it(`SPEC-NTA-DB-SCHEMA-029 ${t.tool}: 0 バイトのファイル（版の記録が無い）は「にはまだ何も投入されていません」`, async () => {
      makeEmptyFile(defaultDb);
      const body = (await t.call()) as Body;
      expect(body.hint).toBe(
        `ローカル DB（~/.cache/houki-nta-mcp/cache.db）にはまだ何も投入されていません。\`${NPX} ${t.flag}\` で${t.label}を投入してください`
      );
    });
  }

  it('SPEC-NTA-DB-SCHEMA-029 schema_meta の無い SQLite のファイルも、版の記録が無い DB の文', async () => {
    mkdirSync(dirname(defaultDb), { recursive: true });
    const db = new Database(defaultDb);
    db.exec('CREATE TABLE other (x TEXT)');
    db.close();
    const body = (await handleNtaSearchQa({ keyword: '社内会議' })) as Body;
    expect(body.hint).toBe(
      `ローカル DB（~/.cache/houki-nta-mcp/cache.db）にはまだ何も投入されていません。\`${NPX} --bulk-download-qa\` で質疑応答事例を投入してください`
    );
  });

  it('SPEC-NTA-DB-SCHEMA-029 XDG_CACHE_HOME で決めた DB のファイルが無いときは、既定と同じ「ローカル DB（<パス>）がありません。」', async () => {
    setEnv({ XDG_CACHE_HOME: join(home, 'Library', 'Caches') });
    const body = (await handleNtaSearchJimuUnei({ keyword: '書面添付' })) as Body;
    expect(body.hint).toBe(
      `ローカル DB（~/Library/Caches/houki-nta-mcp/cache.db）がありません。\`XDG_CACHE_HOME="$HOME/Library/Caches" ${NPX} --bulk-download-jimu-unei\` で事務運営指針を投入してください`
    );
  });

  it('SPEC-NTA-DB-SCHEMA-029 タックスアンサーだけを入れた版 12 の DB で nta_search_qa を呼ぶと、その種別が無いときの文（--status で確かめる手順を含む）', async () => {
    makeDb(defaultDb, [['tax-answer', '6101', 'shohi']]);
    const body = (await handleNtaSearchQa({ keyword: '社内会議' })) as Body;
    expect(body.code).toBe('DOC_NOT_FOUND');
    expect(body.hint).toBe(
      kindMissing(
        '~/.cache/houki-nta-mcp/cache.db',
        '質疑応答事例',
        'qa-jirei',
        `${NPX} --bulk-download-qa`
      )
    );
    expect(command(body)).toBe(`${NPX} --bulk-download-qa`);
  });

  it('SPEC-NTA-DB-SCHEMA-029 nta_inspect_pdf_meta: タックスアンサーが 1 件も無い版 12 の DB では INSPECT-PDF-META-001 の文、ファイルが無いときは --bulk-download-tax-answer とタックスアンサー', async () => {
    makeDb(defaultDb, [['kaisei', '0026003-067', 'shohi']]);
    const inDb = (await handleNtaInspectPdfMeta({
      docType: 'tax-answer',
      docId: '6101',
    })) as Body;
    expect(inDb.hint).toBe(
      '`--bulk-download-tax-answer` で投入済みか確認してください。docId が正しいかも `nta_search_*` で検証可能'
    );
    rmSync(defaultDb);
    const missing = (await handleNtaInspectPdfMeta({
      docType: 'tax-answer',
      docId: '6101',
    })) as Body;
    expect(missing.hint).toBe(
      `ローカル DB（~/.cache/houki-nta-mcp/cache.db）がありません。\`${NPX} --bulk-download-tax-answer\` でタックスアンサーを投入してください`
    );
  });

  const inspectTypes: Array<[docType: string, docId: string, label: string, flag: string]> = [
    ['kaisei', '0026003-067', '改正通達', '--bulk-download-kaisei'],
    ['jimu-unei', 'shotoku/000101', '事務運営指針', '--bulk-download-jimu-unei'],
    ['bunshokaitou', 'shotoku/250416', '文書回答事例', '--bulk-download-bunshokaitou'],
    ['tax-answer', '6101', 'タックスアンサー', '--bulk-download-tax-answer'],
  ];
  for (const [docType, docId, label, flag] of inspectTypes) {
    it(`SPEC-NTA-DB-SCHEMA-029 nta_inspect_pdf_meta の docType="${docType}": <種別> は ${label}、フラグは ${flag}`, async () => {
      const body = (await handleNtaInspectPdfMeta({
        docType: docType as 'kaisei',
        docId,
      })) as Body;
      expect(body.code).toBe('DOC_NOT_FOUND');
      expect(body.hint).toBe(
        `ローカル DB（~/.cache/houki-nta-mcp/cache.db）がありません。\`${NPX} ${flag}\` で${label}を投入してください`
      );
    });
  }

  it('SPEC-NTA-DB-SCHEMA-029 code・error・next_actions の action は変えない（ファイルが無い nta_search_qa は DOC_NOT_FOUND と cli_bulk_download）', async () => {
    const body = (await handleNtaSearchQa({ keyword: '社内会議' })) as Body;
    expect(body.code).toBe('DOC_NOT_FOUND');
    expect(body.error).toBe(
      'ローカル DB に質疑応答事例が 1 件も無いため、検索できません（「該当なし」という結果ではありません）'
    );
    expect(body.next_actions?.map((a) => a.action)).toEqual(['cli_bulk_download']);
  });
});

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-DB-SCHEMA-021（読むだけのツールの hint の文）                       */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-DB-SCHEMA-021 DB の状態と入口ごとの扱い（読むだけのツールの hint の文）', () => {
  function makeVersioned(version: string): void {
    makeDb(defaultDb, [['jimu-unei', 'shozei/090401', 'shozei']]);
    const db = new Database(defaultDb);
    db.prepare(`UPDATE schema_meta SET value = ? WHERE key = 'schema_version'`).run(version);
    db.close();
  }

  it('SPEC-NTA-DB-SCHEMA-021 環境変数なしで版 13 の DB を開いた nta_search_jimu_unei { keyword: "書面添付" } の hint は「ローカル DB（~/…）の版 (13) が…」', async () => {
    makeVersioned('13');
    const body = (await handleNtaSearchJimuUnei({ keyword: '書面添付' })) as Body;
    expect(body.code).toBe('DOC_NOT_FOUND');
    expect(body.hint).toBe(
      'ローカル DB（~/.cache/houki-nta-mcp/cache.db）の版 (13) がこの houki-nta-mcp の版 (12) より新しいため、使っていません（DB は変更しません）。houki-nta-mcp を新しい版に更新してください'
    );
  });

  it('SPEC-NTA-DB-SCHEMA-021 版 2 の DB の hint は --quickstart の案内のコマンドを含む', async () => {
    makeVersioned('2');
    const body = (await handleNtaSearchJimuUnei({ keyword: '書面添付' })) as Body;
    expect(body.hint).toBe(
      `ローカル DB（~/.cache/houki-nta-mcp/cache.db）の版 (2) は古く移行できないため、使っていません。\`${NPX} --quickstart\` などの投入のフラグを実行すると作り直します（取り込んだ中身は消えます）`
    );
  });

  it('SPEC-NTA-DB-SCHEMA-021 版を読めない DB の hint は --quickstart の案内のコマンドを含む（HOUKI_NTA_DB_PATH で起動したときは変数付き）', async () => {
    const path = join(dir, 'x', 'cache.db');
    setEnv({ HOUKI_NTA_DB_PATH: path });
    makeDb(path);
    const db = new Database(path);
    db.prepare(`UPDATE schema_meta SET value = 'abc' WHERE key = 'schema_version'`).run();
    db.close();
    const body = (await handleNtaSearchJimuUnei({ keyword: '書面添付' })) as Body;
    expect(body.hint).toBe(
      `ローカル DB（${path}）の版を読めないため (schema_version: abc)、使っていません（DB は変更しません）。DB ファイルを消してから \`HOUKI_NTA_DB_PATH='${path}' ${NPX} --quickstart\` などの投入のフラグを実行してください`
    );
  });
});

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-COMMON-ERRORS-017                                                 */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-COMMON-ERRORS-017 DB の取得時点を解釈できないときは INTERNAL_ERROR（retryable: false）にし、その種別の投入をやり直す案内を付ける', () => {
  it('SPEC-NTA-COMMON-ERRORS-017 環境変数なしで fetched_at が 2026/05/08 の質疑応答事例だけの DB に nta_search_qa { keyword: "軽減税率" } を渡すと、hint と example.command が npx の形', async () => {
    makeDb(defaultDb, [['qa-jirei', 'shohi/02/19', 'shohi', '2026/05/08']]);
    const body = (await handleNtaSearchQa({ keyword: '軽減税率' })) as Body;
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.retryable).toBe(false);
    expect(body.error).toContain('2026/05/08');
    expect(body.hint).toContain(`\`${NPX} --bulk-download-qa\``);
    expect(command(body)).toBe(`${NPX} --bulk-download-qa`);
    expect(body.results).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* 検索ツールの「DB に 1 件も無い」・税目の範囲が空のとき                        */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-SEARCH-TSUTATSU-003 DB に条項が 1 件も無いときは、開こうとした DB のパスと、基本通達 4 種の bulk download を案内する', () => {
  it('SPEC-NTA-SEARCH-TSUTATSU-003 条項の無い版 12 の DB に { keyword: "役員" } を渡すと、DB のパスと 2 つの案内のコマンドを含む hint', async () => {
    makeDb(defaultDb);
    const body = (await searchTsutatsu({ keyword: '役員' })) as Body;
    expect(body.code).toBe('TSUTATSU_NOT_FOUND');
    expect(body.error).toBe('ローカル DB に検索対象がありません');
    expect(body.hint).toBe(
      `ローカル DB（~/.cache/houki-nta-mcp/cache.db）に基本通達の条項が入っていません。\`${NPX} --bulk-download-all\` を実行して、基本通達 4 種を投入してください。1 つの通達だけを先に入れるときは \`${NPX} --bulk-download --tsutatsu=<正式名>\` でも投入できます`
    );
    expect(command(body)).toBe(`${NPX} --bulk-download-all`);
  });

  it('SPEC-NTA-SEARCH-TSUTATSU-003 DB のファイルが無いときは「ローカル DB（<パス>）がありません。」', async () => {
    const body = (await searchTsutatsu({ keyword: '役員' })) as Body;
    expect(body.hint).toBe(
      `ローカル DB（~/.cache/houki-nta-mcp/cache.db）がありません。\`${NPX} --bulk-download-all\` で基本通達を投入してください`
    );
  });
});

describe('SPEC-NTA-SEARCH-QA-001 質疑応答事例が DB に 1 件も無いときはエラー DOC_NOT_FOUND', () => {
  it('SPEC-NTA-SEARCH-QA-001 タックスアンサーだけを入れた DB で { keyword: "社内会議" } を渡すと、hint は「ローカル DB（~/…）に質疑応答事例…」で始まる', async () => {
    makeDb(defaultDb, [['tax-answer', '6101', 'shohi']]);
    const body = (await handleNtaSearchQa({ keyword: '社内会議' })) as Body;
    expect(body.code).toBe('DOC_NOT_FOUND');
    expect(
      body.hint?.startsWith(
        `ローカル DB（~/.cache/houki-nta-mcp/cache.db）に質疑応答事例（doc_type="qa-jirei"）が入っていません。\`${NPX} --bulk-download-qa\` で投入してください。`
      )
    ).toBe(true);
    expect(command(body)).toBe(`${NPX} --bulk-download-qa`);
  });
});

describe('SPEC-NTA-SEARCH-QA-005 topic の範囲に事例が 1 件も無いときは税目の一覧と投入コマンドを案内する', () => {
  it('SPEC-NTA-SEARCH-QA-005 shohi の事例だけの DB で { keyword: "軽減税率", topic: "shotoku" } を渡すと、hint の末尾は npx の形の --qa-topic=shotoku', async () => {
    makeDb(defaultDb, [['qa-jirei', 'shohi/02/19', 'shohi']]);
    const body = (await handleNtaSearchQa({ keyword: '軽減税率', topic: 'shotoku' })) as Body & {
      available_taxonomies?: string[];
    };
    expect(body.code).toBeUndefined();
    expect(body.results).toEqual([]);
    expect(body.available_taxonomies).toEqual(['shohi']);
    expect(
      body.hint?.endsWith(
        `税目を絞って投入した場合は、\`${NPX} --bulk-download-qa --qa-topic=shotoku\` で追加できます`
      )
    ).toBe(true);
  });
});

describe('SPEC-NTA-SEARCH-TAX-ANSWER-001 DB にタックスアンサーが 1 件も無いときは「該当なし」ではなくエラーを返す', () => {
  it('SPEC-NTA-SEARCH-TAX-ANSWER-001 質疑応答事例だけを入れた DB で keyword: "医療費控除" を検索すると、hint は「ローカル DB（~/…）にタックスアンサー…」で始まる', async () => {
    makeDb(defaultDb, [['qa-jirei', 'shohi/02/19', 'shohi']]);
    const body = (await handleNtaSearchTaxAnswer({ keyword: '医療費控除' })) as Body;
    expect(body.code).toBe('DOC_NOT_FOUND');
    expect(
      body.hint?.startsWith(
        `ローカル DB（~/.cache/houki-nta-mcp/cache.db）にタックスアンサー（doc_type="tax-answer"）が入っていません。\`${NPX} --bulk-download-tax-answer\` で投入してください。`
      )
    ).toBe(true);
    expect(command(body)).toBe(`${NPX} --bulk-download-tax-answer`);
  });
});

describe('SPEC-NTA-SEARCH-KAISEI-TSUTATSU-001 DB に改正通達が 1 件も無いときは検索せずにエラーを返す', () => {
  it('SPEC-NTA-SEARCH-KAISEI-TSUTATSU-001 HOUKI_NTA_DB_PATH が指すファイルが無いときに { keyword: "改正" } を渡すと、HOUKI_NTA_DB_PATH の文と変数付きのコマンド', async () => {
    const path = join(dir, 'x', 'cache.db');
    setEnv({ HOUKI_NTA_DB_PATH: path });
    const body = (await handleNtaSearchKaiseiTsutatsu({ keyword: '改正' })) as Body;
    expect(body.code).toBe('DOC_NOT_FOUND');
    expect(body.hint).toBe(
      `HOUKI_NTA_DB_PATH が指すファイル（${path}）がありません。HOUKI_NTA_DB_PATH を投入した DB のファイルに直すか、\`HOUKI_NTA_DB_PATH='${path}' ${NPX} --bulk-download-kaisei\` でこのパスに改正通達を投入してください`
    );
    expect(command(body)).toBe(`HOUKI_NTA_DB_PATH='${path}' ${NPX} --bulk-download-kaisei`);
  });
});

describe('SPEC-NTA-SEARCH-JIMU-UNEI-001 DB に事務運営指針が 1 件も無いときはエラー DOC_NOT_FOUND を返す', () => {
  it('SPEC-NTA-SEARCH-JIMU-UNEI-001 ~/.cache/houki-nta-mcp/cache.db が無いときに { keyword: "書面添付" } を渡すと、ファイルが無いときの文', async () => {
    const body = (await handleNtaSearchJimuUnei({ keyword: '書面添付' })) as Body;
    expect(body.code).toBe('DOC_NOT_FOUND');
    expect(body.error).toBe(
      'ローカル DB に事務運営指針が 1 件も無いため、検索できません（「該当なし」という結果ではありません）'
    );
    expect(body.hint).toBe(
      `ローカル DB（~/.cache/houki-nta-mcp/cache.db）がありません。\`${NPX} --bulk-download-jimu-unei\` で事務運営指針を投入してください`
    );
    expect(command(body)).toBe(`${NPX} --bulk-download-jimu-unei`);
  });
});

describe('SPEC-NTA-SEARCH-BUNSHOKAITOU-001 文書回答事例が DB に 1 件も無いときは検索できないことをエラーで返す', () => {
  it('SPEC-NTA-SEARCH-BUNSHOKAITOU-001 0 バイトの cache.db で { keyword: "適格請求書" } を渡すと、版の記録が無いときの文', async () => {
    makeEmptyFile(defaultDb);
    const body = (await handleNtaSearchBunshokaitou({ keyword: '適格請求書' })) as Body;
    expect(body.code).toBe('DOC_NOT_FOUND');
    expect(body.hint).toBe(
      `ローカル DB（~/.cache/houki-nta-mcp/cache.db）にはまだ何も投入されていません。\`${NPX} --bulk-download-bunshokaitou\` で文書回答事例を投入してください`
    );
  });
});

describe('SPEC-NTA-SEARCH-BUNSHOKAITOU-002 税目の範囲に文書が無いときは税目の一覧と投入コマンドを案内する', () => {
  it('SPEC-NTA-SEARCH-BUNSHOKAITOU-002 sozoku と zoyo の文書だけの DB で { keyword: "贈与", taxonomy: "gensenshotoku" } を渡すと、末尾は npx の形の --bunsho-taxonomy=gensen', async () => {
    makeDb(defaultDb, [
      ['bunshokaitou', 'sozoku/250101', 'sozoku'],
      ['bunshokaitou', 'zoyo/250102', 'zoyo'],
    ]);
    const body = (await handleNtaSearchBunshokaitou({
      keyword: '贈与',
      taxonomy: 'gensenshotoku',
    })) as Body;
    expect(body.code).toBeUndefined();
    expect(
      body.hint?.endsWith(
        `\`${NPX} --bulk-download-bunshokaitou --bunsho-taxonomy=gensen\` で追加できます`
      )
    ).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* 取得ツールの「DB に 1 件も無い」・docId が無いとき                           */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-GET-KAISEI-TSUTATSU-001 ローカル DB に改正通達が 1 件も無いときは投入を案内する', () => {
  it('SPEC-NTA-GET-KAISEI-TSUTATSU-001 質疑応答事例だけを入れた DB で { docId: "0026003-067" } を渡すと、hint は「ローカル DB（~/…）に改正通達…」で始まる', async () => {
    makeDb(defaultDb, [['qa-jirei', 'shohi/02/19', 'shohi']]);
    const body = (await handleNtaGetKaiseiTsutatsu({ docId: '0026003-067' })) as Body;
    expect(body.code).toBe('DOC_NOT_FOUND');
    expect(
      body.hint?.startsWith(
        `ローカル DB（~/.cache/houki-nta-mcp/cache.db）に改正通達（doc_type="kaisei"）が入っていません。\`${NPX} --bulk-download-kaisei\` で投入してください。`
      )
    ).toBe(true);
    expect(command(body)).toBe(`${NPX} --bulk-download-kaisei`);
  });
});

describe('SPEC-NTA-GET-KAISEI-TSUTATSU-002 改正通達はあるが docId が無いときは「見つかりません」と候補を返す', () => {
  it('SPEC-NTA-GET-KAISEI-TSUTATSU-002 hint の末尾は npx の形の --bulk-download-kaisei', async () => {
    makeDb(defaultDb, [['kaisei', '0026003-001', 'shohi']]);
    const body = (await handleNtaGetKaiseiTsutatsu({ docId: '0026003-067' })) as Body;
    expect(
      body.hint?.endsWith(
        `DB を投入した後に国税庁が公開した文書は、\`${NPX} --bulk-download-kaisei\` をもう一度実行すると取り込めます`
      )
    ).toBe(true);
  });
});

describe('SPEC-NTA-GET-JIMU-UNEI-001 事務運営指針が DB に 1 件も無いときは投入を案内する', () => {
  it('SPEC-NTA-GET-JIMU-UNEI-001 HOUKI_NTA_DB_PATH=~/.cache/houki-nta-mcp/cache.v12.db（無いファイル）で { docId: "shotoku/000101" } を渡すと、HOUKI_NTA_DB_PATH の文で "$HOME/…" の形', async () => {
    setEnv({ HOUKI_NTA_DB_PATH: join(home, '.cache', 'houki-nta-mcp', 'cache.v12.db') });
    const body = (await handleNtaGetJimuUnei({ docId: 'shotoku/000101' })) as Body;
    expect(body.code).toBe('DOC_NOT_FOUND');
    expect(body.hint).toBe(
      `HOUKI_NTA_DB_PATH が指すファイル（~/.cache/houki-nta-mcp/cache.v12.db）がありません。HOUKI_NTA_DB_PATH を投入した DB のファイルに直すか、\`HOUKI_NTA_DB_PATH="$HOME/.cache/houki-nta-mcp/cache.v12.db" ${NPX} --bulk-download-jimu-unei\` でこのパスに事務運営指針を投入してください`
    );
  });
});

describe('SPEC-NTA-GET-JIMU-UNEI-002 事務運営指針はあるが docId が無いときは「見つかりません」と候補を返す', () => {
  it('SPEC-NTA-GET-JIMU-UNEI-002 hint の末尾は npx の形の --bulk-download-jimu-unei', async () => {
    makeDb(defaultDb, [['jimu-unei', 'shozei/090401', 'shozei']]);
    const body = (await handleNtaGetJimuUnei({ docId: 'shotoku/000101' })) as Body;
    expect(
      body.hint?.endsWith(
        `DB を投入した後に国税庁が公開した文書は、\`${NPX} --bulk-download-jimu-unei\` をもう一度実行すると取り込めます`
      )
    ).toBe(true);
  });
});

describe('SPEC-NTA-GET-BUNSHOKAITOU-002 DB に文書回答事例が 1 件も無いときは投入を案内する', () => {
  it('SPEC-NTA-GET-BUNSHOKAITOU-002 改正通達だけを入れた DB で { docId: "shotoku/250416" } を渡すと、hint は「ローカル DB（~/…）に文書回答事例…」で始まる', async () => {
    makeDb(defaultDb, [['kaisei', '0026003-067', 'shohi']]);
    const body = (await handleNtaGetBunshokaitou({ docId: 'shotoku/250416' })) as Body;
    expect(body.code).toBe('DOC_NOT_FOUND');
    expect(
      body.hint?.startsWith(
        `ローカル DB（~/.cache/houki-nta-mcp/cache.db）に文書回答事例（doc_type="bunshokaitou"）が入っていません。\`${NPX} --bulk-download-bunshokaitou\` で投入してください。`
      )
    ).toBe(true);
  });
});

describe('SPEC-NTA-GET-BUNSHOKAITOU-003 文書はあるが docId が無いときは「見つかりません」と候補を返す', () => {
  it('SPEC-NTA-GET-BUNSHOKAITOU-003 hint の末尾は npx の形の --bulk-download-bunshokaitou', async () => {
    makeDb(defaultDb, [['bunshokaitou', 'sozoku/250101', 'sozoku']]);
    const body = (await handleNtaGetBunshokaitou({ docId: 'shotoku/250416' })) as Body;
    expect(
      body.hint?.endsWith(
        `DB を投入した後に国税庁が公開した文書は、\`${NPX} --bulk-download-bunshokaitou\` をもう一度実行すると取り込めます`
      )
    ).toBe(true);
  });
});

describe('SPEC-NTA-INSPECT-PDF-META-001 ローカル DB に無い文書は取りに行かない', () => {
  it('SPEC-NTA-INSPECT-PDF-META-001 ~/.cache/houki-nta-mcp/cache.db が無いときに { docType: "kaisei", docId: "0026003-067" } を渡すと、ファイルが無いときの文', async () => {
    const body = (await handleNtaInspectPdfMeta({
      docType: 'kaisei',
      docId: '0026003-067',
    })) as Body;
    expect(body.code).toBe('DOC_NOT_FOUND');
    expect(body.hint).toBe(
      `ローカル DB（~/.cache/houki-nta-mcp/cache.db）がありません。\`${NPX} --bulk-download-kaisei\` で改正通達を投入してください`
    );
  });

  it('SPEC-NTA-INSPECT-PDF-META-001 版 12 の DB にタックスアンサー 6101 が無いときに { docType: "tax-answer", docId: "6101" } を渡すと --bulk-download-tax-answer の文', async () => {
    makeDb(defaultDb, [['tax-answer', '6102', 'shohi']]);
    const body = (await handleNtaInspectPdfMeta({
      docType: 'tax-answer',
      docId: '6101',
    })) as Body;
    expect(body.code).toBe('DOC_NOT_FOUND');
    expect(body.hint).toBe(
      '`--bulk-download-tax-answer` で投入済みか確認してください。docId が正しいかも `nta_search_*` で検証可能'
    );
  });
});

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-SEARCH-RULES-022・017（freshness）                                 */
/* -------------------------------------------------------------------------- */

interface FreshnessBody extends Body {
  freshness?: Record<string, unknown>;
  hits?: Array<{ clauseNumber?: string; snippet?: string }>;
  count?: number;
}

/** 範囲に文書が無いときの freshness（SPEC-NTA-SEARCH-RULES-022） */
function nullRange(dbPath: string): Record<string, unknown> {
  return {
    oldest_fetched_at: null,
    newest_fetched_at: null,
    staleness: null,
    days_since_oldest: null,
    db_path: dbPath,
  };
}

function callAt(iso: string): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
}

/** 通達の条項と節を入れた版 12 の DB（法人税基本通達 9-2-1「役員の範囲」） */
function makeTsutatsuDb(path: string, fetchedAt: string): void {
  makeDb(path);
  const db = new Database(path);
  const id = (
    db
      .prepare(
        'INSERT INTO tsutatsu(formal_name, abbr, source_root_url) VALUES (?, ?, ?) RETURNING id'
      )
      .get('法人税基本通達', '法基通', 'https://www.nta.go.jp/law/tsutatsu/kihon/hojin/') as {
      id: number;
    }
  ).id;
  const url = 'https://www.nta.go.jp/law/tsutatsu/kihon/hojin/09/09_02_01.htm';
  db.prepare(
    `INSERT INTO section(tsutatsu_id, chapter_number, section_number, title, url, fetched_at)
     VALUES (?, 9, 2, '役員の範囲等', ?, ?)`
  ).run(id, url, fetchedAt);
  db.prepare(
    `INSERT INTO clause(tsutatsu_id, clause_number, source_url, chapter_number, section_number, title, full_text, paragraphs_json)
     VALUES (?, '9-2-1', ?, 9, 2, '役員の範囲', ?, ?)`
  ).run(
    id,
    url,
    '法第2条第15号に規定する役員の範囲について定める。',
    JSON.stringify([{ indent: 1, text: '法第2条第15号に規定する役員の範囲について定める。' }])
  );
  db.close();
}

describe('SPEC-NTA-SEARCH-RULES-022 検索 6 ツールの成功の応答は freshness を常に持ち、db_path に引いた DB のパスを入れる', () => {
  it('SPEC-NTA-SEARCH-RULES-022 既定の DB で nta_search_qa { keyword: "源泉徴収" } を呼ぶと、freshness は取得日時の 4 つと db_path: "~/.cache/houki-nta-mcp/cache.db"', async () => {
    callAt('2026-10-04T05:00:00Z');
    makeDb(defaultDb, [
      ['qa-jirei', 'gensen/01/01', 'gensen', '2026-10-04T03:51:26.746Z'],
      ['qa-jirei', 'gensen/01/02', 'gensen', '2026-10-04T04:26:15.744Z'],
    ]);
    const db = new Database(defaultDb);
    db.prepare(`UPDATE document SET full_text = '源泉徴収の取扱い'`).run();
    db.close();
    const body = (await handleNtaSearchQa({ keyword: '源泉徴収' })) as FreshnessBody;
    expect(body.code).toBeUndefined();
    expect(body.freshness).toEqual({
      oldest_fetched_at: '2026-10-04T03:51:26.746Z',
      newest_fetched_at: '2026-10-04T04:26:15.744Z',
      staleness: 'fresh',
      days_since_oldest: 0,
      db_path: '~/.cache/houki-nta-mcp/cache.db',
    });
  });

  it('SPEC-NTA-SEARCH-RULES-022 HOUKI_NTA_DB_PATH（ホームディレクトリの外）で起動すると db_path はそのパス', async () => {
    const path = join(dir, 'x', 'cache.db');
    setEnv({ HOUKI_NTA_DB_PATH: path });
    makeDb(path, [['qa-jirei', 'shohi/02/19', 'shohi']]);
    const body = (await handleNtaSearchQa({ keyword: '軽減税率' })) as FreshnessBody;
    expect(body.freshness?.db_path).toBe(path);
  });

  it('SPEC-NTA-SEARCH-RULES-022 キーワードに合わない 0 件の成功の応答にも freshness と db_path を置く', async () => {
    makeDb(defaultDb, [['jimu-unei', 'shozei/090401', 'shozei']]);
    const body = (await handleNtaSearchJimuUnei({
      keyword: '該当しない語句の組み合わせ',
    })) as FreshnessBody;
    expect(body.code).toBeUndefined();
    expect(body.results).toEqual([]);
    expect(body.freshness?.db_path).toBe('~/.cache/houki-nta-mcp/cache.db');
    expect(body.freshness?.staleness).toBe('fresh');
  });

  it('SPEC-NTA-SEARCH-RULES-022 範囲に文書が無い（例 4 の taxonomy: "hojin"）ときは、取得日時の 4 つを null にし、db_path だけが値を持つ', async () => {
    callAt('2026-10-04T05:00:00Z');
    makeDb(defaultDb, [
      ['kaisei', 'kaisei-hojin-orphaned', 'hojin', '2026-09-01T00:00:00Z'],
      ['kaisei', 'kaisei-shohi-indexed', 'shohi', '2026-10-04T03:30:00Z'],
    ]);
    const db = new Database(defaultDb);
    db.prepare(
      `UPDATE document SET orphaned_at = '2026-10-04T03:40:00Z' WHERE doc_id = 'kaisei-hojin-orphaned'`
    ).run();
    db.close();
    const body = (await handleNtaSearchKaiseiTsutatsu({
      keyword: '軽減税率',
      taxonomy: 'hojin',
    })) as FreshnessBody;
    expect(body.code).toBeUndefined();
    expect(body.freshness).toEqual(nullRange('~/.cache/houki-nta-mcp/cache.db'));
  });

  it('SPEC-NTA-SEARCH-RULES-022 nta_search_tsutatsu で判定できる節が無い（条項はあるが節の行が無い）ときも freshness を付け、取得日時の 4 つを null にする', async () => {
    makeTsutatsuDb(defaultDb, '2026-10-04T03:14:49.904Z');
    const db = new Database(defaultDb);
    db.exec('DELETE FROM section');
    db.close();
    const body = (await searchTsutatsu({ keyword: '役員' })) as FreshnessBody;
    expect(body.count).toBe(1);
    expect(body.freshness).toEqual(nullRange('~/.cache/houki-nta-mcp/cache.db'));
  });

  it('SPEC-NTA-SEARCH-RULES-022 エラーの応答（DOC_NOT_FOUND）には freshness を置かない', async () => {
    const body = (await handleNtaSearchQa({ keyword: '社内会議' })) as FreshnessBody;
    expect(body.code).toBe('DOC_NOT_FOUND');
    expect(body.freshness).toBeUndefined();
  });

  const tools: Array<[tool: string, docType: string, call: () => Promise<unknown>]> = [
    ['nta_search_qa', 'qa-jirei', () => handleNtaSearchQa({ keyword: '軽減税率' })],
    [
      'nta_search_tax_answer',
      'tax-answer',
      () => handleNtaSearchTaxAnswer({ keyword: '軽減税率' }),
    ],
    [
      'nta_search_kaisei_tsutatsu',
      'kaisei',
      () => handleNtaSearchKaiseiTsutatsu({ keyword: '軽減税率' }),
    ],
    ['nta_search_jimu_unei', 'jimu-unei', () => handleNtaSearchJimuUnei({ keyword: '軽減税率' })],
    [
      'nta_search_bunshokaitou',
      'bunshokaitou',
      () => handleNtaSearchBunshokaitou({ keyword: '軽減税率' }),
    ],
  ];
  for (const [tool, docType, call] of tools) {
    it(`SPEC-NTA-SEARCH-RULES-022 ${tool}: ヒットした応答の freshness は oldest_fetched_at・newest_fetched_at・staleness・days_since_oldest・db_path を持つ`, async () => {
      makeDb(defaultDb, [[docType, docType === 'tax-answer' ? '6101' : 'shohi/250101', 'shohi']]);
      const body = (await call()) as FreshnessBody;
      expect(body.code).toBeUndefined();
      expect(Object.keys(body.freshness ?? {}).sort()).toEqual([
        'days_since_oldest',
        'db_path',
        'newest_fetched_at',
        'oldest_fetched_at',
        'staleness',
      ]);
      expect(body.freshness?.db_path).toBe('~/.cache/houki-nta-mcp/cache.db');
    });
  }
});

describe('SPEC-NTA-SEARCH-RULES-017 freshness は DB の取得時点の範囲と段階と DB のパスを返し、古いときだけ warning を付ける', () => {
  it('SPEC-NTA-SEARCH-RULES-017 例 1: 2026-01-01 と 2026-09-25 の質疑応答事例の DB で 2026-09-27 に呼ぶと、warning のコマンドは npx の形', async () => {
    callAt('2026-09-27T00:00:00Z');
    makeDb(defaultDb, [
      ['qa-jirei', 'shohi/02/19', 'shohi', '2026-01-01T00:00:00Z'],
      ['qa-jirei', 'shohi/02/20', 'shohi', '2026-09-25T00:00:00Z'],
    ]);
    const body = (await handleNtaSearchQa({ keyword: '軽減税率' })) as FreshnessBody;
    expect(body.freshness).toEqual({
      oldest_fetched_at: '2026-01-01T00:00:00Z',
      newest_fetched_at: '2026-09-25T00:00:00Z',
      staleness: 'outdated',
      days_since_oldest: 269,
      db_path: '~/.cache/houki-nta-mcp/cache.db',
      warning: `一部ドキュメントが 269 日前のデータです。最新化するには \`${NPX} --bulk-download-qa\` を実行してください`,
    });
  });

  it('SPEC-NTA-SEARCH-RULES-017 例 1: HOUKI_NTA_DB_PATH=<ホームの外>/cache.db で起動したときの warning のコマンドは変数付き', async () => {
    callAt('2026-09-27T00:00:00Z');
    const path = join(dir, 'x', 'cache.db');
    setEnv({ HOUKI_NTA_DB_PATH: path });
    makeDb(path, [
      ['qa-jirei', 'shohi/02/19', 'shohi', '2026-01-01T00:00:00Z'],
      ['qa-jirei', 'shohi/02/20', 'shohi', '2026-09-25T00:00:00Z'],
    ]);
    const body = (await handleNtaSearchQa({ keyword: '軽減税率' })) as FreshnessBody;
    expect(body.freshness?.warning).toBe(
      `一部ドキュメントが 269 日前のデータです。最新化するには \`HOUKI_NTA_DB_PATH='${path}' ${NPX} --bulk-download-qa\` を実行してください`
    );
  });

  it('SPEC-NTA-SEARCH-RULES-017 nta_search_tsutatsu の warning のフラグは --bulk-download-all', async () => {
    callAt('2026-10-04T05:00:00Z');
    makeTsutatsuDb(defaultDb, '2026-01-01T00:00:00Z');
    const body = (await searchTsutatsu({ keyword: '役員' })) as FreshnessBody;
    expect(body.freshness?.warning).toBe(
      `一部ドキュメントが 276 日前のデータです。最新化するには \`${NPX} --bulk-download-all\` を実行してください`
    );
  });
});

describe('SPEC-NTA-SEARCH-TSUTATSU-004 キーワードに合う条項があれば count と hits を返す', () => {
  it('SPEC-NTA-SEARCH-TSUTATSU-004 { keyword: "役員" } で 9-2-1 があれば count 1、snippet に <b>役員</b>、freshness.db_path は ~/.cache/houki-nta-mcp/cache.db', async () => {
    makeTsutatsuDb(defaultDb, new Date().toISOString());
    const body = (await searchTsutatsu({ keyword: '役員' })) as FreshnessBody;
    expect(body.count).toBe(1);
    expect(body.hits?.[0]?.clauseNumber).toBe('9-2-1');
    expect(body.hits?.[0]?.snippet).toContain('<b>役員</b>');
    expect(body.freshness?.db_path).toBe('~/.cache/houki-nta-mcp/cache.db');
  });
});

describe('SPEC-NTA-SEARCH-QA-005 topic の範囲に事例が 1 件も無いときは税目の一覧と投入コマンドを案内する', () => {
  it('SPEC-NTA-SEARCH-QA-005 freshness は DB の質疑応答事例全体の取得時点と DB のパス', async () => {
    makeDb(defaultDb, [['qa-jirei', 'shohi/02/19', 'shohi', '2026-10-04T04:26:15.744Z']]);
    const body = (await handleNtaSearchQa({
      keyword: '軽減税率',
      topic: 'shotoku',
    })) as FreshnessBody;
    expect(body.freshness?.oldest_fetched_at).toBe('2026-10-04T04:26:15.744Z');
    expect(body.freshness?.db_path).toBe('~/.cache/houki-nta-mcp/cache.db');
  });
});

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-GET-TAX-ANSWER-018・SPEC-NTA-DB-SCHEMA-025（#137）                  */
/* -------------------------------------------------------------------------- */

const ARTICLE_HTML = readFileSync(
  join(
    import.meta.dirname,
    '../../tests/fixtures/www.nta.go.jp_taxes_shiraberu_taxanswer_shohi_6101.htm'
  ),
  'utf8'
);

interface TaxAnswerBody extends Body {
  source?: string;
  taxAnswer?: { no?: string };
  isError?: boolean;
}

interface WarnLine {
  level: string;
  scope: string;
  msg: string;
  meta: { table: string; db_path: string; error: { name: string; message: string } };
}

/** 索引の要求のヘッダーを記録しながら、測った索引と No.6101 の記事を返す fetch */
function siteRecordingIndexHeaders(indexInits: Array<Record<string, string>>): typeof fetch {
  const article = (async () =>
    new Response(ARTICLE_HTML, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=UTF-8' },
    })) as unknown as typeof fetch;
  const inner = withTaxAnswerIndex(article);
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === TAX_ANSWER_INDEX_URL) {
      indexInits.push(Object.fromEntries(new Headers(init?.headers ?? {}).entries()));
    }
    return inner(input, init);
  }) as typeof fetch;
}

function captureWarns(): { lines: () => WarnLine[]; restore: () => void } {
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
        .map((l) => JSON.parse(l) as WarnLine)
        .filter((l) => l.level === 'warn' && l.scope === 'nta_get_tax_answer'),
    restore: () => spy.mockRestore(),
  };
}

function pageFetchedAt(path: string): string | undefined {
  const db = new Database(path, { readonly: true });
  try {
    return (
      db.prepare('SELECT fetched_at FROM tax_answer_index_page').get() as
        | { fetched_at: string }
        | undefined
    )?.fetched_at;
  } finally {
    db.close();
  }
}

/** 例の壊れた表の DB（tax_answer_index に url の列が無く、tax_answer_index_page に行がある） */
function makeBrokenIndexDb(path: string): void {
  makeDb(path);
  const db = new Database(path);
  db.exec(
    'DROP TABLE tax_answer_index; CREATE TABLE tax_answer_index (no TEXT PRIMARY KEY, taxonomy TEXT NOT NULL, title TEXT NOT NULL);'
  );
  db.prepare(
    `INSERT INTO tax_answer_index_page(url, fetched_at, last_modified, etag) VALUES (?, ?, NULL, ?)`
  ).run(TAX_ANSWER_INDEX_URL, '2026-10-01T00:00:00.000Z', '"25b0a-65b81bf96ae40"');
  db.close();
}

describe('SPEC-NTA-GET-TAX-ANSWER-018 保存した索引を読めない・保存できないときも記事を返し、MCP サーバーのログに warn で残す', () => {
  it('SPEC-NTA-GET-TAX-ANSWER-018 例（壊れた表の DB）: 索引を条件なしで取り、記事を返し、読めない・保存できないの warn を 2 行出し、tax_answer_index_page は前のまま', async () => {
    const path = join(dir, 'broken.db');
    makeBrokenIndexDb(path);
    const indexInits: Array<Record<string, string>> = [];
    const warns = captureWarns();
    let body: TaxAnswerBody;
    try {
      body = (await getTaxAnswer(
        { no: '6101', format: 'json' },
        { fetchImpl: siteRecordingIndexHeaders(indexInits), dbPath: path }
      )) as TaxAnswerBody;
    } finally {
      warns.restore();
    }
    expect(body.code).toBeUndefined();
    expect(body.isError).toBeUndefined();
    expect(body.source).toBe('live');
    expect(body.taxAnswer?.no).toBe('6101');
    expect(indexInits).toHaveLength(1);
    expect(indexInits[0]['if-none-match']).toBeUndefined();
    expect(indexInits[0]['if-modified-since']).toBeUndefined();
    const lines = warns.lines();
    expect(lines).toHaveLength(2);
    expect(lines[0].msg).toBe(
      `保存したタックスアンサーの索引を読めないため、国税庁サイトから取り直します（表: tax_answer_index、DB: ${path}）`
    );
    expect(lines[0].meta.table).toBe('tax_answer_index');
    expect(lines[0].meta.db_path).toBe(path);
    expect(typeof lines[0].meta.error.name).toBe('string');
    expect(lines[0].meta.error.message).toContain('url');
    expect(lines[1].msg).toBe(
      `タックスアンサーの索引を DB に保存できませんでした（表: tax_answer_index、DB: ${path}）`
    );
    expect(lines[1].meta).toMatchObject({ table: 'tax_answer_index', db_path: path });
    expect(lines[1].meta.error.message).toContain('url');
    expect(pageFetchedAt(path)).toBe('2026-10-01T00:00:00.000Z');
  });

  it('SPEC-NTA-GET-TAX-ANSWER-018 例: 同じ DB でもう一度、記事の URL を索引で決める呼び出しをすると（1 回目に書き戻した記事の行を消してから呼ぶ。記事の行があると 016 の前の DB の経路で返り、索引を引かない）、同じく索引を条件なしで取り、同じ 2 行の warn を出す', async () => {
    const path = join(dir, 'broken.db');
    makeBrokenIndexDb(path);
    for (let i = 0; i < 2; i++) {
      // 018 は「記事の URL を国税庁の索引で決めるとき」の規則。1 回目で記事 6101 が document に書き戻されるので、
      // 2 回目も索引で URL を決めるよう、記事の行を消してから呼ぶ（houki-hub の 0.25.0 の報告の「止めて聞いたこと」）
      if (i > 0) {
        const db = new Database(path);
        db.prepare(`DELETE FROM document WHERE doc_type = 'tax-answer' AND doc_id = '6101'`).run();
        db.close();
      }
      const indexInits: Array<Record<string, string>> = [];
      const warns = captureWarns();
      try {
        await getTaxAnswer(
          { no: '6101', format: 'json' },
          { fetchImpl: siteRecordingIndexHeaders(indexInits), dbPath: path }
        );
      } finally {
        warns.restore();
      }
      expect(indexInits[0]['if-none-match']).toBeUndefined();
      expect(warns.lines().map((l) => l.meta.table)).toEqual([
        'tax_answer_index',
        'tax_answer_index',
      ]);
    }
  });

  it('SPEC-NTA-GET-TAX-ANSWER-018 tax_answer_index_page に索引の行が無い（まだ保存していない）ときは warn を出さない', async () => {
    const path = join(dir, 'fresh.db');
    makeDb(path);
    const warns = captureWarns();
    let body: TaxAnswerBody;
    try {
      body = (await getTaxAnswer(
        { no: '6101', format: 'json' },
        { fetchImpl: siteRecordingIndexHeaders([]), dbPath: path }
      )) as TaxAnswerBody;
    } finally {
      warns.restore();
    }
    expect(body.taxAnswer?.no).toBe('6101');
    expect(warns.lines()).toEqual([]);
  });

  it('SPEC-NTA-GET-TAX-ANSWER-018 取った索引の保存が tax_answer_index_page で失敗したときは、取った索引で記事を返し、表の名前を tax_answer_index_page にした warn を出す', async () => {
    const path = join(dir, 'blocked.db');
    makeDb(path);
    const db = new Database(path);
    db.exec(
      `CREATE TRIGGER block_page BEFORE INSERT ON tax_answer_index_page BEGIN SELECT RAISE(ABORT, 'blocked'); END;`
    );
    db.close();
    const warns = captureWarns();
    let body: TaxAnswerBody;
    try {
      body = (await getTaxAnswer(
        { no: '6101', format: 'json' },
        { fetchImpl: siteRecordingIndexHeaders([]), dbPath: path }
      )) as TaxAnswerBody;
    } finally {
      warns.restore();
    }
    expect(body.taxAnswer?.no).toBe('6101');
    const lines = warns.lines();
    expect(lines).toHaveLength(1);
    expect(lines[0].msg).toBe(
      `タックスアンサーの索引を DB に保存できませんでした（表: tax_answer_index_page、DB: ${path}）`
    );
    expect(lines[0].meta.error.message).toContain('blocked');
    // 途中で失敗したので、tax_answer_index は前の行（空）のまま（SPEC-NTA-DB-SCHEMA-025）
    const check = new Database(path, { readonly: true });
    const n = (check.prepare('SELECT COUNT(*) AS n FROM tax_answer_index').get() as { n: number })
      .n;
    check.close();
    expect(n).toBe(0);
  });

  it('SPEC-NTA-GET-TAX-ANSWER-018 304 のときの取得日時の書き換えが失敗したときは、013 の DOC_NOT_FOUND を返し、取得日時の warn を出す', async () => {
    const path = join(dir, 'touch.db');
    makeDb(path);
    const db = new Database(path);
    db.prepare('INSERT INTO tax_answer_index(no, url, taxonomy, title) VALUES (?, ?, ?, ?)').run(
      '6101',
      'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6101.htm',
      'shohi',
      '題名'
    );
    db.prepare(
      `INSERT INTO tax_answer_index_page(url, fetched_at, last_modified, etag) VALUES (?, ?, NULL, ?)`
    ).run(TAX_ANSWER_INDEX_URL, '2026-10-01T00:00:00.000Z', '"v1"');
    db.exec(
      `CREATE TRIGGER block_touch BEFORE UPDATE ON tax_answer_index_page BEGIN SELECT RAISE(ABORT, 'blocked'); END;`
    );
    db.close();
    const notModified = (async () =>
      new Response(null, { status: 304 })) as unknown as typeof fetch;
    const warns = captureWarns();
    let body: TaxAnswerBody;
    try {
      body = (await getTaxAnswer(
        { no: '6999', format: 'json' },
        { fetchImpl: notModified, dbPath: path }
      )) as TaxAnswerBody;
    } finally {
      warns.restore();
    }
    expect(body.code).toBe('DOC_NOT_FOUND');
    const lines = warns.lines();
    expect(lines).toHaveLength(1);
    expect(lines[0].msg).toBe(
      `タックスアンサーの索引の取得日時を DB に書き換えられませんでした（表: tax_answer_index_page、DB: ${path}）`
    );
    expect(lines[0].meta.table).toBe('tax_answer_index_page');
    expect(pageFetchedAt(path)).toBe('2026-10-01T00:00:00.000Z');
  });
});

describe('SPEC-NTA-DB-SCHEMA-025 タックスアンサーの索引は tax_answer_index に 1 記事 1 行で保存し、取り直したら置き換える', () => {
  it('SPEC-NTA-DB-SCHEMA-025 「まだ保存していない」とみなすのは tax_answer_index_page に索引の URL の行が無いときだけ。url の列の無い表では置き換えは始まる前に失敗し、tax_answer_index_page の行は前の値のまま', async () => {
    const path = join(dir, 'broken.db');
    makeBrokenIndexDb(path);
    const warns = captureWarns();
    try {
      await getTaxAnswer(
        { no: '6101', format: 'json' },
        { fetchImpl: siteRecordingIndexHeaders([]), dbPath: path }
      );
    } finally {
      warns.restore();
    }
    // 読めないことを「保存していない」と区別してログに出す
    expect(warns.lines()[0].msg.startsWith('保存したタックスアンサーの索引を読めないため')).toBe(
      true
    );
    expect(pageFetchedAt(path)).toBe('2026-10-01T00:00:00.000Z');
    const check = new Database(path, { readonly: true });
    const page = check.prepare('SELECT etag FROM tax_answer_index_page').get() as { etag: string };
    check.close();
    expect(page.etag).toBe('"25b0a-65b81bf96ae40"');
  });
});
