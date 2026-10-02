/**
 * 差分 specs/changes/20261003-t4-response-shape/（PR #124）の受入テスト。
 *
 * 値の無いフィールドは null で置き、キーを消さない。検索の results[] には種別によらず issuedAt と basisDate を置く。
 *
 * - SPEC-NTA-SEARCH-RULES-011・015・020（search_rules）
 * - SPEC-NTA-SEARCH-TSUTATSU-005・010（0 件の count・freshness・legal_status）
 * - SPEC-NTA-GET-TSUTATSU-010（国税庁サイトの経路の available_clauses は最大 50 件）
 * - SPEC-NTA-GET-JIMU-UNEI-004・005・006、SPEC-NTA-GET-KAISEI-TSUTATSU-004・005・006、
 *   SPEC-NTA-GET-BUNSHOKAITOU-004・005・006（json の null と markdown の「取得元」の行）
 * - SPEC-NTA-GET-QA-008・010、SPEC-NTA-GET-TAX-ANSWER-008・009
 * - SPEC-NTA-INSPECT-PDF-META-002・010
 *
 * SPEC-NTA-COMMON-ERRORS-017 は本文を 0.22.0 の実装に合わせただけなので、
 * spec-20261001-t2-error-codes.test.ts の受入テストのまま確かめる。
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { encode as iconvEncode } from 'iconv-lite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initSchema } from '../db/schema.js';
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

const ORPHANED_AT = '2026-10-01T00:30:00Z';
const FETCHED_AT = '2026-10-01T00:00:00.000Z';
const SOURCE_LINE = '- **取得元**: ローカル DB（bulk download で取り込んだもの）';

const fixturesDir = resolve(import.meta.dirname, '..', '..', 'tests', 'fixtures');

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'houki-nta-t4-'));
  dbPath = join(dir, 'cache.db');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface DocRow {
  docType: string;
  docId: string;
  taxonomy?: string | null;
  title: string;
  body: string;
  issuedAt?: string | null;
  issuer?: string | null;
  orphanedAt?: string | null;
  structured?: unknown;
  pdfs?: unknown[];
}

function seedDocs(rows: DocRow[]): void {
  const db = new Database(dbPath);
  initSchema(db);
  const stmt = db.prepare(
    `INSERT INTO document(doc_type, doc_id, taxonomy, title, issued_at, issuer, source_url, fetched_at, full_text, attached_pdfs_json, content_hash, structured_json, orphaned_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const r of rows) {
    stmt.run(
      r.docType,
      r.docId,
      r.taxonomy === undefined ? 'shotoku' : r.taxonomy,
      r.title,
      r.issuedAt ?? null,
      r.issuer ?? null,
      `https://www.nta.go.jp/example/${r.docType}/${r.docId}.htm`,
      FETCHED_AT,
      r.body,
      JSON.stringify(r.pdfs ?? []),
      `hash-${r.docType}-${r.docId}`,
      r.structured === undefined ? null : JSON.stringify(r.structured),
      r.orphanedAt ?? null
    );
  }
  db.close();
}

/** 呼ばれたら必ず失敗する fetch。DB から返したことを確かめるために使う */
function fetchMustNotBeCalled(): typeof fetch {
  return vi.fn(async () => {
    throw new Error('国税庁サイトを取りに行ってはいけない');
  }) as unknown as typeof fetch;
}

function sjisFixtureFetch(fixtureName: string): typeof fetch {
  return vi.fn(async () => {
    const html = readFileSync(resolve(fixturesDir, fixtureName), 'utf8');
    return new Response(iconvEncode(html, 'shift_jis'), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=Shift_JIS' },
    });
  }) as unknown as typeof fetch;
}

type Json = Record<string, unknown>;
type SearchBody = {
  keyword?: string;
  count?: number;
  results?: Json[];
  hits?: Json[];
  hint?: string;
  message?: string;
  freshness?: { staleness?: string; oldest_fetched_at?: string };
  legal_status?: { binds_citizens?: boolean; binds_courts?: boolean; binds_tax_office?: boolean };
  base_laws_by_tsutatsu?: unknown;
  next_actions?: unknown;
};

/* -------------------------------------------------------------------------- */
/* search_rules: SPEC-NTA-SEARCH-RULES-015・011                                */
/* -------------------------------------------------------------------------- */

const RESULT_KEYS = [
  'docType',
  'docId',
  'taxonomy',
  'title',
  'issuedAt',
  'basisDate',
  'sourceUrl',
  'snippet',
  'score',
  'scoreReasons',
  'index_status',
  'orphaned_at',
];

