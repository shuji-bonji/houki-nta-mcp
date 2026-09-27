# 差分: nta_get_qa（20260927-get-responses）

`specs/current/nta_get_qa/spec.md` に対する差分です。見出しの単位で置き換えます。

- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す

## ADDED

### SPEC-NTA-GET-QA-011 条まで読めない法令や、基本通達 4 種以外の通達は `next_actions` に入れない

SPEC-NTA-GET-QA-009 の `next_actions` には、読み取った参照のうち次のものを入れない。入れないものも `related_laws` / `related_tsutatsu` には残す。

- 法令: 条（`article`）まで読めなかったもの。法令名が「法」「令」「規則」「法律」のどれでも終わらないもの（例: `日米租税条約`）。法令名が「旧」で始まるか「改正前」を含むもの（例: `旧所得税法`）
- 通達: 番号（`clause`）まで読めなかったもの。消費税法基本通達・所得税基本通達・法人税基本通達・相続税法基本通達の 4 種以外の通達

通達の番号の末尾に `(4)` のような細目があるときは、`next_actions` の `example.clause` からは細目を外す（`related_tsutatsu` の `clause` は元のまま）。

例: 【関係法令通達】が「消費税法第2条第1項第8号、消費税法基本通達5-1-1(4)」「日米租税条約第3条」「旧所得税法第9条」の事例では、`related_laws` は 3 件だが、`next_actions` の法令の案内は `消費税法` の 1 件だけになる。通達の案内の `example` は `{ name: "消費税法基本通達", clause: "5-1-1" }` で、`related_tsutatsu` の `clause` は `5-1-1(4)` のまま。
