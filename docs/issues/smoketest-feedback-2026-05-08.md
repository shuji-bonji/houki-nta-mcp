# houki-nta-mcp スモークテスト feedback (issue 草案)

- **実施日**: 2026-05-08
- **対象**: npx 公開版 `@shuji-bonji/houki-nta-mcp` (Cowork mode から `mcp__houki-nta__*` として接続)
- **テスト結果サマリ**: 14 ツール × 18 呼び出しすべて成功。クラッシュなし。以下は **品質シグナルの不整合 + 改善余地** に関するメモ。

> 実 issue 化はせず、リポ内に草案として保存。優先度・着手判断は別途。

---

## #1 (priority: medium) `nta_inspect_pdf_meta` の `legal_status.note` が docType 別になっていない

### 観測

```jsonc
// docType=bunshokaitou の戻り値
{
  "legal_status": {
    "binds_citizens": false,
    "binds_courts": false,
    "binds_tax_office": true,            // ← bunshokaitou は税務署員拘束力あり扱いになっている
    "note": "通達は行政内部文書。納税者・裁判所には直接的拘束力なし。ただし税務署員は職務として守る義務あり（最高裁 昭和43.12.24）"
  }
}

// docType=tax-answer の戻り値
{
  "legal_status": {
    "binds_tax_office": true,            // ← tax-answer は本来 false
    "note": "通達は行政内部文書。..."     // ← 通達固定文言
  }
}
```

### 期待

- `bunshokaitou` (文書回答事例) → `binds_tax_office: false`, note は文書回答事例向け文言
- `tax-answer` (タックスアンサー) / `qa-jirei` (質疑応答事例) → `binds_tax_office: false`, note は「参考解説資料」系文言
- `tsutatsu` / `kaisei` / `jimu-unei` → 現行の通達文言で OK

### 影響

- houki-research-skill が legal_status.note を citation footer に流す設計のため、文書回答事例やタックスアンサーに対しても「通達は…」と表示されるとユーザーへ誤解を与える。
- Phase 4-2 で `inspect_pdf_meta` を導入した際の docType 別 legal_status マップが kaisei/jimu-unei を基準に固定化された可能性。

### 提案

- `src/legal_status/notes.ts` (仮) で docType 別の `LEGAL_STATUS_BY_DOCTYPE` を 1 か所にまとめ、`inspect_pdf_meta` / `nta_get_*` / `nta_search_*` で同じ map を参照する。
- houki-hub family の error contract と揃えて、Skill 層の正典 → 各 MCP は import で済ませる方向と整合。

---

## #2 (priority: low) `nta_search_bunshokaitou` の `legal_status.note` から「文書回答事例」が抜けている

### 観測

```jsonc
{
  "legal_status": {
    "binds_tax_office": false,
    "note": "タックスアンサー・質疑応答事例は国税庁の参考解説資料。法的拘束力はなく、実務判断は通達・法令本文に基づく必要がある"
  }
}
```

`bunshokaitou` は「文書回答事例」であり、`タックスアンサー・質疑応答事例` という文言には含まれていない。

### 期待

```
"note": "文書回答事例・タックスアンサー・質疑応答事例は国税庁の参考解説資料。..."
```

または `LEGAL_STATUS_BY_DOCTYPE.bunshokaitou` を独立化し、

```
"note": "文書回答事例は照会者・国税庁双方の合意に基づく個別事案回答であり、一般法的拘束力はない（最高裁 ... 等）。"
```

### 提案

- #1 と一緒に `LEGAL_STATUS_BY_DOCTYPE` を整理して解消する。

---

## #3 (priority: low / nice-to-have) `nta_search_kaisei_tsutatsu` の通称ヒット

### 観測

- `keyword=インボイス` → 0 件
- `keyword=消費税` → 3 件 (うち令和7年改正通達は新旧対照表 PDF を持つ)

実文書中の表記は「適格請求書」「適格請求書等保存方式」であり、検索キー「インボイス」は LLM 側が自然に投げる語彙にもかかわらず該当しない。

### 提案

