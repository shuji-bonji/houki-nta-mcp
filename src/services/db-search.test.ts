import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type DatabaseT from 'better-sqlite3';

import { initSchema } from '../db/schema.js';
import { hasAnyClause, sanitizeFtsQuery, searchClauseFts } from './db-search.js';

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
    expect(sanitizeFtsQuery('課税 売上')).toBe('"課税" AND "売上"');
    expect(sanitizeFtsQuery('課税  売上')).toBe('"課税" AND "売上"'); // 連続スペース
    expect(sanitizeFtsQuery('課税　売上')).toBe('"課税" AND "売上"'); // 全角スペース
  });

  it('FTS5 メタ文字を除去', () => {
    expect(sanitizeFtsQuery('"消費税"*:()軽減')).toBe('"消費税" AND "軽減"');
  });

  it('空文字 / 短すぎる入力は空文字を返す', () => {
    expect(sanitizeFtsQuery('')).toBe('');
    expect(sanitizeFtsQuery(' ')).toBe('');
    expect(sanitizeFtsQuery('a')).toBe('');
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
