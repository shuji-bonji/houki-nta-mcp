/**
 * 差分 specs/changes/20261003-search-rules/（PR #133）の受入テスト。
 *
 * - ADDED: SPEC-NTA-SEARCH-RULES-021（英字の大文字と小文字は、どの探し方でも区別しない）
 * - MODIFIED: SPEC-NTA-SEARCH-RULES-003・004・006・009
 * - ADDED: SPEC-NTA-SEARCH-QA-010（domain は受け付けない）
 *
 * 期待値は差分の spec.md と proposal.md の本文と「例:」から決めている。
 * 検索系 6 ツール（文書系 5 ツールと nta_search_tsutatsu）で同じ規則を確かめる。
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initSchema } from '../db/schema.js';
import { tools } from './definitions.js';
import {
  handleNtaSearchBunshokaitou,
  handleNtaSearchJimuUnei,
  handleNtaSearchKaiseiTsutatsu,
  handleNtaSearchQa,
  handleNtaSearchTaxAnswer,
  searchTsutatsu,
  toolHandlers,
} from './handlers.js';

/* -------------------------------------------------------------------------- */
/* 期待する search_notes の文（SPEC-NTA-SEARCH-RULES-006）                     */
/* -------------------------------------------------------------------------- */

const noteShortOnly = (w: string) =>
  `"${w}" は 3 文字未満のため FTS5 (trigram) では検索できません。代わりに本文とタイトルの部分一致 (LIKE) で検索しました。0 件でも「該当なし」とは限らないので、"${w}" に語を続けて 3 文字以上にした形での再検索を推奨します`;
const noteShortFilter = (w: string) =>
  `"${w}" は 3 文字未満のため FTS5 (trigram) の索引に乗りません。3 文字以上の語で全文検索したうえで、本文に "${w}" を含むものに絞り込みました`;
const noteOneChar = (w: string) => `"${w}" は 1 文字のため検索条件から外しました`;
const noteTwoCharAbbr = (abbr: string, formal: string, how: string) =>
  `"${abbr}" は 3 文字未満のため FTS5 (trigram) では検索できません。"${abbr}" は本文とタイトルの部分一致 (LIKE) で、正式名 "${formal}" は${how}で探し、どちらかを含むものを返しました`;
const noteOneCharAbbr = (abbr: string, formal: string, how: string) =>
  `"${abbr}" は 1 文字のため検索条件から外し、正式名 "${formal}" を${how}で探しました`;

/**
 * 差分の例: `"消法" は 3 文字未満のため … 正式名 "消費税法" は全文検索で探し、…`
 * `"民" は 1 文字のため検索条件から外し、正式名 "民法" を部分一致 (LIKE) で探しました`
 */
const BY_FTS = '全文検索';
const BY_LIKE = '部分一致 (LIKE) ';

/* -------------------------------------------------------------------------- */
/* 入れる文書                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * - qrcode: 題名・本文に大文字の「QRコード」（v0.23.0 の 1119 と同じ形）
 * - dx: 本文に「DX 投資促進税制」（差分 021 の例）
 * - shohou: 本文に「消費税法」だけ（#80 の例の A）
 * - shoho: 本文に「消法」だけで「消費税法」を含まない（#80 の例の B）
 * - both: 「消法」と「消費税法」の両方
 * - minpo: 本文に「民法」
 * - hasan: 本文に「破産法」
 * - shokitsuOnly: 本文に「消基通」だけで正式名「消費税法基本通達」を含まない
 * - shokitsuFormal: 本文に正式名「消費税法基本通達」だけ
 */
const SEED: Array<[key: string, title: string, body: string]> = [
  ['qrcode', '医療費控除に関する手続について', 'QRコード付控除証明書を添付して提出できます。'],
  ['dx', '設備投資の特例', 'DX 投資促進税制の概要を示す。'],
  ['shohou', '小規模事業者の納税義務', '消費税法の規定により納税義務が免除される。'],
  ['shoho', '仕入税額控除の要件', '消法第30条第7項に規定する帳簿の保存について。'],
  ['both', '課税資産の譲渡等', '消法第2条第1項第8号（消費税法の定義規定）による。'],
  ['minpo', '契約の成立', '民法第522条の規定により契約が成立する。'],
  ['hasan', '破産手続の開始', '破産法の規定による破産手続開始の決定。'],
  ['shokitsuOnly', '略称だけの文書', '消基通5-1-9の取扱いによる。'],
  ['shokitsuFormal', '正式名だけの文書', '消費税法基本通達の定めにより取り扱う。'],
];

