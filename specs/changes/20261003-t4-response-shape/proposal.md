# 変更: 値の無いフィールドを null にし、検索の結果に発出日と法令時点を揃えて返す（T4 応答の形）

- 対象: `search_rules` / `common_errors` と、`nta_search_tsutatsu` / `nta_get_tsutatsu` / `nta_get_qa` / `nta_get_tax_answer` / `nta_get_kaisei_tsutatsu` / `nta_get_jimu_unei` / `nta_get_bunshokaitou` / `nta_inspect_pdf_meta` の `specs/current/<dir>/spec.md`
- 実装の変更: 要（`search_rules` 020 は今の名前を意図とするだけ、`common_errors` 017 は本文を 0.22.0 の実装に合わせるだけで、どちらもコードは変えない。下の「実装の変更」）
- 承認日: 2026-10-02（PR #124）
- 状態: 提案中
- 起こした日: 2026-10-03（JST）
- 起こした役: Spec Steward
- 対象 Issue: houki-nta-mcp #71（同じ種類の応答でフィールドの有無や名前が揃っていない。2026-10-02 の追記を含む）、#82（検索のヒットの要素に `issuedAt` が付くかどうかが種別によって違う）
- 決定の出典: houki-hub `docs/DECISIONS.md` 2026-09-29「T4 応答の形」、`docs/notes/2026-09-29-plan-spec-issues.md` 4 章「段階 1」「段階 4」・5.1・末尾の「段階 1 の転記で見つかった、計画書との食い違い」、段階 1 で #71・#82 に投稿したコメント（2026-09-29）、#71 の 2026-10-02 の追記（SPEC-NTA-COMMON-ERRORS-017 の対象）、houki-egov-mcp の同じ差分 `spec/20261003-t4-response-shape`（`null` の書き方と「キーは無くならない」の文を同じにした）
- 前提: main `3b2a0f9`（0.22.0）の上に積む。同じ版（0.23.0）に入れる T5（`spec/20261003-t5-docs-mismatch`）は、この差分の上に積む

## なぜ変えるか

v0.22.0 は、同じ種類の応答でも、場面や種別によってフィールドが付いたり付かなかったりする。

- 文書系の検索 5 ツールの `results[]` は、改正通達・事務運営指針・文書回答事例だけが `issuedAt` を持ち、質疑応答事例とタックスアンサーには無い。タックスアンサーは DB に「法令時点」から読んだ日付を持つのに、応答に出さない（#82）
- 取得ツールの json の `document.issuedAt` / `document.issuer` は、DB に値が無いとキーが無い。検索の `issuedAt` は同じ場面で `null` で、扱いが違う（#82）
- `nta_search_tsutatsu` は 0 件のとき `count`・`freshness`・`legal_status` を付けない。文書系 5 ツールは 0 件でも `freshness`・`legal_status` を付ける（#71）
- `nta_get_tsutatsu` の `available_clauses` は、DB の経路は最大 50 件、国税庁サイトの経路は取得したページの全件（#71）
- 事務運営指針（と改正通達・文書回答事例）の markdown に「取得元」の行が無い。`nta_get_qa` / `nta_get_tax_answer` にはある（#71）
- `nta_inspect_pdf_meta` は、`save: true` で 0 件のとき `saved` が無く、索引から消えた文書に `index_status` などの印を付けない（#71）
- 索引の印（`index_status` / `orphaned_at` / `notice`）は、索引にある文書ではキーが無い
- SPEC-NTA-COMMON-ERRORS-017 の本文は対象に「取得 6 ツール」を含めるが、取得ツールは `freshness` を付けず、このエラーを返す場所が無い（#71 の 2026-10-02 の追記）

2026-09-29 の決定（T4）は、値が無いフィールドは `null` を入れてフィールドを消さない、検索の `results[]` には全種別で `issuedAt` を付け、タックスアンサーの日付は「法令時点」なので別の名前（`basisDate`）で付ける、フィールドを消す変更・名前を付け替える変更は入れない、というものである。

