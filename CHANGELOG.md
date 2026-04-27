# Changelog

All notable changes to this project will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Planned (Phase 1)

- **Phase 1a**: houki-abbreviations v0.2.0 で通達系エントリ追加（消基通・所基通・法基通 等）
- **Phase 1b**: 通達取得（消基通・所基通・法基通）の本実装（cheerio + iconv-lite で Shift_JIS 対応）
- **Phase 1c**: 質疑応答事例取得の本実装
- **Phase 1d**: タックスアンサー取得の本実装
- 法的位置付けメタ情報の付与（`legal_status` フィールド）

## [0.0.1] - 2026-04-27

**Phase 0 完了リリース**。プロジェクト骨格・ツール定義スタブ・設計ドキュメント整備。

### Added

- プロジェクト骨格（`package.json` / `tsconfig.json` / ESLint / Prettier / Vitest）
- MCP サーバエントリ（`src/index.ts`）— stdio トランスポート
- 7つの MCP ツール定義（全てスタブ）:
  - `nta_search_tsutatsu` — 通達検索（スタブ）
  - `nta_get_tsutatsu` — 通達取得（スタブ）
  - `nta_search_qa` — 質疑応答事例検索（スタブ）
  - `nta_get_qa` — 質疑応答事例取得（スタブ）
  - `nta_search_tax_answer` — タックスアンサー検索（スタブ）
  - `nta_get_tax_answer` — タックスアンサー取得（スタブ）
  - `resolve_abbreviation` — 略称解決（**実装済み**、houki-abbreviations 経由）
- **`@shuji-bonji/houki-abbreviations` ^0.1.0 を dependency 化** — 共有辞書層を活用
- **`source_mcp_hint` ベースの管轄判定** — 自分の管轄外（houki-egov 等）の場合、誘導ヒントを返す
- 設計ドキュメント:
  - [`docs/DESIGN.md`](docs/DESIGN.md) — 設計原則・ツール設計・houki-hub family 内の位置付け
  - [`docs/DATA-SOURCES.md`](docs/DATA-SOURCES.md) — 国税庁公開コンテンツの URL 構造・スクレイピング方針・ライセンス
- README / DISCLAIMER / CONTRIBUTING（通達の法的位置付け・税理士法との関係を明記）
- GitHub Actions CI（Node 20 / 22 マトリクス、lint + test + build）
- テストスイート（vitest）— 全スタブの整合性確認

### Status

**Phase 0 完了**。Phase 1 本実装の前に、以下を完了する必要がある:

1. houki-abbreviations v0.2.0 で通達系エントリ追加（消基通・所基通・法基通 等）
2. 国税庁サイトの実地調査（URL 構造・Shift_JIS 確認・cheerio パース動作確認）
3. `kentaroajisaka/tax-law-mcp` のソースコード詳読

[Unreleased]: https://github.com/shuji-bonji/houki-nta-mcp/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/shuji-bonji/houki-nta-mcp/releases/tag/v0.0.1
