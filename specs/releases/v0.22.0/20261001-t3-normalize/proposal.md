---
approved: 2026-10-01
pr: 119
implementation: required
targets: [db_schema, nta_get_bunshokaitou, nta_get_jimu_unei, nta_get_kaisei_tsutatsu, nta_get_qa, nta_get_tax_answer, nta_get_tsutatsu, nta_inspect_pdf_meta, resolve_abbreviation, search_rules]
---
# 変更: 全角・半角・ダッシュ類の揃え方を houki-abbreviations 0.7.0 に一本化する（T3）

- 対象: `resolve_abbreviation` / `search_rules` / `db_schema` / `nta_get_tsutatsu` / `nta_get_qa` / `nta_get_tax_answer` / `nta_get_kaisei_tsutatsu` / `nta_get_jimu_unei` / `nta_get_bunshokaitou` / `nta_inspect_pdf_meta` の `specs/current/<dir>/spec.md`
- 実装の変更の補足: `package.json` の `@shuji-bonji/houki-abbreviations` を `^0.7.0` に上げる変更と、スキーマの版 11 への移行を含む
- 状態: 取り込み済み（v0.22.0）
- 起こした日: 2026-10-01（JST）
- 起こした役: Spec Steward
- 対象 Issue: houki-nta-mcp #66（全角の数字・記号の扱いの部分。形の検査は T1）、houki-abbreviations 0.7.0 からの申し送り（`normalizeJpText` がダッシュ類を `-` に揃えるので、DB の検索用列と食い違う）
- 決定の出典: houki-hub `docs/DECISIONS.md` 2026-09-29「T3 正規化」、2026-10-01「段階 3 の申し送り 2 件の置き場」、`docs/notes/2026-09-29-plan-spec-issues.md` 3 章・4 章「段階 3」「段階 4」・8 章、段階 1 で #66 に投稿したコメント（`docs/notes/issues-2026-09-29-decisions/nta-66.md`）、houki-abbreviations 0.7.0 の `specs/current/resolve_abbreviation/spec.md`（007〜012）と `specs/current/normalize_jp_text/spec.md`（012・013）、houki-egov-mcp の同じ差分 `spec/20261001-t3-normalize`（「揃える範囲」の文を同じにした）
- 前提: 差分 `20261001-t1-argument-guards`（PR #117）と `20261001-t2-error-codes`（PR #118）の上に積む。T1 の SPEC-NTA-GET-TAX-ANSWER-001 の「全角の数字を半角に揃えてから見るかどうかは T3 で決める」をこの差分で決める（同じ ID を 2 つの差分で MODIFIED にすると `spec-ids check` が採番の衝突と見るので、001 の 1 文の置き換えは取り込みの指示として書く）

## なぜ変えるか

v0.21.3 は、`resolve_abbreviation` の `abbr`、`nta_get_tsutatsu` の `name`、検索 6 ツールの `keyword` の略称の展開を、渡された文字列のまま略称辞書で引く。`ＰＬ法` は辞書に無い扱いになる（#66）。取得ツールの識別子（`docId`・`category`・`id`・`no`）は、全角の数字（`"６１０１"`）をそのまま DB と国税庁サイトに渡すか、`nta_get_tax_answer` だけ「数字以外」として `INVALID_ARGUMENT` にする。`nta_get_tsutatsu` の `clause` だけは全角のハイフン・数字を半角に揃えてから引く（SPEC-NTA-GET-TSUTATSU-004・008）ので、ツールによって扱いが違う（#66）。

houki-abbreviations 0.7.0 で `normalizeJpText` がダッシュ類（`‐` `‑` `–` `—` `―` `−`）も `-` に揃えるようになった。houki-nta-mcp は DB に入れる題名・本文・条番号と、検索語を同じ関数で揃えるので（SPEC-NTA-SEARCH-RULES-007）、0.22.0 で依存を `^0.7.0` に上げると、検索語のダッシュ類は `-` になるが、0.22.0 より前に取り込んだ行は `―` のままになる。

