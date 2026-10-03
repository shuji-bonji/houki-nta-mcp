/**
 * 差分 specs/changes/20261003-db-cli/（PR #135）の受入テスト（DB とツール・取り込み）。
 *
 * - db_schema: SPEC-NTA-DB-SCHEMA-001（MODIFIED。版 12 とテーブル）、021（ツールの入口の行）、022・023・024・025（ADDED）
 * - cli_bulk_download: SPEC-NTA-CLI-BULK-DOWNLOAD-012（税目を絞った投入の印）・013（タックスアンサーの索引の保存）
 * - cli_health_check: SPEC-NTA-CLI-HEALTH-CHECK-001・003（MODIFIED。not-applicable と driftCount）
 *
 * 期待値は差分の spec.md と proposal.md の本文・「例:」・表から決めている。DB は一時ディレクトリだけを使い、
 * 国税庁サイトは fetchImpl の差し替えで代える。
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MEASURED_INDEX,
  taxAnswerIndexHtml,
  withTaxAnswerIndex,
} from '../../tests/support/tax-answer-index.js';
import { initSchema } from '../db/schema.js';
import { classifyDrift, detectBaselineDrift } from '../services/baseline-drift.js';
import { bulkDownloadQa } from '../services/qa-bulk-downloader.js';
import { bulkDownloadTaxAnswer } from '../services/tax-answer-bulk-downloader.js';
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

interface Body {
  code?: string;
  error?: string;
  hint?: string;
  source?: string;
  next_actions?: Array<{ action: string }>;
  taxAnswer?: { no?: string };
  results?: unknown[];
}

const FIXTURES = join(import.meta.dirname, '../../tests/fixtures');
const ARTICLE_HTML = readFileSync(
  join(FIXTURES, 'www.nta.go.jp_taxes_shiraberu_taxanswer_shohi_6101.htm'),
  'utf8'
);

let dir: string;
let baselineDir: string;
let savedBaseline: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'houki-nta-db-cli-tools-'));
  baselineDir = join(dir, 'baseline');
  savedBaseline = process.env.HOUKI_NTA_BASELINE_DIR;
  process.env.HOUKI_NTA_BASELINE_DIR = baselineDir;
});
afterEach(() => {
  if (savedBaseline === undefined) delete process.env.HOUKI_NTA_BASELINE_DIR;
  else process.env.HOUKI_NTA_BASELINE_DIR = savedBaseline;
  rmSync(dir, { recursive: true, force: true });
});

function articleFetch() {
  return vi.fn(
    async () =>
      new Response(ARTICLE_HTML, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=UTF-8' },
      })
  );
}

/** 版を記録した DB を作る（今のスキーマのテーブルに、jimu-unei の行を 1 つ入れる） */
function makeDb(path: string, version: string | null): void {
  const db = new Database(path);
  initSchema(db);
  db.prepare(
    `INSERT INTO document(doc_type, doc_id, taxonomy, title, source_url, fetched_at, full_text, attached_pdfs_json)
     VALUES ('jimu-unei', 'shozei/090401', 'shozei', '書面添付制度の運用について', 'https://www.nta.go.jp/law/jimu-unei/shozei/090401/01.htm', '2026-10-01T00:00:00.000Z', '書面添付制度の運用について定める。', '[]')`
  ).run();
  if (version === null) db.exec(`DELETE FROM schema_meta WHERE key = 'schema_version'`);
  else db.prepare(`UPDATE schema_meta SET value = ? WHERE key = 'schema_version'`).run(version);
  db.close();
}

