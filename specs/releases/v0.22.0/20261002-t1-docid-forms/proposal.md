---
approved: 2026-10-02
pr: 121
implementation: required
targets: [nta_get_bunshokaitou, nta_get_jimu_unei, nta_get_kaisei_tsutatsu]
---
# 変更: 文書系 3 ツールの docId の形を、DB にある実際の値に合わせて緩める（T1 の訂正）

- 対象: 差分 `20261001-t1-argument-guards` の `specs/nta_get_kaisei_tsutatsu/spec.md`・`specs/nta_get_jimu_unei/spec.md`・`specs/nta_get_bunshokaitou/spec.md` の SPEC-NTA-GET-KAISEI-TSUTATSU-010・SPEC-NTA-GET-JIMU-UNEI-010・SPEC-NTA-GET-BUNSHOKAITOU-010 と、同じ差分の proposal.md（訂正の記録を 1 行足す）
- 実装の変更の補足: 3 つの ID はまだ実装していない。0.22.0 の実装 PR で、T1 の他の ID と一緒に、この訂正後の形で実装する
- 状態: 取り込み済み（v0.22.0）
- 起こした日: 2026-10-02（JST）
- 起こした役: Spec Steward
- 対象 Issue: houki-nta-mcp #66（識別子の形の検査）
- 決定の出典: shuji の 2026-10-02 の決定（形の検査は残し、見るのは使える文字と `/` の区切りだけにする。数字の桁数は見ない）、差分 `20261001-t1-argument-guards` の proposal.md「人が判断すること」1（投入済みの DB の `document.doc_id` を全件通して確かめる）
- 前提: main の `8d4653c`（T3 のマージ）の上に積む。実装 PR のブランチ `feat/20261001-0.22.0` は、依存を `^0.7.0` に上げたコミット（`a929d5a`）だけが載った状態で、T1 の実装はまだ無い

## なぜ変えるか

差分 `20261001-t1-argument-guards`（承認 2026-10-01、PR #117）は、文書系 3 ツールの `docId` の形を「数字 6 桁」「新形式は 7 桁-3 桁」のように数字の桁数で書いた。形は `specs/current/` の「入力」の表の例と URL の組み立てから書いたもので、DB の実際の値では確かめていなかった（同じ proposal.md の「人が判断すること」1）。

`docId` は、国税庁サイトの URL のフォルダー名をそのまま切り出した文字列である（`src/services/kaisei-parser.ts` の `extractDocIdFromKaiseiUrl()` は `/kaisei/([^/]+)/index.htm`、`jimu-unei-parser.ts` の `extractDocIdFromJimuUrl()` は `/law/jimu-unei/(.+?)/(?:index|01).htm`、`bunshokaitou-parser.ts` の `extractDocIdFromBunshoUrl()` は `/law/bunshokaito/(.+?)/index.htm` などで切り出し、文字の種類も桁数も確かめない）。フォルダー名の付け方は国税局や年代によって違い、2026-10-02 に投入済みの DB で確かめると、T1 の形に合わない値が文書回答事例だけで 87 件あった。

| 種別         | T1 の形に合わなかった値の例                                                                                                                                                                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 改正通達     | `0014720-84`（枝が 2 桁）、`1806xx`〜`2606xx` の形（25 件）、`2606`、`tougou`                                                                                                                                                                                                         |
| 事務運営指針 | `hojin/000703-3`、`shotoku/shinkoku/000703-3`（末尾に `-` と数字）、`sonota/1912`（4 桁）                                                                                                                                                                                             |
| 文書回答事例 | 桁数が 6 でない `fukuoka/hojin/20101001`・`hiroshima/hojin/001`・`kumamoto/hojin/01`・`nagoya/hojin/1100405`・`osaka/inshi/1112679941`、枝番が付く `hojin/091106_2`・`sapporo/hojin/02_01`・`osaka/hojin/040331-2`、英字を含む `nagoya/hojin/nag_140625`・`hojin/1805xx` など計 87 件 |

T1 の形のまま実装すると、これらの文書は 0.22.0 で `INVALID_ARGUMENT` になり、DB にあるのに引けなくなる。検索ツールの結果の `docId` をそのまま渡しても引けない。