## `meta` の扱い（houki-nta-mcp では対象外とする）

T4 の「`meta` には `at`（時点）と `retrieved_at` を常に付ける」は houki-egov-mcp の応答の形で、houki-nta-mcp の応答には `meta` が無い。この差分では **houki-nta-mcp に `meta` を足さない**。

- houki-nta-mcp のツールは `at`（時点）の引数を持たない。国税庁の通達・事例は時点を指定して取れず、DB に入れたときの版だけを返す
- 取得の時点は、検索は `freshness`（`oldest_fetched_at` / `newest_fetched_at`。SPEC-NTA-SEARCH-RULES-017）、取得は json の `fetchedAt` と markdown の `取得:` の行で、すでに返している
- `meta: { at: null, retrieved_at }` を 14 ツールに足すと、常に `null` の `at` と、応答を作った時刻だけのフィールドが増える。LLM が使う情報は増えない

下の「人が判断すること」1 で、足す案も併記する。

## 変わる振る舞い

| 場面                                                                       | v0.22.0                                                                                   | この差分                                                                                 |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `nta_search_qa` の `results[]`                                             | `issuedAt` が無い                                                                         | `issuedAt: null`・`basisDate: null`（SEARCH-RULES-015）                                  |
| `nta_search_tax_answer` の `results[]`                                     | `issuedAt` も日付も無い                                                                   | `issuedAt: null`・`basisDate: "<法令時点の日付>"`（読めなければ `null`）                 |
| `nta_search_kaisei_tsutatsu` / `jimu_unei` / `bunshokaitou` の `results[]` | `issuedAt`（`null` あり）。`basisDate` は無い                                             | `basisDate: null` を足す                                                                 |
| 文書系 5 ツールの `results[]` で、索引にある文書                           | `index_status` / `orphaned_at` のキーが無い                                               | どちらも `null`（SEARCH-RULES-011）                                                      |
| `nta_search_tsutatsu` が 0 件                                              | `keyword`・`hits: []`・`message` だけ                                                     | `count: 0`・`freshness`・`legal_status` も付ける（SEARCH-TSUTATSU-005・010）             |
| `nta_get_tsutatsu` の国税庁サイトの経路の `ARTICLE_NOT_FOUND`              | `available_clauses` が全件                                                                | 最大 50 件（GET-TSUTATSU-010）                                                           |
| `nta_get_kaisei_tsutatsu` / `jimu_unei` / `bunshokaitou` の json           | `document.issuedAt` / `issuer` が DB に無ければキーが無い。索引にある文書は印のキーが無い | `null`（各 004・json の ID）                                                             |
| 同じ 3 ツールの markdown                                                   | 「取得元」の行が無い                                                                      | `- **取得元**: ローカル DB（bulk download で取り込んだもの）` を `- **取得**` の次に置く |
| `nta_get_qa` の json                                                       | `qa.notice` / `qa.basisDate` が無い事例でキーが無い。印のキーが無い                       | `null`（GET-QA-008・010）                                                                |
| `nta_get_tax_answer` の json                                               | `effectiveDate` / `taxCategory` が無い記事でキーが無い。印のキーが無い                    | `null`。`taxAnswer.basisDate` を足す（GET-TAX-ANSWER-008・009）                          |
| `nta_inspect_pdf_meta`                                                     | 索引の印が無い。`save: true` で 0 件なら `saved` が無い                                   | 印を付ける（索引にあれば `null`）。`saved: []`（INSPECT-PDF-META-002・010）              |
| SPEC-NTA-COMMON-ERRORS-017 の対象                                          | 本文は「取得 6 ツール」を含む                                                             | 検索 6 ツールだけ（実装は変えない）                                                      |

## 変わらない振る舞い

