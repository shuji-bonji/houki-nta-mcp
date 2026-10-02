# 差分: common_errors（20261003-t5-docs-mismatch）

`specs/current/common_errors/spec.md` に対する差分です。見出しの単位で置き換えます。

- `MODIFIED` の見出しは、current の同じ見出しの本文をこの本文で置き換える
- 「エラーの code」の表の `INTERNAL_ERROR` の行の説明に「再試行しても結果は変わらない（`retryable: false`）」を足す

## MODIFIED

### SPEC-NTA-COMMON-ERRORS-002 存在しないツール名はエラー `UNKNOWN_TOOL`（`retryable: false`）で、`error` は日本語

tools/call の `name` が 14 ツールのどれでもないときは、エラー `UNKNOWN_TOOL` を返す（`isError: true`）。

- `error` は `存在しないツールです: <name>`（ほかのエラーと同じく日本語の 1 文）
- `retryable` は `false`（同じ名前で呼び直しても結果は変わらない）
- `hint` に、呼べるツール名の一覧（`nta_search_tsutatsu` など）を書く
- `next_actions` の先頭は `action: "list_tools"`（MCP の tools/list で呼べるツールを確かめる案内）

houki-egov-mcp の SPEC-EGOV-COMMON-ERRORS-002 と同じ文である。

例: `name: "no_such_tool"` を呼ぶと、`code: "UNKNOWN_TOOL"`、`error: "存在しないツールです: no_such_tool"`、`retryable: false` で、`hint` に `nta_search_tsutatsu` が含まれる（v0.22.0 では `error` が英語の `Unknown tool: no_such_tool` で、`retryable` が無かった）。

### SPEC-NTA-COMMON-ERRORS-006 処理中の想定外の例外はエラー `INTERNAL_ERROR`（`retryable: false`）で返し、再試行を案内しない

ツールの処理の途中で想定外の例外が起きたときは、プロトコルのエラーにせず、tools/call の結果としてエラー `INTERNAL_ERROR` を返す（`isError: true`）。

- `retryable` は `false`（不具合の可能性が高く、同じ呼び出しをやり直しても結果は変わらない。`hint` は `バグの可能性があります。再現手順を添えて GitHub issue でご報告ください`）
- `next_actions` は付けない（再試行を案内する `retry_later` は、`retryable: false` と `hint` の報告の依頼に合わないので入れない）
- `detail.cause` に、元の例外の文を入れる（例: 例外の文が `boom` なら `detail.cause` は `boom`）

houki-egov-mcp の SPEC-EGOV-COMMON-ERRORS-007・018 と同じ扱いである。

例: ツールの処理が `new Error("boom")` を投げると、`code: "INTERNAL_ERROR"`、`retryable: false`、`detail.cause: "boom"` で、`next_actions` は無い（v0.22.0 では `retryable: true`、`next_actions: [{ action: "retry_later", … }]` だった）。

### SPEC-NTA-COMMON-ERRORS-009 国税庁のページの解析に失敗したときは `INTERNAL_ERROR`（`retryable: false`）で、ページの構造の変更を疑う案内を付ける

国税庁サイトから取ったページを読み取れなかったときは、エラー `INTERNAL_ERROR` を返す（`isError: true`）。当てはまるのは次の 3 ツールである。

| ツール | 読み取れなかったページ | `error` |
|---|---|---|
| `nta_get_tsutatsu` | 条項のある節のページ、または目次のページ（SPEC-NTA-GET-TSUTATSU-006・014） | `通達ページのパースに失敗: <理由>` |
| `nta_get_qa` | 事例のページ（SPEC-NTA-GET-QA-005） | `質疑応答事例ページのパースに失敗: <理由>` |
| `nta_get_tax_answer` | 記事のページ（SPEC-NTA-GET-TAX-ANSWER-005） | `タックスアンサーページのパースに失敗: <理由>` |

- `retryable` は `false`（ページの構造が変わったか、パーサの不具合で、時間をおいても結果は変わらない。SPEC-NTA-COMMON-ERRORS-006 と同じ）
- `hint` は `パーサのバグまたは国税庁ページの構造変更の可能性。報告してください`
- `url` に、読み取れなかったページの URL を入れる
- `detail` は `{ url: <同じ URL>, cause: <理由> }`
- 読み取れなかったページの内容は DB に書き戻さない

ページの取得そのものに失敗したとき（`SOURCE_API_ERROR`）と、処理中の想定外の例外（SPEC-NTA-COMMON-ERRORS-006）は、この ID に当たらない。

例: `nta_get_qa` が取った事例のページから照会要旨を読み取れなかったとき、`code: "INTERNAL_ERROR"`、`retryable: false`、`hint` は上の文（v0.22.0 では `retryable` が無かった）。
