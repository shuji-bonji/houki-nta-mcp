# 差分: search_rules（20260927-search-hit-responses）

`specs/current/search_rules/spec.md` に対する差分です。見出しの単位で置き換えます。

- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す

## ADDED

### SPEC-NTA-SEARCH-RULES-015 文書系 5 ツールは、ヒットしたときに `results` と `keyword`・`freshness`・`legal_status` を返す

文書系 5 ツール（`nta_search_qa`・`nta_search_tax_answer`・`nta_search_kaisei_tsutatsu`・`nta_search_jimu_unei`・`nta_search_bunshokaitou`）は、キーワードに合う文書が 1 件以上あるとき、エラーにせず次を返す。

- `keyword`: 渡した `keyword`
- `results`: 合った文書の配列。`score` の高い順（SPEC-NTA-SEARCH-RULES-014）で、最大 `limit` 件。各要素は次のフィールドを持つ

| フィールド | 内容 |
|---|---|
| `docType` | 種別。`qa-jirei` / `tax-answer` / `kaisei` / `jimu-unei` / `bunshokaitou` |
| `docId` | 文書 ID。取得ツール（`nta_get_*`）や `nta_inspect_pdf_meta` にそのまま渡せる値。例: 質疑応答事例は `shohi/02/19`、タックスアンサーは `6101` |
| `taxonomy` | DB に入っている税目の値 |
| `title` | 題名 |
| `sourceUrl` | 国税庁ページの URL |
| `snippet` | 本文の抜粋。合った語を `<b>` で囲む。例: `<b>源泉徴収</b>の事務について …` |
| `score` / `scoreReasons` | 関連度とその理由（SPEC-NTA-SEARCH-RULES-012） |
| `index_status` / `orphaned_at` | 国税庁の索引から消えた文書にだけ付く（SPEC-NTA-SEARCH-RULES-011） |

- `freshness`: その種別の文書の取得時点の範囲。税目で絞ったときはその範囲（`nta_search_bunshokaitou` は別表記を含む）
- `search_notes`: 短い語・通称の展開・索引から消えた文書・税目の別表記の注記があるときだけ付く
- `legal_status`: 種別ごとの資料の位置付け。次の表のとおり

| ツール | `binds_citizens` | `binds_courts` | `binds_tax_office` | `note` の要点 |
|---|---|---|---|---|
| `nta_search_qa` / `nta_search_tax_answer` | `false` | `false` | `false` | 国税庁の参考解説資料で法的拘束力はなく、実務判断は通達・法令本文に基づく必要がある |
| `nta_search_kaisei_tsutatsu` / `nta_search_jimu_unei` | `false` | `false` | `true` | 通達は行政内部文書で納税者・裁判所を直接は拘束しないが、税務署員は職務として守る（最高裁 昭和43.12.24） |
| `nta_search_bunshokaitou` | `false` | `false` | `false` | 個別事案への回答で一般的な法的拘束力はなく、実務判断は通達・法令本文に基づく必要がある |

例: 質疑応答事例が 2 件ある DB で `nta_search_qa` に `{ keyword: "源泉徴収" }` を渡すと、`results` の各要素は `docType: "qa-jirei"` と上の表のフィールドを持ち、`scoreReasons` の先頭は `doc_type=qa weight 0.70` になる。
