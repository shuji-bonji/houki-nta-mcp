import type DatabaseT from 'better-sqlite3';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearAllData, getSchemaVersion, initSchema, SCHEMA_VERSION } from './schema.js';

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

describe('initSchema — Phase 6-2 (v0.9.0): last_modified / etag カラム', () => {
  let db: DatabaseT.Database;
  beforeEach(() => {
    db = new Database(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('section に last_modified / etag カラムが追加されている', () => {
    initSchema(db);
    const cols = (db.prepare(`PRAGMA table_info(section)`).all() as Array<{ name: string }>).map(
      (r) => r.name
    );
    expect(cols).toContain('last_modified');
    expect(cols).toContain('etag');
    expect(cols).toContain('content_hash'); // v2 から残置
  });

  it('document に last_modified / etag カラムが追加されている', () => {
    initSchema(db);
    const cols = (db.prepare(`PRAGMA table_info(document)`).all() as Array<{ name: string }>).map(
      (r) => r.name
    );
    expect(cols).toContain('last_modified');
    expect(cols).toContain('etag');
  });

  it('v3 → v4 マイグレーションで既存データを保ったままカラム追加できる', () => {
    // v3 シミュレーション: section に last_modified / etag が無い状態を作る
    db.exec(`
      CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE tsutatsu (
        id INTEGER PRIMARY KEY,
        formal_name TEXT NOT NULL UNIQUE,
        abbr TEXT NOT NULL,
        source_root_url TEXT NOT NULL
      );
      CREATE TABLE section (
        tsutatsu_id INTEGER NOT NULL REFERENCES tsutatsu(id) ON DELETE CASCADE,
        chapter_number INTEGER NOT NULL,
        section_number INTEGER NOT NULL,
        title TEXT NOT NULL,
        url TEXT,
        fetched_at TEXT NOT NULL,
        content_hash TEXT,
        PRIMARY KEY (tsutatsu_id, chapter_number, section_number)
      );
      CREATE TABLE document (
        id INTEGER PRIMARY KEY,
        doc_type TEXT NOT NULL,
        doc_id TEXT NOT NULL,
        taxonomy TEXT,
        title TEXT NOT NULL,
        issued_at TEXT,
        issuer TEXT,
        source_url TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        full_text TEXT NOT NULL,
        attached_pdfs_json TEXT NOT NULL,
        content_hash TEXT,
        UNIQUE(doc_type, doc_id)
      );
      INSERT INTO schema_meta(key, value) VALUES ('schema_version', '3');
      INSERT INTO tsutatsu(formal_name, abbr, source_root_url) VALUES ('消費税法基本通達', '消基通', 'https://x/');
      INSERT INTO section(tsutatsu_id, chapter_number, section_number, title, fetched_at, content_hash)
        VALUES (1, 1, 1, '第1章第1節', '2026-05-01T00:00:00Z', 'pre-existing-hash');
    `);

    // v4 へのマイグレーションを起動 (initSchema が migrateV3ToV4 を呼ぶ)
    initSchema(db);

    // 既存データが保持されている
    const sec = db
      .prepare(`SELECT title, content_hash, last_modified, etag FROM section WHERE tsutatsu_id=1`)
      .get() as {
      title: string;
      content_hash: string;
      last_modified: string | null;
      etag: string | null;
    };
    expect(sec.title).toBe('第1章第1節');
    expect(sec.content_hash).toBe('pre-existing-hash');
    expect(sec.last_modified).toBeNull();
    expect(sec.etag).toBeNull();

    // schema_version が v4 に更新されている
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
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
