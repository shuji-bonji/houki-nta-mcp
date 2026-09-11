/**
 * Issue #23 (v0.13.0): 文書系の検索 5 ツールが 0 件のとき、理由を分けて返す。
 *
 * - その種別の文書が DB に 1 件も無い → エラー DOC_NOT_FOUND
 * - 税目の絞り込みの範囲に文書が無い → 成功。available_taxonomies を付ける
 * - hasPdf の条件に合う文書が無い → 成功。hasPdf を外すよう案内する
 * - 文書はあるがキーワードに合わない → 成功。freshness を付ける
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initSchema } from '../db/schema.js';
import { countDocuments, listDocumentTaxonomies } from '../services/db-search.js';
import {
  handleNtaSearchBunshokaitou,
  handleNtaSearchJimuUnei,
  handleNtaSearchKaiseiTsutatsu,
  handleNtaSearchQa,
  handleNtaSearchTaxAnswer,
} from './handlers.js';

interface ZeroHitResponse {
  results?: unknown[];
  hint?: string;
  available_taxonomies?: string[];
  freshness?: { staleness: string };
  code?: string;
  error?: string;
  tool?: string;
  next_actions?: Array<{ action: string; example?: { command?: string } }>;
}

const PDF = JSON.stringify([{ title: '別紙', url: 'https://x/a.pdf', sizeKb: 10 }]);

function seed(
  dbPath: string,
  docs: Array<
    [docType: string, docId: string, taxonomy: string, title: string, body: string, pdfs?: string]
  >
) {
  const db = new Database(dbPath);
  initSchema(db);
  const stmt = db.prepare(
    `INSERT INTO document(doc_type, doc_id, taxonomy, title, source_url, fetched_at, full_text, attached_pdfs_json, content_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const [docType, docId, taxonomy, title, body, pdfs] of docs) {
    stmt.run(
      docType,
      docId,
      taxonomy,
      title,
      `https://x/${docType}/${docId}.htm`,
      new Date().toISOString(),
      body,
      pdfs ?? '[]',
      null
    );
  }
  db.close();
}

describe('文書系の検索: その種別の文書が DB に 1 件も無いときは DOC_NOT_FOUND', () => {
  const cases = [
    [
      'nta_search_qa',
      '--bulk-download-qa',
      () => handleNtaSearchQa({ keyword: '社内会議' }, { dbPath: ':memory:' }),
    ],
    [
      'nta_search_tax_answer',
      '--bulk-download-tax-answer',
      () => handleNtaSearchTaxAnswer({ keyword: '医療費控除' }, { dbPath: ':memory:' }),
    ],
    [
      'nta_search_kaisei_tsutatsu',
      '--bulk-download-kaisei',
      () => handleNtaSearchKaiseiTsutatsu({ keyword: 'インボイス' }, { dbPath: ':memory:' }),
    ],
    [
      'nta_search_jimu_unei',
      '--bulk-download-jimu-unei',
      () => handleNtaSearchJimuUnei({ keyword: '調査手続' }, { dbPath: ':memory:' }),
    ],
    [
      'nta_search_bunshokaitou',
      '--bulk-download-bunshokaitou',
      () => handleNtaSearchBunshokaitou({ keyword: '外国法人' }, { dbPath: ':memory:' }),
    ],
  ] as const;

  for (const [tool, flag, call] of cases) {
    it(`${tool}: code=DOC_NOT_FOUND、next_actions に ${flag}、hint に DB のパス`, async () => {
      const r = (await call()) as ZeroHitResponse;
      expect(r.code).toBe('DOC_NOT_FOUND');
      expect(r.tool).toBe(tool);
      expect(r.results).toBeUndefined();
      expect(r.error).toContain('「該当なし」という結果ではありません');
      expect(r.hint).toContain(':memory:');
      expect(r.hint).toContain('HOUKI_NTA_DB_PATH');
      expect(r.next_actions?.[0]?.action).toBe('cli_bulk_download');
      expect(r.next_actions?.[0]?.example?.command).toBe(`houki-nta-mcp ${flag}`);
    });
  }
});

describe('文書系の検索: 文書がある DB での 0 件', () => {
  let dir: string;
  let dbPath: string;
  let qaOnlyPath: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'houki-nta-issue23-'));
    dbPath = join(dir, 'cache.db');
    seed(dbPath, [
      [
        'qa-jirei',
        'shohi/02/19',
        'shohi',
        '会議費と軽減税率',
        '社内会議で提供する弁当は軽減税率の対象か',
      ],
      ['qa-jirei', 'shotoku/05/01', 'shotoku', 'テレワークの必要経費', '在宅勤務の通信費の取扱い'],
      ['tax-answer', '6101', 'shohi', '消費税のしくみ', '消費税は消費に広く公平に負担を求める税'],
      ['kaisei', 'k-001', 'shohi', 'インボイス関係の改正', '適格請求書の記載事項を改める', PDF],
      ['kaisei', 'k-002', 'hojin', '法人税基本通達の一部改正', '役員給与の取扱いを改める'],
      ['jimu-unei', 'j-001', 'shotoku', '調査手続の実施に当たっての指針', '事前通知の手続を定める'],
      [
        'bunshokaitou',
        'b-001',
        'shotoku',
        '外国法人から受ける配当',
        '源泉徴収の要否について回答する',
      ],
    ]);
    qaOnlyPath = join(dir, 'qa-only.db');
    seed(qaOnlyPath, [
      [
        'qa-jirei',
        'shohi/02/19',
        'shohi',
        '会議費と軽減税率',
        '社内会議で提供する弁当は軽減税率の対象か',
      ],
    ]);
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('countDocuments / listDocumentTaxonomies', () => {
    const db = new Database(dbPath);
    try {
      expect(countDocuments(db, { docType: 'qa-jirei' })).toBe(2);
      expect(countDocuments(db, { docType: 'qa-jirei', taxonomy: 'shohi' })).toBe(1);
      expect(countDocuments(db, { docType: 'kaisei', hasPdf: true })).toBe(1);
      expect(countDocuments(db, { docType: 'kaisei', hasPdf: false })).toBe(1);
      expect(countDocuments(db, { docType: 'kaisei', taxonomy: 'shohi', hasPdf: false })).toBe(0);
      expect(listDocumentTaxonomies(db, 'qa-jirei')).toEqual(['shohi', 'shotoku']);
    } finally {
      db.close();
    }
  });

  it('nta_search_qa: キーワードに合わないときは成功で「該当なし」と件数・freshness', async () => {
    const r = (await handleNtaSearchQa(
      { keyword: '異なる課税関係が生ずる' },
      { dbPath }
    )) as ZeroHitResponse;
    expect(r.code).toBeUndefined();
    expect(r.results).toEqual([]);
    expect(r.hint).toContain('該当なし');
    expect(r.hint).toContain('質疑応答事例 2 件');
    expect(r.hint).not.toContain('投入済みか確認');
    expect(r.freshness?.staleness).toBe('fresh');
  });

  it('nta_search_qa: 他の種別だけが入っている DB（qa のみ）でタックスアンサーを検索すると DOC_NOT_FOUND', async () => {
    const r = (await handleNtaSearchTaxAnswer(
      { keyword: '医療費控除' },
      { dbPath: qaOnlyPath }
    )) as ZeroHitResponse;
    expect(r.code).toBe('DOC_NOT_FOUND');
    expect(r.hint).toContain(qaOnlyPath);
  });

  it('nta_search_qa: topic で絞った範囲に文書が無いときは available_taxonomies と --qa-topic を案内', async () => {
    const r = (await handleNtaSearchQa(
      { keyword: '軽減税率', topic: 'hojin' },
      { dbPath }
    )) as ZeroHitResponse;
    expect(r.code).toBeUndefined();
    expect(r.results).toEqual([]);
    expect(r.hint).toContain('topic="hojin"');
    expect(r.hint).toContain('houki-nta-mcp --bulk-download-qa --qa-topic=hojin');
    expect(r.available_taxonomies).toEqual(['shohi', 'shotoku']);
  });

  it('nta_search_qa: topic で絞り込める（v0.12.0 までは税目で絞る引数が無かった）', async () => {
    const hit = (await handleNtaSearchQa(
      { keyword: '軽減税率', topic: 'shohi' },
      { dbPath }
    )) as ZeroHitResponse;
    expect(hit.results).toHaveLength(1);
    const miss = (await handleNtaSearchQa(
      { keyword: '軽減税率', topic: 'shotoku' },
      { dbPath }
    )) as ZeroHitResponse;
    expect(miss.results).toEqual([]);
    expect(miss.hint).toContain('topic="shotoku"');
    expect(miss.hint).toContain('該当なし');
  });

  it('nta_search_qa: domain="tax" は絞り込まない（v0.12.0 までは必ず 0 件だった）', async () => {
    const r = (await handleNtaSearchQa(
      { keyword: '軽減税率', domain: 'tax' },
      { dbPath }
    )) as ZeroHitResponse;
    expect(r.results).toHaveLength(1);
  });

  it('nta_search_qa: domain が tax 以外なら 0 件で、topic を案内する', async () => {
    const r = (await handleNtaSearchQa(
      { keyword: '軽減税率', domain: 'labor' },
      { dbPath }
    )) as ZeroHitResponse;
    expect(r.code).toBeUndefined();
    expect(r.results).toEqual([]);
    expect(r.hint).toContain('domain="labor"');
    expect(r.hint).toContain('topic');
  });

  it('nta_search_qa: hasPdf=true は PDF 付きの文書が無いことを伝える（エラーにしない）', async () => {
    const r = (await handleNtaSearchQa(
      { keyword: '軽減税率', hasPdf: true },
      { dbPath }
    )) as ZeroHitResponse;
    expect(r.code).toBeUndefined();
    expect(r.results).toEqual([]);
    expect(r.hint).toContain('PDF 付きの文書はありません');
    expect(r.hint).toContain('hasPdf を外して');
  });

  it('nta_search_tax_answer: キーワードに合わないときは成功で「該当なし」', async () => {
    const r = (await handleNtaSearchTaxAnswer(
      { keyword: '医療費控除' },
      { dbPath }
    )) as ZeroHitResponse;
    expect(r.code).toBeUndefined();
    expect(r.results).toEqual([]);
    expect(r.hint).toContain('タックスアンサー 1 件');
    expect(r.freshness).toBeDefined();
  });

  it('nta_search_kaisei_tsutatsu: taxonomy の範囲に文書が無いときは税目の一覧を返す（投入フラグは無いので案内しない）', async () => {
    const r = (await handleNtaSearchKaiseiTsutatsu(
      { keyword: '改正', taxonomy: 'sisan/sozoku' },
      { dbPath }
    )) as ZeroHitResponse;
    expect(r.code).toBeUndefined();
    expect(r.hint).toContain('taxonomy="sisan/sozoku"');
    expect(r.hint).not.toContain('で追加できます');
    expect(r.available_taxonomies).toEqual(['hojin', 'shohi']);
  });

  it('nta_search_kaisei_tsutatsu: taxonomy と hasPdf=false の組み合わせで文書が無いとき', async () => {
    const r = (await handleNtaSearchKaiseiTsutatsu(
      { keyword: 'インボイス', taxonomy: 'shohi', hasPdf: false },
      { dbPath }
    )) as ZeroHitResponse;
    expect(r.code).toBeUndefined();
    expect(r.hint).toContain('PDF 無しの文書はありません');
    expect(r.hint).toContain('taxonomy="shohi"');
  });

  it('nta_search_kaisei_tsutatsu: 条件付きでキーワードに合わないときは条件を hint に書く', async () => {
    const r = (await handleNtaSearchKaiseiTsutatsu(
      { keyword: '電子帳簿保存', hasPdf: true },
      { dbPath }
    )) as ZeroHitResponse;
    expect(r.hint).toContain('改正通達（hasPdf=true） 1 件');
    expect(r.hint).toContain('該当なし');
  });

  it('nta_search_jimu_unei: キーワードに合わないときは成功で「該当なし」', async () => {
    const r = (await handleNtaSearchJimuUnei(
      { keyword: '滞納処分' },
      { dbPath }
    )) as ZeroHitResponse;
    expect(r.code).toBeUndefined();
    expect(r.hint).toContain('事務運営指針 1 件');
  });

  it('nta_search_bunshokaitou: taxonomy の範囲に文書が無いときは --bunsho-taxonomy を案内', async () => {
    const r = (await handleNtaSearchBunshokaitou(
      { keyword: '配当', taxonomy: 'hojin' },
      { dbPath }
    )) as ZeroHitResponse;
    expect(r.code).toBeUndefined();
    expect(r.hint).toContain('houki-nta-mcp --bulk-download-bunshokaitou --bunsho-taxonomy=hojin');
    expect(r.available_taxonomies).toEqual(['shotoku']);
  });
});