/** schema_meta だけを持つ DB（テーブルを作られたかを確かめるため） */
function makeBareDb(path: string, version: string): void {
  const db = new Database(path);
  db.exec(`CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  db.prepare(`INSERT INTO schema_meta(key, value) VALUES ('schema_version', ?)`).run(version);
  db.close();
}

function tables(path: string): string[] {
  const db = new Database(path, { readonly: true });
  try {
    return (
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
        .all() as Array<{
        name: string;
      }>
    ).map((r) => r.name);
  } finally {
    db.close();
  }
}

function version(path: string): string | undefined {
  const db = new Database(path, { readonly: true });
  try {
    return (
      db.prepare(`SELECT value FROM schema_meta WHERE key = 'schema_version'`).get() as
        | { value: string }
        | undefined
    )?.value;
  } finally {
    db.close();
  }
}

function count(path: string, sql: string): number {
  const db = new Database(path, { readonly: true });
  try {
    return (db.prepare(sql).get() as { n: number }).n;
  } finally {
    db.close();
  }
}

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-DB-SCHEMA-001                                                      */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-DB-SCHEMA-001 DB を作るとテーブルを作り、スキーマの版 12 を記録する', () => {
  it('SPEC-NTA-DB-SCHEMA-001 新しい DB は schema_version "12" で、tax_answer_index と tax_answer_index_page を含む表を持つ（v0.22.0〜v0.23.x は 11）', () => {
    const path = join(dir, 'new.db');
    const db = new Database(path);
    initSchema(db);
    db.close();
    expect(version(path)).toBe('12');
    const names = tables(path);
    for (const t of [
      'schema_meta',
      'tsutatsu',
      'tsutatsu_toc',
      'chapter',
      'section',
      'clause',
      'clause_fts',
      'document',
      'document_fts',
      'tax_answer_index',
      'tax_answer_index_page',
    ]) {
      expect(names, t).toContain(t);
    }
  });

  it('SPEC-NTA-DB-SCHEMA-001 既にテーブルのある版 12 の DB を開いても、テーブルと行は残る', () => {
    const path = join(dir, 'v12.db');
    makeDb(path, '12');
    const db = new Database(path);
    initSchema(db);
    db.close();
    expect(version(path)).toBe('12');
    expect(count(path, 'SELECT count(*) AS n FROM document')).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-DB-SCHEMA-021 ツールの入口                                         */
/* -------------------------------------------------------------------------- */

interface ReadTool {
  tool: string;
  call: (dbPath: string) => Promise<unknown>;
  /** 「DB に 1 件も無い」ときの code（注 1） */
  emptyCode: 'DOC_NOT_FOUND' | 'TSUTATSU_NOT_FOUND';
}

const READ_TOOLS: ReadTool[] = [
  {
    tool: 'nta_search_tsutatsu',
    call: (dbPath) => searchTsutatsu({ keyword: '書面添付' }, { dbPath }),
    emptyCode: 'TSUTATSU_NOT_FOUND',
  },
  {
    tool: 'nta_search_kaisei_tsutatsu',
    call: (dbPath) => handleNtaSearchKaiseiTsutatsu({ keyword: '書面添付' }, { dbPath }),
    emptyCode: 'DOC_NOT_FOUND',
  },
  {
    tool: 'nta_search_jimu_unei',
    call: (dbPath) => handleNtaSearchJimuUnei({ keyword: '書面添付' }, { dbPath }),
    emptyCode: 'DOC_NOT_FOUND',
  },
  {
    tool: 'nta_search_bunshokaitou',
    call: (dbPath) => handleNtaSearchBunshokaitou({ keyword: '書面添付' }, { dbPath }),
    emptyCode: 'DOC_NOT_FOUND',
  },
  {
    tool: 'nta_search_tax_answer',
    call: (dbPath) => handleNtaSearchTaxAnswer({ keyword: '書面添付' }, { dbPath }),
    emptyCode: 'DOC_NOT_FOUND',
  },
  {
    tool: 'nta_search_qa',
    call: (dbPath) => handleNtaSearchQa({ keyword: '社内会議' }, { dbPath }),
    emptyCode: 'DOC_NOT_FOUND',
  },
  {
    tool: 'nta_get_kaisei_tsutatsu',
    call: (dbPath) => handleNtaGetKaiseiTsutatsu({ docId: '0026003-067' }, { dbPath }),
    emptyCode: 'DOC_NOT_FOUND',
  },
  {
    tool: 'nta_get_jimu_unei',
    call: (dbPath) => handleNtaGetJimuUnei({ docId: 'shozei/090401' }, { dbPath }),
    emptyCode: 'DOC_NOT_FOUND',
  },
  {
    tool: 'nta_get_bunshokaitou',
    call: (dbPath) => handleNtaGetBunshokaitou({ docId: 'shotoku/250416' }, { dbPath }),
    emptyCode: 'DOC_NOT_FOUND',
  },
  {
    tool: 'nta_inspect_pdf_meta',
    call: (dbPath) =>
      handleNtaInspectPdfMeta({ docType: 'jimu-unei', docId: 'shozei/090401' }, { dbPath }),
    emptyCode: 'DOC_NOT_FOUND',
  },
];

const HINT_OLD = (path: string, v: string) =>
  `MCP サーバーが開いている DB（${path}）の版 (${v}) は古く移行できないため、使っていません。houki-nta-mcp --quickstart などの投入のフラグを実行すると作り直します（取り込んだ中身は消えます）`;
const HINT_NEW = (path: string, v: string) =>
  `MCP サーバーが開いている DB（${path}）の版 (${v}) がこの houki-nta-mcp の版 (12) より新しいため、使っていません（DB は変更しません）。houki-nta-mcp を新しい版に更新してください`;
const HINT_UNREADABLE = (path: string, raw: string) =>
  `MCP サーバーが開いている DB（${path}）の版を読めないため (schema_version: ${raw})、使っていません（DB は変更しません）。DB ファイルを消してから houki-nta-mcp --quickstart などの投入のフラグを実行してください`;

describe('SPEC-NTA-DB-SCHEMA-021 読むだけのツール', () => {
  for (const t of READ_TOOLS) {
    it(`SPEC-NTA-DB-SCHEMA-021 ${t.tool}: DB のファイルが無い（フォルダーも無い）ときは作らず、「DB に 1 件も無い」ときの応答（${t.emptyCode}）を返す（v0.23.x までは空の DB ができた）`, async () => {
      const path = join(dir, 'nested', 'cache.db');
      const r = (await t.call(path)) as Body;
      expect(r.code).toBe(t.emptyCode);
      expect(existsSync(path)).toBe(false);
      expect(existsSync(join(dir, 'nested'))).toBe(false);
    });

    it(`SPEC-NTA-DB-SCHEMA-021 ${t.tool}: 0 バイトのファイル（版の記録が無い）は書き込まず、ファイルが無いときと同じ応答`, async () => {
      const path = join(dir, 'empty.db');
      writeFileSync(path, '');
      const r = (await t.call(path)) as Body;
      expect(r.code).toBe(t.emptyCode);
      expect(statSync(path).size).toBe(0);
    });

    it(`SPEC-NTA-DB-SCHEMA-021 ${t.tool}: 版 13 の DB は書き込まず、${t.emptyCode} の hint を新しい版の文にし、next_actions に投入の案内を入れない`, async () => {
      const path = join(dir, 'v13.db');
      makeDb(path, '13');
      const r = (await t.call(path)) as Body;
      expect(r.code).toBe(t.emptyCode);
      expect(r.hint).toBe(HINT_NEW(path, '13'));
      expect((r.next_actions ?? []).some((a) => a.action === 'cli_bulk_download')).toBe(false);
      expect(version(path)).toBe('13');
      expect(count(path, 'SELECT count(*) AS n FROM document')).toBe(1);
    });

    it(`SPEC-NTA-DB-SCHEMA-021 ${t.tool}: 版を読めない DB（abc）は書き込まず、hint を読めない版の文にし、投入の案内を入れない`, async () => {
      const path = join(dir, 'abc.db');
      makeDb(path, 'abc');
      const r = (await t.call(path)) as Body;
      expect(r.code).toBe(t.emptyCode);
      expect(r.hint).toBe(HINT_UNREADABLE(path, 'abc'));
      expect((r.next_actions ?? []).some((a) => a.action === 'cli_bulk_download')).toBe(false);
      expect(version(path)).toBe('abc');
    });

    it(`SPEC-NTA-DB-SCHEMA-021 ${t.tool}: 版 2 の DB は書き込まず、hint を古い版の文にする`, async () => {
      const path = join(dir, 'v2.db');
      makeDb(path, '2');
      const r = (await t.call(path)) as Body;
      expect(r.code).toBe(t.emptyCode);
      expect(r.hint).toBe(HINT_OLD(path, '2'));
      expect(version(path)).toBe('2');
      expect(count(path, 'SELECT count(*) AS n FROM document')).toBe(1);
    });
  }

  it('SPEC-NTA-DB-SCHEMA-021 版 13 の DB を開いた nta_search_jimu_unei { keyword: "書面添付" } は DOC_NOT_FOUND で hint が新しい版の文になり、DB は変わらない', async () => {
    const path = join(dir, 'v13.db');
    makeDb(path, '13');
    const r = (await handleNtaSearchJimuUnei({ keyword: '書面添付' }, { dbPath: path })) as Body;
    expect(r.code).toBe('DOC_NOT_FOUND');
    expect(r.hint).toBe(HINT_NEW(path, '13'));
    expect(version(path)).toBe('13');
  });

  it('SPEC-NTA-DB-SCHEMA-021 版 11 の DB は、読むだけのツールでも移行してから引く（版は 12 になり、行が当たる）', async () => {
    const path = join(dir, 'v11.db');
    makeDb(path, '11');
    const r = (await handleNtaSearchJimuUnei({ keyword: '書面添付' }, { dbPath: path })) as Body;
    expect(r.code).toBeUndefined();
    expect((r.results ?? []).length).toBe(1);
    expect(version(path)).toBe('12');
  });
});

describe('SPEC-NTA-DB-SCHEMA-021 書き戻すツール', () => {
  it('SPEC-NTA-DB-SCHEMA-021 DB ファイルの無い場所で nta_get_tax_answer { no: "6101" } を呼ぶと、国税庁サイトから記事を返し、DB のファイルができて document に tax-answer・6101 の行が入る', async () => {
    const path = join(dir, 'nested', 'cache.db');
    const r = (await getTaxAnswer(
      { no: '6101', format: 'json' },
      { fetchImpl: withTaxAnswerIndex(articleFetch() as unknown as typeof fetch), dbPath: path }
    )) as Body;
    expect(r.code).toBeUndefined();
    expect(r.source).toBe('live');
    expect(existsSync(path)).toBe(true);
    expect(version(path)).toBe('12');
    expect(
      count(
        path,
        `SELECT count(*) AS n FROM document WHERE doc_type = 'tax-answer' AND doc_id = '6101'`
      )
    ).toBe(1);
  });

  it('SPEC-NTA-DB-SCHEMA-021 DB ファイルの無い場所で、国税庁サイトから取れなかったときはファイルを作らない', async () => {
    const path = join(dir, 'nested', 'cache.db');
    const r = (await getTaxAnswer(
      { no: '6101', format: 'json' },
      {
        fetchImpl: vi.fn(
          async () => new Response('forbidden', { status: 403 })
        ) as unknown as typeof fetch,
        dbPath: path,
      }
    )) as Body;
    expect(r.code).toBe('SOURCE_API_ERROR');
    expect(existsSync(path)).toBe(false);
  });

  for (const [label, prepare] of [
    ['版の記録の無いファイル（0 バイト）', (p: string) => writeFileSync(p, '')],
    ['版 13 の DB（schema_meta だけ）', (p: string) => makeBareDb(p, '13')],
    ['版を読めない DB（schema_meta だけ）', (p: string) => makeBareDb(p, 'abc')],
    ['版 2 の DB（schema_meta だけ）', (p: string) => makeBareDb(p, '2')],
  ] as Array<[string, (p: string) => void]>) {
    it(`SPEC-NTA-DB-SCHEMA-021 ${label} は、nta_get_tax_answer が国税庁サイトから取って返し、DB には書かない（テーブルも schema_meta も作らない）`, async () => {
      const path = join(dir, 'odd.db');
      prepare(path);
      const before = statSync(path).size === 0 ? [] : tables(path);
      const beforeVersion = statSync(path).size === 0 ? undefined : version(path);
      const r = (await getTaxAnswer(
        { no: '6101', format: 'json' },
        { fetchImpl: withTaxAnswerIndex(articleFetch() as unknown as typeof fetch), dbPath: path }
      )) as Body;
      expect(r.code).toBeUndefined();
      expect(r.source).toBe('live');
      if (before.length === 0) {
        expect(statSync(path).size).toBe(0);
      } else {
        expect(tables(path)).toEqual(before);
        expect(version(path)).toBe(beforeVersion);
      }
    });
  }
});

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-DB-SCHEMA-022 版 11 → 12                                           */
/* -------------------------------------------------------------------------- */

/**
 * 版 11 の DB を作る。今のスキーマから、版 12 で足したもの（document の doc_type の CHECK、
 * tax_answer_index・tax_answer_index_page）を除いた形にする。document の定義は v0.23.0 の src/db/schema.ts と同じ
 */
function makeV11Db(path: string): void {
  const db = new Database(path);
  initSchema(db);
  db.exec(`
    DROP TABLE tax_answer_index;
    DROP TABLE tax_answer_index_page;
    DROP TRIGGER document_ai;
    DROP TRIGGER document_ad;
    DROP TRIGGER document_au;
    DROP TABLE document_fts;
    DROP TABLE document;
    CREATE TABLE document (
      id INTEGER PRIMARY KEY,
      doc_type TEXT NOT NULL,
      doc_id TEXT NOT NULL,
      taxonomy TEXT,
      title TEXT NOT NULL,
      issued_at TEXT,
      issuer TEXT,
      source_url TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      full_text TEXT NOT NULL,
      attached_pdfs_json TEXT NOT NULL,
      content_hash TEXT,
      last_modified TEXT,
      etag TEXT,
      structured_json TEXT,
      orphaned_at TEXT,
      UNIQUE(doc_type, doc_id)
    );
    CREATE INDEX IF NOT EXISTS idx_document_lookup ON document(doc_type, doc_id);
    CREATE INDEX IF NOT EXISTS idx_document_taxonomy ON document(doc_type, taxonomy);
    CREATE VIRTUAL TABLE document_fts USING fts5(
      doc_type UNINDEXED, taxonomy UNINDEXED, title, full_text,
      content='document', content_rowid='id', tokenize='trigram'
    );
    CREATE TRIGGER document_ai AFTER INSERT ON document BEGIN
      INSERT INTO document_fts(rowid, doc_type, taxonomy, title, full_text)
      VALUES (new.id, new.doc_type, new.taxonomy, new.title, new.full_text);
    END;
    CREATE TRIGGER document_ad AFTER DELETE ON document BEGIN
      INSERT INTO document_fts(document_fts, rowid, doc_type, taxonomy, title, full_text)
      VALUES ('delete', old.id, old.doc_type, old.taxonomy, old.title, old.full_text);
    END;
    CREATE TRIGGER document_au AFTER UPDATE ON document BEGIN
      INSERT INTO document_fts(document_fts, rowid, doc_type, taxonomy, title, full_text)
      VALUES ('delete', old.id, old.doc_type, old.taxonomy, old.title, old.full_text);
      INSERT INTO document_fts(rowid, doc_type, taxonomy, title, full_text)
      VALUES (new.id, new.doc_type, new.taxonomy, new.title, new.full_text);
    END;
  `);
  db.prepare(
    `INSERT INTO tsutatsu(id, formal_name, abbr, source_root_url) VALUES (1, '消費税法基本通達', '消基通', 'https://x/')`
  ).run();
  db.prepare(
    `INSERT INTO clause(tsutatsu_id, clause_number, source_url, chapter_number, section_number, title, full_text, paragraphs_json)
     VALUES (1, '1-1-1', 'https://x/1.htm', 1, 1, '個人事業者と給与所得者の区分', '本文', '[]')`
  ).run();
  const doc = db.prepare(
    `INSERT INTO document(id, doc_type, doc_id, taxonomy, title, source_url, fetched_at, full_text, attached_pdfs_json, content_hash, structured_json, orphaned_at)
     VALUES (?, ?, ?, 'shohi', ?, ?, '2026-09-01T00:00:00.000Z', ?, '[]', ?, ?, ?)`
  );
  doc.run(
    7,
    'tax-answer',
    '6101',
    '消費税のしくみ',
    'https://x/6101.htm',
    '適格請求書の保存について',
    'hash-6101',
    '{"sections":[]}',
    null
  );
  doc.run(
    9,
    'kaisei',
    '0026003-067',
    '改正通達',
    'https://x/k.htm',
    '改正の本文',
    null,
    null,
    '2026-09-20T00:00:00.000Z'
  );
  db.prepare(`UPDATE schema_meta SET value = '11' WHERE key = 'schema_version'`).run();
  db.close();
}

describe('SPEC-NTA-DB-SCHEMA-022 版 11 の DB を開くと、行を保ったまま索引のテーブルを足し、document に doc_type の制約を付けて版 12 にする', () => {
  it('SPEC-NTA-DB-SCHEMA-022 schema_version は 12、document と clause の行数は変わらず、document_fts で当たり、tax_answer_index は 0 行', () => {
    const path = join(dir, 'v11.db');
    makeV11Db(path);
    const db = new Database(path);
    initSchema(db);
    db.close();
    expect(version(path)).toBe('12');
    expect(count(path, 'SELECT count(*) AS n FROM document')).toBe(2);
    expect(count(path, 'SELECT count(*) AS n FROM clause')).toBe(1);
    expect(
      count(path, `SELECT count(*) AS n FROM document_fts WHERE document_fts MATCH '適格請求書'`)
    ).toBe(1);
    expect(count(path, 'SELECT count(*) AS n FROM tax_answer_index')).toBe(0);
    expect(count(path, 'SELECT count(*) AS n FROM tax_answer_index_page')).toBe(0);
  });

  it('SPEC-NTA-DB-SCHEMA-022 document の行は id を含むすべての列をそのまま残す（content_hash・structured_json・orphaned_at も）', () => {
    const path = join(dir, 'v11.db');
    makeV11Db(path);
    const before = (() => {
      const db = new Database(path, { readonly: true });
      try {
        return db.prepare('SELECT * FROM document ORDER BY id').all();
      } finally {
        db.close();
      }
    })();
    const db = new Database(path);
    initSchema(db);
    const after = db.prepare('SELECT * FROM document ORDER BY id').all();
    const hit = db
      .prepare(`SELECT rowid AS id FROM document_fts WHERE document_fts MATCH '適格請求書'`)
      .get() as { id: number };
    db.close();
    expect(after).toEqual(before);
    expect(hit.id).toBe(7);
  });

  it('SPEC-NTA-DB-SCHEMA-022 SPEC-NTA-DB-SCHEMA-023 移行の後の document には doc_type の制約が付く', () => {
    const path = join(dir, 'v11.db');
    makeV11Db(path);
    const db = new Database(path);
    initSchema(db);
    expect(() =>
      db
        .prepare(
          `INSERT INTO document(doc_type, doc_id, title, source_url, fetched_at, full_text, attached_pdfs_json) VALUES ('kaisei-x', '1', 't', 'u', 'f', 'b', '[]')`
        )
        .run()
    ).toThrow(/CHECK constraint failed/);
    db.close();
  });

  it('SPEC-NTA-DB-SCHEMA-022 doc_type が 5 つの値でない行は残さず、document_fts からも消える', () => {
    const path = join(dir, 'v11.db');
    makeV11Db(path);
    {
      const db = new Database(path);
      db.prepare(
        `INSERT INTO document(id, doc_type, doc_id, title, source_url, fetched_at, full_text, attached_pdfs_json)
         VALUES (20, 'unknown-type', 'x', '不明な種別', 'https://x/u.htm', '2026-09-01T00:00:00.000Z', '不明な種別の本文', '[]')`
      ).run();
      db.close();
    }
    const db = new Database(path);
    initSchema(db);
    db.close();
    expect(count(path, 'SELECT count(*) AS n FROM document')).toBe(2);
    expect(count(path, `SELECT count(*) AS n FROM document WHERE doc_type = 'unknown-type'`)).toBe(
      0
    );
    expect(
      count(
        path,
        `SELECT count(*) AS n FROM document_fts WHERE document_fts MATCH '不明な種別の本文'`
      )
    ).toBe(0);
  });

  it('SPEC-NTA-DB-SCHEMA-022 もう一度開いても何も変わらない', () => {
    const path = join(dir, 'v11.db');
    makeV11Db(path);
    for (let i = 0; i < 2; i++) {
      const db = new Database(path);
      initSchema(db);
      db.close();
    }
    expect(version(path)).toBe('12');
    expect(count(path, 'SELECT count(*) AS n FROM document')).toBe(2);
    expect(
      count(path, `SELECT count(*) AS n FROM document_fts WHERE document_fts MATCH '適格請求書'`)
    ).toBe(1);
  });

  it('SPEC-NTA-DB-SCHEMA-022 読むだけのツールが開いても移行する（nta_search_tax_answer で 6101 が当たり、版は 12）', async () => {
    const path = join(dir, 'v11.db');
    makeV11Db(path);
    const r = (await handleNtaSearchTaxAnswer({ keyword: '適格請求書' }, { dbPath: path })) as Body;
    expect(r.code).toBeUndefined();
    expect((r.results ?? []).length).toBe(1);
    expect(version(path)).toBe('12');
  });
});

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-DB-SCHEMA-023・024                                                 */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-DB-SCHEMA-023 document.doc_type は 5 つの値だけを受け付ける', () => {
  const insert = (db: Database.Database, docType: string, docId: string) =>
    db
      .prepare(
        `INSERT INTO document(doc_type, doc_id, title, source_url, fetched_at, full_text, attached_pdfs_json) VALUES (?, ?, 't', 'u', 'f', 'b', '[]')`
      )
      .run(docType, docId);

  it('SPEC-NTA-DB-SCHEMA-023 doc_type を kaisei-x にした INSERT は CHECK constraint failed で、行は増えない（v0.23.x では入った）', () => {
    const db = new Database(':memory:');
    initSchema(db);
    expect(() => insert(db, 'kaisei-x', '1')).toThrow(/CHECK constraint failed/);
    expect((db.prepare('SELECT count(*) AS n FROM document').get() as { n: number }).n).toBe(0);
    db.close();
  });

  it('SPEC-NTA-DB-SCHEMA-023 5 つの値（kaisei・jimu-unei・bunshokaitou・tax-answer・qa-jirei）は入る', () => {
    const db = new Database(':memory:');
    initSchema(db);
    for (const t of ['kaisei', 'jimu-unei', 'bunshokaitou', 'tax-answer', 'qa-jirei']) {
      expect(() => insert(db, t, '1')).not.toThrow();
    }
    expect((db.prepare('SELECT count(*) AS n FROM document').get() as { n: number }).n).toBe(5);
    db.close();
  });
});

describe('SPEC-NTA-DB-SCHEMA-024 document.taxonomy は値を制限しない', () => {
  it('SPEC-NTA-DB-SCHEMA-024 taxonomy を zzz・sisan/sozoku・tyousyu・souzoku にした行も入る', () => {
    const db = new Database(':memory:');
    initSchema(db);
    const stmt = db.prepare(
      `INSERT INTO document(doc_type, doc_id, taxonomy, title, source_url, fetched_at, full_text, attached_pdfs_json) VALUES ('jimu-unei', ?, ?, 't', 'u', 'f', 'b', '[]')`
    );
    ['zzz', 'sisan/sozoku', 'tyousyu', 'souzoku'].forEach((tx, i) => {
      expect(() => stmt.run(`d${i}`, tx)).not.toThrow();
    });
    db.close();
  });
});

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-DB-SCHEMA-025・SPEC-NTA-CLI-BULK-DOWNLOAD-013 タックスアンサーの索引 */
/* -------------------------------------------------------------------------- */

const INDEX_URL = 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/code/';

function indexSite(entries = MEASURED_INDEX, headers: Record<string, string> = {}) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === INDEX_URL) {
      return new Response(taxAnswerIndexHtml(entries), {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=UTF-8', ...headers },
      });
    }
    return new Response(ARTICLE_HTML, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=UTF-8' },
    });
  });
}

describe('SPEC-NTA-DB-SCHEMA-025 タックスアンサーの索引は tax_answer_index に 1 記事 1 行で保存し、取り直したら置き換える', () => {
  it('SPEC-NTA-DB-SCHEMA-025 索引の記事が 755 件のときに保存すると 755 行で、8 で始まる番号の行の taxonomy は saigai', async () => {
    const path = join(dir, 'c.db');
    const site = indexSite(MEASURED_INDEX, {
      'Last-Modified': 'Tue, 15 Sep 2026 08:58:03 GMT',
      ETag: '"25b0a-65b81bf96ae40"',
    });
    await getTaxAnswer(
      { no: '6101', format: 'json' },
      { fetchImpl: site as unknown as typeof fetch, dbPath: path }
    );
    expect(count(path, 'SELECT count(*) AS n FROM tax_answer_index')).toBe(755);
    expect(
      count(
        path,
        `SELECT count(*) AS n FROM tax_answer_index WHERE no LIKE '8%' AND taxonomy <> 'saigai'`
      )
    ).toBe(0);
    expect(count(path, `SELECT count(*) AS n FROM tax_answer_index WHERE no LIKE '8%'`)).toBe(16);
    const db = new Database(path, { readonly: true });
    const page = db
      .prepare(`SELECT url, fetched_at, last_modified, etag FROM tax_answer_index_page`)
      .all() as Array<{ url: string; fetched_at: string; last_modified: string; etag: string }>;
    const row8001 = db
      .prepare(`SELECT no, url, taxonomy, title FROM tax_answer_index WHERE no = '8001'`)
      .get();
    db.close();
    expect(page).toHaveLength(1);
    expect(page[0]).toMatchObject({
      url: INDEX_URL,
      last_modified: 'Tue, 15 Sep 2026 08:58:03 GMT',
      etag: '"25b0a-65b81bf96ae40"',
    });
    expect(row8001).toEqual({
      no: '8001',
      url: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/saigai/8001.htm',
      taxonomy: 'saigai',
      // 索引の題名はリンクの文字列（テストの索引は「No.<番号> <題名>」の形で書いている）
      title: 'No.8001 記事 8001',
    });
  });

  it('SPEC-NTA-DB-SCHEMA-025 その後に 756 件の索引を保存すると 756 行になり、索引から消えた番号の行は残らない', async () => {
    const path = join(dir, 'c.db');
    await getTaxAnswer(
      { no: '6101', format: 'json' },
      { fetchImpl: indexSite() as unknown as typeof fetch, dbPath: path }
    );
    // 1 件消して 2 件足した索引を、索引に無い番号（6998）の呼び出しで取り直させる
    const next = [
      ...MEASURED_INDEX.filter((e) => e.no !== '2010'),
      { no: '6998', folder: 'shohi', title: '足された記事' },
      { no: '6997', folder: 'shohi', title: '足された記事 2' },
    ];
    await getTaxAnswer(
      { no: '6998', format: 'json' },
      { fetchImpl: indexSite(next) as unknown as typeof fetch, dbPath: path }
    );
    expect(count(path, 'SELECT count(*) AS n FROM tax_answer_index')).toBe(756);
    expect(count(path, `SELECT count(*) AS n FROM tax_answer_index WHERE no = '2010'`)).toBe(0);
  });

  it('SPEC-NTA-DB-SCHEMA-025 条件付きの取り直しで 304 が返ったときは、tax_answer_index_page.fetched_at だけを書き換え、tax_answer_index は変えない', async () => {
    const path = join(dir, 'c.db');
    await getTaxAnswer(
      { no: '6101', format: 'json' },
      {
        fetchImpl: indexSite(MEASURED_INDEX, { ETag: '"v1"' }) as unknown as typeof fetch,
        dbPath: path,
      }
    );
    const before = (() => {
      const db = new Database(path, { readonly: true });
      try {
        return db.prepare('SELECT fetched_at, etag FROM tax_answer_index_page').get() as {
          fetched_at: string;
          etag: string;
        };
      } finally {
        db.close();
      }
    })();
    await new Promise((r) => setTimeout(r, 10));
    const notModified = vi.fn(async () => new Response(null, { status: 304 }));
    const r = (await getTaxAnswer(
      { no: '6999', format: 'json' },
      { fetchImpl: notModified as unknown as typeof fetch, dbPath: path }
    )) as Body;
    expect(r.code).toBe('DOC_NOT_FOUND');
    const db = new Database(path, { readonly: true });
    const after = db.prepare('SELECT fetched_at, etag FROM tax_answer_index_page').get() as {
      fetched_at: string;
      etag: string;
    };
    db.close();
    expect(after.etag).toBe(before.etag);
    expect(after.fetched_at > before.fetched_at).toBe(true);
    expect(count(path, 'SELECT count(*) AS n FROM tax_answer_index')).toBe(755);
  });
});

describe('SPEC-NTA-CLI-BULK-DOWNLOAD-013 --bulk-download-tax-answer は、取ったタックスアンサーの索引を DB に保存する', () => {
  it('SPEC-NTA-CLI-BULK-DOWNLOAD-013 --tax-answer-taxonomy=saigai で絞っても、tax_answer_index には索引の全記事（755 行）が入り、投入する記事は saigai だけ', async () => {
    const path = join(dir, 'c.db');
    const db = new Database(path);
    initSchema(db);
    const site = indexSite();
    try {
      await bulkDownloadTaxAnswer(db, {
        taxonomies: ['saigai'],
        fetchImpl: site as unknown as typeof fetch,
        requestIntervalMs: 0,
        baselinePath: join(baselineDir, 'tax-answer.json'),
      });
    } finally {
      db.close();
    }
    expect(count(path, 'SELECT count(*) AS n FROM tax_answer_index')).toBe(755);
    expect(count(path, `SELECT count(*) AS n FROM document WHERE doc_type = 'tax-answer'`)).toBe(
      16
    );
  });

  it('SPEC-NTA-CLI-BULK-DOWNLOAD-013 SPEC-NTA-GET-TAX-ANSWER-016 保存した後の nta_get_tax_answer は索引を取らない', async () => {
    const path = join(dir, 'c.db');
    const db = new Database(path);
    initSchema(db);
    try {
      await bulkDownloadTaxAnswer(db, {
        taxonomies: ['saigai'],
        fetchImpl: indexSite() as unknown as typeof fetch,
        requestIntervalMs: 0,
        baselinePath: join(baselineDir, 'tax-answer.json'),
      });
    } finally {
      db.close();
    }
    const site = indexSite();
    const r = (await getTaxAnswer(
      { no: '6101', format: 'json' },
      { fetchImpl: site as unknown as typeof fetch, dbPath: path }
    )) as Body;
    expect(r.code).toBeUndefined();
    expect(site.mock.calls.map((c) => String(c[0]))).not.toContain(INDEX_URL);
  });
});

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-CLI-BULK-DOWNLOAD-012 税目を絞った投入での索引から消えた文書の印     */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-CLI-BULK-DOWNLOAD-012 税目を絞った投入でも、絞った税目の索引をすべて取れたときは、その税目の文書に限って印を付け直す', () => {
  const QA_PAGE = readFileSync(
    join(FIXTURES, 'www.nta.go.jp_law_shitsugi_shohi_02_19.htm'),
    'utf8'
  );

  function seedQa(path: string): void {
    const db = new Database(path);
    initSchema(db);
    const stmt = db.prepare(
      `INSERT INTO document(doc_type, doc_id, taxonomy, title, source_url, fetched_at, full_text, attached_pdfs_json)
       VALUES ('qa-jirei', ?, ?, ?, ?, '2026-01-01T00:00:00.000Z', '本文', '[]')`
    );
    stmt.run(
      'shohi/02/19',
      'shohi',
      '事例 A',
      'https://www.nta.go.jp/law/shitsugi/shohi/02/19.htm'
    );
    stmt.run(
      'shohi/02/20',
      'shohi',
      '事例 B',
      'https://www.nta.go.jp/law/shitsugi/shohi/02/20.htm'
    );
    stmt.run(
      'hojin/01/01',
      'hojin',
      '事例 C',
      'https://www.nta.go.jp/law/shitsugi/hojin/01/01.htm'
    );
    db.close();
  }

  function orphaned(path: string): Record<string, string | null> {
    const db = new Database(path, { readonly: true });
    try {
      const rows = db
        .prepare(`SELECT doc_id, orphaned_at FROM document WHERE doc_type = 'qa-jirei'`)
        .all() as Array<{ doc_id: string; orphaned_at: string | null }>;
      return Object.fromEntries(rows.map((r) => [r.doc_id, r.orphaned_at]));
    } finally {
      db.close();
    }
  }

  const shohiIndex =
    '<html><body><div id="bodyArea"><a href="/law/shitsugi/shohi/02/19.htm">事例 A</a></div></body></html>';

  it('SPEC-NTA-CLI-BULK-DOWNLOAD-012 shohi の索引に A だけがあるとき --qa-topic=shohi を実行すると、B に orphaned_at が付き、A と C は NULL のまま（v0.23.x は B も NULL）', async () => {
    const path = join(dir, 'qa.db');
    seedQa(path);
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const body = url.endsWith('/shitsugi/shohi/01.htm') ? shohiIndex : QA_PAGE;
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=UTF-8' },
      });
    });
    const db = new Database(path);
    try {
      await bulkDownloadQa(db, {
        topics: ['shohi'],
        fetchImpl: fetchImpl as unknown as typeof fetch,
        requestIntervalMs: 0,
        baselinePath: join(baselineDir, 'qa.json'),
      });
    } finally {
      db.close();
    }
    const marks = orphaned(path);
    expect(marks['shohi/02/20']).not.toBeNull();
    expect(marks['shohi/02/19']).toBeNull();
    expect(marks['hojin/01/01']).toBeNull();
  });

  it('SPEC-NTA-CLI-BULK-DOWNLOAD-012 絞った税目の索引を取れなかったときは、印を付け直さない', async () => {
    const path = join(dir, 'qa.db');
    seedQa(path);
    const fetchImpl = vi.fn(async () => new Response('forbidden', { status: 403 }));
    const db = new Database(path);
    try {
      await bulkDownloadQa(db, {
        topics: ['shohi'],
        fetchImpl: fetchImpl as unknown as typeof fetch,
        requestIntervalMs: 0,
        baselinePath: join(baselineDir, 'qa.json'),
      });
    } finally {
      db.close();
    }
    const marks = orphaned(path);
    expect(Object.values(marks).every((v) => v === null)).toBe(true);
  });

  it('SPEC-NTA-CLI-BULK-DOWNLOAD-012 税目を絞った実行は baseline ファイルに件数を記録しない', async () => {
    const path = join(dir, 'qa.db');
    seedQa(path);
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const body = url.endsWith('/shitsugi/shohi/01.htm') ? shohiIndex : QA_PAGE;
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=UTF-8' },
      });
    });
    const db = new Database(path);
    let result: { aggregation?: unknown; health?: unknown };
    try {
      result = await bulkDownloadQa(db, {
        topics: ['shohi'],
        fetchImpl: fetchImpl as unknown as typeof fetch,
        requestIntervalMs: 0,
        baselinePath: join(baselineDir, 'qa.json'),
      });
    } finally {
      db.close();
    }
    expect(result.aggregation).toBeUndefined();
    expect(result.health).toBeUndefined();
    expect(existsSync(join(baselineDir, 'qa.json'))).toBe(false);
  });

  it('SPEC-NTA-CLI-BULK-DOWNLOAD-012 タックスアンサーを --tax-answer-taxonomy=saigai で絞ったときも、saigai の行だけ印を付け直す', async () => {
    const path = join(dir, 'ta.db');
    const db = new Database(path);
    initSchema(db);
    const stmt = db.prepare(
      `INSERT INTO document(doc_type, doc_id, taxonomy, title, source_url, fetched_at, full_text, attached_pdfs_json)
       VALUES ('tax-answer', ?, ?, ?, ?, '2026-01-01T00:00:00.000Z', '本文', '[]')`
    );
    stmt.run(
      '8099',
      'saigai',
      '消えた災害の記事',
      'https://www.nta.go.jp/taxes/shiraberu/taxanswer/saigai/8099.htm'
    );
    stmt.run(
      '6999',
      'shohi',
      '消えた消費税の記事',
      'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6999.htm'
    );
    try {
      await bulkDownloadTaxAnswer(db, {
        taxonomies: ['saigai'],
        fetchImpl: indexSite() as unknown as typeof fetch,
        requestIntervalMs: 0,
        baselinePath: join(baselineDir, 'tax-answer.json'),
      });
    } finally {
      db.close();
    }
    const read = new Database(path, { readonly: true });
    const rows = read
      .prepare(`SELECT doc_id, orphaned_at FROM document WHERE doc_id IN ('8099', '6999')`)
      .all() as Array<{ doc_id: string; orphaned_at: string | null }>;
    read.close();
    const byId = Object.fromEntries(rows.map((r) => [r.doc_id, r.orphaned_at]));
    expect(byId['8099']).not.toBeNull();
    expect(byId['6999']).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* SPEC-NTA-CLI-HEALTH-CHECK-001・003                                          */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-CLI-HEALTH-CHECK-001 SPEC-NTA-CLI-HEALTH-CHECK-003 判定の対象外は not-applicable で、driftCount に数えない', () => {
  const MENU = `<html><body>
    <a href="/law/tsutatsu/kihon/shohi/01.htm">消基通</a>
    <a href="/law/tsutatsu/kihon/sisan/sozoku2/01.htm">相続税</a>
  </body></html>`;

  it('SPEC-NTA-CLI-HEALTH-CHECK-001 kihon/ の下でない代表ページは status: not-applicable で、message に drift 検知対象外を含む（v0.23.x は ok）', () => {
    const r = classifyDrift({
      doc_type: 'qa-jirei',
      label: '質疑応答事例',
      baselineUrl: 'https://www.nta.go.jp/law/shitsugi/shohi/02/19.htm',
      menuEntries: [],
    });
    expect(r.status).toBe('not-applicable');
    expect(r.message).toContain('drift 検知対象外');
  });

  it('SPEC-NTA-CLI-HEALTH-CHECK-001 SPEC-NTA-CLI-HEALTH-CHECK-003 entries には対象外も並べ、driftCount は missing と generation-drift の数', async () => {
    const result = await detectBaselineDrift({
      menuHtml: MENU,
      menuUrl: 'https://www.nta.go.jp/law/tsutatsu/menu.htm',
      targets: [
        {
          doc_type: 'tsutatsu-shohi',
          label: '消基通',
          url: 'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/01/04.htm',
        },
        {
          doc_type: 'tsutatsu-sozoku-old',
          label: '相基通 (旧)',
          url: 'https://www.nta.go.jp/law/tsutatsu/kihon/sisan/sozoku/01.htm',
        },
        {
          doc_type: 'qa-jirei',
          label: '質疑応答事例',
          url: 'https://www.nta.go.jp/law/shitsugi/shohi/02/19.htm',
        },
        {
          doc_type: 'tax-answer',
          label: 'タックスアンサー',
          url: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6101.htm',
        },
      ],
    });
    expect(result.entries.map((e) => e.status)).toEqual([
      'ok',
      'missing',
      'not-applicable',
      'not-applicable',
    ]);
    expect(result.driftCount).toBe(1);
  });
});