2026-09-29 の決定（T3）は、揃える場所を houki-abbreviations の関数に一本化し、MCP は入口で `normalize: true` を使い、取得系の識別子は `normalizeJpText` を通してから形を確かめる、というものである。

## 変わる振る舞い

| 場面                                                                                                                                                                                     | v0.21.3                                                                                                         | この差分                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `resolve_abbreviation` の `abbr`、`nta_get_tsutatsu` の `name`、検索 6 ツールの `keyword` の略称の展開に、全角英数字・ダッシュ類・全角空白を含む略称（`ＰＬ法`、`消基通　`）             | 辞書に無い扱い（`resolved: null`、`ABBREVIATION_NOT_FOUND`、展開しない）                                        | 半角に揃えてから辞書と照合し、`PL法` と同じエントリに当たる。応答の `abbr` は渡した値のまま                               |
| `nta_get_qa` の `category` / `id`、`nta_get_tax_answer` の `no`、文書系 3 ツールと `nta_inspect_pdf_meta` の `docId` に全角の数字・ダッシュ類（`"６１０１"`、`"０２"`、`"0026003―067"`） | `nta_get_tax_answer` は `INVALID_ARGUMENT`（数字以外）。ほかはそのまま DB・国税庁サイトに渡して「見つからない」 | `normalizeJpText` で半角に揃えてから T1 の形の検査（SPEC-NTA-GET-QA-013 など）に進む。`"６１０１"` は `"6101"` と同じ応答 |
| 検索 6 ツールの `keyword` と DB の本文のダッシュ類                                                                                                                                       | `－` だけ `-` に揃える                                                                                          | `‐` `‑` `–` `—` `―` `−` も `-` に揃える。版 10 の DB を開くと既存の行を入れ直す（スキーマの版 11）                        |

## 変わらない振る舞い

- T1 の形の検査（`category` / `id` は 1 桁か 2 桁、`no` は 4 桁、`docId` の形）。揃えた後の値に対して同じ検査をする
- 大文字と小文字の区別、語の内側の全角空白（`消　法` は `消 法` になり辞書に無い扱いのまま）。houki-egov-mcp の T3 と同じ
- `nta_get_tsutatsu` の `clause` の揃え方（SPEC-NTA-GET-TSUTATSU-004・008）。`normalizeClauseNumber`（`normalizeJpText` の後に空白を除く）のままで、0.7.0 でダッシュ類も揃うようになるだけ
- 検索語の揃え方（SPEC-NTA-SEARCH-RULES-007 の規則を `normalizeSearchQuery` で検索語にも通すこと）と、略称・通称の展開の規則（009・010・016）
- `resolve_abbreviation` の `in_scope` / `hint`（SPEC-NTA-RESOLVE-ABBREVIATION-002・003）。houki-egov-mcp の T3 で egov をこの形に揃える
- 版 10 以前の DB の移行の経路（SPEC-NTA-DB-SCHEMA-006・007 など）。版 11 への移行を末尾に足すだけ

## DB の検索用列（ダッシュ類）の扱い

0.22.0 で、スキーマの版を 10 から 11 に上げ、版 10 の DB を開いたときに `clause`（`clause_number`・`title`・`full_text`・`paragraphs_json`）、`section`（`title`）、`document`（`title`・`full_text`）の文字列を 0.7.0 の `normalizeJpText` で入れ直す（SPEC-NTA-DB-SCHEMA-019）。版 4 → 5 の入れ直し（SPEC-NTA-DB-SCHEMA-007〜009）と同じ手順で、`section.content_hash` は NULL に戻し、`document.content_hash` は計算し直す（020）。理由:

