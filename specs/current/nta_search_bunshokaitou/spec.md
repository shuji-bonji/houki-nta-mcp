# 機能: nta_search_bunshokaitou（文書回答事例をキーワードで検索する）

- 機能 ID: NTA
- 版: current
- 承認日:
- 起こした元: v0.21.0 の `src/tools/handlers.ts`（`handleNtaSearchBunshokaitou`）、`src/tools/definitions.ts`、`src/tools/tool-args.ts`、`src/constants.ts`、`src/services/db-search.ts`、`src/services/freshness.ts`、`src/services/index-status.ts`、`src/tools/doc-search-zero-hit.test.ts`、`src/tools/handlers.test.ts`
- 関連する Issue: houki-nta-mcp #18（短い語の検索）、#21（通称の展開）、#23（0 件の理由を分ける）、#30（索引から消えた文書の印）

この文書は「このツールは何をするか」を書きます。どう実装しているか（関数名・テーブル名）は書きません。

## アクター

- MCP クライアント（Claude などの LLM、または CLI から呼ぶ人）。`keyword` を渡して、ローカル DB に入っている国税庁の文書回答事例（本庁と国税局の両方）のうちキーワードに合うものの一覧（`docId`・題名・抜粋）を受け取る。本文は `nta_get_bunshokaitou` に `docId` を渡して読む

## 入力

| 引数 | 必須 | 内容 |
|---|---|---|
| `keyword` | 必須 | 検索キーワード。例: `"電子帳簿"`、`"適格請求書"`、`"災害損失"`。空白で区切ると AND 検索。3 文字以上の語を推奨 |
| `taxonomy` | 任意 | 税目フォルダ名（URL のフォルダ名）で絞り込む。例: `"shotoku"` / `"hojin"` / `"sozoku"` / `"gensen"` / `"joto-sanrin"` / `"shohi"` / `"zoyo"` / `"hyoka"` / `"shozei"` / `"sonota"`。国税局のページの別表記（`"souzoku"` / `"gensenshotoku"` / `"joto_sanrin"`）でもよい |
| `limit` | 任意 | 取得件数。既定 10、最大 50 |
| `hasPdf` | 任意 | 添付 PDF の有無で絞り込む。`true` は PDF 付きだけ、`false` は PDF 無しだけ、省略時は絞らない |

検索の対象はローカル DB だけである。事前に `houki-nta-mcp --bulk-download-bunshokaitou` で文書回答事例を DB に入れておく必要がある。国税庁サイトには取りに行かない。

## できること

### SPEC-NTA-SEARCH-BUNSHOKAITOU-001 文書回答事例が DB に 1 件も無いときは検索できないことをエラーで返す

DB に文書回答事例が 1 件も無いときは、「該当なし」の検索結果ではなく、エラー `DOC_NOT_FOUND` を返す。応答に `results` は付けない。

- `error` は「ローカル DB に文書回答事例が 1 件も無いため、検索できません（「該当なし」という結果ではありません）」
- `tool` は `nta_search_bunshokaitou`
- `hint` に、MCP サーバーが開いている DB ファイルのパスと、投入コマンド `houki-nta-mcp --bulk-download-bunshokaitou` を書く。投入したはずの場合に、bulk download を実行した環境と MCP サーバーとで環境変数 `HOUKI_NTA_DB_PATH` / `XDG_CACHE_HOME` が同じか確かめるよう書く
- `next_actions` の先頭は `action: "cli_bulk_download"`、`example.command` は `houki-nta-mcp --bulk-download-bunshokaitou`

他の種別の文書（質疑応答事例など）だけが DB にあっても、文書回答事例が無ければこのエラーになる。

### SPEC-NTA-SEARCH-BUNSHOKAITOU-002 税目の範囲に文書が無いときは税目の一覧と投入コマンドを案内する

DB に文書回答事例はあるが、`taxonomy` で絞った範囲（別表記を含む。SPEC-NTA-SEARCH-BUNSHOKAITOU-003）に 1 件も無いときは、エラーにせず `results: []` を返す。

