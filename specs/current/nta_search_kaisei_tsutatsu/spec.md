# 機能: nta_search_kaisei_tsutatsu（改正通達をキーワードで検索する）

- 機能 ID: NTA
- 版: current
- 承認日:
- 起こした元: v0.21.0 の `src/tools/handlers.ts`（`handleNtaSearchKaiseiTsutatsu`・`explainDocZeroHits`）、`src/tools/definitions.ts`、`src/tools/tool-args.ts`、`src/services/db-search.ts`、`src/services/freshness.ts`、`src/services/index-status.ts`、`src/errors.ts`、`src/tools/doc-search-zero-hit.test.ts`
- 関連する Issue: houki-nta-mcp #18（短い語の補完）、#21（通称の展開）、#23（0 件の理由を分ける）、#30（索引から消えた文書の印）

この文書は「このツールは何をするか」を書きます。どう実装しているか（関数名・テーブル名）は書きません。

## アクター

- MCP クライアント（Claude などの LLM、または CLI から呼ぶ人）。`keyword` を渡して、ローカル DB に取り込んである国税庁の改正通達（一部改正通達）のうち、キーワードに合う文書の一覧（文書 ID・題名・発遣日・出典 URL・抜粋）を受け取る。本文は `nta_get_kaisei_tsutatsu` で別に取る

## 入力

| 引数 | 必須 | 内容 |
|---|---|---|
| `keyword` | 必須 | 検索キーワード。例: `"電子帳簿"` / `"インボイス"` / `"軽減税率"`。空白で区切ると複数の語になる。3 文字以上の語を推奨（2 文字の語は本文の部分一致で補い、1 文字の語は条件から外す） |
| `taxonomy` | 任意 | 税目フォルダで絞り込む。`shohi` / `shotoku` / `hojin` / `sisan/sozoku` のどれか（説明上の一覧。値の検査はしない。未決 1） |
| `limit` | 任意 | 返す件数。既定 10、最大 50 |
| `hasPdf` | 任意 | 添付 PDF の有無で絞り込む。`true` は PDF 付きだけ、`false` は PDF 無しだけ、省略は絞らない |

このツールはローカル DB だけを引く。国税庁サイトには取りに行かない。DB には事前に `--bulk-download-kaisei` で改正通達を入れておく。

## できること

### SPEC-NTA-SEARCH-KAISEI-TSUTATSU-001 DB に改正通達が 1 件も無いときは検索せずにエラーを返す

キーワードに合う文書が無く、かつ DB に改正通達が 1 件も入っていないときは、エラー `DOC_NOT_FOUND` を返す。「該当なし」という検索結果とは違うことを応答の形で示す（`results` は付けない）。

- `error`: 「ローカル DB に改正通達が 1 件も無いため、検索できません（「該当なし」という結果ではありません）」
- `hint`: MCP サーバーが開いている DB ファイルのパス、投入コマンド `houki-nta-mcp --bulk-download-kaisei`、投入したはずなら環境変数 `HOUKI_NTA_DB_PATH` / `XDG_CACHE_HOME` が bulk download を実行した環境と同じか確かめる案内
- `next_actions`: 1 件。`action: "cli_bulk_download"`、`example.command: "houki-nta-mcp --bulk-download-kaisei"`
- `tool`: `nta_search_kaisei_tsutatsu`

改正通達が 1 件も無いのは、その種別をまだ投入していないとき、`--bulk-download-everything` の途中でその種別だけ失敗したとき、bulk download と MCP サーバーとで別の DB ファイルを開いているときである。他の種別（質疑応答事例など）だけが入っている DB でもこのエラーになる。

### SPEC-NTA-SEARCH-KAISEI-TSUTATSU-002 taxonomy で絞った範囲に文書が無いときは税目の一覧を返す

DB に改正通達はあるが、`taxonomy` で絞った範囲に文書が 1 件も無いときは、エラーにせず次を返す。

