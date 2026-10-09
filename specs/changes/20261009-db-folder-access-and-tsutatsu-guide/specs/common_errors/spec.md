# 差分: common_errors（20261009-db-folder-access-and-tsutatsu-guide）

`specs/current/common_errors/spec.md` に対する差分です。見出しの単位で置き換えます。

- `MODIFIED` の `### SPEC-…` は、current の同じ ID の節（見出しから次の `###` または `##` の手前まで）を、見出しの行（題）も含めて丸ごと置き換える
- 冒頭の「関連する Issue」の末尾に `、#154（置き場所のフォルダーに入る権限が無いときも開けない DB に含める。0.27.0）` を足す
- 「エラー応答のフィールド」「エラーの code」の表、「処理の流れ」、「できないこと」、「未決」は変えない

## MODIFIED

### SPEC-NTA-COMMON-ERRORS-006 処理中の想定外の例外はエラー `INTERNAL_ERROR`（`retryable: false`）で返し、再試行を案内しない

ツールの処理の途中で想定外の例外が起きたときは、プロトコルのエラーにせず、tools/call の結果としてエラー `INTERNAL_ERROR` を返す（`isError: true`）。

- `retryable` は `false`（不具合の可能性が高く、同じ呼び出しをやり直しても結果は変わらない。`hint` は `バグの可能性があります。再現手順を添えて GitHub issue でご報告ください`）
- `next_actions` は付けない（再試行を案内する `retry_later` は、`retryable: false` と `hint` の報告の依頼に合わないので入れない）
- `detail.cause` に、元の例外の文を入れる（例: 例外の文が `boom` なら `detail.cause` は `boom`）

houki-egov-mcp の SPEC-EGOV-COMMON-ERRORS-007・018 と同じ扱いである。

ローカル DB を開けない（SQLite でないファイル、フォルダー、パスの途中が普通のファイル、DB のファイルを読む権限が無い、置き場所のフォルダー（またはパスの途中のフォルダー）に入る権限が無い。SPEC-NTA-DB-SCHEMA-021 の開けない行）ことは、処理中の想定外の例外に当たらない。読むだけのツールは「DB に 1 件も無い」ときの code（SPEC-NTA-DB-SCHEMA-029）、書き戻すツールは DB を使わずに国税庁サイトから取った結果（SPEC-NTA-DB-SCHEMA-030）を返し、この ID の `INTERNAL_ERROR` にしない（v0.25.x では、14 ツールのうち DB を開く 13 ツールがこの ID の `INTERNAL_ERROR` を返していた）。

例: ツールの処理が `new Error("boom")` を投げると、`code: "INTERNAL_ERROR"`、`retryable: false`、`detail.cause: "boom"` で、`next_actions` は無い（v0.22.0 では `retryable: true`、`next_actions: [{ action: "retry_later", … }]` だった）。SQLite でない中身のファイルを `HOUKI_NTA_DB_PATH` で指して起動した MCP サーバーで `nta_search_qa { keyword: "社内会議" }` を呼ぶと、`code` は `DOC_NOT_FOUND` で、この ID の `INTERNAL_ERROR` ではない（v0.25.x では `INTERNAL_ERROR`、`error` は `内部エラーが発生しました: file is not a database`）。
