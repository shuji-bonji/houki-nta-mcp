# 差分: search_rules（`freshness` の範囲から国税庁の索引から消えた文書を外す）

この差分は `specs/current/search_rules/spec.md` に対するものです。見出し単位で、置き換える（MODIFIED）を書きます。ID の無い節の変更は末尾の「ID の無い節の変更」に書きます。

## MODIFIED

### SPEC-NTA-SEARCH-RULES-017 `freshness` は DB の取得時点の範囲と段階を返し、古いときだけ `warning` を付ける。文書系 5 ツールでは国税庁の索引から消えた文書を範囲に入れない

検索系 6 ツールが応答に付ける `freshness` は、次のフィールドを持つオブジェクトである。

| フィールド | 内容 |
|---|---|
| `oldest_fetched_at` / `newest_fetched_at` | 判定した範囲で最も古い取得日時と最も新しい取得日時（ISO 8601） |
| `days_since_oldest` | 最も古い取得日時から呼び出した時点までの日数 |
| `staleness` | `days_since_oldest` が 7 日未満なら `fresh`、30 日未満なら `stale`、それ以上なら `outdated` |
| `warning` | `staleness` が `outdated` のときだけ付く。`一部ドキュメントが <日数> 日前のデータです。最新化するには <フラグ> を実行してください` |

判定する範囲と、`warning` に書くフラグは次のとおり。文書系 5 ツールの範囲は、どれも国税庁の索引にある文書だけである（下の箇条書き）。

| ツール | 範囲 | フラグ |
|---|---|---|
| `nta_search_tsutatsu` | DB にある通達の節すべて（通達ごとには分けない） | `` `--bulk-download-all` `` |
| `nta_search_qa` | 索引にある質疑応答事例。`topic` を渡したときはその税目 | `` `--bulk-download-qa` `` |
| `nta_search_tax_answer` | 索引にあるタックスアンサー全体 | `` `--bulk-download-tax-answer` `` |
| `nta_search_kaisei_tsutatsu` | 索引にある改正通達。`taxonomy` を渡したときはその税目 | `` `--bulk-download-kaisei` `` |
| `nta_search_jimu_unei` | 索引にある事務運営指針。`taxonomy` を渡したときはその税目 | `` `--bulk-download-jimu-unei` `` |
| `nta_search_bunshokaitou` | 索引にある文書回答事例。`taxonomy` を渡したときはその税目と別表記 | `` `--bulk-download-bunshokaitou` `` |

- 文書系 5 ツールは、国税庁の索引から消えたと bulk download が判定した文書（SPEC-NTA-SEARCH-RULES-011 の `orphaned_at` が付いた文書）を範囲に入れない。bulk download は索引から消えた文書を取り直さないので、その取得日時は投入をやり直しても新しくならない。範囲に入れると `staleness` が `fresh` に戻らず、`warning` が案内するフラグを実行しても直らない
- 範囲から外すのは `freshness` の計算だけである。検索結果からは除かない（SPEC-NTA-SEARCH-RULES-011）。各ツールの spec.md と SPEC-NTA-SEARCH-RULES-015 が `freshness` の範囲を「全体」「その税目」と書くときも、索引から消えた文書を除いた範囲を指す。0 件の応答（各ツールの spec.md の 0 件の項）でも同じ
- 索引にあるかどうかは、呼び出した時点の DB の印で決める。後の bulk download で索引に戻り、印が外れた文書は範囲に入る
- 索引にあるが取得に失敗して取得日時が古いままの文書は、範囲に入る（取り直せる文書なので、古いことを `staleness` で示す）
- `nta_search_tsutatsu` の範囲（通達の節）は索引から消えた印を持たないので、この規則は当てはまらない
- `freshness` のフィールドは変えない。範囲の中の索引から消えた文書の件数などは足さない。索引から消えた文書が検索結果に入ったときは、その要素の `index_status`・`orphaned_at` と `search_notes` の文（SPEC-NTA-SEARCH-RULES-011）で分かる

