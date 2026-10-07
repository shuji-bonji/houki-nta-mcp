# 差分: nta_search_jimu_unei（20261006-db-failure-paths）

`specs/current/nta_search_jimu_unei/spec.md` に対する差分です。

- `MODIFIED` の `### SPEC-…` は、current の同じ ID の見出しと本文を、見出しの行（題）も含めて置き換える
- 冒頭の「関連する Issue」の末尾に `、#144（DB を開けないときの応答。0.26.0）` を足す
- 「処理の流れ」の図は変えない

## MODIFIED

### SPEC-NTA-SEARCH-JIMU-UNEI-001 DB に事務運営指針が 1 件も無いときはエラー DOC_NOT_FOUND を返す

ローカル DB に事務運営指針が 1 件も入っていないとき（DB のファイルが無い・版の記録が無い・版が合わない・開けないときを含む）は、キーワードに関わらずエラー `DOC_NOT_FOUND` を返す。「該当なし」の結果（SPEC-NTA-SEARCH-JIMU-UNEI-002）とは応答の形で区別できる（`results` が無い）。応答は次を持つ。

| フィールド | 内容 |
| --- | --- |
| `error` | `ローカル DB に事務運営指針が 1 件も無いため、検索できません（「該当なし」という結果ではありません）` |
| `code` | `DOC_NOT_FOUND` |
| `hint` | DB の状態ごとの文（SPEC-NTA-DB-SCHEMA-029。`<種別>` は `事務運営指針`、フラグは `--bulk-download-jimu-unei`）。どの文も開こうとした DB のパスを含む |
| `next_actions` | 1 件。`action: "cli_bulk_download"`、`example.command` は `--bulk-download-jimu-unei` を付けた案内のコマンド（SPEC-NTA-DB-SCHEMA-027）。版が新しい・読めない DB と、開けない DB では入れない（SPEC-NTA-DB-SCHEMA-021・029） |
| `tool` | `nta_search_jimu_unei` |
| `retryable`・`detail` | 開けない DB だけ `retryable: false` と `detail.cause`（SPEC-NTA-DB-SCHEMA-029。v0.25.x では SPEC-NTA-COMMON-ERRORS-006 の `INTERNAL_ERROR` だった） |

例: 環境変数を付けずに起動し（ホームディレクトリが `/Users/bonji`）、`~/.cache/houki-nta-mcp/cache.db` が無いときに `{ keyword: "書面添付" }` を渡すと、`hint` は ``ローカル DB（~/.cache/houki-nta-mcp/cache.db）がありません。`npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-jimu-unei` で事務運営指針を投入してください``、`next_actions[0].example.command` は `npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-jimu-unei`（v0.24.x では `MCP サーバーが開いている DB（/Users/bonji/.cache/houki-nta-mcp/cache.db）に事務運営指針（doc_type="jimu-unei"）が入っていません。…` で、コマンドは `houki-nta-mcp --bulk-download-jimu-unei`）。
