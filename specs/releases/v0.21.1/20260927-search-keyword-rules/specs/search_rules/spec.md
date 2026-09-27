# 差分: search_rules（20260927-search-keyword-rules）

`specs/current/search_rules/spec.md` に対する差分です。見出しの単位で置き換えます。

- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す

## ADDED

### SPEC-NTA-SEARCH-RULES-016 略称・通称を広げるのは houki-nta と houki-egov の管轄の項目だけで、正式名が `keyword` と同じなら広げない

SPEC-NTA-SEARCH-RULES-009・010 で `keyword` を正式名に広げるのは、略称辞書の項目の管轄（`source_mcp_hint`）が `houki-nta` か `houki-egov` のときだけである。

- 管轄がほかの MCP（`houki-court`・`houki-saiketsu` など）の項目に当たったときは広げず、元の語だけで探す。`scoreReasons` に `abbreviation expanded:` は入らず、`search_notes` に通称の展開の文も入らない
- 辞書の正式名が `keyword` と同じ文字列のとき（例: `酒税法`。辞書の略称と正式名がどちらも `酒税法`）は広げない。`scoreReasons` に `abbreviation expanded:` は入らない
