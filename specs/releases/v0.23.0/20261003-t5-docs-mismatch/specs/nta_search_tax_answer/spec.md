# 差分: nta_search_tax_answer（20261003-t5-docs-mismatch）

`specs/current/nta_search_tax_answer/spec.md` に対する差分です。見出しの単位で置き換えます。

- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す

## ADDED

### SPEC-NTA-SEARCH-TAX-ANSWER-006 ヒットしたときは、先頭の記事を `nta_get_tax_answer` で読む案内を `next_actions` に入れる

キーワードに合うタックスアンサーが 1 件以上あるとき（SPEC-NTA-SEARCH-RULES-015）は、応答に `next_actions` を付ける。`next_actions` は 1 件で、`action: "nta_get_tax_answer"`、`reason: "記事の本文を読めます"`、`example: { no: <results[0].docId> }`。`results[].docId` は 4 桁の記事番号で、`nta_get_tax_answer` の `no` にそのまま渡せる。

0 件のとき（SPEC-NTA-SEARCH-TAX-ANSWER-002・003）は、この案内を付けない（読む記事が無いため）。

例: `{ keyword: "医療費控除" }` で `results[0].docId` が `"1131"` のとき、`next_actions` は `[{ action: "nta_get_tax_answer", reason: "記事の本文を読めます", example: { no: "1131" } }]`（v0.22.0 では `next_actions` が無かった）。