- `nta_search_tsutatsu` の `hits` / `message` と文書系の `results` / `hint` の名前（SPEC-NTA-SEARCH-RULES-020 で、今の名前を意図とする）
- `nta_search_tsutatsu` の 0 件のときの `base_laws_by_tsutatsu` / `next_actions`（`hits` から作るので付けない。SPEC-NTA-SEARCH-TSUTATSU-009 のまま）
- markdown の索引の状態の行（索引にある文書では今までどおり入れない）と、発出日・税目の行（DB にあるときだけ）
- 取得ツールに `freshness` を付けないこと
- `nta_inspect_pdf_meta` の `save` を渡さないときに `saved` を付けないこと
- エラーの code。消すフィールド・名前を付け替えるフィールドは無い

## Issue の「決めること」への答え

### #71

| 決めること                                                                  | 答え                                                                                                                                                                           |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `nta_search_tsutatsu` の `count`                                            | 0 件でも `count: 0` を付ける。あわせて `freshness`・`legal_status` も付ける（文書系 5 ツールの 0 件と同じ。SPEC-NTA-SEARCH-TSUTATSU-005・010。search_rules の未決 2 も閉じる） |
| `nta_get_tsutatsu` の `available_clauses` の件数                            | 国税庁サイトの経路も最大 50 件にし、DB の経路と揃える（SPEC-NTA-GET-TSUTATSU-010）                                                                                             |
| `nta_get_jimu_unei` の markdown の「取得元」の行                            | 付ける。DB だけを引く改正通達・文書回答事例にも同じ行を付ける（下の「人が判断すること」3）                                                                                     |
| `nta_inspect_pdf_meta` の `save: true` で 0 件のとき                        | `saved: []`（SPEC-NTA-INSPECT-PDF-META-010）                                                                                                                                   |
| `nta_inspect_pdf_meta` の `index_status` / `orphaned_at` / `notice`         | 付ける。索引にある文書では 3 つとも `null`（SPEC-NTA-INSPECT-PDF-META-002）。取得ツールの json も同じ形（索引にある文書では `null`）に揃える                                   |
| `hits` / `results`、`message` / `hint` の名前を揃えるか                     | 0.23.0 では付け替えない。今の名前を意図として仕様に書く（SPEC-NTA-SEARCH-RULES-020）                                                                                           |
| `meta` を足すか                                                             | 足さない（上の「`meta` の扱い」）                                                                                                                                              |
| 取得ツールの `freshness` と SPEC-NTA-COMMON-ERRORS-017（2026-10-02 の追記） | 取得ツールには `freshness` を付けない。017 の本文から「取得 6 ツール」を外す（実装は 0.22.0 のまま）                                                                           |

### #82

| 決めること                                               | 答え                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 検索の `results` に `issuedAt` を全種別で付けるか        | 付ける。質疑応答事例とタックスアンサーは常に `null`（SPEC-NTA-SEARCH-RULES-015）                                                                                                                                                                                                                                                   |
| 値が無いときに `null` を入れるか（検索と取得で揃えるか） | `null` を入れ、検索と取得で揃える（取得 3 ツールの json の ID）                                                                                                                                                                                                                                                                    |
| タックスアンサーの日付（法令時点）をどう出すか           | `issuedAt` には入れず `basisDate` で出す。名前は `nta_get_qa` の `qa.basisDate` と同じ（どちらも `YYYY-MM-DD`）。`nta_get_tax_answer` の `effectiveDate` はページの文字列（`令和7年4月1日現在法令等`）のままで、日付の形ではないので名前を揃えない。取得側にも同じ値の `taxAnswer.basisDate` を足す（SPEC-NTA-GET-TAX-ANSWER-008） |

## 確かめた値

2026-10-03 JST に houki-nta-dev（0.22.0）で次を呼んだ。

