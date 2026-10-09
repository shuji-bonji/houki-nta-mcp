# 差分: search_rules（20261009-db-folder-access-and-tsutatsu-guide）

`specs/current/search_rules/spec.md` に対する差分です。見出しの単位で置き換えます。

- `MODIFIED` の `### SPEC-…` は、current の同じ ID の節（見出しから次の `###` または `##` の手前まで）を、見出しの行（題）も含めて丸ごと置き換える
- 冒頭の「関連する Issue」の末尾に `、#156（nta_inspect_pdf_meta に渡せる docId の種別。0.27.0）` を足す
- 「対象」、「処理の流れ」、「できないこと」、「未決」は変えない

## MODIFIED

### SPEC-NTA-SEARCH-RULES-015 文書系 5 ツールは、ヒットしたときに `results` と `keyword`・`freshness`・`legal_status` を返し、`results` の要素のキーは種別によらず同じにする

文書系 5 ツール（`nta_search_qa`・`nta_search_tax_answer`・`nta_search_kaisei_tsutatsu`・`nta_search_jimu_unei`・`nta_search_bunshokaitou`）は、キーワードに合う文書が 1 件以上あるとき、エラーにせず次を返す。

- `keyword`: 渡した `keyword`
- `results`: 合った文書の配列。`score` の高い順（SPEC-NTA-SEARCH-RULES-014）で、最大 `limit` 件。各要素は次のフィールドを持つ。値の無いフィールドは `null` にし、キーは無くさない

| フィールド | 内容 |
|---|---|
| `docType` | 種別。`qa-jirei` / `tax-answer` / `kaisei` / `jimu-unei` / `bunshokaitou` |
| `docId` | 文書 ID。例: 質疑応答事例は `shohi/02/19`、タックスアンサーは `6101`。取得ツール（`nta_get_*`）にそのまま渡せる値。`nta_inspect_pdf_meta` の `docId` に渡せるのは、`docType` が `kaisei`・`jimu-unei`・`bunshokaitou`・`tax-answer` の 4 種別の文書だけ（質疑応答事例は PDF を持たず、`nta_inspect_pdf_meta` の `docType` に `qa-jirei` が無い） |
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
| `nta_search_kaisei_tsutatsu` | `false` | `false` | `true` | 通達は行政内部文書で納税者・裁判所を直接は拘束しないが、税務署員は職務として守る（最高裁 昭和43.12.24） |
| `nta_search_jimu_unei` | `false` | `false` | `true` | 通達・事務運営指針は行政内部文書で納税者・裁判所を直接は拘束しないが、税務署員は職務として守る（最高裁 昭和43.12.24）。文は `nta_get_jimu_unei` の json と同じ（SPEC-NTA-SEARCH-JIMU-UNEI-002） |
| `nta_search_bunshokaitou` | `false` | `false` | `false` | 個別事案への回答で一般的な法的拘束力はなく、実務判断は通達・法令本文に基づく必要がある |

タックスアンサーの日付を `issuedAt` に入れないのは、記事の日付が「その日の法令で書いた」という法令時点で、発出日とは意味が違うためである。名前は `nta_get_qa` の `qa.basisDate`（注記から読んだ作成時点の日付、`YYYY-MM-DD`）と同じにした。

例: 質疑応答事例が 2 件ある DB で `nta_search_qa` に `{ keyword: "源泉徴収" }` を渡すと、`results` の各要素は `docType: "qa-jirei"` と上の表のフィールド（`issuedAt: null`・`basisDate: null`、索引にある文書なら `index_status: null`・`orphaned_at: null`）を持ち、`scoreReasons` の先頭は `doc_type=qa weight 0.70` になる。法令時点が `令和7年4月1日現在法令等` のタックスアンサーが当たると、その要素は `issuedAt: null`・`basisDate: "2025-04-01"` を持つ（v0.22.0 では `nta_search_qa` と `nta_search_tax_answer` の要素に `issuedAt` が無く、`basisDate` も無かった）。
