# 差分: nta_search_bunshokaitou（20261006-db-failure-paths）

`specs/current/nta_search_bunshokaitou/spec.md` に対する差分です。

- `MODIFIED` の `### SPEC-…` は、current の同じ ID の見出しと本文を、見出しの行（題）も含めて置き換える
- 冒頭の「関連する Issue」の末尾に `、#144（DB を開けないときの応答。0.26.0）` を足す
- 「処理の流れ」の図は変えない

## MODIFIED

### SPEC-NTA-SEARCH-BUNSHOKAITOU-001 文書回答事例が DB に 1 件も無いときは検索できないことをエラーで返す

DB に文書回答事例が 1 件も無いとき（DB のファイルが無い・版の記録が無い・版が合わない・開けないときを含む）は、「該当なし」の検索結果ではなく、エラー `DOC_NOT_FOUND` を返す。応答に `results` は付けない。

- `error` は「ローカル DB に文書回答事例が 1 件も無いため、検索できません（「該当なし」という結果ではありません）」
- `tool` は `nta_search_bunshokaitou`
- `hint` は DB の状態ごとの文（SPEC-NTA-DB-SCHEMA-029。`<種別>` は `文書回答事例`、フラグは `--bulk-download-bunshokaitou`）。どの文も開こうとした DB のパスを含む
- `next_actions` の先頭は `action: "cli_bulk_download"`、`example.command` は `--bulk-download-bunshokaitou` を付けた案内のコマンド（SPEC-NTA-DB-SCHEMA-027）。版が新しい・読めない DB と、開けない DB では入れない（SPEC-NTA-DB-SCHEMA-021・029）
- 開けない DB では `retryable: false` と `detail.cause` も付ける（SPEC-NTA-DB-SCHEMA-029。v0.25.x では SPEC-NTA-COMMON-ERRORS-006 の `INTERNAL_ERROR` だった）

他の種別の文書（質疑応答事例など）だけが DB にあっても、文書回答事例が無ければこのエラーになる。

例: 環境変数を付けずに起動し（ホームディレクトリが `/Users/bonji`）、0 バイトの `~/.cache/houki-nta-mcp/cache.db` で `{ keyword: "適格請求書" }` を渡すと、`hint` は ``ローカル DB（~/.cache/houki-nta-mcp/cache.db）にはまだ何も投入されていません。`npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-bunshokaitou` で文書回答事例を投入してください``（v0.24.x では `MCP サーバーが開いている DB（/Users/bonji/.cache/houki-nta-mcp/cache.db）に文書回答事例（doc_type="bunshokaitou"）が入っていません。…`）。
