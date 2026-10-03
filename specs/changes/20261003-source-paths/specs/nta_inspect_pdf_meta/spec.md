# 差分: nta_inspect_pdf_meta（docType: "jimu-unei" の legal_status.note）

この差分は `specs/current/nta_inspect_pdf_meta/spec.md` に対するものです。

## MODIFIED

### SPEC-NTA-INSPECT-PDF-META-016 legal_status は docType ごとの資料の位置付けを返す

応答の `legal_status` は `docType` で決まる。

| `docType` | `binds_citizens` | `binds_courts` | `binds_tax_office` | `note` |
|---|---|---|---|---|
| `kaisei` | `false` | `false` | `true` | 要点: 通達は行政内部文書で納税者・裁判所を直接は拘束しないが、税務署員は職務として守る（最高裁 昭和43.12.24） |
| `jimu-unei` | `false` | `false` | `true` | `通達・事務運営指針は行政内部文書であり、納税者・裁判所には直接的拘束力なし。ただし税務署員は職務として守る義務あり（最高裁 昭和43.12.24）`。`nta_get_jimu_unei` の json（SPEC-NTA-GET-JIMU-UNEI-005）と同じ値 |
| `bunshokaitou` | `false` | `false` | `false` | 要点: 個別事案への回答で一般的な法的拘束力はなく、実務判断は通達・法令本文に基づく必要がある |
| `tax-answer` | `false` | `false` | `false` | 要点: 国税庁の参考解説資料で法的拘束力はなく、実務判断は通達・法令本文に基づく必要がある |

例: `{ docType: "jimu-unei", docId: "shozei/090401" }` の `legal_status.note` は `通達・事務運営指針は行政内部文書であり、` で始まる（v0.23.0 では `kaisei` と同じ `通達は行政内部文書。` で始まる文だった。houki-nta-mcp #131）。`{ docType: "kaisei", … }` の `note` は今までどおり。
