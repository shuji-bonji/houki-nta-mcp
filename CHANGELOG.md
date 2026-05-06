# Changelog

All notable changes to this project will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

🗺️ **Phase 6 計画書 (v1.0.0 への道)** を [`docs/PHASE6.md`](docs/PHASE6.md) として策定。
新機能の大幅追加ではなく、**運用品質と発信の底上げ** を主軸に v1.0.0 安定リリースを目指す。

サブフェーズ構成:

- **6-1 (v0.8.0)**: search relevance ranking 精度向上 (clause 番号 boost / doc_type 重み付け / 略称展開 / score 応答)
- **6-2 (v0.9.0)**: bulk DL 差分更新 (HEAD `Last-Modified` バイパス + `content_hash` バイパスで 50 分 → 5〜10 分目標)
- **6-3 (リリース番号なし)**: houki-hub-doc サイト構築 + llms.txt 公開

完了基準は PHASE6.md §7「v1.0.0 リリース判定基準」を参照。スコープ外は同 §8。

## [0.7.3] - 2026-05-07

📚 **ドキュメント patch** — v0.7.2 リリース後に houki-egov-mcp + pdf-reader-mcp と
併用したいユーザー向けの統合利用ガイドを追記。コードや MCP の挙動には変更なし。

### Added

- **新規 [`docs/HOUKI-FAMILY-INTEGRATION.md`](docs/HOUKI-FAMILY-INTEGRATION.md)**:
  houki-egov-mcp + pdf-reader-mcp + houki-abbreviations と併用するときの
  **install → Claude Desktop / Claude Code 設定 → 実例 4 ユースケース** を一から
  順に書き下ろした統合利用ガイド (~ 380 行)。各ユースケースに sequenceDiagram
  付きで MCP 呼び出し順を可視化。トラブルシューティング 5 件と業法独占への
  配慮セクションも収録。

### Changed

- **README.md**: 統合ガイドへの誘導を 3 箇所に追加 (冒頭の概要直下 / ドキュメント
  セクション最上段 / family セクション末尾)。
- **README.md**: ドキュメントセクションに `docs/PHASE4-PDF.md` と
  `docs/PHASE4-PDF-FIXTURES.md` へのリンクを追加。

## [0.7.2] - 2026-05-06

🤝 **Phase 4-3 後の self-feedback** — `pdf-reader-mcp@0.3.0` で `extract_tables`
が利用可能になったのを機に、houki-nta-mcp 側の `reader_hints` を kind 別に
仕立て直し、新旧対照表 / 別紙・別表は `extract_tables` を最優先で推奨する形に
変更。あわせて Phase 4-3 で表面化した小さな取りこぼしを 4 件まとめて解消。

### Added

- **kind 別 `reader_hints.examples` (主軸 / Phase 4-3 self-feedback A2)**:
  `nta_inspect_pdf_meta` のレスポンスで、含まれる kind ごとに 1 件ずつ
  `pdf-reader-mcp` 呼び出し例を生成する。
  - `comparison` (新旧対照表) と `attachment` (別紙・別表・様式) は
    **`pdf-reader-mcp@0.3.0+` の `extract_tables`** を最優先で推奨し、
    新旧対照表の改正後 / 改正前を表構造のまま分離抽出する流れに誘導。
  - `qa-pdf` / `related` / `notice` / `unknown` は従来通り `read_text`。
  - `reader_hints.primary_action` を kind 別の最頻 tool（`extract_tables` or
    `read_text`）に応じて動的に切替。`min_pdf_reader_version: '0.3.0'` も併記。
- **`buildReaderHintExamples()` ヘルパ**: `src/services/pdf-meta.ts` に追加。
  `renderAttachedPdfsMarkdown` の Markdown 呼び出し例ブロックも kind 別の
  複数行構成に置き換え。
- **`fillMissingKinds()` ヘルパ (A1: kind 動的補完)**: v0.6.0 期に
  `attached_pdfs_json` の `kind` 抜きで投入された DB レコードでも、応答時に
  タイトルから `extractPdfKind` で動的補完されるようにした。bulk DL 再投入なしで
  kind 別 `reader_hints` が機能する。

### Fixed

- **`extractPdfKind` の表記ゆれ対応 (A3)**: 国税庁 kaisei `/shohi/kaisei/pdf/b0025003-111.pdf`
  のように **「新旧対**応**表」** という表記が使われる PDF が `comparison` ではなく
  `related` (タイトル先頭の「【参考】」が `参考` パターンに当たるため) と誤分類
  されていた問題を修正。`comparison` パターンを `/新旧対(照|応)表|対比表/` に拡張し、
  「新旧対応表」「新旧対照表」「対比表」のいずれにもマッチするようにした。

### Changed

- **README (A4)**: 「投入済みかどうかを素早く確認する」セクションを追加し、
  `sqlite3` ワンライナー + `doc_type` ↔ bulk DL コマンドの対応表を整理。
  bunshokaitou / qa-jirei は taxonomy / topic で範囲を絞ることを推奨する導線を追加。
- **README**: `nta_inspect_pdf_meta` の説明を「kind 別 / extract_tables 推奨」に更新。
  pdf-reader-mcp 連携の節で v0.7.2 + pdf-reader-mcp v0.3.0 の組み合わせ動作を明示。
- **`src/index.ts`**: 起動ログに Phase 4 self-feedback フェーズを追記。

### Tests

- `src/services/pdf-meta.test.ts`: `「新旧対応表」` の comparison 分類テスト、
  `buildReaderHintExamples` の単体テスト、`fillMissingKinds` の単体テストを追加。
- `src/tools/handlers.test.ts`: `nta_inspect_pdf_meta` のテストを v0.7.2 仕様に
  更新（kind 別 examples の 2 件構成、`primary_action: 'extract_tables'`、
  `min_pdf_reader_version: '0.3.0'`）+ kind 動的補完テストを追加。

## [0.7.1] - 2026-05-06

🔍 **Phase 4-2 PDF メタ二の波** — Phase 4-1 で構造化した kind 分類を、
検索フィルタと専用 tool 経由で活用できるようにした。「PDF が付く重要文書だけ」
「PDF メタだけ軽量に」という新しいアクセスパターンが追加される。

### Added (v0.7.1 の柱)

#### `hasPdf` 検索フィルタ (Phase 4-2 #6)

- **`src/services/db-search.ts`**: `SearchDocumentOptions.hasPdf?: boolean` を追加。
  - `true`: `attached_pdfs_json` が `'[]'` / NULL / 空文字以外 = PDF 1 件以上の文書だけ
  - `false`: PDF を持たない文書だけ
  - `undefined`: フィルタしない（既定）
- **`src/tools/handlers.ts`**: 5 つの search ハンドラ
  （`nta_search_kaisei_tsutatsu` / `nta_search_jimu_unei` / `nta_search_bunshokaitou`
  / `nta_search_tax_answer` / `nta_search_qa`）に `hasPdf` 引数を追加。
- **`src/tools/definitions.ts`**: 同じく 5 ハンドラの inputSchema に `hasPdf: boolean` を追加。
- **`src/types/index.ts`**: 5 つの SearchArgs 型に `hasPdf?: boolean` を追加。
- DB スキーマ変更なし。FTS5 インデックスにも触らない（WHERE 句で後段絞り込み）。

#### `nta_inspect_pdf_meta` 新規 tool (Phase 4-2 #7)

- 添付 PDF メタ一覧 + `pdf-reader-mcp` 呼び出し例だけを返す軽量 API。本文を含まないので軽い。
- 入力: `docType` (`kaisei` / `jimu-unei` / `bunshokaitou` / `tax-answer`) + `docId`
- 出力: `attachedPdfs` (kind 優先度ソート済) + `reader_hints.examples` (`read_text` 呼び出し例)
- 質疑応答事例 (qa-jirei) は PDF を持たないため対象外（enum で制限）。
- 14 ツール体制に拡張（v0.7.0 までの 13 ツール → 14 ツール）。

#### Phase 4-3 への橋渡し (#8)

- **`docs/PHASE4-PDF-FIXTURES.md`** 新設: 6 kind 別の代表 PDF カタログ。`pdf-reader-mcp` 実機テスト
  （Phase 4-3）の投入サンプルおよび `extractPdfKind` の精度検証用。

#### CI 改善 (bonus)

- **`.github/workflows/publish.yml`**: stable リリース時に `npm dist-tag add ... next` を自動実行する step を追加。
  v0.4.0 / v0.6.0 / v0.7.0 で 3 回繰り返した「next タグの揃え忘れ」を恒久対策。
  OIDC セッションを publish 直後にそのまま流用するので E401 を回避できる。

### Tests

- 既存 357 → **+10** (db-search の hasPdf 4 + handlers nta_inspect_pdf_meta 2)

### 関連ドキュメント

- [docs/PHASE4-PDF.md](docs/PHASE4-PDF.md) — Phase 4 全体ロードマップ
- [docs/PHASE4-PDF-FIXTURES.md](docs/PHASE4-PDF-FIXTURES.md) — 6 kind 別の代表 PDF カタログ
- 残: Phase 4-3 (`pdf-reader-mcp` 実機テスト + 取得不可パターン issue 化) は別セッション

