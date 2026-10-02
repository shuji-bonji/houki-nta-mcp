/**
 * 差分 specs/changes/20261001-t3-normalize/（PR #119）の受入テスト。
 *
 * - SPEC-NTA-SEARCH-RULES-007（MODIFIED）: DB に入れる文字列のダッシュ類も `-` に揃える
 * - SPEC-NTA-SEARCH-RULES-019: 略称辞書を引く文字列と文書の識別子は、半角に揃えてから照合する
 * - 各ツールの ID: resolve_abbreviation 008、nta_get_tsutatsu 018、nta_get_qa 016、nta_get_tax_answer 015、
 *   nta_get_kaisei_tsutatsu / nta_get_jimu_unei / nta_get_bunshokaitou 011、nta_inspect_pdf_meta 020
 * - SPEC-NTA-DB-SCHEMA-001（MODIFIED）・019・020: スキーマの版 11 と、版 10 の DB の入れ直し
 * - SPEC-NTA-GET-TAX-ANSWER-001: T1 で「T3 で決める」とした 1 文（全角の数字は半角に揃えてから見る）
 */

import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type DatabaseT from 'better-sqlite3';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSchemaVersion, initSchema, SCHEMA_VERSION } from '../db/schema.js';
import { buildFtsQueryWithAbbreviation } from '../services/db-search.js';
import { normalizeJpText } from '../services/text-normalize.js';
import {
  getQa,
  getTaxAnswer,
  getTsutatsu,
  handleNtaGetBunshokaitou,
  handleNtaGetJimuUnei,
  handleNtaGetKaiseiTsutatsu,
  handleNtaInspectPdfMeta,
  handleNtaSearchKaiseiTsutatsu,
  handleNtaSearchQa,
  handleResolveAbbreviation,
} from './handlers.js';

const FIXTURES = join(import.meta.dirname, '../../tests/fixtures');
const NTA_ORIGIN = 'https://www.nta.go.jp';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'houki-nta-t3-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** fixture を返し、取りに行った URL を記録する fetch */
function fixtureFetch(fixture: string, contentType: string) {
  const urls: string[] = [];
  const body = readFileSync(join(FIXTURES, fixture));
  const fetchImpl = vi.fn(async (input: string | URL | Request) => {
    urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    return new Response(body, { status: 200, headers: { 'Content-Type': contentType } });
  }) as unknown as typeof fetch;
  return { fetchImpl, urls };
}

type SeedDoc = [docType: string, docId: string, title: string, body: string];

function seedDocuments(dbPath: string, docs: SeedDoc[]): void {
  const db = new Database(dbPath);
  initSchema(db);
  const stmt = db.prepare(
    `INSERT INTO document(doc_type, doc_id, taxonomy, title, source_url, fetched_at, full_text, attached_pdfs_json, content_hash)
     VALUES (?, ?, 'shohi', ?, ?, '2026-10-01T00:30:00.000Z', ?, ?, NULL)`
  );
  for (const [docType, docId, title, body] of docs) {
    stmt.run(
      docType,
      docId,
      title,
      `${NTA_ORIGIN}/${docType}/${docId}/index.htm`,
      body,
      JSON.stringify([{ title: '新旧対照表', url: `${NTA_ORIGIN}/${docType}/${docId}/01.pdf` }])
    );
  }
  db.close();
}

