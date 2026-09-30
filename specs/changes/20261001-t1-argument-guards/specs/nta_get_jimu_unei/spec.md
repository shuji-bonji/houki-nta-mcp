# 差分: nta_get_jimu_unei（20261001-t1-argument-guards）

`specs/current/nta_get_jimu_unei/spec.md` に対する差分です。見出しの単位で置き換えます。

- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す
- 「入力」の表の `docId` の行の末尾に「空文字・空白だけは不可（009）。形は 010」を足す

## ADDED

### SPEC-NTA-GET-JIMU-UNEI-009 docId が空文字・空白だけのときはDBを引かずに `INVALID_ARGUMENT` を返す

空文字は inputSchema の `minLength: 1` の検査（SPEC-NTA-COMMON-ERRORS-013）で止まり、`INVALID_ARGUMENT`（`tool: "nta_get_jimu_unei"`、`detail.issues: [{ path: "docId", message: "空文字は指定できません" }]`）を返す。空白（半角スペース・全角スペース・タブ・改行）だけのときは、ツールの処理がDBを引く前に、SPEC-NTA-COMMON-ERRORS-014 の形の `INVALID_ARGUMENT`（`tool: "nta_get_jimu_unei"`、`error: "docId が空です"`、`detail.issues: [{ path: "docId", message: "空白だけは指定できません" }]`、`hint` に`nta_search_jimu_unei` の結果か `available_doc_ids` の `docId`を渡すよう書く）を返す。

例: `docId: ""` は `code: "INVALID_ARGUMENT"`・`detail.issues[0].message: "空文字は指定できません"`。`docId: "　"`（全角スペース）と `docId: " \n"` は `code: "INVALID_ARGUMENT"`・`error: "docId が空です"`。どれもDBは引かない。

### SPEC-NTA-GET-JIMU-UNEI-010 `docId` が受け付ける形でないときは DB を引かずに `INVALID_ARGUMENT` を返す

`docId` の形は `/` で区切った 2 つ以上の要素で、先頭は税目フォルダ（英小文字・数字・`-`）、最後は半角の数字 6 桁に `_` と数字が付くことがある番号（例: `shotoku/shinkoku/170331`、`sozoku/170111_1`） である（SPEC-NTA-COMMON-ERRORS-015）。前後の空白を除いた値がこの形でないときは、DB を引く前に `INVALID_ARGUMENT`（`tool: "nta_get_jimu_unei"`、`error: "docId の形が受け付ける形ではありません: <渡した値>"`、`detail.issues: [{ path: "docId", message: "税目/…/番号 の形（shotoku/shinkoku/170331）で指定してください" }]`、`hint` に正しい形の例）を返す。`DOC_NOT_FOUND` / `TSUTATSU_NOT_FOUND` は、形は正しいが DB にその文書が無いときだけになる。

例: `docId: "shotoku/shinkoku/170331"` と `docId: "sozoku/170111_1"` は検査を通り、DB を引く。`docId: "170331"`（税目が無い）・`docId: "shotoku/abc"`・`docId: "/shotoku/170331"` は `code: "INVALID_ARGUMENT"`・`detail.issues[0].path: "docId"` で、DB は引かない（v0.21.3 では DB を引いてから「見つかりません」の応答になっていた）。
