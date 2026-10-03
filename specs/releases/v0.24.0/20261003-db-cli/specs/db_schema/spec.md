# 差分: db_schema（20261003-db-cli）

`specs/current/db_schema/spec.md` に対する差分です。見出しの単位で置き換えます。

- `MODIFIED` の見出しは、current の同じ見出しの本文をこの本文で置き換える（見出しの行の題も置き換える）
- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す
- 冒頭の「関連する Issue」の末尾に `、#107・#112・#128（版 11 → 12。DB の状態と入口ごとの扱い、doc_type の CHECK、タックスアンサーの索引）` を足す
- 「入力」の表を次のように直す
  - `CLI --bulk-download* / --quickstart / --refresh-stale=<日数> --apply` の行を 2 行に分ける。`CLI --quickstart / --bulk-download*` は「DB を作る・移行できない古い版の DB を作り直すことができる入口（SPEC-NTA-DB-SCHEMA-021）。取り込みの中身は cli_bulk_download」、`CLI --refresh-stale=<日数>`（`--apply` の有無）は「DB を作らない。`--apply` のときだけ書き込む（SPEC-NTA-DB-SCHEMA-021。中身は cli_refresh）」
  - `ツール nta_get_tsutatsu` の行を `ツール nta_get_tsutatsu / nta_get_qa / nta_get_tax_answer` にし、内容を「国税庁サイトから取ったもの（条項・事例・記事・目次・タックスアンサーの索引）を DB に書き戻す。DB のファイルが無ければ作る（SPEC-NTA-DB-SCHEMA-021）」にする
  - `ツール nta_search_* / nta_get_* / nta_inspect_pdf_meta` の行を `ツール nta_search_*（6 つ）/ nta_get_kaisei_tsutatsu / nta_get_jimu_unei / nta_get_bunshokaitou / nta_inspect_pdf_meta` にし、内容を「呼び出しごとに DB を開いて引き、閉じる。DB のファイルを作らない（SPEC-NTA-DB-SCHEMA-021）」にする
- 「処理の流れ」の図を次に置き換える

```mermaid
flowchart TD
  A["DB を開く入口（CLI・各ツール）"] --> B{"DB のファイルがあるか"}
  B -- 無い --> C{"入口は投入のフラグか、国税庁サイトから取ったものを書き戻すツールか"}
  C -- はい --> C1["フォルダーとファイルを作り、テーブルを作って版 12 を記録する（001・021）"]
  C -- いいえ --> C2["作らない。入口ごとの扱い（021）"]
  B -- ある --> D{"schema_meta の schema_version"}
  D -- "記録が無い" --> D1["投入のフラグだけがテーブルを作って版 12 を記録する。ほかは書き込まない（021）"]
  D -- "12" --> E["そのまま使う"]
  D -- "3〜11" --> F["既存の行を保ったまま 1 段ずつ移行し、12 にする（006〜014・019・022）"]
  D -- "1・2" --> G["投入のフラグだけが、取得の前に全テーブルを消して作り直す。ほかは書き込まない（021）"]
  D -- "13 以上・整数でない" --> H["どの入口も書き込まない（021）"]
  C1 --> I["tsutatsu・chapter・section・clause・document・tax_answer_index に行を入れる"]
  E --> I
  F --> I
  I --> J["clause・document の追加・変更は clause_fts・document_fts に反映する（002・003）"]
  I --> K["bulk download が全章を取り終えたら tsutatsu.bulk_completed_at を書く（015）"]
  I --> L["国税庁サイトから取ったものを書き戻す（016〜018・025）"]
```

- 「できないこと」を次のように直す
  - 「DB を消したり中身を空にしたりする CLI やツールは無い（空にするには利用者がファイルを消す。未決 4）」を「DB を消したり中身を空にしたりする入口（CLI のフラグ・環境変数・ツール）は無い。中身を消したいときは利用者が DB のファイルを消す（場所は投入のフラグが出す `DB: ` の行）。環境変数 `HOUKI_NTA_REFRESH` は読まない（#107）」にする
  - 「版 3 より前の DB と、10 より大きい版の DB を、中身を保ったまま使うこと（作り直す。未決 2）」を「版 1・2 の DB を中身を保ったまま使うこと（投入のフラグが作り直す）と、この版より新しい版・版を読めない DB を使うこと（どの入口も書き換えない）。SPEC-NTA-DB-SCHEMA-021」にする
  - 「`nta_get_tsutatsu` 以外のツールが DB に書くこと（`nta_get_qa` / `nta_get_tax_answer` の書き戻しは各ツールの spec.md）」を「`nta_get_tsutatsu`・`nta_get_qa`・`nta_get_tax_answer` 以外のツールが DB に書くこと（`nta_get_qa` / `nta_get_tax_answer` の書き戻しは各ツールの spec.md。スキーマの移行は除く。SPEC-NTA-DB-SCHEMA-021）」にする
  - 「`document.taxonomy` の値を一覧で制限すること（国税庁サイトの税目フォルダをそのまま入れる。SPEC-NTA-DB-SCHEMA-024）」を足す