/* -------------------------------------------------------------------------- */
/* search_rules                                                                */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-SEARCH-RULES-007 DB に入れる文字列は全角の数字・英字・記号・空白を揃える', () => {
  it('SPEC-NTA-SEARCH-RULES-007 全角の数字・英字は半角に、全角ハイフンとダッシュ類 6 つは - に揃える', () => {
    expect(normalizeJpText('１２３')).toBe('123');
    expect(normalizeJpText('ＮＩＳＡ')).toBe('NISA');
    expect(normalizeJpText('ｅ－Ｔａｘ')).toBe('e-Tax');
    expect(normalizeJpText('1－4－13の2')).toBe('1-4-13の2');
    for (const dash of ['‐', '‑', '–', '—', '―', '−']) {
      expect(normalizeJpText(`課消２${dash}11`), dash).toBe('課消2-11');
    }
  });

  it('SPEC-NTA-SEARCH-RULES-007 罫線 ─ と長音 ー、中黒と「共」「の」は変えない。チルダは ~、全角空白は半角にして前後を落とす', () => {
    expect(normalizeJpText('─')).toBe('─');
    expect(normalizeJpText('データ')).toBe('データ');
    expect(normalizeJpText('1の3・1の4共-1')).toBe('1の3・1の4共-1');
    expect(normalizeJpText('183〜193共-1')).toBe('183~193共-1');
    expect(normalizeJpText('183～193共-1')).toBe('183~193共-1');
    expect(normalizeJpText('　第1章　通則　')).toBe('第1章 通則');
  });

  it('SPEC-NTA-SEARCH-RULES-007 揃えた文字列にもう一度通しても変わらない', () => {
    const once = normalizeJpText('課消２―11 と ｅ－Ｔａｘ　～');
    expect(normalizeJpText(once)).toBe(once);
  });

  it('SPEC-NTA-SEARCH-RULES-007 本文の 課消２－11 も 課消２―11 も、課消2-11 で検索して当たる', async () => {
    const dbPath = join(dir, 'cache.db');
    seedDocuments(dbPath, [
      ['kaisei', '0026003-067', '改正通達 A', normalizeJpText('本文 課消２－11 の改正')],
      ['kaisei', '0026003-068', '改正通達 B', normalizeJpText('本文 課消２―11 の改正')],
    ]);
    const r = (await handleNtaSearchKaiseiTsutatsu({ keyword: '課消2-11' }, { dbPath })) as {
      results?: Array<{ docId: string }>;
    };
    expect(r.results?.map((x) => x.docId).sort()).toEqual(['0026003-067', '0026003-068']);
  });
});

