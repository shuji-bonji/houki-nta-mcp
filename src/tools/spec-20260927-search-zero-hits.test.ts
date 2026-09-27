/**
 * 差分 specs/changes/20260927-search-zero-hits/ の受入テスト。
 *
 * - SPEC-NTA-SEARCH-RULES-017（freshness の形・段階・warning・判定する範囲）
 * - SPEC-NTA-SEARCH-BUNSHOKAITOU-005 / 006
 * - SPEC-NTA-SEARCH-JIMU-UNEI-005 / 006
 * - SPEC-NTA-SEARCH-TAX-ANSWER-003
 *
 * 期待値は差分の spec.md・proposal.md と specs/current の本文から決めた。
 * DB は一時ディレクトリに作り、initSchema してから文書を入れる。国税庁サイトには取りに行かない。
 * 017 の outdated は数年前の fetched_at を入れて確かめ、呼んだ日に左右されないようにする。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initSchema } from '../db/schema.js';
import {
  handleNtaSearchBunshokaitou,
  handleNtaSearchJimuUnei,
  handleNtaSearchKaiseiTsutatsu,
  handleNtaSearchQa,
  handleNtaSearchTaxAnswer,
  searchTsutatsu,
} from './handlers.js';

interface Freshness {
  oldest_fetched_at: string;
  newest_fetched_at: string;
  days_since_oldest: number;
  staleness: string;
  warning?: string;
}

interface SearchResponse {
  results?: Array<{ docId: string; taxonomy?: string }>;
  hits?: unknown[];
  keyword?: string;
  hint?: string;
  available_taxonomies?: string[];
  freshness?: Freshness;
  legal_status?: { binds_tax_office?: boolean };
  code?: string;
}

interface DocSeed {
  docType: string;
  docId: string;
  taxonomy: string;
  title: string;
  body: string;
  fetchedAt: string;
  pdf?: boolean;
}

interface ClauseSeed {
  formalName: string;
  abbr: string;
  chapter: number;
  section: number;
  clauseNumber: string;
  title: string;
  body: string;
  fetchedAt: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const PDF_JSON = JSON.stringify([{ title: '別紙', url: 'https://x/a.pdf', sizeKb: 10 }]);

const OLD_1 = '2020-01-01T00:00:00Z';
const OLD_2 = '2020-06-01T00:00:00Z';
const OLD_3 = '2021-01-01T00:00:00Z';
const OLD_4 = '2022-01-01T00:00:00Z';

function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

function seedDocs(dbPath: string, docs: DocSeed[], clauses: ClauseSeed[] = []): void {
  const db = new Database(dbPath);
  initSchema(db);
  const insertDoc = db.prepare(
    `INSERT INTO document(doc_type, doc_id, taxonomy, title, source_url, fetched_at, full_text, attached_pdfs_json, content_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const d of docs) {
    insertDoc.run(
      d.docType,
      d.docId,
      d.taxonomy,
      d.title,
      `https://x/${d.docType}/${d.docId}.htm`,
      d.fetchedAt,
      d.body,
      d.pdf ? PDF_JSON : '[]',
      null
    );
  }
  const tsutatsuIds = new Map<string, number>();
  for (const c of clauses) {
    let id = tsutatsuIds.get(c.formalName);
    if (id === undefined) {
      id = (
        db
          .prepare(
            `INSERT INTO tsutatsu(formal_name, abbr, source_root_url) VALUES (?, ?, ?) RETURNING id`
          )
          .get(c.formalName, c.abbr, `https://x/${c.abbr}/`) as { id: number }
      ).id;
      tsutatsuIds.set(c.formalName, id);
    }
    const url = `https://x/${c.abbr}/${c.chapter}/${c.section}.htm`;
    db.prepare(
      `INSERT INTO section(tsutatsu_id, chapter_number, section_number, title, url, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, c.chapter, c.section, c.title, url, c.fetchedAt);
    db.prepare(
      `INSERT INTO clause(tsutatsu_id, clause_number, source_url, chapter_number, section_number, title, full_text, paragraphs_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      c.clauseNumber,
      url,
      c.chapter,
      c.section,
      c.title,
      c.body,
      JSON.stringify([{ indent: 1, text: c.body }])
    );
  }
  db.close();
}

/** SPEC-NTA-SEARCH-RULES-017 の warning の形。<日数> は呼んだ日で変わるので数字であることだけ確かめる */
function warningPattern(flag: string): RegExp {
  return new RegExp(
    `^一部ドキュメントが (\\d+) 日前のデータです。最新化するには \`${flag}\` を実行してください$`
  );
}

function expectOutdated(freshness: Freshness | undefined, flag: string, oldest: string): void {
  expect(freshness).toBeDefined();
  const f = freshness as Freshness;
  expect(f.oldest_fetched_at).toBe(oldest);
  expect(f.staleness).toBe('outdated');
  const expectedDays = (Date.now() - Date.parse(oldest)) / DAY_MS;
  expect(Math.abs(f.days_since_oldest - expectedDays)).toBeLessThanOrEqual(1);
  expect(f.warning).toMatch(warningPattern(flag));
  const m = (f.warning ?? '').match(warningPattern(flag));
  expect(Number(m?.[1])).toBe(f.days_since_oldest);
}

