import type DatabaseT from 'better-sqlite3';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { initSchema } from '../db/schema.js';
import {
  analyzeKeyword,
  describeSearchNotes,
  hasAnyClause,
  makeLikeSnippet,
  sanitizeFtsQuery,
  searchClauseFts,
  searchDocumentFts,
} from './db-search.js';

/* テスト用ヘルパ: tsutatsu と clause を 1 件ずつ INSERT */
function seed(
  db: DatabaseT.Database,
  formalName: string,
  abbr: string,
  clauses: Array<{
    clauseNumber: string;
    chapter: number;
    section: number;
    title: string;
    fullText: string;
    sourceUrl: string;
  }>
): void {
  const tsutatsuId = (
    db
      .prepare(
        `INSERT INTO tsutatsu(formal_name, abbr, source_root_url) VALUES (?, ?, ?) RETURNING id`
      )
      .get(formalName, abbr, 'https://x/') as { id: number }
  ).id;
  const insert = db.prepare(
    `INSERT INTO clause(tsutatsu_id, clause_number, source_url, chapter_number, section_number, title, full_text, paragraphs_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const c of clauses) {
    insert.run(
      tsutatsuId,
      c.clauseNumber,
      c.sourceUrl,
      c.chapter,
      c.section,
      c.title,
      c.fullText,
      '[]'
    );
  }
}

describe('sanitizeFtsQuery', () => {
  it('単一語をフレーズ検索に変換', () => {
    expect(sanitizeFtsQuery('納税義務')).toBe('"納税義務"');
  });

  it('複数語は AND 結合', () => {
    expect(sanitizeFtsQuery('課税仕入 売上高')).toBe('"課税仕入" AND "売上高"');
    expect(sanitizeFtsQuery('課税仕入  売上高')).toBe('"課税仕入" AND "売上高"'); // 連続スペース
    expect(sanitizeFtsQuery('課税仕入　売上高')).toBe('"課税仕入" AND "売上高"'); // 全角スペース
  });

  it('FTS5 メタ文字を除去', () => {
    expect(sanitizeFtsQuery('"消費税"*:()軽減税率')).toBe('"消費税" AND "軽減税率"');
  });

  it('空文字 / 短すぎる入力は空文字を返す', () => {
    expect(sanitizeFtsQuery('')).toBe('');
    expect(sanitizeFtsQuery(' ')).toBe('');
    expect(sanitizeFtsQuery('a')).toBe('');
  });

  it('Issue #18: 3 文字未満の語は trigram に乗らないので MATCH 式から外す', () => {
    expect(sanitizeFtsQuery('役員')).toBe('');
    expect(sanitizeFtsQuery('課税 売上')).toBe('');
    expect(sanitizeFtsQuery('役員 退職給与')).toBe('"退職給与"');
  });
});

describe('analyzeKeyword / describeSearchNotes — Issue #18', () => {
  it('語の長さで fts / short / dropped に振り分ける', () => {
    expect(analyzeKeyword('役員 退職給与 a')).toEqual({
      ftsTokens: ['退職給与'],
      shortTokens: ['役員'],
      droppedTokens: ['a'],
    });
    expect(analyzeKeyword('')).toEqual({ ftsTokens: [], shortTokens: [], droppedTokens: [] });
  });

  it('3 文字以上だけなら注記なし', () => {
    expect(describeSearchNotes('軽減税率')).toEqual([]);
  });

  it('2 文字語だけなら LIKE で検索した旨と再検索の推奨を返す', () => {
    const notes = describeSearchNotes('役員');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('"役員"');
    expect(notes[0]).toContain('LIKE');
    expect(notes[0]).toContain('3 文字以上');
  });

  it('2 文字語 + 3 文字以上の語なら絞り込みに使った旨を返す', () => {
    const notes = describeSearchNotes('役員 退職給与');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('絞り込み');
  });

  it('1 文字語は外した旨を返す', () => {
    const notes = describeSearchNotes('軽減税率 a');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('"a"');
    expect(notes[0]).toContain('1 文字');
  });

  it('makeLikeSnippet は最初の一致語の前後を <b> で囲んで返す', () => {
    const text = `${'あ'.repeat(30)}役員${'い'.repeat(30)}`;
    const snip = makeLikeSnippet(text, ['役員'], 4);
    expect(snip).toBe(' … ああああ<b>役員</b>いいいい … ');
    expect(makeLikeSnippet('役員だけ', ['役員'])).toBe('<b>役員</b>だけ');
    expect(makeLikeSnippet('なし', ['役員'])).toBe('なし');
  });
});

describe('searchClauseFts / searchDocumentFts — Issue #18: 2 文字語の LIKE 補完', () => {
  let db: DatabaseT.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
    seed(db, '法人税基本通達', '法基通', [
      {
        clauseNumber: '9-2-1',
        chapter: 9,
        section: 2,
        title: '役員の範囲',
        fullText:
          '役員の範囲\n法第2条第15号に規定する役員には、使用人以外の者で経営に従事している者が含まれる。',
        sourceUrl: 'https://x/09/02.htm',
      },
      {
        clauseNumber: '9-2-27',
        chapter: 9,
        section: 2,
        title: '退職給与の打切支給',
        fullText:
          '退職給与の打切支給\n法人が使用人に対し退職給与を支給した場合の取扱い。役員には適用しない。',
        sourceUrl: 'https://x/09/02.htm',
      },
      {
        clauseNumber: '2-1-1',
        chapter: 2,
        section: 1,
        title: '棚卸資産の販売',
        fullText:
          '棚卸資産の販売\n棚卸資産の販売による収益の額は引渡しの日の属する事業年度の益金の額に算入する。',
        sourceUrl: 'https://x/02/01.htm',
      },
    ]);
    seedDoc(db, {
      docType: 'qa-jirei',
      docId: 'qa-1',
      title: '役員に対する経済的利益',
      fullText: '役員に対して社宅を貸与した場合の経済的利益の取扱い。',
    });
    seedDoc(db, {
      docType: 'qa-jirei',
      docId: 'qa-2',
      title: '棚卸資産の評価',
      fullText: '棚卸資産の評価方法の届出について。',
    });
  });
  afterEach(() => {
    db.close();
  });

  it('2 文字語だけのクエリは trigram では 0 件になるが、LIKE 補完でヒットする', () => {
    // 前提の確認: FTS5 trigram は 2 文字語を索引しない
    const ftsCount = db
      .prepare(`SELECT COUNT(*) AS n FROM clause_fts WHERE clause_fts MATCH ?`)
      .get('"役員"') as { n: number };
    expect(ftsCount.n).toBe(0);

    const hits = searchClauseFts(db, '役員');
    expect(hits.map((h) => h.clauseNumber).sort()).toEqual(['9-2-1', '9-2-27']);
    expect(hits[0].snippet).toContain('<b>役員</b>');
    expect(hits[0].scoreReasons?.some((r) => r.includes('short token search'))).toBe(true);
  });

  it('2 文字語 + 3 文字以上の語は FTS ヒットを 2 文字語で絞り込む (AND)', () => {
    const hits = searchClauseFts(db, '退職給与 役員');
    expect(hits.map((h) => h.clauseNumber)).toEqual(['9-2-27']);
    expect(hits[0].scoreReasons?.some((r) => r.includes('short token filter'))).toBe(true);
    // 本文に含まれない 2 文字語で絞ると 0 件
    expect(searchClauseFts(db, '退職給与 社宅')).toEqual([]);
  });

  it('formalName の絞り込みは LIKE 経路でも効く', () => {
    expect(searchClauseFts(db, '役員', { formalName: '法人税基本通達' })).toHaveLength(2);
    expect(searchClauseFts(db, '役員', { formalName: '所得税基本通達' })).toEqual([]);
  });

  it('LIKE のメタ文字 (% _) はリテラルとして扱う', () => {
    expect(searchClauseFts(db, '%%')).toEqual([]);
    expect(searchClauseFts(db, '__')).toEqual([]);
  });

  it('document 側も 2 文字語を LIKE で補完し、docType / taxonomy フィルタが効く', () => {
    const hits = searchDocumentFts(db, '役員', { docType: 'qa-jirei' });
    expect(hits.map((h) => h.docId)).toEqual(['qa-1']);
    expect(hits[0].snippet).toContain('<b>役員</b>');
    expect(searchDocumentFts(db, '役員', { docType: 'kaisei' })).toEqual([]);
    expect(searchDocumentFts(db, '役員', { taxonomy: 'hojin' })).toEqual([]);
  });

  it('1 文字語だけのクエリは検索せず空配列', () => {
    expect(searchClauseFts(db, 'a')).toEqual([]);
    expect(searchDocumentFts(db, 'a')).toEqual([]);
  });
});

describe('hasAnyClause / searchClauseFts', () => {
  let db: DatabaseT.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
  });
  afterEach(() => {
    db.close();
  });

  it('hasAnyClause は空 DB で false', () => {
    expect(hasAnyClause(db)).toBe(false);
  });

  it('seed 後は hasAnyClause が true、formal 指定でも検証', () => {
    seed(db, '消費税法基本通達', '消基通', [
      {
        clauseNumber: '1-4-1',
        chapter: 1,
        section: 4,
        title: '納税義務が免除される課税期間',
        fullText: '法第9条第1項本文 …',
        sourceUrl: 'https://x/01/04.htm',
      },
    ]);
    expect(hasAnyClause(db)).toBe(true);
    expect(hasAnyClause(db, '消費税法基本通達')).toBe(true);
    expect(hasAnyClause(db, '所得税基本通達')).toBe(false);
  });

  it('searchClauseFts は keyword でヒットを返し、source_url を含む', () => {
    seed(db, '消費税法基本通達', '消基通', [
      {
        clauseNumber: '1-4-1',
        chapter: 1,
        section: 4,
        title: '納税義務が免除される課税期間',
        fullText: '法第9条第1項本文 小規模事業者に係る納税義務の免除',
        sourceUrl: 'https://x/01/04.htm',
      },
      {
        clauseNumber: '5-1-1',
        chapter: 5,
        section: 1,
        title: '事業としての意義',
        fullText: '事業として 反復継続独立して行われる',
        sourceUrl: 'https://x/05/01.htm',
      },
    ]);

    const hits = searchClauseFts(db, '納税義務');
    expect(hits.length).toBe(1);
    expect(hits[0].clauseNumber).toBe('1-4-1');
    expect(hits[0].tsutatsu).toBe('消費税法基本通達');
    expect(hits[0].abbr).toBe('消基通');
    expect(hits[0].sourceUrl).toBe('https://x/01/04.htm');
    expect(hits[0].snippet).toContain('<b>');
  });

  it('formalName 指定で対象通達を絞る', () => {
    seed(db, '消費税法基本通達', '消基通', [
      {
        clauseNumber: '1-1-1',
        chapter: 1,
        section: 1,
        title: 'A',
        fullText: '事業者',
        sourceUrl: 'u1',
      },
    ]);
    seed(db, '所得税基本通達', '所基通', [
      {
        clauseNumber: '2-1',
        chapter: 2,
        section: 1,
        title: 'B',
        fullText: '事業者',
        sourceUrl: 'u2',
      },
    ]);

    const all = searchClauseFts(db, '事業者');
    expect(all.length).toBe(2);

    const onlyShohi = searchClauseFts(db, '事業者', { formalName: '消費税法基本通達' });
    expect(onlyShohi.length).toBe(1);
    expect(onlyShohi[0].clauseNumber).toBe('1-1-1');
  });

  it('limit が効く', () => {
    const clauses = Array.from({ length: 15 }, (_, i) => ({
      clauseNumber: `1-1-${i + 1}`,
      chapter: 1,
      section: 1,
      title: 'タイトル',
      fullText: '消費税が…',
      sourceUrl: `u${i}`,
    }));
    seed(db, '消費税法基本通達', '消基通', clauses);

    const hits = searchClauseFts(db, '消費税', { limit: 5 });
    expect(hits.length).toBe(5);
  });

  it('空クエリは空配列を返す', () => {
    seed(db, '消費税法基本通達', '消基通', [
      {
        clauseNumber: '1-1-1',
        chapter: 1,
        section: 1,
        title: 'A',
        fullText: '事業者',
        sourceUrl: 'u',
      },
    ]);
    expect(searchClauseFts(db, '')).toEqual([]);
    expect(searchClauseFts(db, ' ')).toEqual([]);
  });
});

/* ヘルパ: document テーブルへ 1 件 INSERT */
function seedDoc(
  db: DatabaseT.Database,
  args: {
    docType: string;
    docId: string;
    title: string;
    fullText: string;
    sourceUrl?: string;
    attachedPdfsJson?: string;
    taxonomy?: string;
  }
): void {
  db.prepare(
    `INSERT INTO document(doc_type, doc_id, taxonomy, title, source_url, fetched_at, full_text, attached_pdfs_json, content_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    args.docType,
    args.docId,
    args.taxonomy ?? 'shohi',
    args.title,
    args.sourceUrl ?? `https://x/${args.docId}`,
    '2026-05-06T00:00:00Z',
    args.fullText,
    args.attachedPdfsJson ?? '[]',
    `hash-${args.docId}`
  );
}

describe('searchDocumentFts — Phase 4-2: hasPdf フィルタ', () => {
  let db: DatabaseT.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);

    // PDF 付き 2 件 + PDF 無し 2 件 を投入（同じ keyword でヒット）
    seedDoc(db, {
      docType: 'kaisei',
      docId: 'with-pdf-1',
      title: 'インボイス改正',
      fullText: 'インボイス制度の経過措置',
      attachedPdfsJson: JSON.stringify([
        { title: '新旧対照表', url: 'https://x/a.pdf', kind: 'comparison' },
      ]),
    });
    seedDoc(db, {
      docType: 'kaisei',
      docId: 'with-pdf-2',
      title: 'インボイス Q&A',
      fullText: 'インボイス制度の Q&A',
      attachedPdfsJson: JSON.stringify([{ title: 'Q&A', url: 'https://x/b.pdf', kind: 'qa-pdf' }]),
    });
    seedDoc(db, {
      docType: 'kaisei',
      docId: 'no-pdf-1',
      title: 'インボイス通知',
      fullText: 'インボイス制度の通知',
      attachedPdfsJson: '[]',
    });
    seedDoc(db, {
      docType: 'kaisei',
      docId: 'no-pdf-2',
      title: 'インボイス補足',
      fullText: 'インボイス制度の補足',
      attachedPdfsJson: '[]',
    });
  });
  afterEach(() => {
    db.close();
  });

  it('hasPdf 未指定: PDF 有無に関わらず全件返す', () => {
    const hits = searchDocumentFts(db, 'インボイス', { docType: 'kaisei' });
    expect(hits.length).toBe(4);
  });

  it('hasPdf=true: PDF を持つ文書だけ返す', () => {
    const hits = searchDocumentFts(db, 'インボイス', { docType: 'kaisei', hasPdf: true });
    expect(hits.length).toBe(2);
    expect(hits.map((h) => h.docId).sort()).toEqual(['with-pdf-1', 'with-pdf-2']);
  });

  it('hasPdf=false: PDF を持たない文書だけ返す', () => {
    const hits = searchDocumentFts(db, 'インボイス', { docType: 'kaisei', hasPdf: false });
    expect(hits.length).toBe(2);
    expect(hits.map((h) => h.docId).sort()).toEqual(['no-pdf-1', 'no-pdf-2']);
  });

  it('空文字列の attached_pdfs_json も hasPdf=false 側に含まれる', () => {
    // NOTE: 現スキーマでは attached_pdfs_json は NOT NULL なので NULL は INSERT 不可。
    //       しかし SQL 側では IS NOT NULL チェックも入れている（将来スキーマ変更されても
    //       hasPdf=true で nullable な値が紛れ込まないよう保険）。
    //       ここでは空文字列という別の「PDF 無し」表現も拾えるかを検証。
    seedDoc(db, {
      docType: 'kaisei',
      docId: 'empty-str-pdf',
      title: 'インボイス追加',
      fullText: 'インボイス制度の追加',
      attachedPdfsJson: '',
    });
    const hits = searchDocumentFts(db, 'インボイス', { docType: 'kaisei', hasPdf: false });
    expect(hits.map((h) => h.docId)).toContain('empty-str-pdf');
  });
});

