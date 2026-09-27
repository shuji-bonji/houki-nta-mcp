/**
 * 差分 specs/changes/20260927-search-keyword-rules/ の受入テスト。
 *
 * - ADDED: SPEC-NTA-SEARCH-RULES-016（略称・通称を広げるのは houki-nta と houki-egov の管轄の項目だけ。
 *   正式名が keyword と同じなら広げない）
 * - proposal.md「既存の仕様 ID で受ける項目」の表: 検索系 6 ツールの応答として
 *   SPEC-NTA-SEARCH-RULES-001・003〜010 を確かめる
 *
 * 期待値は specs/current/search_rules/spec.md と差分の spec.md・proposal.md の本文から決めている。
 * テストに使う語は日本語にする（英字の 2 文字の語は houki-nta-mcp #81 で未決）。
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AbbreviationEntry } from '@shuji-bonji/houki-abbreviations';
import Database from 'better-sqlite3';
import { encode as iconvEncode } from 'iconv-lite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { initSchema } from '../db/schema.js';
import {
  getTsutatsu,
  handleNtaSearchBunshokaitou,
  handleNtaSearchJimuUnei,
  handleNtaSearchKaiseiTsutatsu,
  handleNtaSearchQa,
  handleNtaSearchTaxAnswer,
  searchTsutatsu,
} from './handlers.js';

/*
 * SPEC-NTA-SEARCH-RULES-016 の「管轄がほかの MCP の項目は広げない」を確かめるための辞書の差し替え。
 *
 * 今の略称辞書（houki-abbreviations 0.4.1）には houki-nta と houki-egov 以外の管轄の項目が無いので、
 * 辞書に無いテスト用の 1 語（COURT_ALIAS）のときだけ、管轄が houki-court の項目を返す。
 * それ以外の語は本物の resolveAbbreviation に任せる（このファイルの他のテストは本物の辞書で動く）。
 *
 * 辞書に houki-court などの項目が入ったら差し替えを外し、本物の項目で確かめるテストに書き換える。
 */
const { COURT_ALIAS, COURT_FORMAL } = vi.hoisted(() => ({
  COURT_ALIAS: 'テスト判例通称',
  COURT_FORMAL: '判例テスト用正式名集',
}));

vi.mock('@shuji-bonji/houki-abbreviations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shuji-bonji/houki-abbreviations')>();
  const courtEntry: AbbreviationEntry = {
    abbr: '判テ略',
    formal: COURT_FORMAL,
    law_id: null,
    domain: 'civil',
    category: 'hanrei',
    source_mcp_hint: 'houki-court',
    aliases: [COURT_ALIAS],
  };
  return {
    ...actual,
    resolveAbbreviation: (
      name: string,
      options?: Parameters<typeof actual.resolveAbbreviation>[1]
    ): AbbreviationEntry | null =>
      name.trim() === COURT_ALIAS ? courtEntry : actual.resolveAbbreviation(name, options),
  };
});

/* -------------------------------------------------------------------------- */
/* 期待する search_notes の文（search_rules の SPEC-NTA-SEARCH-RULES-006・010）   */
/* -------------------------------------------------------------------------- */

const noteShortOnly = (w: string) =>
  `"${w}" は 3 文字未満のため FTS5 (trigram) では検索できません。代わりに本文とタイトルの部分一致 (LIKE) で検索しました。0 件でも「該当なし」とは限らないので、"${w}" に語を続けて 3 文字以上にした形での再検索を推奨します`;
const noteShortFilter = (w: string) =>
  `"${w}" は 3 文字未満のため FTS5 (trigram) の索引に乗りません。3 文字以上の語で全文検索したうえで、本文に "${w}" を含むものに絞り込みました`;
const noteOneChar = (w: string) => `"${w}" は 1 文字のため検索条件から外しました`;
const noteAliasExpanded = (alias: string, formal: string) =>
  `"${alias}" を含む文書は見つかりませんでした。略称辞書で "${alias}" は ${formal} の通称として登録されているため、"${formal}" を含む文書に広げて検索しました。"${formal}" という語が出てくるだけの文書も含まれます`;