let dir: string;
const paths = {
  /** 6 ツールそれぞれに、数年前に取得した文書を 2 件ずつ入れた DB */
  old: '',
  /** 判定する範囲を確かめる DB（古い文書と新しい文書を税目で分ける） */
  range: '',
  /** 段階ごとの DB（質疑応答事例 1 件） */
  fresh: '',
  stale: '',
  outdated: '',
  /** PDF 無しの文書だけの DB（タックスアンサー・事務運営指針・文書回答事例を 2 件ずつ） */
  noPdf: '',
  /** PDF 付きの文書だけの DB（タックスアンサー 2 件） */
  allPdf: '',
  /** PDF 付きと PDF 無しが混じったタックスアンサーの DB */
  mixed: '',
  /** 事務運営指針: shotoku 2 件（PDF 無し）と hojin 1 件（PDF 付き） */
  jimu: '',
  /** 文書回答事例: sozoku・souzoku（PDF 無し）と zoyo（PDF 付き） */
  bunsho: '',
  /** 017 の例: 質疑応答事例 2 件（2026-01-01 と 2026-09-25） */
  example: '',
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'houki-nta-spec-20260927-zero-hits-'));
  for (const key of Object.keys(paths) as Array<keyof typeof paths>) {
    paths[key] = join(dir, `${key}.db`);
  }

  const kw = '減価償却資産の耐用年数について';
  const oldDocs: DocSeed[] = [];
  for (const [docType, taxonomy] of [
    ['qa-jirei', 'hojin'],
    ['tax-answer', 'hojin'],
    ['kaisei', 'hojin'],
    ['jimu-unei', 'hojin'],
    ['bunshokaitou', 'hojin'],
  ] as const) {
    oldDocs.push(
      {
        docType,
        docId: `${docType}-old-1`,
        taxonomy,
        title: '減価償却資産の取扱い（一）',
        body: kw,
        fetchedAt: OLD_1,
      },
      {
        docType,
        docId: `${docType}-old-2`,
        taxonomy,
        title: '減価償却資産の取扱い（二）',
        body: kw,
        fetchedAt: OLD_2,
      }
    );
  }
  seedDocs(paths.old, oldDocs, [
    {
      formalName: '法人税基本通達',
      abbr: '法基通',
      chapter: 7,
      section: 1,
      clauseNumber: '7-1-1',
      title: '減価償却資産の範囲',
      body: kw,
      fetchedAt: OLD_1,
    },
    {
      formalName: '法人税基本通達',
      abbr: '法基通',
      chapter: 7,
      section: 2,
      clauseNumber: '7-2-1',
      title: '減価償却資産の償却',
      body: kw,
      fetchedAt: OLD_2,
    },
  ]);

  const now = daysAgo(0);
  seedDocs(
    paths.range,
    [
      // 質疑応答事例: shohi は古くキーワードに合わない、shotoku は新しくキーワードに合う
      {
        docType: 'qa-jirei',
        docId: 'shohi/01',
        taxonomy: 'shohi',
        title: '軽減税率',
        body: '飲食料品の軽減税率',
        fetchedAt: OLD_1,
      },
      {
        docType: 'qa-jirei',
        docId: 'shotoku/01',
        taxonomy: 'shotoku',
        title: '減価償却資産',
        body: kw,
        fetchedAt: now,
      },
      // タックスアンサー: 古い記事はキーワードに合わない
      {
        docType: 'tax-answer',
        docId: '6101',
        taxonomy: 'shohi',
        title: '消費税のしくみ',
        body: '消費に広く公平に負担を求める税',
        fetchedAt: OLD_1,
      },
      {
        docType: 'tax-answer',
        docId: '2100',
        taxonomy: 'shotoku',
        title: '減価償却資産',
        body: kw,
        fetchedAt: now,
      },
      // 改正通達
      {
        docType: 'kaisei',
        docId: 'k-old',
        taxonomy: 'shohi',
        title: '消費税の改正',
        body: '適格請求書の記載事項',
        fetchedAt: OLD_1,
      },
      {
        docType: 'kaisei',
        docId: 'k-new',
        taxonomy: 'hojin',
        title: '減価償却資産の改正',
        body: kw,
        fetchedAt: now,
      },
      // 事務運営指針
      {
        docType: 'jimu-unei',
        docId: 'j-old',
        taxonomy: 'shohi',
        title: '消費税の指針',
        body: '調査手続の実施',
        fetchedAt: OLD_1,
      },
      {
        docType: 'jimu-unei',
        docId: 'j-new',
        taxonomy: 'shotoku',
        title: '減価償却資産の指針',
        body: kw,
        fetchedAt: now,
      },
      // 文書回答事例: sozoku と souzoku は別表記の組
      {
        docType: 'bunshokaitou',
        docId: 'tokyo/souzoku/01',
        taxonomy: 'souzoku',
        title: '東京局の相続税の回答',
        body: '小規模宅地等の特例',
        fetchedAt: OLD_1,
      },
      {
        docType: 'bunshokaitou',
        docId: 'sozoku/01',
        taxonomy: 'sozoku',
        title: '本庁の相続税の回答',
        body: kw,
        fetchedAt: now,
      },
      {
        docType: 'bunshokaitou',
        docId: 'zoyo/01',
        taxonomy: 'zoyo',
        title: '贈与税の回答',
        body: kw,
        fetchedAt: now,
      },
    ],
    [
      {
        formalName: '消費税法基本通達',
        abbr: '消基通',
        chapter: 1,
        section: 1,
        clauseNumber: '1-1-1',
        title: '個人事業者',
        body: '個人事業者と給与所得者の区分',
        fetchedAt: OLD_1,
      },
      {
        formalName: '法人税基本通達',
        abbr: '法基通',
        chapter: 7,
        section: 1,
        clauseNumber: '7-1-1',
        title: '減価償却資産の範囲',
        body: kw,
        fetchedAt: now,
      },
    ]
  );

  const qaOne = (fetchedAt: string): DocSeed[] => [
    {
      docType: 'qa-jirei',
      docId: 'shotoku/01',
      taxonomy: 'shotoku',
      title: '減価償却資産',
      body: kw,
      fetchedAt,
    },
  ];
  seedDocs(paths.fresh, qaOne(daysAgo(3)));
  seedDocs(paths.stale, qaOne(daysAgo(15)));
  seedDocs(paths.outdated, qaOne(daysAgo(45)));

  const gensen = '給与等に係る源泉徴収の取扱い';
  seedDocs(paths.noPdf, [
    {
      docType: 'tax-answer',
      docId: '2502',
      taxonomy: 'gensen',
      title: '源泉徴収票',
      body: gensen,
      fetchedAt: OLD_1,
    },
    {
      docType: 'tax-answer',
      docId: '2503',
      taxonomy: 'gensen',
      title: '源泉徴収の対象',
      body: gensen,
      fetchedAt: OLD_2,
    },
    {
      docType: 'jimu-unei',
      docId: 'shotoku/j-1',
      taxonomy: 'shotoku',
      title: '源泉所得税の指針',
      body: gensen,
      fetchedAt: OLD_1,
    },
    {
      docType: 'jimu-unei',
      docId: 'shotoku/j-2',
      taxonomy: 'shotoku',
      title: '源泉所得税の調査',
      body: gensen,
      fetchedAt: OLD_2,
    },
    {
      docType: 'bunshokaitou',
      docId: 'gensen/b-1',
      taxonomy: 'gensen',
      title: '源泉徴収の要否',
      body: gensen,
      fetchedAt: OLD_1,
    },
    {
      docType: 'bunshokaitou',
      docId: 'gensen/b-2',
      taxonomy: 'gensen',
      title: '源泉徴収の時期',
      body: gensen,
      fetchedAt: OLD_2,
    },
  ]);

  seedDocs(paths.allPdf, [
    {
      docType: 'tax-answer',
      docId: '2502',
      taxonomy: 'gensen',
      title: '源泉徴収票',
      body: gensen,
      fetchedAt: OLD_1,
      pdf: true,
    },
    {
      docType: 'tax-answer',
      docId: '2503',
      taxonomy: 'gensen',
      title: '源泉徴収の対象',
      body: gensen,
      fetchedAt: OLD_2,
      pdf: true,
    },
  ]);

  seedDocs(paths.mixed, [
    {
      docType: 'tax-answer',
      docId: '2502',
      taxonomy: 'gensen',
      title: '源泉徴収票',
      body: gensen,
      fetchedAt: OLD_1,
      pdf: true,
    },
    {
      docType: 'tax-answer',
      docId: '2503',
      taxonomy: 'gensen',
      title: '源泉徴収の対象',
      body: gensen,
      fetchedAt: OLD_2,
    },
  ]);

  seedDocs(paths.jimu, [
    {
      docType: 'jimu-unei',
      docId: 'shotoku/j-1',
      taxonomy: 'shotoku',
      title: '源泉所得税の指針',
      body: gensen,
      fetchedAt: OLD_1,
    },
    {
      docType: 'jimu-unei',
      docId: 'shotoku/j-2',
      taxonomy: 'shotoku',
      title: '源泉所得税の調査',
      body: gensen,
      fetchedAt: OLD_3,
    },
    {
      docType: 'jimu-unei',
      docId: 'hojin/j-3',
      taxonomy: 'hojin',
      title: '法人の源泉徴収の指針',
      body: gensen,
      fetchedAt: OLD_4,
      pdf: true,
    },
  ]);

  const takuchi = '小規模宅地等の特例の適用について';
  seedDocs(paths.bunsho, [
    {
      docType: 'bunshokaitou',
      docId: 'sozoku/100101',
      taxonomy: 'sozoku',
      title: '本庁の相続税の回答',
      body: takuchi,
      fetchedAt: OLD_1,
    },
    {
      docType: 'bunshokaitou',
      docId: 'tokyo/souzoku/181207',
      taxonomy: 'souzoku',
      title: '東京局の相続税の回答',
      body: takuchi,
      fetchedAt: OLD_3,
    },
    {
      docType: 'bunshokaitou',
      docId: 'zoyo/070226',
      taxonomy: 'zoyo',
      title: '贈与税の回答',
      body: takuchi,
      fetchedAt: OLD_4,
      pdf: true,
    },
  ]);

  seedDocs(paths.example, [
    {
      docType: 'qa-jirei',
      docId: 'shotoku/01',
      taxonomy: 'shotoku',
      title: '減価償却資産',
      body: kw,
      fetchedAt: '2026-01-01T00:00:00Z',
    },
    {
      docType: 'qa-jirei',
      docId: 'shotoku/02',
      taxonomy: 'shotoku',
      title: '減価償却資産の耐用年数',
      body: kw,
      fetchedAt: '2026-09-25T00:00:00Z',
    },
  ]);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('SPEC-NTA-SEARCH-RULES-017 freshness は DB の取得時点の範囲と段階を返し、古いときだけ warning を付ける', () => {
  const kw = '減価償却資産';
  const cases = [
    [
      'nta_search_tsutatsu',
      '--bulk-download-all',
      () => searchTsutatsu({ keyword: kw }, { dbPath: paths.old }),
    ],
    [
      'nta_search_qa',
      '--bulk-download-qa',
      () => handleNtaSearchQa({ keyword: kw }, { dbPath: paths.old }),
    ],
    [
      'nta_search_tax_answer',
      '--bulk-download-tax-answer',
      () => handleNtaSearchTaxAnswer({ keyword: kw }, { dbPath: paths.old }),
    ],
    [
      'nta_search_kaisei_tsutatsu',
      '--bulk-download-kaisei',
      () => handleNtaSearchKaiseiTsutatsu({ keyword: kw }, { dbPath: paths.old }),
    ],
    [
      'nta_search_jimu_unei',
      '--bulk-download-jimu-unei',
      () => handleNtaSearchJimuUnei({ keyword: kw }, { dbPath: paths.old }),
    ],
    [
      'nta_search_bunshokaitou',
      '--bulk-download-bunshokaitou',
      () => handleNtaSearchBunshokaitou({ keyword: kw }, { dbPath: paths.old }),
    ],
  ] as const;

  for (const [tool, flag, call] of cases) {
    it(`SPEC-NTA-SEARCH-RULES-017 ${tool}: 数年前の取得日時の DB では oldest / newest・days_since_oldest・staleness=outdated と ${flag} の warning を返す`, async () => {
      const r = (await call()) as SearchResponse;
      expect(r.code).toBeUndefined();
      expectOutdated(r.freshness, flag, OLD_1);
      expect(r.freshness?.newest_fetched_at).toBe(OLD_2);
    });
  }

  it('SPEC-NTA-SEARCH-RULES-017 nta_search_qa: 例の DB（2026-01-01 と 2026-09-25）では oldest=2026-01-01T00:00:00Z・outdated・--bulk-download-qa の warning', async () => {
    const r = (await handleNtaSearchQa(
      { keyword: kw },
      { dbPath: paths.example }
    )) as SearchResponse;
    expectOutdated(r.freshness, '--bulk-download-qa', '2026-01-01T00:00:00Z');
    expect(r.freshness?.newest_fetched_at).toBe('2026-09-25T00:00:00Z');
  });

  it('SPEC-NTA-SEARCH-RULES-017 nta_search_qa: 7 日未満（3 日前）は fresh で warning を付けない', async () => {
    const r = (await handleNtaSearchQa({ keyword: kw }, { dbPath: paths.fresh })) as SearchResponse;
    expect(r.freshness?.staleness).toBe('fresh');
    expect(r.freshness?.days_since_oldest).toBeLessThan(7);
    expect(r.freshness?.warning).toBeUndefined();
  });

  it('SPEC-NTA-SEARCH-RULES-017 nta_search_qa: 7 日以上 30 日未満（15 日前）は stale で warning を付けない', async () => {
    const r = (await handleNtaSearchQa({ keyword: kw }, { dbPath: paths.stale })) as SearchResponse;
    expect(r.freshness?.staleness).toBe('stale');
    expect(r.freshness?.days_since_oldest).toBeGreaterThanOrEqual(7);
    expect(r.freshness?.days_since_oldest).toBeLessThan(30);
    expect(r.freshness?.warning).toBeUndefined();
  });

  it('SPEC-NTA-SEARCH-RULES-017 nta_search_qa: 30 日以上（45 日前）は outdated で warning を付ける', async () => {
    const r = (await handleNtaSearchQa(
      { keyword: kw },
      {
        dbPath: paths.outdated,
      }
    )) as SearchResponse;
    expect(r.freshness?.staleness).toBe('outdated');
    expect(r.freshness?.days_since_oldest).toBeGreaterThanOrEqual(30);
    expect(r.freshness?.warning).toMatch(warningPattern('--bulk-download-qa'));
  });

  it('SPEC-NTA-SEARCH-RULES-017 nta_search_tsutatsu: 範囲は DB にある通達の節すべて（結果に出ない通達の古い節も含む）', async () => {
    const r = (await searchTsutatsu({ keyword: kw }, { dbPath: paths.range })) as SearchResponse;
    expect(r.hits?.length).toBeGreaterThan(0);
    expectOutdated(r.freshness, '--bulk-download-all', OLD_1);
  });

  it('SPEC-NTA-SEARCH-RULES-017 nta_search_qa: topic を省くと質疑応答事例全体、topic を渡すとその税目だけで判定する', async () => {
    const all = (await handleNtaSearchQa(
      { keyword: kw },
      { dbPath: paths.range }
    )) as SearchResponse;
    expectOutdated(all.freshness, '--bulk-download-qa', OLD_1);
    const topic = (await handleNtaSearchQa(
      { keyword: kw, topic: 'shotoku' },
      { dbPath: paths.range }
    )) as SearchResponse;
    expect(topic.freshness?.staleness).toBe('fresh');
    expect(topic.freshness?.oldest_fetched_at).not.toBe(OLD_1);
    expect(topic.freshness?.warning).toBeUndefined();
  });

  it('SPEC-NTA-SEARCH-RULES-017 nta_search_tax_answer: 範囲はタックスアンサー全体（キーワードに合わない古い記事も含む）', async () => {
    const r = (await handleNtaSearchTaxAnswer(
      { keyword: kw },
      { dbPath: paths.range }
    )) as SearchResponse;
    expect(r.results?.map((x) => x.docId)).toEqual(['2100']);
    expectOutdated(r.freshness, '--bulk-download-tax-answer', OLD_1);
  });

  it('SPEC-NTA-SEARCH-RULES-017 nta_search_kaisei_tsutatsu: taxonomy を省くと改正通達全体、渡すとその税目だけで判定する', async () => {
    const all = (await handleNtaSearchKaiseiTsutatsu(
      { keyword: kw },
      { dbPath: paths.range }
    )) as SearchResponse;
    expectOutdated(all.freshness, '--bulk-download-kaisei', OLD_1);
    const tax = (await handleNtaSearchKaiseiTsutatsu(
      { keyword: kw, taxonomy: 'hojin' },
      { dbPath: paths.range }
    )) as SearchResponse;
    expect(tax.freshness?.staleness).toBe('fresh');
    expect(tax.freshness?.warning).toBeUndefined();
  });

  it('SPEC-NTA-SEARCH-RULES-017 nta_search_jimu_unei: taxonomy を省くと事務運営指針全体、渡すとその税目だけで判定する', async () => {
    const all = (await handleNtaSearchJimuUnei(
      { keyword: kw },
      { dbPath: paths.range }
    )) as SearchResponse;
    expectOutdated(all.freshness, '--bulk-download-jimu-unei', OLD_1);
    const tax = (await handleNtaSearchJimuUnei(
      { keyword: kw, taxonomy: 'shotoku' },
      { dbPath: paths.range }
    )) as SearchResponse;
    expect(tax.freshness?.staleness).toBe('fresh');
    expect(tax.freshness?.warning).toBeUndefined();
  });

  it('SPEC-NTA-SEARCH-RULES-017 nta_search_bunshokaitou: taxonomy を渡すとその税目と別表記で判定する（sozoku は souzoku の古い文書を含む）', async () => {
    const alias = (await handleNtaSearchBunshokaitou(
      { keyword: kw, taxonomy: 'sozoku' },
      { dbPath: paths.range }
    )) as SearchResponse;
    expectOutdated(alias.freshness, '--bulk-download-bunshokaitou', OLD_1);
    const zoyo = (await handleNtaSearchBunshokaitou(
      { keyword: kw, taxonomy: 'zoyo' },
      { dbPath: paths.range }
    )) as SearchResponse;
    expect(zoyo.freshness?.staleness).toBe('fresh');
    expect(zoyo.freshness?.warning).toBeUndefined();
  });

  const emptyCases = [
    ['nta_search_qa', () => handleNtaSearchQa({ keyword: kw }, { dbPath: ':memory:' })],
    [
      'nta_search_tax_answer',
      () => handleNtaSearchTaxAnswer({ keyword: kw }, { dbPath: ':memory:' }),
    ],
    [
      'nta_search_kaisei_tsutatsu',
      () => handleNtaSearchKaiseiTsutatsu({ keyword: kw }, { dbPath: ':memory:' }),
    ],
    [
      'nta_search_jimu_unei',
      () => handleNtaSearchJimuUnei({ keyword: kw }, { dbPath: ':memory:' }),
    ],
    [
      'nta_search_bunshokaitou',
      () => handleNtaSearchBunshokaitou({ keyword: kw }, { dbPath: ':memory:' }),
    ],
  ] as const;

  for (const [tool, call] of emptyCases) {
    it(`SPEC-NTA-SEARCH-RULES-017 ${tool}: 範囲に文書が 1 件も無い（空の DB）ときは freshness を付けない`, async () => {
      const r = (await call()) as SearchResponse;
      expect(r.freshness).toBeUndefined();
    });
  }
});

