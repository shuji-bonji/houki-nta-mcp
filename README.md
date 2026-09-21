# Houki NTA MCP Server

[![CI](https://github.com/shuji-bonji/houki-nta-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/shuji-bonji/houki-nta-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node-%3E%3D22-brightgreen)](https://nodejs.org/)

国税庁（NTA）公式サイトの **基本通達・改正通達・事務運営指針・文書回答事例・タックスアンサー・質疑応答事例** をローカル SQLite に取り込み、FTS5 で全文検索する MCP server。「法律で決まっている」と「通達でそうなっている」を混ぜずに、`legal_status`（通達は国民を拘束しない旨）と根拠条文への案内と鮮度を添えて返します。

法律本文（法・政令・省令）は別 MCP の [`@shuji-bonji/houki-egov-mcp`](https://github.com/shuji-bonji/houki-egov-mcp) が担当します。通達の応答からは `next_actions` で houki-egov-mcp の `get_law` へ戻れます。

> **🔗 4 つを併用したい方へ** — `houki-egov-mcp` (法令本文) と `pdf-reader-mcp` (添付 PDF 抽出) と組み合わせた **install → 設定 → 実例 4 ユースケース** をまとめた統合ガイドを用意しています。
>
> 👉 **[docs/HOUKI-FAMILY-INTEGRATION.md](docs/HOUKI-FAMILY-INTEGRATION.md)**

## 主な機能

- **6 大コンテンツに対応**: 基本通達 4 種 + 改正通達・事務運営指針・文書回答事例・タックスアンサー・質疑応答事例
- **14 ツール提供**: 取得 + FTS5 全文検索 + PDF メタ取得 + 略称解決
- **高速応答**: bulk DL 済なら DB から即時応答（~10ms）。未投入のときの動きは取得ツールごとに違います（[取得ツールが DB をどう使うか](#取得ツールが-db-をどう使うか)）
- **正規化済み検索**: Normalize-everywhere 原則で全角・半角ゆらぎを吸収（数字・英字・ハイフン・チルダ・空白。実装は houki-hub family 共通の `@shuji-bonji/houki-abbreviations`）
- **改正検知**: SHA-1 content_hash で個別文書の変化を検知、4 パターン集計（新規 / 更新 / 削除 / 移動）
- **HP 構造変更耐性 (v0.6.0 / v0.9.4)**: 9 種別 baseline で履歴管理 + `--health-check` CLI で週次 canary 検証 + `--check-baseline-drift` で `menu.htm` を真の正典として世代移行 (`sozoku2` / `hyoka_new` 等) を**事前検知** + soft-404 (`/error/404.htm` 着地) を `fetchNtaPage` で自動 fail させる二重防御
- **添付 PDF kind 分類 (v0.7.0)**: タイトルから 6 種別（新旧対照表 / 別紙・別表 / Q&A / 参考資料 / 通知・連絡 / その他）に自動分類。Markdown 出力は kind 優先度ソートの表 + `pdf-reader-mcp` 呼び出し例つき
- **`hasPdf` 検索フィルタ + `nta_inspect_pdf_meta` (v0.7.1)**: PDF 付きの重要文書だけを抽出 / PDF メタだけを軽量に返す軽量 API を提供
- **添付 PDF の読み方を返し、読み手は固定しない (v0.19.0)**: 添付 PDF の kind（`comparison`=新旧対照表 / `attachment`=別紙・別表 など。「新旧**対応**表」の表記ゆれにも対応）ごとに `read_strategy`（表として取る / 本文として読む / 先頭を見て決める）と `layout_note`（紙面の組み方）を付ける。`save: true` で PDF をサーバー側に保存して絶対パスを返す。`next_actions` に pdf-reader-mcp の呼び出し例（保存済みなら `extract_tables` / `read_text` に `file_path`、未保存なら `read_url` に `url`）と、他の PDF 読み取りツール向けの汎用の 1 件を置く。houki-nta-mcp 自身は PDF の本文を読まない。改正通達で「別紙 N」とだけ題した PDF は新旧対照表本体のことが多いので、`comparison` として返す (v0.20.0)
- **レスポンスに `freshness` 付き**: 利用者（LLM）が staleness を判定できる
- **法的位置付けを明示**: 各レスポンスに `legal_status` フィールド（通達 = 税務署員のみ拘束、QA = 参考情報、等）

### データフロー全体俯瞰

国税庁 HP の 6 大コンテンツを bulk DL で SQLite cache に投入し、MCP tool はローカル DB を先に引いて応答します。DB に無かったときの動きは取得ツールごとに違うので、[取得ツールが DB をどう使うか](#取得ツールが-db-をどう使うか)を参照してください。

```mermaid
flowchart TB
  subgraph NTA["国税庁 HP (www.nta.go.jp)"]
    direction TB
    N1["基本通達 4 種<br/>消基通 / 所基通<br/>法基通 / 相基通"]
    N2["改正通達"]
    N3["事務運営指針"]
    N4["文書回答事例"]
    N5["タックスアンサー"]
    N6["質疑応答事例"]
  end

  subgraph DL["bulk DL 層 (CLI)"]
    DLA["--bulk-download-everything<br/>または個別 --bulk-download-*"]
  end

  subgraph DBLayer["SQLite cache<br/>~/.cache/houki-nta-mcp/cache.db"]
    direction TB
    DB1["document<br/>(本文 + content_hash)"]
    DB2["section / clause<br/>(章節構造)"]
    DB3["FTS5 全文検索<br/>(Normalize-everywhere)"]
  end

  subgraph Tools["14 MCP tool"]
    direction TB
    T1["nta_get_* × 6<br/>nta_search_* × 6"]
    T2["nta_inspect_pdf_meta<br/>resolve_abbreviation"]
  end

  NTA -->|"scrape + parse<br/>(週次 health-check で監視)"| DLA
  DLA -->|"normalize + insert"| DBLayer
  DBLayer -->|"DB-first ~10ms"| Tools
  NTA -.->|"live fallback ~700ms<br/>(DB 未投入時のみ)"| Tools
  Tools -->|"freshness / legal_status<br/>を埋め込んで応答"| LLM(["LLM / Claude"])

  classDef nta fill:#fff3cd,stroke:#ffc107,color:#333
  classDef db fill:#d4edda,stroke:#28a745,color:#333
  classDef tool fill:#cce5ff,stroke:#0066cc,color:#333
  classDef cli fill:#e2d6f3,stroke:#7952b3,color:#333
  class NTA nta
  class DBLayer db
  class Tools tool
  class DL cli
```

## 提供ツール（14 ツール）

| Tool                         | 用途                                                                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `nta_get_tsutatsu`           | 通達本文を取得（DB → 無ければ国税庁サイト、4 通達対応）                                                                          |
| `nta_search_tsutatsu`        | 通達を FTS5 全文検索（`freshness` 付き）                                                                                         |
| `nta_get_kaisei_tsutatsu`    | 改正通達を docId で取得（DB のみ。本文 + kind 分類付き PDF 表）                                                                  |
| `nta_search_kaisei_tsutatsu` | 改正通達を FTS5 検索（`hasPdf` フィルタ・`freshness`）                                                                           |
| `nta_get_jimu_unei`          | 事務運営指針を取得（DB のみ）                                                                                                    |
| `nta_search_jimu_unei`       | 事務運営指針を FTS5 検索（`hasPdf` フィルタ・`freshness`）                                                                       |
| `nta_get_bunshokaitou`       | 文書回答事例を取得（DB のみ）                                                                                                    |
| `nta_search_bunshokaitou`    | 文書回答事例を FTS5 検索（`hasPdf` フィルタ・`freshness`）                                                                       |
| `nta_get_tax_answer`         | タックスアンサー本文を取得（DB → 無ければ国税庁サイト）                                                                          |
| `nta_search_tax_answer`      | タックスアンサーを FTS5 全文検索（`hasPdf` フィルタ・`freshness`）                                                               |
| `nta_get_qa`                 | 質疑応答事例の本文を取得（DB → 無ければ国税庁サイト）                                                                            |
| `nta_search_qa`              | 質疑応答事例を FTS5 全文検索（`topic` で税目の絞り込み・`freshness` 付き）                                                                |
| `nta_inspect_pdf_meta`       | 指定文書の添付 PDF の一覧に kind と読み方（`read_strategy` / `layout_note`）を付けて返す。`save: true` で PDF を保存して絶対パスを返し、`next_actions` に pdf-reader-mcp の呼び出し例と汎用の 1 件を置く。本文は読まない (v0.7.1、v0.19.0 で読み手を固定しない形に) |
| `resolve_abbreviation`       | 略称→エントリ解決（houki-abbreviations 経由）                                                                                    |

### 取得ツールが DB をどう使うか

取得ツール 6 つは、ローカル DB を先に引く点は同じですが、**DB に無かったときの動きが 2 通りに分かれます**（v0.16.0 / Issue #29）。

| ツール | DB を先に引く | DB に無いとき | DB へ書き戻す | 応答の `source` |
| --- | --- | --- | --- | --- |
| `nta_get_tsutatsu` | 引く | 国税庁サイトから取得 | 書き戻す | `"db"` / `"live"` |
| `nta_get_qa` | 引く | 国税庁サイトから取得 | 書き戻す | `"db"` / `"live"` |
| `nta_get_tax_answer` | 引く | 国税庁サイトから取得 | 書き戻す | `"db"` / `"live"` |
| `nta_get_kaisei_tsutatsu` | 引く | `DOC_NOT_FOUND` を返す | — | 付かない |
| `nta_get_jimu_unei` | 引く | `DOC_NOT_FOUND` を返す | — | 付かない |
| `nta_get_bunshokaitou` | 引く | `DOC_NOT_FOUND` を返す | — | 付かない |

改正通達・事務運営指針・文書回答事例の 3 つは、docId から個別ページの URL を組み立てるのに税目フォルダの世代差（`sozoku` / `sozoku2` など）を解く必要があるため、国税庁サイトへは取りに行きません。エラーには `--bulk-download-*` の案内が付きます。

`nta_get_qa` と `nta_get_tax_answer` が DB から返せるのは、**`structured_json` を持つ行**だけです。この列は v0.16.0 で増えたので、v0.15.x までに投入した行は持っていません。持っていない行は国税庁サイトから取得して書き戻すので、1 度引けば次からは DB から返ります。`--bulk-download-qa` / `--bulk-download-tax-answer` を実行しても埋まります（この 2 種別では、構造を持たない行は条件付き GET を使わずに取り直します）。

### 国税庁の索引から消えた文書（v0.17.0 / Issue #30）

bulk download を再実行したときに、国税庁の索引から消えていた文書は **DB から消しません**。索引から外れても、過去の課税期間の判断では依然として意味を持つ通達があるためです。

代わりに `document.orphaned_at` に「索引から消えたことを最初に確認した日時」を入れ、応答で現行の文書と区別できるようにしています。

| 応答 | 付くもの |
| --- | --- |
| `nta_search_*`（5 種別） | 各件に `index_status: "removed_from_index"` と `orphaned_at`、`search_notes` に「N 件のうち M 件は索引から外れています」の 1 行 |
| `nta_get_*`（5 種別） | `index_status` / `orphaned_at` / `notice`（Markdown 形式では「索引の状態」の行と注記） |

検索結果から除外はしません。除外すると、過去の期間を調べたい利用者が引けなくなります。

印の付け外しは `--bulk-download-*` のときに行います。

- 索引に戻っていれば印を外します（国税庁サイトの一時的な不整合や、世代ディレクトリの移行中に消えたように見える場合があるため）
- 索引にある文書と題名が一致する行には印を付けません（`sozoku` → `sozoku2` のような世代移行で doc_id が変わっただけの文書を、消えたと数えないため）
- 索引の取得に失敗した税目がある実行では、判定そのものを行いません（その税目の文書が丸ごと「消えた」と判定されるため）

### 対応通達（4 種）

| 通達             | 略称   | TOC スタイル | clause 番号体系                                |
| ---------------- | ------ | ------------ | ---------------------------------------------- |
| 消費税法基本通達 | 消基通 | shohi        | 3 階層 `1-4-13の2`                             |
| 所得税基本通達   | 所基通 | shotoku      | 2 階層 `2-4の2` / 共通通達 `183~193共-1`       |
| 法人税基本通達   | 法基通 | hojin        | 3 階層、節の2 を含む `1-3の2-N`                |
| 相続税法基本通達 | 相基通 | sozoku       | flat 構造、ナカグロ複数条共通 `1の3・1の4共-1` |

clause 番号は **Normalize-everywhere** で全角→半角統一されているため、ユーザーが半角・全角どちらで入力してもヒットします。全角英字（`ＮＩＳＡ` → `NISA`、`ｅ－Ｔａｘ` → `e-Tax`）も v0.15.0 から半角に揃います。

v0.14.2 以前に作った DB は、v0.15.0 で最初にサーバーを起動したときに一度だけ入れ直されます。国税庁サイトへの再アクセスは発生しません。

### 検索キーワードの文字数（v0.10.1、Issue #18）

全文検索は SQLite FTS5 の trigram tokenizer を使うため、**3 文字未満の語は索引に乗りません**。v0.10.0 までは「役員」「退職」のような 2 文字語がそのまま 0 件になり、通常の「該当なし」と区別できませんでした。v0.10.1 からは次のように扱います。

| 語の長さ | 扱い |
|------|------|
| 3 文字以上 | FTS5 で全文検索します（これまでどおり） |
| 2 文字 | 3 文字以上の語と一緒なら、FTS5 のヒットを「本文かタイトルにその 2 文字語を含むもの」に絞り込みます。2 文字語だけのときは、本文とタイトルの部分一致（`LIKE`）で検索します（FTS5 の rank は付かないため score は低めになります） |
| 1 文字 | 検索条件から外します |

2 文字語や 1 文字語を含むクエリでは、応答に `search_notes`（文字列の配列）が付き、どう扱ったかを文で示します。0 件のときも `search_notes` が付くので、LLM / Skill 層は「仕様上ヒットしなかった」のか「本当に該当がない」のかを判別できます。

### 検索が 0 件のとき（v0.13.0、Issue #23）

文書系の検索 5 ツール（`nta_search_qa` / `nta_search_tax_answer` / `nta_search_kaisei_tsutatsu` / `nta_search_jimu_unei` / `nta_search_bunshokaitou`）は、結果が 0 件になった理由を分けて返します。v0.12.0 までは、どの場合も「`--bulk-download-*` で DB 投入済みか確認してください」という同じ `hint` だったため、文書が入っている DB でも投入をやり直すよう案内していました。

| DB の状態 | 応答 |
| --- | --- |
| その種別の文書が DB に 1 件も無い | エラー `DOC_NOT_FOUND`。「該当なし」という検索結果ではないことを応答の形で示します。`hint` に MCP サーバーが開いている DB ファイルのパスと投入コマンドを、`next_actions` に投入コマンドを入れます |
| 税目の絞り込み（`topic` / `taxonomy`）の範囲に文書が無い | `results: []`。`hint` で絞り込みを外すよう案内し、`available_taxonomies` にその種別の文書が持つ税目の一覧を入れます |
| `hasPdf` の条件に合う文書が無い | `results: []`。`hint` で `hasPdf` を外すよう案内します（質疑応答事例は PDF を持たないため、`hasPdf: true` では常にこれになります） |
| 文書はあるが、キーワードに合わない | `results: []`。`hint` に「該当なし」と、検索した文書の件数を書きます。`freshness` で DB の取得時点を示します |

その種別の文書が 1 件も無くなるのは、主に次の場合です。

- その種別をまだ投入していない（bulk download は種別ごとに分かれています）
- `--bulk-download-everything` の途中で、その種別だけ失敗した（失敗しても次の種別へ進みます）
- bulk download を実行したシェルと MCP サーバー（Claude Desktop や plugin が起動するもの）とで、環境変数 `HOUKI_NTA_DB_PATH` / `XDG_CACHE_HOME` が違い、サーバーが別の DB ファイルを開いている。`hint` の DB のパスで確かめられます

基本通達を検索する `nta_search_tsutatsu` は、以前から同じ分け方をしています（DB に通達が無ければ `TSUTATSU_NOT_FOUND`）。

#### `nta_search_qa` の税目の絞り込み

v0.13.0 から、`nta_search_qa` は `topic`（`shotoku` / `gensen` / `joto` / `sozoku` / `hyoka` / `hojin` / `shohi` / `inshi` / `hotei`。`--qa-topic` と同じ値）で税目を絞り込めます。v0.12.0 までの `domain` は分野（`tax` / `labor` など）の値を税目と比べていたため、指定すると必ず 0 件でした。質疑応答事例はすべて税務なので、`domain: "tax"` は絞り込まずに検索し、それ以外の値は 0 件と、`topic` を使うよう案内する `hint` を返します。

### 質疑応答事例の関係法令通達（v0.12.0、Issue #22）

質疑応答事例は国税庁の参考資料で、法的拘束力はありません。根拠は、ページの【関係法令通達】欄にある法律の条文と通達で確かめます。v0.12.0 から、`nta_get_qa`（`format: "json"`）はこの欄を次のように分けて返します。

| フィールド | 中身 | 例（shohi/02/19） |
| --- | --- | --- |
| `related_laws` | 法令の参照。`law_name` / `article` / `paragraph` / `item`（別表は `appendix`）と、元の要素 `raw` | `{ "law_name": "消費税法", "article": "2", "paragraph": 1, "item": 8 }` |
| `related_tsutatsu` | 通達の参照。`name` / `clause` / `raw` | `{ "name": "消費税法基本通達", "clause": "5-1-1" }` |
| `next_actions` | 法令は houki-egov-mcp の `get_law`、基本通達 4 種は `nta_get_tsutatsu` への案内。引数をそのまま渡せます | `{ "mcp": "houki-egov", "tool": "get_law", "law_name": "消費税法", "article": "2", "paragraph": 1, "item": 8 }` |
| `qa.notice` / `qa.basisDate` | ページ下部の「注記」（作成時点と、一般的な回答である旨の断り書き）と、その作成基準日 | `"2025-08-01"` |

- 「所得税法第27条、第34条」の「第34条」のように法令名を省いた要素は、直前の法令の続きとして読みます。「、第9項」は直前の条の項、「、3-3」は直前の通達の番号です
- 告示・説明文・「［参考］」など、法令と通達として読めない要素は入れません。推測で法令名を補うこともしません。`qa.relatedLaws`（欄の文字列そのまま）で確かめてください
- 条約（「日米租税条約」など。e-Gov の法令名と一致しない通称）と改正前の法令（「旧所得税法」など）は、`related_laws` には入れますが `next_actions` では案内しません
- 枝番号の号（「法人税法第2条第12号の8」）は、v0.14.0 から `item: "12の8"`（文字列）にし、`next_actions` にも入れます。`get_law` が文字列の `item` を受け付けるのは houki-egov-mcp v0.6.0 以上です
- 分解できた割合: 2026-09-11 に、ローカル DB の質疑応答事例 1,834 件（【関係法令通達】欄あり）で測りました。欄を「、」と改行で区切った 5,059 要素のうち 4,767 要素（94.2%）を法令か通達として読み取れ、1,834 件のうち 1,652 件（90.1%）は欄の全要素を読み取れました。146 件は一部だけ、36 件は読み取れる要素がありませんでした（告示や通達の日付・番号だけが書かれた欄など）
- v0.11.1 までは、ページ下部の「注記」が `relatedLaws`（【関係法令通達】欄の無いページでは `answer`）に混ざっていました。v0.12.0 から `qa.notice` に分けています

### 文書回答事例の税目の別表記（v0.14.0）

文書回答事例の `taxonomy` は URL の税目フォルダ名です。国税局のページは本庁と違うフォルダ名を使うことがあり、同じ税目が次のように分かれています。`taxonomy` にどちらを指定しても両方を検索し、応答の `search_notes` にその旨が入ります。DB の値は変えていないので、取り込み直しは要りません。

| 税目 | 本庁の表記 | 国税局の表記 |
| --- | --- | --- |
| 相続税 | `sozoku` | `souzoku` |
| 源泉所得税 | `gensen` | `gensenshotoku` |
| 譲渡所得・山林所得 | `joto-sanrin` | `joto_sanrin` |

`--bunsho-taxonomy` は v0.14.2 からどちらの表記でも渡せます（国税局の表記は本庁の表記に直してから索引を絞り込みます）。絞り込むのは本庁の索引（`/law/bunshokaito/01.htm`）の節なので、`--bunsho-taxonomy=sozoku` でも `souzoku` でも、投入されるのは同じ 1 つの節の文書です。その節には国税局のページへのリンクも並んでいるため、DB には両方の表記が入ります（2026-09-12 に `--bunsho-taxonomy=souzoku` を実行し、18 件のうち `sozoku` 11 件・`souzoku` 7 件を確認）。

### 略称と通称の展開（v0.11.1、Issue #21）

キーワードが略称辞書（houki-abbreviations）に載っている場合、検索は正式名でも行います。v0.11.1 から、略称と通称で扱いを分けました。

| キーワードの種類 | 例 | 扱い |
| --- | --- | --- |
| 略称そのもの | 「消基通」→ 消費税法基本通達、「消法」→ 消費税法 | これまでどおり、元の語と正式名の両方で検索します |
| 通称 | 「インボイス」「軽減税率」「適格請求書発行事業者」→ 消費税法 | **元の語で 0 件のときだけ**正式名で検索します |

通称の展開先（「消費税法」）は、通達・質疑応答事例の本文にほぼ必ず出てきます。v0.11.0 までは通称でも常に展開していたため、「消費税法」という語が出てくるだけの文書が結果に混ざり、キーワードを含む文書が `limit` から押し出されていました（「適格請求書発行事業者」を limit 30 で検索すると、含む条項 32 件のうち 9 件が外れ、含まない条項が 7 件入っていました）。

通称を 0 件のため展開したときは、応答の `search_notes` にその旨が入ります。展開した検索の結果には、「消費税法」という語が出てくるだけの文書も含まれます。

### 本文中の画像（v0.10.1、Issue #17）

所基通などの一部の通達では、算式が GIF 画像で掲載されています。v0.10.0 までは画像の段落が丸ごと落ち、本文が途切れていることを応答から読み取れませんでした。v0.10.1 からは `<img>` を `[画像: alt テキスト]` のプレースホルダとして同じ位置の段落に残し（alt が無ければ `[画像: ファイル名]`）、`format: "json"` では該当段落の `images: [{ alt, src }]` と、応答直下の `content_notes` でも画像の存在を示します。Markdown では本文末尾に `> 注意: 本文に画像が N 箇所含まれています…` の行が入ります。画像の内容そのものは取得しないので、算式の正確な内容は出典 URL で確認してください。

v0.10.0 以前に構築した DB には画像のプレースホルダが入っていません。`houki-nta-mcp --bulk-download-all --refresh` で通達を再投入してください（`--refresh` なしでは、国税庁サイトが `304 Not Modified` を返す節は再解析されません）。

### 文書回答事例の本文と別紙（v0.10.3）

文書回答事例のページは、照会者・関係する法令条項等・回答年月日・回答者・回答内容が表（`<table class="kaito">`）に入り、照会の趣旨・事実関係・理由は「別紙」（同じディレクトリの `another.htm`）にあります。v0.10.2 までは `<p>` しか読んでいなかったため、`fullText` が「〔照会〕」「〔回答〕」の見出しだけになり、`issuedAt` も `null` でした。v0.10.3 からは表の各行を「見出し: 値」の形で取り込み、回答年月日を `issuedAt` にし、`--bulk-download-bunshokaitou` で別紙も取得して `【別紙】` として本文の末尾に連結します（文書あたり 1 リクエスト増えます）。

v0.10.2 以前に構築した DB の文書回答事例には本文が入っていません。**v0.10.4 以降で** `houki-nta-mcp --bulk-download-bunshokaitou --refresh` を実行して再投入してください（v0.10.3 までは `--refresh` が基本通達以外に効かず、文書回答事例は `304 Not Modified` で再解析されませんでした）。

## 使い方の例

```jsonc
// nta_get_tsutatsu — DB-first lookup（bulk DL 済みなら即時応答 ~10ms）
{ "name": "消基通", "clause": "1-4-13の2" }
// → "## 1-4-13の2（分割があった場合の課税事業者選択届出書の効力等）..."
//    + 出典 URL + 取得時刻 + 解釈の対象になる法律 + legal_status の note + source: 'db' | 'live'
// format: "json" では base_laws と next_actions（houki-egov-mcp の get_law への案内）が付く
//   "base_laws": ["消費税法", "消費税法施行令", "消費税法施行規則"],
//   "next_actions": [{ "action": "delegate_to_mcp",
//     "reason": "通達は国民・裁判所を拘束しない。根拠は法律本文で確認する",
//     "example": { "mcp": "houki-egov", "tool": "get_law", "law_name": "消費税法" } }]

// 所基通（2 階層 clause / の付き）
{ "name": "所基通", "clause": "2-4の2" }

// 所基通源泉（チルダ複数条共通）
{ "name": "所基通", "clause": "183~193共-1" }

// 相基通（ナカグロ複数条共通）
{ "name": "相基通", "clause": "1の3・1の4共-5" }

// nta_search_tsutatsu — FTS5 全文検索（4 通達横断、freshness 付き）
{ "keyword": "電子帳簿", "limit": 10 }
// → { hits: [...], freshness: { staleness, oldest_fetched_at, ... }, legal_status: ...,
//      base_laws_by_tsutatsu: { "消費税法基本通達": ["消費税法", "消費税法施行令", "消費税法施行規則"] },
//      next_actions: [通達ごとに get_law への案内 1 件] }

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

### まず数分で試す（v0.18.0 / Issue #35）

全部入りは 6 種別で約 100 分かかります。初めて入れたときは、通達 1 本だけを入れて動くことを確かめてください。

```bash
npx -y @shuji-bonji/houki-nta-mcp --quickstart   # 消費税法基本通達 1 本だけ。約 3〜5 分
```

終わると、その通達に対して `nta_search_tsutatsu` と `nta_get_tsutatsu` が使えます。別の通達にしたいときは `--quickstart --tsutatsu=所得税基本通達` のように指定します。ほかの種別はあとから、必要なものだけ足せます（下の「個別実行」）。

DB が無い状態でも、`nta_get_*`（取得ツール）は国税庁サイトから直接取ります（約 700ms。結果は DB に書き戻します）。DB が要るのは `nta_search_*`（検索ツール）だけです。

### コマンドの呼び出し形式

bulk DL コマンドは利用形態に応じて以下の 3 形式があります。以降の例は **A. グローバルインストール済み** の形式で記載しています。`B` / `C` を使う場合は同様に置き換えてください。

| 利用形態                       | コマンド形式                                                           | 前提                                                   |
| ------------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------ |
| **A. グローバル install 済み** | `houki-nta-mcp --bulk-download-everything`                             | `npm install -g @shuji-bonji/houki-nta-mcp` 実行済み   |
| **B. npx 経由（都度実行）**    | `npx -y @shuji-bonji/houki-nta-mcp --bulk-download-everything`         | Node.js / npm がインストール済みなら追加準備不要       |
| **C. ローカルクローン**        | `node /path/to/houki-nta-mcp/dist/index.js --bulk-download-everything` | `git clone` + `npm install` + `npm run build` 実行済み |

> [!TIP]
> Claude Desktop / Claude Code で MCP サーバとして登録する場合は別問題で、`mcp_servers` 設定の `npx -y @shuji-bonji/houki-nta-mcp` (= 形式 B) を使います（後述「Claude Desktop / Claude Code への登録例」を参照）。bulk DL は **MCP サーバ起動とは別プロセス** で人間が実行するため、ここではどの形式でも構いません。

```bash
# 全部入り: 6 種別を一括投入（約 100 分。--bunsho-taxonomy / --tax-answer-taxonomy / --qa-topic で短縮可。開始前に種別ごとの目安を表示します）

# A. グローバル install 済み
houki-nta-mcp --bulk-download-everything --bunsho-taxonomy=shotoku

# B. npx 経由
npx -y @shuji-bonji/houki-nta-mcp --bulk-download-everything --bunsho-taxonomy=shotoku

# C. ローカルクローン
node /path/to/houki-nta-mcp/dist/index.js --bulk-download-everything --bunsho-taxonomy=shotoku
```

```bash
# 個別実行 — 必要な種別だけ足す（以下は形式 A の例。B / C は上記対応表で置き換え）
houki-nta-mcp --quickstart                 # 通達 1 本（既定: 消基通、--tsutatsu= で変更可）
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

# menu.htm を真の正典として CANARY_TARGETS の世代移行を事前検知（canary より前段の予兆検知 / v0.9.4+）
houki-nta-mcp --check-baseline-drift
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

### 投入済みかどうかを素早く確認する

`nta_search_*` がエラー `DOC_NOT_FOUND`（基本通達は `TSUTATSU_NOT_FOUND`）を返した場合、その種別は MCP サーバーが開いている DB に入っていません（v0.12.0 までは `results: []` と「DB 投入済みか確認してください」のヒントでした）。投入の有無は以下で確認できます。

```bash
# 各 docType の件数を一発で確認 (DB が無ければ投入前)
sqlite3 "$HOME/.cache/houki-nta-mcp/cache.db" \
  "SELECT doc_type, COUNT(*) FROM document GROUP BY doc_type ORDER BY doc_type;"
```

期待される doc_type 名 → 対応 bulk DL コマンド:

| doc_type       | bulk DL コマンド                                     | 備考                                                  |
| -------------- | ---------------------------------------------------- | ----------------------------------------------------- |
| `tsutatsu`     | `--bulk-download-all`                                | 通達本体 4 種を一括（消基通・所基通・法基通・相基通） |
| `kaisei`       | `--bulk-download-kaisei`                             | 改正通達                                              |
| `jimu-unei`    | `--bulk-download-jimu-unei`                          | 事務運営指針                                          |
| `bunshokaitou` | `--bulk-download-bunshokaitou [--bunsho-taxonomy=…]` | 文書回答事例（taxonomy 指定で短縮）                   |
| `tax-answer`   | `--bulk-download-tax-answer`                         | タックスアンサー                                      |
| `qa-jirei`     | `--bulk-download-qa [--qa-topic=…]`                  | 質疑応答事例（topic 指定で短縮）                      |

`--bulk-download-everything` は上記すべてを順番に実行する短絡コマンドです。

bunsho-taxonomy / tax-answer-taxonomy / qa-topic で範囲を絞らない場合、`bunshokaitou` と `qa-jirei` は数千件単位になるため、初回は taxonomy/topic を絞って投入することを推奨します。

税目に渡せる値は次のとおりです。v0.14.2 から、ここに無い値を渡すと、何も投入せずに使える値を表示して終了します（終了コード 1）。`--help` にも同じ一覧を載せています。

| フラグ | 使える値 |
| --- | --- |
| `--bunsho-taxonomy` | `shotoku` / `gensen` / `joto-sanrin` / `sozoku` / `zoyo` / `hyoka` / `hojin` / `shohi` / `shozei` / `sonota`（国税局の表記 `souzoku` / `gensenshotoku` / `joto_sanrin` も可） |
| `--tax-answer-taxonomy` | `shotoku` / `gensen` / `joto` / `sozoku` / `hojin` / `shohi` / `inshi` / `osirase` |
| `--qa-topic` | `shotoku` / `gensen` / `joto` / `sozoku` / `hyoka` / `hojin` / `shohi` / `inshi` / `hotei` |

v0.14.1 までは値を見ずに受け取っていたため、税目を打ち間違えても投入が 0 件のまま正常終了していました。

```bash
# 例: 所得税関連だけを bulk DL（数十分 → 数分に短縮）

# A. グローバル install 済み
houki-nta-mcp --bulk-download-bunshokaitou --bunsho-taxonomy=shotoku
houki-nta-mcp --bulk-download-qa --qa-topic=shotoku

# B. npx 経由
npx -y @shuji-bonji/houki-nta-mcp --bulk-download-bunshokaitou --bunsho-taxonomy=shotoku
npx -y @shuji-bonji/houki-nta-mcp --bulk-download-qa --qa-topic=shotoku

# C. ローカルクローン
node /path/to/houki-nta-mcp/dist/index.js --bulk-download-bunshokaitou --bunsho-taxonomy=shotoku
node /path/to/houki-nta-mcp/dist/index.js --bulk-download-qa --qa-topic=shotoku
```

## 推奨運用フロー

スクレイピング主体のため、国税庁 HP の構造変更で bulk DL や parse が静かに壊れるリスクがあります。検知・可視化のため、以下を組み合わせて運用するのを推奨:

```mermaid
flowchart LR
  subgraph Monthly["月次（重い処理 / ~51 分）"]
    M1["--bulk-download-everything<br/>6 種別を順次投入<br/>+ baseline 履歴記録"]
  end

  subgraph Weekly["週次（軽い処理 / 数秒〜数十秒）"]
    direction TB
    W1["--check-baseline-drift<br/>menu.htm 突合<br/>(v0.9.4+, ~0.1 秒)"]
    W2["--health-check --strict<br/>9 種別 canary fetch+parse<br/>(~10 秒)"]
  end

  DB[("SQLite cache.db")]
  R(["MCP レスポンス<br/>+ freshness<br/>(fresh / stale / outdated)"])

  M1 -->|"normalize + insert"| DB
  DB -->|"DB-first 応答"| R
  W1 -.->|"drift 検出時<br/>baseline URL 更新を上申"| M1
  W2 -.->|"parser 失敗時<br/>HP 構造変更を検知"| M1
  R -.->|"stale なら<br/>再 bulk DL を促す"| M1

  classDef monthly fill:#cce5ff,stroke:#0066cc
  classDef weekly fill:#d4edda,stroke:#28a745
  classDef response fill:#fff3cd,stroke:#ffc107
  class Monthly monthly
  class Weekly weekly
  class R response
```

**設計の要点**: 重い `bulk-download-everything` は **月次**、軽い `health-check` / `check-baseline-drift` は **週次**で階層化。週次の 2 つは Lv-3a (soft-404) と Lv-3b (menu.htm drift) の**二重防御**で、canary が落ちる前に baseline 更新を促せます (詳細は [`docs/RESILIENCE.md`](docs/RESILIENCE.md) §5.9-5.11)。

> [!NOTE]
> 以下の表およびコマンド例は、前述「コマンドの呼び出し形式」の **形式 A (グローバル install 済み)** を前提に記載しています。`B` (npx) / `C` (ローカルクローン) を使う場合は同様に置き換えてください。

| 頻度         | コマンド                                   | 用途                                                                                   |
| ------------ | ------------------------------------------ | -------------------------------------------------------------------------------------- |
| 月 1 回      | `houki-nta-mcp --bulk-download-everything` | 4 パターン集計 + baseline 永続化                                                       |
| 週 1 回      | `houki-nta-mcp --health-check`             | 9 種別の代表 URL を canary fetch + parse                                               |
| 週 1 回      | `houki-nta-mcp --check-baseline-drift`     | menu.htm を正典として世代移行 (`sozoku2` 等) を事前検知 (v0.9.4+、canary より早期)     |
| 週 1 回 (CI) | GitHub Actions cron                        | `--health-check --strict` で自動検知 + `--check-baseline-drift` で drift 警告 (別 job) |

cron 設定例:

```cron
# A. グローバル install 済み（npm install -g 済 / `which houki-nta-mcp` で絶対パス確認）
# 月初に bulk DL（毎月 1 日 03:00 JST）
0 3 1 * *  /usr/local/bin/houki-nta-mcp --bulk-download-everything > ~/.cache/houki-nta-mcp/last-bulk.log 2>&1
# 月曜に health-check（毎週月曜 09:00 JST）
0 9 * * 1  /usr/local/bin/houki-nta-mcp --health-check >> ~/.cache/houki-nta-mcp/health.log 2>&1

# B. npx 経由（PATH に node が通っている前提。/opt/homebrew/bin など環境ごとに調整）
0 3 1 * *  /opt/homebrew/bin/npx -y @shuji-bonji/houki-nta-mcp --bulk-download-everything > ~/.cache/houki-nta-mcp/last-bulk.log 2>&1
0 9 * * 1  /opt/homebrew/bin/npx -y @shuji-bonji/houki-nta-mcp --health-check >> ~/.cache/houki-nta-mcp/health.log 2>&1

# C. ローカルクローン
0 3 1 * *  /opt/homebrew/bin/node /path/to/houki-nta-mcp/dist/index.js --bulk-download-everything > ~/.cache/houki-nta-mcp/last-bulk.log 2>&1
0 9 * * 1  /opt/homebrew/bin/node /path/to/houki-nta-mcp/dist/index.js --health-check >> ~/.cache/houki-nta-mcp/health.log 2>&1
```

> [!TIP]
> cron は環境変数を継承しないので、`houki-nta-mcp` / `npx` / `node` は **絶対パスで指定**してください。`which houki-nta-mcp` / `which npx` / `which node` で確認できます。

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

通達は国民・裁判所を拘束しないので、根拠は法律の条文で確かめる必要があります。v0.11.0 から、基本通達が解釈している法律・政令・省令と、その法律を houki-egov-mcp の `get_law` で読むための `next_actions` が応答に付きます。

- `nta_get_tsutatsu`: `base_laws`（配列）
- `nta_search_tsutatsu`: `base_laws_by_tsutatsu`（検索結果に現れた通達 → 配列の対応表）。対応は通達単位の事実なので、hit ごとではなく応答に 1 回だけ置きます

| 基本通達 | `base_laws` |
| --- | --- |
| 消費税法基本通達 | 消費税法、消費税法施行令、消費税法施行規則 |
| 所得税基本通達 | 所得税法、所得税法施行令、所得税法施行規則 |
| 法人税基本通達 | 法人税法、法人税法施行令、法人税法施行規則 |
| 相続税法基本通達 | 相続税法、相続税法施行令、相続税法施行規則 |

条番号は付けません。通達の項と法律の条の対応は一律ではなく、推測で付けると誤った引用につながるためです。

## なぜ通達まで取得するのか

法律本文だけでは判断できないケースが多数あります。例えば消費税の軽減税率:

- **法律**（消費税法 4 条）「飲食料品の譲渡には軽減税率を適用」
- **政令**: 飲食料品の定義
- **基本通達 5-1-9**: 「社内会議で出した飲食料品」「会議室への提供」「テイクアウト」の区分
- **質疑応答事例**: 個別事例（「テレワーク手当に含まれる飲料水」等）

会計・経理・税務系プロダクトを開発する場合、**通達レベルまで参照しないと正しい判定ができない** ことが多く、houki-nta-mcp はその領域をカバーします。

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

- **MCP サーバ起動とは別プロセス** で bulk DL を事前実行します。まず試すなら `npx -y @shuji-bonji/houki-nta-mcp --quickstart`（通達 1 本、約 3〜5 分）、全部入りは `--bulk-download-everything`（6 種別、約 100 分）。
- [`pdf-reader-mcp`](https://www.npmjs.com/package/@shuji-bonji/pdf-reader-mcp) を併用すると、改正通達の添付 PDF（新旧対照表など）も内容取得できます。v0.7.0 以降は kind 分類で「どの PDF を最優先で読むべきか」が Markdown 出力に明示され、**v0.7.2 + pdf-reader-mcp v0.3.0 以降では `comparison` / `attachment` 系の PDF に対して `extract_tables` 呼び出し例を自動で出力**します（表構造を保持したまま改正後/改正前を分離）。

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

## エラー応答 (houki-hub family contract)

本 MCP のエラー応答は **houki-hub family 共通契約**に従います。`code` 文字列は family 全体で統一された語彙を使用するため、houki-egov-mcp / pdf-reader-mcp と併用しても LLM・Skill 層は一貫したロジックで解釈できます。

- [`docs/ERROR-CODES.md`](https://github.com/shuji-bonji/houki-research-skill/blob/main/docs/ERROR-CODES.md) — 共通エラーコード語彙の正典 (houki-research-skill)
- [`docs/ERROR-HANDLING.md`](https://github.com/shuji-bonji/houki-research-skill/blob/main/docs/ERROR-HANDLING.md) — 解釈ポリシー / next_actions テンプレ

実装は **[houki-egov-mcp の `src/errors.ts`](https://github.com/shuji-bonji/houki-egov-mcp/blob/main/src/errors.ts) をリファレンス**としつつ、本 MCP では共通パッケージ (`houki-abbreviations` 等) への依存を持たず独立して実装します。

v0.10.0 以降、`tools/call` の応答は次の 3 経路でも同じ形式になり、いずれも `isError: true` が付きます（houki-egov-mcp v0.5.3 と同じ）。

| 経路 | `code` | 内容 |
|------|--------|------|
| ツール名が `tools/list` にない | `UNKNOWN_TOOL` | `hint` に利用可能なツール名一覧 |
| 引数が `tools/list` の `inputSchema` に合わない（型・必須・enum・inputSchema に無い引数。v0.14.0 から未知の引数もエラー） | `INVALID_ARGUMENT` | `detail.issues[]` に `path` と `message`。handler は呼ばれません |
| handler が例外を投げた | `INTERNAL_ERROR` | `retryable: true`、`detail.cause` に例外メッセージ |

handler が `LawServiceError`（上の JSON 形式）を返した場合も `isError: true` が付きます。

```json
{
  "error": "改正通達 docId=\"0025004-999\" は見つかりません",
  "code": "TSUTATSU_NOT_FOUND",
  "hint": "DB の改正通達 118 件に、この docId はありません。available_doc_ids（新しい順に 30 件）から選ぶか、nta_search_kaisei_tsutatsu で検索して docId を確かめてください。DB を投入した後に国税庁が公開した文書は、`houki-nta-mcp --bulk-download-kaisei` をもう一度実行すると取り込めます",
  "available_doc_ids": [
    { "docId": "0026003-067", "title": "消費税法基本通達の一部改正について（法令解釈通達）", "issuedAt": "2026-04-01" }
  ],
  "next_actions": [
    {
      "action": "nta_search_kaisei_tsutatsu",
      "reason": "キーワード検索で正しい docId を探せます"
    }
  ],
  "tool": "nta_get_kaisei_tsutatsu"
}
```

### docId が見つからないとき（v0.14.1）

取得系の `nta_get_kaisei_tsutatsu` / `nta_get_jimu_unei` / `nta_get_bunshokaitou` は、指定された docId が DB に無いとき、理由を 2 つに分けて返します。

| DB の状態 | 応答 |
| --- | --- |
| その種別の文書が 1 件もない | 「ローカル DB に◯◯が 1 件も無いため、docId=… を取得できません」。`hint` に DB のパスと環境変数、`next_actions` に投入コマンド（`cli_bulk_download`） |
| 文書はあるが、その docId が無い | 「◯◯ docId=… は見つかりません」。`available_doc_ids`（新しい順に 30 件）と、検索ツールへの `next_actions` |

v0.14.0 までは、どちらの場合も「DB に未投入です」と返して bulk download を案内していたため、docId を打ち間違えただけでも投入を勧めていました。

## ドキュメント

- 🌐 **[`docs/HOUKI-FAMILY-INTEGRATION.md`](docs/HOUKI-FAMILY-INTEGRATION.md) — houki-hub family 4 つを連携した統合利用ガイド (Claude Desktop / Claude Code 向け install→設定→実例 4 ユースケース)**
- [`docs/DESIGN.md`](docs/DESIGN.md) — 設計原則・houki-hub family 内の位置付け・ツール設計
- [`docs/DATABASE.md`](docs/DATABASE.md) — SQLite + FTS5 スキーマ・テーブル仕様・マイグレーション履歴
- [`docs/DATA-SOURCES.md`](docs/DATA-SOURCES.md) — 国税庁公開コンテンツの URL 構造・スクレイピング方針・ライセンス
- [`docs/RESILIENCE.md`](docs/RESILIENCE.md) — HP 構造変更検知の 5 層フレームワーク・運用フロー
- [`docs/PHASE4-PDF.md`](docs/PHASE4-PDF.md) — Phase 4: PDF メタデータ強化と pdf-reader-mcp 連携の責務分離
- [`docs/PHASE4-PDF-FIXTURES.md`](docs/PHASE4-PDF-FIXTURES.md) — kind 別代表 PDF カタログ + Phase 4-3 実機テスト結果
- 🚧 [`docs/PHASE6.md`](docs/PHASE6.md) — **Phase 6 計画書**: 運用品質と発信の底上げ (v1.0.0 への道) — search relevance ranking / bulk DL 差分更新 / houki-hub-doc + llms.txt 公開
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

> 💡 houki-nta-mcp 単体ではなく **`houki-egov-mcp` + `pdf-reader-mcp` と連携させて使う方法** は [`docs/HOUKI-FAMILY-INTEGRATION.md`](docs/HOUKI-FAMILY-INTEGRATION.md) にまとめてあります。Claude Desktop / Claude Code の設定例から、新旧対照表 PDF を `extract_tables` で表構造のまま抽出する実例まで、一から順に追えるガイドです。

ただし、**業としての使用（税理士法 52 条が定める独占業務）** については想定外であり、作者は一切の責任を負いません。[`DISCLAIMER.md`](DISCLAIMER.md) を必ずご確認ください。
