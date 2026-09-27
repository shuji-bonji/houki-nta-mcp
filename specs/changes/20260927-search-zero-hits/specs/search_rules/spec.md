# 差分: search_rules（20260927-search-zero-hits）

`specs/current/search_rules/spec.md` に対する差分です。見出しの単位で置き換えます。

- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す

## ADDED

### SPEC-NTA-SEARCH-RULES-017 `freshness` は DB の取得時点の範囲と段階を返し、古いときだけ `warning` を付ける

検索系 6 ツールが応答に付ける `freshness` は、次のフィールドを持つオブジェクトである。

| フィールド | 内容 |
|---|---|
| `oldest_fetched_at` / `newest_fetched_at` | 判定した範囲で最も古い取得日時と最も新しい取得日時（ISO 8601） |
| `days_since_oldest` | 最も古い取得日時から呼び出した時点までの日数 |
| `staleness` | `days_since_oldest` が 7 日未満なら `fresh`、30 日未満なら `stale`、それ以上なら `outdated` |
| `warning` | `staleness` が `outdated` のときだけ付く。`一部ドキュメントが <日数> 日前のデータです。最新化するには <フラグ> を実行してください` |

判定する範囲と、`warning` に書くフラグは次のとおり。

| ツール | 範囲 | フラグ |
|---|---|---|
| `nta_search_tsutatsu` | DB にある通達の節すべて（通達ごとには分けない） | `` `--bulk-download-all` `` |
| `nta_search_qa` | 質疑応答事例。`topic` を渡したときはその税目 | `` `--bulk-download-qa` `` |
| `nta_search_tax_answer` | タックスアンサー全体 | `` `--bulk-download-tax-answer` `` |
| `nta_search_kaisei_tsutatsu` | 改正通達。`taxonomy` を渡したときはその税目 | `` `--bulk-download-kaisei` `` |
| `nta_search_jimu_unei` | 事務運営指針。`taxonomy` を渡したときはその税目 | `` `--bulk-download-jimu-unei` `` |
| `nta_search_bunshokaitou` | 文書回答事例。`taxonomy` を渡したときはその税目と別表記 | `` `--bulk-download-bunshokaitou` `` |

範囲に文書が 1 件も無いときは `freshness` を付けない。0 件の応答で範囲がどう変わるかは、各ツールの spec.md に書く。

例: 取得日時が `2026-01-01T00:00:00Z` と `2026-09-25T00:00:00Z` の質疑応答事例がある DB で、2026-09-27 に `nta_search_qa` を呼ぶと、`oldest_fetched_at` は `2026-01-01T00:00:00Z`、`staleness` は `outdated` で、`warning` は「一部ドキュメントが 269 日前のデータです。最新化するには `--bulk-download-qa` を実行してください」になる。