describe('SPEC-NTA-SEARCH-TAX-ANSWER-003 hasPdf で絞り、合う文書が無いときは hasPdf を外すよう案内する', () => {
  const kw = '源泉徴収';

  it('SPEC-NTA-SEARCH-TAX-ANSWER-003 nta_search_tax_answer: hasPdf=true は PDF 付きだけ、false は PDF 無しだけ、省くと両方を返す', async () => {
    const withPdf = (await handleNtaSearchTaxAnswer(
      { keyword: kw, hasPdf: true },
      { dbPath: paths.mixed }
    )) as SearchResponse;
    expect(withPdf.results?.map((x) => x.docId)).toEqual(['2502']);
    const withoutPdf = (await handleNtaSearchTaxAnswer(
      { keyword: kw, hasPdf: false },
      { dbPath: paths.mixed }
    )) as SearchResponse;
    expect(withoutPdf.results?.map((x) => x.docId)).toEqual(['2503']);
    const both = (await handleNtaSearchTaxAnswer(
      { keyword: kw },
      { dbPath: paths.mixed }
    )) as SearchResponse;
    expect(both.results?.map((x) => x.docId).sort()).toEqual(['2502', '2503']);
  });

  it('SPEC-NTA-SEARCH-TAX-ANSWER-003 nta_search_tax_answer: 2 件とも PDF 無しで hasPdf=true なら results: []・keyword・件数付きの hint・freshness・legal_status', async () => {
    const r = (await handleNtaSearchTaxAnswer(
      { keyword: kw, hasPdf: true },
      { dbPath: paths.noPdf }
    )) as SearchResponse;
    expect(r.code).toBeUndefined();
    expect(r.results).toEqual([]);
    expect(r.keyword).toBe(kw);
    expect(r.hint).toBe(
      'DB のタックスアンサー 2 件に、PDF 付きの文書はありません。hasPdf を外して検索してください'
    );
    expect(r.freshness?.oldest_fetched_at).toBe(OLD_1);
    expect(r.freshness?.newest_fetched_at).toBe(OLD_2);
    expect(r.legal_status).toBeDefined();
  });

  it('SPEC-NTA-SEARCH-TAX-ANSWER-003 nta_search_tax_answer: 2 件とも PDF 付きで hasPdf=false なら「PDF 無しの文書はありません」、freshness はタックスアンサー全体', async () => {
    const r = (await handleNtaSearchTaxAnswer(
      { keyword: kw, hasPdf: false },
      { dbPath: paths.allPdf }
    )) as SearchResponse;
    expect(r.code).toBeUndefined();
    expect(r.results).toEqual([]);
    expect(r.hint).toBe(
      'DB のタックスアンサー 2 件に、PDF 無しの文書はありません。hasPdf を外して検索してください'
    );
    expect(r.freshness?.oldest_fetched_at).toBe(OLD_1);
    expect(r.freshness?.newest_fetched_at).toBe(OLD_2);
  });

  it('SPEC-NTA-SEARCH-TAX-ANSWER-003 nta_search_tax_answer: 0 件の理由は 001 → 003 → 002 の順（空の DB は DOC_NOT_FOUND、キーワードにも合わないときは hasPdf の案内）', async () => {
    const empty = (await handleNtaSearchTaxAnswer(
      { keyword: kw, hasPdf: true },
      { dbPath: ':memory:' }
    )) as SearchResponse;
    expect(empty.code).toBe('DOC_NOT_FOUND');
    const both = (await handleNtaSearchTaxAnswer(
      { keyword: '量子暗号通信', hasPdf: true },
      { dbPath: paths.noPdf }
    )) as SearchResponse;
    expect(both.code).toBeUndefined();
    expect(both.results).toEqual([]);
    expect(both.hint).toContain('PDF 付きの文書はありません');
    expect(both.hint).not.toContain('該当なし');
  });
});

