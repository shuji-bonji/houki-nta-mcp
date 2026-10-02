# 差分: common_errors（20261001-t1-argument-guards）

`specs/current/common_errors/spec.md` に対する差分です。見出しの単位で置き換えます。

- `MODIFIED` の見出しは、current の同じ見出しの本文をこの本文で置き換える
- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す
- 「エラー応答のフィールド」の表の `detail` の行を「調べるための詳細。`status`（HTTP ステータス）・`url`・`cause`（元の例外の文）・`issues`（引数の検査の問題の一覧。要素は `path` と `message`）」にする

## MODIFIED

### SPEC-NTA-COMMON-ERRORS-003 inputSchema に合わない引数はエラー `INVALID_ARGUMENT`

引数の型が違う、必須の引数が無い、`enum` に無い値を渡した、数値が `minimum` / `maximum` の範囲の外にある、文字列が `minLength` に合わない、のどれかのときは、ツールの処理に進まずにエラー `INVALID_ARGUMENT` を返す（`isError: true`）。14 ツールすべてが、tools/list に出している inputSchema と同じものでこの検査を行う。

- `tool` に、呼んだツールの名前を入れる
- `detail.issues` に問題の一覧を入れる。要素は `path`（問題のある引数名。入れ子なら `a.b` の形。空文字にはならない）と `message`（日本語の 1 文。SPEC-NTA-COMMON-ERRORS-011）。違反 1 件ごとに要素を分ける（010）

例: `resolve_abbreviation` に `abbr: 123` を渡すと、`code: "INVALID_ARGUMENT"`・`tool: "resolve_abbreviation"` で、`detail.issues[0].path` は `abbr`。`nta_search_tsutatsu` に引数を 1 つも渡さない（必須の `keyword` が無い）とき、`keyword: "軽減税率", type: "bogus"` を渡したとき、`keyword: "軽減税率", limit: 100` を渡したとき（SPEC-NTA-SEARCH-TSUTATSU-011）も、`INVALID_ARGUMENT` を返す。

### SPEC-NTA-COMMON-ERRORS-007 inputSchema の検査で返す `INVALID_ARGUMENT` には、inputSchema を確かめる案内を付ける

SPEC-NTA-COMMON-ERRORS-003・004 のエラーは、14 ツールとも次の形で返す。

- `error` は `引数が tools/list の inputSchema に合いません: ` で始まり、その後に `detail.issues` の各要素を `<path>: <message>` の形にして `; ` 区切りで続ける（`path` は空にならない。SPEC-NTA-COMMON-ERRORS-010）
- `hint` は `tools/list の <ツール名> の inputSchema を確認してください (型・必須・enum・範囲・形式・未知の引数)`
- `next_actions` は `{ action: "list_tools", reason: "inputSchema で引数の型と必須項目を確認できます" }` の 1 件

例: `nta_search_jimu_unei` に `{ keyword: "x", foo: 1 }` を渡すと、`error` は `引数が tools/list の inputSchema に合いません: foo: inputSchema に無い引数です`、`hint` は `tools/list の nta_search_jimu_unei の inputSchema を確認してください (型・必須・enum・範囲・形式・未知の引数)` になる。`nta_get_jimu_unei` に `{}` を渡すと、`detail.issues` は `[{ path: "docId", message: "必須の引数です" }]` で、`error` は `引数が tools/list の inputSchema に合いません: docId: 必須の引数です`。

## ADDED

### SPEC-NTA-COMMON-ERRORS-010 `detail.issues` は違反 1 件ごとに要素を分け、`path` には引数名を入れる

SPEC-NTA-COMMON-ERRORS-003・004 のエラーの `detail.issues` は、違反 1 件につき 1 要素である。`path` は、その違反のあった引数の名前で、空文字にならない。

- 必須の引数が無いときも、`path` はその引数の名前である。必須の引数が 2 つ無ければ、要素も 2 つ
- inputSchema に無い引数が 2 つ以上あるときも、1 つずつ別の要素にする（`a, b` のようにまとめない）
- 型の違反と inputSchema に無い引数が同時にあるときは、両方の要素を返す

例: `nta_search_tsutatsu` に `{ keyword: 1, limit: "x" }` を渡すと、`detail.issues` は `[{ path: "keyword", message: "文字列で指定してください" }, { path: "limit", message: "整数で指定してください" }]` の 2 要素（v0.21.3 では 1 要素にまとまっていた）。`nta_get_qa` に `{ topic: "shohi" }` を渡すと `[{ path: "category", message: "必須の引数です" }, { path: "id", message: "必須の引数です" }]`。`nta_search_tsutatsu` に `{ keyword: "a", limit: "x", zz: 1 }` を渡すと `path` が `limit` と `zz` の 2 要素。`{ keyword: "a", zz: 1, yy: 2 }` は `path` が `zz` と `yy` の 2 要素。

