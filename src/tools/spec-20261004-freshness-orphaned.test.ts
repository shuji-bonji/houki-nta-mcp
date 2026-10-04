/**
 * 差分 specs/changes/20261004-freshness-orphaned/（PR #140、houki-nta-mcp #139）の受入テスト。
 *
 * - MODIFIED: SPEC-NTA-SEARCH-RULES-017（文書系 5 ツールでは国税庁の索引から消えた文書を freshness の範囲に入れない）
 *
 * 期待値は差分の spec.md の本文と例 2・3・4、proposal.md の「変えた後の動き」「変わらない振る舞い」から決めている。
 * DB は一時ディレクトリに作り、initSchema してから文書を入れる。国税庁サイトには取りに行かない。
 * 例の「呼んだ時点」は Date だけを偽の時計にして合わせる。
 *
 * v0.25.0（差分 20261004-db-location、SPEC-NTA-SEARCH-RULES-017・022 の MODIFIED / ADDED）で、`freshness` に
 * `db_path` が入り、範囲に文書が無いときも取得日時の 4 つを null にして付けるようになったので、期待値を直した。
 * ホームディレクトリは一時ディレクトリの下の別のフォルダーにし、DB のパスが `~` に置き換わらないようにしている。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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
  oldest_fetched_at: string | null;
  newest_fetched_at: string | null;
  days_since_oldest: number | null;
  staleness: string | null;
  db_path?: string;
  warning?: string;
}

interface SearchResult {
  docId: string;
  index_status?: string | null;
  orphaned_at?: string | null;
}

interface SearchResponse {
  code?: string;
  results?: SearchResult[];
  hits?: unknown[];
  hint?: string;
  freshness?: Freshness;
}

interface DocSeed {
  docType: DocTypeName;
  docId: string;
  taxonomy: string;
  fetchedAt: string;
  orphanedAt: string | null;
}

type DocTypeName = 'qa-jirei' | 'tax-answer' | 'kaisei' | 'jimu-unei' | 'bunshokaitou';

/** 文書の本文。KEYWORD で当たり、ZERO_KEYWORD では当たらない */
const BODY = '減価償却資産の耐用年数についての取扱いを示す。';
const KEYWORD = '減価償却資産';
const ZERO_KEYWORD = '該当しない語句の組み合わせ';

function seedDocs(dbPath: string, docs: DocSeed[]): void {
  const db = new Database(dbPath);
  initSchema(db);
  const insert = db.prepare(
    `INSERT INTO document(doc_type, doc_id, taxonomy, title, source_url, fetched_at, full_text, attached_pdfs_json, content_hash, orphaned_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const d of docs) {
    insert.run(
      d.docType,
      d.docId,
      d.taxonomy,
      `減価償却資産の取扱い（${d.docId}）`,
      `https://x/${d.docType}/${d.docId}.htm`,
      d.fetchedAt,
      BODY,
      '[]',
      null,
      d.orphanedAt
    );
  }
  db.close();
}

/** 呼んだ時点を合わせる。Date だけを偽にし、タイマーは本物のまま */
function callAt(iso: string): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
}

afterEach(() => {
  vi.useRealTimers();
});

/** 文書系 5 ツールを、範囲を絞る引数の名前とともに並べる */
const DOC_TOOLS = [
  {
    tool: 'nta_search_qa',
    docType: 'qa-jirei',
    scopeArg: 'topic',
    search: (args: Record<string, unknown>, dbPath: string) =>
      handleNtaSearchQa(args as { keyword: string }, { dbPath }),
  },
  {
    tool: 'nta_search_tax_answer',
    docType: 'tax-answer',
    scopeArg: undefined,
    search: (args: Record<string, unknown>, dbPath: string) =>
      handleNtaSearchTaxAnswer(args as { keyword: string }, { dbPath }),
  },
  {
    tool: 'nta_search_kaisei_tsutatsu',
    docType: 'kaisei',
    scopeArg: 'taxonomy',
    search: (args: Record<string, unknown>, dbPath: string) =>
      handleNtaSearchKaiseiTsutatsu(args as { keyword: string }, { dbPath }),
  },
  {
    tool: 'nta_search_jimu_unei',
    docType: 'jimu-unei',
    scopeArg: 'taxonomy',
    search: (args: Record<string, unknown>, dbPath: string) =>
      handleNtaSearchJimuUnei(args as { keyword: string }, { dbPath }),
  },
  {
    tool: 'nta_search_bunshokaitou',
    docType: 'bunshokaitou',
    scopeArg: 'taxonomy',
    search: (args: Record<string, unknown>, dbPath: string) =>
      handleNtaSearchBunshokaitou(args as { keyword: string }, { dbPath }),
  },
] as const;