describe('SPEC-NTA-SEARCH-JIMU-UNEI-005 taxonomy の範囲に文書が無いときは税目の一覧を返す', () => {
  it('SPEC-NTA-SEARCH-JIMU-UNEI-005 nta_search_jimu_unei: shotoku 2 件だけの DB で taxonomy="hojin" は hint と available_taxonomies=["shotoku"]', async () => {
    const r = (await handleNtaSearchJimuUnei(
      { keyword: '源泉徴収', taxonomy: 'hojin' },
      { dbPath: paths.noPdf }
    )) as SearchResponse;
    expect(r.code).toBeUndefined();
    expect(r.results).toEqual([]);
    expect(r.keyword).toBe('源泉徴収');
    expect(r.hint).toBe(
      'DB の事務運営指針 2 件のうち、taxonomy="hojin" の文書はありません。taxonomy を外すか、available_taxonomies の値を指定してください。'
    );
    expect(r.hint).not.toContain('houki-nta-mcp');
    expect(r.available_taxonomies).toEqual(['shotoku']);
    expect(r.legal_status?.binds_tax_office).toBe(true);
  });

  it('SPEC-NTA-SEARCH-JIMU-UNEI-005 nta_search_jimu_unei: available_taxonomies は昇順、freshness は事務運営指針全体の取得時点', async () => {
    const r = (await handleNtaSearchJimuUnei(
      { keyword: '源泉徴収', taxonomy: 'sozoku' },
      { dbPath: paths.jimu }
    )) as SearchResponse;
    expect(r.results).toEqual([]);
    expect(r.available_taxonomies).toEqual(['hojin', 'shotoku']);
    expect(r.hint).toContain('DB の事務運営指針 3 件のうち、taxonomy="sozoku" の文書はありません');
    expect(r.freshness?.oldest_fetched_at).toBe(OLD_1);
    expect(r.freshness?.newest_fetched_at).toBe(OLD_4);
  });
});

