# 差分: nta_search_bunshokaitou（20261004-db-location）

`specs/current/nta_search_bunshokaitou/spec.md` に対する差分です。

- `MODIFIED` は、見出しの行（題）も含めて、current の同じ ID の見出しと本文をこの差分の見出しと本文に置き換える
- 冒頭の「関連する Issue」の末尾に `、#138（DB の場所の見え方。0.25.0）` を足す

## MODIFIED

### SPEC-NTA-SEARCH-BUNSHOKAITOU-001 文書回答事例が DB に 1 件も無いときは検索できないことをエラーで返す

DB に文書回答事例が 1 件も無いとき（DB のファイルが無い・版の記録が無い・版が合わないときを含む）は、「該当なし」の検索結果ではなく、エラー `DOC_NOT_FOUND` を返す。応答に `results` は付けない。

- `error` は「ローカル DB に文書回答事例が 1 件も無いため、検索できません（「該当なし」という結果ではありません）」
- `tool` は `nta_search_bunshokaitou`
- `hint` は DB の状態ごとの文（SPEC-NTA-DB-SCHEMA-029。`<種別>` は `文書回答事例`、フラグは `--bulk-download-bunshokaitou`）。どの文も開こうとした DB のパスを含む
- `next_actions` の先頭は `action: "cli_bulk_download"`、`example.command` は `--bulk-download-bunshokaitou` を付けた案内のコマンド（SPEC-NTA-DB-SCHEMA-027）。版が新しい・読めない DB では入れない（SPEC-NTA-DB-SCHEMA-021）

他の種別の文書（質疑応答事例など）だけが DB にあっても、文書回答事例が無ければこのエラーになる。

例: 環境変数を付けずに起動し（ホームディレクトリが `/Users/bonji`）、0 バイトの `~/.cache/houki-nta-mcp/cache.db` で `{ keyword: "適格請求書" }` を渡すと、`hint` は ``ローカル DB（~/.cache/houki-nta-mcp/cache.db）にはまだ何も投入されていません。`npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-bunshokaitou` で文書回答事例を投入してください``（v0.24.x では `MCP サーバーが開いている DB（/Users/bonji/.cache/houki-nta-mcp/cache.db）に文書回答事例（doc_type="bunshokaitou"）が入っていません。…`）。

### SPEC-NTA-SEARCH-BUNSHOKAITOU-002 税目の範囲に文書が無いときは税目の一覧と投入コマンドを案内する

DB に文書回答事例はあるが、`taxonomy` で絞った範囲（別表記を含む。SPEC-NTA-SEARCH-BUNSHOKAITOU-003）に 1 件も無いときは、エラーにせず `results: []` を返す。

- `hint` に、DB の文書回答事例の件数と、`taxonomy="<指定した値>"` の文書が無いこと、`taxonomy` を外すか `available_taxonomies` の値を指定するよう書く
- `available_taxonomies` に、DB の文書回答事例が持つ税目の値の一覧を入れる（別表記もそのまま入る）。例: `["souzoku", "sozoku", "zoyo"]`
- 指定した税目が本庁の索引にある税目（`shotoku` / `gensen` / `joto-sanrin` / `sozoku` / `zoyo` / `hyoka` / `hojin` / `shohi` / `shozei` / `sonota`、またはその別表記）なら、`hint` の末尾に追加の投入コマンドを書く。コマンドは `--bulk-download-bunshokaitou --bunsho-taxonomy=<本庁の表記>` を付けた案内のコマンド（SPEC-NTA-DB-SCHEMA-027）。国税局の別表記で指定したときは本庁の表記に直して書く（`gensenshotoku` → `--bunsho-taxonomy=gensen`）
- 本庁の索引に無い値（例: `zzz`）で指定したときは、投入コマンドは書かない（`available_taxonomies` は付ける）

例: 環境変数を付けずに起動し、`sozoku` と `zoyo` の文書だけがある DB で `{ keyword: "贈与", taxonomy: "gensenshotoku" }` を渡すと、`hint` の末尾は `` `npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-bunshokaitou --bunsho-taxonomy=gensen` で追加できます``（v0.24.x では `houki-nta-mcp --bulk-download-bunshokaitou --bunsho-taxonomy=gensen`）。
