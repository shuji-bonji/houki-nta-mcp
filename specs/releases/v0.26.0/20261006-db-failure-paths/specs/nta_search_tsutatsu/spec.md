# 差分: nta_search_tsutatsu（20261006-db-failure-paths）

`specs/current/nta_search_tsutatsu/spec.md` に対する差分です。

- `MODIFIED` の `### SPEC-…` は、current の同じ ID の見出しと本文を、見出しの行（題）も含めて置き換える
- 冒頭の「関連する Issue」の末尾に `、#144（DB を開けないときの応答。0.26.0）` を足す
- 「処理の流れ」の図は変えない

## MODIFIED

### SPEC-NTA-SEARCH-TSUTATSU-003 DB に条項が 1 件も無いときは、開こうとした DB のパスと、基本通達 4 種の bulk download を案内する

ローカル DB に基本通達の条項が 1 件も入っていないときは、エラー `TSUTATSU_NOT_FOUND`（`error` は「ローカル DB に検索対象がありません」）を返す。`next_actions` に `action: "cli_bulk_download"`（`example.command` は `--bulk-download-all` を付けた案内のコマンド。SPEC-NTA-DB-SCHEMA-027）を入れる。版が新しい・読めない DB と、開けない DB では入れない（SPEC-NTA-DB-SCHEMA-021・029）。開けない DB では `retryable: false` と `detail.cause` も付ける（SPEC-NTA-DB-SCHEMA-029。v0.25.x では SPEC-NTA-COMMON-ERRORS-006 の `INTERNAL_ERROR` だった）。

`hint` は DB の状態で決める（SPEC-NTA-DB-SCHEMA-029）。DB のファイルが無い・版の記録が無い・版が合わない・開けないときは 029 の表の文。DB は使えるが条項が 1 件も無いときは次の文にする。`<パス>` は開こうとした DB のパス（SPEC-NTA-DB-SCHEMA-028 の形）、`<--bulk-download-all のコマンド>` と `<--bulk-download のコマンド>` は案内のコマンド（027。後者は `--bulk-download --tsutatsu=<正式名>`）。

```
ローカル DB（<パス>）に基本通達の条項が入っていません。`<--bulk-download-all のコマンド>` を実行して、基本通達 4 種を投入してください。1 つの通達だけを先に入れるときは `<--bulk-download のコマンド>` でも投入できます
```

このツールは基本通達 4 種をまとめて検索し、ツールの説明文と `freshness.warning`（SPEC-NTA-SEARCH-RULES-017）は `--bulk-download-all` を案内している。DB が空のときの案内も同じフラグにする。

例: 環境変数を付けずに起動した MCP サーバー（ホームディレクトリが `/Users/bonji`）で、条項の無い版 12 の DB に `{ keyword: "役員" }` を渡すと、`code: "TSUTATSU_NOT_FOUND"`、`hint` は ``ローカル DB（~/.cache/houki-nta-mcp/cache.db）に基本通達の条項が入っていません。`npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-all` を実行して、基本通達 4 種を投入してください。1 つの通達だけを先に入れるときは `npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download --tsutatsu=<正式名>` でも投入できます``、`next_actions[0].example.command` は `npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-all`（v0.24.x では `hint` が ``初回は `houki-nta-mcp --bulk-download-all` を実行して…`` で DB のパスを含まず、`example.command` は `houki-nta-mcp --bulk-download-all`。v0.22.0 では `--bulk-download` で、既定では消費税法基本通達 1 つだけが入っていた）。DB のファイルが無いときは `hint` が ``ローカル DB（~/.cache/houki-nta-mcp/cache.db）がありません。`npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-all` で基本通達を投入してください``。DB のファイルがフォルダーのときは、`hint` が ``ローカル DB（~/.cache/houki-nta-mcp/cache.db）を開けません。`` で始まり、`retryable: false`、`next_actions` は無い。
