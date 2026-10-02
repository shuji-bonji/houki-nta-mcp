/**
 * 差分 specs/changes/20260927-search-hit-responses/ の受入テスト。
 *
 * - ADDED: SPEC-NTA-SEARCH-RULES-015（文書系 5 ツールのヒットしたときの応答）
 * - ADDED: SPEC-NTA-SEARCH-TSUTATSU-010（legal_status はヒットしたときだけ付ける。v0.23.0 の T4 で、ヒットの有無によらず付けるに変わった）
 * - 既存の ID で受ける項目: nta_search_tsutatsu の応答としての
 *   SPEC-NTA-SEARCH-RULES-012・013・014
 *
 * 期待値は仕様の本文から決めている（実装は見ていない）。
 * 外部サイトには取りに行かない（検索はローカル DB だけを引く）。
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

const KEYWORD = '源泉徴収';

interface HitResult {
  docType: string;
  docId: string;
  taxonomy: string | null;
  title: string;
  sourceUrl: string;
  snippet: string;
  score: number;
  scoreReasons: string[];
  index_status?: string | null;
  orphaned_at?: string | null;
}

interface LegalStatus {
  binds_citizens: boolean;
  binds_courts: boolean;
  binds_tax_office: boolean;
  note: string;
}

interface Freshness {
  oldest_fetched_at?: string;
  newest_fetched_at?: string;
  staleness?: string;
}

interface DocHitResponse {
  code?: string;
  error?: string;
  keyword?: string;
  results?: HitResult[];
  freshness?: Freshness;
  legal_status?: LegalStatus;
  search_notes?: string[];
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

const T_NEW = daysAgo(1);
const T_OLD = daysAgo(3);
const ORPHANED_AT = '2026-09-20T00:00:00Z';

type DocRow = {
  docType: string;
  docId: string;
  taxonomy: string;
  title: string;
  body: string;
  fetchedAt: string;
  orphanedAt?: string;
};

const DOCS: DocRow[] = [
  // 質疑応答事例
  {
    docType: 'qa-jirei',
    docId: 'shohi/02/19',
    taxonomy: 'shohi',
    title: '源泉徴収と消費税の関係',
    body: '源泉徴収の対象となる報酬に消費税を含めるかについて。源泉徴収の計算を説明する',
    fetchedAt: T_NEW,
  },
  {
    docType: 'qa-jirei',
    docId: 'shotoku/05/01',
    taxonomy: 'shotoku',
    title: '在宅勤務手当の取扱い',
    body: '在宅勤務手当に対する源泉徴収の要否について説明する',
    fetchedAt: T_OLD,
  },
  {
    docType: 'qa-jirei',
    docId: 'shotoku/05/02',
    taxonomy: 'shotoku',
    title: '会議費と軽減税率',
    body: '社内会議で提供する弁当は軽減税率の対象か',
    fetchedAt: T_OLD,
  },
  // タックスアンサー
  {
    docType: 'tax-answer',
    docId: '2502',
    taxonomy: 'gensen',
    title: '源泉徴収制度のあらまし',
    body: '源泉徴収制度は、給与などを支払う者が所得税を差し引いて納める制度である',
    fetchedAt: T_NEW,
  },
  {
    docType: 'tax-answer',
    docId: '6101',
    taxonomy: 'shohi',
    title: '消費税のしくみ',
    body: '消費税は消費に広く公平に負担を求める税。免税事業者の源泉徴収とは別の話',
    fetchedAt: T_OLD,
  },
  // 改正通達
  {
    docType: 'kaisei',
    docId: 'k-001',
    taxonomy: 'gensen',
    title: '源泉徴収関係の通達の一部改正',
    body: '源泉徴収の事務について、所得税基本通達の一部を改める',
    fetchedAt: T_NEW,
  },
  {
    docType: 'kaisei',
    docId: 'k-002',
    taxonomy: 'hojin',
    title: '法人税基本通達の一部改正',
    body: '役員給与の取扱いを改める。源泉徴収の取扱いは変えない',
    fetchedAt: T_OLD,
  },
  // 事務運営指針
  {
    docType: 'jimu-unei',
    docId: 'j-001',
    taxonomy: 'gensen',
    title: '源泉徴収に関する事務運営指針',
    body: '源泉徴収の事務について、調査の手続を定める',
    fetchedAt: T_NEW,
  },
  {
    docType: 'jimu-unei',
    docId: 'j-002',
    taxonomy: 'shotoku',
    title: '調査手続の実施に当たっての指針',
    body: '事前通知の手続を定める。源泉徴収義務者への調査も含む',
    fetchedAt: T_OLD,
  },
  // 文書回答事例（sozoku と国税局の別表記 souzoku）
  {
    docType: 'bunshokaitou',
    docId: 'b-001',
    taxonomy: 'sozoku',
    title: '相続財産に係る源泉徴収の要否',
    body: '相続財産から支払う報酬に対する源泉徴収の要否について回答する',
    fetchedAt: T_NEW,
  },
  {
    docType: 'bunshokaitou',
    docId: 'tokyo/b-002',
    taxonomy: 'souzoku',
    title: '遺贈に係る源泉徴収の取扱い',
    body: '遺贈により取得した財産の源泉徴収について回答する',
    fetchedAt: T_OLD,
  },
  {
    docType: 'bunshokaitou',
    docId: 'b-003',
    taxonomy: 'hojin',
    title: '外国法人から受ける配当',
    body: '外国法人から受ける配当の源泉徴収の要否について回答する',
    fetchedAt: daysAgo(5),
  },
];

function sourceUrlOf(d: { docType: string; docId: string }): string {
  return `https://www.nta.go.jp/example/${d.docType}/${d.docId}.htm`;
}

function seedDocuments(dbPath: string, docs: DocRow[]) {
  const db = new Database(dbPath);
  initSchema(db);
  const stmt = db.prepare(
    `INSERT INTO document(doc_type, doc_id, taxonomy, title, source_url, fetched_at, full_text, attached_pdfs_json, content_hash, orphaned_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, '[]', NULL, ?)`
  );
  for (const d of docs) {
    stmt.run(
      d.docType,
      d.docId,
      d.taxonomy,
      d.title,
      sourceUrlOf(d),
      d.fetchedAt,
      d.body,
      d.orphanedAt ?? null
    );
  }
  db.close();
}

type ToolCase = {
  tool: string;
  docType: string;
  call: (args: Record<string, unknown>, dbPath: string) => Promise<unknown>;
  bindsTaxOffice: boolean;
};

const TOOLS: ToolCase[] = [
  {
    tool: 'nta_search_qa',
    docType: 'qa-jirei',
    call: (a, dbPath) => handleNtaSearchQa(a as never, { dbPath }),
    bindsTaxOffice: false,
  },
  {
    tool: 'nta_search_tax_answer',
    docType: 'tax-answer',
    call: (a, dbPath) => handleNtaSearchTaxAnswer(a as never, { dbPath }),
    bindsTaxOffice: false,
  },
  {
    tool: 'nta_search_kaisei_tsutatsu',
    docType: 'kaisei',
    call: (a, dbPath) => handleNtaSearchKaiseiTsutatsu(a as never, { dbPath }),
    bindsTaxOffice: true,
  },
  {
    tool: 'nta_search_jimu_unei',
    docType: 'jimu-unei',
    call: (a, dbPath) => handleNtaSearchJimuUnei(a as never, { dbPath }),
    bindsTaxOffice: true,
  },
  {
    tool: 'nta_search_bunshokaitou',
    docType: 'bunshokaitou',
    call: (a, dbPath) => handleNtaSearchBunshokaitou(a as never, { dbPath }),
    bindsTaxOffice: false,
  },
];

describe('SPEC-NTA-SEARCH-RULES-015 文書系 5 ツールのヒットしたときの応答', () => {
  let dir: string;
  let dbPath: string;
  let orphanDbPath: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'houki-nta-spec-hit-'));
    dbPath = join(dir, 'cache.db');
    seedDocuments(dbPath, DOCS);
    orphanDbPath = join(dir, 'orphan.db');
    seedDocuments(orphanDbPath, [
      {
        docType: 'qa-jirei',
        docId: 'gensen/01/01',
        taxonomy: 'gensen',
        title: '源泉徴収の対象となる報酬',
        body: '源泉徴収の対象となる報酬の範囲について',
        fetchedAt: T_NEW,
      },
      {
        docType: 'qa-jirei',
        docId: 'gensen/01/02',
        taxonomy: 'gensen',
        title: '索引から消えた事例',
        body: '源泉徴収の対象となる料金の範囲について',
        fetchedAt: T_NEW,
        orphanedAt: ORPHANED_AT,
      },
    ]);
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  for (const t of TOOLS) {
    const expectedDocs = DOCS.filter(
      (d) => d.docType === t.docType && `${d.title}${d.body}`.includes(KEYWORD)
    );

    it(`SPEC-NTA-SEARCH-RULES-015 ${t.tool}: エラーにせず keyword と results を返し、results の要素が docType・docId・taxonomy・title・sourceUrl・snippet・score・scoreReasons を持ち、索引にある文書は index_status・orphaned_at が null`, async () => {
      const r = (await t.call({ keyword: KEYWORD }, dbPath)) as DocHitResponse;
      expect(r.code).toBeUndefined();
      expect(r.error).toBeUndefined();
      expect(r.keyword).toBe(KEYWORD);
      expect(Array.isArray(r.results)).toBe(true);
      const results = r.results ?? [];
      expect(results.map((x) => x.docId).sort()).toEqual(expectedDocs.map((d) => d.docId).sort());

      for (const x of results) {
        const seeded = expectedDocs.find((d) => d.docId === x.docId);
        expect(seeded).toBeDefined();
        if (!seeded) continue;
        expect(x.docType).toBe(t.docType);
        expect(x.taxonomy).toBe(seeded.taxonomy);
        expect(x.title).toBe(seeded.title);
        expect(x.sourceUrl).toBe(sourceUrlOf(seeded));
        expect(x.snippet).toContain(`<b>${KEYWORD}</b>`);
        expect(typeof x.score).toBe('number');
        expect(x.score).toBeGreaterThanOrEqual(0);
        expect(x.score).toBeLessThanOrEqual(1.5);
        expect(Array.isArray(x.scoreReasons)).toBe(true);
        expect(x.scoreReasons[0]).toMatch(/^doc_type=\S+ weight \d/);
        // v0.23.0（T4）: 索引にある文書でも index_status / orphaned_at を null で置く
        expect(x.index_status).toBeNull();
        expect(x.orphaned_at).toBeNull();
      }
    });

    it(`SPEC-NTA-SEARCH-RULES-015 ${t.tool}: results は score の高い順で、最大 limit 件`, async () => {
      const all = (await t.call({ keyword: KEYWORD }, dbPath)) as DocHitResponse;
      const scores = (all.results ?? []).map((x) => x.score);
      expect(scores.length).toBeGreaterThanOrEqual(2);
      expect([...scores].sort((a, b) => b - a)).toEqual(scores);

      const one = (await t.call({ keyword: KEYWORD, limit: 1 }, dbPath)) as DocHitResponse;
      expect(one.results).toHaveLength(1);
      expect(one.results?.[0]?.score).toBe(scores[0]);
    });

    it(`SPEC-NTA-SEARCH-RULES-015 ${t.tool}: freshness にその種別の文書の取得時点の範囲を付ける`, async () => {
      const r = (await t.call({ keyword: KEYWORD }, dbPath)) as DocHitResponse;
      const ofType = DOCS.filter((d) => d.docType === t.docType)
        .map((d) => d.fetchedAt)
        .sort();
      expect(r.freshness).toBeDefined();
      expect(r.freshness?.oldest_fetched_at).toBe(ofType[0]);
      expect(r.freshness?.newest_fetched_at).toBe(ofType[ofType.length - 1]);
    });

    it(`SPEC-NTA-SEARCH-RULES-015 ${t.tool}: legal_status は binds_citizens=false・binds_courts=false・binds_tax_office=${t.bindsTaxOffice} と note`, async () => {
      const r = (await t.call({ keyword: KEYWORD }, dbPath)) as DocHitResponse;
      expect(r.legal_status?.binds_citizens).toBe(false);
      expect(r.legal_status?.binds_courts).toBe(false);
      expect(r.legal_status?.binds_tax_office).toBe(t.bindsTaxOffice);
      expect(typeof r.legal_status?.note).toBe('string');
      expect(r.legal_status?.note).toContain('拘束');
    });

    it(`SPEC-NTA-SEARCH-RULES-015 ${t.tool}: 語が全部 3 文字以上で注記の無いときは search_notes を付けない`, async () => {
      const r = (await t.call({ keyword: KEYWORD }, dbPath)) as DocHitResponse;
      expect(r.search_notes).toBeUndefined();
    });
  }

  it('SPEC-NTA-SEARCH-RULES-015 nta_search_qa: 仕様の例のとおり docType は qa-jirei、scoreReasons の先頭は doc_type=qa weight 0.70', async () => {
    const r = (await handleNtaSearchQa({ keyword: KEYWORD }, { dbPath })) as DocHitResponse;
    expect(r.results).toHaveLength(2);
    for (const x of r.results ?? []) {
      expect(x.docType).toBe('qa-jirei');
      expect(x.scoreReasons[0]).toBe('doc_type=qa weight 0.70');
    }
  });

  it('SPEC-NTA-SEARCH-RULES-015 docId は例の形のとおり（質疑応答事例は shohi/02/19、タックスアンサーは 6101）', async () => {
    const qa = (await handleNtaSearchQa(
      { keyword: '消費税を含める' },
      { dbPath }
    )) as DocHitResponse;
    expect(qa.results?.map((x) => x.docId)).toEqual(['shohi/02/19']);
    const ta = (await handleNtaSearchTaxAnswer(
      { keyword: '免税事業者' },
      { dbPath }
    )) as DocHitResponse;
    expect(ta.results?.map((x) => x.docId)).toEqual(['6101']);
  });

  it('SPEC-NTA-SEARCH-RULES-015 nta_search_qa: topic で絞ったときの freshness はその範囲の取得時点', async () => {
    const r = (await handleNtaSearchQa(
      { keyword: KEYWORD, topic: 'shotoku' },
      { dbPath }
    )) as DocHitResponse;
    expect(r.results?.map((x) => x.docId)).toEqual(['shotoku/05/01']);
    expect(r.freshness?.oldest_fetched_at).toBe(T_OLD);
    expect(r.freshness?.newest_fetched_at).toBe(T_OLD);
  });

  it('SPEC-NTA-SEARCH-RULES-015 nta_search_kaisei_tsutatsu / nta_search_jimu_unei: taxonomy で絞ったときの freshness はその範囲の取得時点', async () => {
    const k = (await handleNtaSearchKaiseiTsutatsu(
      { keyword: KEYWORD, taxonomy: 'hojin' },
      { dbPath }
    )) as DocHitResponse;
    expect(k.results?.map((x) => x.docId)).toEqual(['k-002']);
    expect(k.freshness?.oldest_fetched_at).toBe(T_OLD);
    expect(k.freshness?.newest_fetched_at).toBe(T_OLD);

    const j = (await handleNtaSearchJimuUnei(
      { keyword: KEYWORD, taxonomy: 'gensen' },
      { dbPath }
    )) as DocHitResponse;
    expect(j.results?.map((x) => x.docId)).toEqual(['j-001']);
    expect(j.freshness?.oldest_fetched_at).toBe(T_NEW);
    expect(j.freshness?.newest_fetched_at).toBe(T_NEW);
  });

  it('SPEC-NTA-SEARCH-RULES-015 nta_search_bunshokaitou: taxonomy で絞ったときの freshness は別表記を含む範囲の取得時点', async () => {
    const r = (await handleNtaSearchBunshokaitou(
      { keyword: KEYWORD, taxonomy: 'sozoku' },
      { dbPath }
    )) as DocHitResponse;
    expect(r.results?.map((x) => x.docId).sort()).toEqual(['b-001', 'tokyo/b-002']);
    // 各要素の taxonomy は DB の値のまま
    expect(r.results?.find((x) => x.docId === 'tokyo/b-002')?.taxonomy).toBe('souzoku');
    // hojin の文書（5 日前）は範囲に入らない
    expect(r.freshness?.oldest_fetched_at).toBe(T_OLD);
    expect(r.freshness?.newest_fetched_at).toBe(T_NEW);
  });

  it('SPEC-NTA-SEARCH-RULES-015 SPEC-NTA-SEARCH-RULES-011 nta_search_qa: 索引から消えた文書の index_status / orphaned_at は値、索引にある文書は null で、search_notes が付く', async () => {
    const r = (await handleNtaSearchQa(
      { keyword: KEYWORD },
      { dbPath: orphanDbPath }
    )) as DocHitResponse;
    const current = r.results?.find((x) => x.docId === 'gensen/01/01');
    const removed = r.results?.find((x) => x.docId === 'gensen/01/02');
    expect(current?.index_status).toBeNull();
    expect(current?.orphaned_at).toBeNull();
    expect(removed?.index_status).toBe('removed_from_index');
    expect(removed?.orphaned_at).toBe(ORPHANED_AT);
    expect(r.search_notes?.some((n) => n.includes('2 件のうち 1 件'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// nta_search_tsutatsu
// ---------------------------------------------------------------------------

interface TsutatsuHit {
  tsutatsu: string;
  clauseNumber: string;
  score: number;
  scoreReasons: string[];
}

interface TsutatsuResponse {
  code?: string;
  keyword?: string;
  count?: number;
  hits: TsutatsuHit[];
  message?: string;
  legal_status?: LegalStatus;
}

describe('nta_search_tsutatsu のヒットしたときの応答', () => {
  let dir: string;
  let dbPath: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'houki-nta-spec-tsutatsu-hit-'));
    dbPath = join(dir, 'cache.db');
    const db = new Database(dbPath);
    initSchema(db);
    const shohi = (
      db
        .prepare(
          `INSERT INTO tsutatsu(formal_name, abbr, source_root_url) VALUES (?, ?, ?) RETURNING id`
        )
        .get('消費税法基本通達', '消基通', 'https://x/shohi/') as { id: number }
    ).id;
    db.prepare(
      `INSERT INTO section(tsutatsu_id, chapter_number, section_number, title, url, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(shohi, 5, 1, '通則', 'https://x/shohi/05/01.htm', T_NEW);
    const insertClause = db.prepare(
      `INSERT INTO clause(tsutatsu_id, clause_number, source_url, chapter_number, section_number, title, full_text, paragraphs_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, '[]')`
    );
    // 5-1-9 を先頭以外に入れ、請求対価を多く含む条項を先に入れる
    insertClause.run(
      shohi,
      '5-1-1',
      'https://x/shohi/05/01.htm',
      5,
      1,
      '請求対価の意義',
      '請求対価の意義 請求対価とは、請求対価として受け取るものをいう。請求対価の範囲。'
    );
    insertClause.run(
      shohi,
      '5-1-2',
      'https://x/shohi/05/01.htm',
      5,
      1,
      '請求対価の範囲',
      '請求対価の範囲について定める。'
    );
    insertClause.run(
      shohi,
      '5-1-9',
      'https://x/shohi/05/01.htm',
      5,
      1,
      '役務の提供',
      '役務の提供に係る請求対価の取扱い。'
    );
    insertClause.run(
      shohi,
      '5-1-10',
      'https://x/shohi/05/01.htm',
      5,
      1,
      '棚卸資産の販売',
      '棚卸資産の販売について定める。'
    );
    db.close();
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('SPEC-NTA-SEARCH-TSUTATSU-010 nta_search_tsutatsu: 合う条項があるときは legal_status（binds_citizens=false・binds_courts=false・binds_tax_office=true と note）を付ける', async () => {
    const r = (await searchTsutatsu({ keyword: '請求対価' }, { dbPath })) as TsutatsuResponse;
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.legal_status?.binds_citizens).toBe(false);
    expect(r.legal_status?.binds_courts).toBe(false);
    expect(r.legal_status?.binds_tax_office).toBe(true);
    expect(r.legal_status?.note).toContain('行政内部');
    expect(r.legal_status?.note).toContain('拘束');
  });

  it('SPEC-NTA-SEARCH-TSUTATSU-010 nta_search_tsutatsu: 合う条項が無いときも legal_status を付ける', async () => {
    const r = (await searchTsutatsu(
      { keyword: '存在しない語句です' },
      { dbPath }
    )) as TsutatsuResponse;
    expect(r.code).toBeUndefined();
    expect(r.hits).toEqual([]);
    // v0.23.0（T4）: 0 件のときも付ける（文書系 5 ツールの 0 件と同じ）
    expect(r.legal_status?.binds_citizens).toBe(false);
    expect(r.legal_status?.binds_courts).toBe(false);
    expect(r.legal_status?.binds_tax_office).toBe(true);
  });

  it('SPEC-NTA-SEARCH-RULES-012 nta_search_tsutatsu の応答: 各 hit の score は 0〜1.5、scoreReasons に doc_type=tsutatsu weight 1.00', async () => {
    const r = (await searchTsutatsu({ keyword: '請求対価' }, { dbPath })) as TsutatsuResponse;
    expect(r.hits.map((h) => h.clauseNumber).sort()).toEqual(['5-1-1', '5-1-2', '5-1-9']);
    for (const h of r.hits) {
      expect(typeof h.score).toBe('number');
      expect(h.score).toBeGreaterThanOrEqual(0);
      expect(h.score).toBeLessThanOrEqual(1.5);
      expect(h.scoreReasons).toContain('doc_type=tsutatsu weight 1.00');
    }
  });

  it('SPEC-NTA-SEARCH-RULES-013 nta_search_tsutatsu の応答: keyword の条項番号と一致する条項が 1 位に来て、scoreReasons に clause exact match が入る', async () => {
    const r = (await searchTsutatsu({ keyword: '5-1-9 請求対価' }, { dbPath })) as TsutatsuResponse;
    expect(r.hits[0]?.clauseNumber).toBe('5-1-9');
    expect(r.hits[0]?.scoreReasons).toContain('clause exact match');
    for (const h of r.hits.slice(1)) {
      expect(h.scoreReasons).not.toContain('clause exact match');
    }
  });

  it('SPEC-NTA-SEARCH-RULES-013 nta_search_tsutatsu の応答: 全角で書いた条項番号（５-１-９）も一致として加点する', async () => {
    const r = (await searchTsutatsu(
      { keyword: '５-１-９ 請求対価' },
      { dbPath }
    )) as TsutatsuResponse;
    expect(r.hits[0]?.clauseNumber).toBe('5-1-9');
    expect(r.hits[0]?.scoreReasons).toContain('clause exact match');
  });

  it('SPEC-NTA-SEARCH-RULES-013 nta_search_tsutatsu の応答: 番号の一致で score が上がる（番号なしのときより高い）', async () => {
    const plain = (await searchTsutatsu({ keyword: '請求対価' }, { dbPath })) as TsutatsuResponse;
    const withNo = (await searchTsutatsu(
      { keyword: '5-1-9 請求対価' },
      { dbPath }
    )) as TsutatsuResponse;
    const before = plain.hits.find((h) => h.clauseNumber === '5-1-9');
    const after = withNo.hits.find((h) => h.clauseNumber === '5-1-9');
    expect(before?.scoreReasons).not.toContain('clause exact match');
    expect(after?.score ?? 0).toBeGreaterThan(before?.score ?? 0);
  });

  it('SPEC-NTA-SEARCH-RULES-014 nta_search_tsutatsu の応答: hits は score の降順で、limit 件に絞る', async () => {
    const r = (await searchTsutatsu({ keyword: '請求対価' }, { dbPath })) as TsutatsuResponse;
    const scores = r.hits.map((h) => h.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);

    const one = (await searchTsutatsu(
      { keyword: '請求対価', limit: 1 },
      { dbPath }
    )) as TsutatsuResponse;
    expect(one.hits).toHaveLength(1);
    expect(one.count).toBe(1);
    expect(one.hits[0]?.score).toBe(scores[0]);
  });
});
