# 差分: nta_search_qa（20261004-db-location）

`specs/current/nta_search_qa/spec.md` に対する差分です。

- `MODIFIED` は、見出しの行（題）も含めて、current の同じ ID の見出しと本文をこの差分の見出しと本文に置き換える
- 冒頭の「関連する Issue」の末尾に `、#138（DB の場所の見え方。0.25.0）` を足す

## MODIFIED

### SPEC-NTA-SEARCH-QA-001 質疑応答事例が DB に 1 件も無いときはエラー `DOC_NOT_FOUND`

ローカル DB に質疑応答事例が 1 件も入っていないとき（DB のファイルが無い・版の記録が無い・版が合わないときを含む）は、`results` を返さずにエラー `DOC_NOT_FOUND` を返す。「該当なし」という検索結果とは違うことを応答の形で示す。

- `error` に「ローカル DB に質疑応答事例が 1 件も無いため、検索できません（「該当なし」という結果ではありません）」
- `hint` は DB の状態ごとの文（SPEC-NTA-DB-SCHEMA-029。`<種別>` は `質疑応答事例`、フラグは `--bulk-download-qa`）。どの文も開こうとした DB のパスを含む
- `next_actions` の先頭は `action: "cli_bulk_download"`、`example.command` は `--bulk-download-qa` を付けた案内のコマンド（SPEC-NTA-DB-SCHEMA-027。環境変数を付けずに起動したときは `npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-qa`）。版が新しい・読めない DB では入れない（SPEC-NTA-DB-SCHEMA-021）
- `tool` は `nta_search_qa`

例: 環境変数を付けずに起動し（ホームディレクトリが `/Users/bonji`）、タックスアンサーだけを入れた DB で `{ keyword: "社内会議" }` を渡すと、`hint` は ``ローカル DB（~/.cache/houki-nta-mcp/cache.db）に質疑応答事例（doc_type="qa-jirei"）が入っていません。`npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-qa` で投入してください。…`` で始まり、`next_actions[0].example.command` は `npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-qa`（v0.24.x では `hint` が `MCP サーバーが開いている DB（/Users/bonji/.cache/houki-nta-mcp/cache.db）に…` で始まり、コマンドは `houki-nta-mcp --bulk-download-qa`）。

### SPEC-NTA-SEARCH-QA-005 `topic` の範囲に事例が 1 件も無いときは税目の一覧と投入コマンドを案内する

DB に質疑応答事例はあるが、指定した `topic` の事例が 1 件も無いときは、`results: []` を返す（エラーにはしない）。

- `hint` に、DB の質疑応答事例の件数、`topic="<指定した値>"` の文書が無いこと、`topic` を外すか `available_taxonomies` の値を指定すること、税目を絞って投入する場合は `` `<コマンド>` `` で追加できることを書く。`<コマンド>` は `--bulk-download-qa --qa-topic=<指定した値>` を付けた案内のコマンド（SPEC-NTA-DB-SCHEMA-027）
- `available_taxonomies` に、DB の質疑応答事例が持つ税目の一覧を入れる。例: `["shohi", "shotoku"]`
- `freshness` に、DB の質疑応答事例全体の取得時点と DB のパスを付ける（SPEC-NTA-SEARCH-RULES-017・022）

例: 環境変数を付けずに起動し、`shohi` の事例だけがある DB で `{ keyword: "軽減税率", topic: "shotoku" }` を渡すと、`hint` は ``… 税目を絞って投入した場合は、`npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-qa --qa-topic=shotoku` で追加できます`` で終わる（v0.24.x では `houki-nta-mcp --bulk-download-qa --qa-topic=shotoku`）。
