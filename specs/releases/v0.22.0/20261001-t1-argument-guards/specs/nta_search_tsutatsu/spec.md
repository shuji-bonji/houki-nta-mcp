# 差分: nta_search_tsutatsu（20261001-t1-argument-guards）

`specs/current/nta_search_tsutatsu/spec.md` に対する差分です。見出しの単位で置き換えます。

- `MODIFIED` の見出しは、current の同じ見出しの本文をこの本文で置き換える
- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す
- 「入力」の表の `limit` の行を「取得件数。既定 10。1 以上 50 以下の整数」にし、`keyword` の行の末尾に「空文字・空白だけは不可」を足す

## MODIFIED

### SPEC-NTA-SEARCH-TSUTATSU-001 inputSchema に合わない引数では検索しない

`keyword` が無い、`inputSchema` に無い引数（`domain`、`type` など）がある、型が合わない、`limit` が 1 以上 50 以下の整数でない（SPEC-NTA-SEARCH-TSUTATSU-011）、`keyword` が空文字（SPEC-NTA-SEARCH-TSUTATSU-002）、のどれかのときは、エラー `INVALID_ARGUMENT` を返す。DB は引かない。応答には `tool: "nta_search_tsutatsu"`、`hint`（`tools/list` の inputSchema を確かめる案内）、`next_actions`（`action: "list_tools"`）、`detail.issues`（違反 1 件ごとの要素。各要素は `path`（引数名）と `message`（日本語の 1 文。SPEC-NTA-COMMON-ERRORS-011））が入る。

例: `{ keyword: "軽減税率", domain: "tax" }` → `code: "INVALID_ARGUMENT"`、`detail.issues[0].path` は `"domain"`。`{}` → `detail.issues` は `[{ path: "keyword", message: "必須の引数です" }]`。

### SPEC-NTA-SEARCH-TSUTATSU-002 keyword が空なら検索しない

`keyword` が空文字のときは、inputSchema の `minLength: 1` の検査（SPEC-NTA-COMMON-ERRORS-013）で止まり、`INVALID_ARGUMENT`（`tool: "nta_search_tsutatsu"`、`detail.issues: [{ path: "keyword", message: "空文字は指定できません" }]`）を返す。空白（半角スペース・全角スペース・タブ・改行）だけのときは、ツールの処理が DB を引く前に、SPEC-NTA-COMMON-ERRORS-014 の形の `INVALID_ARGUMENT`（`tool: "nta_search_tsutatsu"`、`error: "keyword が空です"`、`detail.issues: [{ path: "keyword", message: "空白だけは指定できません" }]`、`hint` に探したい語を渡すよう書く、`next_actions` に `list_tools`）を返す。どちらも DB は引かない。

例: `keyword: ""` は `detail.issues[0].message: "空文字は指定できません"`。`keyword: "   "` は `error: "keyword が空です"`・`detail.issues[0].path: "keyword"`。どちらも `code: "INVALID_ARGUMENT"`・`tool: "nta_search_tsutatsu"`（v0.21.3 は `error` の文だけで `detail.issues` が無かった）。

## ADDED

### SPEC-NTA-SEARCH-TSUTATSU-011 `limit` は 1 以上 50 以下の整数で、範囲の外は `INVALID_ARGUMENT` にして丸めない

tools/list の inputSchema の `limit` は `type: "integer"`、`minimum: 1`、`maximum: 50` を持つ（SPEC-NTA-COMMON-ERRORS-012）。0・負の数・小数・51 以上・数値でない値を渡すと、inputSchema の検査で `INVALID_ARGUMENT`（`tool: "nta_search_tsutatsu"`、`detail.issues[0].path: "limit"`）を返し、DB を引かない。1 件や 50 件に丸めたり、切り捨てたりしない。既定の 10 件は変えない。

例: `{ keyword: "軽減税率", limit: 0 }` は `code: "INVALID_ARGUMENT"`、`detail.issues` は `[{ path: "limit", message: "1 以上で指定してください" }]` で、DB は引かない（v0.21.3 では 1 件に丸めていた）。`limit: 100` は `[{ path: "limit", message: "50 以下で指定してください" }]`（v0.21.3 では 50 件）。`limit: 2.5` と `limit: "10"` は `整数で指定してください`。`limit: 50` は検査を通り、最大 50 件を返す。
