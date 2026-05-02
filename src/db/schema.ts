/**
 * SQLite スキーマと初期化
 *
 * DESIGN.md「Phase 2 設計」に基づく。tsutatsu / chapter / section / clause +
 * FTS5 (trigram) インデックスを構築する。
 *
 * - clause テーブルは `(tsutatsu_id, clause_number)` に UNIQUE INDEX を貼り、
 *   clause→URL lookup を高速化する（Phase 1d 残課題への対応）
 * - clause_fts は trigram tokenizer で日本語混在テキストを N-gram 検索可能に
 *
 * SCHEMA_VERSION を上げたら migrate() がスキーマ再構築する。
 * Phase 2a 段階ではマイグレーションは「DROP & CREATE」で十分（ローカルキャッシュなので）。
 */

import type DatabaseT from 'better-sqlite3';

/**
 * スキーマバージョン。スキーマ変更時に上げる。
 *
 * - v1: 初版（Phase 2a-c）
 * - v2: section に content_hash カラムを追加（Phase 2e: 改正検知用）
 * - v3: document / document_fts テーブル追加（Phase 3b: 改正通達・事務運営指針・文書回答事例）
 */
export const SCHEMA_VERSION = 3;

const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 通達メタ
CREATE TABLE IF NOT EXISTS tsutatsu (
  id INTEGER PRIMARY KEY,
  formal_name TEXT NOT NULL UNIQUE,         -- 例: '消費税法基本通達'
  abbr TEXT NOT NULL,                       -- 例: '消基通'
  source_root_url TEXT NOT NULL             -- 例: 'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/'
);