describe('SPEC-NTA-SEARCH-RULES-019 略称辞書を引く文字列と文書の識別子は、半角に揃えてから照合する', () => {
  it('SPEC-NTA-SEARCH-RULES-019 keyword の ＰＬ法 は、PL法 と同じく 製造物責任法 に広げる（略称として）', () => {
    const full = buildFtsQueryWithAbbreviation('ＰＬ法');
    const half = buildFtsQueryWithAbbreviation('PL法');
    expect(half.expandedTo).toBe('製造物責任法');
    expect(full.expandedTo).toBe('製造物責任法');
    expect(full.expansionKind).toBe(half.expansionKind);
    expect(full.query).toBe(half.query);
  });

  it('SPEC-NTA-SEARCH-RULES-019 nta_search_qa に keyword: "ＰＬ法" を渡しても、応答の keyword は渡した値のまま', async () => {
    const dbPath = join(dir, 'cache.db');
    seedDocuments(dbPath, [['qa-jirei', 'shohi/02/19', '事例', '製造物責任法の取扱い']]);
    const r = (await handleNtaSearchQa({ keyword: 'ＰＬ法' }, { dbPath })) as {
      keyword?: string;
      results?: unknown[];
    };
    expect(r.keyword).toBe('ＰＬ法');
    expect(r.results).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* 略称辞書を引く入口                                                           */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-RESOLVE-ABBREVIATION-008 abbr の全角英数字・ダッシュ類・全角空白は半角に揃えてから辞書と照合する', () => {
  it('SPEC-NTA-RESOLVE-ABBREVIATION-008 ＰＬ法 は 製造物責任法・in_scope: false で、応答の abbr は渡した値のまま', async () => {
    const r = (await handleResolveAbbreviation({ abbr: 'ＰＬ法' })) as {
      abbr: string;
      resolved: { formal: string } | null;
      in_scope?: boolean;
    };
    expect(r.abbr).toBe('ＰＬ法');
    expect(r.resolved?.formal).toBe('製造物責任法');
    expect(r.in_scope).toBe(false);
  });

  it('SPEC-NTA-RESOLVE-ABBREVIATION-008 末尾が全角空白の 消基通　 は 消費税法基本通達・in_scope: true', async () => {
    const r = (await handleResolveAbbreviation({ abbr: '消基通　' })) as {
      resolved: { formal: string } | null;
      in_scope?: boolean;
    };
    expect(r.resolved?.formal).toBe('消費税法基本通達');
    expect(r.in_scope).toBe(true);
  });

  it('SPEC-NTA-RESOLVE-ABBREVIATION-008 大文字と小文字は区別するので pl法 は resolved: null のまま', async () => {
    const r = (await handleResolveAbbreviation({ abbr: 'pl法' })) as { resolved: unknown };
    expect(r.resolved).toBeNull();
  });
});

describe('SPEC-NTA-GET-TSUTATSU-018 name の全角英数字・ダッシュ類・全角空白は半角に揃えてから略称辞書で引く', () => {
  function seedClause(dbPath: string): void {
    const db = new Database(dbPath);
    initSchema(db);
    db.prepare(
      `INSERT INTO tsutatsu(id, formal_name, abbr, source_root_url) VALUES (1, '消費税法基本通達', '消基通', '${NTA_ORIGIN}/law/tsutatsu/kihon/shohi/')`
    ).run();
    db.prepare(`INSERT INTO chapter(tsutatsu_id, number, title) VALUES (1, 5, '課税範囲')`).run();
    db.prepare(
      `INSERT INTO section(tsutatsu_id, chapter_number, section_number, title, url, fetched_at) VALUES (1, 5, 1, '通則', ?, '2026-10-01T00:30:00.000Z')`
    ).run(`${NTA_ORIGIN}/law/tsutatsu/kihon/shohi/05/01.htm`);
    db.prepare(
      `INSERT INTO clause(tsutatsu_id, clause_number, source_url, chapter_number, section_number, title, full_text, paragraphs_json)
       VALUES (1, '5-1-9', ?, 5, 1, '保証金等のうち返還しないもの', '本文', '[]')`
    ).run(`${NTA_ORIGIN}/law/tsutatsu/kihon/shohi/05/01.htm`);
    db.close();
  }

  it('SPEC-NTA-GET-TSUTATSU-018 { name: "消基通　", clause: "５－１－９" } は { name: "消基通", clause: "5-1-9" } と同じ応答', async () => {
    const dbPath = join(dir, 'cache.db');
    seedClause(dbPath);
    const full = await getTsutatsu(
      { name: '消基通　', clause: '５－１－９', format: 'json' },
      { dbPath }
    );
    const half = await getTsutatsu({ name: '消基通', clause: '5-1-9', format: 'json' }, { dbPath });
    expect((full as { code?: string }).code).toBeUndefined();
    expect(full).toEqual(half);
  });

  it('SPEC-NTA-GET-TSUTATSU-018 管轄の判定も同じ規則: ＰＬ法 は ABBREVIATION_NOT_FOUND ではなく OUT_OF_SCOPE', async () => {
    const r = (await getTsutatsu(
      { name: 'ＰＬ法', clause: '1' },
      { dbPath: join(dir, 'cache.db') }
    )) as { code?: string };
    expect(r.code).toBe('OUT_OF_SCOPE');
  });
});

/* -------------------------------------------------------------------------- */
/* 文書の識別子                                                                 */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-GET-QA-016 category と id は半角に揃えてから形を確かめる', () => {
  it('SPEC-NTA-GET-QA-016 { category: "０２", id: "１９" } は { category: "02", id: "19" } と同じ応答で、半角の URL を取りに行く', async () => {
    const a = fixtureFetch(
      'www.nta.go.jp_law_shitsugi_shohi_02_19.htm',
      'text/html; charset=Shift_JIS'
    );
    const full = (await getQa(
      { topic: 'shohi', category: '０２', id: '１９', format: 'json' },
      { fetchImpl: a.fetchImpl, dbPath: join(dir, 'a.db') }
    )) as { qa?: Record<string, unknown>; code?: string };
    const b = fixtureFetch(
      'www.nta.go.jp_law_shitsugi_shohi_02_19.htm',
      'text/html; charset=Shift_JIS'
    );
    const half = (await getQa(
      { topic: 'shohi', category: '02', id: '19', format: 'json' },
      { fetchImpl: b.fetchImpl, dbPath: join(dir, 'b.db') }
    )) as { qa?: Record<string, unknown> };
    expect(full.code).toBeUndefined();
    expect(a.urls).toEqual([`${NTA_ORIGIN}/law/shitsugi/shohi/02/19.htm`]);
    expect({ ...full.qa, fetchedAt: undefined }).toEqual({ ...half.qa, fetchedAt: undefined });
  });
});

