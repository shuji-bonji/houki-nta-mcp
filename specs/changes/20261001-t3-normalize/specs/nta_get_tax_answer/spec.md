# 差分: nta_get_tax_answer（20261001-t3-normalize）

`specs/current/nta_get_tax_answer/spec.md` に対する差分です。見出しの単位で置き換えます。

- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す
- 「入力」の表の `no` の行の「半角の数字 4 桁」を「数字 4 桁（全角は半角に揃えてから読む。015）」にする
- 差分 `20261001-t1-argument-guards` で置き換えた SPEC-NTA-GET-TAX-ANSWER-001 の本文のうち、「全角の数字（`"６１０１"`）を半角に揃えてから見るかどうかは、差分 `20261001-t3-normalize` で決める（この差分では今のまま、揃えずに数字以外として扱う）」の 1 文を「全角の数字は半角に揃えてから見る（SPEC-NTA-GET-TAX-ANSWER-015）」に置き換える。同じ ID を 2 つの差分で MODIFIED にすると `spec-ids check` が採番の衝突と見るので、本文の置き換えはこの箇条書きで指示する

## ADDED

### SPEC-NTA-GET-TAX-ANSWER-015 `no` は半角に揃えてから形を確かめる

`no` は、前後の空白を除いた値を houki-abbreviations の `normalizeJpText` の規則（全角英数字を半角に、ダッシュ類 `－` `‐` `‑` `–` `—` `―` `−` を `-` に、全角チルダ `～` `〜` を `~` に、全角空白を半角空白にし、前後の空白を除く。罫線 `─` と長音 `ー` は変えない。大文字と小文字は区別する）で揃えてから、SPEC-NTA-GET-TAX-ANSWER-001・012 の形の検査に進む（SPEC-NTA-SEARCH-RULES-019）。揃えた後の値で DB を引き、国税庁サイトの URL を組み立てる。

例: `{ no: "６１０１" }` は `{ no: "6101" }` と同じ応答（v0.21.3 では数字以外として `INVALID_ARGUMENT` だった）。