type DocTypeName = 'kaisei' | 'jimu-unei' | 'bunshokaitou' | 'tax-answer' | 'qa-jirei';

function docIdOf(docType: DocTypeName, key: string): string {
  if (docType === 'qa-jirei') return `shohi/01/${key}`;
  return `${docType}-${key}`;
}

interface DocResult {
  docId: string;
  snippet?: string;
  scoreReasons?: string[];
}
interface DocSearchResponse {
  code?: string;
  results?: DocResult[];
  search_notes?: string[];
}

interface SearchTool {
  tool: string;
  /** 結果の要素を、SEED のキーで引けるようにする */
  idOf: (key: string) => string;
  search: (keyword: string, dbPath: string) => Promise<{ items: DocResult[]; notes?: string[] }>;
}

function docTool(
  tool: string,
  docType: DocTypeName,
  handler: (args: { keyword: string }, opts: { dbPath: string }) => Promise<unknown>
): SearchTool {
  return {
    tool,
    idOf: (key) => docIdOf(docType, key),
    search: async (keyword, dbPath) => {
      const r = (await handler({ keyword }, { dbPath })) as DocSearchResponse;
      return { items: r.results ?? [], notes: r.search_notes };
    },
  };
}

interface TsutatsuHit {
  clauseNumber: string;
  snippet?: string;
  scoreReasons?: string[];
}

/** 条項番号は SEED の並び順から作る（1-1-<順番>） */
const clauseOf = (key: string) => `1-1-${SEED.findIndex(([k]) => k === key) + 1}`;

const SEARCH_TOOLS: SearchTool[] = [
  docTool('nta_search_kaisei_tsutatsu', 'kaisei', handleNtaSearchKaiseiTsutatsu),
  docTool('nta_search_jimu_unei', 'jimu-unei', handleNtaSearchJimuUnei),
  docTool('nta_search_bunshokaitou', 'bunshokaitou', handleNtaSearchBunshokaitou),
  docTool('nta_search_tax_answer', 'tax-answer', handleNtaSearchTaxAnswer),
  docTool('nta_search_qa', 'qa-jirei', handleNtaSearchQa),
  {
    tool: 'nta_search_tsutatsu',
    idOf: clauseOf,
    search: async (keyword, dbPath) => {
      const r = (await searchTsutatsu({ keyword }, { dbPath })) as {
        hits?: TsutatsuHit[];
        search_notes?: string[];
      };
      return {
        items: (r.hits ?? []).map((h) => ({
          docId: h.clauseNumber,
          snippet: h.snippet,
          scoreReasons: h.scoreReasons,
        })),
        notes: r.search_notes,
      };
    },
  },
];

function seed(dbPath: string): void {
  const db = new Database(dbPath);
  initSchema(db);
  const docStmt = db.prepare(
    `INSERT INTO document(doc_type, doc_id, taxonomy, title, source_url, fetched_at, full_text, attached_pdfs_json, content_hash)
     VALUES (?, ?, 'shohi', ?, ?, ?, ?, '[]', NULL)`
  );
  const now = new Date().toISOString();
  const docTypes: DocTypeName[] = ['kaisei', 'jimu-unei', 'bunshokaitou', 'tax-answer', 'qa-jirei'];
  for (const docType of docTypes) {
    for (const [key, title, body] of SEED) {
      docStmt.run(
        docType,
        docIdOf(docType, key),
        title,
        `https://x/${docType}/${key}.htm`,
        now,
        body
      );
    }
  }
  const tsutatsuId = (
    db
      .prepare(
        `INSERT INTO tsutatsu(formal_name, abbr, source_root_url) VALUES (?, ?, ?) RETURNING id`
      )
      .get('法人税基本通達', '法基通', 'https://x/') as { id: number }
  ).id;
  const clauseStmt = db.prepare(
    `INSERT INTO clause(tsutatsu_id, clause_number, source_url, chapter_number, section_number, title, full_text, paragraphs_json)
     VALUES (?, ?, ?, 1, 1, ?, ?, '[]')`
  );
  for (const [key, title, body] of SEED) {
    clauseStmt.run(tsutatsuId, clauseOf(key), `https://x/${key}.htm`, title, body);
  }
  db.close();
}

