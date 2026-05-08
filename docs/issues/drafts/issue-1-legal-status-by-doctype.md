## 背景

スモークテスト (2026-05-08) で `nta_inspect_pdf_meta` および `nta_get_*` / `nta_search_*` の戻り値に含まれる `legal_status` の `note` 文言が docType ごとに正しく出し分けられていないことを確認しました。

詳細は [`docs/issues/smoketest-feedback-2026-05-08.md`](docs/issues/smoketest-feedback-2026-05-08.md) #1 を参照。

## 現状の挙動

### 例 1: `nta_inspect_pdf_meta(docType=bunshokaitou)`

```jsonc
{
  "legal_status": {
    "binds_citizens": false,
    "binds_courts": false,
    "binds_tax_office": true,
    "note": "通達は行政内部文書。納税者・裁判所には直接的拘束力なし。ただし税務署員は職務として守る義務あり（最高裁 昭和43.12.24）"
  }
}
```

`bunshokaitou` (文書回答事例) は通達ではないので `binds_tax_office` 含めて誤った文言。

### 例 2: `nta_inspect_pdf_meta(docType=tax-answer)`

```jsonc
{
  "legal_status": {
    "binds_tax_office": true,            // 本来は false
    "note": "通達は行政内部文書。..."     // 通達固定文言
  }
}
```

タックスアンサーは納税者向け解説資料であり、税務署員拘束力もない。

## 期待

| docType | binds_citizens | binds_courts | binds_tax_office | note 系統 |
|---|---|---|---|---|
| `tsutatsu` (kihon-tsutatsu) | false | false | true | 通達文言 (現行 OK) |
| `kaisei` | false | false | true | 通達文言 (現行 OK) |
| `jimu-unei` | false | false | true | 通達文言 (現行 OK) |
| `bunshokaitou` | **false** | **false** | **false** | 「文書回答事例は照会者・国税庁双方の合意に基づく個別事案回答。一般的な法的拘束力なし」 |
| `tax-answer` | **false** | **false** | **false** | 「タックスアンサーは国税庁の参考解説資料。法的拘束力はなく、実務判断は通達・法令本文に基づく必要あり」 |
| `qa-jirei` | **false** | **false** | **false** | 「質疑応答事例は国税庁の参考解説資料。法的拘束力はなく、実務判断は通達・法令本文に基づく必要あり」 |

## 影響

- `houki-research-skill` が `legal_status.note` を citation footer に流す設計のため、文書回答事例やタックスアンサーに対しても「通達は…」と表示されてユーザに誤解を与える。
- 機能不全ではないが、出力品質シグナルとして優先度 **medium**。

## 提案

- `src/legal_status/notes.ts`(仮)で docType 別の `LEGAL_STATUS_BY_DOCTYPE` を定義し、`inspect_pdf_meta` / `nta_get_*` / `nta_search_*` で同じ map を参照するよう一元化。
- houki-hub family の error contract と揃えて、docType→legal_status の map を 1 か所にまとめる方針。

## 関連

- `docs/issues/smoketest-feedback-2026-05-08.md` #1
- Issue #2 (`nta_search_bunshokaitou` の note 文言)も本 issue と同じ `LEGAL_STATUS_BY_DOCTYPE` 整備で同時解消可能。