describe('SPEC-NTA-GET-TAX-ANSWER-015 no は半角に揃えてから形を確かめる', () => {
  it('SPEC-NTA-GET-TAX-ANSWER-015 SPEC-NTA-GET-TAX-ANSWER-001 { no: "６１０１" } は { no: "6101" } と同じ応答（v0.21.3 は INVALID_ARGUMENT）', async () => {
    const a = fixtureFetch(
      'www.nta.go.jp_taxes_shiraberu_taxanswer_shohi_6101.htm',
      'text/html; charset=utf-8'
    );
    const full = (await getTaxAnswer(
      { no: '６１０１', format: 'json' },
      { fetchImpl: a.fetchImpl, dbPath: join(dir, 'a.db') }
    )) as { taxAnswer?: Record<string, unknown>; code?: string };
    const b = fixtureFetch(
      'www.nta.go.jp_taxes_shiraberu_taxanswer_shohi_6101.htm',
      'text/html; charset=utf-8'
    );
    const half = (await getTaxAnswer(
      { no: '6101', format: 'json' },
      { fetchImpl: b.fetchImpl, dbPath: join(dir, 'b.db') }
    )) as { taxAnswer?: Record<string, unknown> };
    expect(full.code).toBeUndefined();
    expect(a.urls).toEqual([`${NTA_ORIGIN}/taxes/shiraberu/taxanswer/shohi/6101.htm`]);
    expect({ ...full.taxAnswer, fetchedAt: undefined }).toEqual({
      ...half.taxAnswer,
      fetchedAt: undefined,
    });
  });

  it('SPEC-NTA-GET-TAX-ANSWER-015 全角の数字を揃えても 4 桁でなければ INVALID_ARGUMENT（"６１"）', async () => {
    const r = (await getTaxAnswer({ no: '６１' }, { dbPath: join(dir, 'c.db') })) as {
      code?: string;
      detail?: { issues?: Array<{ path: string }> };
    };
    expect(r.code).toBe('INVALID_ARGUMENT');
    expect(r.detail?.issues?.[0]?.path).toBe('no');
  });
});

const DOC_ID_CASES: Array<{
  id: string;
  docType: string;
  full: string;
  half: string;
  call: (docId: string, dbPath: string) => Promise<unknown>;
}> = [
  {
    id: 'SPEC-NTA-GET-KAISEI-TSUTATSU-011',
    docType: 'kaisei',
    full: '００２６００３―０６７',
    half: '0026003-067',
    call: (docId, dbPath) => handleNtaGetKaiseiTsutatsu({ docId, format: 'json' }, { dbPath }),
  },
  {
    id: 'SPEC-NTA-GET-JIMU-UNEI-011',
    docType: 'jimu-unei',
    full: 'shotoku/shinkoku/１７０３３１',
    half: 'shotoku/shinkoku/170331',
    call: (docId, dbPath) => handleNtaGetJimuUnei({ docId, format: 'json' }, { dbPath }),
  },
  {
    id: 'SPEC-NTA-GET-BUNSHOKAITOU-011',
    docType: 'bunshokaitou',
    full: 'shotoku/２５０４１６',
    half: 'shotoku/250416',
    call: (docId, dbPath) => handleNtaGetBunshokaitou({ docId, format: 'json' }, { dbPath }),
  },
  {
    id: 'SPEC-NTA-INSPECT-PDF-META-020',
    docType: 'kaisei',
    full: '００２６００３―０６７',
    half: '0026003-067',
    call: (docId, dbPath) => handleNtaInspectPdfMeta({ docType: 'kaisei', docId }, { dbPath }),
  },
];