const has = (notes: string[] | undefined, expected: string) => (notes ?? []).includes(expected);

describe('検索系 6 ツールの英字の大文字と小文字・3 文字未満の略称（20261003-search-rules）', () => {
  let dir: string;
  let dbPath: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'houki-nta-spec-search-rules-'));
    dbPath = join(dir, 'cache.db');
    seed(dbPath);
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  for (const t of SEARCH_TOOLS) {
    const ids = async (keyword: string) =>
      (await t.search(keyword, dbPath)).items.map((x) => x.docId).sort();

    describe(t.tool, () => {
      /* ------------------------------ #81 ------------------------------ */

      it(`SPEC-NTA-SEARCH-RULES-021 SPEC-NTA-SEARCH-RULES-004 ${t.tool}: "QR コード" は本文の大文字の QR を含む文書を返す（v0.23.0 では 0 件）`, async () => {
        expect(await ids('QR コード')).toEqual([t.idOf('qrcode')]);
      });

      it(`SPEC-NTA-SEARCH-RULES-021 SPEC-NTA-SEARCH-RULES-004 ${t.tool}: 2 文字の語の絞り込みは qr・Qr でも大文字の QR に当たる`, async () => {
        expect(await ids('qr コード')).toEqual([t.idOf('qrcode')]);
        expect(await ids('Qr コード')).toEqual([t.idOf('qrcode')]);
      });

      it(`SPEC-NTA-SEARCH-RULES-021 ${t.tool}: "DX 投資促進税制"・"dx 投資促進税制"・"ＤＸ 投資促進税制" のどれでも同じ文書が当たる`, async () => {
        const expected = [t.idOf('dx')];
        expect(await ids('DX 投資促進税制')).toEqual(expected);
        expect(await ids('dx 投資促進税制')).toEqual(expected);
        expect(await ids('ＤＸ 投資促進税制')).toEqual(expected);
      });

      it(`SPEC-NTA-SEARCH-RULES-021 SPEC-NTA-SEARCH-RULES-003 ${t.tool}: 2 文字の英字の語だけのときも大文字と小文字を区別せずに当て、snippet の <b> は本文の表記のまま（"qr" → <b>QR</b>コード）`, async () => {
        const r = await t.search('qr', dbPath);
        expect(r.items.map((x) => x.docId)).toEqual([t.idOf('qrcode')]);
        expect(r.items[0]?.snippet).toContain('<b>QR</b>コード');
      });

      it(`SPEC-NTA-SEARCH-RULES-003 ${t.tool}: scoreReasons の short token search の語は渡した表記（"QR"）`, async () => {
        const r = await t.search('QR', dbPath);
        expect(r.items[0]?.scoreReasons).toContain('short token search (LIKE, no FTS rank): QR');
      });

      it(`SPEC-NTA-SEARCH-RULES-004 ${t.tool}: scoreReasons の short token filter の語は渡した表記（"DX" と "dx"）`, async () => {
        const upper = await t.search('DX 投資促進税制', dbPath);
        expect(upper.items[0]?.scoreReasons).toContain('short token filter (LIKE): DX');
        const lower = await t.search('dx 投資促進税制', dbPath);
        expect(lower.items[0]?.scoreReasons).toContain('short token filter (LIKE): dx');
      });

      it(`SPEC-NTA-SEARCH-RULES-006 ${t.tool}: search_notes の語は半角に揃えた渡した表記で、大文字と小文字は渡したまま`, async () => {
        expect(has((await t.search('DX 投資促進税制', dbPath)).notes, noteShortFilter('DX'))).toBe(
          true
        );
        expect(
          has((await t.search('ＤＸ 投資促進税制', dbPath)).notes, noteShortFilter('DX'))
        ).toBe(true);
        expect(has((await t.search('dx 投資促進税制', dbPath)).notes, noteShortFilter('dx'))).toBe(
          true
        );
        expect(has((await t.search('QR', dbPath)).notes, noteShortOnly('QR'))).toBe(true);
      });

      it(`SPEC-NTA-SEARCH-RULES-006 ${t.tool}: 1 文字の英字の語も渡した表記で書く（"A" は "a" にしない）`, async () => {
        expect(has((await t.search('QRコード A', dbPath)).notes, noteOneChar('A'))).toBe(true);
      });

      /* ------------------------------ #80 ------------------------------ */

      it(`SPEC-NTA-SEARCH-RULES-009 ${t.tool}: 2 文字の略称 "消法" は、略称だけの文書と正式名だけの文書の両方を返す（v0.23.0 では正式名だけ）`, async () => {
        // shokitsuFormal も本文に「消費税法」（消費税法基本通達）を含むので当たる
        const got = await ids('消法');
        expect(got).toEqual(
          expect.arrayContaining([t.idOf('shohou'), t.idOf('shoho'), t.idOf('both')])
        );
        expect(got).not.toContain(t.idOf('minpo'));
      });

      it(`SPEC-NTA-SEARCH-RULES-009 ${t.tool}: "消法" の scoreReasons は、正式名で当たった要素に abbreviation expanded、略称の部分一致で当たった要素に short token search、両方なら両方`, async () => {
        const { items } = await t.search('消法', dbPath);
        const of = (key: string) => items.find((x) => x.docId === t.idOf(key))?.scoreReasons ?? [];
        const expanded = 'abbreviation expanded: 消法 → 消費税法';
        const like = 'short token search (LIKE, no FTS rank): 消法';
        expect(of('shohou')).toContain(expanded);
        expect(of('shohou')).not.toContain(like);
        expect(of('shoho')).toContain(like);
        expect(of('shoho')).not.toContain(expanded);
        expect(of('both')).toContain(expanded);
        expect(of('both')).toContain(like);
      });

      it(`SPEC-NTA-SEARCH-RULES-009 ${t.tool}: 同じ文書が略称と正式名の両方で当たっても 1 件として返す`, async () => {
        const all = (await t.search('消法', dbPath)).items.map((x) => x.docId);
        expect(all.filter((id) => id === t.idOf('both'))).toHaveLength(1);
      });

      it(`SPEC-NTA-SEARCH-RULES-006 SPEC-NTA-SEARCH-RULES-009 ${t.tool}: "消法" の search_notes は略称と正式名の探し方を書く文 1 つで、2 文字の語だけのときの文は入れない`, async () => {
        const { notes } = await t.search('消法', dbPath);
        expect(notes).toEqual([noteTwoCharAbbr('消法', '消費税法', BY_FTS)]);
        expect(has(notes, noteShortOnly('消法'))).toBe(false);
      });

      it(`SPEC-NTA-SEARCH-RULES-009 ${t.tool}: 1 文字の略称で正式名が 2 文字（"民" → 民法）は、正式名を部分一致で探す（v0.23.0 では常に 0 件）`, async () => {
        expect(await ids('民')).toEqual([t.idOf('minpo')]);
      });

      it(`SPEC-NTA-SEARCH-RULES-006 SPEC-NTA-SEARCH-RULES-009 ${t.tool}: "民" の search_notes は正式名を部分一致で探した文 1 つで、1 文字の語を外した文は入れない`, async () => {
        const { notes } = await t.search('民', dbPath);
        expect(notes).toEqual([noteOneCharAbbr('民', '民法', BY_LIKE)]);
        expect(has(notes, noteOneChar('民'))).toBe(false);
      });

      it(`SPEC-NTA-SEARCH-RULES-009 SPEC-NTA-SEARCH-RULES-006 ${t.tool}: 1 文字の略称で正式名が 3 文字以上（"破" → 破産法）は正式名を全文検索で探し、その旨を書く`, async () => {
        const r = await t.search('破', dbPath);
        expect(r.items.map((x) => x.docId)).toEqual([t.idOf('hasan')]);
        expect(r.items[0]?.scoreReasons).toContain('abbreviation expanded: 破 → 破産法');
        expect(r.notes).toEqual([noteOneCharAbbr('破', '破産法', BY_FTS)]);
      });

      it(`SPEC-NTA-SEARCH-RULES-009 ${t.tool}: 3 文字以上の略称 "消基通" は略称だけの文書と正式名だけの文書の両方を返し、search_notes は付けない`, async () => {
        const r = await t.search('消基通', dbPath);
        expect(r.items.map((x) => x.docId).sort()).toEqual(
          [t.idOf('shokitsuOnly'), t.idOf('shokitsuFormal')].sort()
        );
        expect(r.notes).toBeUndefined();
      });

      it(`SPEC-NTA-SEARCH-RULES-009 ${t.tool}: "消基通" の abbreviation expanded は正式名で当たった要素にだけ付ける`, async () => {
        const { items } = await t.search('消基通', dbPath);
        const of = (key: string) => items.find((x) => x.docId === t.idOf(key))?.scoreReasons ?? [];
        const expanded = 'abbreviation expanded: 消基通 → 消費税法基本通達';
        expect(of('shokitsuFormal')).toContain(expanded);
        expect(of('shokitsuOnly')).not.toContain(expanded);
      });
    });
  }
});

