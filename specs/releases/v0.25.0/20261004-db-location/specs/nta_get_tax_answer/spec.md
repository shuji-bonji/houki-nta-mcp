# 差分: nta_get_tax_answer（20261004-db-location）

`specs/current/nta_get_tax_answer/spec.md` に対する差分です。

- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す
- 冒頭の「関連する Issue」の末尾に `、#137（保存した索引を読めないとき。0.25.0）` を足す
- 「処理の流れ」の図の `X0{"DB に保存した国税庁の索引があるか（016）"}` を `X0{"DB に保存した国税庁の索引があるか（016）。読めないときは「無い」へ進み、ログに残す（018）"}` にし、`X1["索引を国税庁サイトから取り、DB に保存する（016）"]` の箱の文を `索引を国税庁サイトから取り、DB に保存する（016。保存に失敗してもログに残して続ける。018）` にする

## ADDED

### SPEC-NTA-GET-TAX-ANSWER-018 保存した索引を読めない・保存できないときも記事を返し、MCP サーバーのログに `warn` で残す

記事の URL を国税庁の索引で決めるとき（SPEC-NTA-GET-TAX-ANSWER-016）の、DB に保存した索引（SPEC-NTA-DB-SCHEMA-025）の読み書きは次のとおりにする。

| 場面 | 動き | ログ |
| --- | --- | --- |
| `tax_answer_index_page` に索引の URL の行が無い（まだ保存していない） | 索引を取って保存し、そこで探す（016 のとおり） | 出さない |
| `tax_answer_index_page` か `tax_answer_index` を読む SQL が失敗した（表の列が足りないなど） | まだ保存していないときと同じに、条件を付けずに索引を取り、そこで探す | `warn` を 1 行 |
| 取った索引の保存（`tax_answer_index` の置き換えと `tax_answer_index_page` の書き換え）が失敗した | 取った索引で URL を決めて続ける。保存は前の行のまま（025 の「途中で失敗したら前の行を残す」） | `warn` を 1 行 |
| 304 のときの `tax_answer_index_page.fetched_at` の書き換えが失敗した | 「索引に無い」として SPEC-NTA-GET-TAX-ANSWER-013 の `DOC_NOT_FOUND` を返す（016 のとおり） | `warn` を 1 行 |

どの場面でも、記事を取れれば記事を返す。応答は、読み書きが成功したときと同じで、`INTERNAL_ERROR` にせず、応答にフィールドを足さない（記事は正しく返せるため）。

ログは MCP サーバーの標準エラー出力の JSON の 1 行で、`level` は `warn`、`scope` は `nta_get_tax_answer`。`msg` と `meta` は次のとおり。`<表の名前>` は失敗した SQL の表（`tax_answer_index` か `tax_answer_index_page`）、`<DB の絶対パス>` は開いた DB のファイルの絶対パス（SPEC-NTA-DB-SCHEMA-026。ホームディレクトリを `~` に置き換えない）。

| 場面 | `msg` |
| --- | --- |
| 読めない | `保存したタックスアンサーの索引を読めないため、国税庁サイトから取り直します（表: <表の名前>、DB: <DB の絶対パス>）` |
| 保存できない | `タックスアンサーの索引を DB に保存できませんでした（表: <表の名前>、DB: <DB の絶対パス>）` |
| 取得日時を書き換えられない | `タックスアンサーの索引の取得日時を DB に書き換えられませんでした（表: tax_answer_index_page、DB: <DB の絶対パス>）` |

`meta` は `{ table: "<表の名前>", db_path: "<DB の絶対パス>", error: { name: "<例外の名前>", message: "<例外の文>" } }`。

例（壊れた表の DB）: 版 12 の DB で、`tax_answer_index` を `url` の列の無い表に作り替え（`DROP TABLE tax_answer_index; CREATE TABLE tax_answer_index (no TEXT PRIMARY KEY, taxonomy TEXT NOT NULL, title TEXT NOT NULL);`）、`tax_answer_index_page` に `('https://www.nta.go.jp/taxes/shiraberu/taxanswer/code/', '2026-10-01T00:00:00.000Z', NULL, '"25b0a-65b81bf96ae40"')` の行を入れておく。この DB で `{ no: "6101", format: "json" }` を呼ぶと次のようになる。

- 索引の要求には `If-None-Match` も `If-Modified-Since` も付かない（保存した索引を読めないため、保存していないときと同じに取る）
- 記事を返す（`source: "live"`、`taxAnswer.no: "6101"`）。`isError` は無い
- 標準エラー出力に `warn` が 2 行出る。1 行目は `msg` が `保存したタックスアンサーの索引を読めないため、…（表: tax_answer_index、DB: <DB の絶対パス>）`、`meta.error.message` が `no such column: url`。2 行目は `msg` が `タックスアンサーの索引を DB に保存できませんでした（表: tax_answer_index、DB: <DB の絶対パス>）`、`meta.error.message` が `table tax_answer_index has no column named url`
- `tax_answer_index_page` の行は `fetched_at` が `2026-10-01T00:00:00.000Z` のまま
- 同じ DB でもう一度呼ぶと、同じく索引を条件なしで取り、同じ 2 行の `warn` を出す

v0.24.0 では、同じ DB で記事は返ったが、読めない・保存できないことはログにも応答にも出なかった（houki-nta-mcp #137）。表がまだ無い DB は、DB を開いたときにテーブルを作る（SPEC-NTA-DB-SCHEMA-001・022）ので、この表の 2 行目には当たらない。
