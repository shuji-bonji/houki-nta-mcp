# 差分: nta_search_jimu_unei（legal_status.note を nta_get_jimu_unei と同じ文にする）

この差分は `specs/current/nta_search_jimu_unei/spec.md` に対するものです。

## MODIFIED

### SPEC-NTA-SEARCH-JIMU-UNEI-002 事務運営指針はあるがキーワードに合わないときは成功で「該当なし」を返す

DB に事務運営指針が 1 件以上あり、キーワードに合う文書が無いときは、エラーにせず次の応答を返す。

| フィールド     | 内容                                                                                                                                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `results`      | `[]`                                                                                                                                                                                                                                                         |
| `keyword`      | 渡された `keyword`                                                                                                                                                                                                                                           |
| `hint`         | `該当なし。DB の事務運営指針 <件数> 件に「<keyword>」に合う文書はありません。別のキーワードで試してください`。`taxonomy` や `hasPdf` を渡していたときは、件数の前に `（taxonomy="shotoku"、hasPdf=true）` のように条件を書き、件数はその条件で絞った数になる |
| `freshness`    | DB に入れた日時の範囲（`oldest_fetched_at` / `newest_fetched_at` / `staleness` / `days_since_oldest`。古いときは `warning`）。`taxonomy` を渡していたときはその税目の範囲                                                                                    |
| `search_notes` | 短い語を補った・外したなどの注記があるときだけ付く                                                                                                                                                                                                           |
| `legal_status` | `binds_citizens: false` / `binds_courts: false` / `binds_tax_office: true` と、`note: "通達・事務運営指針は行政内部文書であり、納税者・裁判所には直接的拘束力なし。ただし税務署員は職務として守る義務あり（最高裁 昭和43.12.24）"`。`nta_get_jimu_unei` の json の `legal_status`（SPEC-NTA-GET-JIMU-UNEI-005）と同じ値 |

例: 事務運営指針が 1 件だけ入っている DB を `keyword: "滞納処分"` で検索すると、`code` は無く、`hint` は `該当なし。DB の事務運営指針 1 件に「滞納処分」に合う文書はありません。別のキーワードで試してください` になり、`legal_status.note` は `通達・事務運営指針は行政内部文書であり、` で始まる（v0.23.0 では `通達は行政内部文書。` で始まる、基本通達・改正通達と同じ文だった）。キーワードに合う文書があるとき（SPEC-NTA-SEARCH-JIMU-UNEI-003）の `legal_status` も同じ値。
