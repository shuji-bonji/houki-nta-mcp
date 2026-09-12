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

import { createHash } from 'node:crypto';
import type DatabaseT from 'better-sqlite3';

import { normalizeClauseNumber, normalizeJpText } from '../services/text-normalize.js';

/**
 * スキーマバージョン。スキーマ変更時に上げる。
 *
 * - v1: 初版（Phase 2a-c）
 * - v2: section に content_hash カラムを追加（Phase 2e: 改正検知用）
 * - v3: document / document_fts テーブル追加（Phase 3b: 改正通達・事務運営指針・文書回答事例）
 * - v4: section / document に last_modified / etag を追加（Phase 6-2: 差分 bulk DL）
 * - v5: 投入済みテキストを共通実装の正規化で入れ直す（Issue #27: 全角英字が半角にならない）
 */
export const SCHEMA_VERSION = 5;

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
  -- v4 (Phase 6-2): 差分 bulk DL 用。If-Modified-Since に渡す HTTP Last-Modified
  -- ヘッダ値（RFC 7232 形式）と ETag を保持する。NULL は初回未取得を示す。
  last_modified TEXT,
  etag TEXT,
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
  -- v4 (Phase 6-2): 差分 bulk DL 用
  last_modified TEXT,
  etag TEXT,
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
 *
 * バージョン不一致時は可能な限り **追加マイグレーション** で既存データを保つ。
 * 未知の遷移パスのみ `dropAndRecreate` にフォールバックする。
 */
export function initSchema(db: DatabaseT.Database): void {
  db.exec(SCHEMA_SQL);
  const cur = getSchemaVersion(db);
  if (cur === null) {
    db.prepare('INSERT INTO schema_meta(key, value) VALUES (?, ?)').run(
      'schema_version',
      String(SCHEMA_VERSION)
    );
    return;
  }
  if (cur === SCHEMA_VERSION) return;

  // 既存 bulk DL データを保ったまま進めるパスは 1 段ずつ順に適用する。
  // 古い DB（v3）からでも v5 まで辿り着けるように、if を並べて数珠つなぎにする。
  let version = cur;
  if (version === 3) {
    migrateV3ToV4(db);
    version = 4;
  }
  if (version === 4) {
    migrateV4ToV5(db);
    version = 5;
  }
  if (version === SCHEMA_VERSION) {
    setSchemaVersion(db, SCHEMA_VERSION);
    return;
  }

  // 想定外の遷移は DROP & CREATE（既存データは失われる）
  dropAndRecreate(db);
}

/**
 * v3 → v4 マイグレーション（Phase 6-2: 差分 bulk DL）
 *
 * 既存 bulk DL データを保ったまま `last_modified` / `etag` カラムを追加する。
 * 既存行は NULL のままで、初回 fetch 時に値が入る（`If-Modified-Since` を送れない
 * 状態だが、200 で取得して以降は 304 が効く）。
 */
function migrateV3ToV4(db: DatabaseT.Database): void {
  const sectionCols = listColumns(db, 'section');
  if (!sectionCols.has('last_modified')) {
    db.exec(`ALTER TABLE section ADD COLUMN last_modified TEXT`);
  }
  if (!sectionCols.has('etag')) {
    db.exec(`ALTER TABLE section ADD COLUMN etag TEXT`);
  }
  const docCols = listColumns(db, 'document');
  if (!docCols.has('last_modified')) {
    db.exec(`ALTER TABLE document ADD COLUMN last_modified TEXT`);
  }
  if (!docCols.has('etag')) {
    db.exec(`ALTER TABLE document ADD COLUMN etag TEXT`);
  }
}

/**
 * v4 → v5 マイグレーション（Issue #27: 正規化を共通実装に揃える）
 *
 * v0.14.2 までの `normalizeJpText` は全角英字（`Ａ-Ｚ` `ａ-ｚ`）を半角にしていなかった。
 * そのため DB には `ＮＩＳＡ` と `NISA` が別々の文字列として入っており、どちらで
 * 検索しても片方しか出てこない。共通実装に揃えるだけでは、既に入っている文字列が
 * 古い正規化のまま残るので、ここで入れ直す。
 *
 * ## 再ダウンロードは要らない
 *
 * 古い正規化の変換（数字・ハイフン・チルダ・全角スペース）は新しい正規化の変換の
 * 部分集合で、互いに干渉しない。そのため保存済みの文字列にもう一度新しい正規化を
 * 通すと、原文から通したのと同じ結果になる（`new(old(x)) === new(x)`）。
 * 国税庁サイトへのアクセスは発生しない。
 *
 * FTS5 は trigger で base テーブルに追随するので、UPDATE すれば索引も入れ替わる。
 *
 * ## content_hash の扱い
 *
 * `document` は 1 行だけで hash を計算できるので、入れ直した文字列で計算し直す。
 * こうしないと次の bulk DL で全件が「更新された」と判定される。
 *
 * `section` の hash は配下 clause の並び順に依存し、その順序は DB から復元できない
 * （個別 clause の差し替えで id の順が入れ替わるため）。ここでは NULL にして
 * 「未計算」に戻す。次の bulk DL でその節だけ入れ直され、hash が付き直る。
 */