形の検査そのものは残す。URL を丸ごと渡す（`https://www.nta.go.jp/law/…/index.htm`）、`index.htm` まで付ける、漢字の題名を渡すといった、どの文書の `docId` にもなりえない値を、DB と国税庁サイトを引く前に止めて正しい形を案内するためである（SPEC-NTA-COMMON-ERRORS-015）。見るのは「使える文字」と「`/` で区切った要素の数」だけにし、数字の桁数や区切りの位置は見ない。

## 書き方（この訂正をどこに書くか）

3 つの ID は `specs/changes/20261001-t1-argument-guards/` にだけあり、`specs/current/` にはまだ無い。この差分に `MODIFIED` の見出し（`### SPEC-NTA-GET-KAISEI-TSUTATSU-010`）を置くと、`spec-ids check` が `specs/changes/` の中の同じ ID の見出し 2 つを採番の衝突として止める（T3 の `nta_get_tax_answer` と同じ事情）。T3 では、取り込みのときに 1 文を置き換える指示として書いたが、今回は 3 つの ID の本文・`message`・`hint`・「例:」をほぼすべて書き換えるので、指示の形にすると、実装の会話（Test Designer）が T1 の古い本文と、この差分の指示の 2 か所を読み合わせることになる。

そこで、この仕様 PR では次のように書く。

1. `specs/changes/20261001-t1-argument-guards/specs/<tool>/spec.md` の 3 つの見出しの本文を、この proposal.md の「訂正後の本文」に書き換える。見出しの ID と題は変えない。仕様 ID の正本は T1 の差分の 1 か所のまま
2. T1 の proposal.md の冒頭に「- 訂正: 2026-10-02 に差分 `20261002-t1-docid-forms` で SPEC-NTA-GET-KAISEI-TSUTATSU-010・SPEC-NTA-GET-JIMU-UNEI-010・SPEC-NTA-GET-BUNSHOKAITOU-010 の docId の形を緩めた」の 1 行を足す
3. この差分のフォルダー（`specs/changes/20261002-t1-docid-forms/`）には proposal.md だけを置き、`### SPEC-…` の見出しを持つ spec.md は置かない。訂正の理由・前と後の形・確かめた結果の記録と、承認日（`pr-scope` が見る）を持つ

承認済みの差分の本文を書き換えるのは、`specs/changes/` を変えてよい仕様 PR（`spec/*`）の中で、人の承認を経て行うので、AGENTS.md の「実装 PR は承認済みの差分を変えない」には当たらない。T1 の proposal.md の「承認日」の行（2026-10-01、PR #117）は変えない。訂正の承認は、この proposal.md の「承認日」で記録する。

## 訂正前と訂正後の形

| ツール                    | 訂正前（T1、PR #117）                                                                              | 訂正後                                                                                                                | 正規表現（実装の目安）                     |
| ------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `nta_get_kaisei_tsutatsu` | 新形式（数字 7 桁 `-` 数字 3 桁）か旧形式（数字 6 桁）                                             | 英小文字・数字・`-` だけからなる 1 つの要素（`/` を含まない）                                                         | `^[a-z0-9-]+$`                             |
| `nta_get_jimu_unei`       | `/` で区切った 2 つ以上の要素。先頭は税目フォルダー、最後は数字 6 桁（`_` と数字が付くことがある） | `/` で区切った 2 つ以上の要素。先頭の要素は英小文字・数字・`-`、2 つ目以降の要素は英小文字・数字・`-`・`_`            | `^[a-z0-9-]+(/[a-z0-9_-]+)+$`              |
| `nta_get_bunshokaitou`    | `税目/番号` か `局/税目/番号`。番号は数字 6 桁                                                     | `/` で区切った 2 つか 3 つの要素（`税目/フォルダー名` か `局/税目/フォルダー名`）。どの要素も英小文字・数字・`-`・`_` | `^([a-z0-9_-]+/)?[a-z0-9_-]+/[a-z0-9_-]+$` |