- `nta_search_tax_answer` に `{ keyword: "医療費控除", limit: 2 }`: `results[]` の要素は `docType`・`docId`・`taxonomy`・`title`・`sourceUrl`・`snippet`・`score`・`scoreReasons` で、`issuedAt` も日付も無い。`snippet` に `[令和7年4月1 …` があり、記事に法令時点が書かれていることが分かる
- `nta_search_qa` に `{ keyword: "テレワーク", limit: 1 }`: `results[]` の要素に `issuedAt` が無い
- タックスアンサーの bulk download は、法令時点を `parseEffectiveDate`（和暦 → `YYYY-MM-DD`）で読んで `document.issued_at` に入れている（`src/services/tax-answer-bulk-downloader.ts`）。`basisDate` はこの列の値を出す

## 足す仕様 ID（ADDED、1 件）

| 単位         | 仕様 ID                   | 内容                                                            |
| ------------ | ------------------------- | --------------------------------------------------------------- |
| search_rules | SPEC-NTA-SEARCH-RULES-020 | `hits`・`message` と `results`・`hint` の名前は今のまま別にする |

## 変える仕様 ID（MODIFIED、21 件）

| 単位                    | 仕様 ID                          | 変わる点                                                                                           |
| ----------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------- |
| search_rules            | SPEC-NTA-SEARCH-RULES-011        | 索引にある文書では `index_status` / `orphaned_at` を `null`                                        |
| search_rules            | SPEC-NTA-SEARCH-RULES-015        | `results[]` に `issuedAt`・`basisDate` を全種別で置き、`index_status` / `orphaned_at` を表に入れる |
| common_errors           | SPEC-NTA-COMMON-ERRORS-017       | 対象から「取得 6 ツール」を外す                                                                    |
| nta_search_tsutatsu     | SPEC-NTA-SEARCH-TSUTATSU-005     | 0 件でも `count: 0`・`freshness`・`legal_status`                                                   |
| nta_search_tsutatsu     | SPEC-NTA-SEARCH-TSUTATSU-010     | `legal_status` をヒットの有無によらず付ける                                                        |
| nta_get_tsutatsu        | SPEC-NTA-GET-TSUTATSU-010        | `available_clauses` を最大 50 件                                                                   |
| nta_get_jimu_unei       | SPEC-NTA-GET-JIMU-UNEI-004       | 索引にある文書では印のキーを `null`                                                                |
| nta_get_jimu_unei       | SPEC-NTA-GET-JIMU-UNEI-005       | json の `issuedAt` / `issuer` を `null`、`orphanedAt` と印の行を表に入れる                         |
| nta_get_jimu_unei       | SPEC-NTA-GET-JIMU-UNEI-006       | markdown に「取得元」の行                                                                          |
| nta_get_kaisei_tsutatsu | SPEC-NTA-GET-KAISEI-TSUTATSU-004 | 同上（004）。markdown の索引の状態の行を「取得元」の行の次に                                       |
| nta_get_kaisei_tsutatsu | SPEC-NTA-GET-KAISEI-TSUTATSU-005 | markdown に「取得元」の行                                                                          |
| nta_get_kaisei_tsutatsu | SPEC-NTA-GET-KAISEI-TSUTATSU-006 | json の `issuedAt` / `issuer` を `null`                                                            |
| nta_get_bunshokaitou    | SPEC-NTA-GET-BUNSHOKAITOU-004    | 改正通達の 004 と同じ                                                                              |
| nta_get_bunshokaitou    | SPEC-NTA-GET-BUNSHOKAITOU-005    | markdown に「取得元」の行                                                                          |
| nta_get_bunshokaitou    | SPEC-NTA-GET-BUNSHOKAITOU-006    | json の `issuedAt` / `issuer` を `null`                                                            |
| nta_get_qa              | SPEC-NTA-GET-QA-008              | json の `qa.notice` / `qa.basisDate` を `null`、印の行を表に入れる                                 |
| nta_get_qa              | SPEC-NTA-GET-QA-010              | 索引にある事例と国税庁サイトから取った事例では印のキーを `null`                                    |
| nta_get_tax_answer      | SPEC-NTA-GET-TAX-ANSWER-008      | `effectiveDate` / `taxCategory` を `null`、`taxAnswer.basisDate` を足す                            |
| nta_get_tax_answer      | SPEC-NTA-GET-TAX-ANSWER-009      | 索引にある記事と国税庁サイトから取った記事では印のキーを `null`                                    |
| nta_inspect_pdf_meta    | SPEC-NTA-INSPECT-PDF-META-002    | 索引の印を付ける（索引にあれば `null`）                                                            |
| nta_inspect_pdf_meta    | SPEC-NTA-INSPECT-PDF-META-010    | `save: true` で 0 件なら `saved: []`                                                               |

