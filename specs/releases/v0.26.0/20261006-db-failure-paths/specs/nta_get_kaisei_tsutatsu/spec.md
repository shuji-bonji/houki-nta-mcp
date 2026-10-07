# 差分: nta_get_kaisei_tsutatsu（20261006-db-failure-paths）

`specs/current/nta_get_kaisei_tsutatsu/spec.md` に対する差分です。

- `MODIFIED` の `### SPEC-…` は、current の同じ ID の見出しと本文を、見出しの行（題）も含めて置き換える
- 冒頭の「関連する Issue」の末尾に `、#144（DB を開けないときの応答。0.26.0）` を足す
- 「処理の流れ」の図は変えない

## MODIFIED

### SPEC-NTA-GET-KAISEI-TSUTATSU-001 ローカル DB に改正通達が 1 件も無いときは投入を案内する

ローカル DB に改正通達が 1 件も無い（他の種別の文書だけが入っている場合、DB のファイルが無い・版の記録が無い・版が合わない・開けない場合を含む）ときは、エラー `DOC_NOT_FOUND` を返す。国税庁サイトには取りに行かない。応答は次を含む。

- `error`: `ローカル DB に改正通達が 1 件も無いため、docId="<docId>" を取得できません`
- `hint`: DB の状態ごとの文（SPEC-NTA-DB-SCHEMA-029。`<種別>` は `改正通達`、フラグは `--bulk-download-kaisei`）。どの文も開こうとした DB のパスを含む
- `next_actions`: `action` が `cli_bulk_download` の 1 件。`example.command` は `--bulk-download-kaisei` を付けた案内のコマンド（SPEC-NTA-DB-SCHEMA-027）。版が新しい・読めない DB と、開けない DB では入れない（SPEC-NTA-DB-SCHEMA-021・029）
- `tool`: `nta_get_kaisei_tsutatsu`
- `available_doc_ids` は付けない
- 開けない DB では `retryable: false` と `detail.cause` も付ける（SPEC-NTA-DB-SCHEMA-029。v0.25.x では SPEC-NTA-COMMON-ERRORS-006 の `INTERNAL_ERROR` だった）

v0.21.3 では code が `TSUTATSU_NOT_FOUND` だった。文書系 3 ツールで `DOC_NOT_FOUND` に揃えた（houki-nta-mcp #64、SPEC-NTA-COMMON-ERRORS-016）。

例: 環境変数を付けずに起動し（ホームディレクトリが `/Users/bonji`）、質疑応答事例だけを入れた DB で `{ docId: "0026003-067" }` を渡すと、`hint` は ``ローカル DB（~/.cache/houki-nta-mcp/cache.db）に改正通達（doc_type="kaisei"）が入っていません。`npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-kaisei` で投入してください。…`` で始まり、`next_actions[0].example.command` は `npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-kaisei`（v0.24.x では `MCP サーバーが開いている DB（/Users/bonji/.cache/houki-nta-mcp/cache.db）に…` で始まり、コマンドは `houki-nta-mcp --bulk-download-kaisei`）。