/* -------------------------------------------------------------------------- */
/* Phase 6-1 (v0.8.0): relevance ranking                                      */
/* -------------------------------------------------------------------------- */

describe('searchClauseFts — Phase 6-1 relevance ranking', () => {
  let db: DatabaseT.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
    seed(db, '消費税法基本通達', '消基通', [
      {
        clauseNumber: '5-1-9',
        chapter: 5,
        section: 1,
        title: '請求対価の額',
        fullText: '請求対価の額に該当する金銭等の取扱いを示す',
        sourceUrl: 'https://x/05/01.htm',
      },
      {
        clauseNumber: '5-1-1',
        chapter: 5,
        section: 1,
        title: '事業としての意義',
        fullText: '事業として 反復継続独立して行われる',
        sourceUrl: 'https://x/05/01-1.htm',
      },
      {
        clauseNumber: '1-4-13',
        chapter: 1,
        section: 4,
        title: 'なんらかの規定',
        fullText: '請求対価の額に類似する文言を持つ別の clause',
        sourceUrl: 'https://x/01/04.htm',
      },
    ]);
  });
  afterEach(() => {
    db.close();
  });

  it('返り値に score と scoreReasons が含まれる', () => {
    const hits = searchClauseFts(db, '請求対価');
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(typeof h.score).toBe('number');
      expect(Array.isArray(h.scoreReasons)).toBe(true);
      expect(h.scoreReasons!.some((s) => s.includes('doc_type=tsutatsu'))).toBe(true);
    }
  });

  it('clause 番号を含むクエリは該当 clause が 1 位に来る', () => {
    // BM25 だけでは "5-1-9" 含む clause がトップとは限らないが、boost で 1 位になるべき
    const hits = searchClauseFts(db, '5-1-9 請求対価');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].clauseNumber).toBe('5-1-9');
    expect(hits[0].scoreReasons).toContain('clause exact match');
  });

  it('score 降順で並ぶ', () => {
    const hits = searchClauseFts(db, '請求対価');
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i - 1].score!).toBeGreaterThanOrEqual(hits[i].score!);
    }
  });
});

