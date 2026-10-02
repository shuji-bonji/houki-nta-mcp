# 差分: nta_get_jimu_unei（20261001-t1-argument-guards）

`specs/current/nta_get_jimu_unei/spec.md` に対する差分です。見出しの単位で置き換えます。

- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す
- 「入力」の表の `docId` の行の末尾に「空文字・空白だけは不可（009）。形は 010」を足す

## ADDED

### SPEC-NTA-GET-JIMU-UNEI-009 docId が空文字・空白だけのときはDBを引かずに `INVALID_ARGUMENT` を返す

空文字は inputSchema の `minLength: 1` の検査（SPEC-NTA-COMMON-ERRORS-013）で止まり、`INVALID_ARGUMENT`（`tool: "nta_get_jimu_unei"`、`detail.issues: [{ path: "docId", message: "空文字は指定できません" }]`）を返す。空白（半角スペース・全角スペース・タブ・改行）だけのときは、ツールの処理がDBを引く前に、SPEC-NTA-COMMON-ERRORS-014 の形の `INVALID_ARGUMENT`（`tool: "nta_get_jimu_unei"`、`error: "docId が空です"`、`detail.issues: [{ path: "docId", message: "空白だけは指定できません" }]`、`hint` に`nta_search_jimu_unei` の結果か `available_doc_ids` の `docId`を渡すよう書く）を返す。

例: `docId: ""` は `code: "INVALID_ARGUMENT"`・`detail.issues[0].message: "空文字は指定できません"`。`docId: "　"`（全角スペース）と `docId: " \n"` は `code: "INVALID_ARGUMENT"`・`error: "docId が空です"`。どれもDBは引かない。

### SPEC-NTA-GET-JIMU-UNEI-010 `docId` が受け付ける形でないときは DB を引かずに `INVALID_ARGUMENT` を返す

`docId` は、国税庁サイトの事務運営指針のページの URL（`…/law/jimu-unei/<フォルダー>/…/index.htm`）のフォルダーの並びで、`/` で区切った 2 つ以上の要素からなる。先頭の要素（税目フォルダー）は英小文字・半角の数字・`-`、2 つ目以降の要素は英小文字・半角の数字・`-`・`_` だけからなる（SPEC-NTA-COMMON-ERRORS-015）。フォルダー名の付け方は税目や年代によって違う（`shotoku/shinkoku/170331`・`sozoku/170111_1`・`hojin/000703-3`・`sonota/1912` など）ので、数字の桁数は確かめない。前後の空白を除き、半角に揃えた（SPEC-NTA-GET-JIMU-UNEI-011）値がこの形でないときは、DB を引く前に `INVALID_ARGUMENT`（`tool: "nta_get_jimu_unei"`、`error: "docId の形が受け付ける形ではありません: <渡した値>"`、`detail.issues: [{ path: "docId", message: "税目/…/フォルダー名 の形で、英小文字・数字・-・_ だけで指定してください（例: shotoku/shinkoku/170331）" }]`、`hint` に `nta_search_jimu_unei` の結果か `available_doc_ids` の `docId` をそのまま渡すよう書く）を返す。`DOC_NOT_FOUND` は、形に合うが DB にその文書が無いときだけになる。

例: `docId: "shotoku/shinkoku/170331"`・`"sozoku/170111_1"`・`"hojin/000703-3"`・`"sonota/1912"` は検査を通り、DB を引く。`docId: "170331"`（要素が 1 つ）・`"/shotoku/170331"`（先頭が `/`）・`"shotoku/"`（末尾が `/`）・`"shotoku/shinkoku/170331/index.htm"`（`.` を含む）・`"shotoku/申告/170331"`（漢字）は `code: "INVALID_ARGUMENT"`・`detail.issues[0].path: "docId"` で、DB は引かない（v0.21.3 では DB を引いてから「見つかりません」の応答になっていた）。