/* -------------------------------------------------------------------------- */
/* nta_search_qa の domain（SPEC-NTA-SEARCH-QA-010）                           */
/* -------------------------------------------------------------------------- */

describe('SPEC-NTA-SEARCH-QA-010 domain は受け付けず、渡すと DB を引かずに INVALID_ARGUMENT を返す', () => {
  let dir: string;
  let saved: string | undefined;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'houki-nta-spec-search-qa-010-'));
    dbPath = join(dir, 'never-created.db');
    saved = process.env.HOUKI_NTA_DB_PATH;
    process.env.HOUKI_NTA_DB_PATH = dbPath;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('国税庁サイトを取りに行ってはいけない');
      })
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (saved === undefined) delete process.env.HOUKI_NTA_DB_PATH;
    else process.env.HOUKI_NTA_DB_PATH = saved;
    rmSync(dir, { recursive: true, force: true });
  });

  interface Body {
    code?: string;
    error?: string;
    tool?: string;
    detail?: { issues?: Array<{ path: string; message: string }> };
  }
  const call = async (args: unknown) => (await toolHandlers.nta_search_qa(args)) as unknown as Body;

  it('SPEC-NTA-SEARCH-QA-010 tools/list の inputSchema の properties に domain は無い', () => {
    const def = tools.find((x) => x.name === 'nta_search_qa');
    expect(def).toBeDefined();
    const schema = def?.inputSchema as { properties?: Record<string, unknown> } | undefined;
    const props = schema?.properties ?? {};
    expect(props).not.toHaveProperty('domain');
    expect(props).toHaveProperty('topic');
  });

  for (const domain of ['tax', 'labor']) {
    it(`SPEC-NTA-SEARCH-QA-010 { keyword: "軽減税率", domain: "${domain}" } は INVALID_ARGUMENT で、DB を引かない`, async () => {
      const r = await call({ keyword: '軽減税率', domain });
      expect(r.code).toBe('INVALID_ARGUMENT');
      expect(r.tool).toBe('nta_search_qa');
      expect(r.error).toBe(
        '引数が tools/list の inputSchema に合いません: domain: inputSchema に無い引数です'
      );
      expect(r.detail?.issues).toEqual([{ path: 'domain', message: 'inputSchema に無い引数です' }]);
      expect(existsSync(dbPath)).toBe(false);
    });
  }

  it('SPEC-NTA-SEARCH-QA-010 { keyword: "軽減税率" } と { keyword: "軽減税率", topic: "shohi" } は今までどおり検索する', async () => {
    const db = new Database(dbPath);
    initSchema(db);
    db.prepare(
      `INSERT INTO document(doc_type, doc_id, taxonomy, title, source_url, fetched_at, full_text, attached_pdfs_json)
       VALUES ('qa-jirei', 'shohi/01/1', 'shohi', '軽減税率の対象', 'https://x/1.htm', ?, '軽減税率の対象となる飲食料品', '[]')`
    ).run(new Date().toISOString());
    db.close();
    for (const args of [{ keyword: '軽減税率' }, { keyword: '軽減税率', topic: 'shohi' }]) {
      const r = (await toolHandlers.nta_search_qa(args)) as unknown as Body & {
        results?: Array<{ docId: string }>;
      };
      expect(r.code).toBeUndefined();
      expect((r.results ?? []).map((x) => x.docId)).toEqual(['shohi/01/1']);
    }
  });
});