4-response-shape（値の無いフィールドを null にし、検索の結果に発出日と法令時点を揃えて返す）)

## 消す仕様 ID（REMOVED）

無い。

## 互換性

code は変えない。消すフィールド・名前を付け替えるフィールドは無い（計画書 5.1）。

- 今まで「キーが無い」だった場面で `null` になるフィールド: 検索の `results[].issuedAt`（質疑応答事例・タックスアンサー）・`index_status`・`orphaned_at`、取得の json の `document.issuedAt`・`document.issuer`・`document.orphanedAt`・`qa.notice`・`qa.basisDate`・`taxAnswer.effectiveDate`・`taxAnswer.taxCategory`・`index_status`・`orphaned_at`・`notice`。キーの有無で「索引から消えたか」を見ていた側は、値（`index_status === "removed_from_index"`）で見るように直す必要がある
- 足すフィールド: `results[].basisDate`、`taxAnswer.basisDate`、`nta_search_tsutatsu` の 0 件の `count`・`freshness`・`legal_status`、`nta_inspect_pdf_meta` の印、markdown の「取得元」の行
- `nta_get_tsutatsu` の国税庁サイトの経路の `available_clauses` は、51 件目以降を返さなくなる

## 呼び出し例への影響

2026-10-03 JST に houki-hub `scripts/reference-examples/houki-nta/ja/*.md`（14 本）と houki-research-skill の `skills/houki-research/` を grep した。

- houki-hub の例のうち 10 本（取得 5 本・検索 4 本・`nta_inspect_pdf_meta`）が `issuedAt`・`index_status`・`取得元`・`available_clauses`・`saved` のどれかを載せている。段階 6 で実測をやり直すと、`null` のキーと「取得元」の行が足される。キーの有無を前提にした文は無い
- houki-research-skill の `SKILL.md`（210 行目付近）は「`index_status: "removed_from_index"` と `orphaned_at` が付いていたら」と書いている。`null` を置いた後も値が `"removed_from_index"` のときだけ当てはまるので誤りにはならないが、「`index_status` が `"removed_from_index"` なら」に直すほうが正確である。0.23.0 の publish の日の Skill の PR で直す。`docs/ARCHITECTURE.md`・`docs/CITATION.md` も同じ語を見直す

## 実装の変更

- 検索 5 ツールの結果の組み立てで、`issuedAt`（質疑応答事例は `null`、タックスアンサーは `null`）と `basisDate`（タックスアンサーは `document.issued_at`、ほかは `null`）を置く。`indexStatusFields` は索引にある文書でも `{ index_status: null, orphaned_at: null }` を返す
- `nta_search_tsutatsu` の 0 件の応答に `count: 0`・`freshness`・`legal_status`
- `nta_get_tsutatsu` の国税庁サイトの経路で `available_clauses` を 50 件で切る
- 取得 5 ツールと `nta_inspect_pdf_meta` で、値の無いフィールドを `?? null` で置く。改正通達・事務運営指針・文書回答事例の markdown に「取得元」の行
- `nta_get_tax_answer` で `effectiveDate` から `basisDate` を読む（DB の経路は `document.issued_at` と同じ値になる）
- `nta_inspect_pdf_meta` で索引の印を付け、`save: true` なら 0 件でも `saved: []`
- SPEC-NTA-SEARCH-RULES-020 と SPEC-NTA-COMMON-ERRORS-017 はコードを変えない。020 は受入テストを足す（今の名前を確かめる）。017 は 0.22.0 の受入テスト（`src/tools/spec-20261001-t2-error-codes.test.ts`）のままでよい