/** 通称の展開の文に共通して入る部分（016 で「入らない」ことを確かめる） */
const ALIAS_NOTE_MARKER = '通称として登録されているため';
const EXPANDED_REASON_PREFIX = 'abbreviation expanded:';

function hasNote(notes: string[] | undefined, expected: string): boolean {
  return (notes ?? []).some((n) => n.includes(expected));
}

/* -------------------------------------------------------------------------- */
/* 文書系 5 ツール                                                             */
/* -------------------------------------------------------------------------- */

interface DocResult {
  docId: string;
  title?: string;
  snippet?: string;
  score?: number;
  scoreReasons?: string[];
}
interface DocSearchResponse {
  code?: string;
  results?: DocResult[];
  search_notes?: string[];
}

type DocSearchArgs = { keyword: string; taxonomy?: string; topic?: string };

interface DocTool {
  tool: string;
  docType: string;
  /** 税目の絞り込みに使う引数の名前（タックスアンサーには無い） */
  filterArg?: 'taxonomy' | 'topic';
  /** proposal.md の表で SPEC-NTA-SEARCH-RULES-009 を受けるか */
  covers009: boolean;
  call: (args: DocSearchArgs, dbPath: string) => Promise<unknown>;
}

const DOC_TOOLS: DocTool[] = [
  {
    tool: 'nta_search_bunshokaitou',
    docType: 'bunshokaitou',
    filterArg: 'taxonomy',
    covers009: false,
    call: (args, dbPath) => handleNtaSearchBunshokaitou(args, { dbPath }),
  },
  {
    tool: 'nta_search_jimu_unei',
    docType: 'jimu-unei',
    filterArg: 'taxonomy',
    covers009: true,
    call: (args, dbPath) => handleNtaSearchJimuUnei(args, { dbPath }),
  },
  {
    tool: 'nta_search_kaisei_tsutatsu',
    docType: 'kaisei',
    filterArg: 'taxonomy',
    covers009: true,
    call: (args, dbPath) => handleNtaSearchKaiseiTsutatsu(args, { dbPath }),
  },
  {
    tool: 'nta_search_qa',
    docType: 'qa-jirei',
    filterArg: 'topic',
    covers009: true,
    call: (args, dbPath) => handleNtaSearchQa(args, { dbPath }),
  },
  {
    tool: 'nta_search_tax_answer',
    docType: 'tax-answer',
    covers009: true,
    call: (args, dbPath) => handleNtaSearchTaxAnswer(args, { dbPath }),
  },
];

/**
 * 各種別に同じ内容の文書を入れる。キーは docId の末尾に使う。
 *
 * - yakuin: 題名・本文に「役員」（3 文字以上の語は「退職給与」を含まない）
 * - uchikiri: 「退職給与」と「役員」の両方（税目は shotoku）
 * - tanaoroshi: どちらも含まない
 * - shiharai: 「退職給与」だけ（「役員」「社宅」「税」を含まない）
 * - shokitsu: 「消費税法基本通達」だけ（「消基通」を含まない）
 * - menjo: 「消費税法」だけ
 * - tekikaku: 「適格請求書発行事業者」だけ（「消費税法」を含まない）
 * - court: 差し替えた項目の正式名（COURT_FORMAL）だけ
 * - shuzei: 「酒税法」
 */