範囲に文書が 1 件も無いときは `freshness` を付けない。文書系 5 ツールでは、範囲に索引にある文書が 1 件も無いとき（その種別の文書がすべて索引から消えたとき、税目で絞った範囲の文書がすべて索引から消えたときを含む）も付けない。このときも検索は行い、索引から消えた文書が当たればそれを返す。0 件の応答で範囲がどう変わるかは、各ツールの spec.md に書く。

例 1: 取得日時が `2026-01-01T00:00:00Z` と `2026-09-25T00:00:00Z` の質疑応答事例（どちらも索引にある）がある DB で、2026-09-27 に `nta_search_qa` を呼ぶと、`oldest_fetched_at` は `2026-01-01T00:00:00Z`、`staleness` は `outdated` で、`warning` は「一部ドキュメントが 269 日前のデータです。最新化するには `--bulk-download-qa` を実行してください」になる。

例 2（タックスアンサー No.2882 の形、houki-nta-mcp #139）: タックスアンサーが次の 3 行の DB で `nta_search_tax_answer` を呼ぶ。

| `doc_id` | `fetched_at` | `orphaned_at` |
|---|---|---|
| `2882` | `2026-09-07T21:06:49.516Z` | `2026-10-04T02:11:37.431Z` |
| `1131` | `2026-10-04T03:00:00Z` | なし |
| `6101` | `2026-10-04T03:51:17.445Z` | なし |

| 呼んだ時点（UTC） | `oldest_fetched_at` | `newest_fetched_at` | `days_since_oldest` | `staleness` | `warning` |
|---|---|---|---|---|---|
| `2026-10-04T05:00:00Z` | `2026-10-04T03:00:00Z` | `2026-10-04T03:51:17.445Z` | 0 | `fresh` | 無し |
| `2026-10-08T00:00:00Z` | `2026-10-04T03:00:00Z` | `2026-10-04T03:51:17.445Z` | 3 | `fresh` | 無し |

v0.24.0 では、`oldest_fetched_at` が `2026-09-07T21:06:49.516Z` になり、`2026-10-04T05:00:00Z` では `days_since_oldest: 26`・`stale`、`2026-10-08T00:00:00Z` では `days_since_oldest: 30`・`outdated` と `--bulk-download-tax-answer` の `warning` だった。No.2882 がキーワードに当たれば、検索結果には今までどおり入り、その要素は `index_status: "removed_from_index"`・`orphaned_at: "2026-10-04T02:11:37.431Z"` を持つ。

例 3（ほかの 4 種別）: 種別ごとに、索引にある文書（取得日時 `2026-10-04T03:30:00Z`）と、索引から消えた文書（取得日時 `2026-09-01T00:00:00Z`、`orphaned_at` `2026-10-04T03:40:00Z`）が 1 件ずつ同じ税目 `shotoku` にある DB で、`2026-10-04T05:00:00Z` に呼ぶと、次のどれでも `oldest_fetched_at` と `newest_fetched_at` は `2026-10-04T03:30:00Z`、`staleness` は `fresh` になる（v0.24.0 では `oldest_fetched_at` が `2026-09-01T00:00:00Z`、`days_since_oldest: 33`、`outdated`）。

| ツール | 引数 |
|---|---|
| `nta_search_qa` | `topic` を省く / `topic: "shotoku"` |
| `nta_search_kaisei_tsutatsu` | `taxonomy` を省く / `taxonomy: "shotoku"` |
| `nta_search_jimu_unei` | `taxonomy` を省く / `taxonomy: "shotoku"` |
| `nta_search_bunshokaitou` | `taxonomy` を省く / `taxonomy: "shotoku"` |

例 4（範囲に索引にある文書が無い）: 改正通達が、税目 `hojin` の索引から消えた 1 件と、税目 `shohi` の索引にある 1 件だけの DB で、`nta_search_kaisei_tsutatsu` に `taxonomy: "hojin"` と `hojin` の文書に当たる `keyword` を渡すと、その文書を `index_status: "removed_from_index"` 付きで返し、`freshness` は付けない。`taxonomy` を省けば、範囲は `shohi` の 1 件で、`freshness` を付ける。

## ID の無い節の変更

- 冒頭の「関連する Issue」に `#139（freshness の範囲と索引から消えた文書）` を足す
- 冒頭の「起こした元」は変えない
