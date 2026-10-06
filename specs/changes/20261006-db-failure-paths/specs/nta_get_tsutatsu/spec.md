# 差分: nta_get_tsutatsu（20261006-db-failure-paths）

`specs/current/nta_get_tsutatsu/spec.md` に対する差分です。

- `MODIFIED` の `### SPEC-…` は、current の同じ ID の見出しと本文を、見出しの行（題）も含めて置き換える
- 冒頭の「起こした元」の行の次に `- 関連する Issue: houki-nta-mcp #144（DB を開けないとき。0.26.0）` の行を足す（今は「関連する Issue」の行が無い）
- 「処理の流れ」の図は変えない（DB を開けないときの扱いは SPEC-NTA-DB-SCHEMA-030 に書く）

## MODIFIED

### SPEC-NTA-GET-TSUTATSU-007 DB に無く、ライブ取得にも対応していない通達は投入を案内する

その通達の条項が DB に 1 件も無く、上の 4 通達でもないとき（例: `電帳法取通`）は、エラー `TSUTATSU_NOT_FOUND` を返す。`hint` に `--bulk-download` の実行を案内し、`supported_for_live` にライブ取得できる通達名の一覧、`next_actions` に bulk download の案内を入れる。

ローカル DB を開けないとき（SPEC-NTA-DB-SCHEMA-021 の開けない行）は、`code` は同じ `TSUTATSU_NOT_FOUND` で、`hint` を SPEC-NTA-DB-SCHEMA-029 の開けないときの文にし、`retryable: false` と `detail.cause` を付け、`next_actions` に bulk download の案内を入れない（SPEC-NTA-DB-SCHEMA-030）。`supported_for_live` と `resolved` は同じ。

例: DB を開けるとき、`{ name: "電帳法取通", clause: "4-1" }` は `code: "TSUTATSU_NOT_FOUND"` で、`next_actions[0].action` は `cli_bulk_download`。`HOUKI_NTA_DB_PATH` で SQLite でない中身のファイルを指して起動したときは、`hint` が ``ローカル DB（<パス>）を開けません。`` で始まり、`retryable: false`、`detail.cause` は `file is not a database`、`next_actions` は無い（v0.25.x では DB を開くところで `INTERNAL_ERROR`）。

### SPEC-NTA-GET-TSUTATSU-010 候補ページのどれにも条項が無いときは、見たページの番号（最大 50 件）と URL を返す

候補ページを取得したがどれにも条項が無いとき（SPEC-NTA-GET-TSUTATSU-014 の目次の取り直しの後も同じとき）は、エラー `ARTICLE_NOT_FOUND` を返す。`available_clauses` に取得したページにある条項番号を、取得したページの順・ページの中の順に最大 50 件入れ、`searched_urls` に取得したページの URL を入れる。件数の上限は、DB の経路（SPEC-NTA-GET-TSUTATSU-005）の 50 件と同じにする。`hint` に、番号の形の確認と `nta_search_tsutatsu` での検索、`--bulk-download` で全節を DB に入れる方法を書く。`next_actions` は `nta_search_tsutatsu` と bulk download の案内（`cli_bulk_download`）の 2 件。

ローカル DB を開けないとき（SPEC-NTA-DB-SCHEMA-030）は、`hint` の `--bulk-download` で全節を DB に入れる方法の文を書かず、`next_actions` に `cli_bulk_download` を入れない（`nta_search_tsutatsu` の 1 件）。`code`・`available_clauses`・`searched_urls` は同じ。

例: 取得した 3 ページに条項が合わせて 80 件あり、どれも求めた条項でないとき、`available_clauses` は 1 ページ目の先頭から数えて 50 件（v0.22.0 では 80 件すべて）、`searched_urls` は 3 件。同じ場面で DB を開けないときは、`hint` に `--bulk-download` を含まず、`next_actions` は `nta_search_tsutatsu` の 1 件（v0.25.x では DB を開くところで `INTERNAL_ERROR` になり、国税庁サイトには取りに行かなかった）。