const DOC_SEED: Array<[key: string, taxonomy: string, title: string, body: string]> = [
  ['yakuin', 'hojin', '役員の範囲', 'ああああ役員いいいい。経営に従事している者を含む。'],
  [
    'uchikiri',
    'shotoku',
    '退職給与の打切支給',
    '退職給与の打切支給について、役員の分掌変更の場合の取扱いを示す。',
  ],
  ['tanaoroshi', 'hojin', '棚卸資産の販売', '棚卸資産の販売について示す。'],
  ['shiharai', 'hojin', '退職給与の支払時期', '退職給与の支払時期を定める。'],
  ['shokitsu', 'hojin', '基本通達の定め', '消費税法基本通達の定めにより取り扱う。'],
  ['menjo', 'hojin', '小規模事業者の納税義務', '消費税法の小規模事業者に係る納税義務の免除。'],
  ['tekikaku', 'hojin', '登録を受けた事業者', '適格請求書発行事業者の登録を受けた者の取扱い。'],
  ['court', 'hojin', '判例の参照', `${COURT_FORMAL}に掲げる事案の取扱い。`],
  ['shuzei', 'hojin', '酒類の取扱い', '酒税法に規定する酒類の取扱い。'],
];

function docIdOf(docType: string, taxonomy: string, key: string): string {
  if (docType === 'qa-jirei') return `${taxonomy}/01/${key}`;
  return `${docType}-${key}`;
}

function seedDocuments(dbPath: string): void {
  const db = new Database(dbPath);
  initSchema(db);
  const stmt = db.prepare(
    `INSERT INTO document(doc_type, doc_id, taxonomy, title, source_url, fetched_at, full_text, attached_pdfs_json, content_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, '[]', NULL)`
  );
  const now = new Date().toISOString();
  for (const { docType } of DOC_TOOLS) {
    for (const [key, taxonomy, title, body] of DOC_SEED) {
      const docId = docIdOf(docType, taxonomy, key);
      stmt.run(docType, docId, taxonomy, title, `https://x/${docType}/${key}.htm`, now, body);
    }
  }
  db.close();
}

