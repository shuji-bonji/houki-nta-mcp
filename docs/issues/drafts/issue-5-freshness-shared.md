## 背景

スモークテスト (2026-05-08) で `freshness.staleness` の閾値ロジックが MCP / docType 間で揃っているか確認したいケースがありました。

詳細は [`docs/issues/smoketest-feedback-2026-05-08.md`](docs/issues/smoketest-feedback-2026-05-08.md) #5 を参照。

## 現状の挙動

ほぼ全 search 系で `freshness.staleness="fresh"` 表示済み (動作 OK)。閾値の数値も `days_since_oldest=4 / 5` と一貫している。

ただし以下の懸念がある:

- 各 docType で同じ閾値を使っているか、ハードコードされていないか不明
- 将来 houki-egov-mcp / houki-research-skill から同種の staleness 値を参照する場合、各 MCP に分散すると齟齬が出やすい
- houki-hub family の他 MCP (例: `houki-egov-mcp` の取得時刻) でも staleness 概念は使うため、共通化メリットがある

## 期待

- `freshness` ロジック (staleness 計算 + 閾値定義) を **family 共有 npm package** として切り出し、houki-hub family 全体で再利用。
- text-normalize / houki-abbreviations と同じ流儀で「先に各 MCP に重複実装が育ったあとに共通パッケージに昇格」のフロー。

## 想定実装

### Step A: 現在の freshness ロジックの整理

```bash
# houki-nta-mcp 内のコピー数を確認
grep -rn "summarizeFreshness\|days_since_oldest\|staleness" src/services/ | wc -l
```

すべて `src/services/freshness.ts` に集約されているか、ハンドラごとに散らばっているか調査。

### Step B: 共通パッケージ化 (v0.4.0+ 候補)

```
@shuji-bonji/houki-freshness  (新規 npm package)
├── src/
│   ├── thresholds.ts        // FRESH_DAYS / STALE_DAYS 定数
│   ├── compute.ts           // summarizeFreshness 関数
│   └── types.ts             // FreshnessResult interface
```

houki-nta-mcp / houki-egov-mcp は本パッケージを依存に追加し、自前実装を削除。

text-normalize の昇格パターン (memory `houki_abbreviations_normalize_promotion.md`) と同じ流儀。

### Step C: houki-research-skill への影響

`docs/CITATION.md` で freshness を citation footer に流す設計があるため、Skill 層からも同じ閾値を参照可能にしておく (Skill 層では `legal_status` と並んで品質シグナルとして表示)。

## 影響

- 既存 MCP の挙動は変わらない (内部実装の置き換えのみ)。
- houki-nta-mcp / houki-egov-mcp で重複実装をなくし、メンテ箇所を 1 か所に。
- houki-hub family の "shared library 群" が text-normalize / houki-abbreviations / houki-freshness の 3 つになる。

## 優先度

Low / nice-to-have. 機能要件はないが、family 全体のメンテ効率と一貫性の観点で意義あり。Phase 6-3 (houki-hub-doc + llms.txt) と並行して検討するのがよいかもしれない。

## 関連

- memory: `houki_abbreviations_normalize_promotion.md` (text-normalize 昇格の前例)
- `docs/issues/smoketest-feedback-2026-05-08.md` #5
- 関連 docs: `docs/RESILIENCE.md` (Phase 5 で freshness 概念を導入)
