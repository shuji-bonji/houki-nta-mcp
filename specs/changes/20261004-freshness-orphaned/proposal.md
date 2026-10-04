# 変更: 検索の `freshness` の範囲から、国税庁の索引から消えた文書を外す（nta #139）

- 対象: `specs/current/search_rules/spec.md`（SPEC-NTA-SEARCH-RULES-017）
- 実装の変更: 要（下の「実装の変更」）
- 承認日: 2026-10-04（PR #140）
- 状態: 草案
- 起こした日: 2026-10-04（JST）
- 起こした役: Spec Steward
- 対象 Issue: houki-nta-mcp #139（検索ツールの `freshness` が、国税庁の索引から消えた文書の古い取得日時で止まり、投入をやり直しても `fresh` に戻らない）
- 決定の出典: houki-hub `docs/DECISIONS.md` の 2026-10-04 の行「期限や日付で害が増える不具合は、横断の判断（T6 など）と同じ版に入れず patch で先に出す」、`docs/notes/2026-10-04-plan-stage6-and-followups.md` の「段階 1b」・5.2・5.3・8.1、`docs/notes/2026-10-04-regression-check-egov-0.19.1-nta-0.24.0.md` の「見つかったこと」7
- 前提: main（`527322a`、v0.24.0。2026-10-04 JST に `git ls-remote https://github.com/shuji-bonji/houki-nta-mcp refs/heads/main` で origin の main と同じことを確かめた）から切った。`specs/changes/` にほかの差分は無い
- 版: 0.24.1（patch）。DB のスキーマの版は 12 のまま
- 期限: タックスアンサー No.2882 の行（`fetched_at` `2026-09-07T21:06:49.516Z`）は、2026-10-08 06:06:49 JST（2026-10-07T21:06:49.516Z、+00:00）に 30 日に達し、`nta_search_tax_answer` の `staleness` が `outdated` になる。0.24.1 の publish はそれより前を目指す

## なぜ変えるか

文書系 5 ツール（`nta_search_qa`・`nta_search_tax_answer`・`nta_search_kaisei_tsutatsu`・`nta_search_jimu_unei`・`nta_search_bunshokaitou`）の `freshness` は、その種別（税目で絞ったときはその税目）の文書すべての取得日時の範囲から決まる（SPEC-NTA-SEARCH-RULES-017）。bulk download は、国税庁の索引から消えた文書の行を消さずに `orphaned_at` を付けて残し（SPEC-NTA-SEARCH-RULES-011）、取り直さない。そのため、索引から消えた文書が 1 件でもあると、その行の古い取得日時が `oldest_fetched_at` になり、投入を何度やり直しても `fresh` に戻らない。30 日を過ぎると `outdated` になり、`warning` は「最新化するには `--bulk-download-tax-answer` を実行してください」と案内するが、実行しても直らない。

2026-10-04 JST の契約の確認で、`--bulk-download-everything` の直後の `nta_search_tax_answer` が `stale`（26 日）のままで、原因が No.2882 の 1 行だったことを確かめた（下の「確かめた値」）。

## 今の動き（v0.24.0）

- `freshness` は `src/services/freshness.ts` の `summarizeFreshnessFromDocument` が、`SELECT MIN(fetched_at), MAX(fetched_at), COUNT(*) FROM document WHERE doc_type = ?`（税目で絞るときは `AND taxonomy IN (…)`）で範囲を決める。`orphaned_at` を見ない
- 文書系 5 ツールのヒットしたときの応答と、0 件の応答（`explainDocZeroHits` の税目の一覧・`hasPdf`・該当なしの 3 つ）は、どれもこの関数を通る
- 索引から消えた文書は、索引の URL 集合に無く、その回の投入で `fetched_at` が更新されなかった行として `markOrphanedDocuments`（`src/services/index-status.ts`）が印を付ける。5 種別の bulk download がすべて呼ぶ（`qa-bulk-downloader.ts`・`tax-answer-bulk-downloader.ts`・`jimu-unei-bulk-downloader.ts`・`bunshokaitou-bulk-downloader.ts`、改正通達は `cli.ts`）
- `nta_search_tsutatsu` は `section` テーブルから範囲を決める（`summarizeFreshnessFromSection`）。`section` には `orphaned_at` の列が無い

