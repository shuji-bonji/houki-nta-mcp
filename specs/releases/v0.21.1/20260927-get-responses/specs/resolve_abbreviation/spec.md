# 差分: resolve_abbreviation（20260927-get-responses）

`specs/current/resolve_abbreviation/spec.md` に対する差分です。見出しの単位で置き換えます。

- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す

## ADDED

### SPEC-NTA-RESOLVE-ABBREVIATION-006 辞書の別名（`aliases`）でも同じエントリを返す

`abbr` が辞書のエントリの略称でも正式名称でもなく、そのエントリの `aliases` にある名前のときも、そのエントリを `resolved` に入れて返す（SPEC-NTA-RESOLVE-ABBREVIATION-001 と同じ形）。管轄の判定（SPEC-NTA-RESOLVE-ABBREVIATION-002・003）も同じように行う。

例: `abbr: "電帳法取扱通達"` は `resolved.abbr: "電帳法取通"`・`resolved.source_mcp_hint: "houki-nta"` のエントリに解決され、`in_scope: true`。`abbr: "消費税"` は `resolved.abbr: "消法"`・`resolved.formal: "消費税法"` のエントリに解決され、houki-egov の管轄なので `in_scope: false` と誘導の `hint` が付く。応答の `abbr` は渡した値のまま。
