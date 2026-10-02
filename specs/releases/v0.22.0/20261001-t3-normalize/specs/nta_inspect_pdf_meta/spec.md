# 差分: nta_inspect_pdf_meta（20261001-t3-normalize）

`specs/current/nta_inspect_pdf_meta/spec.md` に対する差分です。見出しの単位で置き換えます。

- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す
- 「入力」の表の `docId` の行に「全角の数字・ダッシュ類は半角に揃えてから読む（020）」を足す

## ADDED

### SPEC-NTA-INSPECT-PDF-META-020 `docId` は半角に揃えてから形を確かめる

`docId` は、前後の空白を除いた値を houki-abbreviations の `normalizeJpText` の規則（全角英数字を半角に、ダッシュ類 `－` `‐` `‑` `–` `—` `―` `−` を `-` に、全角チルダ `～` `〜` を `~` に、全角空白を半角空白にし、前後の空白を除く。罫線 `─` と長音 `ー` は変えない。大文字と小文字は区別する）で揃えてから、SPEC-NTA-INSPECT-PDF-META-001（DB に無い文書は取りに行かない） の形の検査に進む（SPEC-NTA-SEARCH-RULES-019）。揃えた後の値で DB を引き、国税庁サイトの URL を組み立てる。

例: `{ docType: "kaisei", docId: "００２６００３―０６７" }` は `{ docType: "kaisei", docId: "0026003-067" }` と同じ応答（v0.21.3 では全角のまま DB を引いて「DB に無い」だった）。