describe('文書系 5 ツールの応答でのキーワードの扱い（20260927-search-keyword-rules）', () => {
  let dir: string;
  let dbPath: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'houki-nta-spec-keyword-rules-doc-'));
    dbPath = join(dir, 'cache.db');
    seedDocuments(dbPath);
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  for (const t of DOC_TOOLS) {
    const id = (key: string, taxonomy = 'hojin') => docIdOf(t.docType, taxonomy, key);
    const search = async (args: DocSearchArgs) => (await t.call(args, dbPath)) as DocSearchResponse;

    describe(`${t.tool}`, () => {
      it(`SPEC-NTA-SEARCH-RULES-003 ${t.tool} の応答: 2 文字の語だけのときは本文と題名の部分一致で探し、snippet で語を <b> で囲み、scoreReasons に short token search を入れる`, async () => {
        const r = await search({ keyword: '役員' });
        expect(r.code).toBeUndefined();
        const ids = (r.results ?? []).map((x) => x.docId).sort();
        expect(ids).toEqual([id('uchikiri', 'shotoku'), id('yakuin')].sort());
        const yakuin = r.results?.find((x) => x.docId === id('yakuin'));
        expect(yakuin?.snippet).toContain('<b>役員</b>');
        for (const x of r.results ?? []) {
          expect(x.scoreReasons).toContain('short token search (LIKE, no FTS rank): 役員');
        }
      });

      if (t.filterArg) {
        const filterArg = t.filterArg;
        it(`SPEC-NTA-SEARCH-RULES-003 ${t.tool} の応答: 2 文字の語だけのときも ${filterArg} の絞り込みが効く`, async () => {
          const r = await search({ keyword: '役員', [filterArg]: 'hojin' });
          expect((r.results ?? []).map((x) => x.docId)).toEqual([id('yakuin')]);
        });
      }

      it(`SPEC-NTA-SEARCH-RULES-003 ${t.tool} の応答: % や _ は文字そのものとして探す（含む文書が無ければ 0 件）`, async () => {
        const pct = await search({ keyword: '%%' });
        expect(pct.results ?? []).toEqual([]);
        const under = await search({ keyword: '__' });
        expect(under.results ?? []).toEqual([]);
      });

      it(`SPEC-NTA-SEARCH-RULES-004 ${t.tool} の応答: 3 文字以上の語と 2 文字の語が混ざるときは、全文検索の結果を 2 文字の語で絞り込み、scoreReasons に short token filter を入れる`, async () => {
        const r = await search({ keyword: '退職給与 役員' });
        expect(r.code).toBeUndefined();
        expect((r.results ?? []).map((x) => x.docId)).toEqual([id('uchikiri', 'shotoku')]);
        expect(r.results?.[0]?.scoreReasons).toContain('short token filter (LIKE): 役員');
      });

      it(`SPEC-NTA-SEARCH-RULES-004 ${t.tool} の応答: 2 文字の語を含まない文書は絞り込みで落ちる（AND）`, async () => {
        const r = await search({ keyword: '退職給与 社宅' });
        expect(r.results ?? []).toEqual([]);
      });

      it(`SPEC-NTA-SEARCH-RULES-005 ${t.tool} の応答: 1 文字の語は検索条件から外す（「退職給与 税」は「退職給与」だけで探す）`, async () => {
        const r = await search({ keyword: '退職給与 税' });
        const ids = (r.results ?? []).map((x) => x.docId).sort();
        expect(ids).toEqual([id('shiharai'), id('uchikiri', 'shotoku')].sort());
      });

      it(`SPEC-NTA-SEARCH-RULES-005 ${t.tool} の応答: 1 文字の語しか無いときは検索せず 0 件`, async () => {
        const r = await search({ keyword: '税' });
        expect(r.results ?? []).toEqual([]);
      });

      it(`SPEC-NTA-SEARCH-RULES-006 ${t.tool} の応答: 2 文字の語だけのときの search_notes の文`, async () => {
        const r = await search({ keyword: '役員' });
        expect(hasNote(r.search_notes, noteShortOnly('役員'))).toBe(true);
      });

      it(`SPEC-NTA-SEARCH-RULES-006 ${t.tool} の応答: 2 文字の語だけで 0 件のときも search_notes を付ける`, async () => {
        const r = await search({ keyword: '社宅' });
        expect(r.results ?? []).toEqual([]);
        expect(hasNote(r.search_notes, noteShortOnly('社宅'))).toBe(true);
      });

      it(`SPEC-NTA-SEARCH-RULES-006 ${t.tool} の応答: 3 文字以上の語と 2 文字の語が混ざるときの search_notes の文`, async () => {
        const r = await search({ keyword: '退職給与 役員' });
        expect(hasNote(r.search_notes, noteShortFilter('役員'))).toBe(true);
      });

      it(`SPEC-NTA-SEARCH-RULES-006 ${t.tool} の応答: 1 文字の語を外したときの search_notes の文`, async () => {
        const r = await search({ keyword: '退職給与 税' });
        expect(hasNote(r.search_notes, noteOneChar('税'))).toBe(true);
      });

      it(`SPEC-NTA-SEARCH-RULES-006 ${t.tool} の応答: 1 文字の語だけで 0 件のときも search_notes を付ける`, async () => {
        const r = await search({ keyword: '税' });
        expect(hasNote(r.search_notes, noteOneChar('税'))).toBe(true);
      });

      it(`SPEC-NTA-SEARCH-RULES-006 ${t.tool} の応答: 2 文字の語が複数あるときは "語1" / "語2" と並べる`, async () => {
        const r = await search({ keyword: '役員 分掌' });
        expect((r.results ?? []).map((x) => x.docId)).toEqual([id('uchikiri', 'shotoku')]);
        expect(hasNote(r.search_notes, '"役員" / "分掌"')).toBe(true);
      });

      it(`SPEC-NTA-SEARCH-RULES-006 ${t.tool} の応答: 語がすべて 3 文字以上で展開も索引から消えた文書も無いときは search_notes を付けない`, async () => {
        const r = await search({ keyword: '経営に従事' });
        expect((r.results ?? []).map((x) => x.docId)).toEqual([id('yakuin')]);
        expect(r.search_notes).toBeUndefined();
      });

      if (t.covers009) {
        it(`SPEC-NTA-SEARCH-RULES-009 ${t.tool} の応答: 略称そのもの（消基通）は正式名も含めて探し、scoreReasons に abbreviation expanded を入れ、search_notes には書かない`, async () => {
          const r = await search({ keyword: '消基通' });
          expect(r.code).toBeUndefined();
          const hit = r.results?.find((x) => x.docId === id('shokitsu'));
          expect(hit).toBeDefined();
          expect(hit?.scoreReasons).toContain('abbreviation expanded: 消基通 → 消費税法基本通達');
          expect(hasNote(r.search_notes, ALIAS_NOTE_MARKER)).toBe(false);
        });
      }

      it(`SPEC-NTA-SEARCH-RULES-010 ${t.tool} の応答: 通称で元の語が当たるときは広げない（適格請求書発行事業者）`, async () => {
        const r = await search({ keyword: '適格請求書発行事業者' });
        expect((r.results ?? []).map((x) => x.docId)).toEqual([id('tekikaku')]);
        expect(r.search_notes).toBeUndefined();
      });

      it(`SPEC-NTA-SEARCH-RULES-010 ${t.tool} の応答: 通称で元の語が 0 件のときは正式名に広げ、search_notes と scoreReasons に書く（インボイス → 消費税法）`, async () => {
        const r = await search({ keyword: 'インボイス' });
        const ids = (r.results ?? []).map((x) => x.docId);
        expect(ids).toContain(id('menjo'));
        expect(ids).not.toContain(id('tekikaku'));
        expect(hasNote(r.search_notes, noteAliasExpanded('インボイス', '消費税法'))).toBe(true);
        const menjo = r.results?.find((x) => x.docId === id('menjo'));
        expect(menjo?.scoreReasons).toContain('abbreviation expanded: インボイス → 消費税法');
      });

      it(`SPEC-NTA-SEARCH-RULES-016 ${t.tool} の応答: 管轄が houki-court の項目の通称は広げない（abbreviation expanded: と通称の展開の文が無い）`, async () => {
        const r = await search({ keyword: COURT_ALIAS });
        expect((r.results ?? []).map((x) => x.docId)).not.toContain(id('court'));
        for (const x of r.results ?? []) {
          expect((x.scoreReasons ?? []).some((s) => s.startsWith(EXPANDED_REASON_PREFIX))).toBe(
            false
          );
        }
        expect(hasNote(r.search_notes, ALIAS_NOTE_MARKER)).toBe(false);
      });

      it(`SPEC-NTA-SEARCH-RULES-016 ${t.tool} の応答: 正式名が keyword と同じ項目（酒税法）は広げない`, async () => {
        const r = await search({ keyword: '酒税法' });
        const hit = r.results?.find((x) => x.docId === id('shuzei'));
        expect(hit).toBeDefined();
        for (const x of r.results ?? []) {
          expect((x.scoreReasons ?? []).some((s) => s.startsWith(EXPANDED_REASON_PREFIX))).toBe(
            false
          );
        }
      });
    });
  }
});