- `results`: `[]`
- `keyword`: 渡した `keyword`
- `hint`: 「DB の改正通達 N 件のうち、taxonomy="<値>" の文書はありません。taxonomy を外すか、available_taxonomies の値を指定してください。」。改正通達には税目を絞って投入するフラグが無いので、`--bulk-download-kaisei` に税目を付けて追加する案内（「で追加できます」）は書かない
- `available_taxonomies`: DB の改正通達が持つ税目の一覧（昇順）。例: `["hojin", "shohi"]`
- `freshness`: DB の改正通達全体の取得時点（下の SPEC-NTA-SEARCH-KAISEI-TSUTATSU-004 と同じ形）
- `legal_status`: 通達の位置付け（SPEC-NTA-SEARCH-KAISEI-TSUTATSU-004 と同じ）

例: `shohi` と `hojin` の改正通達だけがある DB で `{ keyword: "改正", taxonomy: "sisan/sozoku" }` を渡すと、`hint` に `taxonomy="sisan/sozoku"` が入り、`available_taxonomies` は `["hojin", "shohi"]` になる。

### SPEC-NTA-SEARCH-KAISEI-TSUTATSU-003 hasPdf の条件に合う文書が無いときは hasPdf を外すよう案内する

`taxonomy` の範囲には文書があるが（`taxonomy` を省いたときは DB の改正通達全体）、`hasPdf` の条件に合う文書が 1 件も無いときは、エラーにせず次を返す。

- `results`: `[]`
- `keyword`: 渡した `keyword`
- `hint`: 「DB の改正通達（taxonomy="<値>"）N 件に、PDF 付き（または PDF 無し）の文書はありません。hasPdf を外して検索してください」。`taxonomy` を省いたときは `（taxonomy="<値>"）` の部分を書かない
- `freshness`: `taxonomy` で絞った範囲の取得時点
- `legal_status`

例: `shohi` の改正通達が PDF 付きの 1 件だけの DB で `{ keyword: "インボイス", taxonomy: "shohi", hasPdf: false }` を渡すと、`hint` は「DB の改正通達（taxonomy="shohi"）1 件に、PDF 無しの文書はありません。hasPdf を外して検索してください」になる。

### SPEC-NTA-SEARCH-KAISEI-TSUTATSU-004 文書はあるがキーワードに合わないときは「該当なし」と件数を返す

`taxonomy` と `hasPdf` の範囲に文書はあるが、`keyword` に合う文書が無いときは、エラーにせず次を返す。

- `results`: `[]`
- `keyword`: 渡した `keyword`
- `hint`: 「該当なし。DB の改正通達（<条件>）N 件に「<keyword>」に合う文書はありません。別のキーワードで試してください」。`<条件>` には渡した絞り込みを `taxonomy="shohi"`、`hasPdf=true` の形で「、」区切りで書く。絞り込みが無いときは括弧ごと書かない。N は絞り込んだ範囲の件数
- `search_notes`: 短い語の補完や通称の展開があったときだけ付く（未決 4・5）
- `freshness`: `taxonomy` で絞った範囲の取得時点。`oldest_fetched_at` / `newest_fetched_at`（ISO 8601）、`staleness`（`fresh` / `stale` / `outdated`）、`days_since_oldest`、`outdated` のときだけ `warning`（`--bulk-download-kaisei` で最新化する案内）
- `legal_status`: `binds_citizens: false` / `binds_courts: false` / `binds_tax_office: true` と、通達は行政内部文書で納税者・裁判所を直接は拘束しないが税務署員は職務として守る旨の `note`

例: PDF 付きの改正通達が 1 件の DB で `{ keyword: "電子帳簿保存", hasPdf: true }` を渡すと、`hint` は「該当なし。DB の改正通達（hasPdf=true）1 件に「電子帳簿保存」に合う文書はありません。別のキーワードで試してください」になる。

0 件の理由は SPEC-NTA-SEARCH-KAISEI-TSUTATSU-001 → 002 → 003 → 004 の順に決める。先に当てはまった理由の応答を返す。

## できないこと

