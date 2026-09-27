# 差分: nta_search_tsutatsu（20260927-search-hit-responses）

`specs/current/nta_search_tsutatsu/spec.md` に対する差分です。見出しの単位で置き換えます。

- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す

## ADDED

### SPEC-NTA-SEARCH-TSUTATSU-010 `legal_status` はヒットしたときだけ付ける

キーワードに合う条項があるとき（SPEC-NTA-SEARCH-TSUTATSU-004）は、応答に `legal_status`（`binds_citizens: false` / `binds_courts: false` / `binds_tax_office: true` と、通達は行政内部文書で納税者・裁判所を直接は拘束しないが税務署員は職務として守る旨の `note`）を付ける。キーワードに合う条項が無いとき（SPEC-NTA-SEARCH-TSUTATSU-005）は `legal_status` を付けない。
