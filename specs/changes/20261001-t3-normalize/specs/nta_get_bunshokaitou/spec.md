# 差分: nta_get_bunshokaitou（20261001-t3-normalize）

`specs/current/nta_get_bunshokaitou/spec.md` に対する差分です。見出しの単位で置き換えます。

- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す
- 「入力」の表の `docId` の行に「全角の数字・ダッシュ類は半角に揃えてから読む（011）」を足す

## ADDED

### SPEC-NTA-GET-BUNSHOKAITOU-011 `docId` は半角に揃えてから形を確かめる

`docId` は、前後の空白を除いた値を houki-abbreviations の `normalizeJpText` の規則（全角英数字を半角に、ダッシュ類 `－` `‐` `‑` `–` `—` `―` `−` を `-` に、全角チルダ `～` `〜` を `~` に、全角空白を半角空白にし、前後の空白を除く。罫線 `─` と長音 `ー` は変えない。大文字と小文字は区別する）で揃えてから、SPEC-NTA-GET-BUNSHOKAITOU-010 の形の検査に進む（SPEC-NTA-SEARCH-RULES-019）。揃えた後の値で DB を引き、国税庁サイトの URL を組み立てる。

例: `{ docId: "shotoku/２５０４１６" }` は `{ docId: "shotoku/250416" }` と同じ応答（v0.21.3 では全角のまま DB を引いて「見つかりません」だった）。