- 「未決」の 2・4（→ #107）と 6（→ #112）の行を消す。未決 5 の「古い版の DB を初めて開くのが MCP サーバーの呼び出しだったときの移行の時間」は残す

## MODIFIED

### SPEC-NTA-DB-SCHEMA-001 DB を作るとテーブルを作り、スキーマの版 12 を記録する

DB を作ることができる入口（SPEC-NTA-DB-SCHEMA-021）が新しい DB を作ると、次のテーブルを作り、`schema_meta` テーブルに `key = 'schema_version'`、`value = '12'` の行を記録する。v0.24.0 のスキーマの版は 12 である（v0.22.0〜v0.23.x は 11）。既にテーブルのある版 12 の DB を開いても、テーブルは残る。

| テーブル                 | 内容                                                                                                                                                                                                                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema_meta`            | スキーマの版を `key` と `value` で持つ                                                                                                                                                                                                                                                   |
| `tsutatsu`               | 基本通達 1 つにつき 1 行（`formal_name`・`abbr`・`source_root_url`・`bulk_completed_at`）                                                                                                                                                                                                |
| `tsutatsu_toc`           | 目次ページの解析結果。目次の URL が主キー                                                                                                                                                                                                                                                |
| `chapter`                | 通達の章                                                                                                                                                                                                                                                                                 |
| `section`                | 通達の節。`fetched_at`・`content_hash`・`last_modified`・`etag` を持つ                                                                                                                                                                                                                   |
| `clause`                 | 通達の条項 1 つにつき 1 行（`clause_number`・`source_url`・`title`・`full_text`・`paragraphs_json`）                                                                                                                                                                                     |
| `clause_fts`             | 条項の条番号・題名・本文の全文検索の索引                                                                                                                                                                                                                                                 |
| `document`               | 改正通達・事務運営指針・文書回答事例・タックスアンサー・質疑応答事例 1 件につき 1 行（`doc_type`・`doc_id`・`taxonomy`・`title`・`issued_at`・`source_url`・`fetched_at`・`full_text`・`attached_pdfs_json`・`content_hash`・`last_modified`・`etag`・`structured_json`・`orphaned_at`） |
| `document_fts`           | 文書の題名・本文の全文検索の索引                                                                                                                                                                                                                                                         |
| `tax_answer_index`       | 国税庁のタックスアンサーの索引の 1 記事につき 1 行（`no`・`url`・`taxonomy`・`title`。SPEC-NTA-DB-SCHEMA-025）                                                                                                                                                                          |
| `tax_answer_index_page`  | タックスアンサーの索引のページを取った記録（`url`・`fetched_at`・`last_modified`・`etag`。SPEC-NTA-DB-SCHEMA-025）                                                                                                                                                                      |

### SPEC-NTA-DB-SCHEMA-006 版 3 の DB を開くと、既存の行を保ったまま最新の版まで順に移行する

`schema_meta` の `schema_version` が `3` の DB（`section` と `document` に `last_modified`・`etag` が無い）を開くと、列を足して版 4 にし、そこから最新の版（SPEC-NTA-DB-SCHEMA-001）まで 1 段ずつ移行する。`section` の行は残り、`last_modified`・`etag` は NULL のまま、`content_hash` は未計算（NULL）に戻る（SPEC-NTA-DB-SCHEMA-009）。移行が終わると `schema_version` は最新の版（v0.24.0 では `12`）になる。

例: 版 3 の DB に `section` の行（`title` が `第1章第1節`、`content_hash` が `pre-existing-hash`）を入れて開くと、`title` は `第1章第1節` のまま、`last_modified`・`etag`・`content_hash` は NULL、`schema_version` は `12`。

### SPEC-NTA-DB-SCHEMA-007 版 4 の DB を開くと、clause・section・document の文字列を共通の揃え方で入れ直す

`schema_version` が `4` の DB（全角英字を半角にしない揃え方で入れた行がある）を開くと、国税庁サイトを取りに行かずに、DB の中の文字列を SPEC-NTA-SEARCH-RULES-007 の揃え方で入れ直し、最新の版まで移行する（`schema_version` は v0.24.0 では `12`）。もう一度開いても何も変わらない。

- `clause`: `clause_number`・`title`・`full_text`・`paragraphs_json` の各段落の `text`。例: `Ａ－１` → `A-1`、`ＮＩＳＡの取扱い` → `NISAの取扱い`、`ｅ－Ｔａｘで提出する` → `e-Taxで提出する`
- `section`: `title`。例: `ＮＩＳＡ関係` → `NISA関係`
- `document`: `title`・`full_text`。例: `ＮＩＳＡ制度` → `NISA制度`、`ＮＩＳＡの概要` → `NISAの概要`

### SPEC-NTA-DB-SCHEMA-010 版 5 の DB を開くと document に structured_json 列を足し、既存の行は変えない

`schema_version` が `5` の DB（`document` に `structured_json` が無い）を開くと、`structured_json` 列を足して最新の版まで移行する。既存の行は消えず、`title`・`full_text`・`content_hash` は変えず、`structured_json` は NULL のまま残る。もう一度開いても行数と `schema_version` は変わらない。

### SPEC-NTA-DB-SCHEMA-011 版 6 の DB を開くと document に orphaned_at 列を足し、既存の行は変えない

`schema_version` が `6` の DB（`document` に `orphaned_at` が無い）を開くと、`orphaned_at` 列を足して最新の版まで移行する。既存の行は消えず、`content_hash` は変えず、`orphaned_at` は NULL（国税庁の索引にある）のまま残る。

### SPEC-NTA-DB-SCHEMA-012 版 7 の DB を開くと、文書回答事例の本文から国税庁サイトの案内文の行を除く

`schema_version` が `7` の DB を開くと、`doc_type = 'bunshokaitou'` の行の `full_text` から、国税庁サイトの案内文の行（`←上記照会の内容に対する回答はこちら` など）を除き、最新の版まで移行する。国税庁サイトは取りに行かない。もう一度開いても何も変わらない。

- 案内文を除いた行は、`content_hash` を除いた後の本文で計算し直す（SPEC-NTA-DB-SCHEMA-009 と同じ式）。`content_hash` が NULL だった行は本文だけ直り、NULL のまま
- 案内文の無い行は `full_text` も `content_hash` も変わらない
- ほかの種別（`tax-answer` など）の行は、同じ文言があっても変えない
- `document_fts` からも案内文が消える。例: `document_fts MATCH '"回答はこちら"'` は、`tax-answer` の行だけを返す

例: `full_text` が `回答内容: 貴見のとおり\n【別紙】\n照会の趣旨\n以上\n←上記照会の内容に対する回答はこちら` の行は、`以上` で終わる本文になる。

### SPEC-NTA-DB-SCHEMA-013 版 8 の DB を開くと、改正通達・事務運営指針の本文からも案内文の行を除く

`schema_version` が `8` の DB を開くと、`doc_type` が `kaisei`・`jimu-unei` の行の `full_text` から、案内文の行（`※PDFファイルが開けない、印刷できないなどの場合はこちらをご覧ください。`）を除き、最新の版まで移行する。`content_hash` の扱い、案内文の無い行、`document_fts` への反映は SPEC-NTA-DB-SCHEMA-012 と同じ。もう一度開いても何も変わらない。

例: 改正通達の行の `full_text` の末尾にこの案内文があれば、それを除いた本文になり、`content_hash` は `kaisei`・`0026003-067`・題名・除いた後の本文から計算した SHA-1 になる。`document_fts MATCH '"PDFファイルが開けない"'` は 0 件。

### SPEC-NTA-DB-SCHEMA-014 版 9 の DB を開くと tsutatsu に bulk_completed_at を足し、bulk download 済みの通達だけ埋める

`schema_version` が `9` の DB（`tsutatsu` に `bulk_completed_at` が無く、`tsutatsu_toc` が無い）を開くと、`bulk_completed_at` 列と `tsutatsu_toc` テーブルを足して最新の版まで移行する。国税庁サイトは取りに行かない。

- `last_modified` か `etag` の入った `section` を持つ通達（bulk download が節を書いた通達）は、その節の `fetched_at` の最大値を `bulk_completed_at` に入れる。例: 消費税法基本通達の節の `fetched_at` が `2026-09-01T00:00:00.000Z`（`last_modified` あり）と `2026-09-02T00:00:00.000Z`（`etag` あり）なら `2026-09-02T00:00:00.000Z`
- `last_modified` も `etag` も無い `section` しか持たない通達（`nta_get_tsutatsu` が国税庁サイトから取って書き戻した節だけの通達）は NULL のまま
- もう一度開いても値は変わらない

### SPEC-NTA-DB-SCHEMA-019 版 10 の DB を開くと、ダッシュ類も揃えた形で clause・section・document の文字列を入れ直し、最新の版まで移行する

`schema_version` が `10` の DB（ダッシュ類 `‐` `‑` `–` `—` `―` `−` を `-` にしない揃え方で入れた行がある）を開くと、国税庁サイトを取りに行かずに、DB の中の文字列を SPEC-NTA-SEARCH-RULES-007（houki-abbreviations 0.7.0 の `normalizeJpText`）の揃え方で入れ直し、最新の版まで移行する（`schema_version` は v0.24.0 では `12`）。もう一度開いても何も変わらない。入れ直す列は版 4 → 5 のとき（SPEC-NTA-DB-SCHEMA-007）と同じである。

- `clause`: `clause_number`・`title`・`full_text`・`paragraphs_json` の各段落の `text`。例: `1―4―13の2` → `1-4-13の2`
- `section`: `title`
- `document`: `title`・`full_text`。例: `課消２―11` → `課消2-11`

版 4 以前の DB は、007 の入れ直しの後にこの入れ直しも通る（順に移行する。SPEC-NTA-DB-SCHEMA-006）。

例: `document.full_text` に `課消２―11` を含む版 10 の DB を開くと、`schema_version` は `12` になり、その行の `full_text` は `課消2-11` を含み、`document_fts MATCH '課消2-11'` で当たる。

## ADDED

### SPEC-NTA-DB-SCHEMA-021 DB の状態と入口ごとの扱い

DB を開く入口は、DB の状態によって次のように扱う。「版」は `schema_meta` の `schema_version` の値で、v0.24.0 の版は 12。入口は次の 5 つに分ける。

- 投入: CLI の `--quickstart`・`--bulk-download`・`--bulk-download-all`・`--bulk-download-kaisei`・`--bulk-download-jimu-unei`・`--bulk-download-bunshokaitou`・`--bulk-download-tax-answer`・`--bulk-download-qa`・`--bulk-download-everything`
- 取り直し: CLI の `--refresh-stale=<日数> --apply`
- 一覧: CLI の `--refresh-stale=<日数>`（`--apply` なし）
- 読むだけのツール: `nta_search_tsutatsu`・`nta_search_kaisei_tsutatsu`・`nta_search_jimu_unei`・`nta_search_bunshokaitou`・`nta_search_tax_answer`・`nta_search_qa`・`nta_get_kaisei_tsutatsu`・`nta_get_jimu_unei`・`nta_get_bunshokaitou`・`nta_inspect_pdf_meta`
- 書き戻すツール: `nta_get_tsutatsu`・`nta_get_qa`・`nta_get_tax_answer`（国税庁サイトから取った条項・事例・記事と、目次・タックスアンサーの索引を DB に書く）

`--health-check`・`--check-baseline-drift`・`--help`・`--version` と `resolve_abbreviation` は DB を開かない。

| DB の状態 | 投入 | 取り直し | 一覧 | 読むだけのツール | 書き戻すツール |
| --- | --- | --- | --- | --- | --- |
| ファイルが無い（置き場所のフォルダーも無いときを含む） | フォルダーとファイルを作り、テーブルを作って版 12 を記録し、取り込む（001） | 作らない。DB が無いエラーで終了コード 1 | 作らない。DB が無いことを標準エラー出力に出し、標準出力に `[]` を出して終了コード 0 | 作らない。各ツールの「DB に 1 件も無い」ときの応答（下の注 1）をそのまま返す | 国税庁サイトから取る。取れたら、フォルダーとファイルを作り、テーブルを作って版 12 を記録し、書き戻す |
| ファイルはあるが版の記録が無い（0 バイトのファイル、`schema_meta` の無い SQLite のファイル） | テーブルを作り、版 12 を記録して取り込む | 書き込まない。ファイルが無いときと同じ | 書き込まない。ファイルが無いときと同じ | 書き込まない。ファイルが無いときと同じ | 国税庁サイトから取って返す。DB には書かない |
| 版が同じ（12） | 取り込む | 取り直す | 列挙する | 引く | 引き、無ければ取って書き戻す |
| 版が古く、移行できる（3〜11） | 行を保ったまま 12 に移行してから取り込む（006〜014・019・022） | 移行してから取り直す | 移行してから列挙する | 移行してから引く | 移行してから引き、書き戻す |
| 版が古く、移行できない（1・2） | 国税庁サイトを取りに行く前に、標準エラー出力に `  DB の版 (<DB の版>) は移行できないため、作り直します（取り込んだ中身は消えます）` を出し、全テーブルを消して版 12 で作り直してから取り込む | 書き込まない。古い版のエラーで終了コード 1 | 書き込まない。古い版のエラーで終了コード 1 | 書き込まない。注 1 の応答の `hint` を注 2 の古い版の文にする | 国税庁サイトから取って返す。DB には書かない |
| 版が新しい（13 以上の整数） | 国税庁サイトを取りに行く前に止める。新しい版のエラーで終了コード 1 | 書き込まない。新しい版のエラーで終了コード 1 | 書き込まない。新しい版のエラーで終了コード 1 | 書き込まない。注 1 の応答の `hint` を注 2 の新しい版の文にし、`next_actions` に投入の案内を入れない | 国税庁サイトから取って返す。DB には書かない |
| 版を読めない（10 進の整数の文字列でない値。`abc`・空文字・`12abc` など） | 国税庁サイトを取りに行く前に止める。読めない版のエラーで終了コード 1 | 書き込まない。読めない版のエラーで終了コード 1 | 書き込まない。読めない版のエラーで終了コード 1 | 書き込まない。注 1 の応答の `hint` を注 2 の読めない版の文にし、`next_actions` に投入の案内を入れない | 国税庁サイトから取って返す。DB には書かない |
| 開けない（SQLite でないファイル、フォルダー、パスの途中が普通のファイル、権限が無い） | 国税庁サイトを取りに行く前に止める。`[ERROR] DB を開けません: <エラーの文>` で終了コード 1 | 同じ文で終了コード 1 | 同じ文で終了コード 1 | この差分では変えない | この差分では変えない |

「DB には書かない」は、ファイル・フォルダー・テーブル・`schema_meta` を作らず、行も書かないことをいう（SQLite が `-wal` / `-shm` のファイルを置くことはある）。国税庁サイトから取った応答の中身は、DB に書いたときと同じである。

注 1（読むだけのツールの「DB に 1 件も無い」ときの応答）: `nta_search_tsutatsu` は SPEC-NTA-SEARCH-TSUTATSU-003 の `TSUTATSU_NOT_FOUND`、ほかの検索ツールはその種別の文書が 1 件も無いときの `DOC_NOT_FOUND`、`nta_get_kaisei_tsutatsu`・`nta_get_jimu_unei`・`nta_get_bunshokaitou` は SPEC-NTA-GET-KAISEI-TSUTATSU-001・SPEC-NTA-GET-JIMU-UNEI-001・SPEC-NTA-GET-BUNSHOKAITOU-002、`nta_inspect_pdf_meta` は SPEC-NTA-INSPECT-PDF-META-001。`code` は変えない。

注 2（読むだけのツールの `hint` の文。`<DB の場所>` は MCP サーバーが開いた DB のパス）:

| 場面 | `hint` |
| --- | --- |
| 古い版（1・2） | `MCP サーバーが開いている DB（<DB の場所>）の版 (<DB の版>) は古く移行できないため、使っていません。houki-nta-mcp --quickstart などの投入のフラグを実行すると作り直します（取り込んだ中身は消えます）` |
| 新しい版 | `MCP サーバーが開いている DB（<DB の場所>）の版 (<DB の版>) がこの houki-nta-mcp の版 (12) より新しいため、使っていません（DB は変更しません）。houki-nta-mcp を新しい版に更新してください` |
| 読めない版 | `MCP サーバーが開いている DB（<DB の場所>）の版を読めないため (schema_version: <値>)、使っていません（DB は変更しません）。DB ファイルを消してから houki-nta-mcp --quickstart などの投入のフラグを実行してください` |

CLI のエラーの文は、標準エラー出力に次のとおり出す（`<DB の場所>` は各フラグが出す `DB: ` の行と同じ）。

| 場面 | 文 |
| --- | --- |
| DB が無い（取り直し） | `[ERROR] DB がまだありません (<DB の場所>)。houki-nta-mcp --quickstart か --bulk-download-all で作ってください` |
| DB が無い（一覧） | `[refresh-stale] DB がまだありません (<DB の場所>)。houki-nta-mcp --quickstart か --bulk-download-all で作ってください` |
| 古い版（1・2） | `[ERROR] DB の版 (<DB の版>) は古く移行できないため使えません。houki-nta-mcp --quickstart などの投入のフラグを実行すると作り直します（取り込んだ中身は消えます）` |
| 新しい版 | `[ERROR] DB の版 (<DB の版>) がこの houki-nta-mcp の版 (12) より新しいため、DB を変更しません。houki-nta-mcp を新しい版に更新するか、--db-path（MCP サーバーでは HOUKI_NTA_DB_PATH）で別のファイルを指定してください` |
| 読めない版 | `[ERROR] DB の版を読めないため (schema_version: <値>)、DB を変更しません。DB ファイル (<DB の場所>) を消してから houki-nta-mcp --quickstart などの投入のフラグを実行してください` |

例:

- `schema_version` を `13` に書き換えた DB で `--bulk-download-jimu-unei` を実行すると、国税庁サイトを取りに行かずに新しい版の文を出して終了コード 1 で終わり、`schema_version` は `13` のまま、`document` の行も残る（v0.23.x では全テーブルを消して作り直していた）
- 同じ DB を開いた MCP サーバーで `nta_search_jimu_unei { keyword: "書面添付" }` を呼ぶと、`code: "DOC_NOT_FOUND"` で `hint` が新しい版の文になり、DB は変わらない
- DB ファイルの無い場所で `nta_search_qa { keyword: "社内会議" }` を呼んでも、`--refresh-stale=30` を実行しても、ファイルとフォルダーはできない（v0.23.x までは空の DB ができた）
- DB ファイルの無い場所で `nta_get_tax_answer { no: "6101" }` を呼ぶと、国税庁サイトから記事を返し、DB のファイルができて `document` に `tax-answer`・`6101` の行が入る
- `schema_version` を `abc` に書き換えた DB で `--refresh-stale=30` を実行すると、`[refresh-stale] DB: …` の行の後に読めない版の文を出して終了コード 1（v0.23.x では `UNIQUE constraint failed: schema_meta.key` の例外）

### SPEC-NTA-DB-SCHEMA-022 版 11 の DB を開くと、行を保ったままタックスアンサーの索引のテーブルを足し、document に doc_type の制約を付けて版 12 にする

`schema_version` が `11` の DB を開くと、国税庁サイトを取りに行かずに次を行い、`schema_version` を `12` にする。版 3〜10 の DB も、順に移行した後でこれを通る（SPEC-NTA-DB-SCHEMA-006）。もう一度開いても何も変わらない。

- `tax_answer_index` と `tax_answer_index_page`（SPEC-NTA-DB-SCHEMA-025）を空で作る。最初に索引を使う呼び出し（SPEC-NTA-GET-TAX-ANSWER-016）か `--bulk-download-tax-answer`（SPEC-NTA-CLI-BULK-DOWNLOAD-013）が埋める
- `document` に SPEC-NTA-DB-SCHEMA-023 の制約を付ける。`doc_type` が 5 つの値の行は、`id` を含むすべての列をそのまま残す。`document_fts` で引ける行も変わらない
- `doc_type` が 5 つの値でない行は残さない（どの版の houki-nta-mcp もこの 5 つ以外を書かないので、通常は 0 行）
- ほかのテーブル（`tsutatsu`・`tsutatsu_toc`・`chapter`・`section`・`clause`・`clause_fts`）の行は変えない。`content_hash` も変えない

例: 版 11 の DB に `document` の行（`doc_type` が `tax-answer`、`doc_id` が `6101`、`full_text` に `適格請求書`）と `clause` の行を入れて開くと、`schema_version` は `12`、`document` と `clause` の行数は変わらず、`document_fts MATCH '適格請求書'` でその行が当たり、`tax_answer_index` は 0 行。

### SPEC-NTA-DB-SCHEMA-023 document.doc_type は 5 つの値だけを受け付ける

`document.doc_type` は `kaisei`・`jimu-unei`・`bunshokaitou`・`tax-answer`・`qa-jirei` のどれかで、ほかの値の行は入らない（書き込みがエラーになる）。

例: sqlite3 で `INSERT INTO document(doc_type, doc_id, title, source_url, fetched_at, full_text, attached_pdfs_json) VALUES ('kaisei-x', '1', 't', 'u', 'f', 'b', '[]')` を実行すると `CHECK constraint failed` のエラーになり、行は増えない（v0.23.x では入った）。`doc_type` を `qa-jirei` にした同じ `INSERT` は入る。

### SPEC-NTA-DB-SCHEMA-024 document.taxonomy は値を制限せず、取得元の URL の税目フォルダを入れる

`document.taxonomy` には値の制約を付けない。投入と書き戻しは、取得元のページの URL から取った税目フォルダの文字列を入れ、取れなければ NULL を入れる。国税庁サイトの税目フォルダには、国税局のページの別表記（`souzoku` など）や、階層のあるフォルダ（`sisan/sozoku`）や、houki-nta-mcp が一覧に持っていない値（事務運営指針の `tyousyu` など）があるので、一覧で制限すると、国税庁がフォルダを足したときにその文書を入れられなくなる。

例（2026-10-03 JST に作者の DB で `nta_search_*` に一覧に無い `taxonomy` を渡し、`available_taxonomies` で確かめた値）: 文書回答事例は `gensen`・`gensenshotoku`・`hojin`・`hyoka`・`inshi`・`joto-sanrin`・`joto_sanrin`・`shohi`・`shotoku`・`shozei`・`sonota`・`souzoku`・`sozoku`・`zoyo`、改正通達は `hojin`・`shohi`・`shotoku`・`sisan/sozoku`、事務運営指針は `hojin`・`shotoku`・`shozei`・`sonota`・`sozoku`・`tyousyu`。sqlite3 で `taxonomy` を `zzz` にした `document` の行も入る。

### SPEC-NTA-DB-SCHEMA-025 タックスアンサーの索引は tax_answer_index に 1 記事 1 行で保存し、取り直したら置き換える

国税庁のタックスアンサーの索引（`https://www.nta.go.jp/taxes/shiraberu/taxanswer/code/`）を取って読み取れたときは、次の 2 つのテーブルに保存する。

