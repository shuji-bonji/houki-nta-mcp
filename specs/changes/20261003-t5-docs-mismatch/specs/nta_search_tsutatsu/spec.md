# 差分: nta_search_tsutatsu（20261003-t5-docs-mismatch）

`specs/current/nta_search_tsutatsu/spec.md` に対する差分です。見出しの単位で置き換えます。

- `MODIFIED` の見出しは、current の同じ見出しの本文をこの本文で置き換える

## MODIFIED

### SPEC-NTA-SEARCH-TSUTATSU-003 DB に条項が 1 件も無いときは、基本通達 4 種の bulk download を案内する

ローカル DB に基本通達の条項が 1 件も入っていないときは、エラー `TSUTATSU_NOT_FOUND`（`error` は「ローカル DB に検索対象がありません」）を返す。`hint` に CLI の `--bulk-download-all`（基本通達 4 種を順に投入する。SPEC-NTA-CLI-BULK-DOWNLOAD-001）を実行する案内と、1 つの通達だけを先に入れるなら `--bulk-download --tsutatsu=<正式名>` でもよい旨を書き、`next_actions` に `action: "cli_bulk_download"`（`example.command` は `houki-nta-mcp --bulk-download-all`）を入れる。

このツールは基本通達 4 種をまとめて検索し、ツールの説明文と `freshness.warning`（SPEC-NTA-SEARCH-RULES-017）は `--bulk-download-all` を案内している。DB が空のときの案内も同じフラグにする。

例: 空の DB で `{ keyword: "役員" }` を渡すと、`code: "TSUTATSU_NOT_FOUND"`、`hint` に `--bulk-download-all` を含み、`next_actions[0].example.command` は `houki-nta-mcp --bulk-download-all`（v0.22.0 では `--bulk-download` で、既定では消費税法基本通達 1 つだけが入っていた）。
