# 差分: nta_get_bunshokaitou（20261006-db-failure-paths）

`specs/current/nta_get_bunshokaitou/spec.md` に対する差分です。

- `MODIFIED` の `### SPEC-…` は、current の同じ ID の見出しと本文を、見出しの行（題）も含めて置き換える
- 冒頭の「関連する Issue」の末尾に `、#144（DB を開けないときの応答。0.26.0）` を足す
- 「処理の流れ」の図は変えない

## MODIFIED

### SPEC-NTA-GET-BUNSHOKAITOU-002 DB に文書回答事例が 1 件も無いときは投入を案内する

ローカル DB に文書回答事例が 1 件も無い（DB が空、質疑応答事例など他の種別の文書しか入っていない、DB のファイルが無い・版の記録が無い・版が合わない・開けない）ときは、エラー `DOC_NOT_FOUND` を返す。この応答は次を持つ。

| フィールド | 内容 |
| --- | --- |
| `error` | `ローカル DB に文書回答事例が 1 件も無いため、docId="<渡した docId>" を取得できません` |
| `hint` | DB の状態ごとの文（SPEC-NTA-DB-SCHEMA-029。`<種別>` は `文書回答事例`、フラグは `--bulk-download-bunshokaitou`）。どの文も開こうとした DB のパスを含む |
| `next_actions` | 1 件。`action: "cli_bulk_download"`、`example.command` は `--bulk-download-bunshokaitou` を付けた案内のコマンド（SPEC-NTA-DB-SCHEMA-027）。版が新しい・読めない DB と、開けない DB では入れない（SPEC-NTA-DB-SCHEMA-021・029） |
| `tool` | `nta_get_bunshokaitou` |
| `retryable`・`detail` | 開けない DB だけ `retryable: false` と `detail.cause`（SPEC-NTA-DB-SCHEMA-029。v0.25.x では SPEC-NTA-COMMON-ERRORS-006 の `INTERNAL_ERROR` だった） |

`available_doc_ids` は付けない（選ばせる文書が無い）。

例: 環境変数を付けずに起動し（ホームディレクトリが `/Users/bonji`）、改正通達だけを入れた DB で `{ docId: "shotoku/250416" }` を渡すと、`hint` は ``ローカル DB（~/.cache/houki-nta-mcp/cache.db）に文書回答事例（doc_type="bunshokaitou"）が入っていません。`npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-bunshokaitou` で投入してください。…`` で始まる（v0.24.x では `MCP サーバーが開いている DB（/Users/bonji/.cache/houki-nta-mcp/cache.db）に…` で始まり、コマンドは `houki-nta-mcp --bulk-download-bunshokaitou`）。
