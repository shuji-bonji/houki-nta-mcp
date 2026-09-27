# 差分: nta_get_tax_answer（20260927-index-status-marks）

`specs/current/nta_get_tax_answer/spec.md` に対する差分です。見出しの単位で置き換えます。

- `ADDED` の `### SPEC-…` は、current の「できること」の末尾に足す

## ADDED

### SPEC-NTA-GET-TAX-ANSWER-009 国税庁の索引から消えた記事に印を付ける

DB から返す記事（SPEC-NTA-GET-TAX-ANSWER-004）が国税庁の索引から外れている（bulk download で外れたことを確認した日時が付いている）ときは、応答に印を付ける。索引にある記事と、この呼び出しで国税庁サイトから取った記事には何も付けない。

- `format` が `json` のとき: `index_status: "removed_from_index"`、`orphaned_at`（確認した日時。例: `"2026-10-01T00:30:00Z"`）、`notice`（索引から外れている旨と、過去の課税期間では意味を持つ場合があること、現在の取扱いは最新の通達で確かめること、出典 URL が 404 になることがあることの注記）を付ける
- `format` を省くか `markdown` のとき: `# No.<番号> <題名>` の見出しと `> 法令時点:` / `> 対象税目:` の行（あるとき）の後、最初の `## ` の節の前に、`> **索引の状態**: removed_from_index（<確認した日時> に確認）` の行と、`> ` で始まる注記の行を入れる
- 索引にある記事では、json に `index_status` / `orphaned_at` / `notice` を付けず、markdown に「索引の状態」の行と注記を入れない

注記の文は `nta_get_jimu_unei`（SPEC-NTA-GET-JIMU-UNEI-004）と同じである。
