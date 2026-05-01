# Changelog

All notable changes to this project will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.2] - 2026-05-01

**Phase 1d リリース（調査主体）**。当初の「他通達 URL マッピング追加」計画から方針転換し、構造調査の結果を文書化。コードは最小変更（エラーメッセージ親切化のみ）。

### Investigation (Phase 1d)

houki-abbreviations の通達系 9 件について、国税庁サイトの実 URL と HTML 構造を実地調査:

- **URL ルートの確認**: `/law/tsutatsu/menu.htm` から各通達のトップ URL を抽出。9 件すべて確認
- **重要な発見**: 消基通スタイル（3 階層 clause + 直接 URL 組立）が成立するのは **消基通のみ**
  - 所基通: URL 規則は同じだが clause が 2 階層（`条-項` 形式: `2-4の2`）→ TOC lookup 必須
  - 法基通: URL 規則が違う（`{章}_{節}.htm` 形式）
  - 相基通: URL 規則が違う（`{章}/00.htm` 等）
  - 通基通・徴基通・印基通: TOP ファイル名が `00.htm` / `index.htm` / `mokuji.htm` で揃わず
  - 措通: 税目ごとに別ツリー（`/kobetsu/{税目}/sochiho/`）
- **方針転換**: Phase 1d は「他通達対応は Phase 2 (bulk DL + SQLite) と統合する」として縮小

### Changed

- **`src/constants.ts`**: `TSUTATSU_URL_ROOTS` のスコープ制限と Phase 2 への統合理由をコメントで明記
- **`handleNtaGetTsutatsu`**: 「houki-nta 管轄だが URL 未対応」のエラーで `hint` フィールドを返す。
  clause 番号体系の違いと Phase 2 で対応予定の旨を伝える親切エラーメッセージ
- **`docs/DESIGN.md`**: Phase 1d 調査結果を反映した通達差異表を追加。Phase 2 schema に
  `clause→URL lookup` のための `source_url` / `chapter_number` / `section_number` 列と
  `idx_clause_lookup` を追加
- **`docs/DATA-SOURCES.md`**: 通達ごとの URL ルート一覧と clause 体系の差異を追記

### Added

- 調査用 fixture（`tests/fixtures/`）に以下を追加（テストには使わない、調査の証跡）
  - `www.nta.go.jp_law_tsutatsu_menu.htm`（通達索引、UTF-8）
  - `www.nta.go.jp_law_tsutatsu_kihon_shotoku_01.htm`（所基通 TOC）
  - `www.nta.go.jp_law_tsutatsu_kihon_shotoku_01_01.htm`（所基通 第1章 第1節）
  - `www.nta.go.jp_law_tsutatsu_kihon_hojin_01.htm`（法基通 TOC）
  - `www.nta.go.jp_law_tsutatsu_kihon_hojin_01_01.htm`（法基通 404 確認用）
  - `www.nta.go.jp_law_tsutatsu_kihon_sisan_sozoku2_01.htm`（相基通 TOC）

### Notes

このリリースで `nta_get_tsutatsu` が新たに動くようになる通達は **無し**。実利用への影響は無い。
他通達対応は次の **Phase 2 リリース（v0.2.0 以降）** で TOC 事前 DL + clause→URL lookup を実装してから一括対応する。

## [0.1.1] - 2026-04-29

### Fixed

- **`bin` 実行ビット問題**: v0.1.0 の tarball では `dist/index.js` に実行ビットが立っておらず、`npx @shuji-bonji/houki-nta-mcp` が `command not found` で失敗する不具合を修正。`build` script を `tsc && chmod +x dist/index.js` に変更し、tsc 後に明示的に実行ビットを付与する。

## [0.1.0] - 2026-04-29

**Phase 1b/1b'/1c リリース**。`nta_get_tsutatsu` が **消費税法基本通達**（消基通）に対して動作する最初のリリース。

### Added (Phase 1b — 節ページ parser)

- **`src/services/nta-scraper.ts`** — 国税庁サイト fetch 層
  - `iconv-lite` で Shift_JIS / UTF-8 を auto-detect デコード
  - User-Agent / Accept-Language を付与（DATA-SOURCES.md のマナー準拠）
  - 4xx は即エラー、5xx・ネットワークエラーは指数バックオフで retry
  - `fetchImpl` を差し替え可能でテスト容易
- **`src/services/tsutatsu-parser.ts`** — 節ページ parser
  - cheerio で章-項-号構造を抽出（消基通の HTML 構造に対応）
  - `1-4-1`、`1-4-13の2`、`11-5-7` などの clause 番号形式を網羅
  - `<br>` 含む複数行本文 / `(注)` のネスト構造を保持
  - `TsutatsuClause` / `TsutatsuParagraph` / `TsutatsuSection` 型定義
