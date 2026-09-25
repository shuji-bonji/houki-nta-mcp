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

import { stripNtaNavigationLines } from '../services/nta-navigation-text.js';
import { normalizeClauseNumber, normalizeJpText } from '../services/text-normalize.js';

/**
 * スキーマバージョン。スキーマ変更時に上げる。
 *
 * - v1: 初版（Phase 2a-c）
 * - v2: section に content_hash カラムを追加（Phase 2e: 改正検知用）
 * - v3: document / document_fts テーブル追加（Phase 3b: 改正通達・事務運営指針・文書回答事例）
 * - v4: section / document に last_modified / etag を追加（Phase 6-2: 差分 bulk DL）
 * - v5: 投入済みテキストを共通実装の正規化で入れ直す（Issue #27: 全角英字が半角にならない）
 * - v6: document に structured_json を追加（Issue #29: 取得ツールが DB から live と同じ構造を返せるようにする）
 * - v7: document に orphaned_at を追加（Issue #30: 国税庁の索引から消えた文書に印を付ける）
 * - v8: 文書回答事例の full_text から国税庁サイトの案内文の行を除く（Issue #45: 「←上記照会の内容に対する回答はこちら」）
 * - v9: 改正通達・事務運営指針の full_text からも案内文の行を除く（Issue #45 の続き: 「※PDFファイルが開けない…こちらをご覧ください。」）
 * - v10: tsutatsu に bulk_completed_at、目次を保存する tsutatsu_toc を追加（Issue #54: 国税庁サイトからの取得を基本通達 4 種で成立させる）
 */
export const SCHEMA_VERSION = 10;

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
  source_root_url TEXT NOT NULL,            -- 例: 'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/'
  -- v10 (Issue #54): bulk download が全章を取り終えた日時。章を絞った実行と、
  -- nta_get_tsutatsu が国税庁サイトから取った節の書き戻しでは書かない。
  -- NULL の通達は、DB に無い条項を国税庁サイトから取る
  bulk_completed_at TEXT
);

