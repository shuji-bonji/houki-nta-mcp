# 差分: nta_get_tsutatsu（20261012-tsutatsu-db-not-found-guide）

`specs/current/nta_get_tsutatsu/spec.md` に対する差分です。見出しの単位で置き換えます。

- `MODIFIED` の `### SPEC-…` は、current の同じ ID の節（見出しから次の `###` または `##` の手前まで）を、見出しの行（題）も含めて丸ごと置き換える
- `ADDED` の `### SPEC-…` は、current の「できること」の末尾（SPEC-NTA-GET-TSUTATSU-018 の節の後）に足す
- 冒頭の「関連する Issue」の末尾に `、#164（DB の経路の ARTICLE_NOT_FOUND の案内を 010 とそろえ、available_clauses の打ち切りを示す。0.27.1）` を足す
- 「入力」、「処理の流れ」の図、「できないこと」、「未決」は変えない

## MODIFIED

### SPEC-NTA-GET-TSUTATSU-005 DB に通達はあるが条項が無いときは、国税庁サイトから取らない通達なら番号の候補と探し方を返す

求められた条項が DB に無く、その通達の条項が DB に 1 件でもあり、次のどちらかに当たるときは、エラー `ARTICLE_NOT_FOUND` を返す。この場合は国税庁サイトには取りに行かない。

- (a) その通達を bulk download で全節取り込んである（章を絞った実行や、国税庁サイトから取った分の書き戻しではない）
- (b) 国税庁サイトから取れる通達（SPEC-NTA-GET-TSUTATSU-006 の 4 通達）ではない

応答は次のとおり。`hint` と `next_actions` の組み立ては、国税庁サイトの経路（SPEC-NTA-GET-TSUTATSU-010）と同じにする。

- `error` は今までどおり `clause "<入力の clause>" は DB 内の "<正式名>" に見つかりません`
- `available_clauses` に、DB にあるその通達の条項番号を DB に入れた順に最大 50 件入れる。`available_clauses_total` と、上限で切れたときの `hint` の文は SPEC-NTA-GET-TSUTATSU-019 のとおり
- (a) 基本通達 4 種のとき: `hint` は `<正式名>の番号の形は <その通達の番号の形>（例: <例>）。番号の形を確かめてください。\`nta_search_tsutatsu\` で条項を検索するか、\`<コマンド>\` で全節を取り直すと、DB に投入した後の改正を反映できます`。`<コマンド>` は SPEC-NTA-DB-SCHEMA-027 の形で `--bulk-download --tsutatsu="<正式名>"` を付けたもの（DB の場所の設定に応じて `HOUKI_NTA_DB_PATH=…` などを前に付ける）。`next_actions` は `nta_search_tsutatsu`（`example.keyword` は入力の `clause`）と `cli_bulk_download`（`example.command` は `hint` と同じコマンド）の 2 件
- (b) 基本通達 4 種でないとき: `hint` は `この通達（<正式名>）は国税庁サイトから取れず、投入のフラグ（--bulk-download の --tsutatsu）でも DB に入れられません（入れられるのは基本通達 4 種だけです）。DB にある条項は available_clauses のとおりです。\`nta_search_tsutatsu\` で条項を検索してください`。`next_actions` は `nta_search_tsutatsu` の 1 件。投入のコマンドを書かない（SPEC-NTA-GET-TSUTATSU-007 と同じ理由。`--tsutatsu` は基本通達 4 種の正式名しか受け付けない）
- `retryable` と `detail` は付けない（今までどおり）

4 通達のうち bulk download 済みでない通達（書き戻した節しか無い通達を含む）は、DB に無い条項を国税庁サイトから取る経路（SPEC-NTA-GET-TSUTATSU-006）へ進む。ローカル DB を開けないとき（SPEC-NTA-DB-SCHEMA-030）は、DB を空として扱うので条項が 1 件も無く、この経路には来ない。

