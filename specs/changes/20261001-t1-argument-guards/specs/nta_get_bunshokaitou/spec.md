# 差分: nta_get_bunshokaitou（20261001-t1-argument-guards）

`specs/current/nta_get_bunshokaitou/spec.md` に対する差分です。見出しの単位で置き換えます。

- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す
- 「入力」の表の `docId` の行の末尾に「空文字・空白だけは不可（009）。形は 010」を足す

## ADDED

### SPEC-NTA-GET-BUNSHOKAITOU-009 docId が空文字・空白だけのときはDBを引かずに `INVALID_ARGUMENT` を返す

空文字は inputSchema の `minLength: 1` の検査（SPEC-NTA-COMMON-ERRORS-013）で止まり、`INVALID_ARGUMENT`（`tool: "nta_get_bunshokaitou"`、`detail.issues: [{ path: "docId", message: "空文字は指定できません" }]`）を返す。空白（半角スペース・全角スペース・タブ・改行）だけのときは、ツールの処理がDBを引く前に、SPEC-NTA-COMMON-ERRORS-014 の形の `INVALID_ARGUMENT`（`tool: "nta_get_bunshokaitou"`、`error: "docId が空です"`、`detail.issues: [{ path: "docId", message: "空白だけは指定できません" }]`、`hint` に`nta_search_bunshokaitou` の結果の `docId`を渡すよう書く）を返す。

例: `docId: ""` は `code: "INVALID_ARGUMENT"`・`detail.issues[0].message: "空文字は指定できません"`。`docId: "　"`（全角スペース）と `docId: " \n"` は `code: "INVALID_ARGUMENT"`・`error: "docId が空です"`。どれもDBは引かない。

### SPEC-NTA-GET-BUNSHOKAITOU-010 `docId` が受け付ける形でないときは DB を引かずに `INVALID_ARGUMENT` を返す

`docId` の形は `税目/番号`（本庁。例: `shotoku/250416`）か `局/税目/番号`（国税局。例: `tokyo/shotoku/260218`）で、税目と局は英小文字・数字・`-`・`_`、番号は半角の数字 6 桁 である（SPEC-NTA-COMMON-ERRORS-015）。前後の空白を除いた値がこの形でないときは、DB を引く前に `INVALID_ARGUMENT`（`tool: "nta_get_bunshokaitou"`、`error: "docId の形が受け付ける形ではありません: <渡した値>"`、`detail.issues: [{ path: "docId", message: "税目/番号（shotoku/250416）か 局/税目/番号（tokyo/shotoku/260218）の形で指定してください" }]`、`hint` に正しい形の例）を返す。`DOC_NOT_FOUND` / `TSUTATSU_NOT_FOUND` は、形は正しいが DB にその文書が無いときだけになる。

例: `docId: "shotoku/250416"` と `docId: "tokyo/shotoku/260218"` は検査を通り、DB を引く。`docId: "250416"`（税目が無い）・`docId: "shotoku/25041"`（番号が 5 桁）・`docId: "a/b/c/250416"`（要素が 4 つ） は `code: "INVALID_ARGUMENT"`・`detail.issues[0].path: "docId"` で、DB は引かない（v0.21.3 では DB を引いてから「見つかりません」の応答になっていた）。
