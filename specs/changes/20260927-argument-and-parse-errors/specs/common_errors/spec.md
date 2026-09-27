# 差分: common_errors（20260927-argument-and-parse-errors）

`specs/current/common_errors/spec.md` に対する差分です。見出しの単位で置き換えます。

- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す

## ADDED

### SPEC-NTA-COMMON-ERRORS-007 inputSchema の検査で返す `INVALID_ARGUMENT` には、inputSchema を確かめる案内を付ける

SPEC-NTA-COMMON-ERRORS-003・004 のエラーは、14 ツールとも次の形で返す。

- `error` は `引数が tools/list の inputSchema に合いません: ` で始まり、その後に `detail.issues` の問題を `<path>: <message>` の形で続ける（`path` が空なら `<message>` だけ）
- `hint` は `tools/list の <ツール名> の inputSchema を確認してください (型・必須・enum・未知の引数)`
- `next_actions` は `{ action: "list_tools", reason: "inputSchema で引数の型と必須項目を確認できます" }` の 1 件

例: `nta_search_jimu_unei` に `{ keyword: "x", foo: 1 }` を渡すと、`error` は `引数が tools/list の inputSchema に合いません: foo: inputSchema に無い引数です`、`hint` は `tools/list の nta_search_jimu_unei の inputSchema を確認してください (型・必須・enum・未知の引数)` になる。`nta_get_jimu_unei` に `{}` を渡すと、`detail.issues[0].path` は空文字で、`error` は `引数が tools/list の inputSchema に合いません: ` の後に必須の引数が無いことを表す文が続く。

### SPEC-NTA-COMMON-ERRORS-008 inputSchema に合わない引数では、ツールの処理に進まない

SPEC-NTA-COMMON-ERRORS-003・004 のエラーを返すときは、ツールの処理に進まない。ローカル DB を開かず、国税庁サイトに取りに行かず、略称辞書も引かない。例: `nta_get_qa` に `{ topic: "shohi", category: "01" }`（必須の `id` が無い）を渡しても、国税庁サイトへの取得は起きない。

### SPEC-NTA-COMMON-ERRORS-009 国税庁のページの解析に失敗したときは `INTERNAL_ERROR` で、ページの構造の変更を疑う案内を付ける

国税庁サイトから取ったページを読み取れなかったときは、エラー `INTERNAL_ERROR` を返す（`isError: true`）。当てはまるのは次の 3 ツールである。

| ツール | 読み取れなかったページ | `error` |
|---|---|---|
| `nta_get_tsutatsu` | 条項のある節のページ、または目次のページ（SPEC-NTA-GET-TSUTATSU-006・014） | `通達ページのパースに失敗: <理由>` |
| `nta_get_qa` | 事例のページ（SPEC-NTA-GET-QA-005） | `質疑応答事例ページのパースに失敗: <理由>` |
| `nta_get_tax_answer` | 記事のページ（SPEC-NTA-GET-TAX-ANSWER-005） | `タックスアンサーページのパースに失敗: <理由>` |

- `hint` は `パーサのバグまたは国税庁ページの構造変更の可能性。報告してください`
- `url` に、読み取れなかったページの URL を入れる
- `detail` は `{ url: <同じ URL>, cause: <理由> }`
- 読み取れなかったページの内容は DB に書き戻さない

ページの取得そのものに失敗したとき（`SOURCE_API_ERROR`）と、処理中の想定外の例外（SPEC-NTA-COMMON-ERRORS-006）は、この ID に当たらない。
