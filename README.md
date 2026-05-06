# Houki NTA MCP Server

[![CI](https://github.com/shuji-bonji/houki-nta-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/shuji-bonji/houki-nta-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node-%3E%3D20-brightgreen)](https://nodejs.org/)

国税庁（NTA）公式サイトの **基本通達・改正通達・事務運営指針・文書回答事例・タックスアンサー・質疑応答事例** をローカル SQLite に取得し、FTS5 で全文検索する MCP server。

法律本文（法・政令・省令）は別 MCP の [`@shuji-bonji/houki-egov-mcp`](https://github.com/shuji-bonji/houki-egov-mcp) が担当します。

## 主な機能

- **6 大コンテンツに対応**: 基本通達 4 種 + 改正通達・事務運営指針・文書回答事例・タックスアンサー・質疑応答事例
- **13 ツール提供**: 取得（DB-first → live fallback） + FTS5 全文検索 + 略称解決
- **高速応答**: bulk DL 済なら DB から即時応答（~10ms）。未投入なら live fetch（~700ms/件）でフォールバック
- **正規化済み検索**: Normalize-everywhere 原則で全角・半角ゆらぎを吸収
- **改正検知**: SHA-1 content_hash で個別文書の変化を検知、4 パターン集計（新規 / 更新 / 削除 / 移動）
- **HP 構造変更耐性 (v0.6.0)**: 9 種別 baseline で履歴管理 + `--health-check` CLI で週次 canary 検証
- **添付 PDF kind 分類 (v0.7.0)**: タイトルから 6 種別（新旧対照表 / 別紙・別表 / Q&A / 参考資料 / 通知・連絡 / その他）に自動分類。Markdown 出力は kind 優先度ソートの表 + `pdf-reader-mcp` 呼び出し例つき
- **レスポンスに `freshness` 付き**: 利用者（LLM）が staleness を判定できる
- **法的位置付けを明示**: 各レスポンスに `legal_status` フィールド（通達 = 税務署員のみ拘束、QA = 参考情報、等）

## 提供ツール（13 ツール）

| Tool                         | 用途                                                   |
| ---------------------------- | ------------------------------------------------------ |
| `nta_get_tsutatsu`           | 通達本文を取得（DB-first → live fallback、4 通達対応） |
| `nta_search_tsutatsu`        | 通達を FTS5 全文検索（`freshness` 付き）               |
| `nta_get_kaisei_tsutatsu`    | 改正通達を docId で取得（本文 + kind 分類付き PDF 表） |
| `nta_search_kaisei_tsutatsu` | 改正通達を FTS5 検索（`freshness` 付き）               |
| `nta_get_jimu_unei`          | 事務運営指針を取得                                     |
| `nta_search_jimu_unei`       | 事務運営指針を FTS5 検索（`freshness` 付き）           |
| `nta_get_bunshokaitou`       | 文書回答事例を取得                                     |
| `nta_search_bunshokaitou`    | 文書回答事例を FTS5 検索（`freshness` 付き）           |
| `nta_get_tax_answer`         | タックスアンサー本文を取得                             |
| `nta_search_tax_answer`      | タックスアンサーを FTS5 全文検索（`freshness` 付き）   |
| `nta_get_qa`                 | 質疑応答事例の本文を取得                               |
| `nta_search_qa`              | 質疑応答事例を FTS5 全文検索（`freshness` 付き）       |
| `resolve_abbreviation`       | 略称→エントリ解決（houki-abbreviations 経由）          |

### 対応通達（4 種）

| 通達             | 略称   | TOC スタイル | clause 番号体系                                |
| ---------------- | ------ | ------------ | ---------------------------------------------- |
| 消費税法基本通達 | 消基通 | shohi        | 3 階層 `1-4-13の2`                             |
| 所得税基本通達   | 所基通 | shotoku      | 2 階層 `2-4の2` / 共通通達 `183~193共-1`       |
| 法人税基本通達   | 法基通 | hojin        | 3 階層、節の2 を含む `1-3の2-N`                |
| 相続税法基本通達 | 相基通 | sozoku       | flat 構造、ナカグロ複数条共通 `1の3・1の4共-1` |

clause 番号は **Normalize-everywhere** で全角→半角統一されているため、ユーザーが半角・全角どちらで入力してもヒットします。

## 使い方の例

```jsonc
// nta_get_tsutatsu — DB-first lookup（bulk DL 済みなら即時応答 ~10ms）
{ "name": "消基通", "clause": "1-4-13の2" }
// → "## 1-4-13の2（分割があった場合の課税事業者選択届出書の効力等）..."
//    + 出典 URL + 取得時刻 + legal_status の note + source: 'db' | 'live'

// 所基通（2 階層 clause / の付き）
{ "name": "所基通", "clause": "2-4の2" }

// 所基通源泉（チルダ複数条共通）
{ "name": "所基通", "clause": "183~193共-1" }

// 相基通（ナカグロ複数条共通）
{ "name": "相基通", "clause": "1の3・1の4共-5" }

// nta_search_tsutatsu — FTS5 全文検索（4 通達横断、freshness 付き）
{ "keyword": "電子帳簿", "limit": 10 }
// → { hits: [...], freshness: { staleness, oldest_fetched_at, ... }, legal_status: ... }

// nta_get_kaisei_tsutatsu — 改正通達取得
{ "docId": "0026003-067" }
// → "# 消費税法基本通達の一部改正について（法令解釈通達）" + 発出日 + 宛先 + 本文
//   + 「## 添付 PDF (N 件)」表（🔄 新旧対照表 / 📎 別紙・別表 等で kind 分類済）
//   + pdf-reader-mcp の read_text 呼び出し例 JSON
//    PDF 本文は pdf-reader-mcp に委譲

// nta_get_tax_answer — 番号で取得（先頭桁から税目自動判定）
{ "no": "6101" }
// → "# No.6101 消費税の基本的なしくみ ..." sections + 法令時点 + 出典

// nta_get_qa — 質疑応答事例を取得
{ "topic": "shohi", "category": "02", "id": "19" }
// → "# 個人事業者が所有するゴルフ会員権の譲渡 ## 【照会要旨】 ... ## 【回答要旨】 ..."

// 管轄外（消法 = 消費税法本体）→ houki-egov-mcp に誘導
{ "name": "消法", "clause": "9" }
// → { error: "...houki-egov の管轄...", hint: "houki-egov-mcp で取得してください" }
```

## 初回セットアップ（bulk DL）

通達本体・改正通達・事務運営指針・文書回答事例・タックスアンサー・質疑応答事例を事前に bulk DL してローカル SQLite (FTS5) に投入します。1 度実行すれば DB から即時応答（fetch なし）。

```bash
# 推奨: 6 種別を一括投入（約 50 分。--bunsho-taxonomy / --tax-answer-taxonomy / --qa-topic で短縮可）
houki-nta-mcp --bulk-download-everything --bunsho-taxonomy=shotoku

# 個別実行
houki-nta-mcp --bulk-download-all          # 通達本体 4 種
houki-nta-mcp --bulk-download-kaisei       # 改正通達
houki-nta-mcp --bulk-download-jimu-unei    # 事務運営指針
houki-nta-mcp --bulk-download-bunshokaitou # 文書回答事例
houki-nta-mcp --bulk-download-tax-answer   # タックスアンサー
houki-nta-mcp --bulk-download-qa           # 質疑応答事例

# 30 日以上古い節を再取得（差分更新）
houki-nta-mcp --refresh-stale=30 --apply

# 9 種別の代表 URL を canary 検証（HP 構造変更検知）
houki-nta-mcp --health-check
```

| コンテンツ        | 件数の目安        | 投入時間                   |
| ----------------- | ----------------- | -------------------------- |
| 通達本体 (4 通達) | 約 2,800 clauses  | 10-15 分                   |
| 改正通達          | 約 125 docs       | 5-10 分                    |
| 事務運営指針      | 約 32 docs        | 約 1 分                    |
| 文書回答事例      | 数百〜2,000+ docs | 約 30 分超（絞り込み推奨） |
| タックスアンサー  | 約 750 docs       | 約 14 分                   |
| 質疑応答事例      | 約 1,840 docs     | 約 35 分                   |

DB は `${XDG_CACHE_HOME:-~/.cache}/houki-nta-mcp/cache.db`。詳細は [`docs/DATABASE.md`](docs/DATABASE.md)。

## 推奨運用フロー

スクレイピング主体のため、国税庁 HP の構造変更で bulk DL や parse が静かに壊れるリスクがあります。検知・可視化のため、以下を組み合わせて運用するのを推奨:

| 頻度         | コマンド                                   | 用途                                     |
| ------------ | ------------------------------------------ | ---------------------------------------- |
| 月 1 回      | `houki-nta-mcp --bulk-download-everything` | 4 パターン集計 + baseline 永続化         |
| 週 1 回      | `houki-nta-mcp --health-check`             | 9 種別の代表 URL を canary fetch + parse |
| 週 1 回 (CI) | GitHub Actions cron                        | `--health-check --strict` で自動検知     |

cron 設定例:

```cron
# 月初に bulk DL（毎月 1 日 03:00 JST）
0 3 1 * *  /usr/local/bin/houki-nta-mcp --bulk-download-everything > ~/.cache/houki-nta-mcp/last-bulk.log 2>&1

# 月曜に health-check（毎週月曜 09:00 JST）
0 9 * * 1  /usr/local/bin/houki-nta-mcp --health-check >> ~/.cache/houki-nta-mcp/health.log 2>&1
```

レスポンスに `freshness` フィールドが付き、`staleness` (`fresh`/`stale`/`outdated`) で再 bulk DL の必要性を判断できます。設計詳細は [`docs/RESILIENCE.md`](docs/RESILIENCE.md)。

## 通達の法的位置付け（重要）

通達は **行政内部文書** であり、国民・裁判所には直接的な法的拘束力を持ちません（最高裁 昭和43.12.24 墓地埋葬法事件）。ただし税務署員は職務命令として守る義務があり、**実務上は事実上の規範** として機能します。

```
┌──────────────────────────────────────────────────┐
│ 法律 (国会制定)              → 全員に拘束力     │
│ 政令・省令・告示             → 同上             │
│ ─── ここまでが houki-egov-mcp ─── │
│ 通達 (行政内部)              → 税務署員のみ拘束 │
│ 質疑応答事例                 → 参考情報         │
│ タックスアンサー             → 一般向け解説     │
│ ─── ここが houki-nta-mcp ─── │
└──────────────────────────────────────────────────┘
```

各レスポンスには `legal_status` フィールドが付与され、種別ごとの拘束力（`binds_citizens` / `binds_courts` / `binds_tax_office`）が明示されます。LLM はこの情報を尊重して回答を組み立てる前提です。

## なぜ通達まで取得するのか

法律本文だけでは判断できないケースが多数あります。例えば消費税の軽減税率:

- **法律**（消費税法 4 条）「飲食料品の譲渡には軽減税率を適用」
- **政令**: 飲食料品の定義
- **基本通達 5-1-9**: 「社内会議で出した飲食料品」「会議室への提供」「テイクアウト」の区分
- **質疑応答事例**: 個別事例（「テレワーク手当に含まれる飲料水」等）

会計・経理・税務系プロダクトを開発する場合、**通達レベルまで参照しないと正しい判定ができない** ことが多く、houki-nta-mcp はその領域をカバーします。

## houki-hub MCP family

| パッケージ                                                                               | 役割                                                                                                                     | 状態      |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------- |
| [`@shuji-bonji/houki-abbreviations`](https://github.com/shuji-bonji/houki-abbreviations) | 略称辞書（共有ライブラリ）                                                                                               | ✅ 公開済 |
| [`@shuji-bonji/houki-egov-mcp`](https://github.com/shuji-bonji/houki-egov-mcp)           | e-Gov 法令 API クライアント。法律・政令・省令・規則・告示の本文取得                                                      | ✅ 公開済 |
| **`@shuji-bonji/houki-nta-mcp`**                                                         | **国税庁の通達・改正通達・事務運営指針・文書回答事例・Q&A・タックスアンサー（このリポジトリ）**                          | ✅ 公開済 |
| `@shuji-bonji/houki-mhlw-mcp`                                                            | 厚労省の通達・通知・指針                                                                                                 | 📅 計画中 |
| `@shuji-bonji/houki-saiketsu-mcp`                                                        | 裁決全般。初版は国税不服審判所 (kfs.go.jp、約 1,950 件)。将来的に公正取引委員会・特許庁審判部・各省庁不服審査会 等へ拡張 | 💭 構想中 |
| `@shuji-bonji/houki-court-mcp`                                                           | 判例全般。初版は民事判決オープンデータ API。将来的に courts.go.jp の全公開判例（最高裁・高裁・地裁）へ拡張               | 💭 構想中 |
| `@shuji-bonji/houki-hub`                                                                 | meta-package（一括 install）                                                                                             | 📅 計画中 |

family 全体のドキュメントサイト（[houki-hub.mikuro.net](https://houki-hub.mikuro.net) / 構築中）で各 MCP の詳細を順次公開予定です。

## インストール

```json
// claude_desktop_config.json
{
  "mcpServers": {
    "houki-egov": {
      "command": "npx",
      "args": ["-y", "@shuji-bonji/houki-egov-mcp"]
    },
    "houki-nta": {
      "command": "npx",
      "args": ["-y", "@shuji-bonji/houki-nta-mcp"]
    }
  }
}
```

法律本文と通達の両方を引けるよう、両方を併用することを推奨します。

### 初回 bulk DL の注意

- **MCP サーバ起動とは別プロセス** で `npx -y @shuji-bonji/houki-nta-mcp --bulk-download-everything` を事前実行することを推奨（計 50 分前後）。
- [`pdf-reader-mcp`](https://www.npmjs.com/package/@shuji-bonji/pdf-reader-mcp) を併用すると、改正通達の添付 PDF（新旧対照表など）も内容取得できます。v0.7.0 以降は kind 分類で「どの PDF を最優先で読むべきか」が Markdown 出力に明示されます。

### prerelease (alpha) チャンネル

```json
"args": ["-y", "@shuji-bonji/houki-nta-mcp@next"]   // alpha 系を追従
"args": ["-y", "@shuji-bonji/houki-nta-mcp@latest"] // 安定版（既定）
```

## ローカル開発

```bash
git clone git@github.com:shuji-bonji/houki-nta-mcp.git
cd houki-nta-mcp
npm install
npm run build
npm test
```

```json
// 開発中の動作確認 (.mcp.json)
{
  "mcpServers": {
    "houki-nta-local": {
      "command": "node",
      "args": ["/absolute/path/to/houki-nta-mcp/dist/index.js"]
    }
  }
}
```

## ドキュメント

- [`docs/DESIGN.md`](docs/DESIGN.md) — 設計原則・houki-hub family 内の位置付け・ツール設計
- [`docs/DATABASE.md`](docs/DATABASE.md) — SQLite + FTS5 スキーマ・テーブル仕様・マイグレーション履歴
- [`docs/DATA-SOURCES.md`](docs/DATA-SOURCES.md) — 国税庁公開コンテンツの URL 構造・スクレイピング方針・ライセンス
- [`docs/RESILIENCE.md`](docs/RESILIENCE.md) — HP 構造変更検知の 5 層フレームワーク・運用フロー
- [`llms.txt`](llms.txt) — LLM 向け summary（family routing / setup / legal positioning）
- [`DISCLAIMER.md`](DISCLAIMER.md) — 通達の法的位置付け・利用範囲
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — 貢献方法
- [`CHANGELOG.md`](CHANGELOG.md) — リリースノート

## 業法との関係

本 MCP は **一次情報の取得・提示のみ** を担います。分析は LLM、判断は利用者（または有資格者）の責任です。

**業としての税務代理・税務書類作成・税務相談（税理士法 52 条）への利用は想定外** です。詳細は [`DISCLAIMER.md`](DISCLAIMER.md) 参照。

## ライセンス

MIT — 個人利用・学習用途のフォーク・改変・再配布を自由に許可します。

国税庁コンテンツの著作権は **国（国税庁）** にあり、再配布・改変は[政府標準利用規約（第 2.0 版）](https://cio.go.jp/policy-opendata)の範囲内で可能です。本 MCP は出典 URL を必ず付与する設計とし、利用者は元情報を確認できます。

ただし、**業としての使用（税理士法 52 条が定める独占業務）** については想定外であり、作者は一切の責任を負いません。[`DISCLAIMER.md`](DISCLAIMER.md) を必ずご確認ください。