-- 章
CREATE TABLE IF NOT EXISTS chapter (
  tsutatsu_id INTEGER NOT NULL REFERENCES tsutatsu(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  PRIMARY KEY (tsutatsu_id, number)
);

-- 節
CREATE TABLE IF NOT EXISTS section (
  tsutatsu_id INTEGER NOT NULL REFERENCES tsutatsu(id) ON DELETE CASCADE,
  chapter_number INTEGER NOT NULL,
  section_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  url TEXT,
  fetched_at TEXT NOT NULL,
  -- v2: 改正検知用の content hash（投入時の clauses fullText 連結 SHA-1）
  -- NULL は v1 から移行直後で未計算の状態を表す
  content_hash TEXT,
  PRIMARY KEY (tsutatsu_id, chapter_number, section_number)
);

-- clause（条）— Phase 1d 残課題への解（clause→URL lookup）
CREATE TABLE IF NOT EXISTS clause (
  id INTEGER PRIMARY KEY,
  tsutatsu_id INTEGER NOT NULL REFERENCES tsutatsu(id) ON DELETE CASCADE,
  clause_number TEXT NOT NULL,              -- '1-4-1' / '1-4-13の2' / '2-4の2' （通達ごとに体系違う）
  source_url TEXT NOT NULL,                 -- 各 clause の取得元 URL（一次情報源）
  chapter_number INTEGER,
  section_number INTEGER,
  title TEXT NOT NULL,
  full_text TEXT NOT NULL,
  paragraphs_json TEXT NOT NULL             -- JSON: TsutatsuParagraph[]
);
-- (tsutatsu_id, clause_number) で一意検索 = clause→URL lookup
CREATE UNIQUE INDEX IF NOT EXISTS idx_clause_lookup
  ON clause(tsutatsu_id, clause_number);

-- 全文検索（FTS5 trigram）
-- content='clause' で contentless 形式にし、容量を節約
CREATE VIRTUAL TABLE IF NOT EXISTS clause_fts USING fts5(
  clause_number,
  title,
  full_text,
  content='clause',
  content_rowid='id',
  tokenize='trigram'
);

-- clause 挿入時に FTS インデックスを自動更新（後述の trigger）
CREATE TRIGGER IF NOT EXISTS clause_ai AFTER INSERT ON clause BEGIN
  INSERT INTO clause_fts(rowid, clause_number, title, full_text)
  VALUES (new.id, new.clause_number, new.title, new.full_text);
END;
CREATE TRIGGER IF NOT EXISTS clause_ad AFTER DELETE ON clause BEGIN
  INSERT INTO clause_fts(clause_fts, rowid, clause_number, title, full_text)
  VALUES ('delete', old.id, old.clause_number, old.title, old.full_text);
END;
CREATE TRIGGER IF NOT EXISTS clause_au AFTER UPDATE ON clause BEGIN
  INSERT INTO clause_fts(clause_fts, rowid, clause_number, title, full_text)
  VALUES ('delete', old.id, old.clause_number, old.title, old.full_text);
  INSERT INTO clause_fts(rowid, clause_number, title, full_text)
  VALUES (new.id, new.clause_number, new.title, new.full_text);
END;

-- ========================================================================
-- v3 (Phase 3b): 改正通達 / 事務運営指針 / 文書回答事例 を共通テーブルで扱う
-- ========================================================================
-- 通達本体 (clause) と違い、これらは「1 文書 = 1 レコード」のフラットな構造。
-- doc_type で種別を区別、(doc_type, doc_id) で一意。
CREATE TABLE IF NOT EXISTS document (
  id INTEGER PRIMARY KEY,
  doc_type TEXT NOT NULL,             -- 'kaisei' / 'jimu-unei' / 'bunshokaitou'
  doc_id TEXT NOT NULL,               -- 例: '0026003-067' (新形式) / '240401' (旧形式)
  taxonomy TEXT,                      -- 税目フォルダ。例: 'shohi' / 'shotoku' / 'hojin' / 'sisan/sozoku'
  title TEXT NOT NULL,                -- 例: '消費税法基本通達の一部改正について（法令解釈通達）'
  issued_at TEXT,                     -- 発出日 (ISO YYYY-MM-DD)
  issuer TEXT,                        -- 例: '国税庁長官' / '各国税局長 殿' のような宛先・発出者
  source_url TEXT NOT NULL,           -- 個別 HTML の URL
  fetched_at TEXT NOT NULL,
  full_text TEXT NOT NULL,            -- 本文（normalize 済み）
  attached_pdfs_json TEXT NOT NULL,   -- JSON: [{ title, url, sizeKb? }]
  content_hash TEXT,                  -- 改正検知用 SHA-1
  UNIQUE(doc_type, doc_id)
);
CREATE INDEX IF NOT EXISTS idx_document_lookup ON document(doc_type, doc_id);
CREATE INDEX IF NOT EXISTS idx_document_taxonomy ON document(doc_type, taxonomy);

-- 全文検索（FTS5 trigram）
CREATE VIRTUAL TABLE IF NOT EXISTS document_fts USING fts5(
  doc_type UNINDEXED,
  taxonomy UNINDEXED,
  title,
  full_text,
  content='document',
  content_rowid='id',
  tokenize='trigram'
);

-- document trigger（clause と同様）
CREATE TRIGGER IF NOT EXISTS document_ai AFTER INSERT ON document BEGIN
  INSERT INTO document_fts(rowid, doc_type, taxonomy, title, full_text)
  VALUES (new.id, new.doc_type, new.taxonomy, new.title, new.full_text);
END;
CREATE TRIGGER IF NOT EXISTS document_ad AFTER DELETE ON document BEGIN
  INSERT INTO document_fts(document_fts, rowid, doc_type, taxonomy, title, full_text)
  VALUES ('delete', old.id, old.doc_type, old.taxonomy, old.title, old.full_text);
END;
CREATE TRIGGER IF NOT EXISTS document_au AFTER UPDATE ON document BEGIN
  INSERT INTO document_fts(document_fts, rowid, doc_type, taxonomy, title, full_text)
  VALUES ('delete', old.id, old.doc_type, old.taxonomy, old.title, old.full_text);
  INSERT INTO document_fts(rowid, doc_type, taxonomy, title, full_text)
  VALUES (new.id, new.doc_type, new.taxonomy, new.title, new.full_text);
END;
`;

/**
 * DB を初期化（スキーマ作成 + バージョン記録）。
 * 既にスキーマがある場合は CREATE IF NOT EXISTS で skip。
 */
export function initSchema(db: DatabaseT.Database): void {
  db.exec(SCHEMA_SQL);
  const cur = getSchemaVersion(db);
  if (cur === null) {
    db.prepare('INSERT INTO schema_meta(key, value) VALUES (?, ?)').run(
      'schema_version',
      String(SCHEMA_VERSION)
    );
  } else if (cur !== SCHEMA_VERSION) {
    // Phase 2a では「不一致なら DROP & CREATE」の単純戦略
    dropAndRecreate(db);
  }
}

/** schema_meta から schema_version を読む。未設定なら null */
export function getSchemaVersion(db: DatabaseT.Database): number | null {
  // schema_meta テーブルが無い段階で呼ばれる場合に備える
  try {
    const row = db.prepare('SELECT value FROM schema_meta WHERE key = ?').get('schema_version') as
      | { value?: string }
      | undefined;
    if (!row?.value) return null;
    const n = parseInt(row.value, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** スキーマ全体を DROP して再作成（単純マイグレーション） */
function dropAndRecreate(db: DatabaseT.Database): void {
  db.exec(`
    DROP TRIGGER IF EXISTS document_au;
    DROP TRIGGER IF EXISTS document_ad;
    DROP TRIGGER IF EXISTS document_ai;
    DROP TABLE IF EXISTS document_fts;
    DROP TABLE IF EXISTS document;
    DROP TRIGGER IF EXISTS clause_au;
    DROP TRIGGER IF EXISTS clause_ad;
    DROP TRIGGER IF EXISTS clause_ai;
    DROP TABLE IF EXISTS clause_fts;
    DROP TABLE IF EXISTS clause;
    DROP TABLE IF EXISTS section;
    DROP TABLE IF EXISTS chapter;
    DROP TABLE IF EXISTS tsutatsu;
    DROP TABLE IF EXISTS schema_meta;
  `);
  db.exec(SCHEMA_SQL);
  db.prepare('INSERT INTO schema_meta(key, value) VALUES (?, ?)').run(
    'schema_version',
    String(SCHEMA_VERSION)
  );
}

/**
 * DB の中身を全削除（テスト用 / 強制再 DL 用）
 */
export function clearAllData(db: DatabaseT.Database): void {
  db.exec(`
    DELETE FROM document;
    DELETE FROM clause;
    DELETE FROM section;
    DELETE FROM chapter;
    DELETE FROM tsutatsu;
    INSERT INTO clause_fts(clause_fts) VALUES ('rebuild');
    INSERT INTO document_fts(document_fts) VALUES ('rebuild');
  `);
}
