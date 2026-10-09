# DATABASE — SQLite + FTS5 スキーマ

houki-nta-mcp は国税庁公式サイトから取得したコンテンツをローカル SQLite に永続化し、FTS5（trigram tokenizer）で全文検索する。本ドキュメントは DB スキーマ・テーブル仕様・運用上の挙動をまとめる。

## DB ファイルの場所

```
${XDG_CACHE_HOME:-~/.cache}/houki-nta-mcp/cache.db
```

優先順（v0.25.0 から、どれで決まったかを「DB の場所の設定」の名前で表示する）:

1. CLI の `--db-path=<path>`（CLI だけ。MCP サーバーには渡せない）。設定の名前は `--db-path`
2. `HOUKI_NTA_DB_PATH` 環境変数（空文字は無いもの）。設定の名前は `HOUKI_NTA_DB_PATH`
3. `XDG_CACHE_HOME/houki-nta-mcp/cache.db`（空文字は無いもの）。設定の名前は `XDG_CACHE_HOME`
4. `~/.cache/houki-nta-mcp/cache.db`。設定の名前は `既定`

相対パスは、CLI を実行した・MCP サーバーを起動したときの作業フォルダーから決まる。

どの DB を開いているかは次で確かめられる（v0.25.0）。

- `houki-nta-mcp --status`: 実行したシェルの設定で開く DB の場所、その設定、同じフォルダーのほかの `cache*.db`、種別ごとの件数を出す。DB を作らず、移行もしない
- MCP サーバーの起動時のログ（標準エラー出力）: `started` の行の次に、`msg` が `DB: <絶対パス>（DB の場所の設定: <名前>）` の JSON の行（`meta` に `db_path`・`setting`）
- 検索ツールの応答の `freshness.db_path` と、「DB に 1 件も無い」ときの `hint` の中のパス（ホームディレクトリの部分は `~`）

DB を開けないとき（SQLite でないファイル、フォルダー、パスの途中が普通のファイル、DB のファイルを読む権限が無い、置き場所のフォルダー（またはパスの途中のフォルダー）に入る権限が無い）の扱い（v0.26.0、#144。入る権限の無いフォルダーは v0.27.0、#154）:

- 読むだけのツール（検索 6 ツール、`nta_get_kaisei_tsutatsu`・`nta_get_jimu_unei`・`nta_get_bunshokaitou`、`nta_inspect_pdf_meta`）: 「DB に 1 件も無い」ときの `DOC_NOT_FOUND`（`nta_search_tsutatsu` は `TSUTATSU_NOT_FOUND`）を返す。`hint` は `ローカル DB（<パス>）を開けません。` で始まり、`retryable: false`、開けない理由は `detail.cause`（ホームディレクトリは `~`）。投入の案内は付けない
- 書き戻すツール（`nta_get_tsutatsu`・`nta_get_qa`・`nta_get_tax_answer`）: DB を使わずに国税庁サイトから取って返し、DB には書かない。MCP サーバーのログに `warn` の行（`meta` に `db_path` と `cause`）を出す
- CLI（投入のフラグ・`--refresh-stale`・`--status`）: `[ERROR] DB を開けません: <文>` を出して終了コード 1（v0.25.x と同じ）

置き場所のフォルダー（またはパスの途中のフォルダー）に入る権限が無いときは、DB のファイルがあるかを確かめられない。v0.27.0 から、ファイルがあってもなくても「開けない」として上のとおりに扱う（v0.26.x では「ファイルが無い」と判定し、`--status` は「DB がまだありません」で終了コード 0、読むだけのツールは投入を案内していた）。開けない理由の文は、DB のパスを上にたどって、あることを確かめられた最も深いフォルダー（入る権限が無いのはこのフォルダー）を括弧に入れる。

```text
$ HOUKI_NTA_DB_PATH=/tmp/locked/cache.db houki-nta-mcp --status   # /tmp/locked は chmod 000
…
[ERROR] DB を開けません: EACCES: パスの途中のフォルダーに入る権限がありません (/tmp/locked)
```

フォルダーに入れて、書く権限だけが無い（`chmod 555` など）ときに DB のファイルが無ければ、今までどおり「ファイルが無い」として扱う。

既定のファイル名（`cache.db`）に DB の版は入れない。開発で版を上げるときは `HOUKI_NTA_DB_PATH` か `--db-path` で別のファイルを使う（`CONTRIBUTING.md` の「ローカル DB を使う開発」）。

加えて Phase 5 Resilience の baseline ファイルが同じディレクトリに作られる:

```
${XDG_CACHE_HOME:-~/.cache}/houki-nta-mcp/
├── cache.db                              # 本体
├── baseline-tsutatsu-shohi.json          # 4 通達分の bulk DL 履歴
├── baseline-tsutatsu-shotoku.json
├── baseline-tsutatsu-hojin.json
├── baseline-tsutatsu-sozoku.json
├── baseline-kaisei.json                  # 改正通達
├── baseline-jimu-unei.json               # 事務運営指針
├── baseline-bunshokaitou.json            # 文書回答事例
├── baseline-tax-answer.json              # タックスアンサー
└── baseline-qa-jirei.json                # 質疑応答事例
```

## スキーマ全体像

```mermaid
erDiagram
  tsutatsu ||--o{ chapter : has
  tsutatsu ||--o{ section : has
  tsutatsu ||--o{ clause : has
  clause ||..|| clause_fts : "FTS5 index"
  document ||..|| document_fts : "FTS5 index"

  tsutatsu {
    int id PK
    string formal_name UK
    string abbr
    string source_root_url
  }
  chapter {
    int tsutatsu_id PK
    int number PK
    string title
  }
  section {
    int tsutatsu_id PK
    int chapter_number PK
    int section_number PK
    string title
    string url
    string fetched_at
    string content_hash "v2 で追加"
  }
  clause {
    int id PK
    int tsutatsu_id FK
    string clause_number "1-4-13の2 等"
    string source_url
    int chapter_number
    int section_number
    string title
    string full_text
    string paragraphs_json
  }
  document {
    int id PK
    string doc_type "5 種別の判別"
    string doc_id
    string taxonomy
    string title
    string issued_at
    string issuer
    string source_url
    string fetched_at
    string full_text
    string attached_pdfs_json
    string content_hash
  }
```

## 設計判断: clause table と document table の使い分け

| テーブル   | 担当                                                                 | 構造                            | キー                           | 検索           |
| ---------- | -------------------------------------------------------------------- | ------------------------------- | ------------------------------ | -------------- |
| `clause`   | 基本通達 4 種（消基通・所基通・法基通・相基通）                      | 階層的（章 → 節 → 条）          | `(tsutatsu_id, clause_number)` | `clause_fts`   |
| `document` | 改正通達・事務運営指針・文書回答事例・タックスアンサー・質疑応答事例 | フラット（1 文書 = 1 レコード） | `(doc_type, doc_id)`           | `document_fts` |

**なぜ分けているか**: 基本通達は「章 → 節 → 条」の階層構造が固有（消基通の `1-4-13の2` のような）で、章番号や節番号のクエリが頻出する。一方、改正通達以下は番号体系が個別の文書 ID（`0026003-067` / `240401` / `shotoku/250416` など）に多様化していて、単一の `doc_id` で扱う方が自然。

## 各テーブル仕様

### `schema_meta`

スキーマバージョンを保持する key-value テーブル。

| カラム  | 型      | 説明                   |
| ------- | ------- | ---------------------- |
| `key`   | TEXT PK | 例: `'schema_version'` |
| `value` | TEXT    | バージョン番号文字列   |

### `tsutatsu` — 基本通達のメタ

4 通達の identity を保持。

| カラム            | 型          | 説明           | 例                                                  |
| ----------------- | ----------- | -------------- | --------------------------------------------------- |
| `id`              | INTEGER PK  | autoincrement  | 1                                                   |
| `formal_name`     | TEXT UNIQUE | 正式名         | `'消費税法基本通達'`                                |
| `abbr`            | TEXT        | 略称           | `'消基通'`                                          |
| `source_root_url` | TEXT        | 通達ルート URL | `'https://www.nta.go.jp/law/tsutatsu/kihon/shohi/'` |

### `chapter` — 章

```
PRIMARY KEY (tsutatsu_id, number)
```

| カラム        | 型         | 説明                |
| ------------- | ---------- | ------------------- |
| `tsutatsu_id` | INTEGER FK | `tsutatsu.id`       |
| `number`      | INTEGER    | 章番号（1-indexed） |
| `title`       | TEXT       | 例: `'第１章 通則'` |

### `section` — 節

```
PRIMARY KEY (tsutatsu_id, chapter_number, section_number)
```

| カラム           | 型         | 説明                                    |
| ---------------- | ---------- | --------------------------------------- |
| `tsutatsu_id`    | INTEGER FK | `tsutatsu.id`                           |
| `chapter_number` | INTEGER    | 章番号                                  |
| `section_number` | INTEGER    | 節番号                                  |
| `title`          | TEXT       | 例: `'第４節 課税事業者の選択'`         |
| `url`            | TEXT       | 節 HTML の URL                          |
| `fetched_at`     | TEXT       | ISO 8601 取得時刻                       |
| `content_hash`   | TEXT       | **v2 で追加**。SHA-1 ハッシュで改正検知 |