## 取り込みのとき（Publisher）

- ADDED の見出しを `specs/current/search_rules/spec.md` の「できること」の末尾に足す。MODIFIED は見出しの行（題）も含めて、差分の見出しと本文に置き換える
- 「未決」から次の項目を消す: search_rules 2・3（3 は 020 で閉じる。`keyword` の前後の空白の違いは 3 の後半なので、3 を「`nta_search_tsutatsu` は `keyword` の前後の空白を落として応答に返すが、文書系は受けた `keyword` をそのまま返す。テストが無い。ID を振るのは受入テストを書いてから。」に書き換える）、nta_search_tsutatsu 10、nta_get_tsutatsu 4、nta_get_jimu_unei 7、nta_inspect_pdf_meta 1・5
- 各 `specs/current/<dir>/spec.md` の承認日の行に「差分 `20261003-t4-response-shape` は YYYY-MM-DD（PR #N）」を足す
- この差分のフォルダーを `specs/releases/<実装を出したタグ>/20261003-t4-response-shape/` へ移し、この proposal.md の「状態」を取り込み済みにする

## 人が判断すること

1. **houki-nta-mcp に `meta` を足さないこと。** 足さない側で書いた（上の「`meta` の扱い」）。足す案は「14 ツールの成功の応答に `meta: { at: null, retrieved_at }` を置く」で、houki-egov-mcp と応答の外形が揃う代わりに、常に `null` の `at` が増える。
2. **索引の印を、索引にある文書でも `null` で置くこと。** #71 の答え（`nta_inspect_pdf_meta` は「`nta_get_*` と同じ形で、索引にある文書では `orphaned_at` と `notice` を `null`」）を、検索・取得の全部に当てた。`index_status` の値は `"removed_from_index"` か `null` の 2 つで、索引にある印の値（`"in_index"` など）は足さない（値の種類を増やすと Skill の分岐も増えるため）。
3. **「取得元」の行を、事務運営指針だけでなく改正通達・文書回答事例にも足すこと。** #71 の行は事務運営指針だけを挙げるが、3 ツールとも DB だけを引く同じ形の markdown なので揃えた。事務運営指針だけにするなら、kaisei と bunshokaitou の 005 を MODIFIED から外し、004 の「`- **取得元**` の行の次に」を「`- **取得**` の行の次に」に戻す。
4. **`nta_search_tsutatsu` の 0 件で `base_laws_by_tsutatsu` / `next_actions` を付けないこと。** `hits` から作る欄なので、空の `{}` / `[]` を置かずに今のままにした。T4 を文字どおりに当てるなら `base_laws_by_tsutatsu: {}`・`next_actions: []` を置く案もある。
5. **`nta_inspect_pdf_meta` で `save` を渡さないときは `saved` を付けないこと（010）。** `null` を置く案もあるが、houki-egov-mcp の `get_attachment` / `get_law_file` の `saved`（`save` なしでは付けない）と合わせた。どちらも T4 の差分の範囲外として残した。
6. **`taxAnswer.basisDate` を取得側にも足すこと（GET-TAX-ANSWER-008）。** #82 は検索の `results[]` を対象にしているが、検索で `basisDate` を見た LLM が取得で同じ名前を探せるように足した。足さないなら 008 から `basisDate` の行を外す。
7. **`available_clauses` を 50 件で切ること（GET-TSUTATSU-010）。** 取得したページの全件を返す今の形をやめる。51 件目以降の条項番号は `searched_urls` のページを読めば分かる。
8. **承認日。** この proposal.md に承認日と PR 番号を書く。
