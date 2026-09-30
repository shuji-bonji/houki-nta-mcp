# 変更: 引数の検査を inputSchema に書き、丸めずに `INVALID_ARGUMENT` にする（T1）

- 対象: `specs/current/common_errors/spec.md`、`specs/current/search_rules/spec.md` と、tools/call で呼べる 14 ツールすべての `specs/current/<tool>/spec.md`
- 実装の変更: 要（`taxonomy` の部分だけは「今の動きを意図とする」で、実装の変更は説明文のみ）
- 承認日: 2026-10-01（PR #117）
- 状態: 提案中
- 起こした日: 2026-10-01（JST）
- 起こした役: Spec Steward
- 対象 Issue: houki-nta-mcp #66（識別子の形の検査。全角の扱いは T3）、#67（`taxonomy` の値）、#68（`limit` の丸め）、#69（空のキーワード）、#79（`detail.issues` の分け方）
- 決定の出典: houki-hub `docs/DECISIONS.md` 2026-09-29「T1 引数の検査」、`docs/notes/2026-09-29-plan-spec-issues.md` 4 章「段階 4」・5.1・5.4、段階 1 で各 Issue に投稿したコメント（`docs/notes/issues-2026-09-29-decisions/nta-66.md` 〜 `nta-79.md`）、houki-egov-mcp の同じ差分 `spec/20261001-t1-argument-guards`（`message` の表・`tool` の置き場・空白だけの扱いを同じ文にした）
- 前提: main（v0.21.3、`099b6ce`）の上に積む。同じ版（0.22.0）に入れる T2（`spec/20261001-t2-error-codes`）と T3（`spec/20261001-t3-normalize`）は、この差分のマージ後にその上へ積む（`common_errors` と取得 4 ツールを 3 つの差分が触るので、採番はこの順）

## なぜ変えるか

v0.21.3 の検索 6 ツールは、`limit` の 1 未満・50 超え・小数を黙って丸め（#68）、空の `keyword` を「該当なし」として `results: []` で返す（#69。探していないのに 0 件と読める）。取得 4 ツールは `docId` / `category` / `id` / `no` の形を確かめず、形の違う値で DB を引くか国税庁サイトに取りに行ってから失敗する（#66）。`INVALID_ARGUMENT` の `detail.issues` は、違反が 2 つ以上あると 1 要素にまとまり、必須の引数が無いときの `path` が空文字で、`message` は検査の部品の英文（`data/limit must be number`）のままである（#79）。`taxonomy` は説明文に一覧があるが検査はしていない（#67）。

2026-09-29 の決定（T1）は、数値の引数は inputSchema に `type: "integer"` と `minimum` / `maximum` を、必須の文字列は `minLength: 1` を書き、`common_errors` の検査で一律に `INVALID_ARGUMENT` にして丸めない、空白だけの文字列は各ツールで `INVALID_ARGUMENT` にする、`detail.issues` は違反 1 件ごとに `{ path, message }` に分けて `path` に引数名を入れ、`message` は日本語にする、というものである。識別子の形（#66）は、T3 で全角を半角に揃えてから確かめる必要があるので、inputSchema の `pattern` ではなく各ツールの処理（正規化の後）に置く。`taxonomy`（#67）は、税目フォルダが国税庁サイトの構成で増えるので列挙にせず、今の「受け付けて、DB に無い値は `available_taxonomies` で正しい値を返す」動きを意図として仕様に書く（計画書 5.4）。

## 変わる振る舞い

