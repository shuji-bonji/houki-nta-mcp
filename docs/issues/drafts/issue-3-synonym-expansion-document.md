## 背景

スモークテスト (2026-05-08) で `nta_search_kaisei_tsutatsu` に LLM が自然に投げそうな通称 (例: `インボイス`) を渡すと 0 件になり、実文書に含まれる正式名 (例: `適格請求書`) で再検索しないとヒットしない問題を確認しました。

詳細は [`docs/issues/smoketest-feedback-2026-05-08.md`](docs/issues/smoketest-feedback-2026-05-08.md) #3 を参照。

## 現状の挙動

| 入力 | 件数 |
|---|---|
| `nta_search_kaisei_tsutatsu(keyword="インボイス", limit=3)` | **0 件** |
| `nta_search_kaisei_tsutatsu(keyword="適格請求書", limit=3)` | 3 件 (令7 改正通達等を含む) |
| `nta_search_kaisei_tsutatsu(keyword="消費税", limit=3)` | 3 件 |

実文書中の表記は「適格請求書」「適格請求書等保存方式」であり、検索キー「インボイス」は LLM/利用者が自然に投げる語彙にもかかわらず該当しない。

## 既存実装との関係

Phase 6-1 (v0.8.0) で **clause 検索 (`nta_search_tsutatsu`)** には `buildFtsQueryWithAbbreviation()` による通称→正式名の OR 展開を入れた。

`db-search.ts` の `searchDocumentFts()` も同関数を経由する設計だが、houki-abbreviations の **辞書側に「インボイス → 適格請求書」を含む通称マッピングが充分入っていない** 可能性が高い (kaisei / bunshokaitou で 0 件になるパターンが集中)。

## 期待

- `nta_search_kaisei_tsutatsu(keyword="インボイス")` → 「インボイス」が「適格請求書」「適格請求書等保存方式」に展開されてヒット。
- 戻り値に `expanded_keywords: ["インボイス", "適格請求書"]` のようなフィールドで展開履歴を返すと、Skill 層が「他にもこういう語彙でヒットした」と利用者に提示できる。
- search 系全体で同じ動作になる (`nta_search_tsutatsu` / `nta_search_kaisei_tsutatsu` / `nta_search_jimu_unei` / `nta_search_qa` / `nta_search_tax_answer` / `nta_search_bunshokaitou`)。

## 想定実装

### Step A: houki-abbreviations 側で通称辞書を拡充 (v0.4.0+ 計画)

memory `houki_abbreviations_v04_roadmap.md` で予定している逆引き / 通称マップを呼び出せるようにする。具体的には:

```ts
// houki-abbreviations が export
export function expandToFormalNames(keyword: string): string[] {
  // "インボイス" → ["適格請求書", "適格請求書等保存方式"]
  // "ふるさと納税" → ["寄附金控除", "ふるさと納税"] (表記ゆれ)
  return [...];
}
```

### Step B: houki-nta-mcp の `buildFtsQueryWithAbbreviation()` を拡張

現状は「キーワード全体が略称辞書にヒットしたとき」だけ formal 名を OR 展開する設計。これに **通称マップでの展開も加える**。

```ts
function buildFtsQueryWithAbbreviation(keyword: string): {
  query: string;
  expandedFrom?: string;
  expandedTo?: string[];   // 配列に変更 (複数候補対応)
} {
  const formalNames = expandToFormalNames(keyword);
  if (formalNames.length === 0) return { query: defaultQuery(keyword) };
  // (keyword) OR (formal1) OR (formal2) で OR 展開
  ...
}
```

### Step C: `expanded_keywords` をレスポンスに含める

各 search ハンドラの戻り値メタデータに `expanded_keywords` を追加して、利用者・Skill 層が「展開によりこの語彙でヒットした」を読めるようにする。

## 影響

- houki-abbreviations の **breaking でない API 拡張** (新 export 追加)。
- houki-nta-mcp の `searchDocumentFts` 呼び出し側に小さい変更。
- 既存テストへの影響なし (展開対象がない既存テストは通り、新規テストで通称展開を確認)。

## 優先度

Medium / nice-to-have。機能不全ではないが、Skill / LLM の自然な利用語彙との橋渡しとして効果が大きい。

## 関連

- memory: `houki_abbreviations_v04_roadmap.md`
- `docs/issues/smoketest-feedback-2026-05-08.md` #3
- 副次効果として「`hasPdf=true` で 0 件のときの hint return」も同 PR で扱える可能性 (smoketest #4 副産物)
