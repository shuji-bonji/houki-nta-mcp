# 差分: common_errors（20261001-t2-error-codes）

`specs/current/common_errors/spec.md` に対する差分です。見出しの単位で置き換えます。差分 `20261001-t1-argument-guards` の 010〜015 の後に足します。

- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す
- 「エラーの code」の表を次のとおりに変える
  - `TSUTATSU_NOT_FOUND` の行の説明を「求めた基本通達、または検索の対象になる基本通達が、ローカル DB に無く国税庁サイトから取る先も無い（`nta_get_tsutatsu` / `nta_search_tsutatsu`）」にする（「改正通達・事務運営指針を含む」を外す）
  - `DOC_NOT_FOUND` の行の説明を「求めた文書（または検索の対象になる文書）がローカル DB に無い（質疑応答事例・タックスアンサー・改正通達・事務運営指針・文書回答事例）。国税庁サイトから取るときに、そのページが無い（404・410・404 ページへの転送）ときも同じ」にする
  - `SOURCE_API_ERROR` の行の説明を「国税庁サイトとの通信が失敗した（接続できない・時間切れ・5xx・429）。ページが無い（404）ことは含まない」にする

## ADDED

### SPEC-NTA-COMMON-ERRORS-016 `SOURCE_API_ERROR` は国税庁サイトとの通信が失敗したときだけ返し、`*_NOT_FOUND` は問い合わせが成功して求めたものが無かったときだけ返す

`SOURCE_API_ERROR` は、国税庁サイトへの要求が、接続できない・応答を待ちきれなかった・HTTP 5xx・HTTP 429 のどれかで終わったときだけ返す（`retryable: true`、`next_actions` に `retry_later`、`detail.status` に HTTP ステータス（あれば）と `detail.url`）。`DOC_NOT_FOUND` / `TSUTATSU_NOT_FOUND` / `ARTICLE_NOT_FOUND` は、ローカル DB を引いて求めたものが無かったとき、または国税庁サイトへの要求が「そのページは無い」という答え（HTTP 404・410、`https://www.nta.go.jp/error/404.htm` への転送）で終わったときに返す。ページが無いことは番号や docId の誤りなので `retryable: false` にし、`next_actions` には時間をおいて取り直す案内（`retry_later`）を入れず、正しい番号を探すツールを入れる。

「DB にその種別が 1 件も無い」と「DB にはあるがその docId が無い」は、どちらも DB を引いて 0 件なので同じ code（`DOC_NOT_FOUND`）で、見分けは `error` の文・`available_doc_ids`・`next_actions`（`cli_bulk_download` か検索ツールか）で付ける。

| 場面                                                            | `code`                                        | `retryable` | 仕様 ID                                                                                                   |
| --------------------------------------------------------------- | --------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------- |
| 文書系 3 ツールで、DB にその種別が無い・その docId が無い       | `DOC_NOT_FOUND`                               | 付けない    | SPEC-NTA-GET-BUNSHOKAITOU-002・003、SPEC-NTA-GET-JIMU-UNEI-001・002、SPEC-NTA-GET-KAISEI-TSUTATSU-001・002 |
| `nta_get_qa` / `nta_get_tax_answer` で、国税庁サイトにページが無い | `DOC_NOT_FOUND`                               | `false`     | SPEC-NTA-GET-QA-014、SPEC-NTA-GET-TAX-ANSWER-013                                                          |
| `nta_get_tsutatsu` で、候補ページが無い                          | `ARTICLE_NOT_FOUND`                           | 付けない    | SPEC-NTA-GET-TSUTATSU-009・010                                                                             |
| 国税庁サイトとの通信の失敗                                      | `SOURCE_API_ERROR`                            | `true`      | SPEC-NTA-GET-QA-015、SPEC-NTA-GET-TAX-ANSWER-014、SPEC-NTA-GET-TSUTATSU-009                               |

houki-egov-mcp の SPEC-EGOV-COMMON-ERRORS-027 と同じ規則である（egov は通信の失敗を `SOURCE_*` の 4 つに分けるが、nta は `SOURCE_API_ERROR` の 1 つ）。

例: `nta_get_tax_answer` に `{ no: "6999" }` を渡し、DB に無く、国税庁サイトが `https://www.nta.go.jp/error/404.htm` に転送したときは `DOC_NOT_FOUND`・`retryable: false`。同じ引数で国税庁サイトが 503 を返したときは `SOURCE_API_ERROR`・`retryable: true`。`nta_get_jimu_unei` に DB に無い docId を渡したときは `DOC_NOT_FOUND`（v0.21.3 では `TSUTATSU_NOT_FOUND` だった）。

### SPEC-NTA-COMMON-ERRORS-017 DB の取得時点を解釈できないときは `INTERNAL_ERROR`（`retryable: false`）にし、その種別の投入をやり直す案内を付ける

`freshness` を付けるツール（文書系の検索 5 ツール、`nta_search_tsutatsu`、取得 6 ツール）が、`document.fetched_at` または `section.fetched_at` の値を日付（`YYYY-MM-DD`）または時差付きの時刻（`YYYY-MM-DDTHH:MM:SS.sssZ` / `+09:00`）として解釈できないとき（空文字、`2026/05/08` のような別の書き方、`2026-02-30` のような暦に無い日付）は、想定外の例外として止まらず、エラー `INTERNAL_ERROR` を返す。

- `retryable`: `false`（時間をおいても DB の値は変わらない）
- `error`: `取得時点を読めません: <fetched_at の値>`
- `hint`: その種別の投入フラグ（`--bulk-download-qa` など。基本通達は `--bulk-download-all`）で取り込みをやり直す案内
- `next_actions`: `{ action: "cli_bulk_download", example: { command: "houki-nta-mcp <フラグ>" } }` の 1 件
- `detail.cause`: 元の例外の文（houki-abbreviations の `computeDaysSince` が投げる `RangeError` の文）
- `tool`: 呼んだツールの名前

取り込みが書く `fetched_at` は `new Date().toISOString()` の形（`2026-10-01T00:30:00.000Z`）なので、取り込みを通した DB ではこのエラーは起きない。houki-egov-mcp の SPEC-EGOV-COMMON-ERRORS-031 と同じ形である。

例: `document.fetched_at` を `2026/05/08` に書き換えた質疑応答事例だけがある DB で `nta_search_qa` に `{ keyword: "軽減税率" }` を渡すと、`code: "INTERNAL_ERROR"`、`retryable: false`、`error` に `2026/05/08` を含み、`hint` に `--bulk-download-qa` を含み、`results` は返さない。