| 場面                                                                                                                                                                      | v0.21.3                                                                                                                | この差分                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 検索 6 ツールの `limit` に 0・51・100・2.5・`"10"`                                                                                                                        | 1 件・50 件に丸める、小数は切り捨て、`nta_search_qa` は数値であることも確かめない                                      | inputSchema の検査で `INVALID_ARGUMENT`（`path: "limit"`）。DB を引かない                                                                                     |
| 検索 6 ツールと `resolve_abbreviation` の必須の文字列（`keyword` / `abbr`）に空文字                                                                                       | `results: []` と「該当なし」の `hint`、`resolved: null`                                                                | inputSchema の `minLength: 1` で `INVALID_ARGUMENT`（`message: "空文字は指定できません"`）                                                                    |
| 必須の文字列に空白だけ（半角・全角スペース、タブ、改行）                                                                                                                  | `nta_search_tsutatsu` だけ `INVALID_ARGUMENT`（`error` の文だけ）。ほかは「該当なし」か `resolved: null`               | どのツールでも、ツールの処理で `INVALID_ARGUMENT`（`tool`・`detail.issues[{ path, message: "空白だけは指定できません" }]`）。DB・国税庁サイト・辞書を引かない |
| `nta_get_bunshokaitou` / `nta_get_kaisei_tsutatsu` / `nta_get_jimu_unei` の `docId`、`nta_get_qa` の `category` / `id`、`nta_get_tax_answer` の `no` が受け付ける形でない | DB を引くか国税庁サイトに取りに行ってから `DOC_NOT_FOUND` / `SOURCE_API_ERROR`。`no` の数字以外だけ `INVALID_ARGUMENT` | ツールの処理で、DB と国税庁サイトを引く前に `INVALID_ARGUMENT`（`detail.issues[].path` にその引数名、`hint` に正しい形）                                      |
| `nta_get_tax_answer` の `no` が 4 桁でない（`"61"`、`"61011"`）                                                                                                           | 先頭の桁で税目を決めて取りに行く                                                                                       | `INVALID_ARGUMENT`（下の「人が判断すること」3）                                                                                                               |
| inputSchema の検査で返す `INVALID_ARGUMENT` の本文                                                                                                                        | 違反が 2 つ以上あると 1 要素。必須の引数が無いと `path` が空文字。`message` は `data/limit must be number` の形        | 違反 1 件ごとに要素を分け、`path` は引数名。`message` は日本語の決まった文。型の違反と inputSchema に無い引数が同時なら両方                                   |
| inputSchema の検査で返す `INVALID_ARGUMENT` の `hint`                                                                                                                     | `tools/list の <ツール名> の inputSchema を確認してください (型・必須・enum・未知の引数)`                              | `tools/list の <ツール名> の inputSchema を確認してください (型・必須・enum・範囲・形式・未知の引数)`                                                         |
| 文書系 3 ツールの `taxonomy`                                                                                                                                              | 検査しない（説明文には一覧）                                                                                           | 変えない。「列挙で検査せず、DB に無い値は `available_taxonomies` で正しい値を返す」を仕様に書く（SPEC-NTA-SEARCH-RULES-018）。説明文に同じことを足す          |

## 変わらない振る舞い

- inputSchema に合う引数を渡したときの応答（1 以上 50 以下の `limit`、空でない `keyword`、受け付ける形の識別子）
- 空でない `keyword` から語を分けた結果、語が 1 つも残らないとき（1 文字の語だけ・記号だけ）の応答。SPEC-NTA-SEARCH-RULES-005・006 のとおり 1 文字の語を外して `search_notes` に書き、エラーにしない。houki-egov-mcp の `search_fulltext`（SPEC-EGOV-SEARCH-FULLTEXT-005）と同じで、family で「空文字・空白だけは `INVALID_ARGUMENT`、語が残らないのは 0 件」に揃える
- `taxonomy` を受け付けて `available_taxonomies` で案内すること（SPEC-NTA-SEARCH-BUNSHOKAITOU-002、SPEC-NTA-SEARCH-KAISEI-TSUTATSU-002、SPEC-NTA-SEARCH-JIMU-UNEI-005）と、税目の別表記をまとめて検索すること（SPEC-NTA-SEARCH-BUNSHOKAITOU-003）
- `nta_get_qa` の 1 桁の `category` / `id` を 2 桁に揃えること（SPEC-NTA-GET-QA-003）。形の検査は「1 桁か 2 桁の半角の数字」で、揃える前に行う
- `nta_get_tax_answer` の先頭の桁による税目の判定（SPEC-NTA-GET-TAX-ANSWER-002・003）。桁数の検査（012）は先頭の桁の検査より先に行う
- `nta_get_tsutatsu` の `clause` の読み方（SPEC-NTA-GET-TSUTATSU-004・008）。`clause` は任意なので `minLength` は書かない
- `INVALID_ARGUMENT` の `error` の組み立て方（前置きの後に `<path>: <message>` を `; ` でつなぐ。SPEC-NTA-COMMON-ERRORS-007）と `next_actions`（`list_tools` の 1 件）
- 全角の数字・記号を受け付けるかどうか（#66 の全角の部分、SPEC-NTA-GET-TAX-ANSWER-001 の「半角の数字だけ」）。T3（`spec/20261001-t3-normalize`）で決める。この差分の形の検査は「半角で書かれた値が受け付ける形か」だけを約束し、T3 で全角を半角に揃える処理が形の検査の前に入っても、この差分の仕様 ID の本文は変わらない
- `nta_search_qa` の `domain`（#72、段階 5）、応答の `hits` / `results` の名前と `freshness` の有無（#71、T4）

