# 差分: nta_get_qa（20261003-t4-response-shape）

`specs/current/nta_get_qa/spec.md` に対する差分です。見出しの単位で置き換えます。

- `MODIFIED` の見出しは、current の同じ見出しの本文をこの本文で置き換える

## MODIFIED

### SPEC-NTA-GET-QA-008 json の応答

`format` を `json` にしたとき、応答は次のフィールドを持つ。値の無いフィールドは `null` にし、キーは無くさない。

| フィールド | 内容 |
|---|---|
| `qa.topic` / `qa.category` / `qa.id` | 税目・カテゴリ番号・事例番号（2 桁に揃えたもの） |
| `qa.title` | 題名 |
| `qa.question` / `qa.answer` | 照会要旨・回答要旨の段落の配列 |
| `qa.relatedLaws` | 【関係法令通達】の段落の配列（ページの表記のまま） |
| `qa.notice` / `qa.basisDate` | ページ下部の注記と、その注記から読んだ作成時点の日付（`YYYY-MM-DD`）。注記が無い事例ではどちらも `null`。注記はあるが日付を読めないときは `qa.basisDate` だけ `null` |
| `qa.sourceUrl` / `qa.fetchedAt` | 出典 URL と取得日時 |
| `index_status` / `orphaned_at` / `notice` | SPEC-NTA-GET-QA-010。索引にある事例と、この呼び出しで国税庁サイトから取った事例では `null` |
| `source` | `db` または `live` |
| `legal_status` | `binds_citizens: false` / `binds_courts: false` / `binds_tax_office: false` と注 |

例: 注記の無い事例を `format: "json"` で取ると、`qa.notice: null`・`qa.basisDate: null`（v0.22.0 ではどちらのキーも無かった）。

### SPEC-NTA-GET-QA-010 国税庁の索引から消えた事例に印を付け、それ以外では印のキーを null にする

DB から返す事例（SPEC-NTA-GET-QA-004）が国税庁の索引から外れている（bulk download で外れたことを確認した日時が付いている）ときは、応答に印を付ける。

- `format` が `json` のとき: `index_status: "removed_from_index"`、`orphaned_at`（確認した日時。例: `"2026-10-01T00:30:00Z"`）、`notice`（索引から外れている旨と、過去の課税期間では意味を持つ場合があること、現在の取扱いは最新の通達で確かめること、出典 URL が 404 になることがあることの注記）を付ける
- `format` を省くか `markdown` のとき: `> 税目: … / カテゴリ: … / 事例番号: …` の行の後に、`> **索引の状態**: removed_from_index（<確認した日時> に確認）` の行と、`> ` で始まる注記の行を入れる
- 索引にある事例と、この呼び出しで国税庁サイトから取った事例では、json の `index_status`・`orphaned_at`・`notice` をどれも `null` にし（キーは無くならない）、markdown に「索引の状態」の行と注記を入れない

注記の文は `nta_get_jimu_unei`（SPEC-NTA-GET-JIMU-UNEI-004）と同じである。

例: 索引にある事例を DB から `format: "json"` で取ると、`index_status: null`・`orphaned_at: null`・`notice: null`（v0.22.0 ではどのキーも無かった）。
