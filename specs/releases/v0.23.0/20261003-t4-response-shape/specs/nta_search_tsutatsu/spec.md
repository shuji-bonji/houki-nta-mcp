# 差分: nta_search_tsutatsu（20261003-t4-response-shape）

`specs/current/nta_search_tsutatsu/spec.md` に対する差分です。見出しの単位で置き換えます。

- `MODIFIED` の見出しは、current の同じ見出しの本文をこの本文で置き換える

## MODIFIED

### SPEC-NTA-SEARCH-TSUTATSU-005 キーワードに合う条項が無いときはエラーにせず、`count: 0` と `freshness`・`legal_status` を返す

DB に条項はあるがキーワードに合うものが無いときは、エラーにせず次を返す。

- `keyword`: 渡されたキーワード（前後の空白を除いたもの。SPEC-NTA-SEARCH-TSUTATSU-004 と同じ）
- `count`: `0`
- `hits`: `[]`
- `message`: `"<keyword>" にマッチする clause はありません`
- `freshness`: SPEC-NTA-SEARCH-TSUTATSU-004 と同じ範囲（DB にある通達の節すべて）で判定したもの
- `legal_status`: SPEC-NTA-SEARCH-TSUTATSU-010 と同じもの
- `search_notes`: 注記があるときだけ（SPEC-NTA-SEARCH-TSUTATSU-006・008）

`base_laws_by_tsutatsu` と `next_actions` は付けない（`hits` に現れた通達から作るもので、`hits` が空なら作れない。SPEC-NTA-SEARCH-TSUTATSU-009）。

例: 条項が 1 件以上ある DB で `{ keyword: "存在しない語句" }` を渡すと、`count: 0`、`hits: []`、`message` は `"存在しない語句" にマッチする clause はありません`、`freshness.staleness` と `legal_status.binds_tax_office: true` を持つ（v0.22.0 では `count`・`freshness`・`legal_status` が無かった）。

### SPEC-NTA-SEARCH-TSUTATSU-010 `legal_status` は、ヒットの有無によらず付ける

DB に条項があり検索をしたときは、キーワードに合う条項があるとき（SPEC-NTA-SEARCH-TSUTATSU-004）も無いとき（SPEC-NTA-SEARCH-TSUTATSU-005）も、応答に `legal_status`（`binds_citizens: false` / `binds_courts: false` / `binds_tax_office: true` と、通達は行政内部文書で納税者・裁判所を直接は拘束しないが税務署員は職務として守る旨の `note`）を付ける。文書系 5 ツールが 0 件のときも `legal_status` を付けるのと同じにする。エラー（SPEC-NTA-SEARCH-TSUTATSU-001〜003）には付けない。

例: `{ keyword: "役員" }` で 1 件当たったときも、`{ keyword: "存在しない語句" }` で 0 件のときも、`legal_status.binds_tax_office` は `true`（v0.22.0 では 0 件のときに `legal_status` が無かった）。
