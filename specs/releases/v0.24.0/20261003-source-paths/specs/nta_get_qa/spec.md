# 差分: nta_get_qa（国税庁サイトとの通信の失敗の code）

この差分は `specs/current/nta_get_qa/spec.md` に対するものです。

## MODIFIED

### SPEC-NTA-GET-QA-015 国税庁サイトとの通信が失敗したときは、失敗の種類ごとの `SOURCE_*` を返す

国税庁サイトから取るとき（SPEC-NTA-GET-QA-005）に、要求がページが無い（SPEC-NTA-GET-QA-014）以外の形で失敗したときは、SPEC-NTA-COMMON-ERRORS-018 の表の code・`retryable`・`next_actions`・`detail` のエラーを返す。`tool` は `nta_get_qa`。

| 国税庁サイト | `code` | `retryable` | `next_actions` |
|---|---|---|---|
| HTTP 429 | `SOURCE_RATE_LIMITED` | `true` | `retry_later` |
| 30 秒以内に応答しない（取り直しても） | `SOURCE_TIMEOUT` | `true` | `retry_later` |
| HTTP 5xx（取り直しても） | `SOURCE_API_ERROR` | `true` | `retry_later` |
| HTTP 403・400 など（404・410・429 を除く 4xx） | `SOURCE_API_ERROR` | `false` | 付けない |
| 接続できない（取り直しても。SPEC-NTA-COMMON-ERRORS-019） | `SOURCE_UNAVAILABLE` | `true` | `retry_later` |

例: 国税庁サイトが 503 を返す状態で `{ topic: "shohi", category: "02", id: "19" }` を渡すと、`code: "SOURCE_API_ERROR"`、`retryable: true`、`detail.status: 503`。403 を返すときは `code: "SOURCE_API_ERROR"`、`retryable: false`、`next_actions` 無し（v0.23.0 では `retryable: true`・`retry_later`）。429 なら `SOURCE_RATE_LIMITED`、接続できない（`cause.code: "ENOTFOUND"`）なら `SOURCE_UNAVAILABLE`・`detail.cause: "ENOTFOUND"`（v0.23.0 ではどちらも `SOURCE_API_ERROR`）。