例: 消費税法基本通達を bulk download で全節取り込んだ DB で `{ name: "消基通", clause: "99-9-9", format: "json" }` を呼ぶと、`code: "ARTICLE_NOT_FOUND"`、`hint` は `消費税法基本通達の番号の形は 章-節-条（例: 5-1-9 / 1-4-13の2）。番号の形を確かめてください。\`nta_search_tsutatsu\` で条項を検索するか、\`npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download --tsutatsu="消費税法基本通達"\` で全節を取り直すと、DB に投入した後の改正を反映できます。available_clauses は先頭 50 件です（全 <DB にある条項の数> 件）`、`next_actions` は `nta_search_tsutatsu` と `cli_bulk_download` の 2 件、`available_clauses` は 50 件（v0.27.0 では、`hint` が ``別の clause 番号を試すか、`--bulk-download` で再取得してください（最新の改正反映用）`` で、`next_actions` が無く、一覧が全件か途中までかを応答から読み取れなかった。#164）。

### SPEC-NTA-GET-TSUTATSU-010 候補ページのどれにも条項が無いときは、見たページの番号（最大 50 件）と URL を返す

候補ページを取得したがどれにも条項が無いとき（SPEC-NTA-GET-TSUTATSU-014 の目次の取り直しの後も同じとき）は、エラー `ARTICLE_NOT_FOUND` を返す。`available_clauses` に取得したページにある条項番号を、取得したページの順・ページの中の順に最大 50 件入れ、`searched_urls` に取得したページの URL を入れる。件数の上限は、DB の経路（SPEC-NTA-GET-TSUTATSU-005）の 50 件と同じにする。`available_clauses_total` と、上限で切れたときの `hint` の文は SPEC-NTA-GET-TSUTATSU-019 のとおり。`hint` に、番号の形の確認と `nta_search_tsutatsu` での検索、`--bulk-download` で全節を DB に入れる方法（SPEC-NTA-DB-SCHEMA-027 の形のコマンド）を書く。`next_actions` は `nta_search_tsutatsu` と bulk download の案内（`cli_bulk_download`）の 2 件。

ローカル DB を開けないとき（SPEC-NTA-DB-SCHEMA-030）は、`hint` の `--bulk-download` で全節を DB に入れる方法の文を書かず、`next_actions` に `cli_bulk_download` を入れない（`nta_search_tsutatsu` の 1 件）。`code`・`available_clauses`・`available_clauses_total`・`searched_urls` は同じ。

例: 取得した 3 ページに条項が合わせて 80 件あり、どれも求めた条項でないとき、`available_clauses` は 1 ページ目の先頭から数えて 50 件（v0.22.0 では 80 件すべて）、`available_clauses_total` は 80、`searched_urls` は 3 件。同じ場面で DB を開けないときは、`hint` に `--bulk-download` を含まず、`next_actions` は `nta_search_tsutatsu` の 1 件（v0.25.x では DB を開くところで `INTERNAL_ERROR` になり、国税庁サイトには取りに行かなかった）。

## ADDED

### SPEC-NTA-GET-TSUTATSU-019 `available_clauses` を返すときは元になった条項の総数を `available_clauses_total` に付け、上限で切れたときは `hint` に書く

`ARTICLE_NOT_FOUND` で `available_clauses` を返すとき（SPEC-NTA-GET-TSUTATSU-005・010）は、`available_clauses_total` に、一覧の元になった条項の総数を数値で付ける。

- DB の経路（005）では、DB にあるその通達の条項の数
- 国税庁サイトの経路（010）では、取得した候補ページにある条項の数（上限の 10 ページで見ていない候補ページの分は数えない）
- 総数が 50 を超えるときは、`available_clauses` は先頭 50 件で、`hint` の末尾に `available_clauses は先頭 50 件です（全 <総数> 件）` の文を足す（`hint` の文は `。` でつなぐ）
- 総数が 50 以下のときは、`available_clauses` が全件で、この文を書かない
- `available_clauses` を返さないエラーには、`available_clauses_total` も付けない

例: DB に `1-1-1`〜`1-1-60` の 60 件があり、どれも求めた条項でないとき、`available_clauses` は 50 件、`available_clauses_total` は `60`、`hint` の末尾は `available_clauses は先頭 50 件です（全 60 件）`。DB に 3 件のときは、`available_clauses` は 3 件、`available_clauses_total` は `3` で、`hint` にこの文は無い（v0.27.0 では `available_clauses_total` が無く、60 件のときも 3 件のときも一覧が全件か途中までかを応答から読み取れなかった。#164）。
