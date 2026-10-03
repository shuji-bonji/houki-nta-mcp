# 差分: nta_get_jimu_unei（json の legal_status.note の文を書く）

この差分は `specs/current/nta_get_jimu_unei/spec.md` に対するものです。0.23.0 の実装 PR で文書だけを直す行として変えた `note` の文を、仕様の本文に書きます。振る舞いは 0.23.0 から変えません。

## MODIFIED

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
| `legal_status` | `binds_citizens: false` / `binds_courts: false` / `binds_tax_office: true` と、`note: "通達・事務運営指針は行政内部文書であり、納税者・裁判所には直接的拘束力なし。ただし税務署員は職務として守る義務あり（最高裁 昭和43.12.24）"`。`nta_search_jimu_unei`（SPEC-NTA-SEARCH-JIMU-UNEI-002・003）と `nta_inspect_pdf_meta` の `docType: "jimu-unei"`（SPEC-NTA-INSPECT-PDF-META-016）も同じ値 |
| `source` | `db` |

例: 発出日と宛先が DB に無い事務運営指針では、`document.issuedAt: null`・`document.issuer: null`（v0.22.0 ではどちらのキーも無かった）。`{ docId: "shozei/090401", format: "json" }` の `legal_status.note` は `通達・事務運営指針は行政内部文書であり、` で始まる（2026-10-03 JST に plugin の houki-nta-mcp 0.23.0 で確かめた。houki-nta-mcp #131）。
