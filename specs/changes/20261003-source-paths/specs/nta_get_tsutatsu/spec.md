# 差分: nta_get_tsutatsu（国税庁サイトとの通信の失敗の code）

この差分は `specs/current/nta_get_tsutatsu/spec.md` に対するものです。

## MODIFIED

### SPEC-NTA-GET-TSUTATSU-009 国税庁サイトから取れなかったときは、失敗の種類ごとの `SOURCE_*` を返す

目次または候補ページの取得が、ページが無い（404・410、国税庁サイトの 404 ページへの転送）以外の形で失敗したときは、SPEC-NTA-COMMON-ERRORS-018 の表の code・`retryable`・`next_actions`・`detail` のエラーを返す（`SOURCE_RATE_LIMITED`・`SOURCE_TIMEOUT`・`SOURCE_UNAVAILABLE`・`SOURCE_API_ERROR`）。`url` と `detail.url` に、取れなかった目次か候補ページの URL を入れ、`tool` に `nta_get_tsutatsu` を入れる（v0.23.0 では `tool` が無かった）。

候補ページが存在しない（404・410、または国税庁サイトの 404 ページへの転送）ことは、エラーにせず次の候補ページへ進む。目次を取り直しても候補ページがどれも存在しなければ、SPEC-NTA-GET-TSUTATSU-010 の `ARTICLE_NOT_FOUND` を返す。目次のページそのものが 404・410・転送で終わったときは、目次の URL はこのサーバーが決めた値なので番号の誤りではなく、`SOURCE_API_ERROR`（`retryable: false`、`detail.status`）にする。

例: 国税庁サイトが候補ページに 503 を返し続けると `code: "SOURCE_API_ERROR"`、`retryable: true`、`detail.status: 503`、`tool: "nta_get_tsutatsu"`。403 なら `SOURCE_API_ERROR`・`retryable: false`・`next_actions` 無し（v0.23.0 では `retryable: true`・`retry_later`）。接続できない（`cause.code: "ENOTFOUND"`）なら `SOURCE_UNAVAILABLE`。
