# 差分: nta_get_qa（20261001-t2-error-codes）

`specs/current/nta_get_qa/spec.md` に対する差分です。見出しの単位で置き換えます。

- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す
- 「処理の流れ」の図の「国税庁サイトから取る（005）」の後に、「ページが無い → DOC_NOT_FOUND（014）」「通信の失敗 → SOURCE_API_ERROR（015）」の分岐を足す

## ADDED

### SPEC-NTA-GET-QA-014 国税庁サイトにページが無い（404・410・404 ページへの転送）ときは `DOC_NOT_FOUND` を返し、検索ツールを案内する

`topic` / `category` / `id` の事例が DB に無く国税庁サイトから取るとき、国税庁サイトが HTTP 404 か 410 を返した、または `https://www.nta.go.jp/error/404.htm` に転送したときは、エラー `DOC_NOT_FOUND`（`retryable: false`）を返す（SPEC-NTA-COMMON-ERRORS-016）。`SOURCE_API_ERROR` にはしない。

- `error`: 渡した引数の値と、そのページが国税庁サイトに無いこと
- `hint`: 番号を確かめる案内（nta_search_qa で探す）
- `next_actions`: `{ action: "nta_search_qa", reason: "キーワード検索で正しい番号を探せます", example: { topic: <渡した topic>, keyword: "<探したい語>" } }` の 1 件。`retry_later` は入れない
- `detail.status`: 国税庁サイトが返した HTTP ステータス（転送のときは 404）、`detail.url`: 取りに行った URL
- `tool`: `nta_get_qa`

例: 国税庁サイトが 404 を返す状態で `{ topic: "shohi", category: "99", id: "99" }` を渡すと、`code: "DOC_NOT_FOUND"`、`retryable: false`、`next_actions[0].action: "nta_search_qa"`（v0.21.3 では `SOURCE_API_ERROR`・`retryable: true`・`retry_later` だった）。`/error/404.htm` への転送でも、410 でも同じ。

### SPEC-NTA-GET-QA-015 国税庁サイトとの通信が失敗したときは `SOURCE_API_ERROR`（`retryable: true`）を返す

国税庁サイトから取るときに、接続できない・応答を待ちきれなかった・HTTP 5xx・HTTP 429 のどれかで終わったとき（取り直しても失敗したとき）は、エラー `SOURCE_API_ERROR`（`retryable: true`、`next_actions` に `retry_later`、`detail.status` に HTTP ステータス（あれば）、`detail.url` に取りに行った URL、`tool` に `nta_get_qa`）を返す。ページが無いこと（SPEC-NTA-GET-QA-014）はこのエラーにしない。

例: 国税庁サイトが 503 を返す状態で `{ topic: "shohi", category: "02", id: "19" }` を渡すと、`code: "SOURCE_API_ERROR"`、`retryable: true`、`detail.status: 503`。接続できないときは `detail.status` が無く `retryable: true`。