## 変えた後の動き

1. **文書系 5 ツールの `freshness` は、索引にある文書（`orphaned_at` が無い行）だけで範囲を決める（017）。** `oldest_fetched_at`・`newest_fetched_at`・`days_since_oldest`・`staleness`・`warning` のすべてが、この範囲から決まる。税目で絞る範囲（`topic`・`taxonomy`、文書回答事例の別表記）はそのまま
2. **範囲に索引にある文書が 1 件も無いときは `freshness` を付けない（017）。** 今の「範囲に文書が 1 件も無いときは付けない」と同じ扱いにする。検索は今までどおり行い、索引から消えた文書が当たれば返す
3. **検索結果は変えない。** 索引から消えた文書も結果に入り、要素の `index_status`・`orphaned_at` と `search_notes` の文（011）は今までどおり付く
4. **0 件の応答も同じ範囲で判定する。** 各ツールの spec.md の 0 件の項の範囲（「全体」「その税目」）は、索引から消えた文書を除いた範囲を指す（017 の箇条書きで定める）
5. **`nta_search_tsutatsu` は変えない。** 通達の節は索引から消えた印を持たない

## 変わる仕様 ID

| 種類     | 仕様 ID                   |
| -------- | ------------------------- |
| ADDED    | なし                      |
| MODIFIED | SPEC-NTA-SEARCH-RULES-017 |
| REMOVED  | なし                      |

ADDED 0、MODIFIED 1、REMOVED 0。触る dir は `search_rules` だけ。新しい ID は取っていない。017 は題も変える（「文書系 5 ツールでは国税庁の索引から消えた文書を範囲に入れない」を足す。人が判断すること 7）。

Issue の「決めること」との対応:

| Issue の決めること                         | この差分の答え                                                                                          | 仕様 ID           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ----------------- |
| 1 `orphaned_at` の付いた行を範囲から外すか | 案 A（外す。索引にある文書だけで判定する）                                                              | 017               |
| 2 索引にある文書が 1 件も無い範囲          | `freshness` を付けない（017 の「範囲に文書が 1 件も無いときは付けない」と同じ）                         | 017               |
| 3 `freshness` にフィールドを足すか         | 足さない（要素の `index_status`・`orphaned_at` と `search_notes` で分かる）。足す案は人が判断すること 3 | 017               |
| 4 版                                       | 0.24.1（patch）。フィールドは変えず、値の計算だけが変わる                                               | —（仕様 ID なし） |

各種別への効き方（017 の例 2・3・4）:

| 種別             | ツール                       | 範囲を絞る引数             | 例                     |
| ---------------- | ---------------------------- | -------------------------- | ---------------------- |
| タックスアンサー | `nta_search_tax_answer`      | なし（全体）               | 例 2（No.2882 の形）   |
| 質疑応答事例     | `nta_search_qa`              | `topic`                    | 例 3                   |
| 改正通達         | `nta_search_kaisei_tsutatsu` | `taxonomy`                 | 例 3・例 4             |
| 事務運営指針     | `nta_search_jimu_unei`       | `taxonomy`                 | 例 3                   |
| 文書回答事例     | `nta_search_bunshokaitou`    | `taxonomy`（別表記を含む） | 例 3                   |
| 基本通達         | `nta_search_tsutatsu`        | —                          | 対象外（印を持たない） |

## 変わらない振る舞い