| テーブル | 列 | 内容 |
| --- | --- | --- |
| `tax_answer_index` | `no`（主キー）・`url`・`taxonomy`・`title`（どれも NULL にしない） | 索引の 1 記事につき 1 行。`no` は 4 桁の番号、`url` は記事の URL、`taxonomy` は URL の `taxanswer/` の次の要素（例: `saigai`）、`title` は索引の題名 |
| `tax_answer_index_page` | `url`（主キー）・`fetched_at`（NULL にしない）・`last_modified`・`etag` | 索引のページを取った記録。`last_modified`・`etag` は応答のヘッダーの値（無ければ NULL） |

- 索引を 200 で取って読み取れたときは、`tax_answer_index` の行をすべて、取った索引の行で置き換え、`tax_answer_index_page` の行を書き換える。1 つのトランザクションで行い、途中で失敗したら前の行を残す
- 条件付きの取り直しで 304 が返ったときは、`tax_answer_index_page.fetched_at` だけを書き換え、`tax_answer_index` は変えない
- 索引を読み取れなかったとき（SPEC-NTA-COMMON-ERRORS-009 の索引の解析の失敗）は、どちらのテーブルも変えない
- 書き込むのは `nta_get_tax_answer`（SPEC-NTA-GET-TAX-ANSWER-016）と `--bulk-download-tax-answer`（SPEC-NTA-CLI-BULK-DOWNLOAD-013）

例: 索引の記事が 755 件のときに保存すると、`tax_answer_index` は 755 行で、`8` で始まる番号の行の `taxonomy` は `saigai`。その後に 756 件の索引を保存すると 756 行になり、索引から消えた番号の行は残らない。