function migrateV4ToV5(db: DatabaseT.Database): void {
  const tx = db.transaction(() => {
    renormalizeClauses(db);
    renormalizeSections(db);
    renormalizeDocuments(db);
  });
  tx();
}

/** clause の条番号・題名・本文・段落 JSON を入れ直す */
function renormalizeClauses(db: DatabaseT.Database): void {
  const rows = db
    .prepare('SELECT id, clause_number, title, full_text, paragraphs_json FROM clause')
    .all() as Array<{
    id: number;
    clause_number: string;
    title: string;
    full_text: string;
    paragraphs_json: string;
  }>;
  const update = db.prepare(
    'UPDATE clause SET clause_number = ?, title = ?, full_text = ?, paragraphs_json = ? WHERE id = ?'
  );
  for (const row of rows) {
    const clauseNumber = normalizeClauseNumber(row.clause_number);
    const title = normalizeJpText(row.title);
    const fullText = normalizeJpText(row.full_text);
    const paragraphsJson = renormalizeParagraphsJson(row.paragraphs_json);
    if (
      clauseNumber === row.clause_number &&
      title === row.title &&
      fullText === row.full_text &&
      paragraphsJson === row.paragraphs_json
    ) {
      continue;
    }
    update.run(clauseNumber, title, fullText, paragraphsJson, row.id);
  }
}

/**
 * `paragraphs_json`（`TsutatsuParagraph[]`）の `text` だけ入れ直す。
 *
 * 読めない値はそのまま返す。ここで例外を投げると DB が開けなくなるため。
 */
function renormalizeParagraphsJson(json: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return json;
  }
  if (!Array.isArray(parsed)) return json;
  const next = parsed.map((p) => {
    if (typeof p !== 'object' || p === null) return p;
    const paragraph = p as { text?: unknown };
    if (typeof paragraph.text !== 'string') return p;
    return { ...paragraph, text: normalizeJpText(paragraph.text) };
  });
  return JSON.stringify(next);
}

/** section の題名を入れ直し、content_hash を未計算に戻す */
function renormalizeSections(db: DatabaseT.Database): void {
  const rows = db
    .prepare('SELECT tsutatsu_id, chapter_number, section_number, title, content_hash FROM section')
    .all() as Array<{
    tsutatsu_id: number;
    chapter_number: number;
    section_number: number;
    title: string;
    content_hash: string | null;
  }>;
  const update = db.prepare(
    `UPDATE section SET title = ?, content_hash = NULL
     WHERE tsutatsu_id = ? AND chapter_number = ? AND section_number = ?`
  );
  for (const row of rows) {
    const title = normalizeJpText(row.title);
    if (title === row.title && row.content_hash === null) continue;
    update.run(title, row.tsutatsu_id, row.chapter_number, row.section_number);
  }
}

/** document の題名・本文を入れ直し、content_hash を計算し直す */
function renormalizeDocuments(db: DatabaseT.Database): void {
  const rows = db
    .prepare('SELECT id, doc_type, doc_id, title, full_text, content_hash FROM document')
    .all() as Array<{
    id: number;
    doc_type: string;
    doc_id: string;
    title: string;
    full_text: string;
    content_hash: string | null;
  }>;
  const update = db.prepare(
    'UPDATE document SET title = ?, full_text = ?, content_hash = ? WHERE id = ?'
  );
  for (const row of rows) {
    const title = normalizeJpText(row.title);
    const fullText = normalizeJpText(row.full_text);
    // hash を持っていなかった行には付けない（「未計算」のままにしておく）
    const contentHash =
      row.content_hash === null
        ? null
        : computeDocumentContentHash(row.doc_type, row.doc_id, title, fullText);
    if (title === row.title && fullText === row.full_text && contentHash === row.content_hash) {
      continue;
    }
    update.run(title, fullText, contentHash, row.id);
  }
}

/**
 * document の content_hash。各 bulk downloader の計算式と同じ形にそろえてある。
 *
 * 元の式は `title` に `normalizeJpText` を掛けるものと掛けないものがあるが、
 * 入れ直したあとの `title` は正規化済みで、正規化は何度通しても結果が変わらないので、
 * どちらの式とも一致する。
 */
function computeDocumentContentHash(
  docType: string,
  docId: string,
  title: string,
  fullText: string
): string {
  const h = createHash('sha1');
  h.update(docType);
  h.update('\n');
  h.update(docId);
  h.update('\n');
  h.update(title);
  h.update('\n');
  h.update(fullText);
  return h.digest('hex');
}

/** 指定テーブルのカラム名集合を返す */
function listColumns(db: DatabaseT.Database, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

/** schema_meta の schema_version を更新する */
function setSchemaVersion(db: DatabaseT.Database, v: number): void {
  db.prepare(
    `INSERT INTO schema_meta(key, value) VALUES ('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(String(v));
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