1. houki-nta-mcp には「国税庁サイトを取りに行かずに DB の中の文字列を入れ直す」移行の仕組みが既にあり（版 4 → 5）、同じ形で足せる
2. houki-nta-mcp の DB は基本通達 4 種の条項と文書系 5 種の文書で、houki-egov-mcp（e-Gov の全法令の条文。0.19.0 まで見送り）より行数が 1 桁以上少ない。版 4 → 5 の入れ直しも起動時に行った
3. 通達の条番号（`1-4-13の2`）と改正通達の文書番号（`課消2-11`）はハイフンで区切るので、国税庁サイトの原文で `―` や `−` が混ざっているとダッシュ類の違いで検索が分かれる。入れ直さないと、0.22.0 より前に取り込んだ行と後に取り込んだ行で揃え方が 2 通りになる

実データでダッシュ類を含む行の件数は確かめていない（下の「人が判断すること」2）。

## Issue の「決めること」への答え

### #66（全角の部分）

| 決めること                                                                               | 答え                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 全角の数字・記号を半角に揃えてから読む扱いを、取得系と `resolve_abbreviation` で揃えるか | 揃える。略称辞書を引く 3 か所（`resolve_abbreviation`、`nta_get_tsutatsu` の `name`、検索の略称の展開）は `normalize: true`、取得系の識別子 4 種は `normalizeJpText` を通してから T1 の形の検査（SPEC-NTA-SEARCH-RULES-019、各ツールの ID）           |
| inputSchema の `pattern` を使うか、各ツールの処理で確かめるか                            | T1 で決めたとおり各ツールの処理（SPEC-NTA-COMMON-ERRORS-015）。この差分は、その検査の前に `normalizeJpText` を通すことを足すだけで、T1 の ID の本文は変えない（SPEC-NTA-GET-TAX-ANSWER-001 の「T3 で決める」の 1 文だけ、取り込みのときに置き換える） |

### houki-abbreviations 0.7.0 の申し送り（DB の検索用列）

| 決めること                                 | 答え                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| 版 11 の migration か、0.24.0 まで見送るか | 版 11 の migration（上の「DB の検索用列」。SPEC-NTA-DB-SCHEMA-019・020、SPEC-NTA-DB-SCHEMA-001 を MODIFIED） |

## 足す仕様 ID（ADDED、11 件）

| 単位                    | 仕様 ID                           | 内容                                                                                         |
| ----------------------- | --------------------------------- | -------------------------------------------------------------------------------------------- |
| search_rules            | SPEC-NTA-SEARCH-RULES-019         | 略称辞書を引くときの揃え方（`normalize: true` の範囲）と、識別子を揃えてから形を確かめること |
| resolve_abbreviation    | SPEC-NTA-RESOLVE-ABBREVIATION-008 | `abbr` の全角英数字・ダッシュ類・全角空白を半角に揃えてから照合する                          |
| nta_get_tsutatsu        | SPEC-NTA-GET-TSUTATSU-018         | `name` の同上                                                                                |
| nta_get_qa              | SPEC-NTA-GET-QA-016               | `category` / `id` を半角に揃えてから形を確かめる                                             |
| nta_get_tax_answer      | SPEC-NTA-GET-TAX-ANSWER-015       | `no` を半角に揃えてから形を確かめる                                                          |
| nta_get_kaisei_tsutatsu | SPEC-NTA-GET-KAISEI-TSUTATSU-011  | `docId` を半角に揃えてから形を確かめる                                                       |
| nta_get_jimu_unei       | SPEC-NTA-GET-JIMU-UNEI-011        | 同上                                                                                         |
| nta_get_bunshokaitou    | SPEC-NTA-GET-BUNSHOKAITOU-011     | 同上                                                                                         |
| nta_inspect_pdf_meta    | SPEC-NTA-INSPECT-PDF-META-020     | 同上                                                                                         |
| db_schema               | SPEC-NTA-DB-SCHEMA-019            | 版 10 の DB を開くと、ダッシュ類も揃えた形で文字列を入れ直し、版 11 にする                   |
| db_schema               | SPEC-NTA-DB-SCHEMA-020            | 入れ直しの content_hash の扱い（版 4 → 5 と同じ）                                            |