describe('SPEC-NTA-GET-KAISEI-TSUTATSU-011 SPEC-NTA-GET-JIMU-UNEI-011 SPEC-NTA-GET-BUNSHOKAITOU-011 SPEC-NTA-INSPECT-PDF-META-020 docId は半角に揃えてから形を確かめる', () => {
  for (const c of DOC_ID_CASES) {
    describe(`${c.id} docId は半角に揃えてから形を確かめる`, () => {
      it(`${c.id} { docId: "${c.full}" } は { docId: "${c.half}" } と同じ応答`, async () => {
        const dbPath = join(dir, 'cache.db');
        seedDocuments(dbPath, [[c.docType, c.half, `題名 ${c.half}`, '本文']]);
        const full = (await c.call(c.full, dbPath)) as { code?: string };
        const half = await c.call(c.half, dbPath);
        expect(full.code).toBeUndefined();
        expect(full).toEqual(half);
      });
    });
  }
});

/* -------------------------------------------------------------------------- */
/* db_schema                                                                   */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-DB-SCHEMA-001 DB を開くとテーブルを作り、スキーマの版 11 を記録する', () => {
  it('SPEC-NTA-DB-SCHEMA-001 新しい DB の schema_meta の schema_version は "11"', () => {
    const db = new Database(':memory:');
    try {
      initSchema(db);
      expect(SCHEMA_VERSION).toBe(11);
      const row = db
        .prepare(`SELECT value FROM schema_meta WHERE key = 'schema_version'`)
        .get() as {
        value: string;
      };
      expect(row.value).toBe('11');
    } finally {
      db.close();
    }
  });
});