describe('searchClauseFts — Phase 6-1 abbreviation expansion', () => {
  let db: DatabaseT.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
    seed(db, '消費税法基本通達', '消基通', [
      {
        clauseNumber: '1-1-1',
        chapter: 1,
        section: 1,
        title: '基本的な考え方',
        fullText: '消費税法基本通達の総則を示す。略称展開で hit',
        sourceUrl: 'https://x/01/01.htm',
      },
    ]);
  });
  afterEach(() => {
    db.close();
  });

  it('"消基通" で検索すると formal_name 経由でヒットする (abbreviation expansion)', () => {
    // fullText には "消基通" は含まれていないが、"消費税法基本通達" は含まれる
    const hits = searchClauseFts(db, '消基通');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].scoreReasons!.some((s) => s.includes('abbreviation expanded'))).toBe(true);
  });

  it('enableAbbreviationExpansion=false で展開を無効化できる', () => {
    const hits = searchClauseFts(db, '消基通', { enableAbbreviationExpansion: false });
    // expansion なしでは "消基通" 自体は本文に含まれないので 0 件
    expect(hits.length).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* v0.9.2 (Issue #14): 通称 alias 経由 (houki-egov 管轄) の OR 展開            */
/* -------------------------------------------------------------------------- */

describe('searchClauseFts — Issue #14: houki-egov 管轄エントリ経由の通称展開', () => {
  let db: DatabaseT.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
    seed(db, '消費税法基本通達', '消基通', [
      {
        clauseNumber: '1-7-2',
        chapter: 1,
        section: 7,
        title: '登録番号の構成',
        fullText: '適格請求書発行事業者の登録番号は、消費税法第57条の2に基づく',
        sourceUrl: 'https://x/01/07.htm',
      },
    ]);
  });
  afterEach(() => {
    db.close();
  });

  it('"インボイス" で検索すると消費税法経由で OR 展開されヒットする', () => {
    // houki-abbreviations v0.4.0+ では「インボイス」は消費税法エントリの alias
    // 消費税法エントリは source_mcp_hint=houki-egov だが、v0.9.2 で許可リストに含まれる
    const hits = searchClauseFts(db, 'インボイス');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].scoreReasons!.some((s) => s.includes('abbreviation expanded'))).toBe(true);
    // 展開先が「消費税法」であること
    expect(hits[0].scoreReasons!.some((s) => s.includes('消費税法'))).toBe(true);
  });
});
