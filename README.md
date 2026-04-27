# Houki NTA MCP Server

[![CI](https://github.com/shuji-bonji/houki-nta-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/shuji-bonji/houki-nta-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node-%3E%3D20-brightgreen)](https://nodejs.org/)

国税庁（NTA）の **通達・質疑応答事例・タックスアンサー**を取得する MCP サーバ。

法律本文は houki-hub family の別 MCP（[`@shuji-bonji/houki-egov-mcp`](https://github.com/shuji-bonji/houki-egov-mcp)）が担当します。

## 状態: Phase 0（スケルトンのみ）

このリポジトリは現在 **Phase 0**（プロジェクト骨格・ツール定義スタブ・設計ドキュメント）の段階です。実際のスクレイピング実装（Phase 1）は未着手で、`nta_*` ツールは「未実装」レスポンスを返します。

実装ロードマップは [`docs/DESIGN.md`](docs/DESIGN.md) を参照。

## 提供予定のツール

| Tool | 用途 | Phase |
|---|---|---|
| `nta_search_tsutatsu` | 通達をキーワード検索 | Phase 1 |
| `nta_get_tsutatsu` | 通達本文を取得（章-項-号 単位指定可）| Phase 1 |
| `nta_search_qa` | 質疑応答事例をキーワード検索 | Phase 1 |
| `nta_get_qa` | 質疑応答事例の本文を取得 | Phase 1 |
| `nta_search_tax_answer` | タックスアンサーをキーワード検索 | Phase 1 |
| `nta_get_tax_answer` | タックスアンサー本文を取得（番号指定）| Phase 1 |
| `resolve_abbreviation` | 略称→エントリ解決（houki-abbreviations 経由）| ✅ Phase 0 |

## 通達の法的位置付け（重要）

通達は **行政内部文書**であり、国民・裁判所には直接的な法的拘束力を持ちません（最高裁 昭和43.12.24 墓地埋葬法事件）。ただし税務署員は職務命令として守る義務があり、**実務上は事実上の規範**として機能します。

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

## なぜ通達まで取得するのか

法律本文だけでは判断できないケースが多数あります。例えば消費税の軽減税率:

- **法律**（消費税法 4条）「飲食料品の譲渡には軽減税率を適用」
- **政令**: 飲食料品の定義
- **基本通達 5-1-9**: 「社内会議で出した飲食料品」「会議室への提供」「テイクアウト」の区分
- **質疑応答事例**: 個別事例（「テレワーク手当に含まれる飲料水」等）

会計・経理・税務系プロダクトを開発する場合、**通達レベルまで参照しないと正しい判定ができない**ことが多く、houki-nta-mcp はその領域をカバーします。

詳細は [`docs/DESIGN.md`](docs/DESIGN.md) を参照。

## houki-hub MCP family

| パッケージ | 役割 | 状態 |
|---|---|---|
| [`@shuji-bonji/houki-abbreviations`](https://github.com/shuji-bonji/houki-abbreviations) | 略称辞書（共有ライブラリ） | ✅ v0.1.0 |
| [`@shuji-bonji/houki-egov-mcp`](https://github.com/shuji-bonji/houki-egov-mcp) | e-Gov 法令API クライアント | ✅ v0.2.0 |
| **`@shuji-bonji/houki-nta-mcp`** | **国税庁通達・Q&A・タックスアンサー（このリポジトリ）** | 🚧 Phase 0 |
| `@shuji-bonji/houki-mhlw-mcp` | 厚労省通達・通知 | 計画中 |
| `@shuji-bonji/houki-court-mcp` | 判例（裁判所サイト） | 構想中 |
| `@shuji-bonji/houki-saiketsu-mcp` | 国税不服審判所裁決 | 構想中 |
| `@shuji-bonji/houki-hub` | meta-package（一括 install） | 計画中 |

## インストール（Phase 1 リリース後）

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
- [`docs/DATA-SOURCES.md`](docs/DATA-SOURCES.md) — 国税庁公開コンテンツの URL 構造・スクレイピング方針・ライセンス
- [`DISCLAIMER.md`](DISCLAIMER.md) — 通達の法的位置付け・利用範囲
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — 貢献方法
- [`CHANGELOG.md`](CHANGELOG.md) — リリースノート

## 業法との関係

本MCP は **一次情報の取得・提示のみ** を担います。分析は LLM、判断は利用者（または有資格者）の責任です。

**業としての税務代理・税務書類作成・税務相談（税理士法52条）への利用は想定外**です。詳細は [DISCLAIMER.md](DISCLAIMER.md) 参照。

## ライセンス

MIT — 個人利用・学習用途のフォーク・改変・再配布を自由に許可します。

国税庁コンテンツの著作権は **国（国税庁）**にあり、再配布・改変は[政府標準利用規約（第2.0版）](https://cio.go.jp/policy-opendata)の範囲内で可能です。本MCP は出典 URL を必ず付与する設計とし、利用者は元情報を確認できます。

ただし、**業としての使用（税理士法52条が定める独占業務）** については想定外であり、作者は一切の責任を負いません。[DISCLAIMER.md](DISCLAIMER.md) を必ずご確認ください。