### `clause` — 条（検索の最小単位）

```
UNIQUE INDEX idx_clause_lookup (tsutatsu_id, clause_number)
```

| カラム            | 型         | 説明                        | 例            |
| ----------------- | ---------- | --------------------------- | ------------- |
| `id`              | INTEGER PK | autoincrement               |               |
| `tsutatsu_id`     | INTEGER FK | `tsutatsu.id`               |               |
| `clause_number`   | TEXT       | 条番号文字列                | `'1-4-13の2'` |
| `source_url`      | TEXT       | 取得元 URL                  |               |
| `chapter_number`  | INTEGER    | 章番号                      |               |
| `section_number`  | INTEGER    | 節番号                      |               |
| `title`           | TEXT       | 条の見出し                  |               |
| `full_text`       | TEXT       | 本文（normalize 済み）      |               |
| `paragraphs_json` | TEXT       | JSON: `TsutatsuParagraph[]` |               |

**clause_number の体系は通達ごとに違う**:

- 消基通（shohi）: 3 階層 `1-4-13の2`
- 所基通（shotoku）: 2 階層 `2-4の2` / 共通通達 `183~193共-1`
- 法基通（hojin）: 3 階層、節の2 を含む `1-3の2-N`
- 相基通（sozoku）: flat 構造、ナカグロ複数条共通 `1の3・1の4共-1`

### `document` — 5 種別の統一テーブル（v3 で追加）

```
UNIQUE (doc_type, doc_id)
INDEX idx_document_lookup (doc_type, doc_id)
INDEX idx_document_taxonomy (doc_type, taxonomy)
```

| カラム               | 型            | 説明                              | 例                                                                            |
| -------------------- | ------------- | --------------------------------- | ----------------------------------------------------------------------------- |
| `id`                 | INTEGER PK    | autoincrement                     |                                                                               |
| `doc_type`           | TEXT NOT NULL | 種別判別                          | `'kaisei'` / `'jimu-unei'` / `'bunshokaitou'` / `'tax-answer'` / `'qa-jirei'` |
| `doc_id`             | TEXT NOT NULL | 種別内ユニーク ID                 | `'0026003-067'` / `'shohi/02/19'` / `'6101'`                                  |
| `taxonomy`           | TEXT          | 税目フォルダ                      | `'shohi'` / `'shotoku'` / `'hojin'` / `'sisan/sozoku'`                        |
| `title`              | TEXT NOT NULL | タイトル                          |                                                                               |
| `issued_at`          | TEXT          | 発出日（ISO YYYY-MM-DD）          | `'2024-04-01'`                                                                |
| `issuer`             | TEXT          | 宛先・発出者                      | `'国税庁長官'`                                                                |
| `source_url`         | TEXT NOT NULL | 個別 HTML の URL                  |                                                                               |
| `fetched_at`         | TEXT NOT NULL | ISO 8601 取得時刻                 |                                                                               |
| `full_text`          | TEXT NOT NULL | 本文（normalize 済み）            |                                                                               |
| `attached_pdfs_json` | TEXT NOT NULL | JSON: `[{ title, url, sizeKb? }]` |                                                                               |
| `content_hash`       | TEXT          | SHA-1 で改正検知                  |                                                                               |

**5 種別の doc_id 形式**:

| doc_type       | doc_id 例                                                 | 説明                                     |
| -------------- | --------------------------------------------------------- | ---------------------------------------- |
| `kaisei`       | `0026003-067` (新形式) / `240401` (旧形式)                | 改正通達                                 |
| `jimu-unei`    | `shotoku/shinkoku/170331` / `sozoku/170111_1`             | 事務運営指針                             |
| `bunshokaitou` | `shotoku/250416` (本庁) / `tokyo/shotoku/260218` (国税局) | 文書回答事例                             |
| `tax-answer`   | `6101` / `1120`                                           | タックスアンサー番号                     |
| `qa-jirei`     | `shohi/02/19`                                             | 質疑応答事例 (`{topic}/{category}/{id}`) |

### `tax_answer_index` / `tax_answer_index_page` — タックスアンサーの索引（v12 で追加）

`nta_get_tax_answer` は、DB に無い記事の URL を国税庁の索引（`/taxes/shiraberu/taxanswer/code/`）で決める。索引は保存して使い回し、番号が見つからないときだけ前回の `Last-Modified` / `ETag` を付けて取り直す。`--bulk-download-tax-answer` も、税目で絞る前の索引のすべての記事を保存する。

