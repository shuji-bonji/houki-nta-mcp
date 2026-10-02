# 差分: nta_get_jimu_unei（20261003-t4-response-shape）

`specs/current/nta_get_jimu_unei/spec.md` に対する差分です。見出しの単位で置き換えます。

- `MODIFIED` の見出しは、current の同じ見出しの本文をこの本文で置き換える

## MODIFIED

### SPEC-NTA-GET-JIMU-UNEI-004 国税庁の索引から消えた文書に印を付け、索引にある文書では印のキーを null にする

DB から返す文書が国税庁の索引から外れている（bulk download で外れたことを確認した日時が付いている）ときは、応答に印を付ける。

- `format` が `json` のとき: `index_status: "removed_from_index"`、`orphaned_at`（確認した日時。例: `"2026-10-01T00:30:00Z"`）、`notice`（索引から外れている旨と、過去の課税期間では意味を持つ場合があること、現在の取扱いは最新の通達で確かめること、出典 URL が 404 になることがあることの注記）を付ける。`document.orphanedAt` にも同じ日時が入る。索引にある文書では、`index_status`・`orphaned_at`・`notice`・`document.orphanedAt` をどれも `null` にする（キーは無くならない）
- `format` を省くか `markdown` のとき: 文書の先頭の情報に `- **索引の状態**: removed_from_index（<確認した日時> に確認）` の行と、`>` で始まる注記の行を入れる。索引にある文書ではこの行を入れない

例: 索引にある事務運営指針を `format: "json"` で取ると、`index_status: null`・`orphaned_at: null`・`notice: null`・`document.orphanedAt: null` を持つ（v0.22.0 ではどのキーも無かった）。

### SPEC-NTA-GET-JIMU-UNEI-005 json の応答

`format` を `json` にしたとき、応答は次のフィールドを持つ。値の無いフィールドは `null` にし、キーは無くさない。

| フィールド | 内容 |
|---|---|
| `document.docType` | `jimu-unei` |
| `document.docId` / `document.taxonomy` / `document.title` | 文書 ID・税目・題名 |
| `document.issuedAt` / `document.issuer` | 発出日（`YYYY-MM-DD`）と宛先・発出者。DB に無ければ `null` |
| `document.sourceUrl` / `document.fetchedAt` | 出典 URL と DB に入れた日時 |
| `document.orphanedAt` | 索引から消えたことを確認した日時。索引にある文書では `null`（SPEC-NTA-GET-JIMU-UNEI-004） |
| `document.fullText` | 本文 |
| `document.attachedPdfs` | 添付 PDF の配列（SPEC-NTA-GET-JIMU-UNEI-007） |
| `index_status` / `orphaned_at` / `notice` | SPEC-NTA-GET-JIMU-UNEI-004。索引にある文書では `null` |
| `legal_status` | `binds_citizens: false` / `binds_courts: false` / `binds_tax_office: true` と注 |
| `source` | `db` |

例: 発出日と宛先が DB に無い事務運営指針では、`document.issuedAt: null`・`document.issuer: null`（v0.22.0 ではどちらのキーも無かった）。

### SPEC-NTA-GET-JIMU-UNEI-006 markdown（既定）の応答

`format` を省くか `markdown` にしたとき、応答は次の順に並ぶ文字列である。

- 見出し `# <題名>`
- `- **種別**: 事務運営指針`、`- **発出日**: <発出日>`（DB にあるときだけ）、`- **税目**: <税目>`（DB にあるときだけ）、`` - **docId**: `<docId>` ``、`- **出典**: <国税庁ページの URL>`、`- **取得**: <DB に入れた日時>`、`- **取得元**: ローカル DB（bulk download で取り込んだもの）` の行
- 国税庁の索引から消えた文書では、索引の状態の行と注記（SPEC-NTA-GET-JIMU-UNEI-004）
- 宛先・発出者が DB にある文書では `## 宛先・発出者` の節。各行を `> ` で引用する
- `## 本文` の節と本文
- 添付 PDF がある文書では `## 添付 PDF (<件数> 件)` の節（SPEC-NTA-GET-JIMU-UNEI-007）
- 最後に `---` と、`*通達・事務運営指針は行政内部文書であり、納税者・裁判所への直接的拘束力なし（最高裁 昭和43.12.24）*` の注

「取得元」の行は、`nta_get_qa` / `nta_get_tax_answer` の markdown の `取得元:` の行（ローカル DB か国税庁サイトか）に合わせて置く。このツールは DB だけを引くので、値は常に `ローカル DB（bulk download で取り込んだもの）` である（v0.22.0 ではこの行が無かった）。
