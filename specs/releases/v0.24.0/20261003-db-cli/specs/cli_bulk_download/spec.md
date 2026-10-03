# 差分: cli_bulk_download（20261003-db-cli）

`specs/current/cli_bulk_download/spec.md` に対する差分です。見出しの単位で置き換えます。差分 `20261003-source-paths` の同じ spec.md の差分（「入力」の表の `--tax-answer-taxonomy` の値の一覧）の後に取り込みます。触る箇所は重なりません。

- `MODIFIED` の見出しは、current の同じ見出しの本文をこの本文で置き換える（見出しの行の題も置き換える）
- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す
- 冒頭の「関連する Issue」の末尾に `、#106（--tsutatsu の値と終了コード）、#110（税目を絞った投入での索引から消えた文書の印）、#128（タックスアンサーの索引の保存）` を足す
- 「入力」の表の `--tsutatsu=<正式名>` の行の「（未決 3）」を「（ほかの値は SPEC-NTA-CLI-BULK-DOWNLOAD-011）」にする。表の下に「投入のフラグは 1 回の実行で 1 つだけ。一緒に使えるフラグは cli_entry の SPEC-NTA-CLI-ENTRY-007。DB の版による扱いは SPEC-NTA-DB-SCHEMA-021」を足す
- 「処理の流れ」の図で、`B -- ない値がある --> E["使えない値と使える値を標準エラー出力に出し、何も投入せず exit 1（010）"]` を `B -- ない値がある --> E["使えない値と使える値を標準エラー出力に出し、何も投入せず exit 2（010・011）"]` にし、`B{"税目フラグの値はすべて一覧にあるか（008・009）"}` を `B{"税目フラグと --tsutatsu の値はすべて一覧にあるか（008・009・011）"}` にする。`C` の前に `B -- ある --> DB{"DB の状態（SPEC-NTA-DB-SCHEMA-021）"}`、`DB -- "新しい版・読めない版・開けない" --> DBX["国税庁サイトに接続せず exit 1"]`、`DB -- "無い・同じ・移行できる・作り直す" --> C` を挟む。`R` の後に `R --> OR["税目を絞らずに、または絞った税目の索引をすべて取れたら、索引から消えた文書の印を付け直す（012）"]` を足す
- 「できないこと」の「基本通達 4 種以外の通達を投入すること（`--tsutatsu` に 4 種以外の正式名を渡したときは未決 3）」を「基本通達 4 種以外の通達を投入すること（`--tsutatsu` に 4 種以外の値を渡すと SPEC-NTA-CLI-BULK-DOWNLOAD-011 のエラー）」にする
- 「未決」の 3（→ #106）と 4（→ #110）の行を消す

## MODIFIED

### SPEC-NTA-CLI-BULK-DOWNLOAD-010 税目フラグに一覧に無い値があれば、何も投入せずに exit 2 で終わる

税目フラグの値に一覧に無いものが 1 つでもあれば（複数指定で 1 つだけ誤っているときを含む）、国税庁サイトを取りに行かず、DB を開かず、MCP サーバーも起動せずに、終了コード 2 で終わる。標準エラー出力に、使えない値 1 つにつき 1 行、`[houki-nta-mcp] <フラグ>="<値>" は使えません。使える値: <一覧>` を出す。`--bunsho-taxonomy` では続けて `（国税局の別表記 souzoku・gensenshotoku・joto_sanrin も使えます）` を付ける。終了コード 2 は、cli_entry の引数の誤り（SPEC-NTA-CLI-ENTRY-006〜008）と同じである（v0.23.x までは 1。#106）。

例: `--bulk-download-bunshokaitou --bunsho-taxonomy=zzz` は `--bunsho-taxonomy="zzz" は使えません` と `shotoku` を含む一覧を出して終了コード 2。`--bulk-download-qa --qa-topic=shohi,zzz` も投入せず終了コード 2。

## ADDED