### SPEC-NTA-COMMON-ERRORS-011 `detail.issues[].message` は違反の種類ごとに決まった日本語の 1 文

SPEC-NTA-COMMON-ERRORS-003・004 のエラーの `message` は、次の表の文である。検査の部品が作る英文（`data/limit must be number` など）はそのまま返さない。houki-egov-mcp の SPEC-EGOV-COMMON-ERRORS-022 と同じ表である。

| 違反                                | `message`                                                                   |
| ----------------------------------- | --------------------------------------------------------------------------- |
| 型が `string` でない                | `文字列で指定してください`                                                  |
| 型が `integer` でない（小数を含む） | `整数で指定してください`                                                    |
| 型が `number` でない                | `数値で指定してください`                                                    |
| 型が `boolean` でない               | `true か false で指定してください`                                          |
| 型が `array` でない                 | `配列で指定してください`                                                    |
| 型が `object` でない                | `オブジェクトで指定してください`                                            |
| 必須の引数が無い                    | `必須の引数です`                                                            |
| `enum` に無い値                     | `<値1>・<値2>・… のどれかで指定してください`（`enum` の値を `・` でつなぐ） |
| `minimum` を下回る                  | `<minimum> 以上で指定してください`（例: `1 以上で指定してください`）        |
| `maximum` を上回る                  | `<maximum> 以下で指定してください`（例: `50 以下で指定してください`）       |
| `minLength: 1` に合わない（空文字） | `空文字は指定できません`                                                    |
| inputSchema に無い引数              | `inputSchema に無い引数です`                                                |

例: `nta_search_qa` に `{ keyword: "軽減税率", limit: 2.5 }` を渡すと `message` は `整数で指定してください`。`limit: 0` なら `1 以上で指定してください`、`limit: 51` なら `50 以下で指定してください`。`nta_get_qa` に `{ topic: "bogus", category: "01", id: "01" }` を渡すと `shotoku・gensen・joto・sozoku・hyoka・hojin・shohi・inshi・hotei のどれかで指定してください`。`nta_search_tax_answer` に `{ keyword: "" }` を渡すと `空文字は指定できません`。`{ keyword: "医療費控除", hasPdf: "yes" }` は `true か false で指定してください`。

### SPEC-NTA-COMMON-ERRORS-012 数値の引数は inputSchema に整数と範囲を書き、範囲の外は `INVALID_ARGUMENT` にして丸めない

数値の引数は、tools/list の inputSchema に `type: "integer"` と `minimum` / `maximum` を書く。0・負の数・小数・上限を超える値・数値でない値は、SPEC-NTA-COMMON-ERRORS-003 の検査で `INVALID_ARGUMENT` になり、ツールの処理に進まない。既定値に丸めたり、上限に切り詰めたり、切り捨てたりしない。

