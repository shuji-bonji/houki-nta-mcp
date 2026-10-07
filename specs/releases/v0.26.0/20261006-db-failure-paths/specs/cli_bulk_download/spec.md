# 差分: cli_bulk_download（20261006-db-failure-paths）

`specs/current/cli_bulk_download/spec.md` に対する差分です。

- `ADDED` の `### SPEC-…` は、current の「できること」の末尾（SPEC-NTA-CLI-BULK-DOWNLOAD-013 の後）に足す
- 冒頭の「関連する Issue」の末尾に `、#145（タックスアンサーの索引を保存できないとき。0.26.0）` を足す
- 「処理の流れ」の図、「できないこと」、「未決」は変えない（未決 1 の終了コードの決まりは、この差分でも ID を振らない）

## ADDED

### SPEC-NTA-CLI-BULK-DOWNLOAD-014 `--bulk-download-tax-answer` は、取った索引を DB に保存できなくても記事の取り込みを続け、標準エラー出力に `[WARN]` の行を出す

`--bulk-download-tax-answer`（`--bulk-download-everything` のタックスアンサーを含む）で、取った索引の保存（SPEC-NTA-CLI-BULK-DOWNLOAD-013、SPEC-NTA-DB-SCHEMA-025 の `tax_answer_index` の置き換えと `tax_answer_index_page` の書き換え）が失敗したときは、次のとおりにする。

- 取った索引で記事の URL を決め、記事の取り込み（SPEC-NTA-CLI-BULK-DOWNLOAD-003）を続ける。`--tax-answer-taxonomy` の絞り込み、差分更新、`--refresh` も、保存できたときと同じ
- 2 つのテーブルの行は前のまま（SPEC-NTA-DB-SCHEMA-025 の「途中で失敗したら前の行を残す」）
- 標準エラー出力に次の 1 行を出す。`<表の名前>` は失敗した SQL の表（`tax_answer_index` か `tax_answer_index_page`）、`<DB の場所>` は同じ実行の `[bulk-download-tax-answer] DB: ` の行と同じ値、`<エラーの文>` は SQLite の例外の文

```
[WARN] タックスアンサーの索引を DB に保存できませんでした（表: <表の名前>、DB: <DB の場所>）: <エラーの文>。記事の取り込みは続けます
```

- 標準出力の結果の JSON（未決 1）にはフィールドを足さない
- 終了コードは、保存できたときと同じ（ほかに失敗が無ければ 0）。記事ごとの取得の失敗があっても終了コードを 0 にしている今の決まり（未決 1）と同じ考え方で、`[WARN]` の行で気付けるようにする
- `--bulk-download-everything` では、タックスアンサーの段は失敗にならないので `[bulk-download-everything] (5/6) タックスアンサー 失敗: …` の行を出さず、続けて質疑応答事例を投入する（種別ごとの失敗を受け取って次へ進む作り（SPEC-NTA-CLI-BULK-DOWNLOAD-004）は変えない）

索引の保存は、`nta_get_tax_answer` が索引を取り直さずに記事の URL を決めるための写しである（SPEC-NTA-GET-TAX-ANSWER-016）。記事の URL はこの実行で取った索引で決まるので、保存できなくても取り込みの目的は果たせる。保存できない DB では、`nta_get_tax_answer` が保存した索引を読めないときの扱い（SPEC-NTA-GET-TAX-ANSWER-018）になる。

例: 版 12 の DB で、`tax_answer_index` を `url` の列の無い表に作り替え（SPEC-NTA-GET-TAX-ANSWER-018 の例と同じ）、`tax_answer_index_page` に `fetched_at` が `2026-10-01T00:00:00.000Z` の行を入れておく。国税庁の索引が No.6101 の 1 件のとき、`--bulk-download-tax-answer --db-path=<この DB>` を実行すると次のようになる。

- 標準エラー出力に `[WARN] タックスアンサーの索引を DB に保存できませんでした（表: tax_answer_index、DB: <この DB>）: table tax_answer_index has no column named url。記事の取り込みは続けます` の 1 行
- `document` に `doc_type` が `tax-answer`、`doc_id` が `6101` の行が入る
- `tax_answer_index_page` の行の `fetched_at` は `2026-10-01T00:00:00.000Z` のまま
- 標準出力に結果の JSON（`documentsFetched: 1`）を出し、終了コード 0

同じ DB で `--bulk-download-everything` を実行すると、タックスアンサーの段で同じ `[WARN]` の行を出し、`(5/6) タックスアンサー 失敗:` の行は出さずに質疑応答事例へ進み、終了コード 0。

v0.25.x では、`--bulk-download-tax-answer` は記事を 1 件も取らずに止まり、SQLite の例外が MCP サーバーの入口まで伝わって `fatal error` のログを出し、終了コード 1 で終わる。`--bulk-download-everything` では `(5/6) タックスアンサー 失敗: table tax_answer_index has no column named url` を出してタックスアンサーを飛ばし、質疑応答事例へ進んで終了コード 0 で終わる（proposal.md の「今の動き」）。