## Issue の「決めること」への答え

### #66（形の検査の部分）

| 決めること                                                             | 答え                                                                                                                                                                               |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 識別子ごとに形の検査を足すか（`INVALID_ARGUMENT` と正しい形の `hint`） | 足す。inputSchema の `pattern` ではなく、各ツールの処理で DB と国税庁サイトを引く前に確かめる（SPEC-NTA-COMMON-ERRORS-015 と各ツールの ID）。T3 の正規化を先に通せるようにするため |
| 全角の数字・記号を半角に揃えてから読むか                               | この差分では決めない。T3 で決める（上の「変わらない振る舞い」）                                                                                                                    |
| `nta_get_tax_answer` の番号を 4 桁に限るか                             | 限る（提案。SPEC-NTA-GET-TAX-ANSWER-012）。下の「人が判断すること」3                                                                                                               |

### #67

| 決めること                                                                          | 答え                                                                                                                                                                       |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 列挙で検査するか、今の動き（`available_taxonomies` で正しい値を返す）を意図とするか | 今の動きを意図とする（SPEC-NTA-SEARCH-RULES-018。実装の変更: 不要）。税目フォルダは国税庁サイトの構成で増えるので、列挙にすると増えるたびに inputSchema を変えることになる |
| ツールの説明文にその扱いを書くか                                                    | 書く。3 ツールの inputSchema の `taxonomy` の `description` に「DB に無い値のときは `available_taxonomies` で正しい値を返す」を足す（T5 の規則。実装 PR で直す）           |

### #68

| 決めること                                                                | 答え                                                                                                      |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 丸める動きを意図とするか、`INVALID_ARGUMENT` にするか、丸めたことを示すか | `INVALID_ARGUMENT` にする（SPEC-NTA-COMMON-ERRORS-012 と検索 6 ツールの ID）。丸めない                    |
| inputSchema に `minimum` / `maximum` を書くか                             | 書く。6 ツールの `limit` を `type: "integer"`、`minimum: 1`、`maximum: 50` にする。既定の 10 件は変えない |

### #69

| 決めること                                                                           | 答え                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 空（と、語が 1 つも残らない入力）を `INVALID_ARGUMENT` にするか、`hint` で区別するか | 空文字と空白だけは `INVALID_ARGUMENT`（SPEC-NTA-COMMON-ERRORS-013・014 と 7 ツールの ID）。語が 1 つも残らない入力は今のまま 0 件（houki-egov-mcp と揃える。「変わらない振る舞い」）。下の「人が判断すること」2 |
| `nta_search_tsutatsu` の `INVALID_ARGUMENT` の形を inputSchema 違反のときと揃えるか  | 揃える（SPEC-NTA-SEARCH-TSUTATSU-002 の MODIFIED）                                                                                                                                                              |

### #79

| 決めること                                                      | 答え                                                                                                                 |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 違反ごとに `detail.issues` の要素を分けるか                     | 分ける（SPEC-NTA-COMMON-ERRORS-010）。inputSchema に無い引数も 1 つずつ                                              |
| 型の違反と inputSchema に無い引数が同時にあるとき、両方を返すか | 返す（010）                                                                                                          |
| `message` に残る検査の部品の文をそのまま返すか、整えるか        | 整える。違反の種類ごとに決まった日本語の文にする（011 の表。houki-egov-mcp の SPEC-EGOV-COMMON-ERRORS-022 と同じ表） |

## 足す仕様 ID（ADDED、29 件）

