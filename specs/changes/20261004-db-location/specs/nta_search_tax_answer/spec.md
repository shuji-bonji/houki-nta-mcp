# 差分: nta_search_tax_answer（20261004-db-location）

`specs/current/nta_search_tax_answer/spec.md` に対する差分です。

- `MODIFIED` は、見出しの行（題）も含めて、current の同じ ID の見出しと本文をこの差分の見出しと本文に置き換える
- 冒頭の「関連する Issue」の末尾に `、#138（DB の場所の見え方。0.25.0）` を足す

## MODIFIED

### SPEC-NTA-SEARCH-TAX-ANSWER-001 DB にタックスアンサーが 1 件も無いときは「該当なし」ではなくエラーを返す

ローカル DB にタックスアンサーが 1 件も無い（まだ投入していない、他の種別の文書だけが入っている、DB のファイルが無い・版の記録が無い・版が合わない）ときは、エラー `DOC_NOT_FOUND` を返す。キーワードに合う文書が無い「該当なし」とは違うことを、応答の形（`results` を持たないエラー）と `error` の文（「該当なし」という結果ではないこと）で示す。

- `tool` は `nta_search_tax_answer`
- `hint` は DB の状態ごとの文（SPEC-NTA-DB-SCHEMA-029。`<種別>` は `タックスアンサー`、フラグは `--bulk-download-tax-answer`）。どの文も開こうとした DB のパスを含む
- `next_actions` の先頭は `action: "cli_bulk_download"` で、`example.command` は `--bulk-download-tax-answer` を付けた案内のコマンド（SPEC-NTA-DB-SCHEMA-027）。版が新しい・読めない DB では入れない（SPEC-NTA-DB-SCHEMA-021）

例: 環境変数を付けずに起動し（ホームディレクトリが `/Users/bonji`）、質疑応答事例だけを入れた DB で `keyword: "医療費控除"` を検索すると、`code: "DOC_NOT_FOUND"`、`hint` は ``ローカル DB（~/.cache/houki-nta-mcp/cache.db）にタックスアンサー（doc_type="tax-answer"）が入っていません。`npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-tax-answer` で投入してください。…`` で始まる（v0.24.x では `MCP サーバーが開いている DB（/Users/bonji/.cache/houki-nta-mcp/cache.db）に…` で始まり、コマンドは `houki-nta-mcp --bulk-download-tax-answer`）。