- 応答のフィールドの名前と形。`freshness` のキー（`oldest_fetched_at`・`newest_fetched_at`・`staleness`・`days_since_oldest`・`warning`）、段階の境界（7 日・30 日）、`warning` の文とフラグ
- 検索結果に入る文書・順・`score`・`snippet`・`search_notes`（索引から消えた件数の文を含む）・`index_status`・`orphaned_at`（011・015）
- `DOC_NOT_FOUND` の判定（SPEC-NTA-SEARCH-\*-001 など）。「その種別の文書が DB に 1 件も無い」は、索引から消えた文書も数える。すべてが索引から消えていても、エラーにはならない
- 0 件の応答の `hint` の件数（`DB の…<N> 件のうち…`）。索引から消えた文書も数える
- 取得系（`nta_get_*`・`nta_inspect_pdf_meta`）の応答。取得系の `freshness` は 1 文書の取得日時から決まる（`freshnessForFetchedAt`）
- `nta_search_tsutatsu` の `freshness`（`section` テーブル）
- bulk download の印の付け方（`markOrphanedDocuments`）、DB のスキーマ（版 12）、行を消さないこと
- 索引にあるが取得に失敗して取得日時が古いままの文書は、今までどおり範囲に入る
- 範囲に索引にある文書が 1 件でもあり、索引から消えた文書が 1 件も無い DB では、値は 0.24.0 と同じ

## 互換性（0.24.1 の CHANGELOG の「互換性」の節に書くもの）

| 場面                                                               | 0.24.0                                                                                                                              | 0.24.1                                                                                                         |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 範囲に索引から消えた文書があり、その取得日時が範囲の中で最も古い   | その日時が `oldest_fetched_at` になり、`staleness` が投入をやり直しても `fresh` に戻らない。30 日を過ぎると `outdated` と `warning` | 索引にある文書の最も古い取得日時が `oldest_fetched_at` になる。投入をやり直せば `fresh` に戻る                 |
| 範囲に索引から消えた文書があり、その取得日時が範囲の中で最も新しい | その日時が `newest_fetched_at`                                                                                                      | 索引にある文書の最も新しい取得日時が `newest_fetched_at`（実際には起きにくい。消えた文書は取り直されないため） |
| 範囲の文書がすべて索引から消えている                               | `freshness` が付く                                                                                                                  | `freshness` が付かない                                                                                         |
| 索引から消えた文書が無い                                           | —                                                                                                                                   | 変わらない                                                                                                     |
| `nta_search_tsutatsu`                                              | —                                                                                                                                   | 変わらない                                                                                                     |

CHANGELOG と README に書く案内の文（案）:

> 0.24.1 から、検索ツールの `freshness` は国税庁の索引にある文書だけで判定します。索引から消えた文書（`index_status: "removed_from_index"`）は取り直されないため、0.24.0 までは、その古い取得日時のせいで投入をやり直しても `stale` や `outdated` のままになることがありました。DB を作り直す必要はありません。

## 実装 PR で直す文書

動きを変えない行で、仕様 ID を作らないもの。