- `hint` に、DB の文書回答事例の件数と、`taxonomy="<指定した値>"` の文書が無いこと、`taxonomy` を外すか `available_taxonomies` の値を指定するよう書く
- `available_taxonomies` に、DB の文書回答事例が持つ税目の値の一覧を入れる（別表記もそのまま入る）。例: `["souzoku", "sozoku", "zoyo"]`
- 指定した税目が本庁の索引にある税目（`shotoku` / `gensen` / `joto-sanrin` / `sozoku` / `zoyo` / `hyoka` / `hojin` / `shohi` / `shozei` / `sonota`、またはその別表記）なら、`hint` の末尾に追加の投入コマンド `houki-nta-mcp --bulk-download-bunshokaitou --bunsho-taxonomy=<本庁の表記>` を書く。国税局の別表記で指定したときは本庁の表記に直して書く（`gensenshotoku` → `--bunsho-taxonomy=gensen`）
- 本庁の索引に無い値（例: `zzz`）で指定したときは、投入コマンドは書かない（`available_taxonomies` は付ける）

### SPEC-NTA-SEARCH-BUNSHOKAITOU-003 税目の別表記をまとめて検索し、その旨を search_notes に書く

国税局のページは本庁と違う税目フォルダ名を使うことがあるので、`taxonomy` に次の組のどれかの値を指定したときは、同じ組の値を持つ文書をまとめて検索する。組のどちらの値で指定しても結果は同じである。

| 税目 | 本庁の表記 | 国税局の別表記 |
|---|---|---|
| 相続税 | `sozoku` | `souzoku` |
| 源泉所得税 | `gensen` | `gensenshotoku` |
| 譲渡所得・山林所得 | `joto-sanrin` | `joto_sanrin` |

- 結果の各要素の `taxonomy` は DB に入っている値のまま（`sozoku` で検索しても、国税局の文書は `souzoku` で返る）
- まとめて検索したときは、`search_notes` に「`taxonomy="sozoku"` は、同じ税目の別表記 `"souzoku"` の文書もまとめて検索しました」という趣旨の 1 行を入れる
- 別表記の無い税目（例: `zoyo`）や `taxonomy` を省いたときは、この行は入れない（他に注記が無ければ `search_notes` 自体を付けない）
- キーワードに合う文書が無いとき（SPEC-NTA-SEARCH-BUNSHOKAITOU-004）の `hint` の件数も、別表記の文書を含めて数える

### SPEC-NTA-SEARCH-BUNSHOKAITOU-004 キーワードに合う文書が無いときは件数付きの「該当なし」を返す

DB に文書回答事例があり、`taxonomy` と `hasPdf` の範囲にも文書はあるが、キーワードに合うものが無いときは、エラーにせず `results: []` を返す。`hint` は「該当なし。DB の文書回答事例（<絞り込みの条件>）<件数> 件に「<keyword>」に合う文書はありません。別のキーワードで試してください」の形で、件数は絞り込んだ範囲の件数である。

例: `taxonomy: "sozoku"` で DB に `sozoku` 1 件・`souzoku` 1 件があるとき、`hint` は「該当なし。DB の文書回答事例（taxonomy="sozoku"）2 件に「量子暗号通信」に合う文書はありません。別のキーワードで試してください」。絞り込みを指定しなければ「（…）」の部分は付かず、`hasPdf` を指定すれば `hasPdf=true` のように条件に加わる。

## できないこと

- 文書の本文を返すこと（結果は `docId`・題名・抜粋まで。本文は `nta_get_bunshokaitou`）
- 国税庁サイトに取りに行くこと（DB に無い文書は、`--bulk-download-bunshokaitou` をもう一度実行して取り込む）
- 発出日や国税局で絞り込むこと（絞り込めるのは `taxonomy` と `hasPdf` だけ。国税局の文書は `docId` の先頭（`tokyo/…` など）で見分ける）
- 索引から消えた文書を結果から除くこと（印を付けて返すだけ。未決 5）
- 回答が今の法令でも成り立つかを判定すること（`legal_status` は文書回答事例が個別事案への回答で一般的な法的拘束力を持たないことを示すだけ）