- 国税庁サイトから改正通達を取ること（DB に無い文書は検索に出ない。取り込みは `--bulk-download-kaisei`）
- 改正通達の本文や添付 PDF の内容を返すこと（本文は `nta_get_kaisei_tsutatsu`、PDF の一覧は `nta_inspect_pdf_meta`）
- 基本通達の条項を検索すること（`nta_search_tsutatsu`）。事務運営指針・文書回答事例・質疑応答事例・タックスアンサーも別のツール
- 改正後の通達の本文を組み立てること、改正が今も有効かを判定すること
- 発遣日や文書 ID で絞り込むこと（絞り込めるのは `taxonomy` と `hasPdf` だけ）

## 未決

初版起こしで見つけた、意図か不具合かを人が決める項目です。決まったら「できること」に ID を振るか、`specs/changes/` の差分にします。

1. **`taxonomy` の値を検査しない。** 引数の説明には `shohi` / `shotoku` / `hojin` / `sisan/sozoku` の 4 つを書いているが、どんな文字列でも受け付け、DB に無い値は SPEC-NTA-SEARCH-KAISEI-TSUTATSU-002 の応答になる。`nta_search_qa` の `topic` のように列挙で検査するか（DB に入る税目フォルダは国税庁サイトの構成で増えうるので、列挙にしない選択もある）。
2. **`keyword` が空文字のとき。** 必須なので省くと `INVALID_ARGUMENT` になるが、`""` や空白だけは通り、検索語が無いまま 0 件となって「「」に合う文書はありません」の `hint` を返す。空のキーワードを `INVALID_ARGUMENT` にするか。テストも無い。
3. **`limit` の丸め。** 1 未満は 1、50 を超える値は 50 に黙って丸める。inputSchema に上限・下限を書いて検査するか、丸めたことを応答に示すか。テストも無い。
4. **キーワードに合う文書があるときの応答。** `results` の各要素は `docType`（`kaisei`）・`docId`・`taxonomy`・`title`・`issuedAt`・`sourceUrl`・`snippet`（合った箇所の抜粋。合った語を `<b>` で囲む）・`score`（0.0〜1.5 の関連度）・`scoreReasons`。並びは `score` の降順。応答には `keyword`・`freshness`・`legal_status` も付く。このツールの応答としてのテストが無い（検索側のテストは `src/services/db-search.test.ts` にある）。ID を振るのは受入テストを書いてから。
5. **短い語の補完と `search_notes`。** 2 文字の語は本文・題名の部分一致で補い（3 文字以上の語があれば全文検索した結果をその語で絞り込み、無ければ部分一致だけで探す）、1 文字の語は条件から外す。いずれも `search_notes` にその旨の 1 行が入る。このツールの応答としてのテストが無い。ID を振るのは受入テストを書いてから。
6. **略称・通称の展開と `search_notes`。** `keyword` 全体が houki-abbreviations の略称（`消基通` など）なら正式名も合わせて探す。通称（`インボイス` → 消費税法 など）は元の語で 0 件のときだけ正式名に広げて探し直し、広げたときは `search_notes` にその旨の 1 行が入る（`scoreReasons` にも展開の記録が入る）。このツールの応答としてのテストが無い。ID を振るのは受入テストを書いてから。
7. **国税庁の索引から消えた文書の印。** 索引から外れた文書は検索結果から除かず、その要素に `index_status: "removed_from_index"` と `orphaned_at` が付き、`search_notes` に「検索結果 N 件のうち M 件は国税庁の索引から外れています」の 1 行が入る。このツールの応答としてのテストが無い。ID を振るのは受入テストを書いてから。
8. **inputSchema に合わない引数のときの `INVALID_ARGUMENT`**（`keyword` 無し、型違い、未知の引数。`hint` に tools/list の inputSchema を確かめる案内、`next_actions` に `list_tools`、`tool` にこのツール名）は、このツールの引数でのテストが無い。ID を振るのは受入テストを書いてから。
9. **SPEC-NTA-SEARCH-KAISEI-TSUTATSU-002 の `hint` の末尾。** 税目を絞って投入するフラグが無い種別では、案内文が空のまま連結されるため `hint` が「…指定してください。」と句点で終わる（他の種別は句点の後に案内文が続く）。文としては成り立つので意図として認めるか、整えるか。