| ツール                                                                                                                                | 引数    | `minimum` | `maximum` | 省いたとき | 仕様 ID                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- | --------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nta_search_tsutatsu` / `nta_search_qa` / `nta_search_tax_answer` / `nta_search_kaisei_tsutatsu` / `nta_search_jimu_unei` / `nta_search_bunshokaitou` | `limit` | 1         | 50        | 10         | SPEC-NTA-SEARCH-TSUTATSU-011 / SPEC-NTA-SEARCH-QA-008 / SPEC-NTA-SEARCH-TAX-ANSWER-004 / SPEC-NTA-SEARCH-KAISEI-TSUTATSU-005 / SPEC-NTA-SEARCH-JIMU-UNEI-007 / SPEC-NTA-SEARCH-BUNSHOKAITOU-007 |

数値の引数はこの 6 つだけである。

例: tools/list の `nta_search_qa` の inputSchema は `properties.limit` が `type: "integer"`、`minimum: 1`、`maximum: 50` を持つ。6 ツールとも同じ。

### SPEC-NTA-COMMON-ERRORS-013 必須の文字列の引数は inputSchema に `minLength: 1` を書き、空文字は `INVALID_ARGUMENT`

必須の文字列の引数（検索 6 ツールの `keyword`、`resolve_abbreviation` の `abbr`、`nta_get_tsutatsu` の `name`、`nta_get_kaisei_tsutatsu` / `nta_get_jimu_unei` / `nta_get_bunshokaitou` / `nta_inspect_pdf_meta` の `docId`、`nta_get_qa` の `category` / `id`、`nta_get_tax_answer` の `no`）は、inputSchema に `minLength: 1` を書く。空文字は SPEC-NTA-COMMON-ERRORS-003 の検査で `INVALID_ARGUMENT`（`message: "空文字は指定できません"`）になり、ツールの処理に進まない。`enum` を持つ必須の文字列（`nta_get_qa` の `topic`、`nta_inspect_pdf_meta` の `docType`）は `enum` で止まるので `minLength` は書かない。任意の文字列（`nta_get_tsutatsu` の `clause`、`taxonomy`）にも書かない。

例: `nta_search_qa` に `keyword: ""` を渡すと `code: "INVALID_ARGUMENT"`、`tool: "nta_search_qa"`、`detail.issues` は `[{ path: "keyword", message: "空文字は指定できません" }]` で、DB は引かない（v0.21.3 では `results: []` と「該当なし」の `hint` だった）。`resolve_abbreviation` に `abbr: ""` を渡しても `INVALID_ARGUMENT`（v0.21.3 の `resolved: null` ではない）。`nta_get_tax_answer` に `no: ""` を渡しても `INVALID_ARGUMENT`。

### SPEC-NTA-COMMON-ERRORS-014 空白だけの必須の文字列は、ツールの処理で同じ形の `INVALID_ARGUMENT` にする

必須の文字列の引数が空白（半角スペース・全角スペース・タブ・改行）だけのときは、inputSchema では止まらないので、各ツールの処理が、ローカル DB・国税庁サイト・略称辞書のどれにも問い合わせる前に `INVALID_ARGUMENT` を返す。本文は次の形で、inputSchema の検査のエラーと同じ `tool`・`detail.issues` を持つ。

- `tool`: 呼んだツールの名前
- `error`: `<引数名> が空です`
- `detail.issues`: `[{ path: "<引数名>", message: "空白だけは指定できません" }]`
- `hint`: 各ツールが決める（その引数に何を渡すかの案内）
- `next_actions`: 各ツールが決める（付けなくてもよい）

対象の引数は SPEC-NTA-COMMON-ERRORS-013 と同じ。各ツールの仕様 ID は、`nta_search_tsutatsu` 002、`nta_search_qa` 009、`nta_search_tax_answer` 005、`nta_search_kaisei_tsutatsu` 006、`nta_search_jimu_unei` 008、`nta_search_bunshokaitou` 008、`resolve_abbreviation` 007、`nta_get_tsutatsu` 017、`nta_get_kaisei_tsutatsu` 009、`nta_get_jimu_unei` 009、`nta_get_bunshokaitou` 009、`nta_inspect_pdf_meta` 019、`nta_get_qa` 002、`nta_get_tax_answer` 001。houki-egov-mcp の SPEC-EGOV-COMMON-ERRORS-026 と同じ形である。

例: `nta_search_qa` に `keyword: "   "` を渡すと `code: "INVALID_ARGUMENT"`、`tool: "nta_search_qa"`、`error: "keyword が空です"`、`detail.issues` は `[{ path: "keyword", message: "空白だけは指定できません" }]` で、DB は引かない。`nta_get_bunshokaitou` に `docId: "\t"` を渡しても同じ形（`path: "docId"`）。

### SPEC-NTA-COMMON-ERRORS-015 識別子の形は各ツールの処理で確かめ、合わなければ同じ形の `INVALID_ARGUMENT` と正しい形の `hint` を返す

文書を指す識別子（`nta_get_kaisei_tsutatsu` / `nta_get_jimu_unei` / `nta_get_bunshokaitou` の `docId`、`nta_get_qa` の `category` / `id`、`nta_get_tax_answer` の `no`）は、inputSchema の `pattern` ではなく、各ツールの処理が、前後の空白を除いた値（全角を半角に揃える処理があればその後）を、そのツールの spec.md に書いた形と突き合わせて確かめる。合わないときは、ローカル DB と国税庁サイトを引く前に `INVALID_ARGUMENT` を返す。本文は次の形である。

- `tool`: 呼んだツールの名前
- `error`: `<引数名> の形が受け付ける形ではありません: <渡した値>`
- `detail.issues`: `[{ path: "<引数名>", message: "<正しい形の説明。各ツールの ID に書く>" }]`
- `hint`: 正しい形の例（各ツールの ID に書く）

`DOC_NOT_FOUND` / `TSUTATSU_NOT_FOUND` は、形は正しいが DB にその文書が無いときだけになる。形の検査を inputSchema に置かないのは、全角の値を半角に揃えてから確かめられるようにするためである（揃えるかどうかは差分 `20261001-t3-normalize` で決める）。各ツールの仕様 ID は、`nta_get_kaisei_tsutatsu` 010、`nta_get_jimu_unei` 010、`nta_get_bunshokaitou` 010、`nta_get_qa` 013、`nta_get_tax_answer` 001・012。

例: `nta_get_bunshokaitou` に `docId: "250416"` を渡すと `code: "INVALID_ARGUMENT"`、`tool: "nta_get_bunshokaitou"`、`detail.issues[0].path: "docId"` で、DB は引かない。`nta_get_qa` に `topic: "shohi", category: "1a", id: "01"` を渡すと `detail.issues[0].path: "category"`。
