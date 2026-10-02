# 差分: nta_get_kaisei_tsutatsu（20261001-t1-argument-guards）

`specs/current/nta_get_kaisei_tsutatsu/spec.md` に対する差分です。見出しの単位で置き換えます。

- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す
- 「入力」の表の `docId` の行の末尾に「空文字・空白だけは不可（009）。形は 010」を足す

## ADDED

### SPEC-NTA-GET-KAISEI-TSUTATSU-009 docId が空文字・空白だけのときはDBを引かずに `INVALID_ARGUMENT` を返す

空文字は inputSchema の `minLength: 1` の検査（SPEC-NTA-COMMON-ERRORS-013）で止まり、`INVALID_ARGUMENT`（`tool: "nta_get_kaisei_tsutatsu"`、`detail.issues: [{ path: "docId", message: "空文字は指定できません" }]`）を返す。空白（半角スペース・全角スペース・タブ・改行）だけのときは、ツールの処理がDBを引く前に、SPEC-NTA-COMMON-ERRORS-014 の形の `INVALID_ARGUMENT`（`tool: "nta_get_kaisei_tsutatsu"`、`error: "docId が空です"`、`detail.issues: [{ path: "docId", message: "空白だけは指定できません" }]`、`hint` に`nta_search_kaisei_tsutatsu` の結果の `docId`を渡すよう書く）を返す。

例: `docId: ""` は `code: "INVALID_ARGUMENT"`・`detail.issues[0].message: "空文字は指定できません"`。`docId: "　"`（全角スペース）と `docId: " \n"` は `code: "INVALID_ARGUMENT"`・`error: "docId が空です"`。どれもDBは引かない。

### SPEC-NTA-GET-KAISEI-TSUTATSU-010 `docId` が受け付ける形でないときは DB を引かずに `INVALID_ARGUMENT` を返す

`docId` は、国税庁サイトの改正通達のページの URL（`…/kaisei/<フォルダー名>/index.htm`）のフォルダー名で、英小文字・半角の数字・`-` だけからなる、`/` を含まない 1 つの要素である（SPEC-NTA-COMMON-ERRORS-015）。フォルダー名の付け方は年代によって違う（`0026003-067`・`0014720-84`・`240401`・`2606`・`tougou` など）ので、数字の桁数と `-` の位置は確かめない。前後の空白を除き、半角に揃えた（SPEC-NTA-GET-KAISEI-TSUTATSU-011）値がこの形でないときは、DB を引く前に `INVALID_ARGUMENT`（`tool: "nta_get_kaisei_tsutatsu"`、`error: "docId の形が受け付ける形ではありません: <渡した値>"`、`detail.issues: [{ path: "docId", message: "英小文字・数字・- だけで指定してください（例: 0026003-067、240401）" }]`、`hint` に `nta_search_kaisei_tsutatsu` の結果の `docId` をそのまま渡すよう書く）を返す。`DOC_NOT_FOUND` は、形に合うが DB にその文書が無いときだけになる。

例: `docId: "0026003-067"`・`"240401"`・`"0014720-84"`・`"tougou"` は検査を通り、DB を引く。`docId: "0026003/067"`（`/` を含む）・`"0026003_067"`（`_` を含む）・`"ABC-1"`（英大文字）・`"課消2-11"`（漢字）・`"0026003-067/index.htm"`（`/` と `.` を含む）は `code: "INVALID_ARGUMENT"`・`detail.issues[0].path: "docId"` で、DB は引かない（v0.21.3 では DB を引いてから「見つかりません」の応答になっていた）。