`--bulk-download-tax-answer` は、索引を保存できなくても（表の列が足りないなど）記事の取り込みを続け、標準エラー出力に `[WARN] タックスアンサーの索引を DB に保存できませんでした（表: <表の名前>、DB: <DB の場所>）: <エラーの文>。記事の取り込みは続けます` を出す。2 つのテーブルの行は前のままで、終了コードは保存できたときと同じ（ほかに失敗が無ければ 0）。`--bulk-download-everything` でもタックスアンサーの段は失敗にならず、質疑応答事例へ進む（v0.26.0、#145。v0.25.x では記事を 1 件も取らずに止まっていた）。

| テーブル | カラム | 説明 |
| --- | --- | --- |
| `tax_answer_index` | `no`（PK）・`url`・`taxonomy`・`title` | 索引の 1 記事につき 1 行。`taxonomy` は URL の `taxanswer/` の次の要素（例: `saigai`） |
| `tax_answer_index_page` | `url`（PK）・`fetched_at`・`last_modified`・`etag` | 索引のページを取った記録。304 のときは `fetched_at` だけを書き換える |

`document.doc_type` は v12 から `CHECK (doc_type IN ('kaisei','jimu-unei','bunshokaitou','tax-answer','qa-jirei'))`。`taxonomy` は制限しない（国税庁サイトの税目フォルダをそのまま入れる）。

## FTS5 全文検索

### `clause_fts` — 基本通達の FTS5 インデックス

```sql
CREATE VIRTUAL TABLE clause_fts USING fts5(
  clause_number,
  title,
  full_text,
  content='clause',
  content_rowid='id',
  tokenize='trigram'
);
```

- **trigram tokenizer**: 日本語（漢字混じり）を 3 文字 N-gram で分割。形態素解析不要、誤りに強い
- **contentless**: `content='clause'` で実体は `clause` テーブル参照、容量を節約
- **trigger 連動**: `clause_ai` / `clause_ad` / `clause_au` で INSERT/DELETE/UPDATE 時に自動同期

### `document_fts` — 5 種別の FTS5 インデックス

```sql
CREATE VIRTUAL TABLE document_fts USING fts5(
  doc_type UNINDEXED,
  taxonomy UNINDEXED,
  title,
  full_text,
  content='document',
  content_rowid='id',
  tokenize='trigram'
);
```

- `doc_type` / `taxonomy` は UNINDEXED（FTS では検索しないがフィルタ用に保持）
- 検索は `title` / `full_text` の trigram 一致

### 検索クエリ例

```sql
-- 基本通達を横断して "インボイス" を検索
SELECT c.tsutatsu_id, c.clause_number, c.title, c.source_url,
       snippet(clause_fts, 2, '<b>', '</b>', ' … ', 16) AS snippet
FROM clause_fts
JOIN clause c ON c.id = clause_fts.rowid
WHERE clause_fts MATCH 'インボイス'
ORDER BY clause_fts.rank
LIMIT 10;

-- 質疑応答事例だけを検索（doc_type で絞り込み）
SELECT d.doc_id, d.title, d.source_url,
       snippet(document_fts, 3, '<b>', '</b>', ' … ', 16) AS snippet
FROM document_fts
JOIN document d ON d.id = document_fts.rowid
WHERE document_fts MATCH '医療費控除'
  AND d.doc_type = 'qa-jirei'
ORDER BY document_fts.rank
LIMIT 10;
```

## 改正検知（`content_hash`）

通達は半年〜年単位で改正される。同じ doc が改正されたかどうかを **SHA-1 ハッシュ** で判定する設計。

- `section.content_hash`: その section 内の全 clauses（normalize 済 fullText）連結の SHA-1
- `document.content_hash`: 各 document の (docType + docId + title + fullText) 連結の SHA-1

bulk DL 時に `content_hash` の変化を集計（Phase 5 で `updatedDocs` カウンタ化）。一斉に変わった場合は「無症状の構造変質」を疑う signal となる。

## スキーマバージョン履歴

