# 差分: nta_search_kaisei_tsutatsu（20261006-db-failure-paths）

`specs/current/nta_search_kaisei_tsutatsu/spec.md` に対する差分です。

- `MODIFIED` の `### SPEC-…` は、current の同じ ID の見出しと本文を、見出しの行（題）も含めて置き換える
- 冒頭の「関連する Issue」の末尾に `、#144（DB を開けないときの応答。0.26.0）` を足す
- 「処理の流れ」の図は変えない

## MODIFIED

### SPEC-NTA-SEARCH-KAISEI-TSUTATSU-001 DB に改正通達が 1 件も無いときは検索せずにエラーを返す

キーワードに合う文書が無く、かつ DB に改正通達が 1 件も入っていないとき（DB のファイルが無い・版の記録が無い・版が合わない・開けないときを含む）は、エラー `DOC_NOT_FOUND` を返す。「該当なし」という検索結果とは違うことを応答の形で示す（`results` は付けない）。

- `error`: 「ローカル DB に改正通達が 1 件も無いため、検索できません（「該当なし」という結果ではありません）」
- `hint`: DB の状態ごとの文（SPEC-NTA-DB-SCHEMA-029。`<種別>` は `改正通達`、フラグは `--bulk-download-kaisei`）。どの文も開こうとした DB のパスを含む
- `next_actions`: 1 件。`action: "cli_bulk_download"`、`example.command` は `--bulk-download-kaisei` を付けた案内のコマンド（SPEC-NTA-DB-SCHEMA-027。環境変数を付けずに起動したときは `npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-kaisei`）。版が新しい・読めない DB と、開けない DB では入れない（SPEC-NTA-DB-SCHEMA-021・029）
- `tool`: `nta_search_kaisei_tsutatsu`
- `retryable`・`detail`: 開けない DB だけ `retryable: false` と `detail.cause`（SPEC-NTA-DB-SCHEMA-029。v0.25.x では SPEC-NTA-COMMON-ERRORS-006 の `INTERNAL_ERROR` だった）

改正通達が 1 件も無いのは、その種別をまだ投入していないとき、`--bulk-download-everything` の途中でその種別だけ失敗したとき、bulk download と MCP サーバーとで別の DB ファイルを開いているときである。他の種別（質疑応答事例など）だけが入っている DB でもこのエラーになる。

例: `HOUKI_NTA_DB_PATH=/tmp/x/cache.db` で起動し、そのファイルが無いときに `{ keyword: "改正" }` を渡すと、`hint` は ``HOUKI_NTA_DB_PATH が指すファイル（/tmp/x/cache.db）がありません。HOUKI_NTA_DB_PATH を投入した DB のファイルに直すか、`HOUKI_NTA_DB_PATH='/tmp/x/cache.db' npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-kaisei` でこのパスに改正通達を投入してください``、`next_actions[0].example.command` は `HOUKI_NTA_DB_PATH='/tmp/x/cache.db' npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-kaisei`（v0.24.x では `hint` が `MCP サーバーが開いている DB（/tmp/x/cache.db）に改正通達（doc_type="kaisei"）が入っていません。…` で、ファイルが無いことを書かず、コマンドは `houki-nta-mcp --bulk-download-kaisei`）。
