# 差分: search_rules（20261001-t3-normalize）

`specs/current/search_rules/spec.md` に対する差分です。見出しの単位で置き換えます。

- `MODIFIED` の見出しは、current の同じ見出しの本文をこの本文で置き換える
- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す

## MODIFIED

### SPEC-NTA-SEARCH-RULES-007 DB に入れる文字列は全角の数字・英字・記号・空白を揃える

国税庁サイトの文字列は半角と全角が混ざっているので、DB に入れる題名・本文を houki-abbreviations の `normalizeJpText`（0.7.0）で次のように揃える。

- 全角の数字・英字を半角にする。例: `１２３` → `123`、`ＮＩＳＡ` → `NISA`、`ｅ－Ｔａｘ` → `e-Tax`、`ＤＸ投資促進税制` → `DX投資促進税制`
- 全角のハイフン `－` と、ダッシュ類 `‐`（U+2010）`‑`（U+2011）`–`（U+2013）`—`（U+2014）`―`（U+2015）`−`（U+2212）を `-` にする。罫線 `─`（U+2500）と長音 `ー` は変えない。例: `1－4－13の2` → `1-4-13の2`、`課消２―11` → `課消2-11`、`データ` はそのまま
- 全角のチルダ `～` と波ダッシュ `〜` を `~` にする。例: `183〜193共-1` → `183~193共-1`
- 全角の空白を半角の空白にし、前後の空白を落とす。例: `第1章　通則` → `第1章 通則`
- 中黒 `・` と、「共」「の」「条」「項」「章」などの語は変えない。例: `1の3・1の4共-1` はそのまま
- 揃えた文字列にもう一度通しても変わらない

v0.21.3（houki-abbreviations 0.6.x）までは `－` だけを `-` にしていた。0.22.0 より前に取り込んだ行は、版 10 から 11 への移行で入れ直す（SPEC-NTA-DB-SCHEMA-019）。

例: 本文 `本文 with 全角ハイフン－と全角チルダ～が混入` は `全角ハイフン-と`・`全角チルダ~が` を含む形で入る。改正通達の本文の `課消２－11` も `課消２―11` も `課消2-11` として入る。

## ADDED

### SPEC-NTA-SEARCH-RULES-019 略称辞書を引く文字列と文書の識別子は、半角に揃えてから照合する

次の 2 つの入口は、どのツールでも同じ規則（全角英数字を半角に、ダッシュ類 `－` `‐` `‑` `–` `—` `―` `−` を `-` に、全角チルダ `～` `〜` を `~` に、全角空白を半角空白にし、前後の空白を除く。罫線 `─` と長音 `ー` は変えない。大文字と小文字は区別する）で揃えてから使う。

1. 略称辞書（houki-abbreviations）を引く文字列: `resolve_abbreviation` の `abbr`（SPEC-NTA-RESOLVE-ABBREVIATION-008）、`nta_get_tsutatsu` の `name`（SPEC-NTA-GET-TSUTATSU-018）、検索 6 ツールの `keyword` の略称・通称の展開（SPEC-NTA-SEARCH-RULES-009・010・016）。`resolveAbbreviation(name, { normalize: true })` で引く
2. 文書の識別子: `nta_get_qa` の `category` / `id`（SPEC-NTA-GET-QA-016）、`nta_get_tax_answer` の `no`（SPEC-NTA-GET-TAX-ANSWER-015）、`nta_get_kaisei_tsutatsu` / `nta_get_jimu_unei` / `nta_get_bunshokaitou` / `nta_inspect_pdf_meta` の `docId`（各 011・020）。`normalizeJpText` を通してから、T1 の形の検査（SPEC-NTA-COMMON-ERRORS-015）に進む。`nta_get_tsutatsu` の `clause`（SPEC-NTA-GET-TSUTATSU-004・008）も同じ規則

応答に返す引数の値（`keyword`、`abbr` など）は渡した値のまま。houki-egov-mcp の T3（SPEC-EGOV-RESOLVE-ABBREVIATION-011 など）と同じ範囲である。

例: `nta_search_qa` に `keyword: "ＰＬ法"` を渡すと、略称辞書の `PL法`（`製造物責任法`）に当たり、SPEC-NTA-SEARCH-RULES-016 の管轄の規則で展開するかどうかを決める（v0.21.3 では辞書に無い扱いで展開しなかった）。応答の `keyword` は `"ＰＬ法"` のまま。