## 未決

初版起こしで見つけた、意図か不具合かを人が決める項目です。決まったら「できること」に ID を振るか、`specs/changes/` の差分にします。

1. **ヒットしたときの応答の形。** `results` の各要素は `docType`（`bunshokaitou`）・`docId`・`taxonomy`・`title`・`issuedAt`・`sourceUrl`・`snippet`（合った語を `<b>` で囲んだ抜粋）・`score`・`scoreReasons` を持ち、応答には `keyword`・`freshness`（DB の取得時点の範囲と `staleness`）・`legal_status`（`binds_citizens: false` / `binds_courts: false` / `binds_tax_office: false` と注）が付く。結果は `score` の高い順。このツールの応答としてのテストは `results` の件数と `taxonomy` しか確かめていない。ID を振るのは受入テストを書いてから。
2. **`hasPdf` の条件に合う文書が無いときの応答。** `results: []` と、`hint` に「PDF 付き（または PDF 無し）の文書はありません。hasPdf を外して検索してください」を返す。同じ動きは `nta_search_qa` / `nta_search_kaisei_tsutatsu` ではテストがあるが、このツールの応答としてのテストが無い。ID を振るのは受入テストを書いてから。
3. **0 件のときの `freshness`。** SPEC-NTA-SEARCH-BUNSHOKAITOU-002 では DB 全体、SPEC-NTA-SEARCH-BUNSHOKAITOU-004 では絞り込んだ範囲の取得時点を `freshness` に付ける。このツールの応答としてのテストが無い。ID を振るのは受入テストを書いてから。
4. **短い語と通称の扱い。** 2 文字の語は本文と題名の部分一致で補い、1 文字の語は検索条件から外し、どちらも `search_notes` に書く。キーワードが略称辞書の通称（例: `インボイス`）で 0 件のときは、辞書の法令名（例: `消費税法`）に広げて検索し直し、`search_notes` に書く。読み取り側のテストは `src/services/db-search.test.ts` にあるが、このツールの応答としてのテストが無い。ID を振るのは受入テストを書いてから。
5. **国税庁の索引から消えた文書の印。** 索引から外れた文書は除外せず、その要素に `index_status: "removed_from_index"` と `orphaned_at` を付け、`search_notes` に「検索結果 N 件のうち M 件は国税庁の索引から外れています」の行を足す。このツールの応答としてのテストが無い。ID を振るのは受入テストを書いてから。
6. **`limit` の範囲外の値を黙って丸める。** `limit` が 50 を超えると 50 に、1 未満だと 1 にして検索し、エラーも注記も返さない。tools/list の説明は「最大: 50」とだけ書いている。意図として認めるか、`INVALID_ARGUMENT` にするか。
7. **空の `keyword`。** `keyword: ""` は inputSchema の検証（型が文字列）を通り、`INVALID_ARGUMENT` にならない。検索語が無いので必ず 0 件になり、SPEC-NTA-SEARCH-BUNSHOKAITOU-004 の形の `hint`（「「」に合う文書はありません」）を返す。`keyword` が無いときや文字列でないときは、tools/call の入力の検査が `INVALID_ARGUMENT`（`hint` に tools/list の inputSchema を確認するよう書く）を返すが、これもこのツールの応答としてのテストが無い。
8. **`taxonomy` の値を検査しない。** 本庁の索引に無い値（`zzz` など）でも `INVALID_ARGUMENT` にせず、DB を引いて 0 件の応答（SPEC-NTA-SEARCH-BUNSHOKAITOU-002）を返す。`available_taxonomies` で正しい値が分かるので今の動きで足りるか、値の検査を足すか。