| 単位                       | 仕様 ID                             | 内容                                                                                          |
| -------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------- |
| common_errors              | SPEC-NTA-COMMON-ERRORS-010          | `detail.issues` は違反 1 件ごとに分け、`path` は引数名                                        |
| common_errors              | SPEC-NTA-COMMON-ERRORS-011          | `message` は違反の種類ごとに決まった日本語の 1 文                                             |
| common_errors              | SPEC-NTA-COMMON-ERRORS-012          | 数値の引数は inputSchema に整数と範囲を書き、違反は `INVALID_ARGUMENT` で丸めない             |
| common_errors              | SPEC-NTA-COMMON-ERRORS-013          | 必須の文字列は `minLength: 1`。空文字は `INVALID_ARGUMENT`                                    |
| common_errors              | SPEC-NTA-COMMON-ERRORS-014          | 空白だけの必須の文字列は、ツールの処理で同じ形の `INVALID_ARGUMENT`                           |
| common_errors              | SPEC-NTA-COMMON-ERRORS-015          | 識別子の形はツールの処理で確かめ、合わなければ同じ形の `INVALID_ARGUMENT` と正しい形の `hint` |
| search_rules               | SPEC-NTA-SEARCH-RULES-018           | `taxonomy` は列挙で検査せず、DB に無い値は `available_taxonomies` で正しい値を返す            |
| nta_search_tsutatsu        | SPEC-NTA-SEARCH-TSUTATSU-011        | `limit` は 1 以上 50 以下の整数                                                               |
| nta_search_qa              | SPEC-NTA-SEARCH-QA-008              | `limit` は 1 以上 50 以下の整数                                                               |
| nta_search_qa              | SPEC-NTA-SEARCH-QA-009              | 空の `keyword`                                                                                |
| nta_search_tax_answer      | SPEC-NTA-SEARCH-TAX-ANSWER-004      | `limit` は 1 以上 50 以下の整数                                                               |
| nta_search_tax_answer      | SPEC-NTA-SEARCH-TAX-ANSWER-005      | 空の `keyword`                                                                                |
| nta_search_kaisei_tsutatsu | SPEC-NTA-SEARCH-KAISEI-TSUTATSU-005 | `limit` は 1 以上 50 以下の整数                                                               |
| nta_search_kaisei_tsutatsu | SPEC-NTA-SEARCH-KAISEI-TSUTATSU-006 | 空の `keyword`                                                                                |
| nta_search_jimu_unei       | SPEC-NTA-SEARCH-JIMU-UNEI-007       | `limit` は 1 以上 50 以下の整数                                                               |
| nta_search_jimu_unei       | SPEC-NTA-SEARCH-JIMU-UNEI-008       | 空の `keyword`                                                                                |
| nta_search_bunshokaitou    | SPEC-NTA-SEARCH-BUNSHOKAITOU-007    | `limit` は 1 以上 50 以下の整数                                                               |
| nta_search_bunshokaitou    | SPEC-NTA-SEARCH-BUNSHOKAITOU-008    | 空の `keyword`                                                                                |
| nta_get_qa                 | SPEC-NTA-GET-QA-013                 | `category` / `id` の形（1 桁か 2 桁の半角の数字）                                             |
| nta_get_tax_answer         | SPEC-NTA-GET-TAX-ANSWER-012         | `no` は 4 桁                                                                                  |
| nta_get_kaisei_tsutatsu    | SPEC-NTA-GET-KAISEI-TSUTATSU-009    | 空の `docId`                                                                                  |
| nta_get_kaisei_tsutatsu    | SPEC-NTA-GET-KAISEI-TSUTATSU-010    | `docId` の形                                                                                  |
| nta_get_jimu_unei          | SPEC-NTA-GET-JIMU-UNEI-009          | 空の `docId`                                                                                  |
| nta_get_jimu_unei          | SPEC-NTA-GET-JIMU-UNEI-010          | `docId` の形                                                                                  |
| nta_get_bunshokaitou       | SPEC-NTA-GET-BUNSHOKAITOU-009       | 空の `docId`                                                                                  |
| nta_get_bunshokaitou       | SPEC-NTA-GET-BUNSHOKAITOU-010       | `docId` の形                                                                                  |
| nta_get_tsutatsu           | SPEC-NTA-GET-TSUTATSU-017           | 空の `name`                                                                                   |
| nta_inspect_pdf_meta       | SPEC-NTA-INSPECT-PDF-META-019       | 空の `docId`                                                                                  |
| resolve_abbreviation       | SPEC-NTA-RESOLVE-ABBREVIATION-007   | 空の `abbr`                                                                                   |

## 変える仕様 ID（MODIFIED、6 件）