| Version | Phase      | 追加内容                                                                               |
| ------- | ---------- | -------------------------------------------------------------------------------------- |
| **v1**  | Phase 2a-c | 初版: tsutatsu / chapter / section / clause + clause_fts                               |
| **v2**  | Phase 2e   | `section.content_hash` 追加（改正検知用 SHA-1）                                        |
| **v3**  | Phase 3b   | `document` / `document_fts` 追加（改正通達・事務運営指針・文書回答事例の統一テーブル） |
| **v4**  | Phase 6-2  | `section` / `document` に `last_modified` / `etag` 追加（差分 bulk DL）                |
| **v5**  | Issue #27  | 投入済みの `title` / `full_text` / `paragraphs_json` を共通実装の正規化で入れ直す（全角英字 → 半角）。`document.content_hash` は計算し直し、`section.content_hash` は NULL に戻す |
| **v6**  | Issue #29  | `document.structured_json` 追加（質疑応答事例・タックスアンサーの構造）                |
| **v7**  | Issue #30  | `document.orphaned_at` 追加（国税庁の索引から消えた文書の印）                          |
| **v8**  | Issue #45  | 文書回答事例の `full_text` から国税庁サイトの案内文の行（「←上記照会の内容に対する回答はこちら」「※PDFファイルが開けない…こちらをご覧ください。」）を除き、`content_hash` を計算し直す |
| **v9**  | Issue #45  | 改正通達・事務運営指針の `full_text` からも同じ案内文の行を除き、`content_hash` を計算し直す |
| **v10** | Issue #54  | `tsutatsu.bulk_completed_at` と、目次を保存する `tsutatsu_toc` を追加 |
| **v11** | T3         | 投入済みの文字列を houki-abbreviations 0.7.0 の正規化（ダッシュ類も `-`）で入れ直す |
| **v12** | #112・#128 | タックスアンサーの索引（`tax_answer_index`・`tax_answer_index_page`）を追加し、`document.doc_type` に 5 つの値の CHECK を付ける（`document` を作り直して `id` を含む列を写す）。v0.24.0 |

**マイグレーション戦略**: v3 以降は 1 段ずつ順に適用し、bulk DL したデータを保つ（`initSchema()` の if の数珠つなぎ。v3 の DB からでも最新まで辿り着く）。列や表を足す版（v4 / v6 / v7 / v10 / v12）と、入っている文字列を直す版（v5 / v8 / v9 / v11）があり、どちらも国税庁サイトへのアクセスは発生しない。

**版の扱い（v0.24.0、SPEC-NTA-DB-SCHEMA-021）**:

| DB の状態 | 投入（`--quickstart`・`--bulk-download*`） | `--refresh-stale` | 読むだけのツール | 書き戻すツール（`nta_get_tsutatsu`・`nta_get_qa`・`nta_get_tax_answer`） |
| --- | --- | --- | --- | --- |
| ファイルが無い | 作る | 作らない（一覧は `[]`、`--apply` は終了コード 1） | 作らない（「DB に 1 件も無い」応答） | 国税庁サイトから取れたら作る |
| 版 3〜11 | 移行する | 移行する | 移行する | 移行する |
| 版 1・2 | 取得の前に作り直す | 終了コード 1 | 使わない（`hint` で案内） | 取って返し、書かない |
| この版より新しい版・読めない版 | 変更せずに終了コード 1 | 終了コード 1 | 使わない（`hint` で案内） | 取って返し、書かない |

v0.23.x までは、版 1・2 とこの版より新しい版の DB を、どの入口でも全テーブルを消して作り直していた。v0.24.0 で版 12 に移行した DB を 0.23.x 以前で開くと作り直されるので、0.24.0 に上げた後は戻さない。

## Normalize-everywhere 原則

DB に格納する `title` / `full_text` / `paragraphs_json` 内の文字列は **すべて normalize 済み**:

- 全角英数 → 半角英数
- 全角空白 → 半角空白
- 改行コードを LF に統一
- ゆらぎのある記号（チルダなど）の正規化

これは検索時のゆらぎ（ユーザーが `"1-4-13の2"` で引いても `"１－４－１３の２"` がヒット）を吸収するための一貫性。詳細は [`src/services/text-normalize.ts`](../src/services/text-normalize.ts) と [`@shuji-bonji/houki-abbreviations`](https://github.com/shuji-bonji/houki-abbreviations) v0.3.0+ の text-normalize 共通パッケージ。

## 関連ドキュメント

- [DESIGN.md](DESIGN.md): 全体アーキテクチャ・実装ロードマップ
- [DATA-SOURCES.md](DATA-SOURCES.md): 国税庁サイトの URL 構造・ライセンス・Shift_JIS 注意点
- [RESILIENCE.md](RESILIENCE.md): 検知層・可視化層・通知層の設計（baseline ファイル含む）
- [`src/db/schema.ts`](../src/db/schema.ts): 実装本体
- [`src/db/index.ts`](../src/db/index.ts): `openDb()` / `defaultDbPath()` 等