describe('SPEC-NTA-SEARCH-JIMU-UNEI-006 hasPdf の条件に合う文書が無いときは hasPdf を外すよう案内する', () => {
  it('SPEC-NTA-SEARCH-JIMU-UNEI-006 nta_search_jimu_unei: taxonomy="shotoku"・hasPdf=true で PDF 付きが無いときは条件付きの hint と、taxonomy の範囲の freshness', async () => {
    const r = (await handleNtaSearchJimuUnei(
      { keyword: '源泉徴収', taxonomy: 'shotoku', hasPdf: true },
      { dbPath: paths.jimu }
    )) as SearchResponse;
    expect(r.code).toBeUndefined();
    expect(r.results).toEqual([]);
    expect(r.keyword).toBe('源泉徴収');
    expect(r.hint).toBe(
      'DB の事務運営指針（taxonomy="shotoku"）2 件に、PDF 付きの文書はありません。hasPdf を外して検索してください'
    );
    // hasPdf では絞らず、taxonomy だけで絞った範囲（hojin の文書は入らない）
    expect(r.freshness?.oldest_fetched_at).toBe(OLD_1);
    expect(r.freshness?.newest_fetched_at).toBe(OLD_3);
    expect(r.legal_status).toBeDefined();
  });

  it('SPEC-NTA-SEARCH-JIMU-UNEI-006 nta_search_jimu_unei: hasPdf=false で PDF 無しが無いときは「PDF 無しの文書はありません」', async () => {
    const r = (await handleNtaSearchJimuUnei(
      { keyword: '源泉徴収', taxonomy: 'hojin', hasPdf: false },
      { dbPath: paths.jimu }
    )) as SearchResponse;
    expect(r.results).toEqual([]);
    expect(r.hint).toBe(
      'DB の事務運営指針（taxonomy="hojin"）1 件に、PDF 無しの文書はありません。hasPdf を外して検索してください'
    );
  });

  it('SPEC-NTA-SEARCH-JIMU-UNEI-006 nta_search_jimu_unei: taxonomy を省いたときは（taxonomy="…"）を書かず、件数は事務運営指針全体', async () => {
    const r = (await handleNtaSearchJimuUnei(
      { keyword: '源泉徴収', hasPdf: true },
      { dbPath: paths.noPdf }
    )) as SearchResponse;
    expect(r.results).toEqual([]);
    expect(r.hint).toMatch(
      /^DB の事務運営指針 ?2 件に、PDF 付きの文書はありません。hasPdf を外して検索してください$/
    );
    expect(r.hint).not.toContain('taxonomy=');
    expect(r.freshness?.oldest_fetched_at).toBe(OLD_1);
    expect(r.freshness?.newest_fetched_at).toBe(OLD_2);
  });

  it('SPEC-NTA-SEARCH-JIMU-UNEI-006 nta_search_jimu_unei: 0 件の理由は 001 → 005 → 006 → 002 の順', async () => {
    const empty = (await handleNtaSearchJimuUnei(
      { keyword: '源泉徴収', taxonomy: 'hojin', hasPdf: true },
      { dbPath: ':memory:' }
    )) as SearchResponse;
    expect(empty.code).toBe('DOC_NOT_FOUND');

    const taxonomyFirst = (await handleNtaSearchJimuUnei(
      { keyword: '源泉徴収', taxonomy: 'sozoku', hasPdf: true },
      { dbPath: paths.jimu }
    )) as SearchResponse;
    expect(taxonomyFirst.available_taxonomies).toEqual(['hojin', 'shotoku']);
    expect(taxonomyFirst.hint).not.toContain('PDF 付きの文書はありません');

    const pdfBeforeKeyword = (await handleNtaSearchJimuUnei(
      { keyword: '量子暗号通信', taxonomy: 'shotoku', hasPdf: true },
      { dbPath: paths.jimu }
    )) as SearchResponse;
    expect(pdfBeforeKeyword.hint).toContain('PDF 付きの文書はありません');
    expect(pdfBeforeKeyword.hint).not.toContain('該当なし');
    expect(pdfBeforeKeyword.available_taxonomies).toBeUndefined();
  });
});

