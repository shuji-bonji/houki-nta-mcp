# 差分: nta_get_jimu_unei（20261004-db-location）

`specs/current/nta_get_jimu_unei/spec.md` に対する差分です。

- `MODIFIED` は、見出しの行（題）も含めて、current の同じ ID の見出しと本文をこの差分の見出しと本文に置き換える
- 冒頭の「関連する Issue」の末尾に `、#138（DB の場所の見え方。0.25.0）` を足す

## MODIFIED

### SPEC-NTA-GET-JIMU-UNEI-001 事務運営指針が DB に 1 件も無いときは投入を案内する

ローカル DB に事務運営指針が 1 件も無い（別の種別の文書しか無い DB、DB のファイルが無い・版の記録が無い・版が合わない場合を含む）ときは、エラー `DOC_NOT_FOUND` を返す。国税庁サイトには取りに行かない。

- `error` は `ローカル DB に事務運営指針が 1 件も無いため、docId="<docId>" を取得できません`
- `hint` は DB の状態ごとの文（SPEC-NTA-DB-SCHEMA-029。`<種別>` は `事務運営指針`、フラグは `--bulk-download-jimu-unei`）。どの文も開こうとした DB のパスを含む
- `next_actions` は `cli_bulk_download` の 1 件で、`example.command` は `--bulk-download-jimu-unei` を付けた案内のコマンド（SPEC-NTA-DB-SCHEMA-027）。版が新しい・読めない DB では入れない（SPEC-NTA-DB-SCHEMA-021）
- `tool` は `nta_get_jimu_unei`。`available_doc_ids` は付けない

v0.21.3 では code が `TSUTATSU_NOT_FOUND` だった。文書系 3 ツールで `DOC_NOT_FOUND` に揃えた（houki-nta-mcp #64、SPEC-NTA-COMMON-ERRORS-016）。

例: `HOUKI_NTA_DB_PATH=/Users/bonji/.cache/houki-nta-mcp/cache.v12.db` で起動し（ホームディレクトリが `/Users/bonji`）、そのファイルが無いときに `{ docId: "shotoku/000101" }` を渡すと、`hint` は ``HOUKI_NTA_DB_PATH が指すファイル（~/.cache/houki-nta-mcp/cache.v12.db）がありません。HOUKI_NTA_DB_PATH を投入した DB のファイルに直すか、`HOUKI_NTA_DB_PATH="$HOME/.cache/houki-nta-mcp/cache.v12.db" npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-jimu-unei` でこのパスに事務運営指針を投入してください``（v0.24.x では `MCP サーバーが開いている DB（/Users/bonji/.cache/houki-nta-mcp/cache.v12.db）に事務運営指針（doc_type="jimu-unei"）が入っていません。…`）。

### SPEC-NTA-GET-JIMU-UNEI-002 事務運営指針はあるが docId が無いときは「見つかりません」と候補を返す

ローカル DB に事務運営指針はあるが、その `docId` の文書が無いときは、エラー `DOC_NOT_FOUND` を返す。投入を勧める文言（「未投入」）は使わない。

- `error` は `事務運営指針 docId="<docId>" は見つかりません`
- `hint` に、DB にある事務運営指針の件数（例: `DB の事務運営指針 32 件に、この docId はありません`）、`available_doc_ids` から選ぶか `nta_search_jimu_unei` で探す案内、DB を投入した後に公開された文書は `` `<コマンド>` `` をもう一度実行すると取り込める旨を書く。`<コマンド>` は `--bulk-download-jimu-unei` を付けた案内のコマンド（SPEC-NTA-DB-SCHEMA-027）
- `available_doc_ids` に、DB にある事務運営指針を新しい順に最大 30 件入れる。要素は `docId`・`title`・`issuedAt`。他の種別（改正通達・文書回答事例など）の docId は入れない
- `next_actions` は `{ action: "nta_search_jimu_unei", reason: "キーワード検索で正しい docId を探せます" }` の 1 件
- `tool` は `nta_get_jimu_unei`

v0.21.3 では code が `TSUTATSU_NOT_FOUND` だった。文書系 3 ツールで `DOC_NOT_FOUND` に揃えた（houki-nta-mcp #64、SPEC-NTA-COMMON-ERRORS-016）。

例: 環境変数を付けずに起動すると、`hint` の末尾は ``DB を投入した後に国税庁が公開した文書は、`npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-jimu-unei` をもう一度実行すると取り込めます``（v0.24.x では `houki-nta-mcp --bulk-download-jimu-unei`）。
