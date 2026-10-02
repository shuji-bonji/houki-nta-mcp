# 差分: nta_get_tsutatsu（20261001-t3-normalize）

`specs/current/nta_get_tsutatsu/spec.md` に対する差分です。見出しの単位で置き換えます。

- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す
- 「入力」の表の `name` の行に「全角英数字・ダッシュ類・全角空白は半角に揃えてから辞書で引く（018）」を足す

## ADDED

### SPEC-NTA-GET-TSUTATSU-018 `name` の全角英数字・ダッシュ類・全角空白は半角に揃えてから略称辞書で引く

`name` を略称辞書で解決するとき（SPEC-NTA-GET-TSUTATSU-001）は、houki-abbreviations の `resolveAbbreviation(name, { normalize: true })` の規則（全角英数字を半角に、ダッシュ類 `－` `‐` `‑` `–` `—` `―` `−` を `-` に、全角チルダ `～` `〜` を `~` に、全角空白を半角空白にし、前後の空白を除く。罫線 `─` と長音 `ー` は変えない。大文字と小文字は区別する）で揃えてから引く（SPEC-NTA-SEARCH-RULES-019）。管轄の判定（002）も同じ規則で引く。`clause` は今までどおり SPEC-NTA-GET-TSUTATSU-004・008 の規則で揃える。

例: `{ name: "消基通　", clause: "５－１－９" }` は `{ name: "消基通", clause: "5-1-9" }` と同じ応答（v0.21.3 では `name` が辞書に無い扱いで `ABBREVIATION_NOT_FOUND` だった）。
