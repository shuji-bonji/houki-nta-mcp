# 差分: nta_search_tax_answer（20260927-search-zero-hits）

`specs/current/nta_search_tax_answer/spec.md` に対する差分です。見出しの単位で置き換えます。

- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す

## ADDED

### SPEC-NTA-SEARCH-TAX-ANSWER-003 `hasPdf` で絞り、合う文書が無いときは `hasPdf` を外すよう案内する

`hasPdf: true` を渡すと添付 PDF のある記事だけを、`hasPdf: false` を渡すと添付 PDF の無い記事だけを探す。

DB にタックスアンサーはあるが、`hasPdf` の条件に合う記事が 1 件も無いときは、エラーにせず次を返す。

- `results`: `[]`
- `keyword`: 渡した `keyword`
- `hint`: `DB のタックスアンサー <件数> 件に、PDF 付きの文書はありません。hasPdf を外して検索してください`。`hasPdf: false` なら「PDF 無しの文書はありません」。件数は DB のタックスアンサー全体の件数
- `freshness`: DB のタックスアンサー全体の取得時点（形は SPEC-NTA-SEARCH-RULES-017）
- `legal_status`

例: DB のタックスアンサー 2 件がどちらも PDF を持たないとき、`{ keyword: "源泉徴収", hasPdf: true }` の `hint` は `DB のタックスアンサー 2 件に、PDF 付きの文書はありません。hasPdf を外して検索してください` になる。

0 件の理由は SPEC-NTA-SEARCH-TAX-ANSWER-001 → 003 → 002 の順に決める。
