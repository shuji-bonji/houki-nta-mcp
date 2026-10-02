# 差分: nta_get_tax_answer（20261003-t4-response-shape）

`specs/current/nta_get_tax_answer/spec.md` に対する差分です。見出しの単位で置き換えます。

- `MODIFIED` の見出しは、current の同じ見出しの本文をこの本文で置き換える

## MODIFIED

### SPEC-NTA-GET-TAX-ANSWER-008 json の応答

`format` を `json` にしたとき、応答は次のフィールドを持つ。値の無いフィールドは `null` にし、キーは無くさない。

| フィールド                                    | 内容                                                                                                |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `taxAnswer.no`                                | 記事番号。引数の `no`（前後の空白を除いたもの。SPEC-NTA-GET-TAX-ANSWER-011）。例: `"1120"`          |
| `taxAnswer.title`                             | 題名。例: `"医療費を支払ったとき（医療費控除）"`                                                    |
| `taxAnswer.effectiveDate`                     | ページに書かれた法令時点の文字列。例: `"令和7年4月1日現在法令等"`。無いときは `null`                |
| `taxAnswer.basisDate`                         | `effectiveDate` から読んだ日付（`YYYY-MM-DD`）。例: `"2025-04-01"`。`effectiveDate` が `null` か、日付を読めないときは `null`。検索の `results[].basisDate`（SPEC-NTA-SEARCH-RULES-015）と同じ値 |
| `taxAnswer.taxCategory`                       | 対象税目。例: `"消費税"`。無いときは `null`                                                         |
| `taxAnswer.sections`                          | 見出しごとの節の配列。要素は `heading`（見出し）と `paragraphs`（段落の文字列の配列）。1 件以上ある |
| `taxAnswer.sourceUrl` / `taxAnswer.fetchedAt` | 出典 URL と取得日時                                                                                 |
| `index_status` / `orphaned_at` / `notice`     | SPEC-NTA-GET-TAX-ANSWER-009。索引にある記事と、この呼び出しで国税庁サイトから取った記事では `null`  |
| `source`                                      | `db` または `live`                                                                                  |
| `legal_status`                                | `binds_citizens: false` / `binds_courts: false` / `binds_tax_office: false` と注                    |

日付の読み方は、和暦の「<元号><年>年<月>月<日>日」を西暦の `YYYY-MM-DD` にする（元年は 1 年）。DB の経路でも国税庁サイトの経路でも同じ読み方で、bulk download が DB の発出日の列に入れる値と同じになる。

例: 法令時点が `令和7年4月1日現在法令等` の記事は `taxAnswer.effectiveDate: "令和7年4月1日現在法令等"`・`taxAnswer.basisDate: "2025-04-01"`。法令時点の書かれていない記事は `taxAnswer.effectiveDate: null`・`taxAnswer.basisDate: null`（v0.22.0 では `effectiveDate` のキーが無く、`basisDate` は無かった）。

### SPEC-NTA-GET-TAX-ANSWER-009 国税庁の索引から消えた記事に印を付け、それ以外では印のキーを null にする

DB から返す記事（SPEC-NTA-GET-TAX-ANSWER-004）が国税庁の索引から外れている（bulk download で外れたことを確認した日時が付いている）ときは、応答に印を付ける。

- `format` が `json` のとき: `index_status: "removed_from_index"`、`orphaned_at`（確認した日時。例: `"2026-10-01T00:30:00Z"`）、`notice`（索引から外れている旨と、過去の課税期間では意味を持つ場合があること、現在の取扱いは最新の通達で確かめること、出典 URL が 404 になることがあることの注記）を付ける
- `format` を省くか `markdown` のとき: `# No.<番号> <題名>` の見出しと `> 法令時点:` / `> 対象税目:` の行（あるとき）の後、最初の `## ` の節の前に、`> **索引の状態**: removed_from_index（<確認した日時> に確認）` の行と、`> ` で始まる注記の行を入れる
- 索引にある記事と、この呼び出しで国税庁サイトから取った記事では、json の `index_status`・`orphaned_at`・`notice` をどれも `null` にし（キーは無くならない）、markdown に「索引の状態」の行と注記を入れない

注記の文は `nta_get_jimu_unei`（SPEC-NTA-GET-JIMU-UNEI-004）と同じである。

例: 索引にある記事を DB から `format: "json"` で取ると、`index_status: null`・`orphaned_at: null`・`notice: null`（v0.22.0 ではどのキーも無かった）。
