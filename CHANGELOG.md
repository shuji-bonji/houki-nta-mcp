# Changelog

All notable changes to this project will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

| 経路 | レスポンス時間（消基通 1-4-1） |
|---|---|
| ライブ取得（v0.3.0-alpha.1 まで） | ~700ms（fetch + parse） |
| DB lookup（v0.3.0-alpha.2） | **~10ms** |

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
