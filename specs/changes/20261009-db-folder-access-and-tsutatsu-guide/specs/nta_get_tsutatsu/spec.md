# 差分: nta_get_tsutatsu（20261009-db-folder-access-and-tsutatsu-guide）

`specs/current/nta_get_tsutatsu/spec.md` に対する差分です。見出しの単位で置き換えます。

- `MODIFIED` の `### SPEC-…` は、current の同じ ID の節（見出しから次の `###` または `##` の手前まで）を、見出しの行（題）も含めて丸ごと置き換える
- 冒頭の「関連する Issue」の末尾に `、#155（ライブ取得に対応していない通達に、実行できない投入のコマンドを案内しない。0.27.0）` を足す
- `## できないこと` は、current の同じ見出しの節を丸ごと置き換える
- 「入力」、「処理の流れ」の図、「未決」は変えない

## MODIFIED

### SPEC-NTA-GET-TSUTATSU-007 DB に無く、ライブ取得にも対応していない通達は、今は取り込めないことを返す

その通達の条項が DB に 1 件も無く、上の 4 通達でもないとき（例: `電帳法取通`）は、エラー `TSUTATSU_NOT_FOUND` を返す。

- `error` は今までどおり `"<正式名>" は DB にも未投入で、ライブ取得用 URL も未登録です`
- `hint` は `この通達（<正式名>）は、今は取り込めません。国税庁サイトから取れるのも、投入のフラグ（--bulk-download の --tsutatsu）で DB に入れられるのも、基本通達 4 種（消費税法基本通達・所得税基本通達・法人税基本通達・相続税法基本通達）だけです`。投入のコマンドを書かない（投入のフラグ `--tsutatsu` は基本通達 4 種の正式名しか受け付けず、ほかの値は SPEC-NTA-CLI-BULK-DOWNLOAD-011 のエラーで終了コード 2 になる）
- `next_actions` を付けない（v0.26.x の `cli_bulk_download` の 1 件を外すと、残りが無い）
- `supported_for_live` にライブ取得できる通達名の一覧、`resolved` に略称辞書で解決したエントリを入れる（今までどおり）
- ローカル DB の状態によらず同じ応答にする。DB を開けないとき（SPEC-NTA-DB-SCHEMA-021 の開けない行）も、SPEC-NTA-DB-SCHEMA-029 の開けないときの `hint`・`retryable`・`detail.cause` にしない。DB を開けないことは、SPEC-NTA-DB-SCHEMA-030 の `warn` の行で残る

基本通達 4 種で、候補ページに条項が無いときの `--bulk-download --tsutatsu="<正式名>"` の案内（SPEC-NTA-GET-TSUTATSU-010）は変えない。

例: `{ name: "電帳法取通", clause: "4-1" }` は `code: "TSUTATSU_NOT_FOUND"`、`hint` は `この通達（電子計算機を使用して作成する国税関係帳簿書類の保存方法等の特例に関する法律の取扱通達）は、今は取り込めません。…基本通達 4 種（消費税法基本通達・所得税基本通達・法人税基本通達・相続税法基本通達）だけです`、`next_actions` は無い（v0.26.x では、`hint` が ``先に `npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download --tsutatsu="電子計算機を使用して作成する国税関係帳簿書類の保存方法等の特例に関する法律の取扱通達"` を実行して DB に投入してください。``、`next_actions[0].action` が `cli_bulk_download` で、このコマンドを実行すると SPEC-NTA-CLI-BULK-DOWNLOAD-011 のエラーで終了コード 2 になった。#155）。`HOUKI_NTA_DB_PATH` で SQLite でない中身のファイルを指して起動したときも同じ応答で、`retryable` と `detail` は付かない（v0.26.x では、`hint` が ``ローカル DB（<パス>）を開けません。`` で始まり、`retryable: false`、`detail.cause` は `file is not a database`）。

## できないこと

- 通達の条項と法律の条番号の対応を示すこと（`base_laws` は法令名まで。条は付けない）
- 条項本文の中の画像（算式の GIF）の内容を返すこと（alt テキストを `[画像: …]` として残す）
- 基本通達 4 種以外の通達（電帳法取通など）を国税庁サイトから取ること・ローカル DB に投入すること（投入のフラグ `--tsutatsu` は基本通達 4 種の正式名しか受け付けない。SPEC-NTA-CLI-BULK-DOWNLOAD-011）
- 1 回の呼び出しで 10 を超えるページを国税庁サイトから取ること（全節が要るときは `--bulk-download`）
- 通達が今も有効かどうかを判定すること（改正の追跡は `nta_search_kaisei_tsutatsu` / `nta_get_kaisei_tsutatsu`）
