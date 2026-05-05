<!--
houki-nta-mcp の llms.txt 草案 (Phase 4-pre / 2026-05-04)

⚠️ これは Phase 5 (Resilience) 完了後に書き換える前提のドラフトです。
最終的に repo root の llms.txt として配置します。
書き換え予定箇所:
  - "## Optional > Resilience caveats" を「実装済み機能」として書き換え
    - 検知層・通知層・可視化層の実装内容を反映
    - HP 構造変更時の挙動を肯定形で記述
  - 必要に応じて "## Setup prerequisites" に staleness 検知の使い方を追記

houki-egov-mcp / houki-abbreviations の llms.txt と統一テンプレ化される際は
houki-llms-txt-gen パッケージのテンプレに合わせて調整。
-->

# houki-nta-mcp

> 国税庁（NTA）公式サイトの基本通達・改正通達・事務運営指針・文書回答事例・タックスアンサー・質疑応答事例を SQLite + FTS5 で全文検索する MCP server。日本の税務実務における「行政側の解釈・運用」を機械可読化する。法律本文（法・政令・省令）は別 MCP `@shuji-bonji/houki-egov-mcp` の責務。

houki-hub family の一員として「**国税庁という発出元組織**」を束ねる軸で設計されている。Architecture E（複数独立 MCP + 共有ライブラリ + Skill）に従い、family 横断の業法独占規定の注意喚起・citation 標準化・orchestration は `houki-research-skill`（Claude Skill）に委ねる。

## When to use

- 通達の条項を引きたい（例: 消基通 5-1-9、所基通 2-4の2、法基通 1-3の2-N）
- 「インボイス」「軽減税率」「電子帳簿」など実務テーマで通達・QA・タックスアンサーを横断検索したい
- 改正通達（一部改正通達）の本文と添付 PDF URL を取得したい
- 国税局・税務署が依拠する事務運営指針（jimu-unei）を確認したい
- 過去の文書回答事例（bunshokaitou）から類似事案を引きたい
- タックスアンサー（一般納税者向け解説、約 750 件）を網羅的に検索したい

## When NOT to use

- **法律本文・政令・省令の取得** → `@shuji-bonji/houki-egov-mcp`（e-Gov 法令 API）
- **判決・最高裁判例の検索** → `@shuji-bonji/houki-court-mcp`（構想中）
- **国税不服審判所の裁決** → `@shuji-bonji/houki-saiketsu-mcp`（構想中）
- **労務系の通達・通知** → `@shuji-bonji/houki-mhlw-mcp`（厚労省、計画中）
- **税務相談そのもの** → 税理士法 52 条の独占業務。LLM が業として回答すべきではない（詳細は `houki-research-skill` 参照）

本 MCP は「**情報取得**」だけを担う。判断・助言・アドバイスは LLM 側のレイヤーで適切な業法上の留保を付けて行うこと。

## Setup prerequisites

初回利用時は SQLite キャッシュへの bulk download が必須。**未投入の状態で `nta_search_*` を呼ぶと空配列 + hint メッセージが返る**ので、先に以下のいずれかを案内すること:

```bash
# 推奨: 6 大コンテンツを一括投入（約 1.5〜2 時間 / fail rate 0% / 計 2,710+ 件）
houki-nta-mcp --bulk-download-everything

# 種別ごとに段階的に
houki-nta-mcp --bulk-download-all          # 基本通達 4 種
houki-nta-mcp --bulk-download-kaisei       # 改正通達
houki-nta-mcp --bulk-download-jimu-unei    # 事務運営指針
houki-nta-mcp --bulk-download-bunshokaitou # 文書回答事例
houki-nta-mcp --bulk-download-tax-answer   # タックスアンサー
houki-nta-mcp --bulk-download-qa           # 質疑応答事例
```

`nta_get_*` 系は DB 未投入でもライブ fetch にフォールバックするが、応答時間は 1 秒前後 → DB hit なら ~10ms。

## Legal positioning

本 MCP が扱うコンテンツは **法源としての強さに差** がある。LLM はこの違いを尊重して回答を組み立てること。