async function call(
  t: (typeof DOC_TOOLS)[number],
  args: Record<string, unknown>,
  dbPath: string
): Promise<SearchResponse> {
  return (await t.search(args, dbPath)) as SearchResponse;
}

/* -------------------------------------------------------------------------- */
/* 例 2・3 の値                                                                 */
/* -------------------------------------------------------------------------- */

/** 例 2（タックスアンサー No.2882 の形） */
const EX2 = {
  orphanedFetchedAt: '2026-09-07T21:06:49.516Z',
  orphanedAt: '2026-10-04T02:11:37.431Z',
  oldest: '2026-10-04T03:00:00Z',
  newest: '2026-10-04T03:51:17.445Z',
};

/** 例 3（ほかの 4 種別） */
const EX3 = {
  indexedFetchedAt: '2026-10-04T03:30:00Z',
  orphanedFetchedAt: '2026-09-01T00:00:00Z',
  orphanedAt: '2026-10-04T03:40:00Z',
  calledAt: '2026-10-04T05:00:00Z',
};

function ex3DocId(docType: DocTypeName, which: 'indexed' | 'orphaned'): string {
  if (docType === 'qa-jirei') return `shotoku/01/${which}`;
  return `${docType}-${which}`;
}

let dir: string;
const paths = {
  /** 例 2: タックスアンサー 3 行（2882 は索引から消えた印付き） */
  ex2: '',
  /** 例 4: 改正通達 hojin の索引から消えた 1 件と shohi の索引にある 1 件 */
  ex4: '',
  /** 範囲がすべて印付きの DB（5 種別それぞれ） */
  allOrphaned: {} as Record<string, string>,
  /** 例 3 の DB（5 種別それぞれ。タックスアンサーにも同じ形を入れる） */
  ex3: {} as Record<string, string>,
  /** nta_search_tsutatsu の範囲を確かめる DB（通達の節と、古い印付きのタックスアンサー） */
  tsutatsu: '',
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'houki-nta-spec-20261004-freshness-orphaned-'));
  // DB のパスがホームディレクトリの下にならないようにする（SPEC-NTA-DB-SCHEMA-028 の置き換えをこのテストでは見ない）
  vi.stubEnv('HOME', join(dir, 'home'));

  paths.ex2 = join(dir, 'ex2.db');
  seedDocs(paths.ex2, [
    {
      docType: 'tax-answer',
      docId: '2882',
      taxonomy: 'shotoku',
      fetchedAt: EX2.orphanedFetchedAt,
      orphanedAt: EX2.orphanedAt,
    },
    {
      docType: 'tax-answer',
      docId: '1131',
      taxonomy: 'shotoku',
      fetchedAt: EX2.oldest,
      orphanedAt: null,
    },
    {
      docType: 'tax-answer',
      docId: '6101',
      taxonomy: 'shohi',
      fetchedAt: EX2.newest,
      orphanedAt: null,
    },
  ]);

  paths.ex4 = join(dir, 'ex4.db');
  seedDocs(paths.ex4, [
    {
      docType: 'kaisei',
      docId: 'kaisei-hojin-orphaned',
      taxonomy: 'hojin',
      fetchedAt: '2026-09-01T00:00:00Z',
      orphanedAt: '2026-10-04T03:40:00Z',
    },
    {
      docType: 'kaisei',
      docId: 'kaisei-shohi-indexed',
      taxonomy: 'shohi',
      fetchedAt: '2026-10-04T03:30:00Z',
      orphanedAt: null,
    },
  ]);

  for (const t of DOC_TOOLS) {
    const ex3Path = join(dir, `ex3-${t.docType}.db`);
    seedDocs(ex3Path, [
      {
        docType: t.docType,
        docId: ex3DocId(t.docType, 'indexed'),
        taxonomy: 'shotoku',
        fetchedAt: EX3.indexedFetchedAt,
        orphanedAt: null,
      },
      {
        docType: t.docType,
        docId: ex3DocId(t.docType, 'orphaned'),
        taxonomy: 'shotoku',
        fetchedAt: EX3.orphanedFetchedAt,
        orphanedAt: EX3.orphanedAt,
      },
    ]);
    paths.ex3[t.docType] = ex3Path;

    const allPath = join(dir, `all-orphaned-${t.docType}.db`);
    seedDocs(allPath, [
      {
        docType: t.docType,
        docId: ex3DocId(t.docType, 'orphaned'),
        taxonomy: 'shotoku',
        fetchedAt: EX3.orphanedFetchedAt,
        orphanedAt: EX3.orphanedAt,
      },
    ]);
    paths.allOrphaned[t.docType] = allPath;
  }

  // nta_search_tsutatsu: 通達の節（2026-10-04T01:00:00Z と 2026-10-04T02:00:00Z）と、
  // 印の付いた古いタックスアンサー（document テーブル）を同じ DB に入れる
  paths.tsutatsu = join(dir, 'tsutatsu.db');
  seedDocs(paths.tsutatsu, [
    {
      docType: 'tax-answer',
      docId: '2882',
      taxonomy: 'shotoku',
      fetchedAt: EX2.orphanedFetchedAt,
      orphanedAt: EX2.orphanedAt,
    },
  ]);
  const db = new Database(paths.tsutatsu);
  const tsutatsuId = (
    db
      .prepare(
        'INSERT INTO tsutatsu(formal_name, abbr, source_root_url) VALUES (?, ?, ?) RETURNING id'
      )
      .get('法人税基本通達', '法基通', 'https://x/hojin/') as { id: number }
  ).id;
  for (const [section, fetchedAt] of [
    [1, '2026-10-04T01:00:00Z'],
    [2, '2026-10-04T02:00:00Z'],
  ] as const) {
    const url = `https://x/hojin/7/${section}.htm`;
    db.prepare(
      `INSERT INTO section(tsutatsu_id, chapter_number, section_number, title, url, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(tsutatsuId, 7, section, `第${section}節`, url, fetchedAt);
    db.prepare(
      `INSERT INTO clause(tsutatsu_id, clause_number, source_url, chapter_number, section_number, title, full_text, paragraphs_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      tsutatsuId,
      `7-${section}-1`,
      url,
      7,
      section,
      '減価償却資産の範囲',
      BODY,
      JSON.stringify([{ indent: 1, text: BODY }])
    );
  }
  db.close();
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

/** 範囲に文書が無いときの freshness（SPEC-NTA-SEARCH-RULES-017・022） */
function nullRange(dbPath: string): Freshness {
  return {
    oldest_fetched_at: null,
    newest_fetched_at: null,
    staleness: null,
    days_since_oldest: null,
    db_path: dbPath,
  };
}

describe('SPEC-NTA-SEARCH-RULES-017 文書系 5 ツールでは国税庁の索引から消えた文書を freshness の範囲に入れない', () => {
  /* ------------------------------------------------------------------------ */
  /* 例 2（タックスアンサー No.2882 の形）                                       */
  /* ------------------------------------------------------------------------ */

  it('SPEC-NTA-SEARCH-RULES-017 例 2 nta_search_tax_answer: 2026-10-04T05:00:00Z に呼ぶと、索引にある 2 行で oldest=2026-10-04T03:00:00Z・newest=2026-10-04T03:51:17.445Z・0 日・fresh・warning 無し', async () => {
    callAt('2026-10-04T05:00:00Z');
    const r = (await handleNtaSearchTaxAnswer(
      { keyword: KEYWORD },
      { dbPath: paths.ex2 }
    )) as SearchResponse;
    expect(r.code).toBeUndefined();
    expect(r.freshness).toEqual({
      oldest_fetched_at: EX2.oldest,
      newest_fetched_at: EX2.newest,
      days_since_oldest: 0,
      staleness: 'fresh',
      db_path: paths.ex2,
    });
  });

  it('SPEC-NTA-SEARCH-RULES-017 例 2 nta_search_tax_answer: 2026-10-08T00:00:00Z に呼ぶと、3 日・fresh・warning 無し（v0.24.0 の 30 日・outdated にならない）', async () => {
    callAt('2026-10-08T00:00:00Z');
    const r = (await handleNtaSearchTaxAnswer(
      { keyword: KEYWORD },
      { dbPath: paths.ex2 }
    )) as SearchResponse;
    expect(r.freshness).toEqual({
      oldest_fetched_at: EX2.oldest,
      newest_fetched_at: EX2.newest,
      days_since_oldest: 3,
      staleness: 'fresh',
      db_path: paths.ex2,
    });
  });

  it('SPEC-NTA-SEARCH-RULES-017 例 2 nta_search_tax_answer: No.2882 はキーワードに当たれば検索結果に入り、index_status=removed_from_index・orphaned_at を持つ', async () => {
    callAt('2026-10-04T05:00:00Z');
    const r = (await handleNtaSearchTaxAnswer(
      { keyword: KEYWORD },
      { dbPath: paths.ex2 }
    )) as SearchResponse;
    const ids = (r.results ?? []).map((x) => x.docId).sort();
    expect(ids).toEqual(['1131', '2882', '6101']);
    const removed = r.results?.find((x) => x.docId === '2882');
    expect(removed?.index_status).toBe('removed_from_index');
    expect(removed?.orphaned_at).toBe(EX2.orphanedAt);
  });

  it('SPEC-NTA-SEARCH-RULES-017 例 2 nta_search_tax_answer: 0 件の応答の freshness も索引にある 2 行で決める', async () => {
    callAt('2026-10-08T00:00:00Z');
    const r = (await handleNtaSearchTaxAnswer(
      { keyword: ZERO_KEYWORD },
      { dbPath: paths.ex2 }
    )) as SearchResponse;
    expect(r.code).toBeUndefined();
    expect(r.results).toEqual([]);
    expect(r.freshness).toEqual({
      oldest_fetched_at: EX2.oldest,
      newest_fetched_at: EX2.newest,
      days_since_oldest: 3,
      staleness: 'fresh',
      db_path: paths.ex2,
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 例 3（印の付いた古い行がある DB。5 種別）                                   */
  /* ------------------------------------------------------------------------ */

  const ex3Expected: Freshness = {
    oldest_fetched_at: EX3.indexedFetchedAt,
    newest_fetched_at: EX3.indexedFetchedAt,
    days_since_oldest: 0,
    staleness: 'fresh',
  };

  for (const t of DOC_TOOLS) {
    const variants: Array<[label: string, extra: Record<string, unknown>]> = [
      [t.scopeArg ? `${t.scopeArg} を省く` : '引数で絞らない', {}],
      ...(t.scopeArg
        ? ([[`${t.scopeArg}: "shotoku"`, { [t.scopeArg]: 'shotoku' }]] as Array<
            [string, Record<string, unknown>]
          >)
        : []),
    ];
    for (const [label, extra] of variants) {
      it(`SPEC-NTA-SEARCH-RULES-017 例 3 ${t.tool}（${label}）: 印の付いた 2026-09-01 の行を範囲に入れず、oldest=newest=2026-10-04T03:30:00Z・fresh`, async () => {
        callAt(EX3.calledAt);
        const r = await call(t, { keyword: KEYWORD, ...extra }, paths.ex3[t.docType]);
        expect(r.code).toBeUndefined();
        expect(r.freshness).toEqual({ ...ex3Expected, db_path: paths.ex3[t.docType] });
        // 検索結果からは除かない（011）
        const removed = r.results?.find((x) => x.docId === ex3DocId(t.docType, 'orphaned'));
        expect(removed?.index_status).toBe('removed_from_index');
        expect(removed?.orphaned_at).toBe(EX3.orphanedAt);
      });

      it(`SPEC-NTA-SEARCH-RULES-017 例 3 ${t.tool}（${label}）: 0 件の応答でも印の付いた行を範囲に入れない`, async () => {
        callAt(EX3.calledAt);
        const r = await call(t, { keyword: ZERO_KEYWORD, ...extra }, paths.ex3[t.docType]);
        expect(r.code).toBeUndefined();
        expect(r.results).toEqual([]);
        expect(r.freshness).toEqual({ ...ex3Expected, db_path: paths.ex3[t.docType] });
      });
    }
  }

  /* ------------------------------------------------------------------------ */
  /* 範囲の行がすべて印付き（5 種別）                                            */
  /* ------------------------------------------------------------------------ */

  for (const t of DOC_TOOLS) {
    it(`SPEC-NTA-SEARCH-RULES-017 ${t.tool}: その種別の文書がすべて索引から消えているときは freshness の取得日時の 4 つを null にし（SPEC-NTA-SEARCH-RULES-022）、検索は行って印付きの文書を返す`, async () => {
      callAt(EX3.calledAt);
      const r = await call(t, { keyword: KEYWORD }, paths.allOrphaned[t.docType]);
      expect(r.code).toBeUndefined();
      expect(r.freshness).toEqual(nullRange(paths.allOrphaned[t.docType]));
      expect(r.results?.map((x) => x.docId)).toEqual([ex3DocId(t.docType, 'orphaned')]);
      expect(r.results?.[0]?.index_status).toBe('removed_from_index');
      expect(r.results?.[0]?.orphaned_at).toBe(EX3.orphanedAt);
    });

    it(`SPEC-NTA-SEARCH-RULES-017 ${t.tool}: その種別の文書がすべて索引から消えているときの 0 件の応答は、DOC_NOT_FOUND にならず freshness の取得日時の 4 つを null にする（SPEC-NTA-SEARCH-RULES-022）`, async () => {
      callAt(EX3.calledAt);
      const r = await call(t, { keyword: ZERO_KEYWORD }, paths.allOrphaned[t.docType]);
      expect(r.code).toBeUndefined();
      expect(r.results).toEqual([]);
      expect(r.hint).toBeDefined();
      expect(r.freshness).toEqual(nullRange(paths.allOrphaned[t.docType]));
    });
  }

  /* ------------------------------------------------------------------------ */
  /* 例 4（税目で絞った範囲に索引にある文書が無い）                              */
  /* ------------------------------------------------------------------------ */

  it('SPEC-NTA-SEARCH-RULES-017 例 4 nta_search_kaisei_tsutatsu: taxonomy: "hojin" では hojin の印付きの文書を返し、freshness は取得日時の 4 つが null で db_path だけが値を持つ', async () => {
    callAt(EX3.calledAt);
    const r = (await handleNtaSearchKaiseiTsutatsu(
      { keyword: KEYWORD, taxonomy: 'hojin' },
      { dbPath: paths.ex4 }
    )) as SearchResponse;
    expect(r.code).toBeUndefined();
    expect(r.results?.map((x) => x.docId)).toEqual(['kaisei-hojin-orphaned']);
    expect(r.results?.[0]?.index_status).toBe('removed_from_index');
    expect(r.freshness).toEqual(nullRange(paths.ex4));
  });

  it('SPEC-NTA-SEARCH-RULES-017 例 4 nta_search_kaisei_tsutatsu: taxonomy を省くと、範囲は shohi の索引にある 1 件で freshness を付ける', async () => {
    callAt(EX3.calledAt);
    const r = (await handleNtaSearchKaiseiTsutatsu(
      { keyword: KEYWORD },
      { dbPath: paths.ex4 }
    )) as SearchResponse;
    expect(r.code).toBeUndefined();
    expect(r.freshness).toEqual({
      oldest_fetched_at: '2026-10-04T03:30:00Z',
      newest_fetched_at: '2026-10-04T03:30:00Z',
      days_since_oldest: 0,
      staleness: 'fresh',
      db_path: paths.ex4,
    });
  });

  /* ------------------------------------------------------------------------ */
  /* nta_search_tsutatsu は変わらない                                            */
  /* ------------------------------------------------------------------------ */

  it('SPEC-NTA-SEARCH-RULES-017 nta_search_tsutatsu: 範囲は通達の節だけで、document テーブルの印付きの古い行に左右されない', async () => {
    callAt(EX3.calledAt);
    const r = (await searchTsutatsu(
      { keyword: KEYWORD },
      { dbPath: paths.tsutatsu }
    )) as SearchResponse;
    expect(r.hits?.length).toBeGreaterThan(0);
    expect(r.freshness).toEqual({
      oldest_fetched_at: '2026-10-04T01:00:00Z',
      newest_fetched_at: '2026-10-04T02:00:00Z',
      days_since_oldest: 0,
      staleness: 'fresh',
      db_path: paths.tsutatsu,
    });
  });
});