-- v10 (Issue #54): 目次ページの解析結果。nta_get_tsutatsu が候補ページを決めるために使い回す。
-- 使い回す期間は設けず、条項が見つからないときにだけ条件付き取得（If-Modified-Since /
-- If-None-Match）で取り直す。目次の URL を鍵にするので、世代の移行でルート URL を変えると
-- 古い目次は使われなくなる
CREATE TABLE IF NOT EXISTS tsutatsu_toc (
  url TEXT PRIMARY KEY,                     -- 例: 'https://www.nta.go.jp/law/tsutatsu/kihon/hojin/01.htm'
  formal_name TEXT NOT NULL,                -- 例: '法人税基本通達'
  toc_json TEXT NOT NULL,                   -- JSON: TsutatsuToc
  fetched_at TEXT NOT NULL,
  last_modified TEXT,
  etag TEXT
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
  -- v6 (Issue #29): パーサが組み立てた構造の JSON。質疑応答事例とタックスアンサーで使う。
  -- full_text は見出しを含む平文なので、そこからは段落の区切りや節の構造を戻せない。
  -- sourceUrl / fetchedAt は列を正とするため、この JSON には入れない。
  -- NULL は「この種別では使わない」か「v6 より前に投入した行」を表す。
  structured_json TEXT,
  -- v7 (Issue #30): 国税庁の索引から消えたことを最初に確認した日時。
  -- NULL は索引にあることを表す。索引から消えても行は消さない（過去の課税期間の判断では
  -- 依然として意味を持つため）。次の bulk download で索引に戻っていれば NULL に戻す。
  orphaned_at TEXT,
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
  if (version === 5) {
    migrateV5ToV6(db);
    version = 6;
  }
  if (version === 6) {
    migrateV6ToV7(db);
    version = 7;
  }
  if (version === 7) {
    migrateV7ToV8(db);
    version = 8;
  }
  if (version === 8) {
    migrateV8ToV9(db);
    version = 9;
  }
  if (version === 9) {
    migrateV9ToV10(db);
    version = 10;
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

/**
 * v5 → v6 マイグレーション（Issue #29: 取得ツールが DB から構造を返せるようにする）
 *
 * `document` に `structured_json` 列を足すだけで、既存の行は NULL のまま残る。
 * NULL の行は `nta_get_qa` / `nta_get_tax_answer` が国税庁サイトから取得して埋めるか、
 * 次の `--bulk-download-qa` / `--bulk-download-tax-answer` が埋める。
 * 再ダウンロードを強制しないので、この移行で国税庁サイトへのアクセスは発生しない。
 */
function migrateV5ToV6(db: DatabaseT.Database): void {
  const docCols = listColumns(db, 'document');
  if (!docCols.has('structured_json')) {
    db.exec(`ALTER TABLE document ADD COLUMN structured_json TEXT`);
  }
}

/**
 * v6 → v7 マイグレーション（Issue #30: 索引から消えた文書に印を付ける）
 *
 * `document` に `orphaned_at` 列を足すだけで、既存の行は NULL（＝索引にある）のまま残る。
 * 印が付くのは次の `--bulk-download-*` のときで、この移行では国税庁サイトへのアクセスは
 * 発生しない。
 */
function migrateV6ToV7(db: DatabaseT.Database): void {
  const docCols = listColumns(db, 'document');
  if (!docCols.has('orphaned_at')) {
    db.exec(`ALTER TABLE document ADD COLUMN orphaned_at TEXT`);
  }
}

/**
 * v7 → v8 マイグレーション（Issue #45: 文書回答事例の本文から案内文を除く）
 *
 * 0.20.0 までの `parseBunshoPage` は、本庁系の別紙 (another.htm) の末尾にある
 * 「←上記照会の内容に対する回答はこちら」（index.htm へ戻るリンクの文言）と、
 * サイト共通の「※PDFファイルが開けない、印刷できないなどの場合はこちらをご覧ください。」を
 * 本文の段落として拾っていた。parser は直したが、DB に入っている `full_text` には残っているので、
 * `doc_type = 'bunshokaitou'` の行から該当する行を除く。
 *
 * ## 再ダウンロードは要らない
 *
 * 除くのは案内文の行だけで、他の行には触れない。直した parser を原文に通した結果と同じになる。
 * 国税庁サイトへのアクセスは発生しない。FTS5 は trigger で追随するので、索引からも消える。
 *
 * ## content_hash の扱い
 *
 * v4 → v5 と同じく、除いたあとの本文で計算し直す。こうしないと次の bulk DL で
 * 本庁系の全件が「更新された」と判定される。hash を持っていなかった行は NULL のまま
 */
function migrateV7ToV8(db: DatabaseT.Database): void {
  const tx = db.transaction(() => {
    stripNavigationLines(db, ['bunshokaitou']);
  });
  tx();
}

/**
 * v8 → v9 マイグレーション（Issue #45 の続き: 改正通達・事務運営指針の本文からも案内文を除く）
 *
 * 0.20.1 までの `parseKaiseiPage` / `parseJimuUneiPage` は、本文の直後にあるサイト共通の
 * 「※PDFファイルが開けない、印刷できないなどの場合はこちらをご覧ください。」を本文の段落として
 * 拾っていた。v7 → v8 と同じ手順を `doc_type IN ('kaisei', 'jimu-unei')` に掛ける。
 * 質疑応答事例とタックスアンサーは parser が本文の要素だけを選んで組み立てるので、この文言は入らない。
 */
function migrateV8ToV9(db: DatabaseT.Database): void {
  const tx = db.transaction(() => {
    stripNavigationLines(db, ['kaisei', 'jimu-unei']);
  });
  tx();
}

/**
 * v9 → v10 マイグレーション（Issue #54: 国税庁サイトからの取得を基本通達 4 種で成立させる）
 *
 * `tsutatsu` に `bulk_completed_at` を足す（`tsutatsu_toc` は SCHEMA_SQL の
 * `CREATE TABLE IF NOT EXISTS` で作られる）。
 *
 * 既存の DB には、bulk download で入れた通達と、`nta_get_tsutatsu` が国税庁サイトから
 * 取って書き戻した節しか無い通達が混ざっている。bulk download が書いた節には
 * `last_modified` か `etag` が入り、書き戻しの節には入らないので、どちらかが入った節を
 * 持つ通達を「bulk download 済み」とみなし、その節の `fetched_at` の最大値で埋める。
 * 国税庁サイトへのアクセスは発生しない。
 */
function migrateV9ToV10(db: DatabaseT.Database): void {
  const tx = db.transaction(() => {
    const cols = listColumns(db, 'tsutatsu');
    if (!cols.has('bulk_completed_at')) {
      db.exec(`ALTER TABLE tsutatsu ADD COLUMN bulk_completed_at TEXT`);
    }
    db.exec(`
      UPDATE tsutatsu
      SET bulk_completed_at = (
        SELECT MAX(s.fetched_at) FROM section s
        WHERE s.tsutatsu_id = tsutatsu.id
          AND (s.last_modified IS NOT NULL OR s.etag IS NOT NULL)
      )
      WHERE bulk_completed_at IS NULL
        AND EXISTS (
          SELECT 1 FROM section s
          WHERE s.tsutatsu_id = tsutatsu.id
            AND (s.last_modified IS NOT NULL OR s.etag IS NOT NULL)
        )
    `);
  });
  tx();
}

/** 指定した種別の full_text から案内文の行を除き、content_hash を計算し直す */
function stripNavigationLines(db: DatabaseT.Database, docTypes: string[]): void {
  const placeholders = docTypes.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT id, doc_type, doc_id, title, full_text, content_hash FROM document WHERE doc_type IN (${placeholders})`
    )
    .all(...docTypes) as Array<{
    id: number;
    doc_type: string;
    doc_id: string;
    title: string;
    full_text: string;
    content_hash: string | null;
  }>;
  const update = db.prepare('UPDATE document SET full_text = ?, content_hash = ? WHERE id = ?');
  for (const row of rows) {
    const fullText = stripNtaNavigationLines(row.full_text);
    if (fullText === row.full_text) continue;
    const contentHash =
      row.content_hash === null
        ? null
        : computeDocumentContentHash(
            row.doc_type,
            row.doc_id,
            normalizeJpText(row.title),
            fullText
          );
    update.run(fullText, contentHash, row.id);
  }
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
    DROP TABLE IF EXISTS tsutatsu_toc;
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
    DELETE FROM tsutatsu_toc;
    DELETE FROM tsutatsu;
    INSERT INTO clause_fts(clause_fts) VALUES ('rebuild');
    INSERT INTO document_fts(document_fts) VALUES ('rebuild');
  `);
}
