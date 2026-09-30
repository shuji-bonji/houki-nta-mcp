# 差分: nta_get_kaisei_tsutatsu（20261001-t2-error-codes）

`specs/current/nta_get_kaisei_tsutatsu/spec.md` に対する差分です。見出しの単位で置き換えます。

- `MODIFIED` の見出しは、current の同じ見出しの本文をこの本文で置き換える
- 「処理の流れ」の図と本文にある `TSUTATSU_NOT_FOUND` を `DOC_NOT_FOUND` に置き換える

## MODIFIED

### SPEC-NTA-GET-KAISEI-TSUTATSU-001 ローカル DB に改正通達が 1 件も無いときは投入を案内する

ローカル DB に改正通達が 1 件も無い（他の種別の文書だけが入っている場合を含む）ときは、エラー `DOC_NOT_FOUND` を返す。国税庁サイトには取りに行かない。応答は次を含む。

- `error`: `ローカル DB に改正通達が 1 件も無いため、docId="<docId>" を取得できません`
- `hint`: MCP サーバーが開いている DB ファイルのパスと、`houki-nta-mcp --bulk-download-kaisei` で投入する案内、投入したはずなら環境変数 `HOUKI_NTA_DB_PATH` / `XDG_CACHE_HOME` が bulk download を実行した環境と同じか確かめる案内
- `next_actions`: `action` が `cli_bulk_download` の 1 件。`example.command` は `houki-nta-mcp --bulk-download-kaisei`
- `tool`: `nta_get_kaisei_tsutatsu`
- `available_doc_ids` は付けない

v0.21.3 では code が `TSUTATSU_NOT_FOUND` だった。文書系 3 ツールで `DOC_NOT_FOUND` に揃える（houki-nta-mcp #64、SPEC-NTA-COMMON-ERRORS-016）。本文・`hint`・`next_actions`・`available_doc_ids`は変えない。

### SPEC-NTA-GET-KAISEI-TSUTATSU-002 改正通達はあるが docId が無いときは「見つかりません」と候補を返す

ローカル DB に改正通達はあるが、指定した `docId` の文書が無いときは、エラー `DOC_NOT_FOUND` を返す。投入の案内（「未投入」）はしない。応答は次を含む。

- `error`: `改正通達 docId="<docId>" は見つかりません`
- `hint`: DB にある改正通達の件数（例: `DB の改正通達 118 件に、この docId はありません`）と、`available_doc_ids` から選ぶか `nta_search_kaisei_tsutatsu` で検索して docId を確かめる案内、DB を投入した後に公開された文書は `houki-nta-mcp --bulk-download-kaisei` をもう一度実行すると取り込める旨
- `available_doc_ids`: DB にある改正通達の `docId` / `title` / `issuedAt` を、発出日の新しい順に最大 30 件。改正通達以外の種別の文書は入れない
- `next_actions`: `{ action: "nta_search_kaisei_tsutatsu", reason: "キーワード検索で正しい docId を探せます" }` の 1 件
- `tool`: `nta_get_kaisei_tsutatsu`

v0.21.3 では code が `TSUTATSU_NOT_FOUND` だった。文書系 3 ツールで `DOC_NOT_FOUND` に揃える（houki-nta-mcp #64、SPEC-NTA-COMMON-ERRORS-016）。本文・`hint`・`next_actions`・`available_doc_ids`は変えない。