どれも、前後の空白を除き、T3 の SPEC-NTA-GET-KAISEI-TSUTATSU-011・SPEC-NTA-GET-JIMU-UNEI-011・SPEC-NTA-GET-BUNSHOKAITOU-011 で半角に揃えた後の値に対して確かめる（T3 で決めた順のまま）。

## 確かめたこと

- 2026-10-02 JST、shuji の Mac の `~/.cache/houki-nta-mcp/cache.db` で、訂正後の 3 つの形と、`nta_get_qa` の `topic/category/id`（SPEC-NTA-GET-QA-013 の「1 桁か 2 桁の数字」）を `document` の全件に通した。結果: 合わない値は 0 件（改正通達・事務運営指針・文書回答事例・質疑応答事例のどれも、下のコマンドの出力は空だった）
- 実行したコマンド:

      sqlite3 ~/.cache/houki-nta-mcp/cache.db "SELECT doc_type, doc_id FROM document" | awk -F'|' '
        $1=="kaisei"       && $2 !~ /^[a-z0-9-]+$/ {print}
        $1=="jimu-unei"    && $2 !~ /^[a-z0-9-]+(\/[a-z0-9_-]+)+$/ {print}
        $1=="bunshokaitou" && $2 !~ /^([a-z0-9_-]+\/)?[a-z0-9_-]+\/[a-z0-9_-]+$/ {print}
        $1=="qa-jirei"     && $2 !~ /^[a-z]+\/[0-9]{1,2}\/[0-9]{1,2}$/ {print}'

- `nta_get_tax_answer` の `no` は全件 4 桁で、SPEC-NTA-GET-TAX-ANSWER-012 は直さない（2026-10-02 の確認）

## 変わる振る舞い

v0.21.3 との比べ方は T1 の proposal.md のまま（形の合わない `docId` は DB を引く前に `INVALID_ARGUMENT`）。T1 の承認時の形と比べて変わるのは、次の値が検査を通るようになることだけである。

| 値の例                                                                                             | T1（PR #117）の形  | 訂正後                                                                  |
| -------------------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------- |
| 改正通達 `0014720-84`・`2606`・`tougou`、事務運営指針 `hojin/000703-3`・`sonota/1912`              | `INVALID_ARGUMENT` | 検査を通り DB を引く                                                    |
| 文書回答事例 `fukuoka/hojin/20101001`・`sapporo/hojin/02_01`・`nagoya/hojin/nag_140625` など       | `INVALID_ARGUMENT` | 検査を通り DB を引く                                                    |
| 改正通達 `abc`・`0026003`、事務運営指針 `shotoku/abc`、文書回答事例 `shotoku/25041`（DB に無い値） | `INVALID_ARGUMENT` | 検査を通り、DB に無いので `DOC_NOT_FOUND`（SPEC-NTA-COMMON-ERRORS-016） |

最後の行のとおり、形は合うが DB に無い値は、`INVALID_ARGUMENT` ではなく `DOC_NOT_FOUND`（`available_doc_ids` と検索ツールの案内付き）になる。どちらでも「正しい docId を探す」案内は届く。

## 変わらない振る舞い

- 空文字・空白だけの `docId`（SPEC-NTA-GET-KAISEI-TSUTATSU-009 など。T1）
- 形の検査を inputSchema の `pattern` ではなく各ツールの処理に置くこと、DB と国税庁サイトを引く前に止めること、エラーの本文の形（SPEC-NTA-COMMON-ERRORS-015。T1）
- SPEC-NTA-COMMON-ERRORS-015 の例 `nta_get_bunshokaitou` の `docId: "250416"`（要素が 1 つなので訂正後も `INVALID_ARGUMENT`）
- 全角の数字・ダッシュ類を半角に揃えてから確かめること（T3 の 011）。T3 の例（`００２６００３―０６７`、`shotoku/shinkoku/１７０３３１`、`shotoku/２５０４１６`）は訂正後も検査を通る
- `nta_inspect_pdf_meta` の `docId`（形の検査を持たない。T1 の SPEC-NTA-INSPECT-PDF-META-019 は空文字・空白だけを止める）
- `nta_get_qa` の `category` / `id`（SPEC-NTA-GET-QA-013）と `nta_get_tax_answer` の `no`（SPEC-NTA-GET-TAX-ANSWER-012）。上の DB の確認で、どちらも全件が今の形に合った

