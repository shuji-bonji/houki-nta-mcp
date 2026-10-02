# 差分: nta_get_qa（20261001-t3-normalize）

`specs/current/nta_get_qa/spec.md` に対する差分です。見出しの単位で置き換えます。

- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す
- 「入力」の表の `category` と `id` の行に「全角の数字は半角に揃えてから読む（016）」を足す

## ADDED

### SPEC-NTA-GET-QA-016 `category` と `id` は半角に揃えてから形を確かめる

`category` と `id` は、前後の空白を除いた値を houki-abbreviations の `normalizeJpText` の規則（全角英数字を半角に、ダッシュ類 `－` `‐` `‑` `–` `—` `―` `−` を `-` に、全角チルダ `～` `〜` を `~` に、全角空白を半角空白にし、前後の空白を除く。罫線 `─` と長音 `ー` は変えない。大文字と小文字は区別する）で揃えてから、SPEC-NTA-GET-QA-013 の形の検査に進む（SPEC-NTA-SEARCH-RULES-019）。揃えた後の値で DB を引き、国税庁サイトの URL を組み立てる。

例: `{ topic: "shohi", category: "０２", id: "１９" }` は `{ topic: "shohi", category: "02", id: "19" }` と同じ応答（v0.21.3 では全角のまま DB を引き、国税庁サイトの `/law/shitsugi/shohi/０２/１９.htm` を取りに行っていた）。