describe('SPEC-NTA-SEARCH-RULES-015 文書系 5 ツールの results の要素は、種別によらず issuedAt・basisDate を含む同じキーを持つ', () => {
  it('SPEC-NTA-SEARCH-RULES-015 nta_search_qa: 要素は issuedAt: null・basisDate: null を持つ', async () => {
    seedDocs([
      {
        docType: 'qa-jirei',
        docId: 'gensen/01/01',
        title: '源泉徴収の事例 1',
        body: '源泉徴収の事務について',
      },
      {
        docType: 'qa-jirei',
        docId: 'gensen/01/02',
        title: '源泉徴収の事例 2',
        body: '源泉徴収の対象について',
      },
    ]);
    const r = (await handleNtaSearchQa({ keyword: '源泉徴収' }, { dbPath })) as SearchBody;
    expect(r.results).toHaveLength(2);
    for (const el of r.results ?? []) {
      expect(Object.keys(el).sort()).toEqual([...RESULT_KEYS].sort());
      expect(el.docType).toBe('qa-jirei');
      expect(el.issuedAt).toBeNull();
      expect(el.basisDate).toBeNull();
      expect(el.index_status).toBeNull();
      expect(el.orphaned_at).toBeNull();
    }
    const reasons = r.results?.[0]?.scoreReasons as string[] | undefined;
    expect(reasons?.[0]).toBe('doc_type=qa weight 0.70');
  });

  it('SPEC-NTA-SEARCH-RULES-015 nta_search_tax_answer: 法令時点が令和7年4月1日の記事は issuedAt: null・basisDate: "2025-04-01"', async () => {
    seedDocs([
      {
        docType: 'tax-answer',
        docId: '1120',
        taxonomy: 'shotoku',
        title: '医療費を支払ったとき（医療費控除）',
        body: '[令和7年4月1日現在法令等] 医療費控除の対象',
        issuedAt: '2025-04-01',
      },
    ]);
    const r = (await handleNtaSearchTaxAnswer({ keyword: '医療費控除' }, { dbPath })) as SearchBody;
    expect(r.results).toHaveLength(1);
    const el = r.results?.[0] ?? {};
    expect(Object.keys(el).sort()).toEqual([...RESULT_KEYS].sort());
    expect(el.issuedAt).toBeNull();
    expect(el.basisDate).toBe('2025-04-01');
  });

  it('SPEC-NTA-SEARCH-RULES-015 nta_search_tax_answer: 法令時点を読めなかった記事（DB の日付が無い）は basisDate: null', async () => {
    seedDocs([
      {
        docType: 'tax-answer',
        docId: '8001',
        taxonomy: 'sake',
        title: '酒類の製造免許',
        body: '酒類の製造免許の手続',
        issuedAt: null,
      },
    ]);
    const r = (await handleNtaSearchTaxAnswer({ keyword: '製造免許' }, { dbPath })) as SearchBody;
    expect(r.results?.[0]?.issuedAt).toBeNull();
    expect(r.results?.[0]?.basisDate).toBeNull();
    expect('basisDate' in (r.results?.[0] ?? {})).toBe(true);
  });

  const DATED: Array<
    [tool: string, docType: string, docId: string, call: (k: string) => Promise<unknown>]
  > = [
    [
      'nta_search_kaisei_tsutatsu',
      'kaisei',
      '0026003-067',
      (keyword) => handleNtaSearchKaiseiTsutatsu({ keyword }, { dbPath }),
    ],
    [
      'nta_search_jimu_unei',
      'jimu-unei',
      'shotoku/shinkoku/170331',
      (keyword) => handleNtaSearchJimuUnei({ keyword }, { dbPath }),
    ],
    [
      'nta_search_bunshokaitou',
      'bunshokaitou',
      'shotoku/250416',
      (keyword) => handleNtaSearchBunshokaitou({ keyword }, { dbPath }),
    ],
  ];

  for (const [tool, docType, docId, call] of DATED) {
    it(`SPEC-NTA-SEARCH-RULES-015 ${tool}: issuedAt は DB の発出日、DB に無ければ null、basisDate は常に null`, async () => {
      seedDocs([
        {
          docType,
          docId,
          title: '取扱いの文書 1',
          body: '株式報酬の取扱い 1',
          issuedAt: '2026-04-01',
        },
        {
          docType,
          docId: `${docId}-b`,
          title: '取扱いの文書 2',
          body: '株式報酬の取扱い 2',
          issuedAt: null,
        },
      ]);
      const r = (await call('株式報酬')) as SearchBody;
      expect(r.results).toHaveLength(2);
      const dated = r.results?.find((x) => x.docId === docId) ?? {};
      const undated = r.results?.find((x) => x.docId === `${docId}-b`) ?? {};
      expect(Object.keys(dated).sort()).toEqual([...RESULT_KEYS].sort());
      expect(Object.keys(undated).sort()).toEqual([...RESULT_KEYS].sort());
      expect(dated.issuedAt).toBe('2026-04-01');
      expect(undated.issuedAt).toBeNull();
      expect(dated.basisDate).toBeNull();
      expect(undated.basisDate).toBeNull();
    });
  }
});