## 訂正後の本文

T1 の差分の 3 つの spec.md の該当の見出しの本文を、次のとおりにする（見出しの行はそのまま）。この仕様 PR では、T1 の差分のファイルを既にこの本文に書き換えてある。

### 改正通達（SPEC-NTA-GET-KAISEI-TSUTATSU-010）

> `docId` は、国税庁サイトの改正通達のページの URL（`…/kaisei/<フォルダー名>/index.htm`）のフォルダー名で、英小文字・半角の数字・`-` だけからなる、`/` を含まない 1 つの要素である（SPEC-NTA-COMMON-ERRORS-015）。フォルダー名の付け方は年代によって違う（`0026003-067`・`0014720-84`・`240401`・`2606`・`tougou` など）ので、数字の桁数と `-` の位置は確かめない。前後の空白を除き、半角に揃えた（SPEC-NTA-GET-KAISEI-TSUTATSU-011）値がこの形でないときは、DB を引く前に `INVALID_ARGUMENT`（`tool: "nta_get_kaisei_tsutatsu"`、`error: "docId の形が受け付ける形ではありません: <渡した値>"`、`detail.issues: [{ path: "docId", message: "英小文字・数字・- だけで指定してください（例: 0026003-067、240401）" }]`、`hint` に `nta_search_kaisei_tsutatsu` の結果の `docId` をそのまま渡すよう書く）を返す。`DOC_NOT_FOUND` は、形に合うが DB にその文書が無いときだけになる。
>
> 例: `docId: "0026003-067"`・`"240401"`・`"0014720-84"`・`"tougou"` は検査を通り、DB を引く。`docId: "0026003/067"`（`/` を含む）・`"0026003_067"`（`_` を含む）・`"ABC-1"`（英大文字）・`"課消2-11"`（漢字）・`"0026003-067/index.htm"`（`/` と `.` を含む）は `code: "INVALID_ARGUMENT"`・`detail.issues[0].path: "docId"` で、DB は引かない（v0.21.3 では DB を引いてから「見つかりません」の応答になっていた）。

### 事務運営指針（SPEC-NTA-GET-JIMU-UNEI-010）

> `docId` は、国税庁サイトの事務運営指針のページの URL（`…/law/jimu-unei/<フォルダー>/…/index.htm`）のフォルダーの並びで、`/` で区切った 2 つ以上の要素からなる。先頭の要素（税目フォルダー）は英小文字・半角の数字・`-`、2 つ目以降の要素は英小文字・半角の数字・`-`・`_` だけからなる（SPEC-NTA-COMMON-ERRORS-015）。フォルダー名の付け方は税目や年代によって違う（`shotoku/shinkoku/170331`・`sozoku/170111_1`・`hojin/000703-3`・`sonota/1912` など）ので、数字の桁数は確かめない。前後の空白を除き、半角に揃えた（SPEC-NTA-GET-JIMU-UNEI-011）値がこの形でないときは、DB を引く前に `INVALID_ARGUMENT`（`tool: "nta_get_jimu_unei"`、`error: "docId の形が受け付ける形ではありません: <渡した値>"`、`detail.issues: [{ path: "docId", message: "税目/…/フォルダー名 の形で、英小文字・数字・-・_ だけで指定してください（例: shotoku/shinkoku/170331）" }]`、`hint` に `nta_search_jimu_unei` の結果か `available_doc_ids` の `docId` をそのまま渡すよう書く）を返す。`DOC_NOT_FOUND` は、形に合うが DB にその文書が無いときだけになる。
>
> 例: `docId: "shotoku/shinkoku/170331"`・`"sozoku/170111_1"`・`"hojin/000703-3"`・`"sonota/1912"` は検査を通り、DB を引く。`docId: "170331"`（要素が 1 つ）・`"/shotoku/170331"`（先頭が `/`）・`"shotoku/"`（末尾が `/`）・`"shotoku/shinkoku/170331/index.htm"`（`.` を含む）・`"shotoku/申告/170331"`（漢字）は `code: "INVALID_ARGUMENT"`・`detail.issues[0].path: "docId"` で、DB は引かない（v0.21.3 では DB を引いてから「見つかりません」の応答になっていた）。