describe('SPEC-NTA-DB-SCHEMA-019 版 10 の DB を開くと、ダッシュ類も揃えた形で clause・section・document の文字列を入れ直し、版 11 にする', () => {
  let db: DatabaseT.Database;

  /** 今のスキーマにダッシュ類を含む行を入れ、schema_version だけ 10 に戻した DB を作る */
  function seedV10Database(): void {
    initSchema(db);
    db.prepare(
      `INSERT INTO tsutatsu(id, formal_name, abbr, source_root_url) VALUES (1, '消費税法基本通達', '消基通', 'https://example.com/')`
    ).run();
    db.prepare(
      `INSERT INTO section(tsutatsu_id, chapter_number, section_number, title, url, fetched_at, content_hash)
       VALUES (1, 1, 4, '第1節―通則', 'https://example.com/01/04.htm', '2026-09-07T00:00:00Z', 'old')`
    ).run();
    db.prepare(
      `INSERT INTO clause(tsutatsu_id, clause_number, source_url, chapter_number, section_number, title, full_text, paragraphs_json)
       VALUES (1, '1―4―13の2', 'https://example.com/x', 1, 4, '題名—ダッシュ', '本文−マイナス', ?)`
    ).run(JSON.stringify([{ indent: 0, text: '段落‐ハイフン' }]));
    const doc = db.prepare(
      `INSERT INTO document(doc_type, doc_id, taxonomy, title, source_url, fetched_at, full_text, attached_pdfs_json, content_hash)
       VALUES (?, ?, 'shohi', ?, ?, '2026-09-07T00:00:00Z', ?, '[]', ?)`
    );
    doc.run(
      'kaisei',
      '0026003-067',
      '改正–通達',
      'https://example.com/k1',
      '課消２―11 の改正',
      'old-hash'
    );
    doc.run(
      'kaisei',
      '0026003-068',
      '改正通達',
      'https://example.com/k2',
      '課消２―12 の改正',
      null
    );
    db.prepare(`UPDATE schema_meta SET value = '10' WHERE key = 'schema_version'`).run();
  }

  beforeEach(() => {
    db = new Database(':memory:');
    seedV10Database();
    initSchema(db);
  });
  afterEach(() => {
    db.close();
  });

  it('SPEC-NTA-DB-SCHEMA-019 schema_version は 11 になる', () => {
    expect(getSchemaVersion(db)).toBe(11);
  });

  it('SPEC-NTA-DB-SCHEMA-019 clause の条番号・題名・本文・段落 JSON のダッシュ類が - になる', () => {
    const row = db
      .prepare('SELECT clause_number, title, full_text, paragraphs_json FROM clause')
      .get() as {
      clause_number: string;
      title: string;
      full_text: string;
      paragraphs_json: string;
    };
    expect(row.clause_number).toBe('1-4-13の2');
    expect(row.title).toBe('題名-ダッシュ');
    expect(row.full_text).toBe('本文-マイナス');
    expect(JSON.parse(row.paragraphs_json)).toEqual([{ indent: 0, text: '段落-ハイフン' }]);
  });

  it('SPEC-NTA-DB-SCHEMA-019 section の題名と document の題名・本文のダッシュ類が - になり、document_fts で 課消2-11 が当たる', () => {
    const section = db.prepare('SELECT title FROM section').get() as { title: string };
    expect(section.title).toBe('第1節-通則');
    const doc = db
      .prepare(`SELECT title, full_text FROM document WHERE doc_id = '0026003-067'`)
      .get() as { title: string; full_text: string };
    expect(doc.title).toBe('改正-通達');
    expect(doc.full_text).toContain('課消2-11');
    const hits = db
      .prepare(`SELECT title FROM document_fts WHERE document_fts MATCH ?`)
      .all('"課消2-11"');
    expect(hits).toHaveLength(1);
  });

  it('SPEC-NTA-DB-SCHEMA-019 もう一度開いても何も変わらない', () => {
    const before = db.prepare('SELECT title, full_text, content_hash FROM document').all();
    initSchema(db);
    expect(db.prepare('SELECT title, full_text, content_hash FROM document').all()).toEqual(before);
    expect(getSchemaVersion(db)).toBe(11);
  });

  it('SPEC-NTA-DB-SCHEMA-020 section の content_hash は NULL（未計算）に戻る', () => {
    const row = db.prepare('SELECT content_hash FROM section').get() as {
      content_hash: string | null;
    };
    expect(row.content_hash).toBeNull();
  });

  it('SPEC-NTA-DB-SCHEMA-020 document の content_hash は入れ直した題名・本文で計算し直し、持っていなかった行は NULL のまま', () => {
    const rows = db
      .prepare('SELECT doc_id, content_hash FROM document ORDER BY doc_id')
      .all() as Array<{ doc_id: string; content_hash: string | null }>;
    const expected = createHash('sha1')
      .update('kaisei')
      .update('\n')
      .update('0026003-067')
      .update('\n')
      .update('改正-通達')
      .update('\n')
      .update('課消2-11 の改正')
      .digest('hex');
    expect(rows).toEqual([
      { doc_id: '0026003-067', content_hash: expected },
      { doc_id: '0026003-068', content_hash: null },
    ]);
  });
});

describe('SPEC-NTA-DB-SCHEMA-019 版 4 の DB は、版 5 の入れ直しの後にこの入れ直しも通る', () => {
  it('SPEC-NTA-DB-SCHEMA-019 版 4 の DB の 課消２―11 は 課消2-11 になり、版 11 になる', () => {
    const db = new Database(':memory:');
    try {
      initSchema(db);
      db.prepare(
        `INSERT INTO document(doc_type, doc_id, taxonomy, title, source_url, fetched_at, full_text, attached_pdfs_json, content_hash)
         VALUES ('kaisei', '0026003-067', 'shohi', 'ＮＩＳＡ改正', 'https://example.com/k1', '2026-09-07T00:00:00Z', '課消２―11', '[]', NULL)`
      ).run();
      db.prepare(`UPDATE schema_meta SET value = '4' WHERE key = 'schema_version'`).run();
      initSchema(db);
      expect(getSchemaVersion(db)).toBe(11);
      const row = db.prepare('SELECT title, full_text FROM document').get() as {
        title: string;
        full_text: string;
      };
      expect(row).toEqual({ title: 'NISA改正', full_text: '課消2-11' });
    } finally {
      db.close();
    }
  });
});