- `houki-abbreviations` v0.4.0+ 計画で予定している逆引き / 通称マップを呼び出し、`インボイス` → `適格請求書` に変換した second-pass 検索を `search_*` 内部で透過的に行う (もしくはメタとして `expanded_keywords` を返す)。
- search 系全体に共通化 (kaisei に限らず tsutatsu / bunshokaitou でも同じ問題が出る)。

---

## #4 (priority: closed / 要追加調査ではなかった) `nta_search_bunshokaitou` の `hasPdf=true` フィルタ実効性

### 観測

- `keyword=所得税, hasPdf=未指定` → 3 件 (すべて `shotoku/...` 福島原発賠償関連)
- `keyword=所得税, hasPdf=true` → **0 件**
- 文書回答事例の本来の挙動として、回答書本文が PDF 別添であるケース (照会本文 PDF / 回答 PDF) は多い印象。3 件すべて PDF 添付ゼロというのは違和感。

### 検証 (2026-05-08 実施)

ローカル DB を直接確認した結果、**仮説 3 が正解** (= bug ではない) と確定:

```bash
$ sqlite3 ~/.cache/houki-nta-mcp/cache.db \
    "SELECT doc_id, length(attached_pdfs_json), substr(attached_pdfs_json, 1, 80) \
     FROM document WHERE doc_type='bunshokaitou' AND taxonomy='shotoku' LIMIT 5"

tokyo/shotoku/260218 | 2   | []                             ← PDF なし
shotoku/250416       | 2   | []                             ← PDF なし
tokyo/shotoku/250311 | 2   | []                             ← PDF なし
shotoku/250129_02    | 414 | [{"title":"中小企業活性化…",…  ← PDF あり
shotoku/250129       | 264 | [{"title":"中小企業の事業再生…  ← PDF あり
```

つまり:

- crawler の取りこぼしではない (`attachedPdfs` を持つ文書 / 持たない文書が混在)
- スモークテスト時の 3 件はたまたま **FTS5 BM25 の上位 3 件が `[]` 側に集中** しただけ
- `hasPdf=true` で取りに行けば PDF 付き文書は別途ヒットする (`shotoku/250129_02` 等)

### 結論

- **コードの bug ではない** ため、issue としては起票しない。
- ただし「`hasPdf=true` で 0 件返ったとき、`hasPdf=未指定` 側には件数があるなら hint を出す」という UX 改善余地はある (#3 の synonym 拡張と同時に実装すると効率良い)。
- 仮に必要なら新規 issue「`hasPdf=true` の 0 件 hint 改善」として後日起票。

### この件で得られた副産物

- ローカル DB の `attached_pdfs_json` 中身を素早く確認するワンライナーが手元の運用ノウハウになった。`docs/DATABASE.md` に追加しておくと運用が楽になる。

---

## #5 (priority: nice-to-have) `freshness.staleness` の閾値共通化

### 観測

- ほぼ全 search 系で `freshness.staleness="fresh"` 表示済み (数値: `days_since_oldest=4` 等) — 動作 OK。
- ただし jimu-unei は `days_since_oldest=5` で fresh、bunshokaitou は `days_since_oldest=5` で fresh。閾値ロジックは確かに統一されているか確認したい (houki-egov / houki-egov-doc で同種の staleness 値を共通参照する場合に齟齬が出ないようにしたい)。

### 提案

- `text-normalize` を上げたのと同じノリで `freshness.ts` を共通パッケージ化して houki-hub family 全体で再利用 (現在は各 MCP に分散している印象)。

---

## 補足: 動作 OK 部分

- `nta_inspect_pdf_meta` の `reader_hints.examples` が docType と `kind` (comparison/attachment) に応じて切替される設計は機能面で正しく動いている。Phase 4-2 の意図通り。
- `nta_get_*` の Markdown 出力は **見出し階層 / 添付 PDF テーブル / 出典 / 取得時刻 / legal_status footer** の順で安定。pdf-reader-mcp 呼び出し例の docstring も簡潔。
- `resolve_abbreviation` の `in_scope=false` + `hint` で他 MCP に誘導する error contract は houki-hub family 横断のパターンに沿っており、Skill 層からの利用に適している。
