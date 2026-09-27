# 差分: nta_search_jimu_unei（20260927-search-zero-hits）

`specs/current/nta_search_jimu_unei/spec.md` に対する差分です。見出しの単位で置き換えます。

- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す

## ADDED

### SPEC-NTA-SEARCH-JIMU-UNEI-005 `taxonomy` の範囲に文書が無いときは税目の一覧を返す

DB に事務運営指針はあるが、`taxonomy` で絞った範囲に文書が 1 件も無いときは、エラーにせず次を返す。

- `results`: `[]`
- `keyword`: 渡した `keyword`
- `hint`: `DB の事務運営指針 <件数> 件のうち、taxonomy="<値>" の文書はありません。taxonomy を外すか、available_taxonomies の値を指定してください。`。事務運営指針には税目を絞って投入するフラグが無いので、投入コマンドの案内は書かない
- `available_taxonomies`: DB の事務運営指針が持つ税目の一覧（昇順）
- `freshness`: DB の事務運営指針全体の取得時点（形は SPEC-NTA-SEARCH-RULES-017）
- `legal_status`: 通達の位置付け（`binds_tax_office: true`）

例: `shotoku` の事務運営指針 2 件だけがある DB で `{ keyword: "源泉徴収", taxonomy: "hojin" }` を渡すと、`hint` は `DB の事務運営指針 2 件のうち、taxonomy="hojin" の文書はありません。taxonomy を外すか、available_taxonomies の値を指定してください。`、`available_taxonomies` は `["shotoku"]` になる。

### SPEC-NTA-SEARCH-JIMU-UNEI-006 `hasPdf` の条件に合う文書が無いときは `hasPdf` を外すよう案内する

`taxonomy` の範囲（省いたときは DB の事務運営指針全体）には文書があるが、`hasPdf` の条件に合う文書が 1 件も無いときは、エラーにせず次を返す。

- `results`: `[]`
- `keyword`: 渡した `keyword`
- `hint`: `DB の事務運営指針（taxonomy="<値>"）<件数> 件に、PDF 付きの文書はありません。hasPdf を外して検索してください`。`hasPdf: false` なら「PDF 無しの文書はありません」。`taxonomy` を省いたときは `（taxonomy="…"）` の部分を書かない
- `freshness`: `taxonomy` で絞った範囲の取得時点（`hasPdf` では絞らない）
- `legal_status`

0 件の理由は SPEC-NTA-SEARCH-JIMU-UNEI-001 → 005 → 006 → 002 の順に決める。先に当てはまった理由の応答を返す。