describe('SPEC-NTA-SEARCH-BUNSHOKAITOU-005 hasPdf の条件に合う文書が無いときは hasPdf を外すよう案内する', () => {
  const kw = '小規模宅地等';

  it('SPEC-NTA-SEARCH-BUNSHOKAITOU-005 nta_search_bunshokaitou: taxonomy="sozoku"・hasPdf=true は別表記を含めた件数で hasPdf を外すよう案内する', async () => {
    const r = (await handleNtaSearchBunshokaitou(
      { keyword: kw, taxonomy: 'sozoku', hasPdf: true },
      { dbPath: paths.bunsho }
    )) as SearchResponse;
    expect(r.code).toBeUndefined();
    expect(r.results).toEqual([]);
    expect(r.keyword).toBe(kw);
    expect(r.hint).toBe(
      'DB の文書回答事例（taxonomy="sozoku"）2 件に、PDF 付きの文書はありません。hasPdf を外して検索してください'
    );
    expect(r.legal_status).toBeDefined();
  });

  it('SPEC-NTA-SEARCH-BUNSHOKAITOU-005 nta_search_bunshokaitou: 国税局の別表記（souzoku）で指定したときは指定した値を hint に書く', async () => {
    const r = (await handleNtaSearchBunshokaitou(
      { keyword: kw, taxonomy: 'souzoku', hasPdf: true },
      { dbPath: paths.bunsho }
    )) as SearchResponse;
    expect(r.hint).toBe(
      'DB の文書回答事例（taxonomy="souzoku"）2 件に、PDF 付きの文書はありません。hasPdf を外して検索してください'
    );
  });

  it('SPEC-NTA-SEARCH-BUNSHOKAITOU-005 nta_search_bunshokaitou: hasPdf=false で PDF 無しが無いときは「PDF 無しの文書はありません」', async () => {
    const r = (await handleNtaSearchBunshokaitou(
      { keyword: kw, taxonomy: 'zoyo', hasPdf: false },
      { dbPath: paths.bunsho }
    )) as SearchResponse;
    expect(r.results).toEqual([]);
    expect(r.hint).toBe(
      'DB の文書回答事例（taxonomy="zoyo"）1 件に、PDF 無しの文書はありません。hasPdf を外して検索してください'
    );
  });

  it('SPEC-NTA-SEARCH-BUNSHOKAITOU-005 nta_search_bunshokaitou: taxonomy を省いたときは（taxonomy="…"）を書かず、件数は文書回答事例全体', async () => {
    const r = (await handleNtaSearchBunshokaitou(
      { keyword: '源泉徴収', hasPdf: true },
      { dbPath: paths.noPdf }
    )) as SearchResponse;
    expect(r.results).toEqual([]);
    expect(r.hint).toMatch(
      /^DB の文書回答事例 ?2 件に、PDF 付きの文書はありません。hasPdf を外して検索してください$/
    );
    expect(r.hint).not.toContain('taxonomy=');
  });

  it('SPEC-NTA-SEARCH-BUNSHOKAITOU-005 SPEC-NTA-SEARCH-BUNSHOKAITOU-002 nta_search_bunshokaitou: 税目の範囲に文書が無いときは hasPdf の案内ではなく 002 の応答を返す', async () => {
    const r = (await handleNtaSearchBunshokaitou(
      { keyword: kw, taxonomy: 'hojin', hasPdf: true },
      { dbPath: paths.bunsho }
    )) as SearchResponse;
    expect(r.results).toEqual([]);
    expect(r.available_taxonomies).toEqual(['souzoku', 'sozoku', 'zoyo']);
    expect(r.hint).not.toContain('PDF 付きの文書はありません');
  });
});

