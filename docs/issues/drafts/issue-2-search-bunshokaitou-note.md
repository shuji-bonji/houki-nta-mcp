## 背景

スモークテスト (2026-05-08) で `nta_search_bunshokaitou` の戻り値に含まれる `legal_status.note` が文書回答事例自体に言及していないことを確認しました。

詳細は [`docs/issues/smoketest-feedback-2026-05-08.md`](docs/issues/smoketest-feedback-2026-05-08.md) #2 を参照。

## 現状の挙動

```jsonc
// nta_search_bunshokaitou(keyword=...) の戻り値
{
  "legal_status": {
    "binds_tax_office": false,
    "note": "タックスアンサー・質疑応答事例は国税庁の参考解説資料。法的拘束力はなく、実務判断は通達・法令本文に基づく必要がある"
  }
}
```

`bunshokaitou` は **「文書回答事例」** だが、note の文中には「文書回答事例」が含まれていない (タックスアンサーと質疑応答事例だけ列挙)。

## 期待

文書回答事例の特性 (照会者・国税庁双方の合意による個別回答であり、一般法的拘束力なし) を踏まえた独立 note にする:

```jsonc
{
  "legal_status": {
    "binds_citizens": false,
    "binds_courts": false,
    "binds_tax_office": false,
    "note": "文書回答事例は照会者・国税庁双方の合意に基づく個別事案回答であり、一般的な法的拘束力はない。同じ事案で同様の判断を期待することは可能だが、実務判断は通達・法令本文に基づく必要がある"
  }
}
```

または最低限の修正案として、3 種を併記:

```
note: "文書回答事例・タックスアンサー・質疑応答事例は国税庁の参考解説資料。..."
```

## 影響

- 文書回答事例で検索したユーザに誤解を与える可能性 (note の対象が文書回答事例ではないと読まれる)。
- 機能不全ではないが、出力品質シグナルとして優先度 **low〜medium**。

## 提案

Issue #1 (`LEGAL_STATUS_BY_DOCTYPE` の docType 別整備) と一括で解消する。

`bunshokaitou` 用 entry を `LEGAL_STATUS_BY_DOCTYPE` に独立追加して、`nta_search_bunshokaitou` / `nta_get_bunshokaitou` / `nta_inspect_pdf_meta(docType=bunshokaitou)` すべてが同じ map を参照する形に。

## 関連

- Issue #1 (legal_status を docType 別に整備)
- `docs/issues/smoketest-feedback-2026-05-08.md` #2
