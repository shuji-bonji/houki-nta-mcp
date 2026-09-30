# 差分: search_rules（20261001-t1-argument-guards）

`specs/current/search_rules/spec.md` に対する差分です。見出しの単位で置き換えます。

- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す
- この ID は今の動きを意図として書くもので、実装の変更は不要（3 ツールの `taxonomy` の説明文に同じことを足すだけ）

## ADDED

### SPEC-NTA-SEARCH-RULES-018 `taxonomy` は列挙で検査せず、DB に無い値のときは `available_taxonomies` で正しい値を返す

`nta_search_bunshokaitou` / `nta_search_jimu_unei` / `nta_search_kaisei_tsutatsu` の `taxonomy` は、tools/list の inputSchema に `enum` を書かず、どの文字列でも受け付ける。税目フォルダは国税庁サイトの構成で増えるので、一覧を inputSchema に固定しない。DB のその種別の文書にその値の税目が無いときは、エラーにせず `results: []` と、DB にある税目の一覧 `available_taxonomies` を返す（SPEC-NTA-SEARCH-BUNSHOKAITOU-002、SPEC-NTA-SEARCH-KAISEI-TSUTATSU-002、SPEC-NTA-SEARCH-JIMU-UNEI-005）。3 ツールの inputSchema の `taxonomy` の `description` には、例の値に加えて「DB に無い値のときは `available_taxonomies` で正しい値を返す」と書く。

例: tools/list の `nta_search_kaisei_tsutatsu` の inputSchema の `properties.taxonomy` に `enum` は無く、`description` に `available_taxonomies` の語が入る。`{ keyword: "改正", taxonomy: "bogus" }` は `INVALID_ARGUMENT` ではなく、`results: []` と `available_taxonomies` の応答になる。
