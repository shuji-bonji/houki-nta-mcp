# 差分: nta_get_tsutatsu（20261003-t4-response-shape）

`specs/current/nta_get_tsutatsu/spec.md` に対する差分です。見出しの単位で置き換えます。

- `MODIFIED` の見出しは、current の同じ見出しの本文をこの本文で置き換える

## MODIFIED

### SPEC-NTA-GET-TSUTATSU-010 候補ページのどれにも条項が無いときは、見たページの番号（最大 50 件）と URL を返す

候補ページを取得したがどれにも条項が無いとき（SPEC-NTA-GET-TSUTATSU-014 の目次の取り直しの後も同じとき）は、エラー `ARTICLE_NOT_FOUND` を返す。`available_clauses` に取得したページにある条項番号を、取得したページの順・ページの中の順に最大 50 件入れ、`searched_urls` に取得したページの URL を入れる。件数の上限は、DB の経路（SPEC-NTA-GET-TSUTATSU-005）の 50 件と同じにする。`hint` に、番号の形の確認と `nta_search_tsutatsu` での検索、`--bulk-download` で全節を DB に入れる方法を書く。

例: 取得した 3 ページに条項が合わせて 80 件あり、どれも求めた条項でないとき、`available_clauses` は 1 ページ目の先頭から数えて 50 件（v0.22.0 では 80 件すべて）、`searched_urls` は 3 件。