/* -------------------------------------------------------------------------- */
/* nta_search_tsutatsu                                                         */
/* -------------------------------------------------------------------------- */

interface TsutatsuHit {
  clauseNumber: string;
  snippet?: string;
  scoreReasons?: string[];
}
interface TsutatsuSearchResponse {
  code?: string;
  count?: number;
  hits?: TsutatsuHit[];
  search_notes?: string[];
}

const CLAUSE_SEED: Array<[clause: string, title: string, body: string]> = [
  [
    '9-2-1',
    '役員の範囲',
    '役員の範囲\n法第2条第15号に規定する役員には、経営に従事している者が含まれる。',
  ],
  ['9-2-32', '退職給与の打切支給', '退職給与の打切支給\n役員の分掌変更の場合の取扱い。'],
  ['9-2-35', '退職給与の支払時期', '退職給与の支払時期を定める。'],
  ['2-1-1', '棚卸資産の販売', '棚卸資産の販売について示す。'],
  ['11-1-1', '課税仕入と売上高', '課税仕入の額と売上高の関係について示す。'],
  ['11-1-2', '課税仕入のみ', '課税仕入の額について示す。'],
  ['12-1-1', '基本通達の定め', '消費税法基本通達の定めにより取り扱う。'],
  ['12-1-2', '酒類の取扱い', '酒税法に規定する酒類の取扱い。'],
  ['12-1-3', '判例の参照', `${COURT_FORMAL}に掲げる事案の取扱い。`],
  ['12-1-4', '口座の取扱い', 'NISA口座の取扱い。'],
];

