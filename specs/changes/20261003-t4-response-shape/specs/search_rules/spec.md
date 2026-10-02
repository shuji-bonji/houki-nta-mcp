# 差分: search_rules（20261003-t4-response-shape）

`specs/current/search_rules/spec.md` に対する差分です。見出しの単位で置き換えます。

- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す
- `MODIFIED` の見出しは、current の同じ見出しの本文をこの本文で置き換える

## ADDED

### SPEC-NTA-SEARCH-RULES-020 `nta_search_tsutatsu` の `hits`・`message` と、文書系 5 ツールの `results`・`hint` の名前は、今のまま別にする

`nta_search_tsutatsu` はヒットの配列を `hits`、0 件のときの説明を `message` で返し、文書系 5 ツール（SPEC-NTA-SEARCH-RULES-015）はヒットの配列を `results`、0 件のときの説明を `hint` で返す。この名前の違いは意図であり、どちらかに付け替えない。

- 付け替えると、今の名前のフィールドを消すことになる（houki-hub の計画書 5.1「フィールドを消す変更は入れない」に反する）
- 片方の名前を足して両方を返すと、同じ値が 2 つのフィールドに入り、どちらを読むかが利用者によって分かれる

`nta_search_tsutatsu` のヒットは通達の条項（`tsutatsu`・`clauseNumber` を持つ）で、文書系のヒットは文書（`docType`・`docId` を持つ）であり、要素の形も違う。名前を揃えるときは、別の版で、CHANGELOG の「互換性」の節と minor の公開を伴う差分にする。

例: `nta_search_tsutatsu` に `{ keyword: "役員" }` を渡すと配列は `hits`、`nta_search_qa` に `{ keyword: "源泉徴収" }` を渡すと配列は `results`。どちらの応答にも、もう一方の名前のフィールドは無い。

## MODIFIED

### SPEC-NTA-SEARCH-RULES-011 国税庁の索引から消えた文書は除外せず、印と件数の文を付ける

文書系 5 ツールは、国税庁の索引から消えたと bulk download が判定した文書も検索結果から除かずに返す。過去の課税期間の判断では意味を持つことがあるためである。

- その要素の `index_status` を `"removed_from_index"`、`orphaned_at` を索引から消えたことを最初に確認した日時にする。索引にある文書では、`index_status` と `orphaned_at` を `null` にする（キーは無くならない）
- `search_notes` に `検索結果 <N> 件のうち <M> 件は国税庁の索引から外れています（`index_status: "removed_from_index"`）。` に続けて、過去の課税期間では意味を持つ場合があるが現在の取扱いは最新の通達で確かめること、出典 URL は 404 になることがある旨の文を入れる。例: 2 件のうち 1 件が消えた文書なら `2 件のうち 1 件` を含む
- `nta_search_tsutatsu` には当てはまらない

例: 索引から消えた事務運営指針 1 件と索引にある 1 件が当たったとき、前者の要素は `index_status: "removed_from_index"`・`orphaned_at: "2026-10-01T00:30:00Z"`、後者の要素は `index_status: null`・`orphaned_at: null`（v0.22.0 では後者にどちらのキーも無かった）。

### SPEC-NTA-SEARCH-RULES-015 文書系 5 ツールは、ヒットしたときに `results` と `keyword`・`freshness`・`legal_status` を返し、`results` の要素のキーは種別によらず同じにする

文書系 5 ツール（`nta_search_qa`・`nta_search_tax_answer`・`nta_search_kaisei_tsutatsu`・`nta_search_jimu_unei`・`nta_search_bunshokaitou`）は、キーワードに合う文書が 1 件以上あるとき、エラーにせず次を返す。

- `keyword`: 渡した `keyword`
- `results`: 合った文書の配列。`score` の高い順（SPEC-NTA-SEARCH-RULES-014）で、最大 `limit` 件。各要素は次のフィールドを持つ。値の無いフィールドは `null` にし、キーは無くさない

| フィールド | 内容 |
|---|---|
| `docType` | 種別。`qa-jirei` / `tax-answer` / `kaisei` / `jimu-unei` / `bunshokaitou` |
| `docId` | 文書 ID。取得ツール（`nta_get_*`）や `nta_inspect_pdf_meta` にそのまま渡せる値。例: 質疑応答事例は `shohi/02/19`、タックスアンサーは `6101` |
| `taxonomy` | DB に入っている税目の値 |
| `title` | 題名 |
| `issuedAt` | 発出日（`YYYY-MM-DD`）。改正通達・事務運営指針・文書回答事例は DB の発出日で、DB に無ければ `null`。質疑応答事例は日付を持たないので常に `null`。タックスアンサーは発出日を持たないので常に `null`（記事の日付は `basisDate`） |
| `basisDate` | タックスアンサーは、記事の「法令時点」（例: `令和7年4月1日現在法令等`）から読んだ日付（`YYYY-MM-DD`）。読めなければ `null`。発出日ではない。ほかの 4 種別は常に `null`（キーは持つ） |
| `sourceUrl` | 国税庁ページの URL |
| `snippet` | 本文の抜粋。合った語を `<b>` で囲む。例: `<b>源泉徴収</b>の事務について …` |
| `score` / `scoreReasons` | 関連度とその理由（SPEC-NTA-SEARCH-RULES-012） |
| `index_status` / `orphaned_at` | 国税庁の索引から消えた文書では `"removed_from_index"` と確認した日時。索引にある文書ではどちらも `null`（SPEC-NTA-SEARCH-RULES-011） |

- `freshness`: その種別の文書の取得時点の範囲。税目で絞ったときはその範囲（`nta_search_bunshokaitou` は別表記を含む）
- `search_notes`: 短い語・通称の展開・索引から消えた文書・税目の別表記の注記があるときだけ付く
- `legal_status`: 種別ごとの資料の位置付け。次の表のとおり

| ツール | `binds_citizens` | `binds_courts` | `binds_tax_office` | `note` の要点 |
|---|---|---|---|---|
| `nta_search_qa` / `nta_search_tax_answer` | `false` | `false` | `false` | 国税庁の参考解説資料で法的拘束力はなく、実務判断は通達・法令本文に基づく必要がある |
| `nta_search_kaisei_tsutatsu` / `nta_search_jimu_unei` | `false` | `false` | `true` | 通達は行政内部文書で納税者・裁判所を直接は拘束しないが、税務署員は職務として守る（最高裁 昭和43.12.24） |
| `nta_search_bunshokaitou` | `false` | `false` | `false` | 個別事案への回答で一般的な法的拘束力はなく、実務判断は通達・法令本文に基づく必要がある |

タックスアンサーの日付を `issuedAt` に入れないのは、記事の日付が「その日の法令で書いた」という法令時点で、発出日とは意味が違うためである。名前は `nta_get_qa` の `qa.basisDate`（注記から読んだ作成時点の日付、`YYYY-MM-DD`）と同じにした。

例: 質疑応答事例が 2 件ある DB で `nta_search_qa` に `{ keyword: "源泉徴収" }` を渡すと、`results` の各要素は `docType: "qa-jirei"` と上の表のフィールド（`issuedAt: null`・`basisDate: null`、索引にある文書なら `index_status: null`・`orphaned_at: null`）を持ち、`scoreReasons` の先頭は `doc_type=qa weight 0.70` になる。法令時点が `令和7年4月1日現在法令等` のタックスアンサーが当たると、その要素は `issuedAt: null`・`basisDate: "2025-04-01"` を持つ（v0.22.0 では `nta_search_qa` と `nta_search_tax_answer` の要素に `issuedAt` が無く、`basisDate` も無かった）。