## [0.7.0] - 2026-05-06

📑 **Phase 4-1 PDF kind classification 完了** — 添付 PDF をタイトルから 6 種別
（新旧対照表 / 別紙・別表 / Q&A / 参考資料 / 通知・連絡 / その他）に自動分類し、
LLM が「どの PDF を最優先で読むべきか」を構造化メタデータで判断できるようにした。
PDF 本文取得は引き続き [pdf-reader-mcp](https://www.npmjs.com/package/@shuji-bonji/pdf-reader-mcp) に完全委譲（責務分離）。

### Added (v0.7.0 の柱)

#### kind 推定エンジン (Phase 4-1-1, 既存 commit `aa117e0`)

- **`src/services/pdf-meta.ts`**: `extractPdfKind(title): PdfKind` を新設。
  - 6 種別の優先順正規表現 (`comparison` → `qa-pdf` → `attachment` → `notice` → `related`)
  - 全角・半角ゆらぎに強い積極的正規化（全角英字 / `＆` / 空白除去）
  - `PDF_KIND_EMOJI` / `PDF_KIND_LABEL` / `ALL_PDF_KINDS` を併せてエクスポート
- 45 ケースの分類テストで主要パターンをカバー

#### bulk-downloader 統合 (Phase 4-1-3)

- **`src/types/document.ts`**: `AttachedPdf.kind?: PdfKind` を optional 追加。
  v0.6.0 までに bulk DL されたレコード（`attached_pdfs_json` に kind を持たない）も
  そのまま読み込み可能（後方互換）。
- **`src/services/kaisei-parser.ts` / `jimu-unei-parser.ts` / `bunshokaitou-parser.ts`**:
  `extractAttachedPdfs()` 内で `extractPdfKind(title)` を呼ぶよう更新。これらの parser を
  使う bulk-downloader は自動的に kind 付きで保存される。
- **`src/services/tax-answer-bulk-downloader.ts`**: 内部の `extractPdfs()` でも同様に kind を付与。
- DB スキーマ変更なし（`attached_pdfs_json` JSON 文字列に kind を含める形）。マイグレーション不要。

#### Markdown 出力 (Phase 4-1-4)

- **`src/services/pdf-meta.ts`**: `renderAttachedPdfsMarkdown(pdfs)` ヘルパを新設。
  - 添付 PDF を kind 優先度（`comparison` → `attachment` → `qa-pdf` → `related` → `notice` → `unknown`）
    で安定ソートして描画
  - `種別 / タイトル / サイズ / URL` の 4 列表で kind 絵文字（🔄📎❓📚📢📄）と日本語ラベルを表示
  - 末尾に `### pdf-reader-mcp 呼び出し例` JSON ブロックを出し、最優先 PDF を `read_text`
    呼び出しの形で例示
- **`src/tools/handlers.ts`**: `renderKaiseiMarkdown` / `renderDocumentMarkdown`
  （改正通達 / 事務運営指針 / 文書回答事例）を新ヘルパに差し替え。

### Tests

- 既存: 348 → **357** (+9: parser kind 検証 2 + renderAttachedPdfsMarkdown 7)
- すべて DB スキーマ変更なしで通過

### 関連ドキュメント

- [docs/PHASE4-PDF.md](docs/PHASE4-PDF.md) — Phase 4 全体ロードマップ
- 残: Phase 4-2 (`has_pdf` フィルタ + `nta_inspect_pdf_meta` 新 tool) は v0.7.x で別波

## [0.6.0] - 2026-05-04

🛡️ **Phase 5 Resilience 完了** — スクレイピング主体の MCP が抱える「HP 構造変更で
静かに壊れる」リスクに対し、検知・可視化を本格実装。これで運用フェーズに耐える品質に。

### Added (v0.6.0 の柱)

#### 検知層 (active)

- **`services/health-store.ts`**: bulk DL 履歴を `~/.cache/houki-nta-mcp/baseline-{doc_type}.json`
  へ永続化（直近 12 件ローテーション）。9 種別（document テーブル 5 + 基本通達 4 = 4 通達分離）。
- **`services/health-thresholds.ts`**: 二重 threshold（`MIN_ABS` 種別別 + `MIN_RATE: 1%`）
  - count drift（baseline 中央値から ±20%）+ 構造変質（updatedDocs > 50%）
- **`services/bulk-aggregation.ts`**: bulk DL 前後の snapshot 差分から 4 パターン集計
  - `newDocs` / `updatedDocs` / `orphanedDocs` / `movedDocs` を計測
- **`services/db-snapshot.ts`**: document テーブル + clause テーブル両対応の snapshot ヘルパ
- 各 bulk-downloader に集計を統合（qa / tax-answer / jimu-unei / bunshokaitou / tsutatsu × 4）
- kaisei は CLI ラッパー (`runBulkDownloadKaisei`) で 4 通達分を 1 record として記録

#### 可視化層 (passive)

- **`services/freshness.ts`**: レスポンスに `freshness` フィールドを付与
  - `staleness`: `fresh` (< 1 週間) / `stale` (< 1 ヶ月) / `outdated` (> 1 ヶ月)
  - `oldest_fetched_at` / `newest_fetched_at` / `days_since_oldest`
  - `outdated` 時は `warning` で再 bulk DL を案内
- 6 つの `nta_search_*` ハンドラに統合（DB 1 行読むだけで < 1ms）

#### CLI / CI

- **`--health-check`** CLI: 9 種別（4 通達 + 5 document type）の代表 URL を canary fetch + parse 検証
- **`--strict`** フラグ: fail があれば exit code 1（CI 用）
- **`.github/workflows/canary.yml`** に `health-check` ジョブを追加（週次自動）

### Changed

- README に運用フロー（月次 bulk DL + 週次 canary）の cron 設定例を追加
- BaselineDocType を 9 種類に拡張（基本通達は通達ごとに分離: HP 構造変更が通達単位で起きるため）

### Documentation

- **`docs/RESILIENCE.md`** (新規): 5 層フレームワーク（検知 / 可視化 / 通知 / 回復 / 代替源）と
  v0.6.0 / v0.7+ のスコープ線引き

### Notes

- **partial run（taxonomy 絞り込み等）は baseline 永続化しない**: median 比較の意味が薄れるため
- 通知層（GitHub Issues 自動作成 / Slack webhook）は v0.7+ で対応
- 回復層（selector fallback / LLM-assisted parser）は v0.7+ で対応
- 代替源層（e-Gov 法令 API との突合）は v0.8+ で対応

### Verified

- build / lint / format:check 全パス
- 既存テスト 298 → 350+ 件（新規追加: health-store / thresholds / bulk-aggregation / db-snapshot）

## [0.5.0] - 2026-05-04

🎉 **Phase 3c 正式完了** — タックスアンサー / 質疑応答事例の bulk DL + FTS5 検索を本実装。
これで `nta_search_*` 系の未実装スタブがすべて解消し、**6 大コンテンツ**（基本通達 / 改正通達 /
事務運営指針 / 文書回答事例 / タックスアンサー / 質疑応答事例）すべてが FTS5 検索可能に。

### Added (v0.5.0 仕上げ)

- 実走確認: 全件 bulk DL のベンチマークを取得（fail rate 0% / 計 2,710 件 / 51 分）
  - qa-jirei: 1,841 件（9 税目、35 分）
  - tax-answer: 744 件（14 分）
  - kaisei: 125 件（4 通達分、2.3 分）
  - bunshokaitou: 152 件（既存）/ jimu-unei: 32 件（既存）
- 全件 1.13 sec/doc で安定動作。HP 構造変更検知の **baseline** として記録。

### Changed

- **`tools/definitions.ts`** の description から「Phase 0 ではスタブ」表記を削除し、
  各 search 系ツールの description を本実装の内容（FTS5 全文検索 + 事前 bulk DL 必要）に更新:
  - `nta_search_tsutatsu`: 4 通達（消基通・所基通・法基通・相基通）を明示
  - `nta_get_tsutatsu`: DB lookup → live fallback の挙動を明示
  - `nta_search_qa`: 9 税目を明示
  - `nta_search_tax_answer`: 約 750 件である旨を明示
- ファイルヘッダコメントも 6 大コンテンツ前提に書き換え。

### Notes

- v0.5.0-alpha.1 で publish した実装と機能差分は description のみ（実装ロジックに変更なし）。
- 次フェーズ予定: **Phase 4 (PDF コンテンツ活用 / pdf-reader-mcp 連携深化)** →
  **resilience 設計 (HP 構造変更検知・通知・回復)** → 他 family MCP への横展開。

## [0.5.0-alpha.1] - 2026-05-03

**Phase 3c 第 1 段** — タックスアンサー / 質疑応答事例の bulk DL + FTS5 検索を本実装。
これで `nta_search_*` 系の未実装スタブがすべて解消し、6 大コンテンツ（通達 / 改正通達 /
事務運営指針 / 文書回答事例 / タックスアンサー / 質疑応答事例）すべてが検索可能に。

### Added (Phase 3c)

- **`services/tax-answer-bulk-downloader.ts`**: タックスアンサー bulk DL
  - 索引 `/taxes/shiraberu/taxanswer/code/` から 850+ 件の個別 URL を抽出
  - 既存 `parseTaxAnswer` parser を流用、`document` テーブル (doc_type='tax-answer') へ投入
  - `--tax-answer-taxonomy=shotoku,shohi` で税目絞り込み可
- **`services/qa-bulk-downloader.ts`**: 質疑応答事例 bulk DL
  - 9 税目分の索引 `/law/shitsugi/{topic}/01.htm` から個別 URL を抽出（計 2000+ 件）
  - 既存 `parseQaJirei` parser を流用、`document` テーブル (doc_type='qa-jirei') へ投入
  - `--qa-topic=shohi,shotoku` で税目絞り込み可
  - doc_id は `'shohi/02/19'` 形式（`{topic}/{category}/{id}`）
- **CLI フラグ追加**:
  - `--bulk-download-tax-answer` / `--tax-answer-taxonomy=<csv>`
  - `--bulk-download-qa` / `--qa-topic=<csv>`
- **`--bulk-download-everything` を 6 種別対応に拡張**:
  - 旧: 4 種別（通達 / 改正 / 事務運営 / 文書回答）
  - 新: 6 種別（+ タックスアンサー / 質疑応答事例）
  - 全件投入で約 1.5〜2 時間（絞り込み推奨）

### Changed

- **`handleNtaSearchTaxAnswer` / `handleNtaSearchQa` を本実装**:
  - 旧: NOT_IMPLEMENTED スタブ
  - 新: FTS5 検索（doc_type で絞り込み） + 空 DB 時 hint 返却
- **`DocType` 型を 5 種類に拡張**: `'kaisei' | 'jimu-unei' | 'bunshokaitou' | 'tax-answer' | 'qa-jirei'`
- **CHANGELOG / README**: Phase 3c 反映、6 大コンテンツ統合

### Verified

- タックスアンサー索引パース: 850+ 件抽出 ✓
- QA 税目別索引パース: 消費税 272 件 / 所得税 261 件 ✓
- handler テスト: search_tax_answer / search_qa の空 DB ハンドリング更新

### Notes

- 全件投入は約 2 時間。実用上は **`--tax-answer-taxonomy=shohi,shotoku --qa-topic=shohi,shotoku`**
  のように税目絞り込みで運用するのが現実的
- 既存 `nta_get_tax_answer` / `nta_get_qa` はライブ取得経路として維持（互換性保持）
- 法的位置付けはタックスアンサー・質疑応答事例ともに参考解説資料、税務署員にも法的拘束力なし

### Phase 3c 残作業

- v0.5.0 正式リリース: bulk DL 実走確認 + README 更新
- v0.5.x: タックスアンサー / 質疑応答事例の DB lookup 経路を `nta_get_*` にも追加

## [0.4.0] - 2026-05-03

🎉 **Phase 3b 正式完了** — 通達本体（4 種）+ 改正通達 + 事務運営指針 + 文書回答事例 の
**4 大コンテンツがすべて bulk DL + FTS5 検索可能** に。13 ツール構成で士業ユースケースの
実用性が大幅に向上した。

### Added (v0.4.0 仕上げ)

- **`--bulk-download-everything` CLI フラグ**: 4 種別すべてを順次 bulk DL する統合フラグ
  - 通達本体 → 改正通達 → 事務運営指針 → 文書回答事例 を 1 コマンドで実行
  - fail-soft（各種別が失敗しても次に進む）
  - `--bunsho-taxonomy=shotoku,hojin` で文書回答事例の税目絞り込み可

### Phase 3b の振り返り（v0.4.0-alpha.1 〜 v0.4.0）

| バージョン     | 追加対象     | 主要発見・実装                                                                   |
| -------------- | ------------ | -------------------------------------------------------------------------------- |
| v0.4.0-alpha.1 | 改正通達     | document テーブル + 共通スキーマ、元号→ISO日付変換、添付 PDF サイズ抽出          |
| v0.4.0-alpha.2 | 事務運営指針 | URL フォルダから発出日推定、kaisei 系を索引から自動除外、共通 Markdown レンダラ  |
| v0.4.0-alpha.3 | 文書回答事例 | 3 階層索引パース、本庁系 + 国税局系 2 系統 URL 統一、12 国税局・事務所マッピング |
| **v0.4.0**     | 統合         | `--bulk-download-everything` で 4 種別一括                                       |

### Verified (4 種別の実走確認)

| コンテンツ                             | 件数             | 投入時間                   | DB テーブル             |
| -------------------------------------- | ---------------- | -------------------------- | ----------------------- |
| 通達本体 (消基通/所基通/法基通/相基通) | 約 2800 clauses  | 計 10-15 分                | clause + clause_fts     |
| 改正通達                               | 約 100 docs      | 約 5-10 分                 | document + document_fts |
| 事務運営指針                           | 32 docs          | 約 1 分                    | document + document_fts |
| 文書回答事例                           | 数百〜2000+ docs | 約 30 分超（絞り込み推奨） | document + document_fts |

### Tool 一覧（v0.4.0 確定版）

通達系（FTS5 検索 + DB 取得）:

- `nta_search_tsutatsu` / `nta_get_tsutatsu` — 4 通達横断
- `nta_search_kaisei_tsutatsu` / `nta_get_kaisei_tsutatsu` — 改正通達
- `nta_search_jimu_unei` / `nta_get_jimu_unei` — 事務運営指針
- `nta_search_bunshokaitou` / `nta_get_bunshokaitou` — 文書回答事例

タックスアンサー / 質疑応答事例（ライブ取得）:

- `nta_get_tax_answer`
- `nta_get_qa`

ユーティリティ:

- `resolve_abbreviation` — 略称解決（houki-abbreviations 経由）

合計 13 ツール（うち未実装スタブ: `nta_search_tax_answer` / `nta_search_qa` は v0.5.x で対応予定）。

### Migration Notes (v0.3.x → v0.4.0)

**DB schema v2 → v3** で `document` テーブルが追加された。既存の v0.3.x で投入した
DB は v0.4.0 起動時に自動マイグレーション (DROP & CREATE) されるため、通達本体を
再投入する必要がある:

```bash
# 推奨: 4 種別を一括投入
houki-nta-mcp --bulk-download-everything

# または個別に
houki-nta-mcp --bulk-download-all       # 通達本体（必須）
houki-nta-mcp --bulk-download-kaisei    # 改正通達
houki-nta-mcp --bulk-download-jimu-unei # 事務運営指針
houki-nta-mcp --bulk-download-bunshokaitou --bunsho-taxonomy=shotoku  # 文書回答事例（時間短縮）
```

### Notes

- **PDF コンテンツ**は `pdf-reader-mcp` への hint（URL + サイズ）として返すのみで、
  本文取得は別 MCP に委譲する責務分離設計を維持
- **法的位置付け**:
  - 通達本体・改正通達・事務運営指針: 行政内部文書、税務署員拘束あり、納税者・裁判所への直接拘束力なし
  - 文書回答事例: 国税庁の参考解説資料、税務署員にも法的拘束力なし
  - すべて利用者の自己責任での参照を想定（`DISCLAIMER.md` 参照）

### 次のフェーズ候補

- **Phase 3c**: タックスアンサー / 質疑応答事例の bulk DL → `nta_search_tax_answer` / `nta_search_qa` 本実装
- **Phase 4**: PDF コンテンツの活用（pdf-reader-mcp との連携深化）
- **Phase 5**: houki-research-skill との orchestration（横断検索・citation 標準化）

## [0.4.0-alpha.3] - 2026-05-03

**Phase 3b 第 3 段** — 文書回答事例 (bunshokaitou) の bulk DL + FTS5 検索に対応。
これで Phase 3b の 3 種別（改正通達 / 事務運営指針 / 文書回答事例）すべてが揃い、
v0.4.0 正式リリースの準備が整った。

### Added (Phase 3b alpha.3)

- **新規ツール 2 件**:
  - `nta_search_bunshokaitou` — 文書回答事例 FTS5 検索（taxonomy / limit 絞り込み対応）
  - `nta_get_bunshokaitou` — docId で文書回答事例 1 件取得（本文 + 添付 PDF URL）
- **新規 parser** `services/bunshokaitou-parser.ts`:
  - 3 階層索引対応（メイン索引 → 税目別索引 → 個別事例）
  - 本庁系 (`/law/bunshokaito/...`) と国税局系 (`/about/organization/{国税局}/bunshokaito/...`) の 2 系統 URL を統一的に扱う
  - doc_id は本庁系 `'shotoku/250416'`、国税局系 `'tokyo/shotoku/260218'` で UNIQUE 性確保
  - `issuer` は URL から「国税庁本庁 / 東京国税局 / 大阪国税局 …」を自動推定（12 国税局・事務所をマッピング）
- **`services/bunshokaitou-bulk-downloader.ts`** + CLI フラグ:
  - `--bulk-download-bunshokaitou`: 全 11 税目を 3 階層で順次 DL（rate-limit 1 req/sec、約 30 分超）
  - `--bunsho-taxonomy=shotoku,hojin`: 税目絞り込みオプション（運用調整用）
  - `perTaxonomyLimit` オプション（テスト用）

### Changed

- `tools/definitions.ts`: 13 ツール構成に拡張（既存 11 + bunshokaitou 2）
- 起動ログ更新

### Verified (実 fixture での動作確認)

| 項目                              | 結果                                                            |
| --------------------------------- | --------------------------------------------------------------- |
| メイン索引 → 税目別索引 URL 抽出  | 11 税目                                                         |
| 所得税 02.htm → 個別事例 URL 抽出 | 230+ 件（本庁系 + 国税局系両方）                                |
| 本庁系 (250416) パース            | docId='shotoku/250416' / issuer='国税庁' / 〔照会〕〔回答〕本文 |
| 国税局系 (260218 東京) パース     | docId='tokyo/shotoku/260218' / issuer='東京国税局'              |

### Notes

- `taxonomy` は税目フォルダ。所得税 = `shotoku`、源泉 = `gensen`、譲渡・山林 = `joto-sanrin` 等
- 法的位置付け: 文書回答事例は国税庁の参考解説資料、税務署員にも法的拘束力なし（`NTA_GENERAL_INFO_LEGAL_STATUS`）
- 全税目 bulk DL は 30 分超なので、用途に応じて `--bunsho-taxonomy=shotoku` のように絞り込み推奨

## [0.4.0-alpha.2] - 2026-05-02

**Phase 3b 第 2 段** — 事務運営指針 (jimu-unei) の bulk DL + FTS5 検索に対応。
v0.4.0-alpha.1 の改正通達と同じ document スキーマ・同じ Markdown レンダラを共有して
コードを最大限再利用。

### Added (Phase 3b alpha.2)

- **新規ツール 2 件**:
  - `nta_search_jimu_unei` — 事務運営指針 FTS5 検索（taxonomy / limit 絞り込み対応）
  - `nta_get_jimu_unei` — docId で事務運営指針 1 件取得（本文 + 添付 PDF URL）
- **新規 parser**:
  - `services/jimu-unei-parser.ts` — 索引 (jimu.htm) → 個別ページ URL リスト + 個別ページ → `NtaDocument`
    - 「kaisei パス」（`/jimu-unei/.../kaisei/...`）は索引から自動除外（重複格納防止）
    - URL フォルダ名 (YYMMDD 形式) から発出日を推定する `extractIssuedAtFromUrlFolder` を追加
  - `services/jimu-unei-bulk-downloader.ts` — 索引から bulk DL → `document` テーブル投入（kaisei と同パターン）
- **CLI フラグ `--bulk-download-jimu-unei`** 追加
- **共通 Markdown レンダラ** `renderDocumentMarkdown` を `handlers.ts` 内で導入（kaisei / jimu-unei が共有）

### Changed

- `tools/definitions.ts`: 11 ツール構成に拡張（既存 9 + jimu-unei 2）
- 起動ログを Phase 3b alpha.2 に更新

### Verified (実 fixture での動作確認)

| 項目                              | 結果                                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| 索引から個別ページ URL 抽出       | 32 件（kaisei は除外済み）                                                               |
| 個別 (170331) パース              | docId='shotoku/shinkoku/170331' / taxonomy='shotoku' / 発出日 2005-03-31 / 添付 PDF 5 件 |
| サフィックス付き docId (170111_1) | `sozoku/170111_1` として保持                                                             |

### Notes

- 索引から取得できる事務運営指針は約 30〜35 件、bulk DL は約 1 分で完走
- 発出日は本文記載があればそれを優先、無ければ URL フォルダ名 (YYMMDD) から推定
- 法的位置付けは通達と同等扱い（税務署員拘束あり、納税者・裁判所への拘束力なし）

### Phase 3b 残作業

- v0.4.0-alpha.3: 文書回答事例 (`bunshokaitou`) 対応
- v0.4.0: 3 種別揃って正式リリース

## [0.4.0-alpha.1] - 2026-05-02

**Phase 3b 第 1 段** — 改正通達（一部改正通達）の bulk DL + FTS5 検索に対応。
通達本体に加えて、4 通達分の改正履歴（通達番号・改正本文・添付 PDF URL）を扱えるように
なった。Phase 3 設計どおり、PDF 本文は `pdf-reader-mcp` に hint として URL を渡す形で
責務分離。

### Added (Phase 3b)

- **新規ツール 2 件**:
  - `nta_search_kaisei_tsutatsu` — 改正通達 FTS5 検索（taxonomy / limit 絞り込み対応）
  - `nta_get_kaisei_tsutatsu` — docId で改正通達 1 件取得（本文 + 添付 PDF URL を含む）
- **新規 parser**:
  - `services/kaisei-toc-parser.ts` — 改正索引 (kaisei\_\*.htm) → 個別ページ URL リスト化、`extractIssuedAt`（元号→ISO日付）/ `extractDocIdFromUrl` / `extractTaxonomyFromUrl` 付き
  - `services/kaisei-parser.ts` — 個別改正通達ページ → `NtaDocument`（本文・宛先・発出日・添付 PDF）抽出。`parsePdfSizeKb` で「PDF/470KB」「PDF/1.18MB」等のサイズ表記を KB に正規化
- **`services/kaisei-bulk-downloader.ts`** + CLI `--bulk-download-kaisei`:
  - 4 通達 (消基通/所基通/法基通/相基通) の改正索引を順次 fetch → 個別ページを 1 req/sec で DL → `document` テーブルへ INSERT OR REPLACE
  - fail-soft（個別ページ失敗は continue）
- **DB schema v3**:
  - `document` テーブル + `document_fts` (trigram) + 自動 indexing trigger
  - `(doc_type, doc_id)` UNIQUE。`taxonomy` / `issued_at` / `issuer` / `attached_pdfs_json` / `content_hash` カラム
- **db-search 拡張**:
  - `searchDocumentFts` / `getDocumentFromDb` / `listAvailableDocIds`
  - クエリは Phase 2d-5 の Normalize-everywhere に統合
- **types/document.ts**: `NtaDocument` / `AttachedPdf` / `DocType` / `KaiseiIndexEntry` の型定義
- **テスト**:
  - `kaisei-toc-parser.test.ts` — 索引 22 件抽出 / 全角数字対応 / 元号変換 / URL 解析
  - `kaisei-parser.test.ts` — 個別ページの本文・宛先・発出日・添付 PDF / `parsePdfSizeKb` の MB→KB 換算

### Changed

- **CLI ヘルプ**: `--bulk-download-kaisei` を追加
- **`tools/definitions.ts`**: 9 ツール構成に拡張（既存 7 + 改正通達 2）
- **起動ログ**: Phase 3b（改正通達 bulk DL + FTS5）対応を明示

### Verified (実 fixture での動作確認)

| 項目                                   | 結果                                                     |
| -------------------------------------- | -------------------------------------------------------- |
| 消基通 改正索引 → 個別 URL 抽出        | 22 件                                                    |
| 個別ページ (令和8年4月1日) パース      | docId / taxonomy / 発出日 / 宛先 / 本文 / 添付 PDF 全 OK |
| 添付 PDF サイズ抽出                    | 470KB（KB 単位）/ 1.18MB → 1208KB（MB 換算）             |
| 全角数字「令和７年４月１日」発出日抽出 | 2025-04-01                                               |

### Notes

- 改正通達 bulk DL: 4 通達合計で約 100 件前後 / 数分（rate-limit 1 req/sec）
- 添付 PDF の本文は **`pdf-reader-mcp` に委譲**（hint として URL とサイズを返すのみ）
- 既存 DB は schema v2 → v3 で自動マイグレーション (DROP & CREATE)。v0.3.x で投入した
  通達本体の DB は **`--bulk-download-all --refresh` で再構築**してから `--bulk-download-kaisei` を実行

### Phase 3b 残作業（次回以降）

- v0.4.0-alpha.2: 事務運営指針 (`jimu-unei`) 対応
- v0.4.0-alpha.3: 文書回答事例 (`bunshokaitou`) 対応
- v0.4.0: 3 種別揃って正式リリース

## [0.3.1] - 2026-05-02

**v0.3.0 リリース直後に発覚した法基通 bulk DL 完走バグの patch リリース**。

### Fixed

- **`extractClauseNumber` regex 拡張**: 「途中セグメントに `のN` が付く」 clause 番号
  形式（法基通 第3節の2 配下: `1-3の2-1` `1-3の2-2` ...）を正しく抽出できなかった問題を修正
  - 旧 regex は末尾の `(?:の[0-9０-９]+)?` しか許可せず、`1-3の2-1` を **`1-3の2` で
    打ち切り** → 4 件すべて同じ clause 番号 → UNIQUE INDEX 違反 → bulk DL 早期停止
  - 新 regex は **各セグメントに `(の[0-9０-９]+)?` を許可**: `[0-9０-９]+(?:の[0-9０-９]+)?(?:[-－][0-9０-９]+(?:の[0-9０-９]+)?)+`
  - 副次的に既存の noPrefixMatch (`1の2-1` 形式) も同 regex に統合され、判定パスが 1 つ減った
- **bulk-downloader を fail-soft に強化**: 想定外の例外（SQLite 制約違反 / JSON エラー等）
  でも `throw` せず警告ログだけ残して次の節に進む
  - 旧: `NtaFetchError` / `TsutatsuParseError` 以外は throw → 1 件のバグで数百節が無駄
  - 新: すべての例外を `logger.warn` で済ませ、`sectionsFailed` カウントだけ進める

### Added (テスト)

- `tsutatsu-parser.test.ts` に「途中セグメントの `のN`」回帰防止テストを追加

### Symptoms (修正前の挙動)

```
$ sqlite3 cache.db "SELECT formal_name, COUNT(*) FROM clause c JOIN tsutatsu t..."
所得税基本通達|537
法人税基本通達|30   ← 250+ あるべき
消費税法基本通達|551
相続税法基本通達|432
```

法基通の bulk DL は第1章 第3節の2 (5 番目の節) で UNIQUE 違反 → throw → 強制終了し、
第1章の 4 sections / 30 clauses しか入らない状態だった。

### Migration

修正後は `--bulk-download --tsutatsu=法人税基本通達 --refresh` で法基通だけ再 DL すれば
全 250+ sections / 数千 clauses が入る想定。

```bash
node ./dist/index.js --bulk-download --tsutatsu=法人税基本通達 --refresh
```

または `--bulk-download-all --refresh` で全通達クリア & 再 DL。

## [0.3.0] - 2026-05-02

🎉 **Phase 2 正式完了** — 4 通達の bulk DL + ローカル SQLite FTS5 検索 + DB-first/live
fallback + Normalize-everywhere + 改正検知 + write-through cache が揃い、設計通り
すべての項目が実装された。

### Added (Phase 2e — Phase 2 仕上げ)

- **`--bulk-download-all` CLI フラグ**: 登録済み通達 4 通（消基通 / 所基通 / 法基通 / 相基通）
  を順次 bulk DL。1 通達が失敗しても次に進む fail-soft 設計
- **Write-through cache** (`writeBackLiveSection`): `getTsutatsu` のライブ fallback 経路で
  取得した clauses を DB に書き戻し、次回以降は DB lookup でヒット。投入時に Normalize-everywhere を適用、best effort（失敗しても応答に影響なし）
- **改正検知** (`findStaleSections` + `--refresh-stale`):
  - section テーブルに `content_hash` カラム追加（SHA-1）。スキーマ v1 → v2
  - `findStaleSections(db, daysOld, formalName?)` で N 日以上古い section を列挙
  - CLI: `--refresh-stale=<日数>` で dry-run、`--refresh-stale=<日数> --apply` で実際に再 DL
- **テスト追加**:
  - `db-stale.test.ts`: 改正検知ロジック（古い順ソート / formalName 絞り込み）
  - `db-writeback.test.ts`: write-through cache（重複再投入 / 全角正規化 / 失敗時 0 返却）
  - `cli.test.ts`: parseArgs の網羅テスト（新フラグ込み）

### Changed

- **DB schema v2**: `section.content_hash TEXT NULL` 追加（v1 から自動マイグレーション =
  既存ローカル DB は `--refresh` で再構築推奨）
- **bulk-downloader / writeBackLiveSection で content_hash を保存**:
  clauses の (clauseNumber + title + fullText) を normalize 後に SHA-1 計算

### Verified (Phase 2 全体)

| 機能                                                      | 状態 |
| --------------------------------------------------------- | ---- |
| 4 通達 bulk DL（消基通 / 所基通 / 法基通 / 相基通）       | ✅   |
| TOC parser × 4（shohi / shotoku / hojin / sozoku）        | ✅   |
| section parser 互換（4 通達 + 共通通達 + ナカグロ複数条） | ✅   |
| FTS5 trigram 全文検索 (`nta_search_tsutatsu`)             | ✅   |
| clause→URL lookup (UNIQUE INDEX)                          | ✅   |
| DB-first + live fallback (`nta_get_tsutatsu`)             | ✅   |
| Normalize-everywhere（DB 投入 + 検索クエリ）              | ✅   |
| Write-through cache                                       | ✅   |
| 改正検知 + `--refresh-stale`                              | ✅   |
| 4 通達一括 `--bulk-download-all`                          | ✅   |
| XDG_CACHE_HOME 配下の DB                                  | ✅   |
| 起動時の自動 schema migration（v1 → v2）                  | ✅   |

### Migration Notes (v0.3.0-alpha.x → v0.3.0)

既に bulk DL 済みの DB は `--refresh` で再構築するのが安全:

```bash
houki-nta-mcp --bulk-download-all --refresh
```

理由:

- v0.3.0-alpha.5 以前の DB は normalize 適用前の clause_number / fullText を持つ
- v0.3.0-alpha.6 以降は section.content_hash カラムが追加されているが、旧 DB では NULL
- 改正検知 (`--refresh-stale`) は content_hash が埋まっている前提

### Notes

- **Phase 2 は完了**。次回フェーズの選択肢:
  - QA / TaxAnswer の bulk DL（Phase 1e のライブ取得を SQLite 化）
  - PDF コンテンツ対応（事務運営指針 / 質疑応答事例の PDF 添付ファイル）
  - DB snapshot 配布パッケージ `@shuji-bonji/houki-nta-snapshot`

## [0.3.0-alpha.6] - 2026-05-01

**Phase 2d-5 alpha リリース**。**相続税法基本通達（相基通）** に対応し、4 つの基本通達
（消基通 / 所基通 / 法基通 / 相基通）すべてで bulk DL + 検索が可能に。同時に **正規化
レイヤー (`services/text-normalize.ts`) を新設** し、DB 投入と検索クエリの両方で
同じ正規化を通す **Normalize-everywhere パターン** を確立した。

### Added (Phase 2d-5)

- **`src/services/text-normalize.ts`** — 全角ハイフン / 全角チルダ / 全角数字 /
  全角スペースを ASCII 化する正規化ヘルパー集。
  - `normalizeJpText(s)`: 本文・タイトル用の基本正規化（中黒 `・` 等は残す）
  - `normalizeClauseNumber(s)`: clause 番号用（内部空白も除去）
  - `normalizeSearchQuery(s)`: 検索クエリ用（連続空白を 1 つに圧縮）
- **`src/services/tsutatsu-toc-parser-sozoku.ts`** — 相基通 TOC parser:
  - 相基通は **1 つの HTM ファイルに複数 clause が anchor 付きで同居** する構造
  - 各 anchor を剥がして unique HTM ファイル単位で section を登録（合計 33 ファイル）
  - 章ヘッダ `<p align="center"><strong>第N章</strong></p>` から章を切り出し
  - 節ヘッダ `<p align="center"><strong>第N節</strong></p>` と
    条グループ `<p><strong>第K条((関係))</strong></p>` を section.title に複合
- **`TSUTATSU_URL_ROOTS` に相基通追加**:
  `相続税法基本通達 → https://www.nta.go.jp/law/tsutatsu/kihon/sisan/sozoku2/`
  （旧 memory にあった `/sozoku/` ではなく `/sisan/sozoku2/` 配下が正しい）
- **`TSUTATSU_TOC_STYLES` に `'sozoku'` 追加**: 4 通達対応 (`shohi`/`shotoku`/`hojin`/`sozoku`)
- **`scripts/fetch-fixtures-sozoku.mjs`** / **`scripts/probe-toc-sozoku.mjs`**:
  相基通用 fixture 取得 + probe スクリプト

### Changed (Phase 2d-5)

- **`extractClauseNumber` を相基通の clause 形式に拡張**:
  - **ナカグロ複数条共通通達**: `1の3・1の4共-1` / `2・2の2共-1` を新規対応
  - **「の付き」階層番号** (相基通でも頻出): `1の2-1` / `23の2-3` を独立判定
  - 既存の通常形式（`1-4-13の2` / `183~193共-1`）は維持
  - 文字レベル正規化を `normalizeClauseNumber` に集約（パターン認識と正規化を分離）
- **`bulk-downloader` を 4 通達対応に拡張**:
  - `TSUTATSU_TOC_STYLES` で 4 つの parser を切替
  - **clause 投入時に `normalizeJpText` を適用**（title / full_text / paragraphs_json）
- **`db-search.sanitizeFtsQuery` を Normalize-everywhere 対応に**:
  - 検索クエリ受信時に `normalizeSearchQuery` を通してから FTS5 に渡す
  - これにより、ユーザーが半角・全角どちらで検索しても DB と整合
- **`db-search.getClauseFromDb` を入力正規化対応に**:
  - 入力 clauseNumber を `normalizeClauseNumber` で DB 形式に揃えてから lookup

### Verified (実 fixture での動作確認)

| 通達 / Fixture   | clauses                       | 形式                                              |
| ---------------- | ----------------------------- | ------------------------------------------------- |
| 相基通 TOC       | 7 章 / 33 unique HTM ファイル | flat 構造                                         |
| 相基通 01/00.htm | 1                             | `1の2-1` (の付き 2 階層)                          |
| 相基通 01/01.htm | 12                            | `1の3・1の4共-1` 〜 (ナカグロ複数条共通)          |
| 相基通 03/01.htm | 13                            | `23-1` / `23の2-1` / `24-1` 等が 1 ファイルに同居 |
| 相基通 04/01.htm | 24                            | `27-1` 〜                                         |

正規化適用後、消基通 / 所基通 / 法基通の既存テストもすべて pass（regression なし）。

### Notes

- 相基通の bulk DL: rate-limit 1 req/sec で 33 ファイル → 約 35 秒
- 4 通達の bulk DL を一括する CLI 側拡張は v0.3.0-alpha.7 に持ち越し
  （現在は通達ごとに `--bulk-download --tsutatsu <name>` を打つ必要あり）

### Memory / Documentation

- 通達 TOC スタイル一覧の memory に相基通を追加（4 通達分網羅）
- Normalize-everywhere パターンを `services/text-normalize.ts` の docstring に明記

## [0.3.0-alpha.5] - 2026-05-01

**Phase 2d-4 alpha リリース**。**法人税基本通達（法基通）** の bulk DL を可能にする
専用 TOC parser を追加。bulk-downloader を 3 通達対応（消基通 / 所基通 / 法基通）に拡張。

法基通の section ページは消基通と同じ clause 番号体系（3 階層 `{章}-{節/款}-{条}`）
だったため、既存 `parseTsutatsuSection` がそのまま動作。追加修正は不要だった。

### Added (Phase 2d-4)

- **`parseTsutatsuTocHojin(html, sourceUrl, fetchedAt)`** (`src/services/tsutatsu-toc-parser-hojin.ts`):
  - 法基通の TOC ページ専用 parser（`<h2>第N章</h2>` + `<ul.noListImg.indent1><li><a></a></li></ul>` 構造）
  - 入れ子 `<ul>` で「款」も section として収集（4 階層 URL `/{章}/{章}_{節}_{款}.htm` も拾える）
  - 「第12章の2」のような枝番章も対応。`number` は連番化、`title` には HTML 上の章番号をそのまま保持
  - 「附則」「法令等」「サイトマップ」の h2 は section が無いため自動的に除外
- **`TSUTATSU_URL_ROOTS` に法基通追加**: `法人税基本通達 → https://www.nta.go.jp/law/tsutatsu/kihon/hojin/`
- **`TSUTATSU_TOC_STYLES` に `'hojin'` 追加**: bulk-downloader が parser を切り替え
- **`scripts/fetch-fixtures-hojin.mjs`**: 法基通の代表的な節を 6 本まとめて取得する fixture スクリプト
- **`scripts/probe-toc-hojin.mjs`**: 法基通 TOC parser の動作確認 probe
- **テスト追加**:
  - `tsutatsu-toc-parser-hojin.test.ts`: 法基通 TOC fixture を使った parser テスト（章数 ≥ 20、section 合計 > 200、枝番章含む）
  - `tsutatsu-parser-hojin.test.ts`: 法基通の節 fixture 5 本に対する `parseTsutatsuSection` 互換性テスト

### Changed (Phase 2d-4)

- **`bulkDownloadTsutatsu` の TOC parser 切替対応を 3 通達に拡張**:
  - `'shohi'` / `'shotoku'` / `'hojin'` の 3 スタイルを `TSUTATSU_TOC_STYLES` で判別
  - 未登録 formal_name は `'shohi'` をデフォルトとする（後方互換）

### Verified (実 fixture での動作確認)

| 通達                 | TOC parser            | section parser       | clause 数                       |
| -------------------- | --------------------- | -------------------- | ------------------------------- |
| 法基通 TOC           | parseTsutatsuTocHojin | —                    | 26 章 / 全 200+ 節 / 255 リンク |
| 法基通 01/01_01      | —                     | parseTsutatsuSection | 12 (`1-1-1` 〜)                 |
| 法基通 02/02_01_01   | —                     | parseTsutatsuSection | 16 (`2-1-1` 〜)                 |
| 法基通 02/02_01_01_2 | —                     | parseTsutatsuSection | 3 (枝番款の節 OK)               |
| 法基通 07/07_01_01   | —                     | parseTsutatsuSection | 13 (`7-1-1` 〜)                 |
| 法基通 09/09_02_03   | —                     | parseTsutatsuSection | 4 (`9-2-12` 〜)                 |
| 法基通 18/18_01_01   | —                     | parseTsutatsuSection | 5 (新章 国際最低課税)           |

### Notes

- 法基通の **bulk DL 実走** はユーザー側で `houki-nta-mcp --bulk-download --tsutatsu 法人税基本通達` を実行して検証してほしい
  - rate-limit 1 req/sec で約 200 節 → 4-5 分程度
- **相続税法基本通達（相基通）** は v0.3.0-alpha.6 で別リリースとして対応:
  - URL ルート: `/law/tsutatsu/kihon/sisan/sozoku2/`（旧 memory の情報は古かった）
  - HTML 構造が flat（`<p align="center">第N章</p>` + `<p class="indent2">{番号} <a></a></p>`）で消基通・所基通・法基通とも別物
  - clause 番号にナカグロ複数条共通 (`1の3・1の4共-1` / `2・2の2共-1`) という新形式が登場。`extractClauseNumber` の追加拡張も必要

## [0.3.0-alpha.4] - 2026-05-01

**Phase 2d-3 alpha リリース**。所基通の **section ページ parser 互換性** を確立。
所基通の節 HTML を parseTsutatsuSection で正しく扱えるよう、clause 番号 regex の
拡張と DOM 走査の境界条件を修正。所基通の bulk DL 実走に対する parser 側の準備が
整った。

### Added (Phase 2d-3)

- **scripts/fetch-fixtures-shotoku.mjs**: 所基通の代表的な節を 6 本まとめて取得する fixture 取得スクリプト
- **src/services/tsutatsu-parser-shotoku.test.ts**: 所基通 fixture を使った parseTsutatsuSection の互換性テスト
  - 2 階層 clause (`2-1` / `2-4の2` / `2-4の3`)、複数 h1 同居、複数条共通通達 (`183～193共-1`) を網羅

### Changed (Phase 2d-3) — `src/services/tsutatsu-parser.ts`

- **`extractClauseNumber` の regex 拡張**:
  - 「**複数条共通通達**」形式 `183～193共-1` / `204～206共-2` に対応
  - `〜` (U+301C / U+30FC) と `～` (U+FF5E) のゆらぎを許容
  - 通常形式は従来どおり (`1-4-13の2` / `2-4の2` / `161-1の2`)
- **`collectUntilNextH2` の境界拡張**:
  - 次の `<h1>` でも clause 区切りとして停止（所基通の節ページは複数 h1 が同一 HTML 内に並ぶ）
  - `<div class="page-header">` または直下に h1/h2 を持つ div も境界として停止
  - これにより所基通 04/01.htm の「23-1 paragraph に隣接節タイトル「法第24条《配当所得》関係」が混入する」問題を解消

### Verified (実 fixture 6 本での parser 結果)

| Fixture           | 修正前 clauses | 修正後 clauses | 形式                                 |
| ----------------- | -------------- | -------------- | ------------------------------------ |
| shotoku/01/01.htm | 6              | 6              | `2-1` 〜 `2-4の3` (2階層 + の付き)   |
| shotoku/04/01.htm | 10             | 10             | `23-1` 〜 `24-10` (複数 h1 混入解消) |
| shotoku/04/05.htm | 5              | 5              | `31-1` 〜 `31-5`                     |
| shotoku/17/01.htm | 9              | 9              | `90-2` 〜 `90-10`                    |
| shotoku/22/01.htm | 21             | 21             | `161-1` / `161-1の2` / `161-1の3` …  |
| shotoku/30/01.htm | **0**          | **7**          | `183～193共-1` 〜 `183～193共-8`     |
| shohi/01/01.htm   | 1              | 1              | 消基通 — 後方互換 OK                 |
| shohi/05/01.htm   | 11             | 11             | 消基通 — 後方互換 OK                 |

消基通の動作を壊さずに、所基通の 30/01.htm（給与所得源泉徴収）が **0 件 → 7 件** に改善。

### Notes

- 所基通の **bulk DL 実走** はユーザー側で `houki-nta-mcp --bulk-download --tsutatsu 所得税基本通達` を実行して検証してほしい（rate-limit 1 req/sec で約 200 節 → 数分）
- **法基通 / 相基通** の URL builder 拡張は v0.3.0-alpha.5 に持ち越し（URL 規則も TOC HTML 構造も別物のため、別リリースで集中対応）

## [0.3.0-alpha.3] - 2026-05-01

**Phase 2d-2 alpha リリース**。**所得税基本通達（所基通）** の bulk DL を可能にする
専用 TOC parser を追加し、bulk-downloader を「TOC parser 切替」対応に拡張。

### Added (Phase 2d-2)

- **`parseTsutatsuTocShotoku(html, sourceUrl, fetchedAt)`** (`src/services/tsutatsu-toc-parser-shotoku.ts`):
  - 所基通の TOC ページ専用 parser（HTML 構造が消基通と異なる: `<h2>第N編</h2>` + `<h3>第N章</h3>` + `<ul><li><a></a></li></ul>`）
  - 編をまたいで章番号がリセットされる構造を吸収するため、TOC 出現順で `chapter.number` を 1 から連番化
  - 章タイトルに `第N編 ...` をプレフィックスとして保持し、編情報を欠落させない
  - section URL は anchor (`#a-XX`) を剥がして正規化、`/law/tsutatsu/kihon/` 配下のみを対象に重複除去
- **`TSUTATSU_TOC_STYLES: Record<string, 'shohi' | 'shotoku'>`** (`src/constants.ts`):
  - 通達ごとの TOC HTML スタイルを宣言。bulk-downloader が parser を切り替える際の単一情報源
- **`TSUTATSU_URL_ROOTS` に所基通を追加**: `所得税基本通達 → https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/`

### Changed (Phase 2d-2)

- **`bulkDownloadTsutatsu` の TOC parser 切替対応**:
  - `TSUTATSU_TOC_STYLES[formalName]` で 'shohi' / 'shotoku' を判別し、対応する parser を呼び出す
  - 未登録 formal_name は 'shohi' をデフォルトとする（後方互換）

### Added (テスト)

- **`tsutatsu-toc-parser-shotoku.test.ts`**: 所基通 TOC fixture を使った parser テスト
  - 章が編をまたいで連番化されることを確認
  - 章タイトルに編情報がプレフィックスされることを確認
  - section URL が絶対 URL かつ `/law/tsutatsu/kihon/shotoku/` 配下であることを確認
  - 全セクション数 100 超の網羅性確認

### Notes

- 所基通の **section ページ parser** (節 HTML → clause 抽出) の検証は **Phase 2d-3** に持ち越し
  - 現時点で確認済みなのは「TOC を parse して section URL リストを得る」ところまで
  - 所基通の節ページ HTML 構造は消基通と類似と推測されるが、bulk DL 実走で要検証
- bulk DL 想定コマンド: `houki-nta-mcp --bulk-download --tsutatsu 所得税基本通達`

## [0.3.0-alpha.2] - 2026-05-01

**Phase 2d-1 alpha リリース**。`nta_get_tsutatsu` を **DB-first + live fallback** に拡張。
bulk DL 済みなら fetch なしで即時応答（消基通の応答を約 100 倍高速化）。
他通達も bulk DL されていれば DB 経由で取得可能（Phase 1d 残課題への解）。

### Added (Phase 2d-1)

- **`getClauseFromDb(db, formalName, clauseNumber)`**: 通達 + clause 番号から SQLite を引いて 1 件返す
  - paragraphs_json を自動 JSON.parse
  - section テーブルと join して fetched_at も付与
- **`listAvailableClauses(db, formalName, limit)`**: DB 内の利用可能 clause 番号一覧（hint 用）
- **`ClauseRow`**: DB lookup 結果の型定義（services/db-search から export）

### Changed (Phase 2d-1)

- **`getTsutatsu` のフロー変更**:
  ```
  略称解決 → 管轄判定 → DB lookup
    → DB hit: そのまま返す（fetch なし、source: 'db'）
    → DB miss + 通達自体は DB に存在: available_clauses を返す
    → DB miss + ライブ対応通達: 既存のライブ取得経路（source: 'live'）
    → DB miss + ライブ未対応通達: bulk-download を促す hint
  ```
- **`getTsutatsu(args, options)` の `options` に `dbPath` 追加** — テスト容易化
- レスポンスに **`source: 'db' | 'live'`** フィールド追加（json format 時）
- 起動メッセージを `Phase 2d: nta_get_tsutatsu DB-first + live fallback` に更新

### Performance

| 経路                              | レスポンス時間（消基通 1-4-1） |
| --------------------------------- | ------------------------------ |
| ライブ取得（v0.3.0-alpha.1 まで） | ~700ms（fetch + parse）        |
| DB lookup（v0.3.0-alpha.2）       | **~10ms**                      |

### Notes

- `--bulk-download` を実行していなくても、消基通はライブ取得にフォールバックして引き続き動く（v0.2.0 と同等）
- Phase 1d で「他通達は clause→URL 逆引き不可」だった課題が、DB lookup により解決
- 他通達（所基通・法基通・相基通）の bulk DL 自体は **Phase 2d-2 / 2d-3** で対応（URL builder 拡張が必要）

### Added (テスト)

- `getTsutatsu` Phase 2d 経路のテスト 3 件を追加:
  - DB seed → DB lookup で fetch されないことを確認
  - DB に通達あり / clause 無しのとき available_clauses 返却
  - DB 空 + ライブ対応通達でフォールバック + `source: 'live'` 確認
- 既存テストを `dbPath: ':memory:'` 注入で更新（DB 経路を必ず空にしてフォールバックさせる）

### Verified

- 消基通 1-4-1 を seed した DB で fetch が呼ばれずに DB lookup される動作確認（テストで保証）
- format='json' レスポンスに `source` フィールドが付与され、DB / live を判別可能

### Planned (Phase 2 残り)

- Phase 2d-2: 所基通の bulk DL 対応（URL は消基通と同形式 — `TSUTATSU_URL_ROOTS` に追加するだけ）
- Phase 2d-3: 法基通・相基通の URL builder 拡張（`{章}_{節}.htm` 形式 / 章ごとの `00.htm` 形式）
- Phase 2e: QA / TaxAnswer の bulk DL + search 対応
- Phase 2f: 改正検知 + キャッシュ無効化

## [0.3.0-alpha.1] - 2026-05-01

**Phase 2c alpha リリース**。`nta_search_tsutatsu` を FTS5 経由で本実装。
事前に `houki-nta-mcp --bulk-download` で DB を構築しておく必要がある。

### Added (Phase 2c — search via FTS5)

- **`src/services/db-search.ts`**: FTS5 (trigram) ベースの clause 検索
  - `searchClauseFts(db, keyword, options)` — keyword で `clause_fts MATCH`、rank ソート、`snippet()` でハイライト付き抜粋
  - `hasAnyClause(db, formalName?)` — DB に検索対象が入っているか確認
  - `sanitizeFtsQuery(raw)` — FTS5 メタ文字除去 + 複数語の AND 結合 + フレーズ化
- **`handleNtaSearchTsutatsu` 本実装**:
  - `keyword` で全文検索、`limit` で件数制限（default 10、最大 50）
  - DB が空のときは「`houki-nta-mcp --bulk-download` を実行してください」の親切エラー + hint を返す
  - レスポンスに `tsutatsu / abbr / clauseNumber / title / snippet / sourceUrl` + `legal_status`
- **`searchTsutatsu(args, options)`** — テスト容易な内部関数（`dbPath` で `:memory:` 注入可）
- 起動メッセージを `Phase 2c: nta_search_tsutatsu via FTS5 live` に更新

### Added (テスト)

- `src/services/db-search.test.ts`: 7 テスト
  - sanitizeFtsQuery（単一語フレーズ化 / 複数語 AND / メタ文字除去 / 空入力）
  - hasAnyClause（空 DB / seed 後 / formalName 絞り込み）
  - searchClauseFts（基本ヒット / formalName 絞り込み / limit / 空クエリ）
- `src/tools/handlers.test.ts` に Phase 2c のテスト追加（DB 空のとき hint 返却 / keyword 必須）

### Changed

- スタブから本実装になった `nta_search_tsutatsu` のテストを「未実装スタブ」リストから外す
  （`nta_search_qa` / `nta_search_tax_answer` は引き続きスタブ、Phase 2e で対応）

### Notes

- `--bulk-download` を実行しないと search は使えない（hint 経由でユーザーに促す設計）
- 検索インデックスは bulk DL 時の trigger で自動構築される
- 当面は **消費税法基本通達のみ** が検索対象（Phase 2d で他通達追加）

### Verified

- 章 1 のみで bulk DL（89 clauses）後の FTS5 検索で「納税義務」「消費税」「適格請求書」等が想定通りヒットすることを probe で確認済み（v0.3.0-alpha.0 段階）

### Planned (Phase 2 残り)

- Phase 2d: 他通達の bulk DL 対応 + handler の DB 経由 lookup（clause→URL の構造差異を吸収）
- Phase 2e: QA / TaxAnswer の bulk DL + search 対応
- Phase 2f: 改正検知 + キャッシュ無効化

## [0.3.0-alpha.0] - 2026-05-01

**Phase 2a + 2b alpha リリース**。bulk DL + SQLite FTS5 の基盤を導入。
search 系ツール（`nta_search_*`）の本実装は Phase 2c で行うため、本リリースでは
DB 構築 CLI が動くところまで（既存 MCP ツールの挙動は変更なし）。

### Added (Phase 2a — DB 基盤)

- **`better-sqlite3` ^12.9.0** を dependencies に追加（FTS5 完全対応・同期 API）
- **`src/db/schema.ts`**: スキーマ定義 + 初期化（`initSchema` / `clearAllData` / `getSchemaVersion`）
  - `tsutatsu` / `chapter` / `section` / `clause` 4 テーブル
  - `clause_fts` (FTS5 + tokenize='trigram') による全文検索インデックス
  - clause INSERT/UPDATE/DELETE で FTS を自動更新する trigger
  - `(tsutatsu_id, clause_number)` の UNIQUE INDEX で **clause→URL lookup** を実現（Phase 1d 残課題への解）
- **`src/db/index.ts`**: DB ファイルパス管理（XDG_CACHE_HOME 対応）と open/close ヘルパ
  - 環境変数: `HOUKI_NTA_DB_PATH` / `XDG_CACHE_HOME`
  - デフォルト: `${XDG_CACHE_HOME:-~/.cache}/houki-nta-mcp/cache.db`

### Added (Phase 2b — bulk downloader + CLI)

- **`src/services/bulk-downloader.ts`**: 1 通達を bulk DL する `bulkDownloadTsutatsu()`
  - TOC ページ → 全節 URL 抽出 → 順次 fetch + parse + DB insert
  - レート制限 1 req/sec（`requestIntervalMs` で上書き可、デフォルト 1100ms）
  - `onlyChapter` で章単位の絞り込み（テスト・部分 DL 用）
  - `onProgress` コールバックで進捗通知
  - 失敗節は warn ログを出して続行（NtaFetchError / TsutatsuParseError のみ）
  - **同 formal_name で idempotent**: 再実行時は古い clause / section を消してから入れ直す
- **`src/cli.ts`**: CLI モード実装
  - `houki-nta-mcp --bulk-download` で消基通を一括 DL
  - `--tsutatsu=<formal名>` でターゲット指定
  - `--db-path=<path>` で DB ファイルパス上書き
  - `--version` / `--help` も追加
- **`src/index.ts`** を CLI/MCP の両モード対応エントリに変更
  - 引数なし → MCP server 起動（既定）
  - サブコマンド指定 → CLI 処理してから exit

### Added (テスト)

- `src/db/schema.test.ts`: 4 テスト（schema / FTS5 trigger / UNIQUE INDEX / clearAllData）
- `src/services/bulk-downloader.test.ts`: 3 テスト（fixture モックで bulk DL E2E）
- `scripts/probe-bulk-dl.mjs`: 章 1 で実 nta.go.jp に対して bulk DL を試すデバッグスクリプト

### Verified

- 章 1 のみ実 bulk DL（章 1 = 8 節 / 89 clauses）が **8 秒で完了**
- FTS5 trigram で「納税義務」「消費税」等の日本語キーワード検索が機能
- clause→URL lookup（例: `1-1-1` → `/01/01.htm`）が解決可能

### Notes

- このリリースは **alpha**。既存の `nta_get_tsutatsu` / `nta_get_tax_answer` / `nta_get_qa` の挙動に変更はない
- `nta_search_tsutatsu` 等の検索系 tool 本実装は **Phase 2c** で対応
- 他通達（所基通・法基通・相基通）の DB 投入は **Phase 2d** で対応
- 改正検知 / 自動再 DL は **Phase 2f** で対応

### Planned (Phase 2 残り)

- Phase 2c: `nta_search_tsutatsu` を FTS5 で本実装
- Phase 2d: 他通達の bulk DL 対応 + handler の DB lookup 経路追加
- Phase 2e: QA / TaxAnswer の bulk DL + search 対応
- Phase 2f: 改正検知 + キャッシュ無効化

## [0.2.0] - 2026-05-01

**Phase 1e リリース**。`nta_get_tax_answer` と `nta_get_qa` を本実装。

### Added (Phase 1e — タックスアンサー / 質疑応答事例 取得)

- **`nta_get_tax_answer`**: 国税庁タックスアンサー本文を番号で取得
  - 番号の先頭桁から税目フォルダを自動判定（1xxx=所得税 / 2xxx=源泉 / 3xxx=譲渡 / 4xxx=相続・贈与 / 5xxx=法人税 / 6xxx=消費税 / 7xxx=印紙税 / 9xxx=お知らせ）
  - URL: `/taxes/shiraberu/taxanswer/{税目フォルダ}/{番号}.htm` を直接組立
  - 8xxx 帯は要追加調査のため未対応（Phase 2 で対応予定）
  - 例: `{ no: "6101" }` → 消費税の基本的なしくみ
- **`nta_get_qa`**: 質疑応答事例本文を取得
  - 引数: `topic`（税目）/ `category`（カテゴリ番号）/ `id`（事例番号）
  - URL: `/law/shitsugi/{topic}/{category}/{id}.htm` を直接組立
  - 対応 topic: shotoku / gensen / joto / sozoku / hyoka / hojin / shohi / inshi / hotei
  - category/id は 1 桁を 2 桁にゼロパディング
  - 例: `{ topic: "shohi", category: "02", id: "19" }` → 個人事業者が所有するゴルフ会員権の譲渡
- **`src/services/tax-answer-parser.ts`**: タックスアンサー parser
  - `<div class="imp-cnt" id="bodyArea">` ルート（通達と異なる）
  - `<h1>No.{番号} {タイトル}</h1>` から `no` と `title` を抽出
  - `<p>[令和7年4月1日現在法令等]</p>` から `effectiveDate` 抽出
  - h2 ごとに section 分割、`対象税目` セクションは `taxCategory` に格納
- **`src/services/qa-parser.ts`**: 質疑応答事例 parser
  - `<div class="imp-cnt-tsutatsu" id="bodyArea">` ルート（通達と同じ）
  - `<h2>【照会要旨】`/`【回答要旨】`/`【関係法令通達】` 配下の段落を構造抽出
- **`src/services/tax-answer-render.ts`**: Markdown レンダラ（タックスアンサー + 質疑応答事例）
- **`src/types/tax-answer.ts`** / **`src/types/qa.ts`**: データ型定義
- **`src/constants.ts`** に `TAX_ANSWER_BASE_URL` / `TAX_ANSWER_FOLDER_MAP` / `QA_BASE_URL` / `QA_TOPICS` / `NTA_GENERAL_INFO_LEGAL_STATUS` 追加
- **`tests/fixtures/`** に以下を追加:
  - タックスアンサー: shohi/6101, shotoku/1120, hojin/5759, sozoku/4102, gensen/2502, joto/3240, inshi/7124, osirase/9201
  - 質疑応答事例: shohi/02/19（ゴルフ会員権）
  - インデックス: `taxanswer/index2.htm`, `taxanswer/code/bunya-syohizei.htm`, `taxanswer/code/bunya-hojin.htm`, `law/shitsugi/01.htm`, `law/shitsugi/shohi/01.htm`

### Changed

- **`legal_status` フィールドの追加**: タックスアンサー / 質疑応答事例レスポンスに `NTA_GENERAL_INFO_LEGAL_STATUS` を付与（拘束力ゼロを明示。実務判断は通達・法令本文に基づく必要があると注記）
- **definitions.ts**: `nta_get_qa` の引数仕様を `{ identifier }` から `{ topic, category, id }` に変更（破壊的変更）

### Notes (BREAKING CHANGE)

- `nta_get_qa` の引数が変わっています。v0.1.x で `{ identifier: "..." }` を使っていた場合は `{ topic, category, id }` 形式へ移行してください。
  もっとも v0.1.x の `nta_get_qa` はスタブ（未実装）だったため、実利用での影響はありません。

### Planned (Phase 2 以降)

- Phase 2: bulk DL + SQLite FTS5 — `nta_search_*` 系の本実装
- Phase 1d': 他通達の clause→URL lookup table（Phase 2 と統合）
- Phase 3: 文書回答事例（PDF）— pdf-reader-mcp 連携

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

[Unreleased]: https://github.com/shuji-bonji/houki-nta-mcp/compare/v0.3.0-alpha.2...HEAD
[0.3.0-alpha.2]: https://github.com/shuji-bonji/houki-nta-mcp/releases/tag/v0.3.0-alpha.2
[0.3.0-alpha.1]: https://github.com/shuji-bonji/houki-nta-mcp/releases/tag/v0.3.0-alpha.1
[0.3.0-alpha.0]: https://github.com/shuji-bonji/houki-nta-mcp/releases/tag/v0.3.0-alpha.0
[0.2.0]: https://github.com/shuji-bonji/houki-nta-mcp/releases/tag/v0.2.0
[0.1.2]: https://github.com/shuji-bonji/houki-nta-mcp/releases/tag/v0.1.2
[0.1.1]: https://github.com/shuji-bonji/houki-nta-mcp/releases/tag/v0.1.1
[0.1.0]: https://github.com/shuji-bonji/houki-nta-mcp/releases/tag/v0.1.0
[0.0.2]: https://github.com/shuji-bonji/houki-nta-mcp/releases/tag/v0.0.2
[0.0.1]: https://github.com/shuji-bonji/houki-nta-mcp/releases/tag/v0.0.1