### 文書回答事例（SPEC-NTA-GET-BUNSHOKAITOU-010）

> `docId` は、国税庁サイトの文書回答事例のページの URL のフォルダーの並びで、本庁の事例は `税目/フォルダー名`（2 つの要素）、国税局の事例は `局/税目/フォルダー名`（3 つの要素）である。どの要素も英小文字・半角の数字・`-`・`_` だけからなる（SPEC-NTA-COMMON-ERRORS-015）。フォルダー名の付け方は国税局や年代によって違う（`shotoku/250416`・`tokyo/shotoku/260218`・`fukuoka/hojin/20101001`・`sapporo/hojin/02_01`・`nagoya/hojin/nag_140625` など）ので、数字の桁数は確かめない。前後の空白を除き、半角に揃えた（SPEC-NTA-GET-BUNSHOKAITOU-011）値がこの形でないときは、DB を引く前に `INVALID_ARGUMENT`（`tool: "nta_get_bunshokaitou"`、`error: "docId の形が受け付ける形ではありません: <渡した値>"`、`detail.issues: [{ path: "docId", message: "税目/フォルダー名 か 局/税目/フォルダー名 の形で、英小文字・数字・-・_ だけで指定してください（例: shotoku/250416、tokyo/shotoku/260218）" }]`、`hint` に `nta_search_bunshokaitou` の結果の `docId` をそのまま渡すよう書く）を返す。`DOC_NOT_FOUND` は、形に合うが DB にその文書が無いときだけになる。
>
> 例: `docId: "shotoku/250416"`・`"tokyo/shotoku/260218"`・`"fukuoka/hojin/20101001"`・`"sapporo/hojin/02_01"`・`"nagoya/hojin/nag_140625"` は検査を通り、DB を引く。`docId: "250416"`（要素が 1 つ）・`"a/b/c/250416"`（要素が 4 つ）・`"shotoku/250416/index.htm"`（`.` を含む）・`"Tokyo/shotoku/260218"`（英大文字）・`"shotoku/文書/250416"`（漢字）は `code: "INVALID_ARGUMENT"`・`detail.issues[0].path: "docId"` で、DB は引かない（v0.21.3 では DB を引いてから「見つかりません」の応答になっていた）。

## 取り込みのとき（Publisher）

- 0.22.0 の取り込みで、T1 の差分を `specs/current/` に取り込むとき、3 つの ID は T1 の差分の（この訂正後の）本文のまま取り込む。この差分に取り込む見出しは無い
- この差分のフォルダーを、T1・T2・T3 と同じく `specs/releases/v0.22.0/20261002-t1-docid-forms/` へ移し、この proposal.md の「状態」を取り込み済みにする

## 人が判断すること

1. **書き方（上の「書き方」）。** T1 の差分の本文を直接書き換え、この差分は proposal.md だけにした。T3 と同じく「取り込みのときに置き換える指示」にする案もあるが、3 つの ID のほぼ全文が変わるので、正本が 2 か所に分かれる。
2. **英大文字を受け付けないこと。** 3 つの形とも英小文字だけにした（shuji の決定のとおり）。2026-10-02 の DB の確認では英大文字を含む値は無かった。今後、国税庁サイトのフォルダー名に英大文字が現れると、その文書は引けなくなる（そのときは `a-z` を `a-zA-Z` にする差分を出す）。
3. **`_` の扱いの違い。** 改正通達は `_` を受け付けず、事務運営指針は先頭の要素（税目フォルダー）だけ `_` を受け付けない。shuji の決定の正規表現のとおりで、2026-10-02 の DB の確認でこの違いに当たる値は無かった。
4. **形は合うが DB に無い値の code。** 訂正後は `abc` のような値が `DOC_NOT_FOUND` になる（上の「変わる振る舞い」の最後の行）。形の検査は「どの文書の docId にもなりえない値」だけを止めるものとした。
5. **承認日。** この proposal.md に承認日と PR 番号を書く。
