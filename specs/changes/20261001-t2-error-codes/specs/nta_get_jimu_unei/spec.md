# 差分: nta_get_jimu_unei（20261001-t2-error-codes）

`specs/current/nta_get_jimu_unei/spec.md` に対する差分です。見出しの単位で置き換えます。

- `MODIFIED` の見出しは、current の同じ見出しの本文をこの本文で置き換える
- 「処理の流れ」の図と本文にある `TSUTATSU_NOT_FOUND` を `DOC_NOT_FOUND` に置き換える

## MODIFIED

### SPEC-NTA-GET-JIMU-UNEI-001 事務運営指針が DB に 1 件も無いときは投入を案内する

ローカル DB に事務運営指針が 1 件も無い（別の種別の文書しか無い DB を含む）ときは、エラー `DOC_NOT_FOUND` を返す。国税庁サイトには取りに行かない。

- `error` は `ローカル DB に事務運営指針が 1 件も無いため、docId="<docId>" を取得できません`
- `hint` に、MCP サーバーが開いている DB のパスと、`houki-nta-mcp --bulk-download-jimu-unei` で投入する案内、環境変数 `HOUKI_NTA_DB_PATH` / `XDG_CACHE_HOME` が bulk download の環境と同じか確かめる案内を書く
- `next_actions` は `cli_bulk_download` の 1 件で、`example.command` は `houki-nta-mcp --bulk-download-jimu-unei`
- `tool` は `nta_get_jimu_unei`。`available_doc_ids` は付けない

v0.21.3 では code が `TSUTATSU_NOT_FOUND` だった。文書系 3 ツールで `DOC_NOT_FOUND` に揃える（houki-nta-mcp #64、SPEC-NTA-COMMON-ERRORS-016）。本文・`hint`・`next_actions`・`available_doc_ids`は変えない。

### SPEC-NTA-GET-JIMU-UNEI-002 事務運営指針はあるが docId が無いときは「見つかりません」と候補を返す

ローカル DB に事務運営指針はあるが、その `docId` の文書が無いときは、エラー `DOC_NOT_FOUND` を返す。投入を勧める文言（「未投入」）は使わない。

- `error` は `事務運営指針 docId="<docId>" は見つかりません`
- `hint` に、DB にある事務運営指針の件数（例: `DB の事務運営指針 32 件に、この docId はありません`）、`available_doc_ids` から選ぶか `nta_search_jimu_unei` で探す案内、DB を投入した後に公開された文書は `houki-nta-mcp --bulk-download-jimu-unei` をもう一度実行すると取り込める旨を書く
- `available_doc_ids` に、DB にある事務運営指針を新しい順に最大 30 件入れる。要素は `docId`・`title`・`issuedAt`。他の種別（改正通達・文書回答事例など）の docId は入れない
- `next_actions` は `{ action: "nta_search_jimu_unei", reason: "キーワード検索で正しい docId を探せます" }` の 1 件
- `tool` は `nta_get_jimu_unei`

v0.21.3 では code が `TSUTATSU_NOT_FOUND` だった。文書系 3 ツールで `DOC_NOT_FOUND` に揃える（houki-nta-mcp #64、SPEC-NTA-COMMON-ERRORS-016）。本文・`hint`・`next_actions`・`available_doc_ids`は変えない。