describe('SPEC-NTA-SEARCH-BUNSHOKAITOU-006 0 件のときの freshness は、0 件の理由ごとに範囲を変える', () => {
  it('SPEC-NTA-SEARCH-BUNSHOKAITOU-006 SPEC-NTA-SEARCH-BUNSHOKAITOU-002 nta_search_bunshokaitou: 税目の範囲に文書が無いときは文書回答事例全体で判定する', async () => {
    const r = (await handleNtaSearchBunshokaitou(
      { keyword: '小規模宅地等', taxonomy: 'hojin' },
      { dbPath: paths.bunsho }
    )) as SearchResponse;
    expect(r.available_taxonomies).toBeDefined();
    expect(r.freshness?.oldest_fetched_at).toBe(OLD_1);
    expect(r.freshness?.newest_fetched_at).toBe(OLD_4);
  });

  it('SPEC-NTA-SEARCH-BUNSHOKAITOU-006 SPEC-NTA-SEARCH-BUNSHOKAITOU-005 nta_search_bunshokaitou: hasPdf の条件に合わないときは taxonomy の範囲（別表記を含む）で判定し、hasPdf では絞らない', async () => {
    const r = (await handleNtaSearchBunshokaitou(
      { keyword: '小規模宅地等', taxonomy: 'sozoku', hasPdf: true },
      { dbPath: paths.bunsho }
    )) as SearchResponse;
    expect(r.hint).toContain('PDF 付きの文書はありません');
    expect(r.freshness?.oldest_fetched_at).toBe(OLD_1);
    expect(r.freshness?.newest_fetched_at).toBe(OLD_3);
  });

  it('SPEC-NTA-SEARCH-BUNSHOKAITOU-006 SPEC-NTA-SEARCH-BUNSHOKAITOU-004 nta_search_bunshokaitou: キーワードに合わないときは taxonomy の範囲（別表記を含む）で判定する', async () => {
    const r = (await handleNtaSearchBunshokaitou(
      { keyword: '量子暗号通信', taxonomy: 'sozoku' },
      { dbPath: paths.bunsho }
    )) as SearchResponse;
    expect(r.hint).toContain('該当なし');
    expect(r.freshness?.oldest_fetched_at).toBe(OLD_1);
    expect(r.freshness?.newest_fetched_at).toBe(OLD_3);
  });

  it('SPEC-NTA-SEARCH-BUNSHOKAITOU-006 SPEC-NTA-SEARCH-BUNSHOKAITOU-004 nta_search_bunshokaitou: taxonomy を省いてキーワードに合わないときは文書回答事例全体で判定し、hasPdf では絞らない', async () => {
    const r = (await handleNtaSearchBunshokaitou(
      { keyword: '量子暗号通信', hasPdf: true },
      { dbPath: paths.bunsho }
    )) as SearchResponse;
    expect(r.hint).toContain('該当なし');
    expect(r.freshness?.oldest_fetched_at).toBe(OLD_1);
    expect(r.freshness?.newest_fetched_at).toBe(OLD_4);
  });
});
