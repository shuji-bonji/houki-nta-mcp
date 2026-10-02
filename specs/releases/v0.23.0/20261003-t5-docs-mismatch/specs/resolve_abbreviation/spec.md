# 差分: resolve_abbreviation（20261003-t5-docs-mismatch）

`specs/current/resolve_abbreviation/spec.md` に対する差分です。見出しの単位で置き換えます。

- `MODIFIED` の見出しは、current の同じ見出しの本文をこの本文で置き換える

## MODIFIED

### SPEC-NTA-RESOLVE-ABBREVIATION-003 管轄外のエントリには in_scope: false と、管轄の MCP への案内を返す

解決したエントリの `source_mcp_hint` が `houki-nta` でないとき（法律・政令・省令など）は、`resolved` にエントリを入れたうえで `in_scope: false` を付ける。エラーにはしない。`hint` と `next_actions` は、管轄の MCP サーバーが houki-hub family にあるかどうかで次のとおりにする。

| `source_mcp_hint` | `hint` | `next_actions` |
| --- | --- | --- |
| `houki-egov`（family にある） | `このエントリは houki-egov の管轄です。houki-egov-mcp で取得してください。` | `{ action: "delegate_to_mcp", reason: "houki-egov の管轄リソースです。該当 MCP に切り替えてください", example: { mcp: "houki-egov" } }` の 1 件。`nta_get_tsutatsu` の `OUT_OF_SCOPE`（SPEC-NTA-GET-TSUTATSU-002）と同じ形 |
| それ以外（family にまだ無い） | `このエントリは <source_mcp_hint> の管轄ですが、対応する MCP サーバーはまだありません。` | 付けない（切り替える先が無いため） |

`<source_mcp_hint>-mcp` の形で、まだ無い MCP サーバーの名前（`houki-court-mcp` など）を案内しない。houki-abbreviations 0.7.0 の辞書の `source_mcp_hint` は `houki-egov` と `houki-nta` の 2 つだけなので、2 行目は辞書に新しい管轄が足されたときの備えである。

例: `abbr: "消法"` の応答は `resolved.formal: "消費税法"`、`resolved.source_mcp_hint: "houki-egov"`、`in_scope: false`、`hint: "このエントリは houki-egov の管轄です。houki-egov-mcp で取得してください。"`、`next_actions: [{ action: "delegate_to_mcp", reason: "houki-egov の管轄リソースです。該当 MCP に切り替えてください", example: { mcp: "houki-egov" } }]`（v0.22.0 では `next_actions` が無かった）。`source_mcp_hint` が `houki-court` のエントリを返すときは、`hint` は `このエントリは houki-court の管轄ですが、対応する MCP サーバーはまだありません。` で、`next_actions` は無い。
