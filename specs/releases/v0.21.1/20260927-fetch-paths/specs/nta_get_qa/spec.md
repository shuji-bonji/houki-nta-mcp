# 差分: nta_get_qa（20260927-fetch-paths）

`specs/current/nta_get_qa/spec.md` に対する差分です。見出しの単位で置き換えます。

- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す

## ADDED

### SPEC-NTA-GET-QA-012 段落の構造を持たない DB の行は、国税庁サイトから取り直す

DB にその事例の行があっても、段落の構造（照会要旨・回答要旨・関係法令通達を分けたもの）を持たない行（v0.16.0 より前に DB に入れた行）や、構造の記録が読めない行は、DB から返さず、DB に無いとき（SPEC-NTA-GET-QA-005）と同じく国税庁サイトから取る。応答の `source` は `live` になり、取った事例は SPEC-NTA-GET-QA-006 のとおり DB に書き戻す。次の呼び出しからは DB から返す（`source: "db"`）。