### SPEC-NTA-CLI-BULK-DOWNLOAD-011 `--tsutatsu` が基本通達 4 種の正式名でなければ、何も投入せずに exit 2 で終わる

`--tsutatsu=<値>` の値が `消費税法基本通達`・`所得税基本通達`・`法人税基本通達`・`相続税法基本通達` のどれでもないときは、国税庁サイトを取りに行かず、DB を開かず、MCP サーバーも起動せずに、標準エラー出力に `[houki-nta-mcp] --tsutatsu="<値>" は使えません。使える値: 消費税法基本通達, 所得税基本通達, 法人税基本通達, 相続税法基本通達` を出して終了コード 2 で終わる（SPEC-NTA-CLI-BULK-DOWNLOAD-010 と同じ形）。略称（`消基通` など）も使えない値として扱う。

例: `--bulk-download --tsutatsu=国税通則法基本通達` は上の文を出して終了コード 2 で、DB のファイルはできない（v0.23.x では DB を開いた後に `[server] fatal error` のログを出して終了コード 1 だった。#106）。`--quickstart --tsutatsu=消基通` も同じ。

### SPEC-NTA-CLI-BULK-DOWNLOAD-012 税目を絞った投入でも、絞った税目の索引をすべて取れたときは、その税目の文書に限って索引から消えた文書の印を付け直す

`--bulk-download-bunshokaitou --bunsho-taxonomy=<csv>`・`--bulk-download-tax-answer --tax-answer-taxonomy=<csv>`・`--bulk-download-qa --qa-topic=<csv>`（`--bulk-download-everything` に付けたときを含む）は、絞った税目の索引をすべて取れたときは、DB のその種別の行のうち `taxonomy` が絞った税目の行についてだけ、索引から消えた文書の印（`orphaned_at`。SPEC-NTA-SEARCH-RULES-011）を付け直す。印の付け方（索引にある・この実行で取った・題名が同じなら移動）は税目を絞らない投入と同じである。

- 文書回答事例は、絞った税目の国税局の別表記（`sozoku` に対する `souzoku` など。SPEC-NTA-CLI-BULK-DOWNLOAD-009）の行も対象にする
- 絞った税目の索引を 1 つでも取れなかったときは、印を付け直さない（税目を絞らない投入と同じ）
- 絞らなかった税目の行の `orphaned_at` は変えない
- 種別ごとの件数の記録（baseline ファイル、SPEC-NTA-CLI-HEALTH-CHECK-006）と `⚠ health warning` は、今までどおり税目を絞らない投入だけが行う。絞った実行の件数を全体の履歴と比べると警告が誤って出るためである

例: DB に質疑応答事例の `shohi` の行 A・B と `hojin` の行 C があり、国税庁の `shohi` の索引に A だけがあるとき、`--bulk-download-qa --qa-topic=shohi` を実行すると、B に `orphaned_at` が付き、A と C は NULL のまま（v0.23.x では税目を絞った投入は印を付け直さなかったので、B も NULL のままだった。#110）。

### SPEC-NTA-CLI-BULK-DOWNLOAD-013 `--bulk-download-tax-answer` は、取ったタックスアンサーの索引を DB に保存する

`--bulk-download-tax-answer`（`--bulk-download-everything` のタックスアンサーを含む）は、国税庁のタックスアンサーの索引を取って読み取れたら、SPEC-NTA-DB-SCHEMA-025 のとおり `tax_answer_index` と `tax_answer_index_page` に保存する。`--tax-answer-taxonomy` で絞ったときも、絞る前の索引のすべての記事を保存する。`--refresh` の有無によらず、取った索引で置き換える。保存した後の `nta_get_tax_answer` は、この索引を使う（SPEC-NTA-GET-TAX-ANSWER-016）。

例: `--bulk-download-tax-answer --tax-answer-taxonomy=saigai` を実行すると、投入する記事は `saigai` の記事だけだが、`tax_answer_index` には索引の全記事（2026-10-03 JST の索引では 755 行）が入る。