describe('SPEC-NTA-SEARCH-RULES-011 索引にある文書では index_status と orphaned_at を null にする', () => {
  it('SPEC-NTA-SEARCH-RULES-011 nta_search_jimu_unei: 消えた文書は removed_from_index と日時、索引にある文書はどちらも null', async () => {
    seedDocs([
      {
        docType: 'jimu-unei',
        docId: 'shotoku/a/1',
        title: '指針 1',
        body: '調査手続の運営について 1',
        orphanedAt: ORPHANED_AT,
      },
      {
        docType: 'jimu-unei',
        docId: 'shotoku/a/2',
        title: '指針 2',
        body: '調査手続の運営について 2',
      },
    ]);
    const r = (await handleNtaSearchJimuUnei({ keyword: '調査手続' }, { dbPath })) as SearchBody & {
      search_notes?: string[];
    };
    const removed = r.results?.find((x) => x.docId === 'shotoku/a/1') ?? {};
    const current = r.results?.find((x) => x.docId === 'shotoku/a/2') ?? {};
    expect(removed.index_status).toBe('removed_from_index');
    expect(removed.orphaned_at).toBe(ORPHANED_AT);
    expect(current.index_status).toBeNull();
    expect(current.orphaned_at).toBeNull();
    expect('index_status' in current).toBe(true);
    expect('orphaned_at' in current).toBe(true);
    expect(r.search_notes?.some((n) => n.includes('2 件のうち 1 件'))).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* nta_search_tsutatsu: SPEC-NTA-SEARCH-TSUTATSU-005・010、SPEC-NTA-SEARCH-RULES-020 */
/* -------------------------------------------------------------------------- */

function seedClauses(): void {
  const db = new Database(dbPath);
  initSchema(db);
  const tsutatsuId = (
    db
      .prepare(
        'INSERT INTO tsutatsu(formal_name, abbr, source_root_url) VALUES (?, ?, ?) RETURNING id'
      )
      .get('法人税基本通達', '法基通', 'https://www.nta.go.jp/law/tsutatsu/kihon/hojin/') as {
      id: number;
    }
  ).id;
  db.prepare(
    `INSERT INTO section(tsutatsu_id, chapter_number, section_number, title, url, fetched_at)
     VALUES (?, 9, 2, '役員給与', 'https://www.nta.go.jp/law/tsutatsu/kihon/hojin/09/09_02_01.htm', ?)`
  ).run(tsutatsuId, FETCHED_AT);
  db.prepare(
    `INSERT INTO clause(tsutatsu_id, clause_number, source_url, chapter_number, section_number, title, full_text, paragraphs_json)
     VALUES (?, '9-2-1', 'https://www.nta.go.jp/law/tsutatsu/kihon/hojin/09/09_02_01.htm', 9, 2, '役員の範囲', '役員の範囲\n法第2条第15号に規定する役員には、経営に従事している者が含まれる。', '[]')`
  ).run(tsutatsuId);
  db.close();
}

describe('SPEC-NTA-SEARCH-TSUTATSU-005 合う条項が無いときは count: 0 と freshness・legal_status を返す', () => {
  it('SPEC-NTA-SEARCH-TSUTATSU-005 条項がある DB で { keyword: "存在しない語句" } は count: 0・hits: []・message・freshness・legal_status', async () => {
    seedClauses();
    const r = (await searchTsutatsu({ keyword: '存在しない語句' }, { dbPath })) as SearchBody;
    expect(r.keyword).toBe('存在しない語句');
    expect(r.count).toBe(0);
    expect(r.hits).toEqual([]);
    expect(r.message).toBe('"存在しない語句" にマッチする clause はありません');
    expect(r.freshness?.staleness).toBeTypeOf('string');
    expect(r.freshness?.oldest_fetched_at).toBe(FETCHED_AT);
    expect(r.legal_status?.binds_tax_office).toBe(true);
  });

  it('SPEC-NTA-SEARCH-TSUTATSU-005 0 件のときは base_laws_by_tsutatsu と next_actions を付けない', async () => {
    seedClauses();
    const r = (await searchTsutatsu({ keyword: '存在しない語句' }, { dbPath })) as SearchBody;
    expect(r.base_laws_by_tsutatsu).toBeUndefined();
    expect(r.next_actions).toBeUndefined();
  });

  it('SPEC-NTA-SEARCH-TSUTATSU-005 keyword は前後の空白を除いて返す', async () => {
    seedClauses();
    const r = (await searchTsutatsu({ keyword: '  存在しない語句  ' }, { dbPath })) as SearchBody;
    expect(r.keyword).toBe('存在しない語句');
    expect(r.count).toBe(0);
  });
});

describe('SPEC-NTA-SEARCH-TSUTATSU-010 legal_status は、ヒットの有無によらず付ける', () => {
  it('SPEC-NTA-SEARCH-TSUTATSU-010 1 件当たったときも 0 件のときも legal_status は binds_citizens: false・binds_courts: false・binds_tax_office: true', async () => {
    seedClauses();
    for (const keyword of ['役員', '存在しない語句']) {
      const r = (await searchTsutatsu({ keyword }, { dbPath })) as SearchBody;
      expect(r.legal_status?.binds_citizens).toBe(false);
      expect(r.legal_status?.binds_courts).toBe(false);
      expect(r.legal_status?.binds_tax_office).toBe(true);
    }
  });
});

describe('SPEC-NTA-SEARCH-RULES-020 nta_search_tsutatsu の hits・message と、文書系の results・hint の名前は別のまま', () => {
  it('SPEC-NTA-SEARCH-RULES-020 nta_search_tsutatsu の配列は hits で、results は無い', async () => {
    seedClauses();
    const hit = (await searchTsutatsu({ keyword: '役員' }, { dbPath })) as SearchBody;
    expect(Array.isArray(hit.hits)).toBe(true);
    expect(hit.results).toBeUndefined();
    const zero = (await searchTsutatsu({ keyword: '存在しない語句' }, { dbPath })) as SearchBody;
    expect(zero.message).toBeTypeOf('string');
    expect(zero.hint).toBeUndefined();
    expect(zero.results).toBeUndefined();
  });

  it('SPEC-NTA-SEARCH-RULES-020 nta_search_qa の配列は results で、hits は無い。0 件の説明は hint で、message は無い', async () => {
    seedDocs([
      {
        docType: 'qa-jirei',
        docId: 'gensen/01/01',
        title: '源泉徴収の事例',
        body: '源泉徴収の事務について',
      },
    ]);
    const hit = (await handleNtaSearchQa({ keyword: '源泉徴収' }, { dbPath })) as SearchBody;
    expect(Array.isArray(hit.results)).toBe(true);
    expect(hit.hits).toBeUndefined();
    const zero = (await handleNtaSearchQa({ keyword: '存在しない語句' }, { dbPath })) as SearchBody;
    expect(zero.results).toEqual([]);
    expect(zero.hint).toBeTypeOf('string');
    expect(zero.message).toBeUndefined();
    expect(zero.hits).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* nta_get_tsutatsu: SPEC-NTA-GET-TSUTATSU-010                                 */
/* -------------------------------------------------------------------------- */

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

describe('SPEC-NTA-GET-TSUTATSU-010 候補ページのどれにも条項が無いときは、見たページの番号（最大 50 件）と URL を返す', () => {
  it('SPEC-NTA-GET-TSUTATSU-010 取得したページに条項が 80 件あり、どれも求めた条項でないとき、available_clauses は先頭から 50 件', async () => {
    const toc = readFileSync(
      resolve(fixturesDir, 'www.nta.go.jp_law_tsutatsu_kihon_shohi_01.htm'),
      'utf8'
    );
    const page = sectionPageWithClauses(80);
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const html = new URL(url).pathname === '/law/tsutatsu/kihon/shohi/01.htm' ? toc : page;
      return new Response(iconvEncode(html, 'shift_jis'), {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=Shift_JIS' },
      });
    }) as unknown as typeof fetch;

    const r = (await getTsutatsu(
      { name: '消基通', clause: '1-4-99', format: 'json' },
      { fetchImpl, dbPath: ':memory:', pageIntervalMs: 0 }
    )) as { code?: string; available_clauses?: string[]; searched_urls?: string[] };

    expect(r.code).toBe('ARTICLE_NOT_FOUND');
    expect(r.available_clauses).toHaveLength(50);
    expect(r.available_clauses?.[0]).toBe('1-4-1');
    expect(r.available_clauses?.[49]).toBe('1-4-50');
    expect(r.searched_urls?.length).toBeGreaterThan(0);
  }, 30_000);
});

/* -------------------------------------------------------------------------- */
/* 取得 3 ツール（DB だけを引く）: 004・005・006                                */
/* -------------------------------------------------------------------------- */

type GetJson = {
  document?: Json;
  index_status?: unknown;
  orphaned_at?: unknown;
  notice?: unknown;
  source?: string;
};

const DB_GET_TOOLS: Array<{
  tool: string;
  docType: string;
  docId: string;
  prefix: string;
  call: (docId: string, format: 'json' | 'markdown') => Promise<unknown>;
}> = [
  {
    tool: 'nta_get_kaisei_tsutatsu',
    docType: 'kaisei',
    docId: '0026003-067',
    prefix: 'SPEC-NTA-GET-KAISEI-TSUTATSU',
    call: (docId, format) => handleNtaGetKaiseiTsutatsu({ docId, format }, { dbPath }),
  },
  {
    tool: 'nta_get_jimu_unei',
    docType: 'jimu-unei',
    docId: 'shotoku/shinkoku/170331',
    prefix: 'SPEC-NTA-GET-JIMU-UNEI',
    call: (docId, format) => handleNtaGetJimuUnei({ docId, format }, { dbPath }),
  },
  {
    tool: 'nta_get_bunshokaitou',
    docType: 'bunshokaitou',
    docId: 'shotoku/250416',
    prefix: 'SPEC-NTA-GET-BUNSHOKAITOU',
    call: (docId, format) => handleNtaGetBunshokaitou({ docId, format }, { dbPath }),
  },
];

for (const t of DB_GET_TOOLS) {
  describe(`${t.prefix}-004 ${t.tool} — 索引にある文書では印のキーを null にする`, () => {
    it(`${t.prefix}-004 索引にある文書を json で取ると index_status・orphaned_at・notice・document.orphanedAt はどれも null`, async () => {
      seedDocs([{ docType: t.docType, docId: t.docId, title: '索引にある文書', body: '本文' }]);
      const r = (await t.call(t.docId, 'json')) as GetJson;
      expect(r.index_status).toBeNull();
      expect(r.orphaned_at).toBeNull();
      expect(r.notice).toBeNull();
      expect(r.document?.orphanedAt).toBeNull();
      for (const key of ['index_status', 'orphaned_at', 'notice']) expect(key in r).toBe(true);
    });

    it(`${t.prefix}-004 索引から消えた文書は removed_from_index・日時・注記で、document.orphanedAt にも同じ日時`, async () => {
      seedDocs([
        {
          docType: t.docType,
          docId: t.docId,
          title: '消えた文書',
          body: '本文',
          orphanedAt: ORPHANED_AT,
        },
      ]);
      const r = (await t.call(t.docId, 'json')) as GetJson;
      expect(r.index_status).toBe('removed_from_index');
      expect(r.orphaned_at).toBe(ORPHANED_AT);
      expect(r.notice).toBeTypeOf('string');
      expect(r.document?.orphanedAt).toBe(ORPHANED_AT);
    });

    it(`${t.prefix}-004 markdown: 索引から消えた文書は「取得元」の行の次に索引の状態の行、空行、「> 」の注記`, async () => {
      seedDocs([
        {
          docType: t.docType,
          docId: t.docId,
          title: '消えた文書',
          body: '本文',
          orphanedAt: ORPHANED_AT,
        },
      ]);
      const md = (await t.call(t.docId, 'markdown')) as string;
      const lines = md.split('\n');
      const srcIdx = lines.indexOf(SOURCE_LINE);
      expect(srcIdx).toBeGreaterThan(0);
      expect(lines[srcIdx + 1]).toBe(
        `- **索引の状態**: removed_from_index（${ORPHANED_AT} に確認）`
      );
      expect(lines[srcIdx + 2]).toBe('');
      expect(lines[srcIdx + 3]?.startsWith('> ')).toBe(true);
    });

    it(`${t.prefix}-004 markdown: 索引にある文書には索引の状態の行を入れない`, async () => {
      seedDocs([{ docType: t.docType, docId: t.docId, title: '索引にある文書', body: '本文' }]);
      const md = (await t.call(t.docId, 'markdown')) as string;
      expect(md).not.toContain('索引の状態');
    });
  });

  describe(`${t.tool} — 「取得元」の行（markdown）と json の null`, () => {
    it(`${t.tool === 'nta_get_jimu_unei' ? `${t.prefix}-006` : `${t.prefix}-005`} markdown: 「- **取得**」の行の次に「- **取得元**: ローカル DB（bulk download で取り込んだもの）」`, async () => {
      seedDocs([
        {
          docType: t.docType,
          docId: t.docId,
          title: '取扱いの文書',
          body: '本文',
          issuedAt: '2026-04-01',
          issuer: '国税庁長官',
        },
      ]);
      const md = (await t.call(t.docId, 'markdown')) as string;
      const lines = md.split('\n');
      const fetchedIdx = lines.findIndex((l) => l.startsWith('- **取得**: '));
      expect(fetchedIdx).toBeGreaterThan(0);
      expect(lines[fetchedIdx]).toBe(`- **取得**: ${FETCHED_AT}`);
      expect(lines[fetchedIdx + 1]).toBe(SOURCE_LINE);
      // 発出日の行は DB にあるときだけ（変わらない振る舞い）
      expect(md).toContain('- **発出日**: 2026-04-01');
    });

    it(`${t.tool === 'nta_get_jimu_unei' ? `${t.prefix}-005` : `${t.prefix}-006`} json: 発出日と宛先が DB に無い文書では document.issuedAt: null・document.issuer: null`, async () => {
      seedDocs([{ docType: t.docType, docId: t.docId, title: '日付の無い文書', body: '本文' }]);
      const r = (await t.call(t.docId, 'json')) as GetJson;
      expect(r.document?.issuedAt).toBeNull();
      expect(r.document?.issuer).toBeNull();
      expect(r.document?.orphanedAt).toBeNull();
      for (const key of ['issuedAt', 'issuer', 'orphanedAt']) {
        expect(key in (r.document ?? {})).toBe(true);
      }
      expect(r.source).toBe('db');
    });

    it(`${t.tool === 'nta_get_jimu_unei' ? `${t.prefix}-005` : `${t.prefix}-006`} json: 発出日と宛先が DB にあればその値`, async () => {
      seedDocs([
        {
          docType: t.docType,
          docId: t.docId,
          title: '日付のある文書',
          body: '本文',
          issuedAt: '2026-04-01',
          issuer: '国税庁長官',
        },
      ]);
      const r = (await t.call(t.docId, 'json')) as GetJson;
      expect(r.document?.issuedAt).toBe('2026-04-01');
      expect(r.document?.issuer).toBe('国税庁長官');
    });
  });
}

/* -------------------------------------------------------------------------- */
/* nta_get_qa: SPEC-NTA-GET-QA-008・010                                        */
/* -------------------------------------------------------------------------- */

function qaStructure(extra: Record<string, unknown> = {}) {
  return {
    topic: 'shohi',
    category: '02',
    id: '19',
    title: '事例の題名',
    question: ['照会要旨'],
    answer: ['回答要旨'],
    relatedLaws: [],
    ...extra,
  };
}

describe('SPEC-NTA-GET-QA-008 json の応答は、値の無いフィールドを null にする', () => {
  it('SPEC-NTA-GET-QA-008 注記の無い事例は qa.notice: null・qa.basisDate: null', async () => {
    seedDocs([
      {
        docType: 'qa-jirei',
        docId: 'shohi/02/19',
        taxonomy: 'shohi',
        title: '事例の題名',
        body: '本文',
        structured: qaStructure(),
      },
    ]);
    const r = (await getQa(
      { topic: 'shohi', category: '02', id: '19', format: 'json' },
      { fetchImpl: fetchMustNotBeCalled(), dbPath }
    )) as { qa: Json; source: string };
    expect(r.source).toBe('db');
    expect(r.qa.notice).toBeNull();
    expect(r.qa.basisDate).toBeNull();
    expect('notice' in r.qa).toBe(true);
    expect('basisDate' in r.qa).toBe(true);
  });

  it('SPEC-NTA-GET-QA-008 注記はあるが日付を読めない事例は qa.basisDate だけ null', async () => {
    seedDocs([
      {
        docType: 'qa-jirei',
        docId: 'shohi/02/19',
        taxonomy: 'shohi',
        title: '事例の題名',
        body: '本文',
        structured: qaStructure({ notice: '注記: 日付の書かれていない注記' }),
      },
    ]);
    const r = (await getQa(
      { topic: 'shohi', category: '02', id: '19', format: 'json' },
      { fetchImpl: fetchMustNotBeCalled(), dbPath }
    )) as { qa: Json };
    expect(r.qa.notice).toBe('注記: 日付の書かれていない注記');
    expect(r.qa.basisDate).toBeNull();
  });
});

describe('SPEC-NTA-GET-QA-010 索引から消えた事例以外では印のキーを null にする', () => {
  it('SPEC-NTA-GET-QA-010 索引にある事例を DB から json で取ると index_status・orphaned_at・notice は null', async () => {
    seedDocs([
      {
        docType: 'qa-jirei',
        docId: 'shohi/02/19',
        taxonomy: 'shohi',
        title: '事例の題名',
        body: '本文',
        structured: qaStructure(),
      },
    ]);
    const r = (await getQa(
      { topic: 'shohi', category: '02', id: '19', format: 'json' },
      { fetchImpl: fetchMustNotBeCalled(), dbPath }
    )) as Json;
    expect(r.index_status).toBeNull();
    expect(r.orphaned_at).toBeNull();
    expect(r.notice).toBeNull();
    for (const key of ['index_status', 'orphaned_at', 'notice']) expect(key in r).toBe(true);
  });

  it('SPEC-NTA-GET-QA-010 この呼び出しで国税庁サイトから取った事例も index_status・orphaned_at・notice は null', async () => {
    const r = (await getQa(
      { topic: 'shohi', category: '02', id: '19', format: 'json' },
      { fetchImpl: sjisFixtureFetch('www.nta.go.jp_law_shitsugi_shohi_02_19.htm'), dbPath }
    )) as Json;
    expect(r.source).toBe('live');
    expect(r.index_status).toBeNull();
    expect(r.orphaned_at).toBeNull();
    expect(r.notice).toBeNull();
  });

  it('SPEC-NTA-GET-QA-010 索引から消えた事例は removed_from_index・日時・注記', async () => {
    seedDocs([
      {
        docType: 'qa-jirei',
        docId: 'shohi/02/19',
        taxonomy: 'shohi',
        title: '事例の題名',
        body: '本文',
        structured: qaStructure(),
        orphanedAt: ORPHANED_AT,
      },
    ]);
    const r = (await getQa(
      { topic: 'shohi', category: '02', id: '19', format: 'json' },
      { fetchImpl: fetchMustNotBeCalled(), dbPath }
    )) as Json;
    expect(r.index_status).toBe('removed_from_index');
    expect(r.orphaned_at).toBe(ORPHANED_AT);
    expect(r.notice).toBeTypeOf('string');
  });
});

/* -------------------------------------------------------------------------- */
/* nta_get_tax_answer: SPEC-NTA-GET-TAX-ANSWER-008・009                        */
/* -------------------------------------------------------------------------- */

function taxAnswerStructure(extra: Record<string, unknown> = {}) {
  return {
    no: '1120',
    title: '医療費を支払ったとき（医療費控除）',
    sections: [{ heading: '概要', paragraphs: ['医療費控除の概要'] }],
    ...extra,
  };
}

describe('SPEC-NTA-GET-TAX-ANSWER-008 json の応答は、値の無いフィールドを null にし、taxAnswer.basisDate を持つ', () => {
  it('SPEC-NTA-GET-TAX-ANSWER-008 法令時点が「令和7年4月1日現在法令等」の記事は effectiveDate がその文字列、basisDate: "2025-04-01"（DB の経路）', async () => {
    seedDocs([
      {
        docType: 'tax-answer',
        docId: '1120',
        title: '医療費を支払ったとき（医療費控除）',
        body: '本文',
        issuedAt: '2025-04-01',
        structured: taxAnswerStructure({
          effectiveDate: '令和7年4月1日現在法令等',
          taxCategory: '所得税',
        }),
      },
    ]);
    const r = (await getTaxAnswer(
      { no: '1120', format: 'json' },
      { fetchImpl: fetchMustNotBeCalled(), dbPath }
    )) as { taxAnswer: Json; source: string };
    expect(r.source).toBe('db');
    expect(r.taxAnswer.effectiveDate).toBe('令和7年4月1日現在法令等');
    expect(r.taxAnswer.basisDate).toBe('2025-04-01');
    expect(r.taxAnswer.taxCategory).toBe('所得税');
  });

  it('SPEC-NTA-GET-TAX-ANSWER-008 DB の経路の basisDate は、検索の results[].basisDate（DB の発出日の列）と同じ値', async () => {
    seedDocs([
      {
        docType: 'tax-answer',
        docId: '1120',
        title: '医療費を支払ったとき（医療費控除）',
        body: '[令和7年4月1日現在法令等] 医療費控除の対象',
        issuedAt: '2025-04-01',
        structured: taxAnswerStructure({ effectiveDate: '令和7年4月1日現在法令等' }),
      },
    ]);
    const got = (await getTaxAnswer(
      { no: '1120', format: 'json' },
      { fetchImpl: fetchMustNotBeCalled(), dbPath }
    )) as { taxAnswer: Json };
    const searched = (await handleNtaSearchTaxAnswer(
      { keyword: '医療費控除' },
      { dbPath }
    )) as SearchBody;
    expect(got.taxAnswer.basisDate).toBe(searched.results?.[0]?.basisDate);
  });

  it('SPEC-NTA-GET-TAX-ANSWER-008 法令時点の書かれていない記事は effectiveDate: null・basisDate: null、対象税目が無ければ taxCategory: null', async () => {
    seedDocs([
      {
        docType: 'tax-answer',
        docId: '1120',
        title: '医療費を支払ったとき（医療費控除）',
        body: '本文',
        structured: taxAnswerStructure(),
      },
    ]);
    const r = (await getTaxAnswer(
      { no: '1120', format: 'json' },
      { fetchImpl: fetchMustNotBeCalled(), dbPath }
    )) as { taxAnswer: Json };
    expect(r.taxAnswer.effectiveDate).toBeNull();
    expect(r.taxAnswer.basisDate).toBeNull();
    expect(r.taxAnswer.taxCategory).toBeNull();
    for (const key of ['effectiveDate', 'basisDate', 'taxCategory']) {
      expect(key in r.taxAnswer).toBe(true);
    }
  });

  it('SPEC-NTA-GET-TAX-ANSWER-008 法令時点の日付を読めない記事は effectiveDate は文字列のまま、basisDate: null', async () => {
    seedDocs([
      {
        docType: 'tax-answer',
        docId: '1120',
        title: '医療費を支払ったとき（医療費控除）',
        body: '本文',
        structured: taxAnswerStructure({ effectiveDate: '現在法令等' }),
      },
    ]);
    const r = (await getTaxAnswer(
      { no: '1120', format: 'json' },
      { fetchImpl: fetchMustNotBeCalled(), dbPath }
    )) as { taxAnswer: Json };
    expect(r.taxAnswer.effectiveDate).toBe('現在法令等');
    expect(r.taxAnswer.basisDate).toBeNull();
  });

  it('SPEC-NTA-GET-TAX-ANSWER-008 国税庁サイトの経路でも同じ読み方（6101 は令和7年4月1日 → "2025-04-01"）', async () => {
    const r = (await getTaxAnswer(
      { no: '6101', format: 'json' },
      {
        fetchImpl: sjisFixtureFetch('www.nta.go.jp_taxes_shiraberu_taxanswer_shohi_6101.htm'),
        dbPath,
      }
    )) as { taxAnswer: Json; source: string };
    expect(r.source).toBe('live');
    expect(r.taxAnswer.effectiveDate).toBe('令和7年4月1日現在法令等');
    expect(r.taxAnswer.basisDate).toBe('2025-04-01');
  });

  it('SPEC-NTA-GET-TAX-ANSWER-008 元年は 1 年として読む（令和元年5月1日 → "2019-05-01"）', async () => {
    seedDocs([
      {
        docType: 'tax-answer',
        docId: '1120',
        title: '医療費を支払ったとき（医療費控除）',
        body: '本文',
        structured: taxAnswerStructure({ effectiveDate: '令和元年5月1日現在法令等' }),
      },
    ]);
    const r = (await getTaxAnswer(
      { no: '1120', format: 'json' },
      { fetchImpl: fetchMustNotBeCalled(), dbPath }
    )) as { taxAnswer: Json };
    expect(r.taxAnswer.basisDate).toBe('2019-05-01');
  });
});

describe('SPEC-NTA-GET-TAX-ANSWER-009 索引から消えた記事以外では印のキーを null にする', () => {
  it('SPEC-NTA-GET-TAX-ANSWER-009 索引にある記事を DB から json で取ると index_status・orphaned_at・notice は null', async () => {
    seedDocs([
      {
        docType: 'tax-answer',
        docId: '1120',
        title: '医療費を支払ったとき（医療費控除）',
        body: '本文',
        structured: taxAnswerStructure(),
      },
    ]);
    const r = (await getTaxAnswer(
      { no: '1120', format: 'json' },
      { fetchImpl: fetchMustNotBeCalled(), dbPath }
    )) as Json;
    expect(r.index_status).toBeNull();
    expect(r.orphaned_at).toBeNull();
    expect(r.notice).toBeNull();
    for (const key of ['index_status', 'orphaned_at', 'notice']) expect(key in r).toBe(true);
  });

  it('SPEC-NTA-GET-TAX-ANSWER-009 この呼び出しで国税庁サイトから取った記事も index_status・orphaned_at・notice は null', async () => {
    const r = (await getTaxAnswer(
      { no: '6101', format: 'json' },
      {
        fetchImpl: sjisFixtureFetch('www.nta.go.jp_taxes_shiraberu_taxanswer_shohi_6101.htm'),
        dbPath,
      }
    )) as Json;
    expect(r.source).toBe('live');
    expect(r.index_status).toBeNull();
    expect(r.orphaned_at).toBeNull();
    expect(r.notice).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* nta_inspect_pdf_meta: SPEC-NTA-INSPECT-PDF-META-002・010                    */
/* -------------------------------------------------------------------------- */

const KAISEI_PDFS = [
  {
    title: '別紙1 計算明細書（PDF/100KB）',
    url: 'https://www.nta.go.jp/x/b1.pdf',
    kind: 'attachment',
  },
  { title: '新旧対照表（PDF/200KB）', url: 'https://www.nta.go.jp/x/c.pdf', kind: 'comparison' },
];

describe('SPEC-NTA-INSPECT-PDF-META-002 添付 PDF の一覧を種別の順に返し、索引の印を付ける', () => {
  it('SPEC-NTA-INSPECT-PDF-META-002 索引にある改正通達は index_status・orphaned_at・notice が null で、comparison が先', async () => {
    seedDocs([
      {
        docType: 'kaisei',
        docId: 'sample-003',
        title: '改正通達',
        body: '本文',
        pdfs: KAISEI_PDFS,
      },
    ]);
    const r = (await handleNtaInspectPdfMeta(
      { docType: 'kaisei', docId: 'sample-003' },
      { dbPath }
    )) as Json & { attachedPdfs: Array<{ kind: string; title: string }> };
    expect(r.attachedPdfs.map((p) => p.kind)).toEqual(['comparison', 'attachment']);
    expect(r.index_status).toBeNull();
    expect(r.orphaned_at).toBeNull();
    expect(r.notice).toBeNull();
    for (const key of ['index_status', 'orphaned_at', 'notice']) expect(key in r).toBe(true);
  });

  it('SPEC-NTA-INSPECT-PDF-META-002 2026-10-01T00:30:00Z に索引から外れたことを確認した文書は removed_from_index・日時と、nta_get_jimu_unei と同じ注記', async () => {
    seedDocs([
      {
        docType: 'kaisei',
        docId: 'sample-003',
        title: '改正通達',
        body: '本文',
        pdfs: KAISEI_PDFS,
        orphanedAt: ORPHANED_AT,
      },
      {
        docType: 'jimu-unei',
        docId: 'shotoku/j',
        title: '事務運営指針',
        body: '本文',
        orphanedAt: ORPHANED_AT,
      },
    ]);
    const r = (await handleNtaInspectPdfMeta(
      { docType: 'kaisei', docId: 'sample-003' },
      { dbPath }
    )) as Json;
    const jimu = (await handleNtaGetJimuUnei(
      { docId: 'shotoku/j', format: 'json' },
      { dbPath }
    )) as Json;
    expect(r.index_status).toBe('removed_from_index');
    expect(r.orphaned_at).toBe(ORPHANED_AT);
    expect(r.notice).toBeTypeOf('string');
    expect(r.notice).toBe(jimu.notice);
  });
});

describe('SPEC-NTA-INSPECT-PDF-META-010 save: true で保存する PDF が 0 件でも saved: [] を返す', () => {
  it('SPEC-NTA-INSPECT-PDF-META-010 comparison だけの文書に { kind: "qa-pdf", save: true } を渡すと attachedPdfs: []・saved: []', async () => {
    seedDocs([
      {
        docType: 'kaisei',
        docId: 'sample-003',
        title: '改正通達',
        body: '本文',
        pdfs: [{ title: '新旧対照表', url: 'https://www.nta.go.jp/x/c.pdf', kind: 'comparison' }],
      },
    ]);
    const r = (await handleNtaInspectPdfMeta(
      { docType: 'kaisei', docId: 'sample-003', kind: 'qa-pdf', save: true },
      { dbPath, filesDir: join(dir, 'files'), fetchImpl: fetchMustNotBeCalled() }
    )) as Json;
    expect(r.attachedPdfs).toEqual([]);
    expect(r.saved).toEqual([]);
  });

  it('SPEC-NTA-INSPECT-PDF-META-010 PDF の無い文書に save: true を渡すと saved: []', async () => {
    seedDocs([{ docType: 'jimu-unei', docId: 'shotoku/j', title: '事務運営指針', body: '本文' }]);
    const r = (await handleNtaInspectPdfMeta(
      { docType: 'jimu-unei', docId: 'shotoku/j', save: true },
      { dbPath, filesDir: join(dir, 'files'), fetchImpl: fetchMustNotBeCalled() }
    )) as Json;
    expect(r.attachedPdfs).toEqual([]);
    expect(r.saved).toEqual([]);
  });

  it('SPEC-NTA-INSPECT-PDF-META-010 save を渡さないときは saved を付けない', async () => {
    seedDocs([{ docType: 'jimu-unei', docId: 'shotoku/j', title: '事務運営指針', body: '本文' }]);
    const r = (await handleNtaInspectPdfMeta(
      { docType: 'jimu-unei', docId: 'shotoku/j' },
      { dbPath }
    )) as Json;
    expect('saved' in r).toBe(false);
  });
});
