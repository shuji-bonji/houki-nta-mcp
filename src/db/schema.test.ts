import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type DatabaseT from 'better-sqlite3';

import { SCHEMA_VERSION, clearAllData, getSchemaVersion, initSchema } from './schema.js';

describe('initSchema', () => {
  let db: DatabaseT.Database;
  beforeEach(() => {
    db = new Database(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('全テーブル + FTS5 + trigger を作成し、schema_version を記録する', () => {
    initSchema(db);
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((r: unknown) => (r as { name: string }).name);

    expect(tables).toContain('tsutatsu');
    expect(tables).toContain('chapter');
    expect(tables).toContain('section');
    expect(tables).toContain('clause');
    expect(tables).toContain('clause_fts');
    expect(tables).toContain('schema_meta');
  });

  it('clause INSERT で FTS5 が trigger 経由で自動更新される', () => {
    initSchema(db);
    db.prepare(`INSERT INTO tsutatsu(formal_name, abbr, source_root_url) VALUES (?, ?, ?)`).run(
      '消費税法基本通達',
      '消基通',
      'https://example.com/'
    );
    db.prepare(
      `INSERT INTO clause(tsutatsu_id, clause_number, source_url, chapter_number, section_number, title, full_text, paragraphs_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      1,
      '1-4-1',
      'https://example.com/x',
      1,
      4,
      '納税義務が免除される',
      '法第9条第1項本文…',
      '[]'
    );

    const hits = db
      .prepare(`SELECT clause_number, title FROM clause_fts WHERE clause_fts MATCH ?`)
      .all('納税義務');
    expect(hits).toHaveLength(1);
    expect((hits[0] as { clause_number: string }).clause_number).toBe('1-4-1');
  });

  it('clause UPDATE で FTS5 が更新される', () => {
    initSchema(db);
    db.prepare(`INSERT INTO tsutatsu(formal_name, abbr, source_root_url) VALUES (?, ?, ?)`).run(
      '消費税法基本通達',
      '消基通',
      'https://x/'
    );
    db.prepare(
      `INSERT INTO clause(tsutatsu_id, clause_number, source_url, chapter_number, section_number, title, full_text, paragraphs_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(1, '1-1-1', 'https://x/y', 1, 1, '個人事業者と給与所得者の区分', '事業者とは…', '[]');

    db.prepare(`UPDATE clause SET full_text = ? WHERE clause_number = ?`).run(
      '更新後テキスト 軽減税率',
      '1-1-1'
    );

    const hits = db
      .prepare(`SELECT clause_number FROM clause_fts WHERE clause_fts MATCH ?`)
      .all('軽減税率');
    expect(hits).toHaveLength(1);
  });

  it('clause→URL lookup が UNIQUE INDEX で機能する', () => {
    initSchema(db);
    db.prepare(`INSERT INTO tsutatsu(formal_name, abbr, source_root_url) VALUES (?, ?, ?)`).run(
      '消費税法基本通達',
      '消基通',
      'https://x/'
    );
    const insert = db.prepare(
      `INSERT INTO clause(tsutatsu_id, clause_number, source_url, chapter_number, section_number, title, full_text, paragraphs_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insert.run(1, '1-4-1', 'https://x/01/04.htm', 1, 4, 'タイトル', '本文', '[]');

    // 同じ (tsutatsu_id, clause_number) を再投入したら UNIQUE 違反
    expect(() => insert.run(1, '1-4-1', 'https://x/dup.htm', 1, 4, 'dup', 'dup', '[]')).toThrow(
      /UNIQUE/
    );

    // lookup できる
    const got = db
      .prepare(`SELECT source_url FROM clause WHERE tsutatsu_id = ? AND clause_number = ?`)
      .get(1, '1-4-1') as { source_url: string };
    expect(got.source_url).toBe('https://x/01/04.htm');
  });
});

describe('clearAllData', () => {
  it('全テーブルを空にし FTS5 も rebuild する', () => {
    const db = new Database(':memory:');
    initSchema(db);
    db.prepare(`INSERT INTO tsutatsu(formal_name, abbr, source_root_url) VALUES (?, ?, ?)`).run(
      'X',
      'X',
      'https://x/'
    );
    db.prepare(
      `INSERT INTO clause(tsutatsu_id, clause_number, source_url, chapter_number, section_number, title, full_text, paragraphs_json)
       VALUES (1, '1-1-1', 'u', 1, 1, 't', 'f', '[]')`
    ).run();

    clearAllData(db);

    const c = db.prepare(`SELECT count(*) AS n FROM clause`).get() as { n: number };
    expect(c.n).toBe(0);
    db.close();
  });
});
