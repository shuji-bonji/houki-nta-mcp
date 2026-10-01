# 差分: resolve_abbreviation（20261001-t3-normalize）

`specs/current/resolve_abbreviation/spec.md` に対する差分です。見出しの単位で置き換えます。

- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す
- 「入力」の表の `abbr` の行の「前後の空白は無視する」の後に「全角英数字・ダッシュ類・全角空白は半角に揃えてから照合する（008）」を足す

## ADDED

### SPEC-NTA-RESOLVE-ABBREVIATION-008 `abbr` の全角英数字・ダッシュ類・全角空白は半角に揃えてから辞書と照合する

`abbr` は、houki-abbreviations の `resolveAbbreviation(name, { normalize: true })` の規則（全角英数字を半角に、ダッシュ類 `－` `‐` `‑` `–` `—` `―` `−` を `-` に、全角チルダ `～` `〜` を `~` に、全角空白を半角空白にし、前後の空白を除く。罫線 `─` と長音 `ー` は変えない。大文字と小文字は区別する）で揃えてから、略称・正式名称・別名と照合する（SPEC-NTA-SEARCH-RULES-019）。応答の `abbr` は渡した値のまま。

例: `abbr: "ＰＬ法"` は `resolved.formal: "製造物責任法"`・`in_scope: false` で、応答の `abbr` は `"ＰＬ法"`（v0.21.3 では `resolved: null` だった）。`abbr: "消基通　"`（末尾が全角空白）は `消費税法基本通達`・`in_scope: true`。`abbr: "pl法"` は大文字小文字が違うので `resolved: null` のまま。