| 単位                | 仕様 ID                      | 変わる点                                                                                                                |
| ------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| common_errors       | SPEC-NTA-COMMON-ERRORS-003   | 範囲（`minimum` / `maximum`）・形（`minLength`）の違反も inputSchema の検査に含める。`path` は空にならない              |
| common_errors       | SPEC-NTA-COMMON-ERRORS-007   | `hint` の括弧の中に「範囲・形式」を足す。`path` が空の例を、必須の引数名が入る例に差し替える                            |
| nta_search_tsutatsu | SPEC-NTA-SEARCH-TSUTATSU-001 | `limit` の範囲の違反も含める                                                                                            |
| nta_search_tsutatsu | SPEC-NTA-SEARCH-TSUTATSU-002 | 空文字は inputSchema の検査、空白だけはツールの処理で、どちらも `tool`・`detail.issues` を持つ形にする                  |
| nta_get_qa          | SPEC-NTA-GET-QA-002          | 空文字は inputSchema の検査、空白だけはツールの処理。`detail.issues` を持つ形にする                                     |
| nta_get_tax_answer  | SPEC-NTA-GET-TAX-ANSWER-001  | 空文字は inputSchema の検査、空白だけと数字以外はツールの処理。`detail.issues` を持つ形にする。全角の扱いは T3 に委ねる |

REMOVED は無い。

## 呼び出し例への影響（計画書 5.1 の事前確認）

2026-10-01 JST に houki-hub `scripts/reference-examples/houki-nta/ja/*.md`（23 例）と houki-research-skill の `examples/` `workflows/` `SKILL.md` を grep した。`limit` は 2〜8 で、この差分の inputSchema で落ちる例は無い。先に直す例は無い。

## 取り込みのとき（Publisher）

- ADDED の見出しを、各 `specs/current/<dir>/spec.md` の「できること」の末尾に足す。MODIFIED は同じ見出しの本文を置き換える
- 各 spec.md の「入力」の表の `limit` / `keyword` / `docId` / `category` / `id` / `no` / `taxonomy` の行を、差分の各ファイルの冒頭の箇条書きのとおりに書き換える
- 「未決」から次の項目を消す: nta_get_bunshokaitou 1、nta_get_kaisei_tsutatsu 5、nta_get_qa 2、nta_get_tax_answer 3（2 の全角は T3）、nta_search_bunshokaitou 6・7・8、nta_search_jimu_unei 5・6・7、nta_search_kaisei_tsutatsu 1・2・3、nta_search_qa 2・7、nta_search_tax_answer 6・7、nta_search_tsutatsu 1・9、resolve_abbreviation 3（2 の全角は T3）、search_rules 4・5
- 各 `specs/current/<dir>/spec.md` の承認日の行に「差分 `20261001-t1-argument-guards` は YYYY-MM-DD（PR #N）」を足す
- この差分のフォルダーを `specs/releases/<実装を出したタグ>/20261001-t1-argument-guards/` へ移し、この proposal.md の「状態」を取り込み済みにする

## 人が判断すること

1. **識別子の形（SPEC-NTA-GET-KAISEI-TSUTATSU-010、SPEC-NTA-GET-JIMU-UNEI-010、SPEC-NTA-GET-BUNSHOKAITOU-010）。** 形は `specs/current/` の「入力」の表の例と `src/` の URL の組み立てから書いた。実装 PR の前に、投入済みの DB の `document.doc_id` を全件通して `false` が無いことを確かめる（違う形があれば ID の本文を直す）。
2. **語が 1 つも残らない `keyword`（1 文字の語だけ・記号だけ）。** houki-egov-mcp と揃えて今のまま 0 件で書いた（新しい ID は振らない）。`INVALID_ARGUMENT` にするなら、search_rules に ID を足し、egov の SPEC-EGOV-SEARCH-FULLTEXT-005 も同じ差分で MODIFIED にする。
3. **`nta_get_tax_answer` の `no` を 4 桁に限るか（012）。** 国税庁のタックスアンサーの番号は 4 桁（`1120`・`6101`・`9200`）なので限る側で書いた。DB の `document.doc_id` に 4 桁以外があれば、この ID を外す。
4. **`message` の文（011 の表）。** houki-egov-mcp の SPEC-EGOV-COMMON-ERRORS-022 と同じ表にした。片方だけ変えないこと。
5. **`taxonomy` の説明文の直し方。** 実装 PR で 3 ツールの `description` に足す文は「DB に無い値のときは `available_taxonomies` で正しい値を返す」。`nta_search_kaisei_tsutatsu` の説明の 4 つの値は例として残す。
6. **承認日。** この proposal.md に承認日と PR 番号を書く。
