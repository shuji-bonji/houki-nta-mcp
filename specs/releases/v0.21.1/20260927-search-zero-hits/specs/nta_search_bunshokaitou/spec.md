# 差分: nta_search_bunshokaitou（20260927-search-zero-hits）

`specs/current/nta_search_bunshokaitou/spec.md` に対する差分です。見出しの単位で置き換えます。

- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す

## ADDED

### SPEC-NTA-SEARCH-BUNSHOKAITOU-005 `hasPdf` の条件に合う文書が無いときは `hasPdf` を外すよう案内する

`taxonomy` の範囲（別表記を含む。`taxonomy` を省いたときは DB の文書回答事例全体）には文書があるが、`hasPdf` の条件に合う文書が 1 件も無いときは、エラーにせず `results: []` を返す。

- `hint` は `DB の文書回答事例（taxonomy="<指定した値>"）<件数> 件に、PDF 付きの文書はありません。hasPdf を外して検索してください`。`hasPdf: false` なら「PDF 無しの文書はありません」。`taxonomy` を省いたときは `（taxonomy="…"）` の部分を書かない。件数は別表記を含めた `taxonomy` の範囲の件数
- `keyword` と `legal_status` も付く

SPEC-NTA-SEARCH-BUNSHOKAITOU-002（税目の範囲に文書が無い）に当たるときは、そちらを返す。

### SPEC-NTA-SEARCH-BUNSHOKAITOU-006 0 件のときの `freshness` は、0 件の理由ごとに範囲を変える

0 件のとき（SPEC-NTA-SEARCH-BUNSHOKAITOU-002・004・005）の `freshness`（形は SPEC-NTA-SEARCH-RULES-017）は、次の範囲で判定する。

- 税目の範囲に文書が無いとき（002）: DB の文書回答事例全体
- `hasPdf` の条件に合う文書が無いとき（005）と、キーワードに合う文書が無いとき（004）: `taxonomy` で絞った範囲（別表記を含む）。`hasPdf` では絞らない。`taxonomy` を省いたときは DB の文書回答事例全体