function seedClauses(dbPath: string): void {
  const db = new Database(dbPath);
  initSchema(db);
  const tsutatsuId = (
    db
      .prepare(
        `INSERT INTO tsutatsu(formal_name, abbr, source_root_url) VALUES (?, ?, ?) RETURNING id`
      )
      .get('法人税基本通達', '法基通', 'https://x/') as { id: number }
  ).id;
  const stmt = db.prepare(
    `INSERT INTO clause(tsutatsu_id, clause_number, source_url, chapter_number, section_number, title, full_text, paragraphs_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, '[]')`
  );
  for (const [clause, title, body] of CLAUSE_SEED) {
    const [chapter, section] = clause.split('-').map(Number);
    stmt.run(tsutatsuId, clause, `https://x/${clause}.htm`, chapter, section, title, body);
  }
  db.close();
}

describe('nta_search_tsutatsu の応答でのキーワードの扱い（20260927-search-keyword-rules）', () => {
  let dir: string;
  let dbPath: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'houki-nta-spec-keyword-rules-tsutatsu-'));
    dbPath = join(dir, 'cache.db');
    seedClauses(dbPath);
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const search = async (keyword: string) =>
    (await searchTsutatsu({ keyword }, { dbPath })) as TsutatsuSearchResponse;
  const clauses = (r: TsutatsuSearchResponse) => (r.hits ?? []).map((h) => h.clauseNumber).sort();

  it('SPEC-NTA-SEARCH-RULES-001 nta_search_tsutatsu の応答: 空白で区切った語をすべて含む条項だけを返す', async () => {
    expect(clauses(await search('課税仕入 売上高'))).toEqual(['11-1-1']);
  });

  it('SPEC-NTA-SEARCH-RULES-001 nta_search_tsutatsu の応答: 全角の空白・連続した空白も区切りとして扱う', async () => {
    expect(clauses(await search('課税仕入　売上高'))).toEqual(['11-1-1']);
    expect(clauses(await search('課税仕入   売上高'))).toEqual(['11-1-1']);
  });

  it('SPEC-NTA-SEARCH-RULES-001 nta_search_tsutatsu の応答: 記号 " * : ( ) は語の区切りとして扱う', async () => {
    const r = await search('"課税仕入"*:()売上高');
    expect(r.code).toBeUndefined();
    expect(clauses(r)).toEqual(['11-1-1']);
  });

  it('SPEC-NTA-SEARCH-RULES-001 nta_search_tsutatsu の応答: 2 文字の語が混ざるときも AND（「退職給与 役員」は当たり、「退職給与 社宅」は 0 件）', async () => {
    expect(clauses(await search('退職給与 役員'))).toEqual(['9-2-32']);
    const none = await search('退職給与 社宅');
    expect(none.hits).toEqual([]);
  });

  it('SPEC-NTA-SEARCH-RULES-005 nta_search_tsutatsu の応答: 1 文字の語は検索条件から外す（「退職給与 税」は「退職給与」だけで探す）', async () => {
    expect(clauses(await search('退職給与 税'))).toEqual(['9-2-32', '9-2-35']);
  });

  it('SPEC-NTA-SEARCH-RULES-005 nta_search_tsutatsu の応答: 1 文字の語しか無いときは 0 件', async () => {
    const r = await search('税');
    expect(r.hits).toEqual([]);
  });

  it('SPEC-NTA-SEARCH-RULES-006 nta_search_tsutatsu の応答: 1 文字の語を外したときは search_notes に書く', async () => {
    const r = await search('退職給与 税');
    expect(hasNote(r.search_notes, noteOneChar('税'))).toBe(true);
  });

  it('SPEC-NTA-SEARCH-RULES-006 nta_search_tsutatsu の応答: 1 文字の語だけで 0 件のときも search_notes に書く', async () => {
    const r = await search('税');
    expect(hasNote(r.search_notes, noteOneChar('税'))).toBe(true);
  });

  it('SPEC-NTA-SEARCH-RULES-008 nta_search_tsutatsu の応答: キーワードの全角の英字も揃えてから探す（ＮＩＳＡ → nisa）', async () => {
    expect(clauses(await search('ＮＩＳＡ'))).toEqual(['12-1-4']);
  });

  it('SPEC-NTA-SEARCH-RULES-009 nta_search_tsutatsu の応答: 略称そのもの（消基通）は正式名も含めて探し、scoreReasons に abbreviation expanded を入れ、search_notes には書かない', async () => {
    const r = await search('消基通');
    const hit = r.hits?.find((h) => h.clauseNumber === '12-1-1');
    expect(hit).toBeDefined();
    expect(hit?.scoreReasons).toContain('abbreviation expanded: 消基通 → 消費税法基本通達');
    expect(hasNote(r.search_notes, ALIAS_NOTE_MARKER)).toBe(false);
  });

  it('SPEC-NTA-SEARCH-RULES-009 nta_search_tsutatsu の応答: 辞書に無い語は広げない', async () => {
    const r = await search('経営に従事');
    expect(clauses(r)).toEqual(['9-2-1']);
    for (const h of r.hits ?? []) {
      expect((h.scoreReasons ?? []).some((s) => s.startsWith(EXPANDED_REASON_PREFIX))).toBe(false);
    }
  });

  it('SPEC-NTA-SEARCH-RULES-016 nta_search_tsutatsu の応答: 管轄が houki-court の項目の通称は広げない（abbreviation expanded: と通称の展開の文が無い）', async () => {
    const r = await search(COURT_ALIAS);
    expect(clauses(r)).not.toContain('12-1-3');
    for (const h of r.hits ?? []) {
      expect((h.scoreReasons ?? []).some((s) => s.startsWith(EXPANDED_REASON_PREFIX))).toBe(false);
    }
    expect(hasNote(r.search_notes, ALIAS_NOTE_MARKER)).toBe(false);
  });

  it('SPEC-NTA-SEARCH-RULES-016 nta_search_tsutatsu の応答: 正式名が keyword と同じ項目（酒税法）は広げない', async () => {
    const r = await search('酒税法');
    expect(clauses(r)).toEqual(['12-1-2']);
    for (const h of r.hits ?? []) {
      expect((h.scoreReasons ?? []).some((s) => s.startsWith(EXPANDED_REASON_PREFIX))).toBe(false);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* nta_search_tsutatsu: 国税庁サイトから取って DB に入れた条項の揃え方（007・008） */
/* -------------------------------------------------------------------------- */

const fixturesDir = resolve(import.meta.dirname ?? __dirname, '../../tests/fixtures');

function sjisHtmlResponse(fixtureName: string): Response {
  const html = readFileSync(resolve(fixturesDir, fixtureName), 'utf8');
  return new Response(iconvEncode(html, 'shift_jis'), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=Shift_JIS' },
  });
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** 国税庁サイトの存在しないページ（302 で /error/404.htm へ転送され、転送先は 200） */
function ntaRedirectTo404Response(init?: RequestInit): Response {
  const errorPageUrl = 'https://www.nta.go.jp/error/404.htm';
  if (init?.redirect === 'manual') {
    return new Response(null, { status: 302, headers: { Location: errorPageUrl } });
  }
  const res = new Response(
    '<html><head><title>ページが見つかりません</title></head><body><p>お探しのページは見つかりませんでした。</p></body></html>',
    { status: 200, headers: { 'Content-Type': 'text/html; charset=UTF-8' } }
  );
  Object.defineProperty(res, 'url', { value: errorPageUrl });
  Object.defineProperty(res, 'redirected', { value: true });
  return res;
}

const NTA_PAGES: Record<string, string> = {
  '/law/tsutatsu/kihon/shohi/05/01.htm': 'www.nta.go.jp_law_tsutatsu_kihon_shohi_05_01.htm',
  '/law/tsutatsu/kihon/shohi/01.htm': 'www.nta.go.jp_law_tsutatsu_kihon_shohi_01.htm',
  '/law/tsutatsu/kihon/hojin/01.htm': 'www.nta.go.jp_law_tsutatsu_kihon_hojin_01.htm',
  '/law/tsutatsu/kihon/shotoku/01.htm': 'www.nta.go.jp_law_tsutatsu_kihon_shotoku_01.htm',
  '/law/tsutatsu/kihon/sisan/sozoku2/01.htm':
    'www.nta.go.jp_law_tsutatsu_kihon_sisan_sozoku2_01.htm',
};

const ntaFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const fixture = NTA_PAGES[new URL(requestUrl(input)).pathname];
  return fixture ? sjisHtmlResponse(fixture) : ntaRedirectTo404Response(init);
}) as unknown as typeof fetch;

describe('nta_search_tsutatsu の応答: 国税庁サイトの全角の文字を揃えて DB に入れ、キーワードも揃えて探す', () => {
  let dir: string;
  let dbPath: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'houki-nta-spec-keyword-rules-normalize-'));
    dbPath = join(dir, 'cache.db');
    // 消基通 5-1-9 を国税庁サイト（フィクスチャー）から取り、節の条項を DB に書き戻させる。
    // フィクスチャーの 5-1-9 の本文には全角のハイフンを含む「リ－ス期間」がある
    const r = (await getTsutatsu(
      { name: '消基通', clause: '5-1-9', format: 'json' },
      { fetchImpl: ntaFetch, dbPath }
    )) as { code?: string; clause?: { clauseNumber: string } };
    expect(r.code).toBeUndefined();
    expect(r.clause?.clauseNumber).toBe('5-1-9');
  }, 60_000);
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('SPEC-NTA-SEARCH-RULES-007 nta_search_tsutatsu の応答: DB に入れた本文の全角ハイフンは半角になっている（半角の「リ-ス期間」で当たる）', async () => {
    const r = (await searchTsutatsu(
      { keyword: 'リ-ス期間' },
      { dbPath }
    )) as TsutatsuSearchResponse;
    expect(r.code).toBeUndefined();
    expect((r.hits ?? []).map((h) => h.clauseNumber)).toContain('5-1-9');
  });

  it('SPEC-NTA-SEARCH-RULES-008 nta_search_tsutatsu の応答: キーワードの全角のハイフン・空白も揃えてから探す（「リ－ス期間」「リ－ス期間　賃貸借」）', async () => {
    const r1 = (await searchTsutatsu(
      { keyword: 'リ－ス期間' },
      { dbPath }
    )) as TsutatsuSearchResponse;
    expect((r1.hits ?? []).map((h) => h.clauseNumber)).toContain('5-1-9');
    const r2 = (await searchTsutatsu(
      { keyword: 'リ－ス期間　賃貸借' },
      { dbPath }
    )) as TsutatsuSearchResponse;
    expect((r2.hits ?? []).map((h) => h.clauseNumber)).toContain('5-1-9');
  });
});
