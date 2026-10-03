# 差分: nta_search_qa（引数 domain を外す）

この差分は `specs/current/nta_search_qa/spec.md` に対するものです。見出し単位で、足す（ADDED）・外す（REMOVED）を書きます。ID の無い節の変更は末尾の「ID の無い節の変更」に書きます。

## ADDED

### SPEC-NTA-SEARCH-QA-010 `domain` は受け付けず、渡すと DB を引かずに `INVALID_ARGUMENT` を返す

tools/list の inputSchema の `properties` に `domain` は無い。`domain` を渡すと、どの値（`tax` を含む）でも SPEC-NTA-COMMON-ERRORS-004 の `INVALID_ARGUMENT`（`tool: "nta_search_qa"`、`detail.issues: [{ path: "domain", message: "inputSchema に無い引数です" }]`）を返し、DB を引かない。税目で絞るときは `topic`（SPEC-NTA-SEARCH-QA-004）を使う。`nta_search_tsutatsu`（SPEC-NTA-SEARCH-TSUTATSU-001）と houki-egov-mcp の `search_law` / `search_fulltext`（0.18.0、houki-egov-mcp #55）と同じ扱いである。

例: `{ keyword: "軽減税率", domain: "tax" }` は `code: "INVALID_ARGUMENT"`、`error: "引数が tools/list の inputSchema に合いません: domain: inputSchema に無い引数です"`、`detail.issues[0].path: "domain"`（v0.23.0 では `domain` を省いたときと同じ検索結果だった）。`{ keyword: "軽減税率", domain: "labor" }` も同じエラー（v0.23.0 では DB を引かずに `results: []` と `hint`）。`{ keyword: "軽減税率" }` と `{ keyword: "軽減税率", topic: "shohi" }` は今までどおり検索する。

## REMOVED

### SPEC-NTA-SEARCH-QA-002 `domain` が `tax` 以外なら DB を引かずに 0 件を返す

外す理由: `domain` を inputSchema から外し、どの値も SPEC-NTA-SEARCH-QA-010 の `INVALID_ARGUMENT` になるため。

### SPEC-NTA-SEARCH-QA-003 `domain="tax"` は絞り込まない

外す理由: 同上。`domain` を省いたときの検索の範囲（質疑応答事例の全件。`topic` があればその税目）は SPEC-NTA-SEARCH-QA-004・007 のまま変わらない。

## ID の無い節の変更

- 「入力」の表から `domain` の行を消す
- 「処理の流れ」の図から `domain` の判定（`B` と `E1`、`C`「domain では絞らない（003）」）を消し、「keyword が空白だけか」の判定（`W`）の「いいえ」から「topic があればその税目に絞って DB を検索する（004）」へつなぐ。呼び出しの箱は「呼び出し（keyword・topic・limit・hasPdf）」にする。`G` の「（003・004・015）」は「（004・015）」にする
- 「できないこと」の「`domain` で税目を絞ること（税目は `topic`。`domain` は `tax` かそれ以外かだけを見る）」を「分野（`domain`）を指定すること（質疑応答事例はすべて税務。税目は `topic` で絞る）」にする
- 「未決」の 8・9 を消す（番号は振り直さない）
- 冒頭の「関連する Issue」に `#72（domain 引数を外す）` を足す
