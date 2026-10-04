# 差分: nta_inspect_pdf_meta（20261004-db-location）

`specs/current/nta_inspect_pdf_meta/spec.md` に対する差分です。

- `MODIFIED` は、見出しの行（題）も含めて、current の同じ ID の見出しと本文をこの差分の見出しと本文に置き換える
- 冒頭の「関連する Issue」の末尾に `、#138（DB の場所の見え方。0.25.0）` を足す

## MODIFIED

### SPEC-NTA-INSPECT-PDF-META-001 ローカル DB に無い文書は取りに行かない

`docType` と `docId` の組がローカル DB に無いときは、エラー `DOC_NOT_FOUND` を返す。国税庁サイトには取りに行かない。`error` に「DB に未登録」である旨を書く。`hint` は DB の状態で決める。

- DB のファイルが無い・版の記録が無い・版が合わないとき: SPEC-NTA-DB-SCHEMA-029 の表の文（`<種別>` と投入のフラグは `docType` で決める。`qa-jirei` は `質疑応答事例` と `--bulk-download-qa`）。開こうとした DB のパスを含む
- DB は使えるが、その文書が無いとき: `` `<フラグ>` で投入済みか確認してください。docId が正しいかも `nta_search_*` で検証可能``。`<フラグ>` は `docType` の投入のフラグ（`kaisei` は `--bulk-download-kaisei`、`jimu-unei` は `--bulk-download-jimu-unei`、`bunshokaitou` は `--bulk-download-bunshokaitou`、`tax-answer` は `--bulk-download-tax-answer`、`qa-jirei` は `--bulk-download-qa`）。フラグだけを書き、案内のコマンドの形（SPEC-NTA-DB-SCHEMA-027）にはしない

例: 環境変数を付けずに起動し（ホームディレクトリが `/Users/bonji`）、`~/.cache/houki-nta-mcp/cache.db` が無いときに `{ docType: "kaisei", docId: "0026003-067" }` を渡すと、`hint` は ``ローカル DB（~/.cache/houki-nta-mcp/cache.db）がありません。`npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-kaisei` で改正通達を投入してください``（v0.24.x ではファイルがあるかどうかによらず `` `--bulk-download-kaisei` で投入済みか確認してください。… ``）。版 12 の DB に質疑応答事例 `shohi/02/19` が無いときに `{ docType: "qa-jirei", docId: "shohi/02/19" }` を渡すと、`hint` は `` `--bulk-download-qa` で投入済みか確認してください。docId が正しいかも `nta_search_*` で検証可能``（v0.24.x では `--bulk-download-qa-jirei` と書いていたが、このフラグは無い）。