- **`src/services/tsutatsu-toc-parser.ts`** — TOC ページ parser
  - 章 → 節 → 款の階層構造抽出（消基通 21 章すべて対応）
  - href の絶対 URL 化
  - `TsutatsuToc` / `TsutatsuTocChapter` / `TsutatsuTocSection` / `TsutatsuTocSubsection` 型定義
- **`src/utils/clause.ts`** — 通達番号パース + URL 組み立て
  - `parseClauseNumber("1-4-13の2")` → `{ chapter: 1, section: 4, article: "13の2" }`
  - `buildSectionUrl(rootUrl, chapter, section)` → `${root}{章2桁}/{節2桁}.htm`
- **`src/services/tsutatsu-render.ts`** — Markdown レンダラ
  - `renderClauseMarkdown` / `renderSectionMarkdown`
  - 出典 URL・取得時刻・`legal_status` の note を末尾に付与
- **`tests/fixtures/`** — 固定 HTML 4 本（01.htm / 01/01.htm / 01/04.htm / 05/01.htm）
- **`scripts/fetch-fixtures.mjs`** — fixture 取得補助スクリプト

### Added (Phase 1c — `nta_get_tsutatsu` 本実装)

- **`handleNtaGetTsutatsu` の本実装**（消基通のみ対応）
  - `name` を houki-abbreviations で resolve → 管轄判定
  - `clause` を `parseClauseNumber` で分解 → `buildSectionUrl` で URL 生成
  - fetch + parse → 該当 clause を抽出
  - `format: 'markdown' | 'json'` で出し分け
  - `legal_status` フィールド付与（最高裁 昭和43.12.24 の論理）
- **`getTsutatsu(args, options)`** — テスト容易な内部関数（`fetchImpl` 差し替え可）
- **CI canary**（`.github/workflows/canary.yml`）— 毎週月曜 01:00 UTC に `INTEGRATION=1` で実 nta.go.jp を叩いて構造変更を早期検知
- **`src/constants.ts`** に `TSUTATSU_URL_ROOTS` / `TSUTATSU_LEGAL_STATUS` 追加

### Changed

- **eslint config**: `no-irregular-whitespace` で全角スペースをコメント・正規表現内に許容
  （日本の通達本文の正規化処理で全角スペースのリテラル使用が避けられないため）
- **`extractClauseNumber` 正規表現**: `s` フラグ追加。`<br>` を含む複数行本文の clause を取りこぼさない

### Documentation

- **`docs/DESIGN.md`** に Phase 2 (bulk DL + SQLite FTS5) 設計を追記
- **`docs/DATA-SOURCES.md`** に構造変更リスク対策（CI canary / fallback selector / Phase 2 移行）と公的代替ソース調査結果を追記

### Planned (Phase 1d 以降)

- Phase 1d: 他通達の URL マッピング追加（所基通・法基通・相基通 等）
- Phase 1e: 質疑応答事例 / タックスアンサー取得
- Phase 2: bulk DL モード（SQLite FTS5）+ 改正検知 + `nta_search_tsutatsu` 本実装
- Phase 3: 文書回答事例（PDF）— pdf-reader-mcp 連携

## [0.0.2] - 2026-04-27

### Changed

- **`@shuji-bonji/houki-abbreviations` を `^0.2.0` に更新** — 通達系エントリ 9 件（消基通・所基通・法基通・相基通・通基通・徴基通・措通・印基通・電帳法取通）が利用可能に
- **`resolve_abbreviation` ハンドラのテスト追加**:
  - 消基通 → `in_scope: true`（houki-nta 管轄）の確認
  - 電帳法取通 → `in_scope: true` + `category: 'kobetsu-tsutatsu'` の確認
  - 正式名称（消費税法基本通達）からの逆引き

### Notes

houki-abbreviations v0.2.0 の通達系エントリ追加に伴い、houki-nta-mcp の `resolve_abbreviation` が **国税庁管轄**として扱うエントリが 9 件取得可能になった。Phase 1 本実装（実 URL からの取得）はまだだが、辞書経由での「これは国税庁管轄か」判定は完全動作。

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

[Unreleased]: https://github.com/shuji-bonji/houki-nta-mcp/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/shuji-bonji/houki-nta-mcp/releases/tag/v0.1.2
[0.1.1]: https://github.com/shuji-bonji/houki-nta-mcp/releases/tag/v0.1.1
[0.1.0]: https://github.com/shuji-bonji/houki-nta-mcp/releases/tag/v0.1.0
[0.0.2]: https://github.com/shuji-bonji/houki-nta-mcp/releases/tag/v0.0.2
[0.0.1]: https://github.com/shuji-bonji/houki-nta-mcp/releases/tag/v0.0.1
