import { createHash } from 'node:crypto';
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

    // マイグレーションを起動する。v3 → v4 → v5 と数珠つなぎに進む
    initSchema(db);

    // 既存データが保持されている
    const sec = db
      .prepare(`SELECT title, content_hash, last_modified, etag FROM section WHERE tsutatsu_id=1`)
      .get() as {
      title: string;
      content_hash: string | null;
      last_modified: string | null;
      etag: string | null;
    };
    expect(sec.title).toBe('第1章第1節');
    expect(sec.last_modified).toBeNull();
    expect(sec.etag).toBeNull();
    // section の content_hash は v5 で未計算に戻る（配下 clause の並び順を
    // DB から復元できないため。Issue #27 の migrateV4ToV5 を参照）
    expect(sec.content_hash).toBeNull();

    // schema_version が最新に更新されている
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

describe('initSchema — v4 → v5 (Issue #27): 共通実装の正規化で入れ直す', () => {
  let db: DatabaseT.Database;

  /** v5 のスキーマに全角英字入りの行を入れ、schema_version だけ v4 に戻した DB を作る */
  function seedV4Database(): void {
    initSchema(db);
    db.prepare(`INSERT INTO tsutatsu(formal_name, abbr, source_root_url) VALUES (?, ?, ?)`).run(
      '消費税法基本通達',
      '消基通',
      'https://example.com/'
    );
    db.prepare(
      `INSERT INTO section(tsutatsu_id, chapter_number, section_number, title, url, fetched_at, content_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(1, 1, 4, 'ＮＩＳＡ関係', 'https://example.com/01/04.htm', '2026-09-07T00:00:00Z', 'old');
    db.prepare(
      `INSERT INTO clause(tsutatsu_id, clause_number, source_url, chapter_number, section_number, title, full_text, paragraphs_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      1,
      'Ａ－１',
      'https://example.com/x',
      1,
      4,
      'ＮＩＳＡの取扱い',
      'ＮＩＳＡ口座について',
      JSON.stringify([{ indent: 0, text: 'ｅ－Ｔａｘで提出する' }])
    );
    db.prepare(
      `INSERT INTO document(doc_type, doc_id, taxonomy, title, source_url, fetched_at, full_text, attached_pdfs_json, content_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'tax-answer',
      '1535',
      'shotoku',
      'ＮＩＳＡ制度',
      'https://example.com/1535.htm',
      '2026-09-07T00:00:00Z',
      'ＮＩＳＡの概要',
      '[]',
      'old-hash'
    );
    db.prepare(`UPDATE schema_meta SET value = '4' WHERE key = 'schema_version'`).run();
  }

  beforeEach(() => {
    db = new Database(':memory:');
    seedV4Database();
    initSchema(db); // v4 と判定され migrateV4ToV5 が走る
  });
  afterEach(() => {
    db.close();
  });

  it('schema_version が最新になる', () => {
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(10);
  });

  it('clause の条番号・題名・本文・段落 JSON が半角になる', () => {
    const row = db
      .prepare('SELECT clause_number, title, full_text, paragraphs_json FROM clause')
      .get() as {
      clause_number: string;
      title: string;
      full_text: string;
      paragraphs_json: string;
    };
    expect(row.clause_number).toBe('A-1');
    expect(row.title).toBe('NISAの取扱い');
    expect(row.full_text).toBe('NISA口座について');
    expect(JSON.parse(row.paragraphs_json)).toEqual([{ indent: 0, text: 'e-Taxで提出する' }]);
  });

  it('半角のキーワードで FTS5 が引けるようになる', () => {
    const hits = db
      .prepare('SELECT clause_number FROM clause_fts WHERE clause_fts MATCH ?')
      .all('NISA');
    expect(hits).toHaveLength(1);

    const docHits = db
      .prepare('SELECT title FROM document_fts WHERE document_fts MATCH ?')
      .all('NISA') as Array<{ title: string }>;
    expect(docHits).toHaveLength(1);
    expect(docHits[0].title).toBe('NISA制度');
  });

  it('section は題名が半角になり、content_hash が未計算に戻る', () => {
    const row = db.prepare('SELECT title, content_hash FROM section').get() as {
      title: string;
      content_hash: string | null;
    };
    expect(row.title).toBe('NISA関係');
    expect(row.content_hash).toBeNull();
  });

  it('document は題名・本文が半角になり、content_hash が計算し直される', () => {
    const row = db.prepare('SELECT title, full_text, content_hash FROM document').get() as {
      title: string;
      full_text: string;
      content_hash: string;
    };
    expect(row.title).toBe('NISA制度');
    expect(row.full_text).toBe('NISAの概要');
    // bulk downloader と同じ式: docType \n docId \n title \n fullText
    const expected = createHash('sha1')
      .update('tax-answer')
      .update('\n')
      .update('1535')
      .update('\n')
      .update('NISA制度')
      .update('\n')
      .update('NISAの概要')
      .digest('hex');
    expect(row.content_hash).toBe(expected);
    expect(row.content_hash).not.toBe('old-hash');
  });

  it('もう一度開いても何も変わらない（冪等）', () => {
    const before = db.prepare('SELECT title, full_text, content_hash FROM document').get();
    initSchema(db);
    const after = db.prepare('SELECT title, full_text, content_hash FROM document').get();
    expect(after).toEqual(before);
  });
});

describe('initSchema — v5 → v6 (Issue #29): document に structured_json を足す', () => {
  let db: DatabaseT.Database;

  /** v6 のスキーマから structured_json 列を落とし、schema_version を v5 に戻した DB を作る */
  function seedV5Database(): void {
    initSchema(db);
    db.prepare(
      `INSERT INTO document(doc_type, doc_id, taxonomy, title, source_url, fetched_at, full_text, attached_pdfs_json, content_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'tax-answer',
      '1535',
      'shotoku',
      'NISA制度',
      'https://example.com/1535.htm',
      '2026-09-07T00:00:00Z',
      'NISAの概要',
      '[]',
      'hash-1535'
    );
    db.exec('ALTER TABLE document DROP COLUMN structured_json');
    db.prepare(`UPDATE schema_meta SET value = '5' WHERE key = 'schema_version'`).run();
  }

  beforeEach(() => {
    db = new Database(':memory:');
    seedV5Database();
    initSchema(db); // v5 と判定され migrateV5ToV6 が走る
  });
  afterEach(() => {
    db.close();
  });

  it('structured_json 列が増える', () => {
    const cols = (db.prepare('PRAGMA table_info(document)').all() as Array<{ name: string }>).map(
      (c) => c.name
    );
    expect(cols).toContain('structured_json');
  });

  it('既存の行は消えず、structured_json は NULL のまま残る', () => {
    const row = db
      .prepare(
        'SELECT title, full_text, content_hash, structured_json FROM document WHERE doc_id = ?'
      )
      .get('1535') as {
      title: string;
      full_text: string;
      content_hash: string;
      structured_json: string | null;
    };
    expect(row.title).toBe('NISA制度');
    expect(row.full_text).toBe('NISAの概要');
    // content_hash は作り直さない（作り直すと次の bulk download が全件を「更新」と数える）
    expect(row.content_hash).toBe('hash-1535');
    expect(row.structured_json).toBeNull();
  });

  it('もう一度開いても何も変わらない（冪等）', () => {
    initSchema(db);
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
    const count = db.prepare('SELECT COUNT(*) AS n FROM document').get() as { n: number };
    expect(count.n).toBe(1);
  });
});

describe('initSchema — v6 → v7 (Issue #30): document に orphaned_at を足す', () => {
  let db: DatabaseT.Database;

  /** v7 のスキーマから orphaned_at 列を落とし、schema_version を v6 に戻した DB を作る */
  function seedV6Database(): void {
    initSchema(db);
    db.prepare(
      `INSERT INTO document(doc_type, doc_id, taxonomy, title, source_url, fetched_at, full_text, attached_pdfs_json, content_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'jimu-unei',
      '170331',
      'shotoku',
      '申告所得税の事務運営指針',
      'https://example.com/170331/01.htm',
      '2026-09-07T00:00:00Z',
      '本文',
      '[]',
      'hash-170331'
    );
    db.exec('ALTER TABLE document DROP COLUMN orphaned_at');
    db.prepare(`UPDATE schema_meta SET value = '6' WHERE key = 'schema_version'`).run();
  }

  beforeEach(() => {
    db = new Database(':memory:');
    seedV6Database();
    initSchema(db); // v6 と判定され migrateV6ToV7 が走る
  });
  afterEach(() => {
    db.close();
  });

  it('orphaned_at 列が増える', () => {
    const cols = (db.prepare('PRAGMA table_info(document)').all() as Array<{ name: string }>).map(
      (c) => c.name
    );
    expect(cols).toContain('orphaned_at');
  });

  it('既存の行は消えず、orphaned_at は NULL（索引にある）のまま残る', () => {
    const row = db
      .prepare('SELECT title, content_hash, orphaned_at FROM document WHERE doc_id = ?')
      .get('170331') as { title: string; content_hash: string; orphaned_at: string | null };
    expect(row.title).toBe('申告所得税の事務運営指針');
    expect(row.content_hash).toBe('hash-170331');
    expect(row.orphaned_at).toBeNull();
  });
});

describe('initSchema — v7 → v8 (Issue #45): 文書回答事例の本文から案内文の行を除く', () => {
  let db: DatabaseT.Database;

  const hojoText = '回答内容: 貴見のとおり\n【別紙】\n照会の趣旨\n以上';
  const hojoTextWithNav = `${hojoText}\n←上記照会の内容に対する回答はこちら`;
  const kyokuText = '回答内容: 貴見のとおり\n【別紙】\n事前照会の趣旨\n以上';

  /** v8 のスキーマに 0.20.0 までの parser が入れた本文を置き、schema_version だけ v7 に戻した DB を作る */
  function seedV7Database(): void {
    initSchema(db);
    const insert = db.prepare(
      `INSERT INTO document(doc_type, doc_id, taxonomy, title, source_url, fetched_at, full_text, attached_pdfs_json, content_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    // 本庁系: 別紙の末尾に戻るリンクの文言が入っている
    insert.run(
      'bunshokaitou',
      'shotoku/250416',
      'shotoku',
      '産科医療補償制度の給付金',
      'https://www.nta.go.jp/law/bunshokaito/shotoku/250416/index.htm',
      '2026-09-08T07:27:21.701Z',
      hojoTextWithNav,
      '[]',
      'hash-250416-old'
    );
    // 国税局系: もともと入っていない
    insert.run(
      'bunshokaitou',
      'tokyo/shohi/251017',
      'shohi',
      '人工衛星打上げ輸送サービス',
      'https://www.nta.go.jp/about/organization/tokyo/bunshokaito/shohi/251017/index.htm',
      '2026-09-08T07:27:21.701Z',
      kyokuText,
      '[]',
      'hash-251017'
    );
    // hash を持たない行（未計算）
    insert.run(
      'bunshokaitou',
      'hojin/240101',
      'hojin',
      '法人税の照会',
      'https://www.nta.go.jp/law/bunshokaito/hojin/240101/index.htm',
      '2026-09-08T07:27:21.701Z',
      hojoTextWithNav,
      '[]',
      null
    );
    // 他の種別は触らない（同じ文言があっても）。v8 → v9 でも触らない種別として tax-answer を使う
    insert.run(
      'tax-answer',
      '1535',
      'shotoku',
      'NISA制度',
      'https://example.com/1535.htm',
      '2026-09-07T00:00:00Z',
      hojoTextWithNav,
      '[]',
      'hash-1535'
    );
    db.prepare(`UPDATE schema_meta SET value = '7' WHERE key = 'schema_version'`).run();
  }

  function selectDoc(docId: string): { full_text: string; content_hash: string | null } {
    return db
      .prepare('SELECT full_text, content_hash FROM document WHERE doc_id = ?')
      .get(docId) as { full_text: string; content_hash: string | null };
  }

  beforeEach(() => {
    db = new Database(':memory:');
    seedV7Database();
    initSchema(db); // v7 と判定され migrateV7ToV8 が走る
  });
  afterEach(() => {
    db.close();
  });

  it('schema_version が最新になる', () => {
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(10);
  });

  it('本庁系の本文は「以上」で終わり、content_hash は計算し直される', () => {
    const row = selectDoc('shotoku/250416');
    expect(row.full_text).toBe(hojoText);
    const expected = createHash('sha1')
      .update('bunshokaitou\nshotoku/250416\n産科医療補償制度の給付金\n')
      .update(hojoText)
      .digest('hex');
    expect(row.content_hash).toBe(expected);
  });

  it('国税局系の本文と content_hash は変わらない', () => {
    const row = selectDoc('tokyo/shohi/251017');
    expect(row.full_text).toBe(kyokuText);
    expect(row.content_hash).toBe('hash-251017');
  });

  it('hash を持っていなかった行は本文だけ直り、hash は NULL のまま', () => {
    const row = selectDoc('hojin/240101');
    expect(row.full_text).toBe(hojoText);
    expect(row.content_hash).toBeNull();
  });

  it('他の種別（tax-answer）は触らない', () => {
    const row = selectDoc('1535');
    expect(row.full_text).toBe(hojoTextWithNav);
    expect(row.content_hash).toBe('hash-1535');
  });

  it('FTS5 の索引からも案内文が消える', () => {
    const hits = db
      .prepare(
        `SELECT d.doc_id FROM document_fts f JOIN document d ON d.id = f.rowid WHERE document_fts MATCH ? ORDER BY d.doc_id`
      )
      .all('"回答はこちら"') as Array<{ doc_id: string }>;
    expect(hits.map((h) => h.doc_id)).toEqual(['1535']);
  });

  it('もう一度開いても何も変わらない（冪等）', () => {
    const before = selectDoc('shotoku/250416');
    initSchema(db);
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(selectDoc('shotoku/250416')).toEqual(before);
  });
});

describe('initSchema — v8 → v9 (Issue #45 の続き): 改正通達・事務運営指針の本文からも案内文を除く', () => {
  let db: DatabaseT.Database;

  const body =
    '課税局 課個 2-3\n各国税局長 殿\n消費税法基本通達の一部改正について\n別紙のとおり改める';
  const guidance = '※PDFファイルが開けない、印刷できないなどの場合はこちらをご覧ください。';
  const bodyWithGuidance = `${body}\n${guidance}`;

  /** v9 のスキーマに 0.20.1 までの parser が入れた本文を置き、schema_version だけ v8 に戻した DB を作る */
  function seedV8Database(): void {
    initSchema(db);
    const insert = db.prepare(
      `INSERT INTO document(doc_type, doc_id, taxonomy, title, source_url, fetched_at, full_text, attached_pdfs_json, content_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insert.run(
      'kaisei',
      '0026003-067',
      'shohi',
      '消費税法基本通達の一部改正について（法令解釈通達）',
      'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/kaisei/0026003-067/index.htm',
      '2026-09-08T07:27:21.701Z',
      bodyWithGuidance,
      '[]',
      'hash-0026003-067-old'
    );
    insert.run(
      'jimu-unei',
      'shotoku/shinkoku/170331',
      'shotoku',
      '申告所得税の事務運営指針',
      'https://www.nta.go.jp/law/jimu-unei/shotoku/shinkoku/170331/index.htm',
      '2026-09-08T07:27:21.701Z',
      bodyWithGuidance,
      '[]',
      null
    );
    // 案内文の無い行は触らない
    insert.run(
      'kaisei',
      '0025004-026',
      'hojin',
      '法人税基本通達の一部改正について',
      'https://www.nta.go.jp/law/tsutatsu/kihon/hojin/kaisei/0025004-026/index.htm',
      '2026-09-08T07:27:21.701Z',
      body,
      '[]',
      'hash-0025004-026'
    );
    db.prepare(`UPDATE schema_meta SET value = '8' WHERE key = 'schema_version'`).run();
  }

  function selectDoc(docId: string): { full_text: string; content_hash: string | null } {
    return db
      .prepare('SELECT full_text, content_hash FROM document WHERE doc_id = ?')
      .get(docId) as { full_text: string; content_hash: string | null };
  }

  beforeEach(() => {
    db = new Database(':memory:');
    seedV8Database();
    initSchema(db); // v8 と判定され migrateV8ToV9 が走る
  });
  afterEach(() => {
    db.close();
  });

  it('schema_version が最新になる', () => {
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(10);
  });

  it('改正通達の本文から案内文が消え、content_hash は計算し直される', () => {
    const row = selectDoc('0026003-067');
    expect(row.full_text).toBe(body);
    const expected = createHash('sha1')
      .update('kaisei\n0026003-067\n消費税法基本通達の一部改正について（法令解釈通達）\n')
      .update(body)
      .digest('hex');
    expect(row.content_hash).toBe(expected);
  });

  it('事務運営指針の本文から案内文が消え、hash を持っていなかった行は NULL のまま', () => {
    const row = selectDoc('shotoku/shinkoku/170331');
    expect(row.full_text).toBe(body);
    expect(row.content_hash).toBeNull();
  });

  it('案内文の無い行は本文も content_hash も変わらない', () => {
    const row = selectDoc('0025004-026');
    expect(row.full_text).toBe(body);
    expect(row.content_hash).toBe('hash-0025004-026');
  });

  it('FTS5 の索引からも案内文が消える', () => {
    const hits = db
      .prepare(`SELECT COUNT(*) AS n FROM document_fts WHERE document_fts MATCH ?`)
      .get('"PDFファイルが開けない"') as { n: number };
    expect(hits.n).toBe(0);
  });

  it('もう一度開いても何も変わらない（冪等）', () => {
    const before = selectDoc('0026003-067');
    initSchema(db);
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(selectDoc('0026003-067')).toEqual(before);
  });
});

describe('initSchema — v9 → v10 (Issue #54): bulk download 済みの印と目次の保存', () => {
  let db: DatabaseT.Database;

  /**
   * v10 のスキーマに通達を 2 つ置き、v9 の形（bulk_completed_at 列と tsutatsu_toc 表が無い）に戻す。
   * 消基通は bulk download が書いた節（last_modified / etag あり）、所基通は国税庁サイトから取って
   * 書き戻した節（どちらも無い）だけを持つ
   */
  function seedV9Database(): void {
    initSchema(db);
    const insertTsutatsu = db.prepare(
      `INSERT INTO tsutatsu(formal_name, abbr, source_root_url) VALUES (?, ?, ?) RETURNING id`
    );
    const shohi = (
      insertTsutatsu.get(
        '消費税法基本通達',
        '消基通',
        'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/'
      ) as { id: number }
    ).id;
    const shotoku = (
      insertTsutatsu.get(
        '所得税基本通達',
        '所基通',
        'https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/'
      ) as { id: number }
    ).id;
    const insertSection = db.prepare(
      `INSERT INTO section(tsutatsu_id, chapter_number, section_number, title, url, fetched_at, last_modified, etag)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insertSection.run(shohi, 1, 1, '第1節', 'u1', '2026-09-01T00:00:00.000Z', 'lm', null);
    insertSection.run(shohi, 1, 2, '第2節', 'u2', '2026-09-02T00:00:00.000Z', null, '"e"');
    insertSection.run(shotoku, 4, 5, '法第31条関係', 'u3', '2026-09-03T00:00:00.000Z', null, null);
    db.exec('DROP TABLE tsutatsu_toc');
    db.exec('ALTER TABLE tsutatsu DROP COLUMN bulk_completed_at');
    db.prepare(`UPDATE schema_meta SET value = '9' WHERE key = 'schema_version'`).run();
  }

  function bulkCompletedAt(formalName: string): string | null {
    return (
      db
        .prepare('SELECT bulk_completed_at AS at FROM tsutatsu WHERE formal_name = ?')
        .get(formalName) as { at: string | null }
    ).at;
  }

  beforeEach(() => {
    db = new Database(':memory:');
    seedV9Database();
    initSchema(db); // v9 と判定され migrateV9ToV10 が走る
  });
  afterEach(() => {
    db.close();
  });

  it('schema_version が最新になる', () => {
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(10);
  });

  it('bulk download が書いた節を持つ通達は、その節の fetched_at の最大値で bulk_completed_at が埋まる', () => {
    expect(bulkCompletedAt('消費税法基本通達')).toBe('2026-09-02T00:00:00.000Z');
  });

  it('書き戻した節しか無い通達の bulk_completed_at は NULL のまま', () => {
    expect(bulkCompletedAt('所得税基本通達')).toBeNull();
  });

  it('tsutatsu_toc 表ができる', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tsutatsu_toc'")
      .all();
    expect(tables).toHaveLength(1);
  });

  it('もう一度開いても何も変わらない（冪等）', () => {
    initSchema(db);
    expect(bulkCompletedAt('消費税法基本通達')).toBe('2026-09-02T00:00:00.000Z');
    expect(bulkCompletedAt('所得税基本通達')).toBeNull();
  });
});