## 変える仕様 ID（MODIFIED、2 件）

| 単位         | 仕様 ID                   | 変わる点                                                                       |
| ------------ | ------------------------- | ------------------------------------------------------------------------------ |
| search_rules | SPEC-NTA-SEARCH-RULES-007 | 揃える記号に `‐` `‑` `–` `—` `―` `−` を足す（罫線 `─` と長音 `ー` は変えない） |
| db_schema    | SPEC-NTA-DB-SCHEMA-001    | スキーマの版を 11 にする                                                       |

仕様 ID の無い本文の変更: T1 で置き換えた SPEC-NTA-GET-TAX-ANSWER-001 の「T3 で決める」の 1 文を「全角の数字は半角に揃えてから見る（015）」に置き換える（差分の `nta_get_tax_answer/spec.md` の冒頭の箇条書き）。REMOVED は無い。

## 互換性

code は変えない。応答の形も変えない。スキーマの版が 11 になるので、0.22.0 で開いた DB は 0.21.x で開けなくなる（版 4 → 5 のときと同じ）。CHANGELOG に書く。

## 呼び出し例への影響

2026-10-01 JST に houki-hub `scripts/reference-examples/houki-nta/ja/*.md` と houki-research-skill の `skills/houki-research/` を grep した。全角の識別子・略称を渡す例は無く、変える例は無い。

## 取り込みのとき（Publisher）

- ADDED の見出しを、各 `specs/current/<dir>/spec.md` の「できること」の末尾に足す。MODIFIED は同じ見出しの本文を置き換える。SPEC-NTA-GET-TAX-ANSWER-001 は、T1 の差分を取り込んだ後の本文の 1 文だけを `nta_get_tax_answer/spec.md` の冒頭の箇条書きのとおりに置き換える
- 各ツールの「入力」の表の `abbr` / `name` / `category` / `id` / `no` / `docId` の行に「全角の英数字・ダッシュ類は半角に揃えてから読む」を足す
- 「未決」から次の項目を消す: nta_get_tax_answer 2、resolve_abbreviation 2（nta_get_bunshokaitou 1、nta_get_kaisei_tsutatsu 5、nta_get_qa 2、nta_get_tax_answer 3 は T1 で消す）
- 各 `specs/current/<dir>/spec.md` の承認日の行に「差分 `20261001-t3-normalize` は YYYY-MM-DD（PR #N）」を足す
- この差分のフォルダーを `specs/releases/<実装を出したタグ>/20261001-t3-normalize/` へ移し、この proposal.md の「状態」を取り込み済みにする

## 人が判断すること

1. **識別子の全角を受け付けるか（016・015・011・020）。** 受け付けて半角に揃える側で書いた（`nta_get_tsutatsu` の `clause` と同じ）。`INVALID_ARGUMENT` にして `hint` で半角を案内する案もあるが、T3 の決定（揃える）に従った。
2. **版 11 の入れ直しをするか（019・020）。** する側で書いた。実データでダッシュ類を含む行の件数は確かめていない（VM から `~/.cache/houki-nta-mcp/` に届かない）。承認の前に、取り込み済みの DB で `SELECT COUNT(*) FROM clause WHERE full_text GLOB '*[‐‑–—―−]*'` と `document` の同じ問い合わせを実行し、0 件なら入れ直しを 0.24.0 まで見送る（019・020 を外し、001 も変えない）判断もある。
3. **`search_rules` の 019 の置き場。** 略称辞書を引く揃え方と識別子の揃え方を 1 つの ID にまとめた。分けるなら識別子の側を `common_errors` に移す。
4. **承認日。** この proposal.md に承認日と PR 番号を書く。