| 種別 | 国民の拘束 | 裁判所の拘束 | 税務署員の拘束 | 性質 |
|---|---|---|---|---|
| 基本通達・改正通達 | × | × | ○ | 行政内部文書（最高裁 S43.12.24） |
| 事務運営指針 | × | × | ○ | 国税局・税務署の業務指針 |
| 文書回答事例 | × | × | △ | 個別事案への文書回答（同種事案の参考） |
| タックスアンサー | × | × | × | 一般納税者向け解説、参考資料 |
| 質疑応答事例 | × | × | × | 国税庁による参考解説 |

各 tool レスポンスには `legal_status: { binds_citizens, binds_courts, binds_tax_office, note }` が付く。**「税務署はこう運用しているが、納税者・裁判所には拘束力がない」** ことを明示する設計。

## Tools (13 tools, v0.5.0 時点)

### 検索系（FTS5 全文検索、bulk DL 前提）
- `nta_search_tsutatsu`: 基本通達 4 種（消基通・所基通・法基通・相基通）を横断検索
- `nta_search_kaisei_tsutatsu`: 改正通達を検索
- `nta_search_jimu_unei`: 事務運営指針を検索
- `nta_search_bunshokaitou`: 文書回答事例を検索
- `nta_search_tax_answer`: タックスアンサー（約 750 件）を検索
- `nta_search_qa`: 質疑応答事例（9 税目 / 約 1,840 件）を検索

### 取得系（DB-first → live fallback）
- `nta_get_tsutatsu`: 通達本文を略称＋条項で取得（Normalize-everywhere で全角・半角ゆらぎを吸収）
- `nta_get_kaisei_tsutatsu`: 改正通達を docId で取得（本文 + 添付 PDF URL）
- `nta_get_jimu_unei`: 事務運営指針を docId で取得
- `nta_get_bunshokaitou`: 文書回答事例を docId で取得（本庁系・国税局系の 2 系統）
- `nta_get_tax_answer`: タックスアンサー番号（先頭桁で税目自動判定）
- `nta_get_qa`: 質疑応答事例を topic/category/id で取得

### 補助
- `resolve_abbreviation`: 略称解決（`@shuji-bonji/houki-abbreviations` 経由、管轄外なら他 MCP に誘導 hint）

## Family routing

houki-nta-mcp 単独で完結しないユースケースは family の他 MCP を併用する:

| ユースケース | 推奨フロー |
|---|---|
| 軽減税率の根拠を法律から実務まで | `houki-egov` (消費税法 29 条等) → `houki-nta` (消基通・QA) |
| 通達と判決を突き合わせたい | `houki-nta` (基本通達) → `houki-court` (判例) |
| 不服申立の事例を探したい | `houki-saiketsu` (国税不服審判所) → `houki-nta` (関連通達) |
| 略称が houki-nta 管轄外 | `resolve_abbreviation` → 他 MCP への誘導 hint を返す |

横断的 orchestration は `houki-research-skill` が担う。本 MCP 単独では fetch + parse + return のみ。

## Resources

- Repository: https://github.com/shuji-bonji/houki-nta-mcp
- npm: https://www.npmjs.com/package/@shuji-bonji/houki-nta-mcp
- Family hub doc: https://github.com/shuji-bonji/houki-hub-doc (構築中)
- Sibling MCPs:
  - https://github.com/shuji-bonji/houki-egov-mcp (法令本文)
  - https://github.com/shuji-bonji/houki-abbreviations (略称辞書)
- Skill: https://github.com/shuji-bonji/houki-research-skill (計画中)

## Optional

### Schema notes

- DB は SQLite + FTS5（trigram tokenizer）。`document` テーブルに 5 種別（kaisei / jimu-unei / bunshokaitou / tax-answer / qa-jirei）を統一格納、基本通達のみ `clause` テーブルで条項単位に格納
- 全データは `Normalize-everywhere` 原則で正規化済（全角→半角、ゆらぎ吸収）
- `content_hash` (SHA-1) で改正検知、`fetched_at` で staleness 判定可
- DB パス: `${XDG_CACHE_HOME:-~/.cache}/houki-nta-mcp/cache.db`

### Resilience caveats (Phase 5 で書き換え予定)

- 国税庁 HP の HTML 構造変更により bulk DL が突然失敗する可能性あり（Phase 5 で対応予定）
- 現状のベンチマーク: 全件 bulk DL 2,710 件 / 51 分 / fail rate 0%（v0.5.0 時点）
- staleness が気になる場合は `fetched_at` を確認し、必要なら再 bulk DL を案内