| #   | 場所                                                                         | 直すこと                                                                                                                                                                                     |
| --- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | CHANGELOG 0.24.1                                                             | `Fixed` に #139。上の「互換性」の表と案内の文                                                                                                                                                |
| 2   | README「国税庁の索引から消えた文書（v0.17.0 / Issue #30）」の節              | 表の後に「検索の `freshness` は索引にある文書だけで判定します（0.24.1）」の 1 文を足す                                                                                                       |
| 3   | `llms.txt`「索引から消えた文書 (v0.17.0 / Issue #30)」                       | 同じ 1 文を足す                                                                                                                                                                              |
| 4   | `src/services/freshness.ts` の `summarizeFreshnessFromDocument` の JSDoc     | 範囲が索引にある文書だけであること、理由（取り直されない）、印が付いた行しか無いときは `null` を返すことを書く                                                                               |
| 5   | `docs/RESILIENCE.md` 6.2                                                     | 範囲が索引にある文書だけであることを 1 文で足す（任意。設計文書なので、直さないなら実装 PR の本文にそう書く）                                                                                |
| 6   | houki-hub `scripts/reference-examples/houki-nta/ja/nta_search_tax_answer.md` | 3 行目の「`staleness` は `stale`。理由は下」と 60 行目の段落（No.2882 の説明）を、0.24.1 で取り直した値に直す。houki-hub のブランチで行い、計画書 9 章に main に入ったかを書く（計画書 5.4） |

tools/list の `description` と `--help` の文は変えない。

## 実装の変更

- `summarizeFreshnessFromDocument`（`src/services/freshness.ts`）の SQL に `AND orphaned_at IS NULL` を足す。`COUNT(*)` もこの条件で数えるので、索引にある行が 0 件なら今の分岐（`row.cnt === 0`）で `null` を返し、呼び出し側は `freshness` を付けない
- 呼び出し側（`src/tools/handlers.ts` の 5 ツールのヒットしたときと、`explainDocZeroHits` の `fresh()`）は変えない
- `summarizeFreshnessFromSection` は変えない
- 索引 `idx_document_taxonomy (doc_type, taxonomy)` はそのまま使える。`orphaned_at` の索引は足さない（スキーマの版を上げない）

## publish の前の確認

計画書 5.2 のとおり、0.24.1 は応答のフィールドを変えないので、47 例すべてではなく、`freshness` を載せた検索 6 ツールの例だけを流す。shuji の Mac で行う。

1. 受入テスト（017 の例 2・3・4 を 5 種別で）が `npm test` で通り、`npx spec-ids check` が通る
2. shuji の DB で、0.24.1 で返るはずの値を SQL で出しておく（MCP サーバーと CLI を止めなくてよい。読むだけ）
   - `SELECT doc_type, MIN(fetched_at), MAX(fetched_at), COUNT(*) FROM document WHERE orphaned_at IS NULL GROUP BY doc_type;`
   - `SELECT doc_type, COUNT(*), MIN(fetched_at) FROM document WHERE orphaned_at IS NOT NULL GROUP BY doc_type;`（索引から消えた行の数と最も古い取得日時。種別ごと）
3. 作業コピーで `npm run build` し、手元のビルドを指す MCP（Claude Desktop の houki-nta-dev）と、0.24.0 の plugin で、houki-hub `scripts/reference-examples/houki-nta/ja/nta_search_*.md` の 6 ファイルの例を同じ引数で 1 回ずつ呼ぶ（`nta_search_tsutatsu.md` の「DB が古いとき」は今までどおり流さない）。同じ DB に向ける
4. 例ごとに 0.24.0 と 0.24.1 の応答を比べ、`freshness` 以外（`results` の件数・`docId`・順・`score`・`snippet`・`index_status`・`orphaned_at`、`search_notes`、`legal_status`、`next_actions`、0 件の `hint`）が同じことを確かめる。`score` は同じ DB なので同じ値になるはず
5. `freshness` は、`nta_search_tax_answer` だけが変わり（`oldest_fetched_at` が 2 の 1 つ目の SQL の `tax-answer` の最小値、`staleness` が `fresh`）、ほかの 5 ファイルは同じことを確かめる（2026-10-04 JST の DB では、ほかの 4 種別に 2026-10-04 より前の取得日時の行が無い。下の「確かめた値」）。2 の 2 つ目の SQL で 4 種別に索引から消えた行があり、その取得日時が最も古いときは、その種別も変わる。そのときは値を実装 PR の本文に書く
6. 結果（日時・SQL の結果・比べた例の数）を実装 PR の本文に書く。呼び出し例の差し替えは publish の後に houki-hub で行う（「実装 PR で直す文書」6）

## 取り込みのとき（Publisher）

- `specs/current/search_rules/spec.md` の SPEC-NTA-SEARCH-RULES-017 を、見出しの行（題）も含めて差分の見出しと本文に置き換える
- 差分の spec.md の「ID の無い節の変更」を行う（「関連する Issue」に #139）
- `specs/current/search_rules/spec.md` の承認日の行に「差分 `20261004-freshness-orphaned` は YYYY-MM-DD（PR #N）」を足す
- この差分のフォルダーを `specs/releases/v0.24.1/20261004-freshness-orphaned/` へ移し（`git mv`）、この proposal.md の「状態」を取り込み済みにする
- `Closes #139` は実装 PR の本文に書く
- 計画書 9 章の段階 1b の行に「済（日付・PR 番号・コミット）」を書く

## 人が判断すること

1. **直し方は案 A（017）。** `orphaned_at` の付いた行を `freshness` の範囲から外す。案 B（外さず、`warning` の文で索引から消えた文書があることを書く）は、`staleness` が `fresh` に戻らないことと、30 日を過ぎた `outdated` が残る。案 C（今のまま）は、2026-10-08 06:06 JST から `nta_search_tax_answer` が `outdated` と、実行しても直らない `warning` を返し続ける。**勧める: A**
2. **範囲に索引にある文書が 1 件も無いときは `freshness` を付けない（017）。** 代わりの案は (B) 索引から消えた文書だけで判定する（その範囲では止まった値が戻ってくる）、(C) `staleness` を付けずに日時だけ返す（形が変わる）。範囲の文書がすべて索引から消えた状態は、投入で `fresh` にできないので、鮮度を示す値が無いのが事実に合う。**勧める: 付けない**
3. **`freshness` にフィールドを足さない。** 足す案: (a) `orphaned_count`（範囲の中の索引から消えた文書の数）、(b) `orphaned_oldest_fetched_at`（それらの最も古い取得日時）、(c) `scope_note`（「索引にある文書だけで判定」の文）。どれも T4 の「足すだけ」に当たり壊さないが、patch では足さず、必要なら T6 の版（nta 0.25.0、`freshness.db_path` を足す）でまとめて決める。検索結果に入った文書は要素の `index_status`・`orphaned_at` と `search_notes` で分かる。**勧める: 足さない**
4. **版は 0.24.1（patch）。** フィールドは変えず、値の計算だけが変わる。スキーマの版も上げない。**勧める: 0.24.1**
5. **各ツールの spec.md の `freshness` の行は MODIFIED しない。** `nta_search_qa`（005・007）、`nta_search_tax_answer`（002・003）、`nta_search_kaisei_tsutatsu`（002・003・004）、`nta_search_jimu_unei`（002・003・005・006）、`nta_search_bunshokaitou`（006）と SPEC-NTA-SEARCH-RULES-015 は、範囲を「全体」「その税目」と書き、形は 017 によると書いている。017 の箇条書きで「これらの範囲は索引から消えた文書を除いた範囲を指す」と定めた。代わりの案は、これら 13 見出し（015 を含む）をそれぞれ MODIFIED して「索引にある」を足す（文の食い違いは無くなるが、差分が 13 見出し増え、期限までの承認と取り込みが重くなる）。**勧める: 017 だけ。各ツールの spec.md の文は、次に各ツールの差分を出すときに揃える**
6. **「移動」とみなした行は範囲に残る。この差分では扱わない。** `markOrphanedDocuments` は、索引に無く、その回に触られなかった行でも、題名が索引にある行と同じなら「移動」とみなして印を付けない（`movedSkipped`）。その行は取り直されず、印も無いので、案 A の後も古い取得日時で範囲に残る。質疑応答事例など題名が重なりうる種別では、索引から消えた文書でも題名が同じ別の文書があれば同じことが起きる。shuji の DB に該当する行があるかは確かめていない（「確かめていない点」）。2026-10-04 JST の DB では、タックスアンサー以外の 4 種別の `oldest_fetched_at` が 2026-10-04 だったので、少なくとも今その形の行が範囲の最も古い値にはなっていない。**勧める: 0.24.1 では扱わず、publish の前の確認の 2 で件数を見て、あれば Issue にする**
7. **017 の題を変える。** 「文書系 5 ツールでは国税庁の索引から消えた文書を範囲に入れない」を題に足す。サイトの仕様書ページ（houki-hub#27）で題だけを見ても分かるようにするため。**勧める: 変える**
8. **`warning` の文とフラグは変えない。** 案 A の後は、`outdated` のときに案内するフラグの実行で直る。**勧める: 変えない**
9. **承認日。** この proposal.md の「- 承認日:」に日付と PR 番号を書く（shuji がマージの前に）

## 確かめた値

| 何を                                                        | 結果                                                                                                                                                                                                                                                                                                                                                                                                                           | いつ・どうやって                                                                                                                                                                                                                                                                                                           | 使った仕様 ID                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 投入をやり直した後の `nta_search_tax_answer` の `freshness` | `oldest_fetched_at` `2026-09-07T21:06:49.516Z`、`newest_fetched_at` `2026-10-04T03:51:17.445Z`、`staleness` `stale`、`days_since_oldest` 26                                                                                                                                                                                                                                                                                    | 2026-10-04 13:30 頃 JST、shuji が `npx -y @shuji-bonji/houki-nta-mcp@latest --bulk-download-everything`（0.24.0）を実行した後、Claude Desktop の plugin（0.24.0）で呼んだ（houki-hub `docs/notes/2026-10-04-regression-check-egov-0.19.1-nta-0.24.0.md` の「ローカル DB の状態」と「見つかったこと」7、Issue #139 の本文） | 017 の例 2                                 |
| `fetched_at` が 2026-10-01 より前のタックスアンサーの行     | 1 行だけ: `2882` / `2026-09-07T21:06:49.516Z` / `orphaned_at` `2026-10-04T02:11:37.431Z` / `https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2882.htm`                                                                                                                                                                                                                                                                   | 2026-10-04 JST、shuji が Mac の `~/.cache/houki-nta-mcp/cache.db` で `SELECT doc_id, fetched_at, orphaned_at, source_url FROM document WHERE doc_type = 'tax-answer' AND fetched_at < '2026-10-01';`（Issue #139 の本文）                                                                                                  | 017 の例 2                                 |
| 同じ DB の 5 種別の `freshness`（この差分を書いた時点）     | タックスアンサー: `2026-09-07T21:06:49.516Z` / `2026-10-04T03:51:17.445Z`・`stale`・26。質疑応答事例: `2026-10-04T03:51:26.746Z` / `2026-10-04T04:26:15.744Z`・`fresh`・0。改正通達: `2026-10-04T03:24:14.576Z` / `2026-10-04T03:26:38.132Z`・`fresh`・0。事務運営指針: `2026-10-04T03:26:38.243Z` / `2026-10-04T03:27:13.440Z`・`fresh`・0。文書回答事例: `2026-10-04T03:27:23.963Z` / `2026-10-04T03:37:07.872Z`・`fresh`・0 | 2026-10-04 14:50 頃 JST、Cowork から Claude Desktop の plugin（0.24.0）の検索 5 ツールを `limit: 1` で呼んだ（キーワードは `源泉徴収`・`源泉徴収`・`消費税法`・`書面添付`・`給付金`。`topic`・`taxonomy` は省いた）                                                                                                        | publish の前の確認の 5、人が判断すること 6 |
| 上から言えること                                            | 0.24.1 で今の shuji の DB の値が変わるのはタックスアンサーだけ。ほかの 4 種別には、2026-10-04 より前の取得日時の行（索引から消えた行・移動とみなした行を含む）が無い                                                                                                                                                                                                                                                           | 上の 2 行から                                                                                                                                                                                                                                                                                                              | publish の前の確認の 5                     |
| `outdated` になる時刻                                       | 2026-10-07T21:06:49.516Z（+00:00）＝ 2026-10-08 06:06:49 JST。`days_since_oldest` は `Math.floor(経過ミリ秒 / 1 日)`、`outdated` は 30 日以上                                                                                                                                                                                                                                                                                  | `node_modules/@shuji-bonji/houki-abbreviations/dist/freshness.js` の `computeDaysSince`・`STALENESS_THRESHOLDS`（`fresh_days: 7`・`stale_days: 30`）を読み、計算した                                                                                                                                                       | 期限、017 の例 2                           |
| 範囲を決める SQL と呼び出し箇所                             | `summarizeFreshnessFromDocument` の SQL は `doc_type` と `taxonomy` だけで絞る。呼び出しは `handlers.ts` の 5 ツールのヒットしたときと `explainDocZeroHits` の `fresh()`。`nta_search_tsutatsu` は `summarizeFreshnessFromSection`                                                                                                                                                                                             | main `527322a` の `src/services/freshness.ts`・`src/tools/handlers.ts` を読んだ                                                                                                                                                                                                                                            | 017、実装の変更                            |
| 印を持つ種別                                                | `document.orphaned_at`（スキーマ版 7 から）を 5 種別の bulk download が `markAndCount` で付ける。`section`・`clause`・`tsutatsu` に `orphaned_at` の列は無い                                                                                                                                                                                                                                                                   | main `527322a` の `src/db/schema.ts`・`src/services/index-status.ts` と `markAndCount` の呼び出し箇所を grep した                                                                                                                                                                                                          | 017（`nta_search_tsutatsu` は対象外）      |
| 「移動」とみなした行の扱い                                  | 索引に無く、その回に触られず、題名が索引にある行と同じ行は、印を付けない（`movedSkipped`）。行も消さない                                                                                                                                                                                                                                                                                                                       | main `527322a` の `src/services/index-status.ts` の `markOrphanedDocuments` を読んだ。`DELETE FROM document` は src に無い（grep）                                                                                                                                                                                         | 人が判断すること 6                         |
| 既存のテストへの影響                                        | `freshness` の値を確かめる既存のテストで、索引から消えた行が範囲の最も古い・新しい値になる DB を使うものは見当たらない（索引から消えた行を作るテストは、取得日時をほかの行と同じにしている）                                                                                                                                                                                                                                   | `src/**/*.test.ts` を `orphaned_at`・`oldest_fetched_at` で grep し、`spec-20260927-search-hit-responses.test.ts`・`spec-20261003-t4-response-shape.test.ts` を読んだ。テストは流していない                                                                                                                                | 実装 PR                                    |
| `npx spec-ids check`                                        | `current: 21 files, 258 IDs / changes: 1 files, 1 IDs`、`tests: 61 files, 258 IDs`、`OK`（exit 0）                                                                                                                                                                                                                                                                                                                             | 2026-10-04 JST、このブランチで実行（spec-ids 0.2.0）                                                                                                                                                                                                                                                                       | —                                          |

## 確かめていない点

- 0.24.1 での shuji の DB の `nta_search_tax_answer` の `oldest_fetched_at` の実際の値（索引にあるタックスアンサーの最も古い取得日時）。2026-10-04 の投入の時刻から `2026-10-04T03` 台と見込むが、publish の前の確認の 2 で SQL を流すまで分からない
- shuji の DB で、4 種別（質疑応答事例・改正通達・事務運営指針・文書回答事例）に索引から消えた行がそもそもあるか、その数。上の「確かめた値」から言えるのは、2026-10-04 より前の取得日時の行が無いことだけ
- 「移動」とみなされて印の無い、取り直されない行の数（人が判断すること 6）。数える SQL は、最後の投入の開始時刻を `<T>` として `SELECT doc_type, COUNT(*) FROM document WHERE orphaned_at IS NULL AND fetched_at < '<T>' GROUP BY doc_type;`（取得に失敗した行も含む）
- 取得系ツール（`nta_get_qa` など）が国税庁サイトから取って DB に書き戻すとき、印の付いた行の `orphaned_at` を外すか。外さない場合、書き戻しで新しくなった取得日時は範囲に入らない（`newest_fetched_at` に効かない）。今回の不具合には関係しない
- No.2882 が後の投入で索引に戻るか（戻れば印が外れ、取り直されて範囲に入る。017 の 3 つ目の箇条書き）
- 受入テスト・既存のテストを流していない（Steward はテストを書かない。VM で流す準備もしていない）

## この差分の外で見つけたこと

- 「移動」とみなした行が取り直されず古い取得日時で残る（人が判断すること 6）。範囲の外の問題として、件数を確かめてから Issue にするかを決める
